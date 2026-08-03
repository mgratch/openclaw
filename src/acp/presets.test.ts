import { describe, expect, it } from "vitest";
import {
  ACP_MODEL_PRESETS,
  isAcpModelPreset,
  resolveAcpModelPreset,
  resolvePerTurnAcpModel,
} from "./presets.js";

describe("ACP model presets", () => {
  it("exposes at least claude-code variants", () => {
    const ids = ACP_MODEL_PRESETS.map((p) => p.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("claude-code-opus");
    expect(ids).toContain("claude-code-opus-4-8");
    expect(ids).toContain("claude-code-opus-5");
    expect(ids).toContain("claude-code-fable");
    expect(ids).toContain("claude-code-sonnet");
    expect(ids).toContain("claude-code-haiku");
  });

  it("pins the CLI-2.1.220 presets to their exact acpx model ids", () => {
    // These IDs are forwarded verbatim to the bundled Claude Code CLI —
    // an unknown ID must fail visibly there, never be silently remapped.
    expect(resolveAcpModelPreset("claude-code-opus-4-8")?.acpxModel).toBe("claude-opus-4-8");
    expect(resolveAcpModelPreset("claude-code-opus-5")?.acpxModel).toBe("claude-opus-5");
    expect(resolveAcpModelPreset("claude-code-fable")?.acpxModel).toBe("claude-fable-5");
    // All three support extended thinking (mirrors claude-code-opus-4-6).
    for (const id of ["claude-code-opus-4-8", "claude-code-opus-5", "claude-code-fable"]) {
      expect(resolveAcpModelPreset(id)?.maxThinkingTokens).toBe(16000);
    }
  });

  it("every preset resolves to claude-code agent (current roster)", () => {
    for (const preset of ACP_MODEL_PRESETS) {
      expect(preset.agent).toBe("claude-code");
      expect(preset.id).toMatch(/^claude-code/);
    }
  });

  it("resolveAcpModelPreset handles missing / unknown ids", () => {
    expect(resolveAcpModelPreset(undefined)).toBeUndefined();
    expect(resolveAcpModelPreset("")).toBeUndefined();
    expect(resolveAcpModelPreset("   ")).toBeUndefined();
    expect(resolveAcpModelPreset("gpt-5.4")).toBeUndefined();
    expect(resolveAcpModelPreset("claude-code")?.id).toBe("claude-code");
    expect(resolveAcpModelPreset(" claude-code-opus ")?.id).toBe("claude-code-opus");
  });

  it("isAcpModelPreset mirrors the resolver", () => {
    expect(isAcpModelPreset("claude-code")).toBe(true);
    expect(isAcpModelPreset("claude-code-opus")).toBe(true);
    expect(isAcpModelPreset("openai/gpt-5.4")).toBe(false);
    expect(isAcpModelPreset(undefined)).toBe(false);
  });
});

describe("resolvePerTurnAcpModel", () => {
  it("passes through non-preset overrides unchanged", () => {
    const result = resolvePerTurnAcpModel({
      modelOverride: "openai/gpt-5.4",
      sessionAgent: "codex",
    });
    expect(result.model).toBe("openai/gpt-5.4");
    expect(result.preset).toBeUndefined();
    expect(result.agentMismatch).toBeUndefined();
  });

  it("returns the acpx model flag when preset agent matches session agent", () => {
    const result = resolvePerTurnAcpModel({
      modelOverride: "claude-code-opus",
      sessionAgent: "claude-code",
    });
    // claude-code-opus pins claude-opus-4-7 (see presets.ts note).
    expect(result.model).toBe("claude-opus-4-7");
    expect(result.preset?.id).toBe("claude-code-opus");
    expect(result.agentMismatch).toBeUndefined();
  });

  it("returns undefined (= agent default) for bare claude-code preset", () => {
    const result = resolvePerTurnAcpModel({
      modelOverride: "claude-code",
      sessionAgent: "claude-code",
    });
    expect(result.model).toBeUndefined();
    expect(result.preset?.id).toBe("claude-code");
  });

  it("flags agent mismatch when session agent differs from preset agent", () => {
    const result = resolvePerTurnAcpModel({
      modelOverride: "claude-code-opus",
      sessionAgent: "codex",
    });
    expect(result.agentMismatch).toBe(true);
    expect(result.preset?.id).toBe("claude-code-opus");
    // Caller can choose what to do; resolver returns the raw override so
    // the dispatcher doesn't silently drop the user's selection.
    expect(result.model).toBe("claude-code-opus");
  });

  it("treats missing sessionAgent as implicit match (spawn-time resolution)", () => {
    const result = resolvePerTurnAcpModel({
      modelOverride: "claude-code-sonnet",
      sessionAgent: undefined,
    });
    expect(result.agentMismatch).toBeUndefined();
    expect(result.model).toBe("claude-sonnet-4-6");
  });
});
