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

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const FORCE = argv.includes("--force");
const storeArgIdx = argv.indexOf("--store");
const EXPLICIT_STORE = storeArgIdx >= 0 ? argv[storeArgIdx + 1] : undefined;

const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, ".openclaw", "agents");
const SNAPSHOT_DIR_NAME = "skill-snapshots";

/** Mirror of canonicalJson() in src/config/sessions/skill-snapshot-store.ts. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function gatewayIsRunning() {
  try {
    const out = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").some((n) => n.trim() === "openclaw-gateway");
  } catch {
    return false;
  }
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

let totalBefore = 0;
let totalAfter = 0;
let totalMoved = 0;
let failures = 0;

for (const storePath of findStores()) {
  const beforeBytes = fs.statSync(storePath).size;
  let store;
  try {
    store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
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

  const backupPath = `${storePath}.pre-skill-snapshot-migration.${Date.now()}`;
  fs.copyFileSync(storePath, backupPath);

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

  const tmpStore = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpStore, JSON.stringify(store, null, 2), { mode: 0o600 });
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

if (APPLY && gatewayIsRunning() && !FORCE) {
  console.error(
    "\nWARNING: openclaw-gateway is running. If it predates skillsSnapshotRef support " +
      "it will recapture snapshots and re-inline them. Deploy the new code first.",
  );
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
