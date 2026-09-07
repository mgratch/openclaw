import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSkillSnapshotCache } from "./skill-snapshot-store.js";
import { loadSessionStore, saveSessionStore } from "./store.js";
import type { SessionEntry, SessionSkillSnapshot } from "./types.js";

/**
 * Registry-bloat invariant.
 *
 * The session registry is an INDEX: identity plus pointers. It is parsed in
 * full by `sessions.list`, so any large payload stored per entry multiplies
 * by the session count and turns a routine list into an event-loop stall.
 * A real deployment reached 64 MB / 870 sessions this way — 46.4 MB of it a
 * single 59 KB skills snapshot duplicated 731 times — which stalled
 * `sessions.list` for ~155 s, failed the Docker health check, and restarted
 * the gateway mid-run.
 *
 * These tests fail if a large payload is reintroduced inline. If one of them
 * breaks, do not raise the limit: move the payload into a content-addressed
 * side store (see skill-snapshot-store.ts) and reference it by hash.
 */

/** No single serialized entry should approach the size of a real payload. */
const MAX_ENTRY_BYTES = 4_096;
/** No identical payload should be storable more than a handful of times. */
const MAX_DUPLICATE_PAYLOADS = 3;

let tmpDir: string;
let storePath: string;

function bigSnapshot(): SessionSkillSnapshot {
  return {
    // Approximates a real catalog: ~59 KB of prompt + resolved skills.
    prompt: "<available_skills>".concat("x".repeat(40_000), "</available_skills>"),
    skills: Array.from({ length: 40 }, (_, i) => ({ name: `skill-${i}` })),
    resolvedSkills: Array.from({ length: 40 }, (_, i) => ({
      name: `skill-${i}`,
      description: "y".repeat(400),
    })) as never,
    version: 7,
  } as SessionSkillSnapshot;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bloat-"));
  storePath = path.join(tmpDir, "sessions.json");
  clearSkillSnapshotCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearSkillSnapshotCache();
});

/**
 * A payload that is NOT `skillsSnapshot`. The invariant must be about entry
 * size in general, not about the one field we happened to fix — otherwise a
 * future caller inlining, say, a rendered `systemPromptReport` (5.6 MB in
 * the deployment that motivated this work) sails straight past these tests.
 */
function entryWithForeignPayload(i: number): SessionEntry {
  return {
    sessionId: `s-${i}`,
    updatedAt: Date.now(),
    systemPromptReport: {
      source: "run",
      generatedAt: Date.now(),
      renderedPrompt: "z".repeat(30_000),
    },
  } as unknown as SessionEntry;
}

/** Entries whose serialized form exceeds the per-entry budget. */
function findBloatedEntries(registryPath: string): Array<readonly [string, number]> {
  const onDisk = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as Record<string, unknown>;
  return Object.entries(onDisk)
    .map(([key, entry]) => [key, JSON.stringify(entry).length] as const)
    .filter(([, bytes]) => bytes > MAX_ENTRY_BYTES);
}

