import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { SessionEntry, SessionSkillSnapshot } from "./types.js";

const log = createSubsystemLogger("sessions");

/**
 * Content-addressed storage for `SessionEntry.skillsSnapshot`.
 *
 * WHY THIS EXISTS
 * ---------------
 * A skills snapshot is the frozen skill catalog captured when a session
 * starts (see `agent-command.ts`: `needsSkillsSnapshot = isNewSession ||
 * !sessionEntry?.skillsSnapshot`). It keeps a long-running session's tool
 * surface stable across turns and compaction even when skills change on
 * disk. It is captured once per session and never mutated afterwards.
 *
 * Storing it inline in the session registry made the registry O(sessions ×
 * catalog size) instead of O(sessions). On a real deployment this reached
 * 64 MB across 870 sessions, of which 46.4 MB was `skillsSnapshot` — and
 * 731 of those entries held the *byte-identical* 59 KB blob. Because
 * `sessions.list` parses the whole registry, that turned a routine list
 * call into a ~155 s event-loop stall, which in turn failed Docker health
 * checks and restarted the gateway.
 *
 * The fix is structural rather than a periodic cleanup: snapshots live in
 * `<store-dir>/skill-snapshots/<sha256>.json`, and entries carry only
 * `skillsSnapshotRef`. Two sessions with the same catalog reference the
 * same file, so the on-disk cost grows with the number of *distinct*
 * catalogs (10 in the deployment above → 0.37 MB), not with the number of
 * sessions. Deduplication cannot drift back, because the write path has no
 * way to express a duplicate.
 *
 * ACCURACY
 * --------
 * The key is the content: the file name is the SHA-256 of its own bytes,
 * and those bytes are a canonical (sorted-key) serialization of the
 * snapshot. A ref therefore cannot resolve to anything other than exactly
 * what was captured, and `verifySkillSnapshotBlobs()` can re-derive every
 * file name from its content.
 *
 * SHARING
 * -------
 * Hydration attaches the *same* cached object to every entry that
 * references it, so 803 entries cost 10 objects in memory rather than 803
 * copies. Snapshots are write-once by construction — the capture path
 * always builds a fresh object and never edits an existing one — but
 * sharing would silently turn any stray in-place edit into cross-session
 * and cross-load bleed, which is exactly the failure mode this codebase
 * has been burned by before. So hydrated snapshots are deeply frozen: an
 * attempted mutation throws at the offending line instead of quietly
 * corrupting every other session that shares the catalog. Replace a
 * snapshot, never edit one.
 */

const SNAPSHOT_DIR_NAME = "skill-snapshots";
const SNAPSHOT_FILE_RE = /^[0-9a-f]{64}\.json$/;

/** Unreferenced blobs younger than this are kept, so a concurrent writer
 * that has hashed a snapshot but not yet persisted its ref can't lose it. */
const DEFAULT_GC_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `<resolved blob dir>\0<hash>` -> snapshot.
 *
 * The key includes the blob directory, not just the hash. Every agent has
 * its own `sessions.json` and its own `skill-snapshots/` directory, so the
 * filesystem already isolates agents; a hash-only cache would defeat that,
 * letting agent B receive agent A's cached object for a hash whose blob is
 * missing from B's own directory instead of correctly recapturing — and
 * masking missing or corrupt files until process restart.
 */
const snapshotCache = new Map<string, SessionSkillSnapshot>();

function cacheKey(storePath: string, hash: string): string {
  // A textual escape, never a literal NUL byte: a raw NUL makes git treat
  // this source file as binary, which kills diffs and grep on it.
  return `${path.resolve(skillSnapshotDir(storePath))}\u0000${hash}`;
}

/**
 * Per-pass memo: object identity -> hash, scoped to ONE dehydration call.
 *
 * Hydration hands the same object to every entry sharing a catalog, so
 * without a memo a pass canonicalizes and hashes the same ~59 KB snapshot
 * once per session (731 times here) on the synchronous save path, leaving
 * the write path O(sessions × catalog) — the very cost this change removes.
 *
 * The lifetime is deliberately one pass, not the process. A process-wide
 * memo would keep returning a remembered hash for an object whose contents
 * were since mutated (silently persisting the stale ref) and would skip
 * re-creating a blob that was deleted or corrupted after it was recorded.
 * Per-pass keeps the O(distinct) win while re-verifying on every save.
 */
type DehydrationMemo = Map<SessionSkillSnapshot, string>;

