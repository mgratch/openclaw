import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { oauthRefreshCacheKey, pendingOAuthRefreshes } from "./oauth.js";

describe("OAuth refresh dedup layer", () => {
  afterEach(() => {
    pendingOAuthRefreshes.clear();
  });

  describe("oauthRefreshCacheKey", () => {
    it("returns profileId when no agentDir", () => {
      expect(oauthRefreshCacheKey("openai-codex:default")).toBe("openai-codex:default");
    });

    it("returns profileId with agentDir separator", () => {
      expect(oauthRefreshCacheKey("openai-codex:default", "/home/node/.openclaw/agents/r2c")).toBe(
        "openai-codex:default\0/home/node/.openclaw/agents/r2c",
      );
    });

    it("produces distinct keys for different agentDirs", () => {
      const a = oauthRefreshCacheKey("openai-codex:default", "/agents/a");
      const b = oauthRefreshCacheKey("openai-codex:default", "/agents/b");
      expect(a).not.toBe(b);
    });

    it("produces distinct keys for different profileIds", () => {
      const a = oauthRefreshCacheKey("openai-codex:default");
      const b = oauthRefreshCacheKey("openai-codex:other");
      expect(a).not.toBe(b);
    });
  });

  describe("pendingOAuthRefreshes map", () => {
    it("starts empty", () => {
      expect(pendingOAuthRefreshes.size).toBe(0);
    });

    it("can store and retrieve a pending promise", async () => {
      const promise = Promise.resolve(null);
      const key = oauthRefreshCacheKey("test:profile");
      pendingOAuthRefreshes.set(key, promise);
      expect(pendingOAuthRefreshes.get(key)).toBe(promise);
    });

    it("dedup semantics: same key returns same promise reference", () => {
      const promise = Promise.resolve(null);
      const key = oauthRefreshCacheKey("test:profile");
      pendingOAuthRefreshes.set(key, promise);

      // Simulate two callers checking the map
      const caller1 = pendingOAuthRefreshes.get(key);
      const caller2 = pendingOAuthRefreshes.get(key);
      expect(caller1).toBe(caller2);
      expect(caller1).toBe(promise);
    });

    it("entries are independent per profile", () => {
      const promiseA = Promise.resolve(null);
      const promiseB = Promise.resolve(null);
      const keyA = oauthRefreshCacheKey("profile:a");
      const keyB = oauthRefreshCacheKey("profile:b");

      pendingOAuthRefreshes.set(keyA, promiseA);
      pendingOAuthRefreshes.set(keyB, promiseB);

      expect(pendingOAuthRefreshes.get(keyA)).toBe(promiseA);
      expect(pendingOAuthRefreshes.get(keyB)).toBe(promiseB);
      expect(promiseA).not.toBe(promiseB);
    });

    it("cleanup after settlement allows new refresh", async () => {
      const key = oauthRefreshCacheKey("test:profile");

      // First refresh settles
      const firstPromise = Promise.resolve(null);
      pendingOAuthRefreshes.set(key, firstPromise);
      await firstPromise;
      pendingOAuthRefreshes.delete(key);

      // New refresh should be allowed (not deduped)
      const secondPromise = Promise.resolve(null);
      pendingOAuthRefreshes.set(key, secondPromise);
      expect(pendingOAuthRefreshes.get(key)).toBe(secondPromise);
      expect(secondPromise).not.toBe(firstPromise);
    });

    it("rejected promise does not block future refreshes after cleanup", async () => {
      const key = oauthRefreshCacheKey("test:profile");

      const failedPromise = Promise.reject(new Error("refresh_token_reused"));
      pendingOAuthRefreshes.set(key, failedPromise);

      // Suppress unhandled rejection
      await failedPromise.catch(() => {});

      // Cleanup after failure
      pendingOAuthRefreshes.delete(key);

      // New refresh should work
      expect(pendingOAuthRefreshes.has(key)).toBe(false);
      const retryPromise = Promise.resolve(null);
      pendingOAuthRefreshes.set(key, retryPromise);
      expect(pendingOAuthRefreshes.get(key)).toBe(retryPromise);
    });
  });
});
