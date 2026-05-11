import fs from "node:fs";
import nodePath from "node:path";
import {
  getOAuthApiKey,
  getOAuthProviders,
  type OAuthCredentials,
  type OAuthProvider,
} from "@mariozechner/pi-ai/oauth";
import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import { coerceSecretRef } from "../../config/types.secrets.js";
import { withFileLock } from "../../infra/file-lock.js";
import { loadJsonFile } from "../../infra/json-file.js";
import {
  formatProviderAuthProfileApiKeyWithPlugin,
  refreshProviderOAuthCredentialWithPlugin,
} from "../../plugins/provider-runtime.runtime.js";
import { resolveSecretRefString, type SecretRefResolveCache } from "../../secrets/resolve.js";
import { refreshChutesTokens } from "../chutes-oauth.js";
import { AUTH_STORE_LOCK_OPTIONS, log } from "./constants.js";
import { resolveTokenExpiryState } from "./credential-state.js";
import { formatAuthDoctorHint } from "./doctor.js";
import { ensureAuthStoreFile, resolveAuthStorePath } from "./paths.js";
import { assertNoOAuthSecretRefPolicyViolations } from "./policy.js";
import { suggestOAuthProfileIdForLegacyDefault } from "./repair.js";
import { ensureAuthProfileStore, saveAuthProfileStore } from "./store.js";
import type { AuthProfileStore, OAuthCredential } from "./types.js";

function listOAuthProviderIds(): string[] {
  if (typeof getOAuthProviders !== "function") {
    return [];
  }
  const providers = getOAuthProviders();
  if (!Array.isArray(providers)) {
    return [];
  }
  return providers
    .map((provider) =>
      provider &&
      typeof provider === "object" &&
      "id" in provider &&
      typeof provider.id === "string"
        ? provider.id
        : undefined,
    )
    .filter((providerId): providerId is string => typeof providerId === "string");
}

const OAUTH_PROVIDER_IDS = new Set<string>(listOAuthProviderIds());

const isOAuthProvider = (provider: string): provider is OAuthProvider =>
  OAUTH_PROVIDER_IDS.has(provider);

const resolveOAuthProvider = (provider: string): OAuthProvider | null =>
  isOAuthProvider(provider) ? provider : null;

/** Bearer-token auth modes that are interchangeable (oauth tokens and raw tokens). */
const BEARER_AUTH_MODES = new Set(["oauth", "token"]);

const isCompatibleModeType = (mode: string | undefined, type: string | undefined): boolean => {
  if (!mode || !type) {
    return false;
  }
  if (mode === type) {
    return true;
  }
  // Both token and oauth represent bearer-token auth paths — allow bidirectional compat.
  return BEARER_AUTH_MODES.has(mode) && BEARER_AUTH_MODES.has(type);
};

function isProfileConfigCompatible(params: {
  cfg?: OpenClawConfig;
  profileId: string;
  provider: string;
  mode: "api_key" | "token" | "oauth";
  allowOAuthTokenCompatibility?: boolean;
}): boolean {
  const profileConfig = params.cfg?.auth?.profiles?.[params.profileId];
  if (profileConfig && profileConfig.provider !== params.provider) {
    return false;
  }
  if (profileConfig && !isCompatibleModeType(profileConfig.mode, params.mode)) {
    return false;
  }
  return true;
}

async function buildOAuthApiKey(provider: string, credentials: OAuthCredential): Promise<string> {
  const formatted = await formatProviderAuthProfileApiKeyWithPlugin({
    provider,
    context: credentials,
  });
  return typeof formatted === "string" && formatted.length > 0 ? formatted : credentials.access;
}

function buildApiKeyProfileResult(params: { apiKey: string; provider: string; email?: string }) {
  return {
    apiKey: params.apiKey,
    provider: params.provider,
    email: params.email,
  };
}

