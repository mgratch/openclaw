#!/usr/bin/env node
/**
 * migrate-skill-snapshots.mjs — move inline `skillsSnapshot` payloads out of
 * session registries into the content-addressed blob store.
 *
 * WHY: the registry is parsed in full by `sessions.list`. Inlining a ~59 KB
 * skills catalog per session made it O(sessions × catalog): 64 MB across 870
 * sessions, 46.4 MB of it the same blob repeated 731 times, which stalled
 * `sessions.list` for ~155 s and restarted the gateway via health-check
 * timeouts. See src/config/sessions/skill-snapshot-store.ts.
 *
 * SEQUENCING — read this before running:
 *   Deploy the code that understands `skillsSnapshotRef` FIRST. A gateway
 *   running older code sees a ref it does not know, treats the snapshot as
 *   missing, recaptures it, and writes the inline blob straight back.
 *   The script refuses to run while a gateway process is live unless
 *   --force is passed.
 *
 * SAFETY: every registry is backed up next to itself before rewriting, and
 * the rewrite is verified by re-reading each ref and deep-comparing it to
 * the snapshot that was there before. Any mismatch aborts that file with the
 * backup left in place.
 *
 * Usage:
 *   node scripts/migrate-skill-snapshots.mjs                 # dry run, all agents
 *   node scripts/migrate-skill-snapshots.mjs --apply
 *   node scripts/migrate-skill-snapshots.mjs --apply --store <path/to/sessions.json>
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCanonicalizable, canonicalJson } from "./lib/canonical-json.mjs";

// Strict parsing. `--store` with a missing value used to leave
// EXPLICIT_STORE undefined, which silently fell back to migrating EVERY
// agent registry — the widest possible blast radius from a typo.
const argv = process.argv.slice(2);
const KNOWN_FLAGS = new Set(["--apply", "--force", "--confirm-code-deployed"]);
let APPLY = false;
let FORCE = false;
let CONFIRM_DEPLOYED = false;
let EXPLICIT_STORE;

function usageError(msg) {
  console.error(`${msg}\n`);
  console.error("usage: node scripts/migrate-skill-snapshots.mjs [--apply]");
  console.error("         [--store <path/to/sessions.json>] [--confirm-code-deployed] [--force]");
  process.exit(2);
}

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--store") {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("-")) {
      usageError("--store requires a path to a sessions.json");
    }
    if (EXPLICIT_STORE !== undefined) {
      usageError("--store given more than once");
    }
    EXPLICIT_STORE = value;
    i += 1;
    continue;
  }
  if (!KNOWN_FLAGS.has(arg)) {
    usageError(`unknown argument: ${arg}`);
  }
  if (arg === "--apply") {
    APPLY = true;
  } else if (arg === "--force") {
    FORCE = true;
  } else {
    CONFIRM_DEPLOYED = true;
  }
}

const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, ".openclaw", "agents");
const SNAPSHOT_DIR_NAME = "skill-snapshots";

// Single source of truth for the script side, kept in parity with the
// TypeScript canonicalizer by skill-snapshot-store.canonical-parity.test.ts.
// Do not re-inline a copy here.

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Returns a reason string when it is not provably safe to migrate, or null
 * when it is. Fails CLOSED: "docker is unavailable" is not evidence that the
 * gateway is stopped, and a container may be named `openclaw-gateway`,
 * `openclaw-openclaw-gateway-1`, or any Compose-generated variant.
 */
function blockingGatewayReason() {
  let out;
  try {
    out = execFileSync("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "docker is not available, so this script cannot prove the gateway is stopped";
  }
  const running = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /openclaw/i.test(line) && /gateway/i.test(line))
    .map((line) => line.split("\t")[0]);
  if (running.length > 0) {
    return `gateway container(s) running: ${running.join(", ")}`;
  }
  return null;
}

/**
 * The code that starts NEXT must already understand `skillsSnapshotRef`,
 * otherwise it treats a migrated entry as having no snapshot, recaptures,
 * and writes the inline blob straight back.
 *
 * This script cannot verify that. It runs from a source checkout; the
 * gateway runs from a Docker image that may be built from anything. An
 * earlier version of this file "checked" that the local checkout contained
 * skill-snapshot-store.ts, which proves only that the migration script is
 * new — precisely the thing that was never in doubt. Rather than dress that
 * up as verification, require the operator to assert it explicitly.
 */