describe("session registry bloat invariants", () => {
  it("size check is field-agnostic (detects a non-snapshot payload)", async () => {
    // Scope, stated plainly: this exercises the DETECTOR, it does not
    // prevent future bloat. A new large field added by some other caller
    // will not appear in these fixtures automatically, so it will not fail
    // here. What this pins is that the budget is about entry size in
    // general rather than about `skillsSnapshot` specifically — asserted
    // positively because `systemPromptReport` genuinely is still inlined
    // (see the skipped test below, which is the real gate once it moves).
    const store: Record<string, SessionEntry> = {};
    for (let i = 0; i < 10; i++) {
      store[`agent:openclaw:web-${i}`] = entryWithForeignPayload(i);
    }
    await saveSessionStore(storePath, store, { skipMaintenance: true });

    expect(findBloatedEntries(storePath).length).toBe(10);
  });

  // Known outstanding case, not a regression from the snapshot work:
  // `systemPromptReport` is stored inline and accounts for ~5.6 MB of the
  // production registry. It should move to the same content-addressed store
  // (or be dropped for inactive sessions); until it does, this stays
  // pending rather than silently absent.
  it.skip("stores systemPromptReport out of line as well", async () => {
    const store: Record<string, SessionEntry> = {};
    for (let i = 0; i < 10; i++) {
      store[`agent:openclaw:web-${i}`] = entryWithForeignPayload(i);
    }
    await saveSessionStore(storePath, store, { skipMaintenance: true });
    expect(findBloatedEntries(storePath)).toEqual([]);
  });

  it("keeps every serialized entry small even when sessions carry skill snapshots", async () => {
    const store: Record<string, SessionEntry> = {};
    for (let i = 0; i < 25; i++) {
      store[`agent:openclaw:web-${i}`] = {
        sessionId: `s-${i}`,
        updatedAt: Date.now(),
        skillsSnapshot: bigSnapshot(),
      } as SessionEntry;
    }
    await saveSessionStore(storePath, store, { skipMaintenance: true });

    const onDisk = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<string, unknown>;
    const oversized = Object.entries(onDisk)
      .map(([key, entry]) => [key, JSON.stringify(entry).length] as const)
      .filter(([, bytes]) => bytes > MAX_ENTRY_BYTES);

    expect(
      oversized,
      `Entries exceed ${MAX_ENTRY_BYTES} bytes. Move the payload to a content-addressed ` +
        `side store instead of raising this limit — see skill-snapshot-store.ts.`,
    ).toEqual([]);
  });

  it("never serializes the same payload more than a few times", async () => {
    const store: Record<string, SessionEntry> = {};
    for (let i = 0; i < 25; i++) {
      store[`agent:openclaw:web-${i}`] = {
        sessionId: `s-${i}`,
        updatedAt: Date.now(),
        skillsSnapshot: bigSnapshot(),
      } as SessionEntry;
    }
    await saveSessionStore(storePath, store, { skipMaintenance: true });

    const onDisk = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<
      string,
      Record<string, unknown>
    >;
    const counts = new Map<string, number>();
    for (const entry of Object.values(onDisk)) {
      for (const [field, value] of Object.entries(entry)) {
        if (value === null || value === undefined) {
          continue;
        }
        // Strings count too: a large repeated string payload (a prompt, a
        // rendered report) bloats the registry exactly like an object does.
        const serialized = typeof value === "string" ? value : JSON.stringify(value);
        if (serialized.length < 512) {
          continue;
        }
        const fingerprint = `${field}:${serialized}`;
        counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
      }
    }
    const duplicated = [...counts.entries()]
      .filter(([, n]) => n > MAX_DUPLICATE_PAYLOADS)
      .map(([fingerprint, n]) => [fingerprint.slice(0, fingerprint.indexOf(":")), n]);

    expect(
      duplicated,
      "A large payload is duplicated across entries. Store it once by content hash.",
    ).toEqual([]);
  });

  it("still returns the exact snapshot to consumers after the round trip", async () => {
    const original = bigSnapshot();
    await saveSessionStore(
      storePath,
      {
        "agent:openclaw:web-a": {
          sessionId: "a",
          updatedAt: Date.now(),
          skillsSnapshot: original,
        } as SessionEntry,
      },
      { skipMaintenance: true },
    );
    clearSkillSnapshotCache();

    const loaded = loadSessionStore(storePath, { skipCache: true });
    expect(loaded["agent:openclaw:web-a"]?.skillsSnapshot).toEqual(original);
  });

  it("keeps the registry roughly flat as identical-snapshot sessions are added", async () => {
    const build = async (count: number) => {
      const store: Record<string, SessionEntry> = {};
      for (let i = 0; i < count; i++) {
        store[`agent:openclaw:web-${i}`] = {
          sessionId: `s-${i}`,
          updatedAt: Date.now(),
          skillsSnapshot: bigSnapshot(),
        } as SessionEntry;
      }
      await saveSessionStore(storePath, store, { skipMaintenance: true });
      return fs.statSync(storePath).size;
    };

    const small = await build(10);
    const large = await build(100);
    const perSession = (large - small) / 90;

    // Inline storage would add ~59 KB per session; a ref adds ~100 bytes.
    expect(
      perSession,
      `Registry grew ${Math.round(perSession)} bytes per session; payloads are being inlined.`,
    ).toBeLessThan(512);
  });
});
