/**
 * Classification of run-abort reasons for user-facing error surfacing.
 *
 * Aborted provider streams resolve with stopReason "aborted" and carry the
 * abort reason (when one was passed) as the assistant errorMessage. The
 * lifecycle end handler attaches `aborted: true` to the end event so the
 * gateway can broadcast a chat error for DISRUPTIVE aborts (gateway restart
 * drain kills, unexplained aborts) — but expected control-flow aborts
 * (sessions_yield, queue interrupts, model switches, session resets) must
 * stay silent or every yield paints a spurious "Run aborted" error card
 * (observed 2026-08-06 on web-2fc54d97 right after a sessions_yield).
 *
 * The reason text is the only transport that survives the provider stream
 * (Error objects don't reach the lifecycle handler), so this classifier is
 * prefix-based against the reason strings used at the abort call sites:
 * get-reply-run.ts, live-model-switch.ts, subagent-control.ts,
 * session-reset-service.ts, server-methods/sessions.ts, commands-compact.ts,
 * commands-session-abort.ts, reply/abort.ts, gateway/chat-abort.ts,
 * cli/gateway-cli/run-loop.ts. Keep this list in sync when adding reasons.
 * Unknown or empty reasons classify as DISRUPTIVE — silence is the failure
 * mode we never want to repeat.
 */
const BENIGN_ABORT_REASON_PREFIXES = [
  "sessions_yield",
  "aborted by user",
  "interrupted by a new inbound message",
  "switching model to",
  "subagent killed",
  "subagent steered",
  "session reset requested",
  "manual compaction requested",
] as const;

/**
 * True when an abort reason represents expected control flow that should NOT
 * surface as a run error to chat clients. Empty/unknown reasons return false
 * (treated as disruptive).
 */
export function isBenignAbortReasonText(reason: string | null | undefined): boolean {
  const text = reason?.trim().toLowerCase();
  if (!text) {
    return false;
  }
  return BENIGN_ABORT_REASON_PREFIXES.some((prefix) => text.startsWith(prefix));
}
