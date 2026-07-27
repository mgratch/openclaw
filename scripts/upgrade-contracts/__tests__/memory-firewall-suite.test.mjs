// Deterministic tests for the memory-firewall subprocess helper. These never
// invoke Vitest directly — they exercise the parser and result classifier so
// evidence shape and pass/fail decisions are covered without spinning up the
// child process every time.

import assert from "node:assert/strict";
import test from "node:test";
import {
  FOCUSED_MEMORY_TEST_FILES,
  MIN_FOCUSED_MEMORY_TESTS,
  parseVitestSummary,
  redactedTail,
  summarizeVitestResult,
} from "../lib/memory-firewall-suite.mjs";

const PASSING_SUMMARY = `
 RUN  v4.1.6 /mnt/host-projects/openclaw--openclaw

 ✓ extensions/memory-lancedb/index.test.ts (26)
 ✓ extensions/memory-lancedb/project-firewall.test.ts (1)
 ✓ extensions/memory-lancedb/lancedb-runtime.test.ts (1)

 Test Files  3 passed (3)
      Tests  28 passed (28)
   Start at  18:57:44
   Duration  20.67s (transform 4.32s, setup 58.39s, import 198ms, tests 1.93s, environment 0ms)
`;

const FAILING_SUMMARY = `
 RUN  v4.1.6 /mnt/host-projects/openclaw--openclaw

 FAIL  extensions/memory-lancedb/project-firewall.test.ts > ...
AssertionError: expected 1 to equal 0

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 27 passed (28)
   Start at  18:57:44
   Duration  17.99s
`;

test("FOCUSED_MEMORY_TEST_FILES is the exact deterministic list expected by the harness", () => {
  assert.deepEqual(
    [...FOCUSED_MEMORY_TEST_FILES],
    [
      "extensions/memory-lancedb/index.test.ts",
      "extensions/memory-lancedb/project-firewall.test.ts",
      "extensions/memory-lancedb/lancedb-runtime.test.ts",
    ],
  );
  // The list is frozen so accidental mutation cannot silently drop coverage.
  assert.throws(() => {
    FOCUSED_MEMORY_TEST_FILES.push("extensions/other.test.ts");
  });
});

test("parseVitestSummary extracts pass counts, totals, and duration on a green run", () => {
  const parsed = parseVitestSummary(PASSING_SUMMARY);
  assert.ok(parsed);
  assert.deepEqual(parsed.files, { total: 3, passed: 3, failed: 0, skipped: 0 });
  assert.deepEqual(parsed.tests, { total: 28, passed: 28, failed: 0, skipped: 0 });
  assert.equal(parsed.durationMs, 20670);
});

test("parseVitestSummary extracts mixed failure counts", () => {
  const parsed = parseVitestSummary(FAILING_SUMMARY);
  assert.ok(parsed);
  assert.deepEqual(parsed.files, { total: 3, passed: 2, failed: 1, skipped: 0 });
  assert.deepEqual(parsed.tests, { total: 28, passed: 27, failed: 1, skipped: 0 });
  assert.equal(parsed.durationMs, 17990);
});

test("parseVitestSummary returns null when neither summary line is present", () => {
  assert.equal(parseVitestSummary(""), null);
  assert.equal(parseVitestSummary("something else entirely"), null);
});

test("parseVitestSummary tolerates ANSI color codes", () => {
  const ansi =
    "\x1b[32m Test Files\x1b[0m  \x1b[32m3 passed\x1b[0m (3)\n\x1b[32m      Tests\x1b[0m  \x1b[32m28 passed\x1b[0m (28)\n   Duration  1.50s";
  const parsed = parseVitestSummary(ansi);
  assert.ok(parsed);
  assert.equal(parsed.files.total, 3);
  assert.equal(parsed.tests.total, 28);
  assert.equal(parsed.durationMs, 1500);
});

test("redactedTail collapses absolute host paths and truncates to bounded length", () => {
  const tail = redactedTail(
    "/mnt/host-projects/openclaw--openclaw/extensions/memory-lancedb/x.ts fail",
    {
      maxChars: 200,
    },
  );
  assert.match(tail, /redacted-path/);
  assert.ok(!tail.includes("/mnt/host-projects/openclaw--openclaw/extensions"));
});

