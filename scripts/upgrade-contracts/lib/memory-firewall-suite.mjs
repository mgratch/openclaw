// Helpers for the memory-firewall.isolated-suite-behavior check.
//
// This module owns the pure pieces so they can be unit-tested without invoking
// Vitest:
//
//   * FOCUSED_MEMORY_TEST_FILES — the exact set of test files the check runs.
//     Order is deterministic and stable; drift here must be caught by the
//     unit tests, not silently rewritten.
//   * parseVitestSummary — a defensive parser for the "Test Files" / "Tests" /
//     "Duration" lines. Returns null when the lines are absent so the check
//     can classify unparseable output as a soft evidence gap rather than
//     hard-failing an otherwise successful vitest run.
//   * redactedTail — trims and redacts subprocess output for evidence use;
//     the check never emits raw stdout/stderr into the report.
//   * summarizeVitestResult — decides pass/fail from an exec-style result
//     bundle. Kept out of the check body so that failure classification is
//     covered by deterministic tests.
//
// This helper deliberately does NOT run Vitest itself. The check module wires
// it up to execFile.
//
// Evidence-safety contract:
//   * Never returns env values or full stdout/stderr.
//   * Truncates any tail to a small bounded length.
//   * Runs the redactor over any user-visible string.

import { redact } from "./redact.mjs";

export const FOCUSED_MEMORY_TEST_FILES = Object.freeze([
  "extensions/memory-lancedb/index.test.ts",
  "extensions/memory-lancedb/project-firewall.test.ts",
  "extensions/memory-lancedb/lancedb-runtime.test.ts",
]);

export const MIN_FOCUSED_MEMORY_TESTS = 28;

const TEST_FILES_LINE = /Test Files\s+([^\n]+?)\((\d+)\)/;
const TESTS_LINE = /(?<!Test\s)Tests\s+([^\n]+?)\((\d+)\)/;
const DURATION_LINE = /Duration\s+([\d.]+)(m?s)\b/;

// Match the ESC (U+001B) that begins CSI/SGR sequences without embedding a raw
// control character in source (which oxlint's no-control-regex forbids).
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

function stripAnsi(input) {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(ANSI_ESCAPE, "");
}

function parsePassFailSegment(segment) {
  const passed = /(\d+)\s+passed/i.exec(segment);
  const failed = /(\d+)\s+failed/i.exec(segment);
  const skipped = /(\d+)\s+skipped/i.exec(segment);
  return {
    passed: passed ? Number(passed[1]) : 0,
    failed: failed ? Number(failed[1]) : 0,
    skipped: skipped ? Number(skipped[1]) : 0,
  };
}

/**
 * Parse the well-known Vitest summary lines out of stdout. Returns null when
 * the summary is not present at all (unparseable output). Individual
 * fields are numbers; total is the parenthesized count Vitest prints.
 */
export function parseVitestSummary(stdoutRaw) {
  const stdout = stripAnsi(String(stdoutRaw ?? ""));
  const filesMatch = TEST_FILES_LINE.exec(stdout);
  const testsMatch = TESTS_LINE.exec(stdout);
  if (!filesMatch && !testsMatch) {
    return null;
  }
  const files = filesMatch
    ? {
        total: Number(filesMatch[2]),
        ...parsePassFailSegment(filesMatch[1]),
      }
    : null;
  const tests = testsMatch
    ? {
        total: Number(testsMatch[2]),
        ...parsePassFailSegment(testsMatch[1]),
      }
    : null;
  const durationMatch = DURATION_LINE.exec(stdout);
  const durationMs = durationMatch
    ? Math.round(Number(durationMatch[1]) * (durationMatch[2] === "ms" ? 1 : 1000))
    : null;
  return { files, tests, durationMs };
}

/**
 * Redact + truncate a subprocess tail so it can safely land in a report.
 * Returns "" when the input is empty. The trailing slice is preferred because
 * Vitest prints the failure details near the end of stdout/stderr.
 */
