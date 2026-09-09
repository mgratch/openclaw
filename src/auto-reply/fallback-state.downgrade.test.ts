import { describe, expect, it } from "vitest";
import { buildFallbackNotice, isMeteredDowngrade } from "./fallback-state.js";
import type { RuntimeFallbackAttempt } from "./reply/agent-runner-execution.js";

function attempt(overrides: Partial<RuntimeFallbackAttempt> = {}): RuntimeFallbackAttempt {
  return {
    provider: "anthropic",
    model: "claude-opus-5",
    error: "skipped",
    ...overrides,
  };
}

describe("isMeteredDowngrade", () => {
  it("detects both metered skip reasons", () => {
    expect(isMeteredDowngrade([attempt({ reason: "metered_unapproved_headless" })])).toBe(true);
    expect(isMeteredDowngrade([attempt({ reason: "metered_denied" })])).toBe(true);
  });

  it("ignores ordinary provider faults", () => {
    // These are transient and the user can do nothing about them, so they stay
    // behind the verbose gate.
    expect(isMeteredDowngrade([attempt({ reason: "rate_limit" })])).toBe(false);
    expect(isMeteredDowngrade([attempt({ reason: "overloaded" })])).toBe(false);
    expect(isMeteredDowngrade([attempt({ reason: "timeout" })])).toBe(false);
    expect(isMeteredDowngrade([attempt({})])).toBe(false);
    expect(isMeteredDowngrade([])).toBe(false);
  });

  it("detects a metered skip anywhere in a mixed cascade", () => {
    expect(
      isMeteredDowngrade([
        attempt({ reason: "rate_limit" }),
        attempt({ reason: "metered_unapproved_headless" }),
      ]),
    ).toBe(true);
  });
});

describe("buildFallbackNotice", () => {
  const refs = {
    selectedProvider: "anthropic",
    selectedModel: "claude-opus-5",
    activeProvider: "claude-cli",
    activeModel: "claude-sonnet-5",
  };

  it("names both models and how to recover on a spend downgrade", () => {
    const notice = buildFallbackNotice({
      ...refs,
      attempts: [attempt({ reason: "metered_unapproved_headless" })],
    });
    expect(notice).toContain("Downgraded model");
    // The model actually used and the model that was skipped must BOTH appear,
    // otherwise the user cannot tell what to re-run.
    expect(notice).toContain("claude-sonnet-5");
    expect(notice).toContain("claude-opus-5");
    expect(notice).toContain("Re-run");
  });

  it("keeps the ordinary fallback wording for non-spend reasons", () => {
    const notice = buildFallbackNotice({ ...refs, attempts: [attempt({ reason: "rate_limit" })] });
    expect(notice).toContain("Model Fallback");
    expect(notice).not.toContain("Downgraded model");
  });

  it("returns null when nothing actually changed", () => {
    expect(
      buildFallbackNotice({
        selectedProvider: "anthropic",
        selectedModel: "claude-opus-5",
        activeProvider: "anthropic",
        activeModel: "claude-opus-5",
        attempts: [attempt({ reason: "metered_denied" })],
      }),
    ).toBeNull();
  });
});
