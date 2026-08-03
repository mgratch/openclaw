import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { registerAgentRunContext, resetAgentRunContextForTest } from "../infra/agent-events.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import { saveAuthProfileStore } from "./auth-profiles.js";
import { AUTH_STORE_VERSION } from "./auth-profiles/constants.js";
import { requestModelApprovalDecision } from "./model-approval-request.js";
import { runWithModelFallback } from "./model-fallback.js";
import { makeModelFallbackCfg } from "./test-helpers/model-fallback-config-fixture.js";

vi.mock("./model-approval-request.js", () => ({
  requestModelApprovalDecision: vi.fn(async () => null),
}));

const mockedRequestApproval = vi.mocked(requestModelApprovalDecision);

afterEach(() => {
  resetAgentRunContextForTest();
  mockedRequestApproval.mockReset();
});

function makeMeteredCfg(params: { metered: string; fallbacks: string[] }): OpenClawConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: `${params.metered}/m1`,
          fallbacks: params.fallbacks,
        },
      },
    },
  } as OpenClawConfig;
}

async function withTempAuthStore<T>(
  store: AuthProfileStore,
  run: (tempDir: string) => Promise<T>,
): Promise<T> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-metered-"));
  saveAuthProfileStore(store, tempDir);
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function makeMeteredPlanStore(params: { metered: string; plan: string }): AuthProfileStore {
  return {
    version: AUTH_STORE_VERSION,
    profiles: {
      [`${params.metered}:default`]: {
        type: "api_key",
        provider: params.metered,
        key: "sk-test",
      },
      [`${params.plan}:default`]: {
        type: "token",
        provider: params.plan,
        token: "tok-test",
      },
    },
  };
}

function registerRunContext(params: { runId: string; isControlUiVisible: boolean }): void {
  registerAgentRunContext(params.runId, {
    sessionKey: "agent:main:test",
    isControlUiVisible: params.isControlUiVisible,
  });
}

