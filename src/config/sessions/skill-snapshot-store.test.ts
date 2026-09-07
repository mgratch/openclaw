import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  clearSkillSnapshotCache,
  computeSkillSnapshotHash,
  dehydrateSkillSnapshotsForWrite,
  gcSkillSnapshotBlobs,
  hydrateSkillSnapshots,
  readSkillSnapshotBlob,
  skillSnapshotDir,
  verifySkillSnapshotBlobs,
  writeSkillSnapshotBlob,
} from "./skill-snapshot-store.js";
import type { SessionEntry, SessionSkillSnapshot } from "./types.js";

let tmpDir: string;
let storePath: string;

function snapshot(overrides: Partial<SessionSkillSnapshot> = {}): SessionSkillSnapshot {
  return {
    prompt: "<available_skills>demo</available_skills>",
    skills: [{ name: "demo", primaryEnv: "DEMO_KEY" }],
    resolvedSkills: [],
    version: 3,
    ...overrides,
  } as SessionSkillSnapshot;
}

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return { sessionId: "s1", updatedAt: 1, ...over } as SessionEntry;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-snap-"));
  storePath = path.join(tmpDir, "sessions.json");
  clearSkillSnapshotCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearSkillSnapshotCache();
});

describe("canonicalJson", () => {
  it("is stable across key insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("omits undefined values but preserves array order", () => {
    expect(canonicalJson({ a: undefined, b: [3, 1, 2] })).toBe('{"b":[3,1,2]}');
  });
});

describe("content addressing", () => {
  it("gives equal snapshots the same hash and differing ones different hashes", () => {
    expect(computeSkillSnapshotHash(snapshot())).toBe(computeSkillSnapshotHash(snapshot()));
    expect(computeSkillSnapshotHash(snapshot())).not.toBe(
      computeSkillSnapshotHash(snapshot({ version: 4 })),
    );
  });

  it("names each blob after the sha256 of its own bytes", () => {
    const hash = writeSkillSnapshotBlob(storePath, snapshot());
    const raw = fs.readFileSync(path.join(skillSnapshotDir(storePath), `${hash}.json`), "utf-8");
    expect(canonicalJson(JSON.parse(raw))).toBe(raw);
    expect(verifySkillSnapshotBlobs(storePath)).toEqual({ checked: 1, corrupt: [] });
  });

  it("round-trips a snapshot exactly", () => {
    const original = snapshot({ resolvedSkills: [{ name: "x" }] as never });
    const hash = writeSkillSnapshotBlob(storePath, original);
    clearSkillSnapshotCache();
    expect(readSkillSnapshotBlob(storePath, hash)).toEqual(original);
  });

  it("stores one blob for many identical snapshots", () => {
    const store: Record<string, SessionEntry> = {};
    for (let i = 0; i < 50; i++) {
      store[`agent:a:web-${i}`] = entry({ skillsSnapshot: snapshot() });
    }
    dehydrateSkillSnapshotsForWrite(store, storePath);
    expect(fs.readdirSync(skillSnapshotDir(storePath))).toHaveLength(1);
  });

  it("reports corruption when a blob's bytes no longer match its name", () => {
    const hash = writeSkillSnapshotBlob(storePath, snapshot());
    fs.writeFileSync(path.join(skillSnapshotDir(storePath), `${hash}.json`), '{"prompt":"x"}');
    expect(verifySkillSnapshotBlobs(storePath).corrupt).toEqual([hash]);
  });
});

