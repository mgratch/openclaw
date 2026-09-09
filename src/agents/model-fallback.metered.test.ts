import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import { saveAuthProfileStore } from "./auth-profiles.js";
import { AUTH_STORE_VERSION } from "./auth-profiles/constants.js";
import { makeModelFallbackCfg } from "./test-helpers/model-fallback-config-fixture.js";

vi.mock("./model-approval-request.js", () => ({
  requestModelApprovalDecision: vi.fn(async () => null),
}));

// All three are bound in beforeAll from ONE freshly reset registry. Two reasons,
// both caused by isolate:false sharing the module registry across files:
//   1. a sibling importing model-fallback first caches it bound to the REAL
//      approval requester, so the mock never applies and no prompt is recorded;
//   2. agent-events holds the run-context map, so the test and the subject must
//      read the SAME copy — otherwise the context this file registers is
//      invisible to the gate and candidates/prompt counts drift.
let runWithModelFallback: typeof import("./model-fallback.js").runWithModelFallback;
let registerAgentRunContext: typeof import("../infra/agent-events.js").registerAgentRunContext;
let resetAgentRunContextForTest: typeof import("../infra/agent-events.js").resetAgentRunContextForTest;
let mockedRequestApproval: ReturnType<
  typeof vi.mocked<typeof import("./model-approval-request.js").requestModelApprovalDecision>
>;

beforeAll(async () => {
  vi.resetModules();
  const approvalModule = await import("./model-approval-request.js");
  mockedRequestApproval = vi.mocked(approvalModule.requestModelApprovalDecision);
  ({ registerAgentRunContext, resetAgentRunContextForTest } =
    await import("../infra/agent-events.js"));
  ({ runWithModelFallback } = await import("./model-fallback.js"));
});

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

  it("asks once when several metered candidates follow a deny", async () => {
    // Regression: deny used to be remembered nowhere, so every later metered
    // rung raised a fresh approval card and Cancel looked like it did nothing.
    const meteredA = `metered-a-${crypto.randomUUID()}`;
    const meteredB = `metered-b-${crypto.randomUUID()}`;
    const plan = `plan-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({
      metered: meteredA,
      fallbacks: [`${meteredB}/m2`, `${plan}/m3`],
    });
    const store: AuthProfileStore = {
      version: AUTH_STORE_VERSION,
      profiles: {
        [`${meteredA}:default`]: { type: "api_key", provider: meteredA, key: "sk-a" },
        [`${meteredB}:default`]: { type: "api_key", provider: meteredB, key: "sk-b" },
        [`${plan}:default`]: { type: "token", provider: plan, token: "tok-test" },
      },
    };
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
      runWithModelFallback({ cfg, provider: meteredA, model: "m1", runId, agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([[plan, "m3"]]);
    // The second metered rung must be skipped WITHOUT a second card.
    expect(mockedRequestApproval).toHaveBeenCalledTimes(1);
    expect(result.attempts[0]?.reason).toBe("metered_denied");
    expect(result.attempts[1]?.reason).toBe("metered_denied");
  });

  it("consumes a dial-time switchTo exactly once", async () => {
    // The auth controller cannot swap models mid-attempt, so it parks the
    // user's choice on the run context; the chain gate must honor it for the
    // next candidate and must not let it leak into any later one.
    const metered = `metered-${crypto.randomUUID()}`;
    const plan = `plan-${crypto.randomUUID()}`;
    const cfg = makeMeteredCfg({ metered, fallbacks: [`${plan}/m2`] });
    const store = makeMeteredPlanStore({ metered, plan });
    const runId = crypto.randomUUID();
    registerAgentRunContext(runId, {
      sessionKey: "agent:main:test",
      isControlUiVisible: true,
      meteredApprovalSwitchTo: { provider: plan, model: "picked-by-user" },
    });
    const run = vi.fn().mockResolvedValueOnce("ok");

    const result = await withTempAuthStore(store, async (tempDir) =>
      runWithModelFallback({ cfg, provider: metered, model: "m1", runId, agentDir: tempDir, run }),
    );

    expect(result.result).toBe("ok");
    expect(run.mock.calls).toEqual([[plan, "picked-by-user"]]);
    // Parked choice is pre-confirmed on the card, so no new prompt.
    expect(mockedRequestApproval).not.toHaveBeenCalled();
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
