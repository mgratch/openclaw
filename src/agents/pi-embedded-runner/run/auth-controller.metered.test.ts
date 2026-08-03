import crypto from "node:crypto";
import type { Api, Model } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentRunContext,
  getAgentRunContext,
  registerAgentRunContext,
  resetAgentRunContextForTest,
} from "../../../infra/agent-events.js";
import type { AuthProfileStore } from "../../auth-profiles.js";
import { AUTH_STORE_VERSION } from "../../auth-profiles/constants.js";
import { FailoverError } from "../../failover-error.js";
import { requestModelApprovalDecision } from "../../model-approval-request.js";
import { getApiKeyForModel, type ResolvedProviderAuth } from "../../model-auth.js";
import { CUSTOM_LOCAL_AUTH_MARKER } from "../../model-auth-markers.js";
import type { FailoverReason } from "../../pi-embedded-helpers.js";
import { createEmbeddedRunAuthController } from "./auth-controller.js";
import type { RuntimeAuthState } from "./helpers.js";

vi.mock("../../model-approval-request.js", () => ({
  requestModelApprovalDecision: vi.fn(async () => null),
}));

vi.mock("../../model-auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../model-auth.js")>();
  return { ...actual, getApiKeyForModel: vi.fn() };
});

vi.mock("../../../plugins/provider-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../plugins/provider-runtime.js")>();
  return { ...actual, prepareProviderRuntimeAuth: vi.fn(async () => null) };
});

const mockedRequestApproval = vi.mocked(requestModelApprovalDecision);
const mockedGetApiKeyForModel = vi.mocked(getApiKeyForModel);

afterEach(() => {
  resetAgentRunContextForTest();
  mockedRequestApproval.mockReset();
  mockedRequestApproval.mockResolvedValue(null);
  mockedGetApiKeyForModel.mockReset();
});

const NOOP_LOG = { debug: () => {}, info: () => {}, warn: () => {} };

function makeHarness(opts: { runId?: string; auth: ResolvedProviderAuth }) {
  const model = {
    id: "m1",
    provider: "acme",
    api: "openai-completions",
  } as unknown as Model<Api>;
  let runtimeModel = model;
  let effectiveModel = model;
  let apiKeyInfo: ResolvedProviderAuth | null = null;
  let lastProfileId: string | undefined;
  let runtimeAuthState: RuntimeAuthState | null = null;
  let refreshCancelled = false;
  let profileIndex = 0;
  const authStorage = { setRuntimeApiKey: vi.fn() };
  const authStore: AuthProfileStore = { version: AUTH_STORE_VERSION, profiles: {} };
  mockedGetApiKeyForModel.mockResolvedValue(opts.auth);
  const controller = createEmbeddedRunAuthController({
    config: undefined,
    agentDir: "/tmp/openclaw-test-agent-dir",
    workspaceDir: "/tmp/openclaw-test-workspace",
    authStore,
    authStorage,
    profileCandidates: [undefined],
    initialThinkLevel: "off",
    attemptedThinking: new Set(),
    fallbackConfigured: false,
    allowTransientCooldownProbe: false,
    runId: opts.runId,
    getProvider: () => "acme",
    getModelId: () => "m1",
    getRuntimeModel: () => runtimeModel,
    setRuntimeModel: (next) => {
      runtimeModel = next;
    },
    getEffectiveModel: () => effectiveModel,
    setEffectiveModel: (next) => {
      effectiveModel = next;
    },
    getApiKeyInfo: () => apiKeyInfo,
    setApiKeyInfo: (next) => {
      apiKeyInfo = next;
    },
    getLastProfileId: () => lastProfileId,
    setLastProfileId: (next) => {
      lastProfileId = next;
    },
    getRuntimeAuthState: () => runtimeAuthState,
    setRuntimeAuthState: (next) => {
      runtimeAuthState = next;
    },
    getRuntimeAuthRefreshCancelled: () => refreshCancelled,
    setRuntimeAuthRefreshCancelled: (next) => {
      refreshCancelled = next;
    },
    getProfileIndex: () => profileIndex,
    setProfileIndex: (next) => {
      profileIndex = next;
    },
    setThinkLevel: () => {},
    log: NOOP_LOG,
  });
  return {
    controller,
    authStorage,
    getAppliedApiKeyInfo: () => apiKeyInfo,
  };
}

function registerRunContext(runId: string, context: AgentRunContext): void {
  registerAgentRunContext(runId, context);
}

async function expectFailoverReason(promise: Promise<unknown>, reason: FailoverReason) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(FailoverError);
  expect((err as FailoverError).reason).toBe(reason);
}

const ENV_API_KEY_AUTH: ResolvedProviderAuth = {
  apiKey: "sk-env-metered",
  source: "env: ANTHROPIC_API_KEY",
  mode: "api-key",
};