describe("metered model approval gate", () => {
  it("skips unapproved metered candidates on headless runs and continues the cascade", async () => {
    const metered = `metered-${crypto.randomUUID()}`;
    const plan = `plan-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({ metered, fallbacks: [`${plan}/m2`] });
    const store = makeMeteredPlanStore({ metered, plan });
    const runId = crypto.randomUUID();
    registerRunContext({ runId, isControlUiVisible: false });
    const run = vi.fn().mockImplementation(async (provider: string) => {
      if (provider === plan) {
        return "ok";
      }
      throw new Error(`unexpected candidate provider: ${provider}`);
    });

    const result = await withTempAuthStore(store, async (tempDir) =>
      runWithModelFallback({ cfg, provider: metered, model: "m1", runId, agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([[plan, "m2"]]);
    expect(result.attempts[0]?.reason).toBe("metered_unapproved_headless");
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("dials the metered candidate after an approve decision", async () => {
    const metered = `metered-${crypto.randomUUID()}`;
    const plan = `plan-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({ metered, fallbacks: [`${plan}/m2`] });
    const store = makeMeteredPlanStore({ metered, plan });
    const runId = crypto.randomUUID();
    registerRunContext({ runId, isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({ kind: "approve" });
    const run = vi.fn().mockResolvedValueOnce("ok");

    const result = await withTempAuthStore(store, async (tempDir) =>
      runWithModelFallback({ cfg, provider: metered, model: "m1", runId, agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([[metered, "m1"]]);
    expect(mockedRequestApproval).toHaveBeenCalledTimes(1);
    expect(mockedRequestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: metered,
        model: "m1",
        reasonKind: "primary",
        sessionKey: "agent:main:test",
        runId,
      }),
    );
  });

  it("dials the switchTo replacement instead of the requested candidate without re-gating", async () => {
    const metered = `metered-${crypto.randomUUID()}`;
    const plan = `plan-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({ metered, fallbacks: [`${plan}/m2`] });
    const store = makeMeteredPlanStore({ metered, plan });
    const runId = crypto.randomUUID();
    registerRunContext({ runId, isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({
      kind: "approve",
      switchTo: { provider: plan, model: "chosen-model" },
    });
    const run = vi.fn().mockResolvedValueOnce("ok");

    const result = await withTempAuthStore(store, async (tempDir) =>
      runWithModelFallback({ cfg, provider: metered, model: "m1", runId, agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(result.provider).toBe(plan);
    expect(result.model).toBe("chosen-model");
    expect(run.mock.calls).toEqual([[plan, "chosen-model"]]);
    expect(mockedRequestApproval).toHaveBeenCalledTimes(1);
  });

  it("skips the metered candidate on deny and continues to the plan fallback", async () => {
    const metered = `metered-${crypto.randomUUID()}`;
    const plan = `plan-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({ metered, fallbacks: [`${plan}/m2`] });
    const store = makeMeteredPlanStore({ metered, plan });
    const runId = crypto.randomUUID();
    registerRunContext({ runId, isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({ kind: "deny" });
    const run = vi.fn().mockImplementation(async (provider: string) => {
      if (provider === plan) {
        return "ok";
      }
      throw new Error(`unexpected candidate provider: ${provider}`);
    });

    const result = await withTempAuthStore(store, async (tempDir) =>
      runWithModelFallback({ cfg, provider: metered, model: "m1", runId, agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([[plan, "m2"]]);
    expect(result.attempts[0]?.reason).toBe("metered_denied");
  });

  it("caches dontAskAgain on the run context so later metered candidates are not re-gated", async () => {
    const metered = `metered-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({ metered, fallbacks: [`${metered}/m2`] });
    const store: AuthProfileStore = {
      version: AUTH_STORE_VERSION,
      profiles: {
        [`${metered}:default`]: { type: "api_key", provider: metered, key: "sk-test" },
      },
    };
    const runId = crypto.randomUUID();
    registerRunContext({ runId, isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({ kind: "approve", dontAskAgain: true });
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce("ok");

    const result = await withTempAuthStore(store, async (tempDir) =>
      runWithModelFallback({ cfg, provider: metered, model: "m1", runId, agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([
      [metered, "m1"],
      [metered, "m2"],
    ]);
    // Only the first metered candidate asked for approval.
    expect(mockedRequestApproval).toHaveBeenCalledTimes(1);
  });

  it("fails open when no run context is registered (direct CLI runs, tests)", async () => {
    const metered = `metered-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({ metered, fallbacks: [] });
    const store: AuthProfileStore = {
      version: AUTH_STORE_VERSION,
      profiles: {
        [`${metered}:default`]: { type: "api_key", provider: metered, key: "sk-test" },
      },
    };
    const run = vi.fn().mockResolvedValueOnce("ok");

    const result = await withTempAuthStore(store, async (tempDir) =>
      runWithModelFallback({ cfg, provider: metered, model: "m1", agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([[metered, "m1"]]);
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });
});

describe("ACP preset resolution in fallbacks", () => {
  it("resolves claude-code-* fallback rungs to their underlying anthropic model", async () => {
    const cfg = makeModelFallbackCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
            fallbacks: ["claude-code-sonnet"],
          },
        },
      },
    } as Partial<OpenClawConfig>);
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([
      ["openai", "gpt-4.1-mini"],
      ["anthropic", "claude-sonnet-4-6"],
    ]);
  });

  it("drops the bare claude-code preset (no pinned model to dial)", async () => {
    const cfg = makeModelFallbackCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
            fallbacks: ["claude-code"],
          },
        },
      },
    } as Partial<OpenClawConfig>);
    const run = vi.fn().mockRejectedValueOnce(new Error("boom"));

    await expect(
      runWithModelFallback({ cfg, provider: "openai", model: "gpt-4.1-mini", run }),
    ).rejects.toThrow("boom");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps non-preset bare ids on the default-provider path", async () => {
    const cfg = makeModelFallbackCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
            fallbacks: ["some-phantom-model"],
          },
        },
      },
    } as Partial<OpenClawConfig>);
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([
      ["openai", "gpt-4.1-mini"],
      ["openai", "some-phantom-model"],
    ]);
  });
});