export function redactedTail(text, { maxChars = 1200 } = {}) {
  const stripped = stripAnsi(String(text ?? ""));
  if (stripped.length === 0) {
    return "";
  }
  const slice = stripped.length > maxChars ? stripped.slice(-maxChars) : stripped;
  const redacted = redact(slice);
  return typeof redacted === "string" ? redacted : String(redacted);
}

function buildEvidence({ exitCode, timedOut, summary, durationMs }) {
  const evidence = [
    { label: "exit code", value: exitCode },
    { label: "timed out", value: Boolean(timedOut) },
    { label: "wall duration ms", value: durationMs },
    {
      label: "test files",
      value: summary?.files ? `${summary.files.passed}/${summary.files.total} passed` : "unparsed",
    },
    {
      label: "tests",
      value: summary?.tests ? `${summary.tests.passed}/${summary.tests.total} passed` : "unparsed",
    },
  ];
  if (summary?.durationMs != null) {
    evidence.push({ label: "vitest duration ms", value: summary.durationMs });
  }
  return evidence;
}

/**
 * Classify the outcome of the subprocess run into a check result shape.
 *
 * @param {{
 *   exitCode: number | null,
 *   signal: string | null,
 *   timedOut: boolean,
 *   stdout: string,
 *   stderr: string,
 *   durationMs: number,
 *   spawnError?: { code?: string, message?: string } | null,
 * }} result
 * @returns {{ status: "pass"|"fail", evidence: Array<{label: string, value: unknown}>, notes?: string }}
 */
export function summarizeVitestResult(result) {
  const summary = parseVitestSummary(result.stdout);
  const evidence = buildEvidence({
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    summary,
    durationMs: result.durationMs,
  });

  if (result.spawnError) {
    const safeMessage = redactedTail(result.spawnError.message ?? "", { maxChars: 400 });
    return {
      status: "fail",
      evidence,
      notes: `subprocess failed to spawn: ${result.spawnError.code ?? ""}${safeMessage ? ` — ${safeMessage}` : ""}`,
    };
  }

  if (result.timedOut) {
    const tail = redactedTail(result.stderr) || redactedTail(result.stdout);
    return {
      status: "fail",
      evidence,
      notes: `vitest timed out after ${result.durationMs}ms${tail ? ` — tail: ${tail}` : ""}`,
    };
  }

  if (result.exitCode !== 0) {
    const tail = redactedTail(result.stderr) || redactedTail(result.stdout);
    const noteParts = [`vitest exit ${result.exitCode ?? "null"}`];
    if (summary?.tests) {
      noteParts.push(`${summary.tests.failed}/${summary.tests.total} tests failed`);
    }
    if (tail) {
      noteParts.push(`tail: ${tail}`);
    }
    return {
      status: "fail",
      evidence,
      notes: noteParts.join(" — "),
    };
  }

  if (!summary || !summary.files || !summary.tests) {
    return {
      status: "fail",
      evidence,
      notes: "vitest exit 0 but summary was not parseable — refusing to green-light the suite",
    };
  }
  const expectedFiles = FOCUSED_MEMORY_TEST_FILES.length;
  if (
    summary.files.total !== expectedFiles ||
    summary.files.passed !== expectedFiles ||
    summary.files.failed > 0 ||
    summary.files.skipped > 0
  ) {
    return {
      status: "fail",
      evidence,
      notes: `vitest ran ${summary.files.total}/${expectedFiles} required files (${summary.files.passed} passed, ${summary.files.failed} failed, ${summary.files.skipped} skipped)`,
    };
  }
  if (
    summary.tests.total < MIN_FOCUSED_MEMORY_TESTS ||
    summary.tests.passed !== summary.tests.total ||
    summary.tests.failed > 0 ||
    summary.tests.skipped > 0
  ) {
    return {
      status: "fail",
      evidence,
      notes: `vitest ran ${summary.tests.total} tests; require at least ${MIN_FOCUSED_MEMORY_TESTS}, all passing, none skipped (passed=${summary.tests.passed}, failed=${summary.tests.failed}, skipped=${summary.tests.skipped})`,
    };
  }

  return {
    status: "pass",
    evidence,
    notes: `Focused memory suite passed ${summary.tests.passed}/${summary.tests.total} tests across ${summary.files?.total ?? "?"} files.`,
  };
}
