// UI checkpoint focused-behavior check.
//
// Runs a small set of deterministic Vitest files inside the sibling UI
// checkpoint repository — no pnpm, no corepack, no downloads. Together the
// four files cover:
//
//   * UI-01  — model fallback ordering (arrow move, DnD-before, boundary,
//              drop-to-end).
//   * UI-02b — persisted fallback array order (setDefaultModel emits the
//              exact supplied fallback ordering to config.patch).
//   * UI-03a — tool completion correlation by toolCallId, preserving
//              interleaved system/newer messages and the original array.
//   * UI-03b — heartbeat/progress separation, bounded stale phases, terminal
//              cleanup, stale-tool reconciliation, and current-run tool counts.
//
// The check ONLY passes when all four files are present and Vitest reports no
// skips/failures with at least MIN_FOCUSED_UI_TESTS tests.

import { defineCheck } from "../lib/runner.mjs";
import {
  FOCUSED_UI_TEST_FILES,
  MIN_FOCUSED_UI_TESTS,
  runFocusedUiSuite,
} from "../lib/ui-checkpoint-suite.mjs";

defineCheck({
  id: "ui-checkpoint.focused-behavior",
  name: `Focused UI Vitest suite proves fallback ordering, toolCallId correlation, and run-lifecycle cleanup (${FOCUSED_UI_TEST_FILES.length} files, >=${MIN_FOCUSED_UI_TESTS} tests)`,
  groups: ["fallback-persistence", "model-provenance", "streaming-cleanup"],
  matrixIds: ["UI-01", "UI-02b", "UI-03a", "UI-03b"],
  kind: "behavior",
  requires: ["ui.checkpoint"],
  automated: "auto",
  async run() {
    return runFocusedUiSuite();
  },
});
