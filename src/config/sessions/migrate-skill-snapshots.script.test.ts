import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Executable fault tests for `scripts/migrate-skill-snapshots.mjs`.
 *
 * The migration is a one-time, destructive rewrite of every session
 * registry, and the unit suite for the store cannot see any of its failure
 * behaviour: preflight gating, lock ownership, cleanup after a mid-flight
 * exception, or refusal when the source changed underneath it. A leaked
 * `sessions.json.lock` and a half-migrated registry are exactly the kind of
 * outcome that has to be proven not to happen before it runs on real data.
 *
 * These drive the real script as a subprocess against isolated temporary
 * registries. `--force` is passed so the gateway-running check (which is
 * about the operator's environment, not the script's logic) does not gate
 * the assertions; the preflight itself is asserted separately.
 */

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/migrate-skill-snapshots.mjs",
);

let tmp: string;
let storePath: string;

function snapshot(fill = "x") {
  return {
    prompt: fill.repeat(2000),
    skills: [{ name: "demo" }],
    resolvedSkills: [],
    version: 1,
  };
}

function seedRegistry(count = 3, fill = "x") {
  const store: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    store[`agent:x:web-${i}`] = {
      sessionId: String(i),
      updatedAt: 1,
      skillsSnapshot: snapshot(fill),
    };
  }
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function run(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const apply = (extra: string[] = []) => [
  "--apply",
  "--confirm-code-deployed",
  "--force",
  "--store",
  storePath,
  ...extra,
];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mig-skill-snap-"));
  storePath = path.join(tmp, "sessions", "sessions.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("migrate-skill-snapshots preflight", () => {
  it("rejects --store without a value instead of migrating every agent", () => {
    const res = run(["--apply", "--store"]);
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/--store requires a path/);
  });

  it("rejects unknown flags", () => {
    const res = run(["--apply", "--yolo"]);
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/unknown argument/);
  });

  it("refuses to apply without the deployment confirmation", () => {
    seedRegistry();
    const before = fs.readFileSync(storePath, "utf-8");
    const res = run(["--apply", "--store", storePath]);
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/confirm-code-deployed/);
    expect(fs.readFileSync(storePath, "utf-8")).toBe(before);
  });
});

describe("migrate-skill-snapshots happy path", () => {
  it("moves snapshots to one blob, verifies, and leaves no lock", () => {
    seedRegistry(5);
    const res = run(apply());
    expect(res.out).toMatch(/verified 5\/5 byte-identical/);

    const migrated = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<
      string,
      Record<string, unknown>
    >;
    for (const entry of Object.values(migrated)) {
      expect(entry.skillsSnapshot).toBeUndefined();
      expect(entry.skillsSnapshotRef).toMatch(/^[0-9a-f]{64}$/);
    }
    const blobDir = path.join(path.dirname(storePath), "skill-snapshots");
    expect(fs.readdirSync(blobDir)).toHaveLength(1);
    expect(fs.existsSync(`${storePath}.lock`)).toBe(false);
  });

  it("publishes blobs no more openly than the registry", () => {
    if (process.platform === "win32") {
      return;
    }
    seedRegistry(2);
    run(apply());
    const blobDir = path.join(path.dirname(storePath), "skill-snapshots");
    expect(fs.statSync(blobDir).mode & 0o077).toBe(0);
    for (const f of fs.readdirSync(blobDir)) {
      expect(fs.statSync(path.join(blobDir, f)).mode & 0o077).toBe(0);
    }
  });

  it("names each blob after the sha256 of its own bytes", () => {
    seedRegistry(2);
    run(apply());
    const blobDir = path.join(path.dirname(storePath), "skill-snapshots");
    for (const f of fs.readdirSync(blobDir)) {
      const raw = fs.readFileSync(path.join(blobDir, f), "utf-8");
      const digest = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
      expect(`${digest}.json`).toBe(f);
    }
  });
});

