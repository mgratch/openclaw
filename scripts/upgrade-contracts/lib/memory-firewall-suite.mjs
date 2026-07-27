// Helpers for the memory-firewall.isolated-suite-behavior check.
//
// This module now composes the generic focused-Vitest subprocess helper
// (`focused-vitest-runner.mjs`) rather than owning the parser, redactor, and
// classifier itself. Behavior is unchanged — the exact set of files, the
// minimum test count, and the exported names are all preserved so the
// existing memory-firewall check + tests keep working.
//
// Evidence-safety contract (unchanged):
//   * Never returns env values or full stdout/stderr.
//   * Truncates any tail to a small bounded length.
//   * Runs the redactor over any user-visible string.

import {
  parseVitestSummary as parseVitestSummaryGeneric,
  redactedTail as redactedTailGeneric,
  summarizeVitestResult as summarizeVitestResultGeneric,
} from "./focused-vitest-runner.mjs";

/** Exact set of focused-memory tests. Frozen so accidental mutation cannot silently drop coverage. */
export const FOCUSED_MEMORY_TEST_FILES = Object.freeze([
  "extensions/memory-lancedb/index.test.ts",
  "extensions/memory-lancedb/project-firewall.test.ts",
  "extensions/memory-lancedb/lancedb-runtime.test.ts",
]);

/** Minimum tests that must pass in the focused-memory Vitest run. */
export const MIN_FOCUSED_MEMORY_TESTS = 28;

/** Free-form label used inside the passing note. */
const MEMORY_SUITE_LABEL = "Focused memory suite";

export function parseVitestSummary(stdoutRaw) {
  return parseVitestSummaryGeneric(stdoutRaw);
}

export function redactedTail(text, options) {
  return redactedTailGeneric(text, options);
}

/**
 * Classify the outcome of the focused-memory subprocess run into a check
 * result shape. Kept as a single-argument function so the existing check
 * module and tests continue to work without modification.
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
  return summarizeVitestResultGeneric(result, {
    expectedFiles: FOCUSED_MEMORY_TEST_FILES.length,
    minTests: MIN_FOCUSED_MEMORY_TESTS,
    suiteLabel: MEMORY_SUITE_LABEL,
  });
}