async function buildOAuthProfileResult(params: {
  provider: string;
  credentials: OAuthCredential;
  email?: string;
}) {
  return buildApiKeyProfileResult({
    apiKey: await buildOAuthApiKey(params.provider, params.credentials),
    provider: params.provider,
    email: params.email,
  });
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Patterns that indicate a permanently burned OAuth refresh token.
 *
 * When OpenAI (or another provider) returns one of these errors during a
 * refresh attempt, the stored refresh token has been consumed and can never be
 * used again. The only recovery path is a full re-authentication.
 */
const REFRESH_TOKEN_BURNED_PATTERNS = [
  "refresh_token_reused",
  "invalid_grant",
  "token has been revoked",
  "token has been expired or revoked",
  // The pi-ai library swallows the raw 401 error body (which contains
  // "refresh_token_reused") and re-throws a generic message without the
  // original error code. OpenAI Codex uses rotating refresh tokens, so any
  // refresh failure (not a network throw) means the token is burned.
  // Match the generic pi-ai fallback messages so the UI re-auth popup fires.
  "failed to refresh openai codex token",
  "failed to refresh oauth token for openai-codex",
];

function isRefreshTokenBurnedError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  const cause = error instanceof Error && error.cause ? extractErrorMessage(error.cause) : "";
  const combined = `${message} ${cause}`.toLowerCase();
  return REFRESH_TOKEN_BURNED_PATTERNS.some((pattern) => combined.includes(pattern));
}

/**
 * After a successful token refresh, propagate the new credentials to other
 * agents that share the same provider + identity but still hold an older
 * (likely burned) refresh token.
 *
 * Best-effort: failures are logged and swallowed so the primary refresh path
 * is never disrupted.
 */
