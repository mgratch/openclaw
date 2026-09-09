import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __testing as AcpManagerTesting } from "../../acp/control-plane/manager.js";
import {
  detectRuntimeFlip,
  recordWarmSessionForPreset,
  RuntimeFlipManager,
  performRuntimeFlip,
} from "../../acp/control-plane/runtime-flip.js";
import type { RuntimeFlipContext } from "../../acp/control-plane/runtime-flip.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { FinalizedMsgContext } from "../templating.js";

describe("dispatch-from-config: runtime-flip wire-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("flip detection before dispatch-acp", () => {
    it("detects preset override on non-ACP session and returns flip context", async () => {
      const flipContext = await detectRuntimeFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => [
          { role: "user" as const, content: "Hello, how can you help?" },
          { role: "assistant" as const, content: "I can help with various tasks." },
        ],
      });

      expect(flipContext).not.toBeNull();
      expect(flipContext?.preset?.id).toBe("claude-code-opus");
      expect(flipContext?.sourceSessionKey).toBe("openai-session-123");
      expect(flipContext?.replayPayload).not.toBeUndefined();
      expect(flipContext?.replayPayload?.messages.length).toBe(2);
    });

    it("returns null for non-preset model override", async () => {
      const flipContext = await detectRuntimeFlip({
        modelOverride: "openai/gpt-5.4",
        sourceSessionKey: "session-123",
        isSourceAcpSession: false,
      });

      expect(flipContext).toBeNull();
    });

    it("returns null when preset selected on ACP session (passthrough)", async () => {
      const flipContext = await detectRuntimeFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "claude-acp-456",
        isSourceAcpSession: true, // Already ACP
      });

      expect(flipContext).toBeNull();
    });
  });

  describe("warm pool for back-switches", () => {
    it("records warm session after flip and reuses on back-switch", async () => {
      const sourceSessionKey = "openai-session-123";
      const presetId = "claude-code-opus";
      const newAcpSessionKey = "claude-acp-456";

      // First flip: no warm session yet
      let flipContext = await detectRuntimeFlip({
        modelOverride: presetId,
        sourceSessionKey,
        isSourceAcpSession: false,
        readSourceMessages: async () => [{ role: "user" as const, content: "First question" }],
      });

      expect(flipContext?.warmSessionKey).toBeUndefined();
      expect(flipContext?.replayPayload).not.toBeUndefined();

      // Simulate ACP session creation and record warm session
      recordWarmSessionForPreset(sourceSessionKey, presetId, newAcpSessionKey);

      // Second flip (back-switch): should hit warm pool
      flipContext = await detectRuntimeFlip({
        modelOverride: presetId,
        sourceSessionKey,
        isSourceAcpSession: false,
      });

      expect(flipContext?.warmSessionKey).toBe(newAcpSessionKey);
      expect(flipContext?.replayPayload).toBeUndefined(); // No replay needed on warm hit
    });

    it("maintains separate warm sessions for different presets", async () => {
      const sourceSessionKey = "session-123";

      recordWarmSessionForPreset(sourceSessionKey, "claude-code-opus", "warm-opus-456");
      recordWarmSessionForPreset(sourceSessionKey, "claude-code-sonnet", "warm-sonnet-789");

      const flipOpus = await detectRuntimeFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey,
        isSourceAcpSession: false,
      });
      expect(flipOpus?.warmSessionKey).toBe("warm-opus-456");

      const flipSonnet = await detectRuntimeFlip({
        modelOverride: "claude-code-sonnet",
        sourceSessionKey,
        isSourceAcpSession: false,
      });
      expect(flipSonnet?.warmSessionKey).toBe("warm-sonnet-789");
    });
  });

  describe("transcript reading for replay", () => {
    let manager: RuntimeFlipManager;

    beforeEach(() => {
      manager = new RuntimeFlipManager();
    });

    it("includes replay payload when readSourceMessages callback succeeds", async () => {
      const flipContext = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => [{ role: "user", content: "Test" }],
      });

      expect(flipContext).not.toBeNull();
      expect(flipContext?.replayPayload).not.toBeUndefined();
      expect(flipContext?.replayPayload?.sourceSessionKey).toBe("session-123");
    });

    it("omits replay payload when no readSourceMessages callback provided", async () => {
      const flipContext = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "session-123",
        isSourceAcpSession: false,
        // No readSourceMessages
      });

      expect(flipContext).not.toBeNull();
      expect(flipContext?.replayPayload).toBeUndefined();
    });

    it("handles transcript read failure gracefully", async () => {
      const flipContext = await manager.detectFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => {
          throw new Error("Transcript read failed");
        },
      });

      // Should return flip context without replay payload (error handled)
      expect(flipContext).not.toBeNull();
      expect(flipContext?.preset?.id).toBe("claude-code-opus");
      expect(flipContext?.replayPayload).toBeUndefined();
    });
  });

  describe("preset resolution in flip context", () => {
    it("all ACP presets resolve correctly", async () => {
      const presetIds = [
        "claude-code",
        "claude-code-opus",
        "claude-code-sonnet",
        "claude-code-haiku",
      ];

      for (const id of presetIds) {
        const flipContext = await detectRuntimeFlip({
          modelOverride: id,
          sourceSessionKey: "session-123",
          isSourceAcpSession: false,
        });

        expect(flipContext).not.toBeNull();
        expect(flipContext?.preset?.id).toBe(id);
        expect(flipContext?.preset?.agent).toBe("claude-code");
      }
    });
  });

  describe("runtime flip spawn/prime", () => {
    beforeEach(() => {
      // Reset ACP manager before each test
      AcpManagerTesting.resetAcpSessionManagerForTests();
    });

    it("performRuntimeFlip returns null when preset not available", async () => {
      // `preset` is required on RuntimeFlipContext, so this deliberately builds
      // an invalid context to exercise the guard. Cast through `unknown` rather
      // than `any` — the point is "this shape is intentionally wrong", not
      // "disable type checking here".
      const flipContext = {
        sourceSessionKey: "session-123",
      } as unknown as RuntimeFlipContext;

      const result = await performRuntimeFlip({
        flipContext,
        cfg: {} as OpenClawConfig,
        ctx: {} as FinalizedMsgContext,
      });

      expect(result).toBeNull();
    });

    it("performRuntimeFlip returns null when sourceSessionKey missing", async () => {
      const flipContext = await detectRuntimeFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: undefined,
        isSourceAcpSession: false,
      });

      if (!flipContext) {
        throw new Error("Expected flipContext");
      }

      const result = await performRuntimeFlip({
        flipContext: { ...flipContext, sourceSessionKey: undefined },
        cfg: {} as OpenClawConfig,
        ctx: {} as FinalizedMsgContext,
      });

      expect(result).toBeNull();
    });

    it("performRuntimeFlip spawn path returns string key when successful", async () => {
      // This test is basic—full integration would require mocking the ACP manager
      const flipContext = await detectRuntimeFlip({
        modelOverride: "claude-code-opus",
        sourceSessionKey: "openai-session-123",
        isSourceAcpSession: false,
        readSourceMessages: async () => [{ role: "user" as const, content: "Test message" }],
      });

      if (!flipContext) {
        throw new Error("Expected flipContext");
      }

      // Mock the ACP manager to avoid full initialization
      const mockManager = {
        initializeSession: vi.fn().mockResolvedValue({
          handle: { id: "mock-handle", cwd: "/tmp", backend: "local", runtimeSessionName: "test" },
          meta: {
            agent: "claude-code",
            backend: "local",
            state: "idle" as const,
            lastActivityAt: Date.now(),
          },
        }),
        runTurn: vi.fn().mockResolvedValue({ output: "mocked" }),
        resolveSession: vi.fn().mockReturnValue({
          kind: "ready" as const,
          sessionKey: "test-session",
          meta: { agent: "claude-code" },
        }),
      };

      AcpManagerTesting.setAcpSessionManagerForTests(mockManager);

      const result = await performRuntimeFlip({
        flipContext,
        cfg: {} as OpenClawConfig,
        ctx: {} as FinalizedMsgContext,
        sourceSessionKey: "openai-session-123",
      });

      // Verify the session was initialized
      expect(mockManager.initializeSession).toHaveBeenCalled();
      expect(typeof result).toBe("string");
      expect(result).toBeTruthy();
    });
  });
});
