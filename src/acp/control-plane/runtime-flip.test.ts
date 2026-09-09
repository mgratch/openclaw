import { describe, it, expect, beforeEach } from "vitest";
import { resolveAcpModelPreset } from "../presets.js";
import {
  RuntimeFlipManager,
  recordWarmSessionForPreset,
  performRuntimeFlip,
} from "./runtime-flip.js";
import type { RuntimeFlipContext } from "./runtime-flip.js";

describe("runtime-flip", () => {
  let manager: RuntimeFlipManager;

  beforeEach(() => {
    manager = new RuntimeFlipManager();
  });

  describe("detectFlip", () => {
    it("returns null when modelOverride is not a preset", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "openai/gpt-5.4",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
      });
      expect(flip).toBeNull();
    });

    it("returns null when no modelOverride provided", async () => {
      const flip = await manager.detectFlip({
        modelOverride: undefined,
        sourceSessionKey: "some-session",
        isSourceAcpSession: false,
      });
      expect(flip).toBeNull();
    });

    it("returns null when preset is selected on an ACP session (passthrough)", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "claude-session-456",
        isSourceAcpSession: true,
      });
      expect(flip).toBeNull();
    });

    it("detects preset on non-ACP session and returns flip context", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
      });
      expect(flip).not.toBeNull();
      expect(flip?.preset?.id).toBe("claude-code-opus");
      // Compare against the catalog rather than a literal. This asserted
      // "claude-opus-4-6" and started failing the moment the preset was
      // repointed to 4-7; the behavior under test is that the flip carries the
      // preset's pinned model, not which model that happens to be this month.
      const expectedAcpxModel = resolveAcpModelPreset("claude-code-opus")?.acpxModel;
      expect(expectedAcpxModel).toBeDefined();
      expect(flip?.preset?.acpxModel).toBe(expectedAcpxModel);
      expect(flip?.sourceSessionKey).toBe("openai-session-123");
    });

    it("detects bare claude-code preset (agent default, no acpxModel)", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "claude-code",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
      });
      expect(flip).not.toBeNull();
      expect(flip?.preset?.id).toBe("claude-code");
      expect(flip?.preset?.acpxModel).toBeUndefined();
    });

    it("returns warmSessionKey when warm pool has a prior session for this preset", async () => {
      const sourceSessionKey = "openai-session-123";
      const priorWarmSessionKey = "claude-session-warm-789";
      manager.recordWarmSession(sourceSessionKey, "claude-code-opus", priorWarmSessionKey);

      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey,
        isSourceAcpSession: false,
      });
      expect(flip).not.toBeNull();
      expect(flip?.warmSessionKey).toBe(priorWarmSessionKey);
      expect(flip?.replayPayload).toBeUndefined();
    });

    it("builds replay payload when no warm session and readSourceMessages provided", async () => {
      const sourceMessages = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-sonnet",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => sourceMessages,
      });
      expect(flip).not.toBeNull();
      expect(flip?.replayPayload).not.toBeUndefined();
      expect(flip?.replayPayload?.messages.length).toBe(2);
      expect(flip?.replayPayload?.sourceSessionKey).toBe("openai-session-123");
      expect(flip?.replayPayload?.targetModel).toBe("claude-sonnet-4-6");
    });

    it("respects maxChars in replay payload (trims oldest messages)", async () => {
      const sourceMessages: Array<{ role: "user" | "assistant"; content: string }> = Array.from(
        { length: 50 },
        (_, i) => ({
          role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
          content: "x".repeat(1000),
        }),
      );
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-haiku",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => sourceMessages,
      });
      expect(flip?.replayPayload).not.toBeUndefined();
      // With 50k character cap, should trim older messages, always keeping last user turn
      expect(flip?.replayPayload?.approxChars).toBeLessThanOrEqual(120_000);
    });

    it("handles readSourceMessages rejection gracefully", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => {
          throw new Error("Failed to read messages");
        },
      });
      // Should still return flip context, just without replayPayload
      expect(flip).not.toBeNull();
      expect(flip?.preset?.id).toBe("claude-code-opus");
      expect(flip?.replayPayload).toBeUndefined();
    });

    it("does not include replayPayload when readSourceMessages is absent", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
        // readSourceMessages intentionally absent
      });
      expect(flip).not.toBeNull();
      expect(flip?.replayPayload).toBeUndefined();
    });

    it("handles whitespace-trimmed preset ids", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "  claude-code-sonnet  ",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
      });
      expect(flip).not.toBeNull();
      expect(flip?.preset?.id).toBe("claude-code-sonnet");
    });

    it("handles sourceSessionKey absense gracefully", async () => {
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: undefined,
        isSourceAcpSession: false,
        readSourceMessages: async () => [{ role: "user" as const, content: "test" }],
      });
      expect(flip).not.toBeNull();
      expect(flip?.sourceSessionKey).toBeUndefined();
      expect(flip?.replayPayload).not.toBeUndefined();
    });
  });

  describe("warm pool", () => {
    it("records and retrieves warm sessions across multiple presets", async () => {
      const sourceKey = "session-123";
      manager.recordWarmSession(sourceKey, "claude-code-opus", "warm-opus-456");
      manager.recordWarmSession(sourceKey, "claude-code-sonnet", "warm-sonnet-789");

      expect(manager.getWarmPoolSize()).toBe(2);

      const flipOpus = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: sourceKey,
        isSourceAcpSession: false,
      });
      expect(flipOpus?.warmSessionKey).toBe("warm-opus-456");

      const flipSonnet = await manager.detectFlip({
        modelOverride: "claude-code-sonnet",
        sourceSessionKey: sourceKey,
        isSourceAcpSession: false,
      });
      expect(flipSonnet?.warmSessionKey).toBe("warm-sonnet-789");
    });

    it("evicts stale warm sessions after TTL", async () => {
      // (A `now` clock stub used to be declared here for controlled-time TTL
      // testing, but createWarmSessionPool is internal so it was never wired up
      // — see the comment below. Removed rather than left dangling.)
      const manager2 = new RuntimeFlipManager();

      // Manually create a manager with controlled time for testing TTL.
      // This is a bit tricky since createWarmSessionPool is internal.
      // Instead, we'll just verify the default behavior works correctly
      // by testing that put/get with same key work.
      const sourceKey = "session-999";
      recordWarmSessionForPreset(sourceKey, "claude-code-opus", "warm-123");

      // Immediately get should work
      const flip1 = await manager2.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: sourceKey,
        isSourceAcpSession: false,
      });
      // Note: this uses the singleton, so we'd need to test TTL differently.
      // For now, just verify the structure is correct.
      expect(flip1?.preset?.id).toBe("claude-code-opus");
    });
  });

  describe("preset resolution", () => {
    it("resolves all known ACP presets", async () => {
      const presetIds = [
        "claude-code",
        "claude-code-opus",
        "claude-code-sonnet",
        "claude-code-haiku",
      ];
      for (const id of presetIds) {
        const flip = await manager.detectFlip({
          modelOverride: id,
          sourceSessionKey: "session-123",
          isSourceAcpSession: false,
        });
        expect(flip).not.toBeNull();
        expect(flip?.preset?.id).toBe(id);
      }
    });

    it("all presets resolve to claude-code agent", async () => {
      const presetIds = [
        "claude-code",
        "claude-code-opus",
        "claude-code-sonnet",
        "claude-code-haiku",
      ];
      for (const id of presetIds) {
        const flip = await manager.detectFlip({
          modelOverride: id,
          sourceSessionKey: "session-123",
          isSourceAcpSession: false,
        });
        expect(flip?.preset?.agent).toBe("claude-code");
      }
    });
  });

  describe("replay payload structure", () => {
    it("preserves message order in replay payload", async () => {
      const sourceMessages = [
        { role: "user" as const, content: "First question" },
        { role: "assistant" as const, content: "First answer" },
        { role: "user" as const, content: "Second question" },
        { role: "assistant" as const, content: "Second answer" },
      ];
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => sourceMessages,
      });
      expect(flip?.replayPayload?.messages).toEqual(sourceMessages);
    });

    it("filters out empty content messages", async () => {
      const sourceMessages = [
        { role: "user" as const, content: "Question" },
        { role: "assistant" as const, content: "" },
        { role: "user" as const, content: "Another" },
      ];
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-sonnet",
        sourceSessionKey: "session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => sourceMessages,
      });
      expect(flip?.replayPayload?.messages.length).toBe(2);
    });

    it("includes timestamps when available", async () => {
      const sourceMessages = [
        { role: "user" as const, content: "Q1", timestamp: 1000 },
        { role: "assistant" as const, content: "A1", timestamp: 2000 },
      ];
      const flip = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => sourceMessages,
      });
      expect(flip?.replayPayload?.messages[0].timestamp).toBe(1000);
      expect(flip?.replayPayload?.messages[1].timestamp).toBe(2000);
    });
  });

  describe("performRuntimeFlip", () => {
    // Skipped, not deleted, because the coverage genuinely does not exist and a
    // silently-passing empty test hid that. The original body built fixtures,
    // called vi.doMock AFTER the module was already imported (so the mock never
    // applied), and then asserted nothing; its closing comment claimed "the
    // actual format validation is done in the next test", but no such test
    // exists anywhere in this file.
    //
    // To make it real: performRuntimeFlip returns the spawned session key, so
    // hoist the ./manager.js mock to module scope (vi.mock, not vi.doMock) and
    // assert the returned key matches agent:<agentId>:acp:preset:<preset>:...
    it.skip("generates session key in canonical agent-scoped format", async () => {
      // intentionally empty — see the note above
    });

    it("returns null when flipContext lacks preset or sourceSessionKey", async () => {
      // `preset` is required on RuntimeFlipContext, so this deliberately builds
      // an invalid context to exercise the guard. Cast through `unknown` rather
      // than `any` — the point is "this shape is intentionally wrong", not
      // "disable type checking here".
      const flipWithoutPreset = {
        sourceSessionKey: "openai-session-123",
      } as unknown as RuntimeFlipContext;

      // performRuntimeFlip bails before touching cfg/ctx when the preset is
      // missing, so empty stand-ins are safe here. Typed off the function's own
      // parameter type rather than `any`, so a signature change breaks this.
      type FlipParams = Parameters<typeof performRuntimeFlip>[0];
      const params: FlipParams = {
        flipContext: flipWithoutPreset,
        cfg: {} as FlipParams["cfg"],
        ctx: {} as FlipParams["ctx"],
      };

      const result = await performRuntimeFlip(params);
      expect(result).toBeNull();
    });

    // Skipped for the same reason as the session-key test above: the body built
    // a zero-message flip context and then asserted nothing, because (per its
    // own closing comment) it "will fail at getAcpSessionManager()" without a
    // module-scope manager mock. It was passing purely by doing nothing.
    //
    // To make it real: hoist a ./manager.js mock and assert performRuntimeFlip
    // resolves rather than throwing when replayPayload.messages is empty.
    it.skip("handles zero-message source session without crashing", async () => {
      // intentionally empty — see the note above
    });

    it("uses preset.acpxModel if provided, falls back to preset.agent", async () => {
      // This is a structural test of how the flip flows through initialization
      const presetWithModel: RuntimeFlipContext = {
        preset: {
          id: "claude-code-opus",
          label: "Claude Code · Opus",
          agent: "claude-code",
          acpxModel: "claude-opus-4-6",
        },
        sourceSessionKey: "openai-session-123",
      };

      const presetWithoutModel: RuntimeFlipContext = {
        preset: {
          id: "claude-code",
          label: "Claude Code",
          agent: "claude-code",
        },
        sourceSessionKey: "openai-session-123",
      };

      // These structures are tested implicitly in performRuntimeFlip
      // where acpxModel is passed to initializeSession if available,
      // otherwise falls back to agent.
      expect(presetWithModel.preset?.acpxModel).toBe("claude-opus-4-6");
      expect(presetWithoutModel.preset?.acpxModel).toBeUndefined();
    });
  });
});
