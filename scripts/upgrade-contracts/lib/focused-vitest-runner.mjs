// Generic, fail-closed subprocess helper for running a small, focused set of
// Vitest files as an upgrade-contracts behavior check.
//
// Every behavior check that invokes Vitest as a subprocess must go through
// this module so that the evidence-safety contract stays uniform:
//
//   * execFile with a resolved binary + args array (never a shell string).
//   * shell: false, windowsHide: true, bounded timeout, bounded maxBuffer.
//   * Requires an EXACT number of test files to have run (mismatch = fail).
//   * Requires a MINIMUM number of tests to have passed (below = fail).
//   * Any skipped or failed test in the target set is a hard fail.
//   * Vitest summary must be parseable — an "exit 0 but unparseable output"
//     outcome is a hard fail, not a soft skip.
//   * Failure evidence carries at most a bounded, redacted tail. It NEVER
//     carries raw stdout/stderr, environment values, or spawn arguments.
//
// The helper deliberately DOES NOT choose which binary to run or which env to
// pass. Suite modules build those decisions themselves and hand this file a
// finished plan.

import { execFile } from "node:child_process";
import { redact } from "./redact.mjs";

/** Default upper bound on Vitest wall clock for a focused suite. */
export const DEFAULT_TIMEOUT_MS = 180_000;
/** Default maxBuffer for exec-collected stdout/stderr. */
export const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

const TEST_FILES_LINE = /Test Files\s+([^\n]+?)\((\d+)\)/;
const TESTS_LINE = /(?<!Test\s)Tests\s+([^\n]+?)\((\d+)\)/;
const DURATION_LINE = /Duration\s+([\d.]+)(m?s)\b/;

// Match ESC (U+001B) that begins CSI/SGR sequences without embedding a raw
// control character in source (oxlint's no-control-regex).
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
 * Parse Vitest's summary block. Returns null when neither the "Test Files"
 * nor the "Tests" line is present so callers can treat unparseable output as
 * a hard fail instead of a soft skip.
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
 * Vitest prints failure details near the end of stdout/stderr.
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
 * Classify the outcome of a completed subprocess run into a check-result
 * shape. Fail-closed on every non-green outcome.
 *
 * Options:
 *   expectedFiles   — exact number of test files that must have been run.
 *   minTests        — minimum number of tests that must have passed.
 *   suiteLabel      — free-form label used only in the notes string.
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
 * @param {{ expectedFiles: number, minTests: number, suiteLabel?: string }} options
 */
export function summarizeVitestResult(result, options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("summarizeVitestResult requires options { expectedFiles, minTests }");
  }
  const { expectedFiles, minTests, suiteLabel = "focused suite" } = options;
  if (!Number.isInteger(expectedFiles) || expectedFiles <= 0) {
    throw new TypeError("summarizeVitestResult expectedFiles must be a positive integer");
  }
  if (!Number.isInteger(minTests) || minTests <= 0) {
    throw new TypeError("summarizeVitestResult minTests must be a positive integer");
  }

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
    summary.tests.total < minTests ||
    summary.tests.passed !== summary.tests.total ||
    summary.tests.failed > 0 ||
    summary.tests.skipped > 0
  ) {
    return {
      status: "fail",
      evidence,
      notes: `vitest ran ${summary.tests.total} tests; require at least ${minTests}, all passing, none skipped (passed=${summary.tests.passed}, failed=${summary.tests.failed}, skipped=${summary.tests.skipped})`,
    };
  }

  return {
    status: "pass",
    evidence,
    notes: `${suiteLabel} passed ${summary.tests.passed}/${summary.tests.total} tests across ${summary.files?.total ?? "?"} files.`,
  };
}

/**
 * Run a Vitest subprocess directly via execFile and resolve to a structured
 * result. This helper never shells out or performs package installation; suite
 * modules must pass an already-resolved local executable/entrypoint rather than
 * a package-manager command that could download dependencies.
 *
 * The caller supplies:
 *   execPath     — the resolved binary or Node executable to spawn.
 *   args         — the exact argv array passed to that binary.
 *   cwd          — working directory for the subprocess.
 *   env          — environment for the subprocess (values NEVER captured
 *                  into evidence — the summarizer only reports counts).
 *   timeoutMs    — wall-clock upper bound.
 *   maxBuffer    — collector cap on combined stdout/stderr.
 *
 * @returns {Promise<{
 *   exitCode: number | null,
 *   signal: string | null,
 *   timedOut: boolean,
 *   stdout: string,
 *   stderr: string,
 *   durationMs: number,
 *   spawnError: { code?: string, message?: string } | null,
 * }>}
 */
export function runFocusedVitest({
  execPath,
  args,
  cwd,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBuffer = DEFAULT_MAX_BUFFER,
}) {
  if (typeof execPath !== "string" || execPath.length === 0) {
    throw new TypeError("runFocusedVitest requires a non-empty execPath string");
  }
  if (!Array.isArray(args)) {
    throw new TypeError("runFocusedVitest requires args to be an array");
  }
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new TypeError("runFocusedVitest requires a non-empty cwd");
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(
      execPath,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer,
        shell: false,
        windowsHide: true,
        env,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - started;
        const timedOut =
          (error?.killed === true && error?.signal === "SIGTERM") || error?.code === "ETIMEDOUT";
        let exitCode;
        if (timedOut) {
          exitCode = null;
        } else if (error && typeof error.code === "number") {
          exitCode = error.code;
        } else if (error) {
          exitCode = null;
        } else {
          exitCode = 0;
        }
        const signal = error?.signal ?? null;
        const spawnError =
          error && typeof error.code === "string" && error.errno !== undefined
            ? { code: error.code, message: error.message }
            : null;
        resolve({
          exitCode: typeof exitCode === "number" ? exitCode : (child.exitCode ?? null),
          signal,
          timedOut,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          durationMs,
          spawnError,
        });
      },
    );
  });
}