function propagateRefreshedCredentialToOtherAgents(params: {
  profileId: string;
  newCredential: OAuthCredential;
  sourceAgentDir?: string;
}): void {
  try {
    const stateDir =
      process.env.OPENCLAW_STATE_DIR || nodePath.join(process.env.HOME || "~", ".openclaw");
    const agentsDir = nodePath.join(stateDir, "agents");
    if (!fs.existsSync(agentsDir)) {
      return;
    }

    const agents: string[] = fs.readdirSync(agentsDir);
    for (const agentName of agents) {
      // Skip special directories that aren't real agents.
      if (agentName.startsWith("__") || agentName.startsWith(".")) {
        continue;
      }
      const agentDir = nodePath.join(agentsDir, agentName, "agent");
      // Skip the source agent (already has the new credentials)
      if (
        params.sourceAgentDir &&
        nodePath.resolve(agentDir) === nodePath.resolve(params.sourceAgentDir)
      ) {
        continue;
      }
      // Skip main agent when source is undefined (main agent already updated)
      if (!params.sourceAgentDir && agentName === "main") {
        continue;
      }

      try {
        const otherStore = ensureAuthProfileStore(agentDir);
        const otherCred = otherStore.profiles[params.profileId];
        if (
          otherCred?.type === "oauth" &&
          otherCred.provider === params.newCredential.provider &&
          // Only propagate if the other agent's token is older (lower or equal expiry)
          (!Number.isFinite(otherCred.expires) || otherCred.expires <= params.newCredential.expires)
        ) {
          otherStore.profiles[params.profileId] = { ...params.newCredential };
          saveAuthProfileStore(otherStore, agentDir);
          log.info("propagated refreshed OAuth credentials to sibling agent", {
            profileId: params.profileId,
            targetAgent: agentName,
            expires: new Date(params.newCredential.expires).toISOString(),
          });
        }
      } catch {
        // Best-effort: don't crash if a sibling agent store is unreadable.
      }
    }
  } catch (err) {
    log.debug("propagateRefreshedCredentialToOtherAgents failed", {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type ResolveApiKeyForProfileParams = {
  cfg?: OpenClawConfig;
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
};

type SecretDefaults = NonNullable<OpenClawConfig["secrets"]>["defaults"];

function adoptNewerMainOAuthCredential(params: {
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
  cred: OAuthCredentials & { type: "oauth"; provider: string; email?: string };
}): (OAuthCredentials & { type: "oauth"; provider: string; email?: string }) | null {
  if (!params.agentDir) {
    return null;
  }
  try {
    const mainStore = ensureAuthProfileStore(undefined);
    const mainCred = mainStore.profiles[params.profileId];
    if (
      mainCred?.type === "oauth" &&
      mainCred.provider === params.cred.provider &&
      Number.isFinite(mainCred.expires) &&
      (!Number.isFinite(params.cred.expires) || mainCred.expires > params.cred.expires)
    ) {
      params.store.profiles[params.profileId] = { ...mainCred };
      saveAuthProfileStore(params.store, params.agentDir);
      log.info("adopted newer OAuth credentials from main agent", {
        profileId: params.profileId,
        agentDir: params.agentDir,
        expires: new Date(mainCred.expires).toISOString(),
      });
      return mainCred;
    }
  } catch (err) {
    // Best-effort: don't crash if main agent store is missing or unreadable.
    log.debug("adoptNewerMainOAuthCredential failed", {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

/**
 * In-memory dedup layer for OAuth token refreshes.
 *
 * OpenAI (and other providers) issue single-use refresh tokens: each refresh
 * returns a new access + refresh token pair and immediately invalidates the old
 * refresh token. When multiple concurrent requests detect an expired token and
 * each call `refreshOAuthTokenWithLock` sequentially, the second caller can
 * still hold the stale refresh token in memory and send it to the provider,
 * triggering a `refresh_token_reused` error.
 *
 * This Map ensures that within a single process only one refresh HTTP call is
 * in-flight per profile. Concurrent callers await the same Promise and receive
 * the same result (or the same error). The entry is removed once the Promise
 * settles so future refreshes are not blocked.
 */
type RefreshResult = { apiKey: string; newCredentials: OAuthCredentials } | null;

/** @internal Exported for testing only. */
export const pendingOAuthRefreshes = new Map<string, Promise<RefreshResult>>();

/** @internal Exported for testing only. */
export function oauthRefreshCacheKey(profileId: string, agentDir?: string): string {
  return agentDir ? `${profileId}\0${agentDir}` : profileId;
}

async function refreshOAuthTokenWithLock(params: {
  profileId: string;
  agentDir?: string;
}): Promise<RefreshResult> {
  const cacheKey = oauthRefreshCacheKey(params.profileId, params.agentDir);

  const inflight = pendingOAuthRefreshes.get(cacheKey);
  if (inflight) {
    log.debug("OAuth refresh dedup: awaiting in-flight refresh", {
      profileId: params.profileId,
    });
    return await inflight;
  }

  const refreshPromise = performOAuthTokenRefreshWithLock(params);
  pendingOAuthRefreshes.set(cacheKey, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    // Only delete if the map still points to our promise (guard against
    // unlikely interleaving where a later call replaced the entry).
    if (pendingOAuthRefreshes.get(cacheKey) === refreshPromise) {
      pendingOAuthRefreshes.delete(cacheKey);
    }
  }
}

async function performOAuthTokenRefreshWithLock(params: {
  profileId: string;
  agentDir?: string;
}): Promise<RefreshResult> {
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);

  return await withFileLock(authPath, AUTH_STORE_LOCK_OPTIONS, async () => {
    const store = ensureAuthProfileStore(params.agentDir);
    const cred = store.profiles[params.profileId];
    if (!cred || cred.type !== "oauth") {
      return null;
    }

    // 2026-04-30: refresh proactively with a 60s buffer so concurrent
    // processes don't all hit expiry simultaneously and race on the rotation.
    // ChatGPT's refresh tokens are one-shot — when N parallel processes each
    // notice the token expired in the same second, the first wins and the
    // others get `refresh_token_reused`. By rotating slightly early we shift
    // every individual process's "must refresh" decision out of the same
    // second, and the file lock + single-flight Map can serialize cleanly.
    const REFRESH_BUFFER_MS = 60_000;
    if (Date.now() + REFRESH_BUFFER_MS < cred.expires) {
      return {
        apiKey: await buildOAuthApiKey(cred.provider, cred),
        newCredentials: cred,
      };
    }

    const pluginRefreshed = await refreshProviderOAuthCredentialWithPlugin({
      provider: cred.provider,
      context: cred,
    });
    if (pluginRefreshed) {
      const refreshedCredentials: OAuthCredential = {
        ...cred,
        ...pluginRefreshed,
        type: "oauth",
      };
      store.profiles[params.profileId] = refreshedCredentials;
      saveAuthProfileStore(store, params.agentDir);
      return {
        apiKey: await buildOAuthApiKey(cred.provider, refreshedCredentials),
        newCredentials: refreshedCredentials,
      };
    }

    const oauthCreds: Record<string, OAuthCredentials> = { [cred.provider]: cred };
    let result: RefreshResult;
    try {
      result =
        cred.provider === "chutes"
          ? await (async () => {
              const newCredentials = await refreshChutesTokens({
                credential: cred,
              });
              return { apiKey: newCredentials.access, newCredentials };
            })()
          : await (async () => {
              const oauthProvider = resolveOAuthProvider(cred.provider);
              if (!oauthProvider) {
                return null;
              }
              if (typeof getOAuthApiKey !== "function") {
                return null;
              }
              return await getOAuthApiKey(oauthProvider, oauthCreds);
            })();
    } catch (refreshError) {
      // Detect permanently burned refresh tokens and mark the credential so
      // we don't keep retrying with a token that will never work again.
      if (isRefreshTokenBurnedError(refreshError)) {
        // 2026-04-30: Before declaring the credential burned, re-read the
        // auth-profiles.json directly from disk (bypassing all in-process
        // caches). If another process already rotated the refresh token
        // successfully, the disk-side `refresh` will differ from what we
        // tried — that means our error is a stale-token race, not a real
        // burn. In that case, adopt the disk-side credential and retry once
        // before propagating the burned state.
        const diskRaw = loadJsonFile(authPath) as
          | { profiles?: Record<string, unknown> }
          | undefined;
        const diskCredRaw = diskRaw?.profiles?.[params.profileId];
        const diskCred =
          diskCredRaw &&
          typeof diskCredRaw === "object" &&
          (diskCredRaw as { type?: string }).type === "oauth"
            ? (diskCredRaw as OAuthCredential)
            : null;
        const diskRefresh = diskCred?.refresh ?? "";
        const triedRefresh = cred.refresh ?? "";
        if (
          diskCred &&
          diskRefresh &&
          diskRefresh !== triedRefresh &&
          (!Number.isFinite(cred.expires) || (diskCred.expires ?? 0) > cred.expires)
        ) {
          log.info(
            "OAuth refresh raced — disk has newer credential from another process; adopting and retrying",
            {
              profileId: params.profileId,
              provider: cred.provider,
              triedExpires: cred.expires,
              diskExpires: diskCred.expires,
            },
          );
          // Update our in-memory store snapshot to reflect what's on disk.
          store.profiles[params.profileId] = diskCred;
          // Note: we deliberately do NOT call saveAuthProfileStore here —
          // disk is already authoritative; saving would be a no-op write
          // that bumps mtime needlessly.
          return {
            apiKey: await buildOAuthApiKey(diskCred.provider, diskCred),
            newCredentials: diskCred,
          };
        }

        log.warn("OAuth refresh token is permanently burned — clearing credential", {
          profileId: params.profileId,
          provider: cred.provider,
          error: extractErrorMessage(refreshError),
        });
        // Clear the refresh token and expire the credential so no subsequent
        // request retries with the same burned token. The user must
        // re-authenticate to get a fresh token pair.
        const burnedCredential: OAuthCredential = {
          ...cred,
          refresh: "",
          expires: 0,
          type: "oauth",
        };
        store.profiles[params.profileId] = burnedCredential;
        saveAuthProfileStore(store, params.agentDir);
        // Also propagate the burned state to sibling agents so they stop
        // retrying independently.
        propagateRefreshedCredentialToOtherAgents({
          profileId: params.profileId,
          newCredential: burnedCredential,
          sourceAgentDir: params.agentDir,
        });
      }
      throw refreshError;
    }
    if (!result) {
      return null;
    }
    const refreshedCredential: OAuthCredential = {
      ...cred,
      ...result.newCredentials,
      type: "oauth",
    };
    store.profiles[params.profileId] = refreshedCredential;
    saveAuthProfileStore(store, params.agentDir);

    // Propagate new credentials to sibling agents that share the same
    // provider/profile so they don't attempt to refresh with the now-burned
    // old refresh token.
    propagateRefreshedCredentialToOtherAgents({
      profileId: params.profileId,
      newCredential: refreshedCredential,
      sourceAgentDir: params.agentDir,
    });

    return result;
  });
}

async function tryResolveOAuthProfile(
  params: ResolveApiKeyForProfileParams,
): Promise<{ apiKey: string; provider: string; email?: string } | null> {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred || cred.type !== "oauth") {
    return null;
  }
  if (
    !isProfileConfigCompatible({
      cfg,
      profileId,
      provider: cred.provider,
      mode: cred.type,
    })
  ) {
    return null;
  }

  if (Date.now() < cred.expires) {
    return await buildOAuthProfileResult({
      provider: cred.provider,
      credentials: cred,
      email: cred.email,
    });
  }

  const refreshed = await refreshOAuthTokenWithLock({
    profileId,
    agentDir: params.agentDir,
  });
  if (!refreshed) {
    return null;
  }
  return buildApiKeyProfileResult({
    apiKey: refreshed.apiKey,
    provider: cred.provider,
    email: cred.email,
  });
}

async function resolveProfileSecretString(params: {
  profileId: string;
  provider: string;
  value: string | undefined;
  valueRef: unknown;
  refDefaults: SecretDefaults | undefined;
  configForRefResolution: OpenClawConfig;
  cache: SecretRefResolveCache;
  inlineFailureMessage: string;
  refFailureMessage: string;
}): Promise<string | undefined> {
  let resolvedValue = params.value?.trim();
  if (resolvedValue) {
    const inlineRef = coerceSecretRef(resolvedValue, params.refDefaults);
    if (inlineRef) {
      try {
        resolvedValue = await resolveSecretRefString(inlineRef, {
          config: params.configForRefResolution,
          env: process.env,
          cache: params.cache,
        });
      } catch (err) {
        log.debug(params.inlineFailureMessage, {
          profileId: params.profileId,
          provider: params.provider,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const explicitRef = coerceSecretRef(params.valueRef, params.refDefaults);
  if (!resolvedValue && explicitRef) {
    try {
      resolvedValue = await resolveSecretRefString(explicitRef, {
        config: params.configForRefResolution,
        env: process.env,
        cache: params.cache,
      });
    } catch (err) {
      log.debug(params.refFailureMessage, {
        profileId: params.profileId,
        provider: params.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return resolvedValue;
}

export async function resolveApiKeyForProfile(
  params: ResolveApiKeyForProfileParams,
): Promise<{ apiKey: string; provider: string; email?: string } | null> {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred) {
    return null;
  }
  if (
    !isProfileConfigCompatible({
      cfg,
      profileId,
      provider: cred.provider,
      mode: cred.type,
      // Compatibility: treat "oauth" config as compatible with stored token profiles.
      allowOAuthTokenCompatibility: true,
    })
  ) {
    return null;
  }

  const refResolveCache: SecretRefResolveCache = {};
  const configForRefResolution = cfg ?? loadConfig();
  const refDefaults = configForRefResolution.secrets?.defaults;
  assertNoOAuthSecretRefPolicyViolations({
    store,
    cfg: configForRefResolution,
    profileIds: [profileId],
    context: `auth profile ${profileId}`,
  });

  if (cred.type === "api_key") {
    const key = await resolveProfileSecretString({
      profileId,
      provider: cred.provider,
      value: cred.key,
      valueRef: cred.keyRef,
      refDefaults,
      configForRefResolution,
      cache: refResolveCache,
      inlineFailureMessage: "failed to resolve inline auth profile api_key ref",
      refFailureMessage: "failed to resolve auth profile api_key ref",
    });
    if (!key) {
      return null;
    }
    return buildApiKeyProfileResult({ apiKey: key, provider: cred.provider, email: cred.email });
  }
  if (cred.type === "token") {
    const expiryState = resolveTokenExpiryState(cred.expires);
    if (expiryState === "expired" || expiryState === "invalid_expires") {
      return null;
    }
    const token = await resolveProfileSecretString({
      profileId,
      provider: cred.provider,
      value: cred.token,
      valueRef: cred.tokenRef,
      refDefaults,
      configForRefResolution,
      cache: refResolveCache,
      inlineFailureMessage: "failed to resolve inline auth profile token ref",
      refFailureMessage: "failed to resolve auth profile token ref",
    });
    if (!token) {
      return null;
    }
    return buildApiKeyProfileResult({ apiKey: token, provider: cred.provider, email: cred.email });
  }

  const oauthCred =
    adoptNewerMainOAuthCredential({
      store,
      profileId,
      agentDir: params.agentDir,
      cred,
    }) ?? cred;

  if (Date.now() < oauthCred.expires) {
    return await buildOAuthProfileResult({
      provider: oauthCred.provider,
      credentials: oauthCred,
      email: oauthCred.email,
    });
  }

  try {
    const result = await refreshOAuthTokenWithLock({
      profileId,
      agentDir: params.agentDir,
    });
    if (!result) {
      return null;
    }
    return buildApiKeyProfileResult({
      apiKey: result.apiKey,
      provider: cred.provider,
      email: cred.email,
    });
  } catch (error) {
    const refreshedStore = ensureAuthProfileStore(params.agentDir);
    const refreshed = refreshedStore.profiles[profileId];
    if (refreshed?.type === "oauth" && Date.now() < refreshed.expires) {
      return await buildOAuthProfileResult({
        provider: refreshed.provider,
        credentials: refreshed,
        email: refreshed.email ?? cred.email,
      });
    }
    const fallbackProfileId = suggestOAuthProfileIdForLegacyDefault({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      legacyProfileId: profileId,
    });
    if (fallbackProfileId && fallbackProfileId !== profileId) {
      try {
        const fallbackResolved = await tryResolveOAuthProfile({
          cfg,
          store: refreshedStore,
          profileId: fallbackProfileId,
          agentDir: params.agentDir,
        });
        if (fallbackResolved) {
          return fallbackResolved;
        }
      } catch {
        // keep original error
      }
    }

    // Fallback: if this is a secondary agent, try using the main agent's credentials
    if (params.agentDir) {
      try {
        const mainStore = ensureAuthProfileStore(undefined); // main agent (no agentDir)
        const mainCred = mainStore.profiles[profileId];
        if (mainCred?.type === "oauth" && Date.now() < mainCred.expires) {
          // Main agent has fresh credentials - copy them to this agent and use them
          refreshedStore.profiles[profileId] = { ...mainCred };
          saveAuthProfileStore(refreshedStore, params.agentDir);
          log.info("inherited fresh OAuth credentials from main agent", {
            profileId,
            agentDir: params.agentDir,
            expires: new Date(mainCred.expires).toISOString(),
          });
          return await buildOAuthProfileResult({
            provider: mainCred.provider,
            credentials: mainCred,
            email: mainCred.email,
          });
        }
      } catch {
        // keep original error if main agent fallback also fails
      }
    }

    const message = extractErrorMessage(error);
    const burned = isRefreshTokenBurnedError(error);
    const hint = await formatAuthDoctorHint({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      profileId,
    });
    const burnedSuffix = burned
      ? " [OAUTH_REFRESH_TOKEN_BURNED] The refresh token has been permanently " +
        "invalidated. A full re-authentication is required — retrying will not help."
      : "";
    throw new Error(
      `OAuth token refresh failed for ${cred.provider}: ${message}. ` +
        (burned ? "Re-authentication required." : "Please try again or re-authenticate.") +
        burnedSuffix +
        (hint ? `\n\n${hint}` : ""),
      { cause: error },
    );
  }
}
