import { describe, expect, it } from "vitest";
import {
  shouldAttemptEmptyFinalTurnRetry,
  WRAP_UP_PROMPT,
} from "./attempt.empty-final-turn.js";

/**
 * Pins the empty-final-turn predicate. The trigger has to be conservative
 * (per Marc, in the web-5a60fa8b incident: "when we are certain it's done but
 * hasn't announced it") — false positives here would force the model into an
 * extra round-trip after legitimate aborts, refusals, or no-op turns.
 */

const baseInput = () => ({
  aborted: false,
  yieldAborted: false,
  promptError: null as unknown,
  timedOutDuringCompaction: false,
  clientToolCallDetected: null as { name: string; params: Record<string, unknown> } | null,
  yieldDetected: false,
  assistantTextsLength: 0,
  toolMetasLength: 2,
  messagesSnapshotLength: 4,
  prePromptMessageCount: 2,
});

describe("shouldAttemptEmptyFinalTurnRetry", () => {
  it("fires when tools ran successfully and assistant produced no text", () => {
    expect(shouldAttemptEmptyFinalTurnRetry(baseInput())).toBe(true);
  });

  it("does not fire on user abort", () => {
    expect(shouldAttemptEmptyFinalTurnRetry({ ...baseInput(), aborted: true })).toBe(false);
  });

  it("does not fire on yield abort (sessions_yield clean stop)", () => {
    expect(shouldAttemptEmptyFinalTurnRetry({ ...baseInput(), yieldAborted: true })).toBe(false);
  });

  it("does not fire when the prompt errored", () => {
    expect(
      shouldAttemptEmptyFinalTurnRetry({
        ...baseInput(),
        promptError: new Error("LLM request failed"),
      }),
    ).toBe(false);
  });

  it("does not fire when compaction timed out (snapshot may be inconsistent)", () => {
    expect(
      shouldAttemptEmptyFinalTurnRetry({ ...baseInput(), timedOutDuringCompaction: true }),
    ).toBe(false);
  });

  it("does not fire when an OpenResponses client tool call is in flight (handoff, not silent finish)", () => {
    expect(
      shouldAttemptEmptyFinalTurnRetry({
        ...baseInput(),
        clientToolCallDetected: { name: "web_search", params: {} },
      }),
    ).toBe(false);
  });

  it("does not fire when sessions_yield was detected (handoff, not silent finish)", () => {
    expect(shouldAttemptEmptyFinalTurnRetry({ ...baseInput(), yieldDetected: true })).toBe(false);
  });

  it("does not fire when the model actually spoke", () => {
    expect(shouldAttemptEmptyFinalTurnRetry({ ...baseInput(), assistantTextsLength: 1 })).toBe(
      false,
    );
  });

  it("does not fire when no tools ran (would be a refusal or no-op turn)", () => {
    expect(shouldAttemptEmptyFinalTurnRetry({ ...baseInput(), toolMetasLength: 0 })).toBe(false);
  });

  it("does not fire when the session didn't grow (nothing actually happened)", () => {
    expect(
      shouldAttemptEmptyFinalTurnRetry({
        ...baseInput(),
        messagesSnapshotLength: 2,
        prePromptMessageCount: 2,
      }),
    ).toBe(false);
  });

  it("does not fire when session shrank — sanity check that snapshot capture didn't go backwards", () => {
    expect(
      shouldAttemptEmptyFinalTurnRetry({
        ...baseInput(),
        messagesSnapshotLength: 1,
        prePromptMessageCount: 2,
      }),
    ).toBe(false);
  });
});

describe("WRAP_UP_PROMPT", () => {
  // The prompt itself has to (a) be unambiguous about asking for a final reply
  // and (b) explicitly forbid more tool calls — otherwise the model might
  // re-tool and we'd just loop the same failure mode in the next attempt.
  it("asks for a final reply, not more tool calls", () => {
    expect(WRAP_UP_PROMPT).toMatch(/reply|summary|response/i);
    expect(WRAP_UP_PROMPT).toMatch(/do not call any more tools/i);
  });

  it("is short enough that it doesn't bloat the context", () => {
    expect(WRAP_UP_PROMPT.length).toBeLessThan(600);
  });
});