describe("dehydrate/hydrate", () => {
  it("keeps the live store hydrated while stripping the serialized view", () => {
    const live: Record<string, SessionEntry> = { a: entry({ skillsSnapshot: snapshot() }) };
    const serializable = dehydrateSkillSnapshotsForWrite(live, storePath);

    expect(serializable.a.skillsSnapshot).toBeUndefined();
    expect(serializable.a.skillsSnapshotRef).toMatch(/^[0-9a-f]{64}$/);
    // Callers keep using the in-memory entry after a save; stripping it there
    // would make the next read look like a missing snapshot and recapture.
    expect(live.a.skillsSnapshot).toEqual(snapshot());
  });

  it("restores the snapshot on load", () => {
    const serializable = dehydrateSkillSnapshotsForWrite(
      { a: entry({ skillsSnapshot: snapshot() }) },
      storePath,
    );
    const reloaded = JSON.parse(JSON.stringify(serializable)) as Record<string, SessionEntry>;
    clearSkillSnapshotCache();

    hydrateSkillSnapshots(reloaded, storePath);
    expect(reloaded.a.skillsSnapshot).toEqual(snapshot());
  });

  it("shares one object across entries instead of copying per session", () => {
    const store: Record<string, SessionEntry> = {
      a: entry({ skillsSnapshot: snapshot() }),
      b: entry({ skillsSnapshot: snapshot() }),
    };
    const reloaded = JSON.parse(
      JSON.stringify(dehydrateSkillSnapshotsForWrite(store, storePath)),
    ) as Record<string, SessionEntry>;
    clearSkillSnapshotCache();
    hydrateSkillSnapshots(reloaded, storePath);
    expect(reloaded.a.skillsSnapshot).toBe(reloaded.b.skillsSnapshot);
  });

  it("leaves legacy inline snapshots readable and migrates them on write", () => {
    const legacy: Record<string, SessionEntry> = { a: entry({ skillsSnapshot: snapshot() }) };
    hydrateSkillSnapshots(legacy, storePath); // no ref: must not clobber
    expect(legacy.a.skillsSnapshot).toEqual(snapshot());
    expect(dehydrateSkillSnapshotsForWrite(legacy, storePath).a.skillsSnapshotRef).toBeTruthy();
  });

  it("treats a missing blob as a missing snapshot so the next turn recaptures", () => {
    const reloaded: Record<string, SessionEntry> = {
      a: entry({ skillsSnapshotRef: "0".repeat(64) }),
    };
    hydrateSkillSnapshots(reloaded, storePath);
    expect(reloaded.a.skillsSnapshot).toBeUndefined();
  });

  it("is idempotent", () => {
    const store: Record<string, SessionEntry> = { a: entry({ skillsSnapshot: snapshot() }) };
    const once = dehydrateSkillSnapshotsForWrite(store, storePath);
    const twice = dehydrateSkillSnapshotsForWrite(once, storePath);
    expect(twice.a.skillsSnapshotRef).toBe(once.a.skillsSnapshotRef);
    hydrateSkillSnapshots(once, storePath);
    hydrateSkillSnapshots(once, storePath);
    expect(once.a.skillsSnapshot).toEqual(snapshot());
  });

  it("returns the original store object when there is nothing to dehydrate", () => {
    const store: Record<string, SessionEntry> = { a: entry() };
    expect(dehydrateSkillSnapshotsForWrite(store, storePath)).toBe(store);
  });
});

describe("gc", () => {
  it("keeps referenced blobs and young unreferenced ones", () => {
    const referenced = writeSkillSnapshotBlob(storePath, snapshot());
    writeSkillSnapshotBlob(storePath, snapshot({ version: 99 }));
    const store: Record<string, SessionEntry> = {
      a: entry({ skillsSnapshotRef: referenced }),
    };

    // Young unreferenced blob survives: a concurrent writer may not have
    // committed its ref yet.
    expect(gcSkillSnapshotBlobs({ store, storePath })).toEqual({ deleted: 0, kept: 2 });

    const res = gcSkillSnapshotBlobs({ store, storePath, minAgeMs: 0, now: Date.now() + 1000 });
    expect(res).toEqual({ deleted: 1, kept: 1 });
    expect(fs.existsSync(path.join(skillSnapshotDir(storePath), `${referenced}.json`))).toBe(true);
  });

  it("treats an inline snapshot as a reference", () => {
    const hash = writeSkillSnapshotBlob(storePath, snapshot());
    const store: Record<string, SessionEntry> = { a: entry({ skillsSnapshot: snapshot() }) };
    gcSkillSnapshotBlobs({ store, storePath, minAgeMs: 0, now: Date.now() + 1000 });
    expect(fs.existsSync(path.join(skillSnapshotDir(storePath), `${hash}.json`))).toBe(true);
  });
});