/**
 * Freeze a snapshot and everything reachable from it. Cheap: this runs once
 * per distinct catalog, not once per session.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner);
  }
  return value;
}

export function skillSnapshotDir(storePath: string): string {
  return path.join(path.dirname(storePath), SNAPSHOT_DIR_NAME);
}

function skillSnapshotPath(storePath: string, hash: string): string {
  return path.join(skillSnapshotDir(storePath), `${hash}.json`);
}

/**
 * Deterministic JSON with sorted object keys, so two structurally equal
 * snapshots hash identically regardless of property insertion order.
 *
 * Contract: dense, JSON-compatible values — exactly what `JSON.parse()`
 * yields, which is what every snapshot is. The contract matters because a
 * sparse array serializes like a dense one (`new Array(1)` and `[null]`
 * both become `[null]` here, and `[]` if empty), so a hash would not
 * distinguish them. Snapshots never contain those, and
 * `scripts/lib/canonical-json.mjs` exposes `assertCanonicalizable` for the
 * migration path, which handles data of unknown provenance.
 *
 * This function is mirrored by `scripts/lib/canonical-json.mjs`; the two are
 * pinned together by skill-snapshot-store.canonical-parity.test.ts. Do not
 * change one without the other — they generate the blob file names.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function computeSkillSnapshotHash(snapshot: SessionSkillSnapshot): string {
  return crypto.createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

/**
 * Persist a snapshot and return its ref.
 *
 * An existing blob is reused only when its bytes actually hash to the name
 * it carries. Trusting the pathname alone would make corruption permanent:
 * reads reject the bad blob, the session recaptures, the write short-
 * circuits on the existing name, and the blob is never repaired.
 */
export function writeSkillSnapshotBlob(
  storePath: string,
  snapshot: SessionSkillSnapshot,
  memo?: DehydrationMemo,
): string {
  // Fast path for the shared-object case within a single pass: this exact
  // object was already canonicalized, hashed and verified a moment ago, so
  // skip repeating ~59 KB of work per referencing session.
  const known = memo?.get(snapshot);
  if (known) {
    return known;
  }
  const serialized = canonicalJson(snapshot);
  const hash = crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
  const target = skillSnapshotPath(storePath, hash);
  // Deliberately does NOT populate the cache. The argument belongs to the
  // caller (it is the snapshot just captured for a live session); caching it
  // would later hand that same unfrozen object to other sessions via
  // hydration, and freezing it here would mutate someone else's object as a
  // side effect of saving. The cache is populated only by reads, which own
  // and freeze what they parse. Cost of that choice: one extra file read per
  // distinct catalog after a write.
  if (blobMatchesHash(target, hash)) {
    // A blob written by an older build (or by the migration) may carry the
    // world-readable default; accepting it must also repair it, or weak
    // permissions become permanent.
    hardenBlobPermissions(path.dirname(target), target);
    memo?.set(snapshot, hash);
    return hash;
  }
  // Mode 0700/0600 to match the registry: snapshots carry skill prompts and
  // resolved skill metadata, which must not be readable by other local users
  // when `sessions.json` itself is 0600.
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  // Same-directory temp + rename keeps readers from observing a partial blob,
  // and both the file and the directory are synced before the ref that points
  // at them can be committed — otherwise a power loss could leave a durable
  // registry ref whose blob never made it to disk.
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, serialized, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
    hardenBlobPermissions(path.dirname(target), target);
    syncDirectory(path.dirname(target));
    memo?.set(snapshot, hash);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort temp cleanup
    }
    throw err;
  }
  return hash;
}

/**
 * Bring an existing blob and its directory up to the registry's own
 * protection (0700/0600). `mkdirSync({ mode })` does nothing to a directory
 * that already exists, and a blob created by the migration or an older
 * build may be world-readable; without this, weak permissions on skill
 * prompts survive forever.
 */
function hardenBlobPermissions(dir: string, target: string): void {
  try {
    const dirStat = fs.statSync(dir);
    if ((dirStat.mode & 0o077) !== 0) {
      fs.chmodSync(dir, 0o700);
    }
    const fileStat = fs.statSync(target);
    if (fileStat.isFile() && (fileStat.mode & 0o077) !== 0) {
      fs.chmodSync(target, 0o600);
    }
  } catch {
    // Best-effort: a permissions repair must never fail a session write.
  }
}