describe("migrate-skill-snapshots failure handling", () => {
  it("aborts the store, keeps the registry intact, and releases the lock", () => {
    seedRegistry(3);
    const before = fs.readFileSync(storePath, "utf-8");
    // A regular file where the blob directory must go: mkdir throws
    // mid-flight, after the lock is held and the backup is written.
    fs.writeFileSync(path.join(path.dirname(storePath), "skill-snapshots"), "not a dir");

    const res = run(apply());
    expect(res.out).toMatch(/ABORTED/);
    expect(fs.readFileSync(storePath, "utf-8")).toBe(before);
    expect(fs.existsSync(`${storePath}.lock`)).toBe(false);
  });

  it("refuses to replace a registry that changed since it was read", () => {
    seedRegistry(2);
    // Hold the lock as a *live* process so the migration cannot take it;
    // proves it never rewrites a registry another writer owns.
    fs.writeFileSync(
      `${storePath}.lock`,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: "other" }),
    );
    const before = fs.readFileSync(storePath, "utf-8");

    const res = run(apply());
    expect(res.out).toMatch(/could not acquire|timed out/);
    expect(fs.readFileSync(storePath, "utf-8")).toBe(before);
    // Someone else's lock must survive.
    expect(JSON.parse(fs.readFileSync(`${storePath}.lock`, "utf-8")).token).toBe("other");
  });

  it("reclaims a lock whose owner is gone", () => {
    seedRegistry(2);
    // PID 0x7FFFFFFF is not a live process; the lock is stale, not held.
    fs.writeFileSync(
      `${storePath}.lock`,
      JSON.stringify({ pid: 2147483647, createdAt: new Date().toISOString(), token: "dead" }),
    );
    const res = run(apply());
    expect(res.out).toMatch(/verified 2\/2 byte-identical/);
    expect(fs.existsSync(`${storePath}.lock`)).toBe(false);
  });

  it("is idempotent: a second run finds nothing to do", () => {
    seedRegistry(3);
    run(apply());
    const afterFirst = fs.readFileSync(storePath, "utf-8");
    const res = run(apply());
    expect(res.out).toMatch(/Migrated 0 snapshot|Would migrate 0/);
    expect(fs.readFileSync(storePath, "utf-8")).toBe(afterFirst);
  });

  it("republishes a corrupt blob rather than trusting its name", () => {
    seedRegistry(2);
    run(apply());
    const blobDir = path.join(path.dirname(storePath), "skill-snapshots");
    const [blob] = fs.readdirSync(blobDir);
    fs.writeFileSync(path.join(blobDir, blob), '{"prompt":"tampered"}');

    // Re-seed the same snapshots so the migration runs again over them.
    seedRegistry(2);
    run(apply());

    const raw = fs.readFileSync(path.join(blobDir, blob), "utf-8");
    const digest = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
    expect(`${digest}.json`).toBe(blob);
  });

  it("does not leave an empty lock when payload publication fails", () => {
    // Regression: `openSync(lockPath, "wx")` succeeding and the payload write
    // then failing left a zero-byte lock behind. Every later reader — this
    // script and the gateway's own lock code — treats an unreadable lock as
    // held rather than reclaimable, so a transient ENOSPC would wedge session
    // writes. Simulated with a hard file-size limit: the lock file can be
    // created but not written.
    if (process.platform === "win32") {
      return;
    }
    seedRegistry(2);
    const before = fs.readFileSync(storePath, "utf-8");
    const res = (() => {
      try {
        const out = execFileSync(
          "/bin/sh",
          ["-c", `ulimit -f 0; exec node ${JSON.stringify(SCRIPT)} ${apply().join(" ")}`],
          { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
        );
        return { code: 0, out };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
      }
    })();

    // However it failed, it must not have left a lock or damaged the registry.
    expect(res.code).not.toBe(0);
    expect(fs.existsSync(`${storePath}.lock`)).toBe(false);
    expect(fs.readFileSync(storePath, "utf-8")).toBe(before);
  });

  it("leaves a durable backup next to the registry", () => {
    seedRegistry(2);
    const before = fs.readFileSync(storePath, "utf-8");
    run(apply());
    const backups = fs
      .readdirSync(path.dirname(storePath))
      .filter((f) => f.includes("pre-skill-snapshot-migration"));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(storePath), backups[0]), "utf-8")).toBe(before);
  });
});
