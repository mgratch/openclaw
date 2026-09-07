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

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertCanonicalizable, canonicalJson } from "./lib/canonical-json.mjs";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const FORCE = argv.includes("--force");
const storeArgIdx = argv.indexOf("--store");
const EXPLICIT_STORE = storeArgIdx >= 0 ? argv[storeArgIdx + 1] : undefined;

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
 * The installed code must already understand `skillsSnapshotRef`, otherwise
 * it treats a migrated entry as having no snapshot, recaptures, and writes
 * the inline blob straight back. Checking that some gateway is merely
 * stopped does not prove the new code is what will start next.
 */
function codeUnderstandsRefReason() {
  const source = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../src/config/sessions/skill-snapshot-store.ts",
  );
  if (!fs.existsSync(source)) {
    return `cannot find ${source} to confirm the deployed code supports skillsSnapshotRef`;
  }
  return null;
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
  const reasons = [blockingGatewayReason(), codeUnderstandsRefReason()].filter(Boolean);
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
  const backupPath = `${storePath}.pre-skill-snapshot-migration.${Date.now()}`;
  {
    const fd = fs.openSync(backupPath, "w", 0o600);
    try {
      fs.writeFileSync(fd, sourceRaw, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  const blobDir = path.join(path.dirname(storePath), SNAPSHOT_DIR_NAME);
  fs.mkdirSync(blobDir, { recursive: true });

  for (const [key, entry] of inline) {
    const serialized = canonicalJson(entry.skillsSnapshot);
    const hash = sha256(serialized);
    const target = path.join(blobDir, `${hash}.json`);
    if (!fs.existsSync(target)) {
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, serialized, "utf-8");
      fs.renameSync(tmp, target);
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
    continue;
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
    continue;
  }
  if (liveNow !== sourceRaw) {
    console.error(
      `  ABORTED — registry changed while migrating (a gateway or CLI wrote to it).\n` +
        `  Nothing was replaced; backup at ${backupPath}. Stop all writers and re-run.`,
    );
    failures += 1;
    continue;
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

console.log(
  `\n${APPLY ? "Migrated" : "Would migrate"} ${totalMoved} snapshot(s): ` +
    `${(totalBefore / 1e6).toFixed(1)} MB → ${(totalAfter / 1e6).toFixed(1)} MB` +
    (failures ? `; ${failures} file(s) failed` : ""),
);
if (!APPLY) {
  console.log("Dry run — re-run with --apply.");
}
process.exit(failures > 0 ? 1 : 0);
