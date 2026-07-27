// Deterministic tests for the generic focused-Vitest subprocess helper. These
// never spawn Vitest — they cover parser edge cases, redaction, and the
// fail-closed classifier options gating.

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVitestSummary,
  redactedTail,
  summarizeVitestResult,
} from "../lib/focused-vitest-runner.mjs";

test("parseVitestSummary returns null for empty and unrelated output", () => {
  assert.equal(parseVitestSummary(""), null);
  assert.equal(parseVitestSummary("nothing that resembles a summary"), null);
});

test("parseVitestSummary parses passing + skipped + failed segments", () => {
  const parsed = parseVitestSummary(
    "Test Files  3 passed (3)\nTests  1 failed | 20 passed | 1 skipped (22)\nDuration  2.4s",
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.files, { total: 3, passed: 3, failed: 0, skipped: 0 });
  assert.deepEqual(parsed.tests, { total: 22, passed: 20, failed: 1, skipped: 1 });
  assert.equal(parsed.durationMs, 2400);
});

test("redactedTail truncates long inputs to the tail slice", () => {
  // Use whitespace-separated content so the high-entropy blob redactor does
  // not collapse the whole slice — we only want to prove the tail is kept.
  const tail = redactedTail("prefix line ".repeat(500) + "TAIL_END", { maxChars: 80 });
  assert.ok(tail.length <= 80);
  assert.match(tail, /TAIL_END$/);
});

test("summarizeVitestResult throws when options are missing", () => {
  assert.throws(
    () =>
      summarizeVitestResult({
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
        durationMs: 0,
      }),
    /expectedFiles/,
  );
});

test("summarizeVitestResult throws when expectedFiles or minTests are not positive integers", () => {
  const base = { exitCode: 0, timedOut: false, stdout: "", stderr: "", durationMs: 0 };
  assert.throws(
    () => summarizeVitestResult(base, { expectedFiles: 0, minTests: 1 }),
    /expectedFiles/,
  );
  assert.throws(() => summarizeVitestResult(base, { expectedFiles: 1, minTests: -1 }), /minTests/);
  assert.throws(
    () => summarizeVitestResult(base, { expectedFiles: 1.5, minTests: 1 }),
    /expectedFiles/,
  );
});

test("summarizeVitestResult classifies spawn errors as fail with a redacted, bounded message", () => {
  const result = summarizeVitestResult(
    {
      exitCode: null,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      durationMs: 3,
      spawnError: { code: "ENOENT", message: "cannot find node under /home/marc/private/bin" },
    },
    { expectedFiles: 3, minTests: 21, suiteLabel: "test suite" },
  );
  assert.equal(result.status, "fail");
  assert.match(result.notes, /subprocess failed to spawn/);
  assert.match(result.notes, /ENOENT/);
  assert.doesNotMatch(result.notes, /\/home\/marc/);
});

test("summarizeVitestResult reports pass with the caller-supplied suite label", () => {
  const stdout = `
 Test Files  3 passed (3)
      Tests  21 passed (21)
   Duration  1.10s
`;
  const result = summarizeVitestResult(
    {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout,
      stderr: "",
      durationMs: 1100,
      spawnError: null,
    },
    { expectedFiles: 3, minTests: 21, suiteLabel: "Custom label" },
  );
  assert.equal(result.status, "pass");
  assert.match(result.notes, /Custom label passed 21\/21 tests across 3 files/);
});
