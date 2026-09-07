import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs helper shared with scripts/, no type decls
import {
  assertCanonicalizable,
  canonicalJson as scriptCanonicalJson,
} from "../../../scripts/lib/canonical-json.mjs";
import { canonicalJson as tsCanonicalJson } from "./skill-snapshot-store.js";

/**
 * The migration script and the gateway each canonicalize snapshots to
 * produce the SHA-256 that becomes a blob's file name. If the two
 * implementations ever drift, a snapshot migrated by the script hashes
 * differently than the same snapshot written by the gateway, and refs
 * written by one side become unresolvable by the other. These vectors pin
 * them together.
 */
const VECTORS: unknown[] = [
  null,
  0,
  -1.5,
  "",
  "plain",
  "unicode: é 🦞 中文",
  'quotes " and \\ backslash \n newline',
  true,
  [],
  [1, 2, 3],
  ["b", "a"],
  [{ b: 1, a: 2 }],
  {},
  { a: 1, b: 2 },
  { b: 2, a: 1 },
  { z: [1, { y: 2, x: 3 }], a: { d: 4, c: 5 } },
  { present: 1, absent: undefined },
  { nested: { deep: { deeper: [{ k: "v" }] } } },
  // Shape of a real snapshot.
  {
    version: 3,
    prompt: "<available_skills>…</available_skills>",
    skills: [{ name: "demo", primaryEnv: "KEY", requiredEnv: ["A", "B"] }],
    resolvedSkills: [{ name: "demo", description: "does things" }],
  },
];

describe("canonicalJson parity between TypeScript and scripts/", () => {
  it.each(VECTORS.map((v, i) => [i, v] as const))("vector %i matches", (_i, value) => {
    expect(tsCanonicalJson(value)).toBe(scriptCanonicalJson(value));
  });

  it("produces identical hashes for the snapshot shape", () => {
    const snapshot = VECTORS[VECTORS.length - 1];
    const hash = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
    expect(hash(tsCanonicalJson(snapshot))).toBe(hash(scriptCanonicalJson(snapshot)));
  });

  it("is insensitive to key insertion order but sensitive to values", () => {
    expect(tsCanonicalJson({ a: 1, b: 2 })).toBe(tsCanonicalJson({ b: 2, a: 1 }));
    expect(tsCanonicalJson({ a: 1 })).not.toBe(tsCanonicalJson({ a: 2 }));
  });
});

describe("assertCanonicalizable", () => {
  it("accepts everything JSON.parse can produce", () => {
    for (const v of VECTORS) {
      expect(() => assertCanonicalizable(JSON.parse(JSON.stringify(v ?? null)))).not.toThrow();
    }
  });

  it("rejects sparse arrays, which would hash the same as a dense one", () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(() => assertCanonicalizable([1, , 3])).toThrow(/sparse/);
    // eslint-disable-next-line no-sparse-arrays -- the hole is the subject
    expect(() => assertCanonicalizable([, ,])).toThrow(/sparse/);
  });

  it("rejects values outside the JSON contract", () => {
    expect(() => assertCanonicalizable(Number.NaN)).toThrow(/non-finite/);
    expect(() => assertCanonicalizable(() => {})).toThrow(/not JSON-representable/);
    expect(() => assertCanonicalizable(new Map())).toThrow(/plain objects/);
  });
});
