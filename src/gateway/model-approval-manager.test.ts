import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelApprovalRequestPayload } from "../infra/model-approvals.js";
import { ModelApprovalManager } from "./model-approval-manager.js";

const REQUEST: ModelApprovalRequestPayload = {
  provider: "openrouter",
  model: "some-model",
  reasonKind: "fallback",
  sessionKey: "agent:main:test",
};

describe("ModelApprovalManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("creates records with generated and explicit ids", () => {
    const manager = new ModelApprovalManager();
    const generated = manager.create(REQUEST, 1_000);
    expect(generated.id.length).toBeGreaterThan(0);
    const explicit = manager.create(REQUEST, 1_000, "model:abc");
    expect(explicit.id).toBe("model:abc");
    expect(explicit.expiresAtMs).toBe(explicit.createdAtMs + 1_000);
  });

  it("resolves a registered approval with the full decision object", async () => {
    const manager = new ModelApprovalManager();
    const record = manager.create(REQUEST, 10_000, "model:resolve");
    const decisionPromise = manager.register(record, 10_000);

    const ok = manager.resolve(
      "model:resolve",
      { kind: "approve", dontAskAgain: true, switchTo: { provider: "anthropic", model: "m" } },
      "tester",
    );
    expect(ok).toBe(true);
    await expect(decisionPromise).resolves.toEqual({
      kind: "approve",
      dontAskAgain: true,
      switchTo: { provider: "anthropic", model: "m" },
    });
    expect(manager.getSnapshot("model:resolve")?.resolvedBy).toBe("tester");
    // Double-resolve is rejected.
    expect(manager.resolve("model:resolve", { kind: "deny" })).toBe(false);
  });

  it("returns null on timeout", async () => {
    const manager = new ModelApprovalManager();
    const record = manager.create(REQUEST, 1_000, "model:timeout");
    const decisionPromise = manager.register(record, 1_000);
    vi.advanceTimersByTime(1_000);
    await expect(decisionPromise).resolves.toBeNull();
    expect(manager.resolve("model:timeout", { kind: "approve" })).toBe(false);
  });

  it("expires pending approvals explicitly", async () => {
    const manager = new ModelApprovalManager();
    const record = manager.create(REQUEST, 10_000, "model:expire");
    const decisionPromise = manager.register(record, 10_000);
    expect(manager.expire("model:expire", "no-approval-route")).toBe(true);
    await expect(decisionPromise).resolves.toBeNull();
    expect(manager.getSnapshot("model:expire")?.resolvedBy).toBe("no-approval-route");
    expect(manager.expire("model:expire")).toBe(false);
  });

  it("awaitDecision returns the pending promise and null for unknown ids", async () => {
    const manager = new ModelApprovalManager();
    const record = manager.create(REQUEST, 10_000, "model:wait");
    const registered = manager.register(record, 10_000);
    const awaited = manager.awaitDecision("model:wait");
    expect(awaited).toBe(registered);
    expect(manager.awaitDecision("model:unknown")).toBeNull();
    manager.resolve("model:wait", { kind: "deny" });
    await expect(awaited).resolves.toEqual({ kind: "deny" });
  });

  it("looks up pending ids by exact match and prefix", () => {
    const manager = new ModelApprovalManager();
    manager.register(manager.create(REQUEST, 10_000, "model:aaa1"), 10_000);
    manager.register(manager.create(REQUEST, 10_000, "model:aab2"), 10_000);

    expect(manager.lookupPendingId("model:aaa1")).toEqual({ kind: "exact", id: "model:aaa1" });
    expect(manager.lookupPendingId("model:aaa")).toEqual({ kind: "prefix", id: "model:aaa1" });
    expect(manager.lookupPendingId("model:aa")).toEqual({
      kind: "ambiguous",
      ids: ["model:aaa1", "model:aab2"],
    });
    expect(manager.lookupPendingId("nope")).toEqual({ kind: "none" });
    expect(manager.lookupPendingId("  ")).toEqual({ kind: "none" });
  });
});