test("redactedTail keeps only the trailing slice when input exceeds maxChars", () => {
  // Use content that will not trip the high-entropy blob redactor so the
  // trimmed slice is stable and easy to assert against.
  const long = "prefix line ".repeat(500) + "TAIL_END";
  const tail = redactedTail(long, { maxChars: 80 });
  // Redaction can compress the slice, so bound the length rather than asserting
  // an exact size — but require the trailing "TAIL_END" marker to be preserved
  // (proves we took the tail, not the head).
  assert.ok(tail.length <= 80);
  assert.match(tail, /TAIL_END$/);
});

test("redactedTail returns empty string for empty input", () => {
  assert.equal(redactedTail(""), "");
  assert.equal(redactedTail(null), "");
  assert.equal(redactedTail(undefined), "");
});

test("summarizeVitestResult reports pass on a green run", () => {
  const result = summarizeVitestResult({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: PASSING_SUMMARY,
    stderr: "",
    durationMs: 21000,
    spawnError: null,
  });
  assert.equal(result.status, "pass");
  assert.match(result.notes, /Focused memory suite passed 28\/28/);
  const labels = Object.fromEntries(result.evidence.map((e) => [e.label, e.value]));
  assert.equal(labels["exit code"], 0);
  assert.equal(labels["timed out"], false);
  assert.equal(labels["test files"], "3/3 passed");
  assert.equal(labels.tests, "28/28 passed");
});

test("summarizeVitestResult refuses incomplete or skipped green summaries", () => {
  const base = {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  };
  const missingFile = summarizeVitestResult({
    ...base,
    stdout: "Test Files  2 passed (2)\nTests  28 passed (28)\nDuration  1.0s",
  });
  assert.equal(missingFile.status, "fail");
  assert.match(missingFile.notes, /2\/3 required files/);

  const tooFewTests = summarizeVitestResult({
    ...base,
    stdout: `Test Files  3 passed (3)\nTests  ${MIN_FOCUSED_MEMORY_TESTS - 1} passed (${MIN_FOCUSED_MEMORY_TESTS - 1})\nDuration  1.0s`,
  });
  assert.equal(tooFewTests.status, "fail");
  assert.match(tooFewTests.notes, /require at least/);

  const skipped = summarizeVitestResult({
    ...base,
    stdout: "Test Files  3 passed (3)\nTests  1 skipped | 28 passed (29)\nDuration  1.0s",
  });
  assert.equal(skipped.status, "fail");
  assert.match(skipped.notes, /none skipped/);
});

test("summarizeVitestResult reports fail with redacted tail when vitest exits non-zero", () => {
  const stderr = "boom failure at /home/marc/openclaw/extensions/memory-lancedb/foo.ts:1";
  const result = summarizeVitestResult({
    exitCode: 1,
    signal: null,
    timedOut: false,
    stdout: FAILING_SUMMARY,
    stderr,
    durationMs: 18000,
    spawnError: null,
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /vitest exit 1/);
  assert.match(result.notes, /1\/28 tests failed/);
  assert.match(result.notes, /tail:/);
  // Ensure the tail actually redacted the /home path.
  assert.ok(!result.notes.includes("/home/marc/openclaw"));
});

test("summarizeVitestResult marks timeouts as fail with duration in the notes", () => {
  const result = summarizeVitestResult({
    exitCode: null,
    signal: "SIGTERM",
    timedOut: true,
    stdout: "",
    stderr: "",
    durationMs: 180000,
    spawnError: null,
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /timed out after 180000ms/);
});

test("summarizeVitestResult refuses to green-light unparseable output", () => {
  const result = summarizeVitestResult({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "nothing that resembles vitest output",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /summary was not parseable/);
});

test("summarizeVitestResult classifies spawn errors as fail and redacts their message", () => {
  const result = summarizeVitestResult({
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    durationMs: 5,
    spawnError: { code: "ENOENT", message: "pnpm not found under /home/alice/private/bin" },
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /subprocess failed to spawn/);
  assert.match(result.notes, /ENOENT/);
  assert.doesNotMatch(result.notes, /\/home\/alice/);
});

test("evidence never carries raw stdout, stderr, or env values", () => {
  const stderr = "OPENAI_API_KEY=sk-proj-verysecrettoken1234567890abcdefghij";
  const stdout = PASSING_SUMMARY + "\n" + stderr;
  const result = summarizeVitestResult({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr,
    durationMs: 21000,
    spawnError: null,
  });
  const serialized = JSON.stringify(result.evidence);
  assert.ok(!serialized.includes("sk-proj-"), "evidence must not include secrets");
  assert.ok(!serialized.includes("OPENAI_API_KEY"), "evidence must not include env var names");
  // The notes line on a pass is fixed and does not include the stdout tail.
  assert.ok(!result.notes.includes("sk-proj-"));
});
