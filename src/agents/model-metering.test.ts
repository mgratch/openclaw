import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "./auth-profiles.js";
import { AUTH_STORE_VERSION } from "./auth-profiles/constants.js";
import { classifyProviderBilling } from "./model-metering.js";

function makeStore(profiles: AuthProfileStore["profiles"]): AuthProfileStore {
  return {
    version: AUTH_STORE_VERSION,
    profiles,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("classifyProviderBilling", () => {
  it("classifies api_key-backed providers as metered", () => {
    const store = makeStore({
      "acme:default": { type: "api_key", provider: "acme", key: "sk-test" },
    });
    expect(classifyProviderBilling({ provider: "acme", store })).toBe("metered");
  });

  it("classifies token-backed providers as plan when the token profile is first in order", () => {
    // Round-robin ordering prefers token over api_key, so the token profile
    // decides even when an api_key profile also exists.
    const store = makeStore({
      "acme:key": { type: "api_key", provider: "acme", key: "sk-test" },
      "acme:token": { type: "token", provider: "acme", token: "tok-test" },
    });
    expect(classifyProviderBilling({ provider: "acme", store })).toBe("plan");
  });

  it("skips Claude Code OAuth tokens (sk-ant-oat...) — ACP-only, cannot serve direct inference", () => {
    const store = makeStore({
      "anthropic:sub": { type: "token", provider: "anthropic", token: "sk-ant-oat01-deadbeef" },
      "anthropic:key": { type: "api_key", provider: "anthropic", key: "sk-ant-api03-test" },
    });
    expect(classifyProviderBilling({ provider: "anthropic", store })).toBe("metered");
  });

  it("returns unknown when only a Claude Code OAuth token exists and no env key", () => {
    const store = makeStore({
      "anthropic:sub": { type: "token", provider: "anthropic", token: "sk-ant-oat01-deadbeef" },
    });
    expect(classifyProviderBilling({ provider: "anthropic", store })).toBe("unknown");
  });

  it("classifies oauth-backed providers as plan", () => {
    const store = makeStore({
      "acme:oauth": {
        type: "oauth",
        provider: "acme",
        access: "at",
        refresh: "rt",
        expires: Date.now() + 3_600_000,
      },
    });
    expect(classifyProviderBilling({ provider: "acme", store })).toBe("plan");
  });

  it("skips expired token profiles and falls through to an api_key profile", () => {
    const store = makeStore({
      "acme:key": { type: "api_key", provider: "acme", key: "sk-test" },
      "acme:token": {
        type: "token",
        provider: "acme",
        token: "tok-test",
        expires: Date.now() - 60_000,
      },
    });
    expect(classifyProviderBilling({ provider: "acme", store })).toBe("metered");
  });

  it("classifies expired-token providers as metered when only an env api key remains", () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    const store = makeStore({
      "groq:token": {
        type: "token",
        provider: "groq",
        token: "tok-test",
        expires: Date.now() - 60_000,
      },
    });
    expect(classifyProviderBilling({ provider: "groq", store })).toBe("metered");
  });

  it("returns unknown when the only profile is an expired token and nothing else resolves", () => {
    const store = makeStore({
      "no-such-provider-xyz:token": {
        type: "token",
        provider: "no-such-provider-xyz",
        token: "tok-test",
        expires: Date.now() - 60_000,
      },
    });
    expect(classifyProviderBilling({ provider: "no-such-provider-xyz", store })).toBe("unknown");
  });

  it("keeps tokens without an expiry treated as live plan credentials", () => {
    const store = makeStore({
      "acme:key": { type: "api_key", provider: "acme", key: "sk-test" },
      "acme:token": { type: "token", provider: "acme", token: "tok-test" },
    });
    expect(classifyProviderBilling({ provider: "acme", store })).toBe("plan");
  });

  it("keeps expired oauth profiles with a refresh token treated as plan (refreshable)", () => {
    const store = makeStore({
      "acme:key": { type: "api_key", provider: "acme", key: "sk-test" },
      "acme:oauth": {
        type: "oauth",
        provider: "acme",
        access: "at",
        refresh: "rt",
        expires: Date.now() - 60_000,
      },
    });
    expect(classifyProviderBilling({ provider: "acme", store })).toBe("plan");
  });

  it("skips expired oauth profiles without a refresh token", () => {
    const store = makeStore({
      "acme:key": { type: "api_key", provider: "acme", key: "sk-test" },
      "acme:oauth": {
        type: "oauth",
        provider: "acme",
        access: "at",
        refresh: "",
        expires: Date.now() - 60_000,
      },
    });
    expect(classifyProviderBilling({ provider: "acme", store })).toBe("metered");
  });

  it("falls back to env api keys as metered when no store profile matches", () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    const store = makeStore({});
    expect(classifyProviderBilling({ provider: "groq", store })).toBe("metered");
  });

  it("treats env OAUTH_TOKEN sources as plan", () => {
    vi.stubEnv("CHUTES_OAUTH_TOKEN", "oauth-test");
    const store = makeStore({});
    expect(classifyProviderBilling({ provider: "chutes", store })).toBe("plan");
  });

  it("returns unknown when nothing resolves", () => {
    const store = makeStore({});
    expect(classifyProviderBilling({ provider: "no-such-provider-xyz", store })).toBe("unknown");
  });

  it("returns unknown for a missing provider", () => {
    expect(classifyProviderBilling({ provider: "  ", store: makeStore({}) })).toBe("unknown");
    expect(classifyProviderBilling({ store: makeStore({}) })).toBe("unknown");
  });
});