function deploymentAssertionReason() {
  if (CONFIRM_DEPLOYED) {
    return null;
  }
  return (
    "this script cannot verify which build the gateway will start from " +
    "(it runs from a source checkout; the gateway runs from an image). " +
    "Confirm the deployed image understands skillsSnapshotRef, then pass " +
    "--confirm-code-deployed"
  );
}

/** fsync a directory so a create/rename is durable, not just the file bytes. */
function syncDirectory(dir) {
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Unsupported on some platforms/filesystems; rename remains atomic.
  }
}

/**
 * Take the same `<sessions.json>.lock` that `saveSessionStore()` uses (see
 * src/agents/session-write-lock.ts: exclusive `wx` create, JSON payload).
 * Comparing bytes before a rename is a fence, not mutual exclusion — without
 * the lock another writer can land between the compare and the rename.
 */
function acquireStoreLock(storePath, { timeoutMs = 30_000 } = {}) {
  const lockPath = `${storePath}.lock`;
  const deadline = Date.now() + timeoutMs;
  // A token unique to THIS acquisition. Release compares it before
  // unlinking, so a process whose lock was reclaimed can never delete the
  // lock a later owner is holding.
  const token = crypto.randomUUID();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(
        fd,
        // createdAt as an ISO string to match src/agents/session-write-lock.ts.
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token }, null, 2),
      );
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      return () => {
        // Ownership-fenced release: only remove the lock if it is still ours.
        try {
          const held = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
          if (held?.token !== token) {
            return;
          }
        } catch {
          return;
        }
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          /* already gone */
        }
      };
    } catch (openErr) {
      if (openErr.code !== "EEXIST") {
        throw openErr;
      }
      // Reclaim ONLY a dead owner. Age is not evidence: a migration over
      // 123 MB can legitimately run for minutes, and evicting a live owner
      // on a timer is how two migrations end up writing the same registry.
      try {
        const payload = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
        let ownerAlive = true;
        if (typeof payload?.pid === "number") {
          try {
            process.kill(payload.pid, 0);
          } catch (killErr) {
            ownerAlive = killErr.code === "EPERM";
          }
        }
        if (!ownerAlive) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // Unreadable lock: treat as held and keep waiting.
      }
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${lockPath} (held by a live process; stop all writers)`,
          { cause: openErr },
        );
      }
      // Coarse spin; this script is not latency sensitive.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/**
 * Publish a blob with the same protection and durability as the runtime
 * writer in src/config/sessions/skill-snapshot-store.ts: 0700 directory,
 * 0600 file, fsync(file) -> rename -> fsync(dir). This is the path that
 * creates every production blob, so it cannot be the weak one.
 */
/**
 * Bring an already-present blob up to 0700/0600. Unlike the runtime helper
 * this throws: the migration is a one-time destructive rewrite, so a store
 * whose blobs cannot be protected must fail loudly rather than be reported
 * as migrated.
 */
function hardenExistingBlob(blobDir, target) {
  if ((fs.statSync(blobDir).mode & 0o077) !== 0) {
    fs.chmodSync(blobDir, 0o700);
  }
  const st = fs.statSync(target);
  if (!st.isFile()) {
    throw new Error(`${target} exists but is not a regular file`);
  }
  if ((st.mode & 0o077) !== 0) {
    fs.chmodSync(target, 0o600);
  }
}

function publishBlob(blobDir, target, serialized) {
  fs.mkdirSync(blobDir, { recursive: true, mode: 0o700 });
  try {
    if ((fs.statSync(blobDir).mode & 0o077) !== 0) {
      fs.chmodSync(blobDir, 0o700);
    }
  } catch {
    /* best-effort */
  }
  const tmp = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, serialized, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  syncDirectory(blobDir);
}

function findStores() {
  if (EXPLICIT_STORE) {
    return [EXPLICIT_STORE];
  }
  const out = [];
  let agents = [];
  try {
    agents = fs.readdirSync(AGENTS_DIR);
  } catch {
    return out;
  }
  for (const agent of agents) {
    const p = path.join(AGENTS_DIR, agent, "sessions", "sessions.json");
    if (fs.existsSync(p)) {
      out.push(p);
    }
  }
  return out;
}

function deepEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

// ── Preflight: gate BEFORE reading or mutating anything ──────────────
// This has to run first and abort nonzero. A warning printed after every
// registry has already been rewritten is not a safety check.
if (APPLY) {
  const reasons = [blockingGatewayReason(), deploymentAssertionReason()].filter(Boolean);
  if (reasons.length > 0 && !FORCE) {
    console.error("Refusing to migrate:");
    for (const r of reasons) {
      console.error(`  - ${r}`);
    }
    console.error(
      "\nDeploy the code that understands skillsSnapshotRef, stop the gateway, then re-run.\n" +
        "Pass --force only if you have verified both conditions yourself.",
    );
    process.exit(2);
  }
  if (reasons.length > 0) {
    console.error(`Proceeding with --force despite: ${reasons.join("; ")}`);
  }
}

let totalBefore = 0;
let totalAfter = 0;
let totalMoved = 0;
let failures = 0;

for (const storePath of findStores()) {
  const beforeBytes = fs.statSync(storePath).size;
  let store;
  // Retain the exact bytes read, so the replace step can prove the live file
  // is still the generation this migration was computed from.
  let sourceRaw;
  try {
    sourceRaw = fs.readFileSync(storePath, "utf-8");
    store = JSON.parse(sourceRaw);
  } catch (err) {
    console.error(`[skip] ${storePath}: unreadable (${err.message})`);
    failures += 1;
    continue;
  }
  if (!store || typeof store !== "object") {
    continue;
  }

  const inline = Object.entries(store).filter(([, e]) => e && e.skillsSnapshot);
  if (inline.length === 0) {
    continue;
  }

  // Snapshot the originals so the verification pass compares against what was
  // actually on disk, not against anything the rewrite produced.
  const originals = new Map(inline.map(([key, entry]) => [key, entry.skillsSnapshot]));
  const distinct = new Set(inline.map(([, e]) => sha256(canonicalJson(e.skillsSnapshot))));
  const inlineBytes = inline.reduce(
    (sum, [, e]) => sum + canonicalJson(e.skillsSnapshot).length,
    0,
  );

  console.log(
    `\n${storePath}\n  ${(beforeBytes / 1e6).toFixed(1)} MB, ${Object.keys(store).length} entries, ` +
      `${inline.length} inline snapshots (${(inlineBytes / 1e6).toFixed(1)} MB) across ` +
      `${distinct.size} distinct value(s)`,
  );

  if (!APPLY) {
    console.log(
      `  would write ${distinct.size} blob(s) and reclaim ~${(inlineBytes / 1e6).toFixed(1)} MB`,
    );
    totalBefore += beforeBytes;
    totalAfter += beforeBytes - inlineBytes;
    totalMoved += inline.length;
    continue;
  }

  // Publish the backup durably before touching the live file: an fsync'd
  // backup is the only thing that makes the replace recoverable.
  // One acquisition, one release. Everything between them runs inside
  // try/catch/finally: an exception from backup publication, mkdir, canonical
  // validation, blob publication, the temp write, the rename or a stat used
  // to leak `sessions.json.lock` and kill the entire run (reproduced by
  // placing a regular file at `skill-snapshots/`). Now a store can fail on
  // its own and the migration continues with the next one.
  let releaseLock;
  try {
    releaseLock = acquireStoreLock(storePath);
  } catch (err) {
    console.error(`  ABORTED - could not acquire ${storePath}.lock: ${err.message}`);
    failures += 1;
    continue;
  }

  let aborted = false;
  try {
    // Labeled block, not do/while(false): lets a per-store abort jump to the
    // finally that releases the lock without a constant loop condition.
    migrateStore: {
      // The byte comparison below is a fence *inside* the lock held above,
      // not a substitute for it: without the lock another writer can land
      // between the compare and the rename.
      const backupPath = `${storePath}.pre-skill-snapshot-migration.${Date.now()}`;
      {
        const fd = fs.openSync(backupPath, "w", 0o600);
        try {
          fs.writeFileSync(fd, sourceRaw, "utf-8");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        syncDirectory(path.dirname(backupPath));
      }

      const blobDir = path.join(path.dirname(storePath), SNAPSHOT_DIR_NAME);
      fs.mkdirSync(blobDir, { recursive: true });

      for (const [, entry] of inline) {
        // Enforce the canonicalization contract here, where provenance is
        // genuinely unknown (arbitrary on-disk registries), before the value
        // becomes a content address.
        assertCanonicalizable(entry.skillsSnapshot);
        const serialized = canonicalJson(entry.skillsSnapshot);
        const hash = sha256(serialized);
        const target = path.join(blobDir, `${hash}.json`);
        // An existing target is only reusable if its bytes really are this
        // snapshot; otherwise republish. Skipping on mere existence leaves a
        // corrupt blob in place and a loose 0644 one world-readable.
        let reusable = false;
        try {
          reusable = sha256(fs.readFileSync(target, "utf-8")) === hash;
        } catch {
          reusable = false;
        }
        if (reusable) {
          hardenExistingBlob(blobDir, target);
        } else {
          publishBlob(blobDir, target, serialized);
        }
        delete entry.skillsSnapshot;
        entry.skillsSnapshotRef = hash;
      }

      // Verify BEFORE replacing the live file: every ref must resolve to bytes
      // that deep-equal the snapshot that was there a moment ago.
      let verified = 0;
      const mismatches = [];
      for (const [key, entry] of Object.entries(store)) {
        if (!entry?.skillsSnapshotRef || !originals.has(key)) {
          continue;
        }
        const blob = path.join(blobDir, `${entry.skillsSnapshotRef}.json`);
        try {
          const raw = fs.readFileSync(blob, "utf-8");
          if (sha256(raw) !== entry.skillsSnapshotRef) {
            mismatches.push(`${key}: blob content does not match its hash`);
            continue;
          }
          if (!deepEqual(JSON.parse(raw), originals.get(key))) {
            mismatches.push(`${key}: resolved snapshot differs from the original`);
            continue;
          }
          verified += 1;
        } catch (err) {
          mismatches.push(`${key}: ${err.message}`);
        }
      }

      if (mismatches.length > 0 || verified !== inline.length) {
        console.error(
          `  ABORTED — verified ${verified}/${inline.length}; ${mismatches.length} problem(s):`,
        );
        for (const m of mismatches.slice(0, 5)) {
          console.error(`    ${m}`);
        }
        console.error(`  live file untouched; backup at ${backupPath}`);
        failures += 1;
        aborted = true;
        break migrateStore;
      }

      // Compare-and-swap on the source bytes. Blob verification proves the
      // transformed snapshots match the input; it does NOT prove the input is
      // still current. If anything wrote to the registry since it was read,
      // replacing it here would silently discard that write.
      let liveNow;
      try {
        liveNow = fs.readFileSync(storePath, "utf-8");
      } catch (err) {
        console.error(`  ABORTED — cannot re-read live registry: ${err.message}`);
        failures += 1;
        aborted = true;
        break migrateStore;
      }
      if (liveNow !== sourceRaw) {
        console.error(
          `  ABORTED — registry changed while migrating (a gateway or CLI wrote to it).\n` +
            `  Nothing was replaced; backup at ${backupPath}. Stop all writers and re-run.`,
        );
        failures += 1;
        aborted = true;
        break migrateStore;
      }

      const tmpStore = `${storePath}.${process.pid}.tmp`;
      {
        const fd = fs.openSync(tmpStore, "w", 0o600);
        try {
          fs.writeFileSync(fd, JSON.stringify(store, null, 2), "utf-8");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
      fs.renameSync(tmpStore, storePath);
      syncDirectory(path.dirname(storePath));

      const afterBytes = fs.statSync(storePath).size;
      console.log(
        `  migrated ${inline.length} snapshot(s) → ${distinct.size} blob(s); ` +
          `verified ${verified}/${inline.length} byte-identical\n` +
          `  ${(beforeBytes / 1e6).toFixed(1)} MB → ${(afterBytes / 1e6).toFixed(1)} MB ` +
          `(-${(100 * (1 - afterBytes / beforeBytes)).toFixed(0)}%)\n` +
          `  backup: ${backupPath}`,
      );
      totalBefore += beforeBytes;
      totalAfter += afterBytes;
      totalMoved += inline.length;
    }
  } catch (err) {
    console.error(`  ABORTED - ${storePath}: ${err.message}`);
    failures += 1;
    aborted = true;
  } finally {
    releaseLock();
  }
  if (aborted) {
    continue;
  }
}

console.log(
  `\n${APPLY ? "Migrated" : "Would migrate"} ${totalMoved} snapshot(s): ` +
    `${(totalBefore / 1e6).toFixed(1)} MB → ${(totalAfter / 1e6).toFixed(1)} MB` +
    (failures ? `; ${failures} file(s) failed` : ""),
);
if (!APPLY) {
  console.log("Dry run — re-run with --apply.");
}
process.exit(failures > 0 ? 1 : 0);
