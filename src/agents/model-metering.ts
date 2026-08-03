import type { OpenClawConfig } from "../config/config.js";
import { loadSessionStore } from "../config/sessions.js";
import type { AgentRunContext } from "../infra/agent-events.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import { resolveAuthProfileOrder } from "./auth-profiles.js";
import { resolveEnvApiKey } from "./model-auth.js";
import { normalizeProviderId } from "./model-selection.js";

/**
 * Billing classification for a provider's effective auth:
 * - "metered": auth resolves to an API key (pay-per-token).
 * - "plan": auth resolves to a token/oauth credential (plan-backed).
 * - "unknown": no confident signal — NEVER gated (fail open).
 */
export type ModelBillingClass = "metered" | "plan" | "unknown";

/**
 * Classify how a provider's requests would be billed, mirroring the profile
 * walk in `resolveModelAuthLabel` (model-auth-label.ts): the FIRST profile in
 * `resolveAuthProfileOrder` whose credential exists in the store decides. When
 * no store profile matches, fall through to env detection like
 * `resolveModelAuthMode` does.
 */
export function classifyProviderBilling(params: {
  cfg?: OpenClawConfig;
  provider?: string;
  store?: AuthProfileStore | null;
}): ModelBillingClass {
  const resolvedProvider = params.provider?.trim();
  if (!resolvedProvider) {
    return "unknown";
  }
  const providerKey = normalizeProviderId(resolvedProvider);

  const store = params.store;
  if (store) {
    const order = resolveAuthProfileOrder({
      cfg: params.cfg,
      store,
      provider: providerKey,
    });
    for (const profileId of order) {
      const profile = store.profiles[profileId];
      if (!profile || normalizeProviderId(profile.provider) !== providerKey) {
        continue;
      }
      if (profile.type === "api_key") {
        return "metered";
      }
      if (profile.type === "token" || profile.type === "oauth") {
        // Claude Code OAuth tokens (sk-ant-oat...) cannot serve direct
        // anthropic-messages inference: the anthropic client sends creds as
        // `x-api-key` (no `authHeader: true` on the provider, and messages
        // requires the oauth beta header + Bearer). Such profiles exist for
        // the usage-dashboard fetcher and ACP flows only — the runtime 401s
        // on them and rotates onto the env API key. Skip them so direct
        // anthropic traffic classifies as what it actually bills: metered.
        if (profile.type === "token" && profile.token?.trim().startsWith("sk-ant-oat")) {
          continue;
        }
        // An expired, non-refreshable plan credential cannot serve requests:
        // the runtime will rotate past it (possibly onto an env API key), so
        // keep walking to the next profile instead of declaring "plan".
        // `expires` of null/undefined means "cannot know" and stays treated
        // as live. OAuth profiles with a refresh token can mint a fresh
        // access token at dial time, so a past `expires` does not make them
        // dead. This only narrows the classifier's blind spot; the dial-time
        // gate in the embedded-run auth controller is the real enforcement.
        const expires = profile.expires;
        const expired = typeof expires === "number" && expires > 0 && expires < Date.now();
        const refreshable = profile.type === "oauth" && Boolean(profile.refresh?.trim());
        if (expired && !refreshable) {
          continue;
        }
        return "plan";
      }
    }
  }

  const envKey = resolveEnvApiKey(providerKey);
  if (envKey?.apiKey) {
    // OAuth tokens surfaced through env vars are plan-backed, not metered.
    return envKey.source.includes("OAUTH_TOKEN") ? "plan" : "metered";
  }

  return "unknown";
}

/**
 * Resolve the per-session "don't ask again" flag for metered approvals.
 * Reads the cached run-context value first, then lazily re-reads the session
 * entry — the gateway resolve handler persists the flag out-of-band, possibly
 * after this run's context was registered. Shared by the chain-level gate
 * (model-fallback.ts) and the dial-time gate (pi-embedded-runner
 * auth-controller.ts).
 */
export function resolveMeteredAutoApprove(runCtx: AgentRunContext): boolean {
  if (runCtx.meteredAutoApprove === true) {
    return true;
  }
  if (runCtx.meteredAutoApprove === undefined && runCtx.storePath && runCtx.sessionKey) {
    try {
      const entry = loadSessionStore(runCtx.storePath)[runCtx.sessionKey];
      if (entry?.meteredAutoApprove === true) {
        runCtx.meteredAutoApprove = true;
        return true;
      }
    } catch {
      // Unreadable store: fall through to the normal approval path.
    }
  }
  return false;
}