/** True when the file exists and its bytes hash to `hash`. */
function blobMatchesHash(target: string, hash: string): boolean {
  try {
    const raw = fs.readFileSync(target, "utf-8");
    return crypto.createHash("sha256").update(raw, "utf8").digest("hex") === hash;
  } catch {
    return false;
  }
}

function syncDirectory(dir: string): void {
  try {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Directory fsync is unsupported on some platforms/filesystems; the
    // rename itself is still atomic there.
  }
}

export function readSkillSnapshotBlob(
  storePath: string,
  hash: string,
): SessionSkillSnapshot | undefined {
  const key = cacheKey(storePath, hash);
  const cached = snapshotCache.get(key);
  if (cached) {
    return cached;
  }
  if (!SNAPSHOT_FILE_RE.test(`${hash}.json`)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(skillSnapshotPath(storePath, hash), "utf-8");
    // Verify the content against the hash we were asked for. Content
    // addressing is only an integrity guarantee if the read path enforces
    // it; without this, a truncated, hand-edited, or partially-written blob
    // would be served as though it were the captured snapshot. The result is
    // cached, so this costs one hash per distinct catalog per process, not
    // one per session.
    if (crypto.createHash("sha256").update(raw, "utf8").digest("hex") !== hash) {
      log.warn("skill snapshot blob failed hash verification; ignoring", {
        hash,
        dir: skillSnapshotDir(storePath),
      });
      return undefined;
    }
    const parsed = JSON.parse(raw) as SessionSkillSnapshot;
    if (!parsed || typeof parsed !== "object" || typeof parsed.prompt !== "string") {
      return undefined;
    }
    // Frozen because this object is shared by every entry that references the
    // hash: an in-place edit would otherwise leak across sessions and across
    // loads. Snapshots are immutable by definition, so this only makes an
    // existing invariant enforceable.
    deepFreeze(parsed);
    snapshotCache.set(key, parsed);
    return parsed;
  } catch {
    // Missing or unreadable blob: the caller treats this like a missing
    // snapshot, and the capture path rebuilds one on the next turn.
    return undefined;
  }
}

/**
 * Attach snapshots referenced by `skillsSnapshotRef`. Mutates and returns
 * the store so both the disk and cache load paths can share one call.
 * Idempotent: entries that already carry a snapshot are left alone.
 */
export function hydrateSkillSnapshots(
  store: Record<string, SessionEntry>,
  storePath: string,
): Record<string, SessionEntry> {
  let missing = 0;
  for (const entry of Object.values(store)) {
    if (!entry) {
      continue;
    }
    // An inline snapshot can arrive already attached: legacy registries, and
    // — critically — the write-through cache, which stores a
    // `structuredClone()` of the live hydrated store. structuredClone drops
    // frozen state while preserving sharing inside the graph, so a cache-hit
    // load would otherwise hand back MUTABLE objects shared across entries:
    // frozen via the disk path, unfrozen via the cache path. Freeze here so
    // the invariant holds on every load path. Idempotent and cheap —
    // deepFreeze short-circuits on already-frozen objects.
    if (entry.skillsSnapshot) {
      deepFreeze(entry.skillsSnapshot);
      continue;
    }
    if (!entry.skillsSnapshotRef) {
      continue;
    }
    const snapshot = readSkillSnapshotBlob(storePath, entry.skillsSnapshotRef);
    if (snapshot) {
      entry.skillsSnapshot = snapshot;
    } else {
      missing += 1;
    }
  }
  if (missing > 0) {
    log.warn("skill snapshot blobs missing; sessions will recapture on next turn", {
      missing,
      dir: skillSnapshotDir(storePath),
    });
  }
  return store;
}

/**
 * Build the serializable view of the store: snapshots moved out to blobs,
 * entries left carrying only a ref.
 *
 * This returns a shallow copy per affected entry and never edits the live
 * store, because callers keep using the in-memory entries after a save —
 * stripping `skillsSnapshot` from those would make the very next read look
 * like a missing snapshot and trigger a pointless recapture.
 */
