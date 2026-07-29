// Runner-recovery focused-behavior check.
//
// Runs a small set of deterministic Vitest files inside this repository — no
// pnpm, no corepack, no downloads. Together the four files cover:
//
//   * UM-28a — conservative empty-final-turn trigger and wrap-up prompt
//              shape/abort/yield handling in attempt.empty-final-turn tests.
//   * UM-24  — Codex context-overflow classification via
//              provider-error-patterns (context_length_exceeded,
//              "exceeds the context window", provider-specific overflow
//              phrases) and the pi-embedded-runner auto-compaction retry
//              loop / retry-limit invariants.
//
// The check ONLY passes when all four files are present and Vitest reports no
// skips/failures with at least MIN_FOCUSED_RUNNER_RECOVERY_TESTS tests.
//
// Deliberately NOT proven here: live transcript persistence, billing
// semantics, and duplicate-wrap-up idempotency (which UM-28b covers via a
// separate manual contract). These require a live provider / gateway and are
// outside the fail-closed, no-network scope of this check.

import {
  FOCUSED_RUNNER_RECOVERY_TEST_FILES,
  MIN_FOCUSED_RUNNER_RECOVERY_TESTS,
  runFocusedRunnerRecoverySuite,
} from "../lib/runner-recovery-suite.mjs";
import { defineCheck } from "../lib/runner.mjs";

const PROVEN_NOTE =
  "Proves: conservative empty-final trigger and wrap-up prompt behavior; " +
  "Codex context-overflow classification (context_length_exceeded, " +
  "'exceeds the context window', provider-specific patterns); " +
  "pi-embedded-runner auto-compaction retry loop with bounded retry limits. " +
  "Does NOT prove live transcript persistence, billing semantics, or " +
  "duplicate-wrap-up idempotency (see UM-28b manual contract).";

defineCheck({
  id: "runner-recovery.focused-behavior",
  name: `Focused runner-recovery Vitest suite proves conservative empty-final trigger and Codex overflow classification / auto-compaction retry (${FOCUSED_RUNNER_RECOVERY_TEST_FILES.length} files, >=${MIN_FOCUSED_RUNNER_RECOVERY_TESTS} tests)`,
  groups: ["streaming-cleanup", "history-recovery"],
  matrixIds: ["UM-28a", "UM-24"],
  kind: "behavior",
  automated: "auto",
  async run() {
    const result = await runFocusedRunnerRecoverySuite();
    const suiteNotes = typeof result.notes === "string" ? result.notes : "";
    const combined = suiteNotes ? `${suiteNotes} ${PROVEN_NOTE}` : PROVEN_NOTE;
    return { ...result, notes: combined };
  },
});