describe("embedded-run auth controller metered gate", () => {
  it("blocks api-key credentials on headless runs with metered_unapproved_headless", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: false });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await expectFailoverReason(
      harness.controller.initializeAuthProfile(),
      "metered_unapproved_headless",
    );
    expect(harness.authStorage.setRuntimeApiKey).not.toHaveBeenCalled();
    expect(harness.getAppliedApiKeyInfo()).toBeNull();
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("blocks api-key credentials on deny with metered_denied and does not apply them", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, {
      sessionKey: "agent:main:test",
      agentId: "main",
      isControlUiVisible: true,
    });
    mockedRequestApproval.mockResolvedValueOnce({ kind: "deny" });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await expectFailoverReason(harness.controller.initializeAuthProfile(), "metered_denied");
    expect(harness.authStorage.setRuntimeApiKey).not.toHaveBeenCalled();
    expect(harness.getAppliedApiKeyInfo()).toBeNull();
    expect(mockedRequestApproval).toHaveBeenCalledTimes(1);
    expect(mockedRequestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "acme",
        model: "m1",
        reasonKind: "primary",
        sessionKey: "agent:main:test",
        agentId: "main",
        runId,
      }),
    );
  });

  it("treats approval timeout (null decision) as deny", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce(null);
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await expectFailoverReason(harness.controller.initializeAuthProfile(), "metered_denied");
    expect(harness.authStorage.setRuntimeApiKey).not.toHaveBeenCalled();
  });

  it("does not re-prompt after a deny within the same run", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({ kind: "deny" });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await expectFailoverReason(harness.controller.initializeAuthProfile(), "metered_denied");
    // A later rotation resolving another api-key credential fails fast
    // without a second approval card.
    await expectFailoverReason(harness.controller.initializeAuthProfile(), "metered_denied");
    expect(mockedRequestApproval).toHaveBeenCalledTimes(1);
  });

  it("applies the credential after an approve decision and marks the run approved", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({ kind: "approve" });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "sk-env-metered");
    expect(getAgentRunContext(runId)?.meteredApprovalGranted).toBe(true);
    expect(getAgentRunContext(runId)?.meteredAutoApprove).toBeUndefined();
  });

  it("caches dontAskAgain on the run context", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({ kind: "approve", dontAskAgain: true });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await harness.controller.initializeAuthProfile();
    expect(getAgentRunContext(runId)?.meteredAutoApprove).toBe(true);
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "sk-env-metered");
  });

  it("treats approve+switchTo as deny for this credential path (chain gate owns the switch)", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: true });
    mockedRequestApproval.mockResolvedValueOnce({
      kind: "approve",
      switchTo: { provider: "plan-provider", model: "m2" },
    });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await expectFailoverReason(harness.controller.initializeAuthProfile(), "metered_denied");
    expect(harness.authStorage.setRuntimeApiKey).not.toHaveBeenCalled();
  });

  it("passes when the chain-level gate already granted approval this run", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, {
      sessionKey: "agent:main:test",
      isControlUiVisible: true,
      meteredApprovalGranted: true,
    });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "sk-env-metered");
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("passes on meteredAutoApprove even for headless runs", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, {
      sessionKey: "agent:main:test",
      isControlUiVisible: false,
      meteredAutoApprove: true,
    });
    const harness = makeHarness({ runId, auth: ENV_API_KEY_AUTH });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "sk-env-metered");
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("never gates token-mode credentials", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: false });
    const harness = makeHarness({
      runId,
      auth: {
        apiKey: "tok-plan",
        profileId: "acme:plan",
        source: "profile:acme:plan",
        mode: "token",
      },
    });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "tok-plan");
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("never gates oauth-mode credentials", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: false });
    const harness = makeHarness({
      runId,
      auth: {
        apiKey: "oauth-access-token",
        profileId: "acme:oauth",
        source: "profile:acme:oauth",
        mode: "oauth",
      },
    });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "oauth-access-token");
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("never gates aws-sdk mode (no literal credential to apply)", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: false });
    const harness = makeHarness({
      runId,
      auth: { source: "aws-sdk default chain", mode: "aws-sdk" },
    });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).not.toHaveBeenCalled();
    expect(mockedRequestApproval).not.toHaveBeenCalled();
    expect(harness.getAppliedApiKeyInfo()?.mode).toBe("aws-sdk");
  });

  it("never gates synthetic marker keys (local providers)", async () => {
    const runId = crypto.randomUUID();
    registerRunContext(runId, { sessionKey: "agent:main:test", isControlUiVisible: false });
    const harness = makeHarness({
      runId,
      auth: {
        apiKey: CUSTOM_LOCAL_AUTH_MARKER,
        source: "models.providers.acme (synthetic local key)",
        mode: "api-key",
      },
    });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith(
      "acme",
      CUSTOM_LOCAL_AUTH_MARKER,
    );
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("fails open when no run context is registered (direct CLI runs, tests)", async () => {
    const harness = makeHarness({ runId: crypto.randomUUID(), auth: ENV_API_KEY_AUTH });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "sk-env-metered");
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });

  it("fails open when no runId is provided", async () => {
    const harness = makeHarness({ auth: ENV_API_KEY_AUTH });

    await harness.controller.initializeAuthProfile();
    expect(harness.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("acme", "sk-env-metered");
    expect(mockedRequestApproval).not.toHaveBeenCalled();
  });
});
