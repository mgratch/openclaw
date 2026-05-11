import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLogger, setLoggerOverride } from "../../logging/logger.js";
import { logAuthProfileFailureStateChange } from "./state-observation.js";

afterEach(() => {
  setLoggerOverride(null);
  resetLogger();
});

describe("logAuthProfileFailureStateChange", () => {
  it("sanitizes consoleMessage fields before logging", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLoggerOverride({ level: "silent", consoleLevel: "warn" });

    logAuthProfileFailureStateChange({
      runId: "run-1\nforged\tentry\rtest",
      profileId: "openai:profile-1",
      provider: "openai\u001b]8;;https://evil.test\u0007",
      reason: "overloaded",
      previous: undefined,
      next: {
        errorCount: 1,
        cooldownUntil: 1_700_000_060_000,
        failureCounts: { overloaded: 1 },
      },
      now: 1_700_000_000_000,
    });

    const consoleLine = warnSpy.mock.calls[0]?.[0];
    expect(typeof consoleLine).toBe("string");
    expect(consoleLine).toContain("runId=run-1 forged entry test");
    expect(consoleLine).toContain("provider=openai]8;;https://evil.test");
    // The logger wraps its prefix (e.g. `[agent/embedded]`) in chalk ANSI
    // color codes, which legitimately contain `\u001b`. The intent of these
    // checks is that USER-CONTROLLED fields must not inject control
    // characters — assert that against the payload after stripping the
    // logger's own ANSI-wrapped prefix.
    const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;
    const sanitizedLine = (consoleLine as string).replace(ANSI_RE, "");
    expect(sanitizedLine).not.toContain("\n");
    expect(sanitizedLine).not.toContain("\r");
    expect(sanitizedLine).not.toContain("\t");
    expect(sanitizedLine).not.toContain("\u001b");
  });
});
