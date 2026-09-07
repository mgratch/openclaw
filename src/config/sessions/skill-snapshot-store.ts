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
 * copies. This is safe because snapshots are write-once: the capture path
 * always builds a fresh object and never edits an existing one. Do not
 * mutate a hydrated `entry.skillsSnapshot` in place — replace it.
 */

const SNAPSHOT_DIR_NAME = "skill-snapshots";
const SNAPSHOT_FILE_RE = /^[0-9a-f]{64}\.json$/;

/** Unreferenced blobs younger than this are kept, so a concurrent writer
 * that has hashed a snapshot but not yet persisted its ref can't lose it. */
const DEFAULT_GC_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** hash -> snapshot. Bounded by the number of distinct catalogs (~10). */
const snapshotCache = new Map<string, SessionSkillSnapshot>();

export function skillSnapshotDir(storePath: string): string {
  return path.join(path.dirname(storePath), SNAPSHOT_DIR_NAME);
}

function skillSnapshotPath(storePath: string, hash: string): string {
  return path.join(skillSnapshotDir(storePath), `${hash}.json`);
}

/**
 * Deterministic JSON with sorted object keys, so two structurally equal
 * snapshots hash identically regardless of property insertion order.
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
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function computeSkillSnapshotHash(snapshot: SessionSkillSnapshot): string {
  return crypto.createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

/**
 * Persist a snapshot and return its ref. Writing is idempotent: an existing
 * blob with the same hash already holds identical bytes, so it is left
 * alone rather than rewritten.
 */
export function writeSkillSnapshotBlob(storePath: string, snapshot: SessionSkillSnapshot): string {
  const serialized = canonicalJson(snapshot);
  const hash = crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
  const target = skillSnapshotPath(storePath, hash);
  if (!snapshotCache.has(hash)) {
    snapshotCache.set(hash, snapshot);
  }
  if (fs.existsSync(target)) {
    return hash;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Same-directory temp + rename keeps readers from observing a partial blob.
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, serialized, "utf-8");
    fs.renameSync(tmp, target);
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

export function readSkillSnapshotBlob(
  storePath: string,
  hash: string,
): SessionSkillSnapshot | undefined {
  const cached = snapshotCache.get(hash);
  if (cached) {
    return cached;
  }
  if (!SNAPSHOT_FILE_RE.test(`${hash}.json`)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(skillSnapshotPath(storePath, hash), "utf-8");
    const parsed = JSON.parse(raw) as SessionSkillSnapshot;
    if (!parsed || typeof parsed !== "object" || typeof parsed.prompt !== "string") {
      return undefined;
    }
    snapshotCache.set(hash, parsed);
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
    if (!entry || entry.skillsSnapshot || !entry.skillsSnapshotRef) {
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
  for (const [key, entry] of Object.entries(store)) {
    if (!entry?.skillsSnapshot) {
      continue;
    }
    let ref: string;
    try {
      ref = writeSkillSnapshotBlob(storePath, entry.skillsSnapshot);
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
    const { skillsSnapshot: _inline, ...rest } = entry;
    out[key] = { ...rest, skillsSnapshotRef: ref };
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
  for (const entry of Object.values(store)) {
    if (entry?.skillsSnapshotRef) {
      referenced.add(entry.skillsSnapshotRef);
    }
    if (entry?.skillsSnapshot) {
      referenced.add(computeSkillSnapshotHash(entry.skillsSnapshot));
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
      snapshotCache.delete(hash);
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

/** Test seam: drop the in-process snapshot cache. */
export function clearSkillSnapshotCache(): void {
  snapshotCache.clear();
}
