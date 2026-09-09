import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { collectEnabledInsecureOrDangerousFlags } from "../security/dangerous-config-flags.js";

// Narrow, static mock: pin the on-disk exec-approvals.json out of the picture so
// results do not depend on the host machine. Deliberately does NOT mock
// ../config/config.js — loadConfig is used repo-wide, and mocking it here leaked
// into sibling pi-tools/bash-tools files sharing a worker. The config comes in
// through the function's own `cfg` injection seam instead.
const mocks = vi.hoisted(() => ({
  resolveExecApprovals: vi.fn(() => ({
    agent: { security: "allowlist", ask: "on-miss", askFallback: "deny" },
  })),
}));

vi.mock("../infra/exec-approvals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/exec-approvals.js")>();
  return { ...actual, resolveExecApprovals: mocks.resolveExecApprovals };
});

let resolveExecHostApprovalContext: typeof import("./bash-tools.exec-host-shared.js").resolveExecHostApprovalContext;

beforeAll(async () => {
  ({ resolveExecHostApprovalContext } = await import("./bash-tools.exec-host-shared.js"));
});

function cfgWith(autoApprove?: string): OpenClawConfig {
  return { approvals: autoApprove ? { autoApprove } : {} } as unknown as OpenClawConfig;
}

describe("approvals.autoApprove and the exec host policy", () => {
  it("leaves the policy untouched by default", () => {
    const ctx = resolveExecHostApprovalContext({
      security: "allowlist",
      ask: "on-miss",
      host: "gateway",
      cfg: cfgWith(),
    });
    expect(ctx.autoApprove).toBe(false);
    expect(ctx.hostSecurity).toBe("allowlist");
    expect(ctx.hostAsk).toBe("on-miss");
    expect(ctx.askFallback).toBe("deny");
  });

  it("resolves to full/off/full when set to non-spend", () => {
    const ctx = resolveExecHostApprovalContext({
      security: "allowlist",
      ask: "always",
      host: "gateway",
      cfg: cfgWith("non-spend"),
    });
    expect(ctx.autoApprove).toBe(true);
    expect(ctx.hostSecurity).toBe("full");
    expect(ctx.hostAsk).toBe("off");
    // askFallback matters because an approval that somehow still gets raised
    // must not hard-deny on timeout in an unattended run.
    expect(ctx.askFallback).toBe("full");
  });

  it('treats "off" exactly like an absent key', () => {
    const ctx = resolveExecHostApprovalContext({
      security: "allowlist",
      ask: "on-miss",
      host: "gateway",
      cfg: cfgWith("off"),
    });
    expect(ctx.autoApprove).toBe(false);
    expect(ctx.hostSecurity).toBe("allowlist");
  });

  it("still refuses an explicit security=deny", () => {
    // Auto-approve is about not stalling on a prompt. It must never turn a
    // deliberate "never run exec here" into permission.
    expect(() =>
      resolveExecHostApprovalContext({
        security: "deny",
        ask: "off",
        host: "gateway",
        cfg: cfgWith("non-spend"),
      }),
    ).toThrow(/exec denied/);
  });

  it("applies to the node host too", () => {
    const ctx = resolveExecHostApprovalContext({
      security: "allowlist",
      ask: "always",
      host: "node",
      cfg: cfgWith("non-spend"),
    });
    expect(ctx.autoApprove).toBe(true);
    expect(ctx.hostAsk).toBe("off");
  });
});

describe("dangerous config flags", () => {
  it("reports autoApprove=non-spend", () => {
    expect(collectEnabledInsecureOrDangerousFlags(cfgWith("non-spend"))).toContain(
      "approvals.autoApprove=non-spend",
    );
  });

  it("stays quiet when off or absent", () => {
    expect(collectEnabledInsecureOrDangerousFlags(cfgWith("off"))).not.toContain(
      "approvals.autoApprove=non-spend",
    );
    expect(collectEnabledInsecureOrDangerousFlags({} as OpenClawConfig)).toEqual([]);
  });
});
