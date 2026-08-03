import type { Api, Model } from "@mariozechner/pi-ai";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import { getAgentRunContext } from "../../../infra/agent-events.js";
import { prepareProviderRuntimeAuth } from "../../../plugins/provider-runtime.js";
import {
  type AuthProfileStore,
  isProfileInCooldown,
  resolveProfilesUnavailableReason,
} from "../../auth-profiles.js";
import { FailoverError, resolveFailoverStatus } from "../../failover-error.js";
import { shouldAllowCooldownProbeForReason } from "../../failover-policy.js";
import { requestModelApprovalDecision } from "../../model-approval-request.js";
import { getApiKeyForModel, type ResolvedProviderAuth } from "../../model-auth.js";
import { isNonSecretApiKeyMarker } from "../../model-auth-markers.js";
import { resolveMeteredAutoApprove } from "../../model-metering.js";
import {
  classifyFailoverReason,
  isFailoverErrorMessage,
  type FailoverReason,
} from "../../pi-embedded-helpers.js";
import { clampRuntimeAuthRefreshDelayMs } from "../../runtime-auth-refresh.js";
import { describeUnknownError } from "../utils.js";
import {
  RUNTIME_AUTH_REFRESH_MARGIN_MS,
  RUNTIME_AUTH_REFRESH_MIN_DELAY_MS,
  RUNTIME_AUTH_REFRESH_RETRY_MS,
  type RuntimeAuthState,
} from "./helpers.js";
import type { RunEmbeddedPiAgentParams } from "./params.js";

type ApiKeyInfo = ResolvedProviderAuth;

type RuntimeApiKeySink = {
  setRuntimeApiKey(provider: string, apiKey: string): void;
};

type LogLike = {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
};

