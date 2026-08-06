import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveConfigWriteRestartDecision } from "./config.js";

function cfgWithReloadMode(mode?: string): OpenClawConfig {
  if (!mode) {
    return {} as OpenClawConfig;
  }
  return { gateway: { reload: { mode } } } as unknown as OpenClawConfig;
}

describe("resolveConfigWriteRestartDecision", () => {
  it("skips restart for hot-applied paths in default (hybrid) mode", () => {
    // agents.* is a dynamic-read prefix in the reload plan; a control-UI
    // project save (agents.list) must NOT force a gateway restart.
    const decision = resolveConfigWriteRestartDecision(cfgWithReloadMode(), ["agents.list"]);
    expect(decision.restartNeeded).toBe(false);
  });

  it("schedules restart for restart-required paths in hybrid mode", () => {
    const decision = resolveConfigWriteRestartDecision(cfgWithReloadMode("hybrid"), [
      "gateway.bind",
    ]);
    expect(decision.restartNeeded).toBe(true);
    expect(decision.reason).toContain("gateway.bind");
  });

  it("never schedules restart in hot mode, even for restart-required paths", () => {
    // Operator explicitly opted out of automatic restarts. Incident
    // 2026-08-04: a forced restart aborted a live agent run mid handoff.
    const dynamic = resolveConfigWriteRestartDecision(cfgWithReloadMode("hot"), ["agents.list"]);
    expect(dynamic.restartNeeded).toBe(false);
    const restartRequired = resolveConfigWriteRestartDecision(cfgWithReloadMode("hot"), [
      "gateway.bind",
    ]);
    expect(restartRequired.restartNeeded).toBe(false);
    expect(restartRequired.reason).toContain("manual restart");
  });

  it("always schedules restart when the reloader is off", () => {
    const decision = resolveConfigWriteRestartDecision(cfgWithReloadMode("off"), ["agents.list"]);
    expect(decision.restartNeeded).toBe(true);
  });

  it("always schedules restart in restart mode", () => {
    const decision = resolveConfigWriteRestartDecision(cfgWithReloadMode("restart"), [
      "agents.list",
    ]);
    expect(decision.restartNeeded).toBe(true);
  });

  it("treats hot-rule paths (hooks, cron, models) as no-restart in hybrid mode", () => {
    const decision = resolveConfigWriteRestartDecision(cfgWithReloadMode("hybrid"), [
      "hooks.gmail.account",
      "cron.jobs",
      "models.providers",
    ]);
    expect(decision.restartNeeded).toBe(false);
  });
});
