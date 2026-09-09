/**
 * Empty-final-turn recovery.
 *
 * Incident: web-5a60fa8b (and recurring) — the model ran tools, finished
 * successfully, but emitted no final text part. The subscription's
 * `assistantTexts` array stayed empty, so no assistant row was persisted to
 * `conversations.db` / `ui-transcripts/*.jsonl`, and the openclaw-ui spinner
 * hung forever because nothing in the chat marked the turn complete with a
 * visible reply.
 *
 * Fix: detect the "did work but never spoke" condition at the end of an
 * attempt and, exactly once per attempt, send the model a short wrap-up
 * continuation asking it to summarize what it did. Reuses
 * `activeSession.prompt(...)` so the same provider-agnostic streaming,
 * tool-result, hook, and chat-message persistence pipeline carries the
 * recovered text — no parallel wiring per provider.
 *
 * The trigger predicate is intentionally conservative (Marc: "when we are
 * certain it's done but hasn't announced it") — it only fires when the
 * attempt was a real success that produced tool work but no text:
 *   - !aborted, !yieldAborted, !promptError, !timedOutDuringCompaction
 *   - no Codex/OpenResponses handoff in flight (clientToolCall / yield)
 *   - assistantTexts empty (no text part emitted)
 *   - toolMetas non-empty (did real work)
 *   - messagesSnapshot grew beyond prePromptMessageCount
 */

export const WRAP_UP_PROMPT =
  "Your tool calls completed successfully, but you ended the turn without sending a reply to the user. " +
  "Please send a one or two sentence summary of what you accomplished so the user has a final response. " +
  "Do not call any more tools.";

export type EmptyFinalTurnPredicateInput = {
  aborted: boolean;
  yieldAborted: boolean;
  promptError: unknown;
  timedOutDuringCompaction: boolean;
  clientToolCallDetected: { name: string; params: Record<string, unknown> } | null;
  yieldDetected: boolean;
  assistantTextsLength: number;
  toolMetasLength: number;
  messagesSnapshotLength: number;
  prePromptMessageCount: number;
};

/**
 * Pure predicate: did this attempt succeed at running tools but produce
 * no final assistant text? Pulled out as a stand-alone function so the
 * test suite can pin the trigger conditions without booting a real
 * session.
 */
export function shouldAttemptEmptyFinalTurnRetry(input: EmptyFinalTurnPredicateInput): boolean {
  if (input.aborted) {
    return false;
  }
  if (input.yieldAborted) {
    return false;
  }
  if (input.promptError) {
    return false;
  }
  if (input.timedOutDuringCompaction) {
    return false;
  }
  if (input.clientToolCallDetected) {
    return false;
  }
  if (input.yieldDetected) {
    return false;
  }
  if (input.assistantTextsLength !== 0) {
    return false;
  }
  if (input.toolMetasLength <= 0) {
    return false;
  }
  if (input.messagesSnapshotLength <= input.prePromptMessageCount) {
    return false;
  }
  return true;
}