export function createEmbeddedRunAuthController(params: {
  config: RunEmbeddedPiAgentParams["config"];
  agentDir: string;
  workspaceDir: string;
  authStore: AuthProfileStore;
  authStorage: RuntimeApiKeySink;
  profileCandidates: Array<string | undefined>;
  lockedProfileId?: string;
  initialThinkLevel: ThinkLevel;
  attemptedThinking: Set<ThinkLevel>;
  fallbackConfigured: boolean;
  allowTransientCooldownProbe: boolean;
  /** Embedded run id: keys the AgentRunContext lookup for the dial-time metered gate. */
  runId?: string;
  getProvider(): string;
  getModelId(): string;
  getRuntimeModel(): Model<Api>;
  setRuntimeModel(next: Model<Api>): void;
  getEffectiveModel(): Model<Api>;
  setEffectiveModel(next: Model<Api>): void;
  getApiKeyInfo(): ApiKeyInfo | null;
  setApiKeyInfo(next: ApiKeyInfo | null): void;
  getLastProfileId(): string | undefined;
  setLastProfileId(next: string | undefined): void;
  getRuntimeAuthState(): RuntimeAuthState | null;
  setRuntimeAuthState(next: RuntimeAuthState | null): void;
  getRuntimeAuthRefreshCancelled(): boolean;
  setRuntimeAuthRefreshCancelled(next: boolean): void;
  getProfileIndex(): number;
  setProfileIndex(next: number): void;
  setThinkLevel(next: ThinkLevel): void;
  log: LogLike;
}) {
  const hasRefreshableRuntimeAuth = () =>
    Boolean(params.getRuntimeAuthState()?.sourceApiKey.trim());

  const clearRuntimeAuthRefreshTimer = () => {
    const runtimeAuthState = params.getRuntimeAuthState();
    if (!runtimeAuthState?.refreshTimer) {
      return;
    }
    clearTimeout(runtimeAuthState.refreshTimer);
    runtimeAuthState.refreshTimer = undefined;
  };

  const stopRuntimeAuthRefreshTimer = () => {
    if (!params.getRuntimeAuthState()) {
      return;
    }
    params.setRuntimeAuthRefreshCancelled(true);
    clearRuntimeAuthRefreshTimer();
  };

  const refreshRuntimeAuth = async (reason: string): Promise<void> => {
    const runtimeAuthState = params.getRuntimeAuthState();
    if (!runtimeAuthState) {
      return;
    }
    if (runtimeAuthState.refreshInFlight) {
      await runtimeAuthState.refreshInFlight;
      return;
    }
    runtimeAuthState.refreshInFlight = (async () => {
      const currentRuntimeAuthState = params.getRuntimeAuthState();
      const sourceApiKey = currentRuntimeAuthState?.sourceApiKey.trim() ?? "";
      if (!sourceApiKey) {
        throw new Error(`Runtime auth refresh requires a source credential.`);
      }
      const runtimeModel = params.getRuntimeModel();
      params.log.debug(`Refreshing runtime auth for ${runtimeModel.provider} (${reason})...`);
      const preparedAuth = await prepareProviderRuntimeAuth({
        provider: runtimeModel.provider,
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: process.env,
        context: {
          config: params.config,
          agentDir: params.agentDir,
          workspaceDir: params.workspaceDir,
          env: process.env,
          provider: runtimeModel.provider,
          modelId: params.getModelId(),
          model: runtimeModel,
          apiKey: sourceApiKey,
          authMode: currentRuntimeAuthState?.authMode ?? "unknown",
          profileId: currentRuntimeAuthState?.profileId,
        },
      });
      if (!preparedAuth?.apiKey) {
        throw new Error(
          `Provider "${runtimeModel.provider}" does not support runtime auth refresh.`,
        );
      }
      params.authStorage.setRuntimeApiKey(runtimeModel.provider, preparedAuth.apiKey);
      if (preparedAuth.baseUrl) {
        params.setRuntimeModel({ ...runtimeModel, baseUrl: preparedAuth.baseUrl });
        params.setEffectiveModel({
          ...params.getEffectiveModel(),
          baseUrl: preparedAuth.baseUrl,
        });
      }
      params.setRuntimeAuthState({
        ...params.getRuntimeAuthState(),
        expiresAt: preparedAuth.expiresAt,
      } as RuntimeAuthState);
      if (preparedAuth.expiresAt) {
        const remaining = preparedAuth.expiresAt - Date.now();
        params.log.debug(
          `Runtime auth refreshed for ${runtimeModel.provider}; expires in ${Math.max(0, Math.floor(remaining / 1000))}s.`,
        );
      }
    })()
      .catch((err) => {
        const runtimeModel = params.getRuntimeModel();
        params.log.warn(
          `Runtime auth refresh failed for ${runtimeModel.provider}: ${describeUnknownError(err)}`,
        );
        throw err;
      })
      .finally(() => {
        const activeState = params.getRuntimeAuthState();
        if (activeState) {
          activeState.refreshInFlight = undefined;
        }
      });
    await runtimeAuthState.refreshInFlight;
  };

  const scheduleRuntimeAuthRefresh = (): void => {
    const runtimeAuthState = params.getRuntimeAuthState();
    if (!runtimeAuthState || params.getRuntimeAuthRefreshCancelled()) {
      return;
    }
    const runtimeModel = params.getRuntimeModel();
    if (!hasRefreshableRuntimeAuth()) {
      params.log.warn(
        `Skipping runtime auth refresh scheduling for ${runtimeModel.provider}; source credential missing.`,
      );
      return;
    }
    if (!runtimeAuthState.expiresAt) {
      return;
    }
    clearRuntimeAuthRefreshTimer();
    const now = Date.now();
    const refreshAt = runtimeAuthState.expiresAt - RUNTIME_AUTH_REFRESH_MARGIN_MS;
    const delayMs = clampRuntimeAuthRefreshDelayMs({
      refreshAt,
      now,
      minDelayMs: RUNTIME_AUTH_REFRESH_MIN_DELAY_MS,
    });
    const timer = setTimeout(() => {
      if (params.getRuntimeAuthRefreshCancelled()) {
        return;
      }
      refreshRuntimeAuth("scheduled")
        .then(() => scheduleRuntimeAuthRefresh())
        .catch(() => {
          if (params.getRuntimeAuthRefreshCancelled()) {
            return;
          }
          const retryTimer = setTimeout(() => {
            if (params.getRuntimeAuthRefreshCancelled()) {
              return;
            }
            refreshRuntimeAuth("scheduled-retry")
              .then(() => scheduleRuntimeAuthRefresh())
              .catch(() => undefined);
          }, RUNTIME_AUTH_REFRESH_RETRY_MS);
          const activeRuntimeAuthState = params.getRuntimeAuthState();
          if (activeRuntimeAuthState) {
            activeRuntimeAuthState.refreshTimer = retryTimer;
          }
          if (params.getRuntimeAuthRefreshCancelled() && activeRuntimeAuthState) {
            clearTimeout(retryTimer);
            activeRuntimeAuthState.refreshTimer = undefined;
          }
        });
    }, delayMs);
    runtimeAuthState.refreshTimer = timer;
    if (params.getRuntimeAuthRefreshCancelled()) {
      clearTimeout(timer);
      runtimeAuthState.refreshTimer = undefined;
    }
  };

  const resolveAuthProfileFailoverReason = (failoverParams: {
    allInCooldown: boolean;
    message: string;
    profileIds?: Array<string | undefined>;
  }): FailoverReason => {
    if (failoverParams.allInCooldown) {
      const profileIds = (failoverParams.profileIds ?? params.profileCandidates).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      return (
        resolveProfilesUnavailableReason({
          store: params.authStore,
          profileIds,
        }) ?? "unknown"
      );
    }
    const classified = classifyFailoverReason(failoverParams.message);
    return classified ?? "auth";
  };

  const throwAuthProfileFailover = (failoverParams: {
    allInCooldown: boolean;
    message?: string;
    error?: unknown;
  }): never => {
    const provider = params.getProvider();
    const modelId = params.getModelId();
    const fallbackMessage = `No available auth profile for ${provider} (all in cooldown or unavailable).`;
    const message =
      failoverParams.message?.trim() ||
      (failoverParams.error ? describeUnknownError(failoverParams.error).trim() : "") ||
      fallbackMessage;
    const reason = resolveAuthProfileFailoverReason({
      allInCooldown: failoverParams.allInCooldown,
      message,
      profileIds: params.profileCandidates,
    });
    if (params.fallbackConfigured) {
      throw new FailoverError(message, {
        reason,
        provider,
        model: modelId,
        status: resolveFailoverStatus(reason),
        cause: failoverParams.error,
      });
    }
    if (failoverParams.error instanceof Error) {
      throw failoverParams.error;
    }
    throw new Error(message);
  };

  const resolveApiKeyForCandidate = async (candidate?: string) => {
    return getApiKeyForModel({
      model: params.getRuntimeModel(),
      cfg: params.config,
      profileId: candidate,
      store: params.authStore,
      agentDir: params.agentDir,
    });
  };

  // Run-scoped metered gate state. `approved` short-circuits later credential
  // applications in this run; `denied` fails subsequent api-key credentials
  // fast instead of re-prompting when several are rotated back-to-back.
  let meteredCredentialApproved = false;
  let meteredCredentialDenied = false;

  const throwMeteredCredentialBlocked = (
    reason: Extract<FailoverReason, "metered_denied" | "metered_unapproved_headless">,
    profileId?: string,
  ): never => {
    const provider = params.getProvider();
    const modelId = params.getModelId();
    const detail =
      reason === "metered_denied"
        ? "was not approved"
        : "was skipped (headless, not approved)";
    // Always a FailoverError (independent of fallbackConfigured) so the outer
    // model-fallback loop classifies the attempt as metered_* and advances;
    // resolveAuthProfileFailureReason in run.ts filters these reasons out of
    // auth-profile failure accounting.
    throw new FailoverError(`Metered credential for ${provider}/${modelId} ${detail}.`, {
      reason,
      provider,
      model: modelId,
      profileId,
      status: resolveFailoverStatus(reason),
    });
  };

  /**
   * Dial-time metered approval gate — defense in depth behind the chain-level
   * gate in model-fallback.ts. The chain gate classifies billing from the
   * auth-profile STORE, so a mid-run rotation onto an env API key (e.g. a
   * subscription token that 401s and falls through to ANTHROPIC_API_KEY) can
   * dial a metered credential the chain gate never saw. This gate runs at the
   * moment a resolved credential is about to be applied, where
   * `apiKeyInfo.mode` is the source of truth: only "api-key" gates;
   * oauth/token/aws-sdk credentials are plan-backed/ambient and NEVER gated.
   */
  const gateMeteredCredential = async (apiKeyInfo: ApiKeyInfo): Promise<void> => {
    if (apiKeyInfo.mode !== "api-key" || !apiKeyInfo.apiKey) {
      return;
    }
    // Synthetic marker "keys" (custom-local, ollama-local, oauth:*, ...) are
    // placeholders for local/no-auth or plan-backed flows, not billable API
    // keys — never gate them.
    if (isNonSecretApiKeyMarker(apiKeyInfo.apiKey)) {
      return;
    }
    if (meteredCredentialApproved) {
      return;
    }
    const runCtx = params.runId ? getAgentRunContext(params.runId) : undefined;
    if (!runCtx) {
      // No registered run context (direct CLI invocations, tests): fail open,
      // mirroring the chain-level gate.
      return;
    }
    if (runCtx.meteredApprovalGranted === true || resolveMeteredAutoApprove(runCtx)) {
      // Approved earlier this run (by either gate) or session-level
      // "don't ask again": no prompt needed.
      meteredCredentialApproved = true;
      return;
    }
    if (meteredCredentialDenied) {
      throwMeteredCredentialBlocked("metered_denied", apiKeyInfo.profileId);
    }
    if (!runCtx.isControlUiVisible) {
      throwMeteredCredentialBlocked("metered_unapproved_headless", apiKeyInfo.profileId);
    }
    const decision = await requestModelApprovalDecision({
      provider: params.getProvider(),
      model: params.getModelId(),
      // The controller cannot cheaply tell primary vs fallback candidates
      // apart mid-run; "primary" only affects the approval card wording.
      reasonKind: "primary",
      agentId: runCtx.agentId,
      sessionKey: runCtx.sessionKey,
      runId: params.runId,
    });
    if (decision?.kind === "approve" && !decision.switchTo) {
      if (decision.dontAskAgain) {
        // The gateway resolve handler persists the session flag out-of-band;
        // cache it here so later reads in this run skip the store re-read.
        runCtx.meteredAutoApprove = true;
      }
      meteredCredentialApproved = true;
      runCtx.meteredApprovalGranted = true;
      return;
    }
    // approve+switchTo: the user picked a DIFFERENT model. Mid-attempt the
    // auth controller cannot swap models, so treat it as a deny for this
    // credential path — the resulting failover advances the model-fallback
    // loop, and its chain-level gate owns switchTo handling.
    meteredCredentialDenied = true;
    throwMeteredCredentialBlocked("metered_denied", apiKeyInfo.profileId);
  };

  const applyApiKeyInfo = async (candidate?: string): Promise<void> => {
    const apiKeyInfo = await resolveApiKeyForCandidate(candidate);
    // Gate BEFORE the credential is stored or applied anywhere: a blocked
    // metered credential must never reach setApiKeyInfo/setRuntimeApiKey.
    await gateMeteredCredential(apiKeyInfo);
    params.setApiKeyInfo(apiKeyInfo);
    const resolvedProfileId = apiKeyInfo.profileId ?? candidate;
    if (!apiKeyInfo.apiKey) {
      if (apiKeyInfo.mode !== "aws-sdk") {
        const runtimeModel = params.getRuntimeModel();
        throw new Error(
          `No API key resolved for provider "${runtimeModel.provider}" (auth mode: ${apiKeyInfo.mode}).`,
        );
      }
      params.setLastProfileId(resolvedProfileId);
      return;
    }
    let runtimeAuthHandled = false;
    const runtimeModel = params.getRuntimeModel();
    const preparedAuth = await prepareProviderRuntimeAuth({
      provider: runtimeModel.provider,
      config: params.config,
      workspaceDir: params.workspaceDir,
      env: process.env,
      context: {
        config: params.config,
        agentDir: params.agentDir,
        workspaceDir: params.workspaceDir,
        env: process.env,
        provider: runtimeModel.provider,
        modelId: params.getModelId(),
        model: runtimeModel,
        apiKey: apiKeyInfo.apiKey,
        authMode: apiKeyInfo.mode,
        profileId: apiKeyInfo.profileId,
      },
    });
    if (preparedAuth?.baseUrl) {
      params.setRuntimeModel({ ...runtimeModel, baseUrl: preparedAuth.baseUrl });
      params.setEffectiveModel({ ...params.getEffectiveModel(), baseUrl: preparedAuth.baseUrl });
    }
    if (preparedAuth?.apiKey) {
      params.authStorage.setRuntimeApiKey(runtimeModel.provider, preparedAuth.apiKey);
      params.setRuntimeAuthState({
        sourceApiKey: apiKeyInfo.apiKey,
        authMode: apiKeyInfo.mode,
        profileId: apiKeyInfo.profileId,
        expiresAt: preparedAuth.expiresAt,
      });
      if (preparedAuth.expiresAt) {
        scheduleRuntimeAuthRefresh();
      }
      runtimeAuthHandled = true;
    }
    if (!runtimeAuthHandled) {
      params.authStorage.setRuntimeApiKey(runtimeModel.provider, apiKeyInfo.apiKey);
      params.setRuntimeAuthState(null);
    }
    params.setLastProfileId(apiKeyInfo.profileId);
  };

  const advanceAuthProfile = async (): Promise<boolean> => {
    if (params.lockedProfileId) {
      return false;
    }
    let nextIndex = params.getProfileIndex() + 1;
    while (nextIndex < params.profileCandidates.length) {
      const candidate = params.profileCandidates[nextIndex];
      if (
        candidate &&
        isProfileInCooldown(params.authStore, candidate, undefined, params.getModelId())
      ) {
        nextIndex += 1;
        continue;
      }
      try {
        await applyApiKeyInfo(candidate);
        params.setProfileIndex(nextIndex);
        params.setThinkLevel(params.initialThinkLevel);
        params.attemptedThinking.clear();
        return true;
      } catch (err) {
        if (candidate && candidate === params.lockedProfileId) {
          throw err;
        }
        nextIndex += 1;
      }
    }
    return false;
  };

  const initializeAuthProfile = async () => {
    try {
      const autoProfileCandidates = params.profileCandidates.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          candidate.length > 0 &&
          candidate !== params.lockedProfileId,
      );
      const modelId = params.getModelId();
      const allAutoProfilesInCooldown =
        autoProfileCandidates.length > 0 &&
        autoProfileCandidates.every((candidate) =>
          isProfileInCooldown(params.authStore, candidate, undefined, modelId),
        );
      const unavailableReason = allAutoProfilesInCooldown
        ? (resolveProfilesUnavailableReason({
            store: params.authStore,
            profileIds: autoProfileCandidates,
          }) ?? "unknown")
        : null;
      const allowTransientCooldownProbe =
        params.allowTransientCooldownProbe &&
        allAutoProfilesInCooldown &&
        shouldAllowCooldownProbeForReason(unavailableReason);
      let didTransientCooldownProbe = false;

      while (params.getProfileIndex() < params.profileCandidates.length) {
        const candidate = params.profileCandidates[params.getProfileIndex()];
        const inCooldown =
          candidate &&
          candidate !== params.lockedProfileId &&
          isProfileInCooldown(params.authStore, candidate, undefined, modelId);
        if (inCooldown) {
          if (allowTransientCooldownProbe && !didTransientCooldownProbe) {
            didTransientCooldownProbe = true;
            params.log.warn(
              `probing cooldowned auth profile for ${params.getProvider()}/${modelId} due to ${unavailableReason ?? "transient"} unavailability`,
            );
          } else {
            params.setProfileIndex(params.getProfileIndex() + 1);
            continue;
          }
        }
        await applyApiKeyInfo(params.profileCandidates[params.getProfileIndex()]);
        break;
      }
      if (params.getProfileIndex() >= params.profileCandidates.length) {
        throwAuthProfileFailover({ allInCooldown: true });
      }
    } catch (err) {
      if (err instanceof FailoverError) {
        throw err;
      }
      if (params.profileCandidates[params.getProfileIndex()] === params.lockedProfileId) {
        throwAuthProfileFailover({ allInCooldown: false, error: err });
      }
      const advanced = await advanceAuthProfile();
      if (!advanced) {
        throwAuthProfileFailover({ allInCooldown: false, error: err });
      }
    }
  };

  const maybeRefreshRuntimeAuthForAuthError = async (
    errorText: string,
    retried: boolean,
  ): Promise<boolean> => {
    if (!params.getRuntimeAuthState() || retried) {
      return false;
    }
    if (!isFailoverErrorMessage(errorText)) {
      return false;
    }
    if (classifyFailoverReason(errorText) !== "auth") {
      return false;
    }
    try {
      await refreshRuntimeAuth("auth-error");
      scheduleRuntimeAuthRefresh();
      return true;
    } catch {
      return false;
    }
  };

  return {
    advanceAuthProfile,
    initializeAuthProfile,
    maybeRefreshRuntimeAuthForAuthError,
    stopRuntimeAuthRefreshTimer,
  };
}
