import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
import { resolveShellFromPath } from "./shell-utils.js";

const isWin = process.platform === "win32";
const defaultShell = isWin
  ? undefined
  : process.env.OPENCLAW_TEST_SHELL || resolveShellFromPath("bash") || process.env.SHELL || "sh";
// Must outlive the 0.05s timeout below by a wide margin. This was 72ms, a 22ms
// race that the shared test lane loses under parallel load. The process is
// killed at the timeout either way, so a long sleep costs no wall time and makes
// the assertion independent of scheduling jitter.
const longDelayCmd = isWin ? "Start-Sleep -Seconds 30" : "sleep 30";

describe("exec foreground failures", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["SHELL"]);
    if (!isWin && defaultShell) {
      process.env.SHELL = defaultShell;
    }
    resetProcessRegistryForTests();
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("returns a failed text result when the default timeout is exceeded", async () => {
    const tool = createExecTool({
      security: "full",
      ask: "off",
      timeoutSec: 0.05,
      backgroundMs: 10,
      allowBackground: false,
    });

    const result = await tool.execute("call-timeout", {
      command: longDelayCmd,
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text?: string }).text).toMatch(/timed out/i);
    expect((result.content[0] as { text?: string }).text).toMatch(/re-run with a higher timeout/i);
    expect(result.details).toMatchObject({
      status: "failed",
      exitCode: null,
      aggregated: "",
    });
    expect((result.details as { durationMs?: number }).durationMs).toEqual(expect.any(Number));
  });
});