export function dehydrateSkillSnapshotsForWrite(
  store: Record<string, SessionEntry>,
  storePath: string,
): Record<string, SessionEntry> {
  let out: Record<string, SessionEntry> | undefined;
  // Fresh per call: see DehydrationMemo.
  const memo: DehydrationMemo = new Map();
  for (const [key, entry] of Object.entries(store)) {
    if (!entry?.skillsSnapshot) {
      continue;
    }
    let ref: string;
    try {
      ref = writeSkillSnapshotBlob(storePath, entry.skillsSnapshot, memo);
    } catch (err) {
      // Never fail a session write because the blob could not be written;
      // fall back to the legacy inline shape for this entry.
      log.warn("failed to write skill snapshot blob; keeping inline snapshot", {
        sessionKey: key,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    out ??= { ...store };
    // Copy-then-mutate rather than `{ ...rest, skillsSnapshotRef: ref }`:
    // assigning an existing key preserves its position, so an entry loaded
    // from disk re-serializes with identical key order. Rebuilding the object
    // would move the ref to the end, making every save differ from the
    // on-disk bytes and defeating the `getSerializedSessionStore() === json`
    // no-op-write short-circuit in store.ts.
    const copy: SessionEntry = { ...entry };
    delete copy.skillsSnapshot;
    copy.skillsSnapshotRef = ref;
    out[key] = copy;
  }
  return out ?? store;
}

/**
 * Delete blobs no entry references. Age-guarded so a snapshot written by a
 * concurrent process that has not yet committed its ref survives.
 */
export function gcSkillSnapshotBlobs(params: {
  store: Record<string, SessionEntry>;
  storePath: string;
  minAgeMs?: number;
  now?: number;
}): { deleted: number; kept: number } {
  const { store, storePath } = params;
  const minAgeMs = params.minAgeMs ?? DEFAULT_GC_MIN_AGE_MS;
  const now = params.now ?? Date.now();
  const dir = skillSnapshotDir(storePath);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return { deleted: 0, kept: 0 };
  }
  const referenced = new Set<string>();
  const addRefs = (entries: Iterable<SessionEntry | undefined>) => {
    for (const entry of entries) {
      if (entry?.skillsSnapshotRef) {
        referenced.add(entry.skillsSnapshotRef);
      }
      if (entry?.skillsSnapshot) {
        referenced.add(computeSkillSnapshotHash(entry.skillsSnapshot));
      }
    }
  };
  addRefs(Object.values(store));
  // Rotated registries (`sessions.json.bak.*`, see store-maintenance.ts) are
  // retained precisely so they can be restored. Collecting a blob they still
  // reference would leave a backup that can no longer reproduce its own
  // snapshots, so their refs count as live too.
  for (const backup of listSiblingRegistryBackups(storePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(backup, "utf-8")) as Record<string, SessionEntry>;
      if (parsed && typeof parsed === "object") {
        addRefs(Object.values(parsed));
      }
    } catch {
      // An unreadable backup must not license deletion: skip GC entirely
      // rather than risk collecting something it references.
      return { deleted: 0, kept: files.length };
    }
  }
  let deleted = 0;
  let kept = 0;
  for (const file of files) {
    if (!SNAPSHOT_FILE_RE.test(file)) {
      continue;
    }
    const hash = file.slice(0, -".json".length);
    if (referenced.has(hash)) {
      kept += 1;
      continue;
    }
    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs < minAgeMs) {
        kept += 1;
        continue;
      }
      fs.rmSync(full, { force: true });
      snapshotCache.delete(cacheKey(storePath, hash));
      deleted += 1;
    } catch {
      kept += 1;
    }
  }
  return { deleted, kept };
}

/**
 * Re-derive every blob's file name from its own bytes. Used by the
 * migration to prove nothing was corrupted, and available as a repair
 * check. Returns the hashes that failed verification.
 */
export function verifySkillSnapshotBlobs(storePath: string): {
  checked: number;
  corrupt: string[];
} {
  const dir = skillSnapshotDir(storePath);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return { checked: 0, corrupt: [] };
  }
  const corrupt: string[] = [];
  let checked = 0;
  for (const file of files) {
    if (!SNAPSHOT_FILE_RE.test(file)) {
      continue;
    }
    checked += 1;
    const expected = file.slice(0, -".json".length);
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const actual = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
      if (actual !== expected) {
        corrupt.push(expected);
      }
    } catch {
      corrupt.push(expected);
    }
  }
  return { checked, corrupt };
}

/** Registry backups kept by store-maintenance rotation, next to the store. */
function listSiblingRegistryBackups(storePath: string): string[] {
  const dir = path.dirname(storePath);
  const base = path.basename(storePath);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f !== base && f.startsWith(`${base}.`))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Test seam: drop the in-process snapshot cache. */
export function clearSkillSnapshotCache(): void {
  snapshotCache.clear();
}
