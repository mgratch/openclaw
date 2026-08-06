import { describe, expect, it, vi } from "vitest";
import { createInlineCodeState } from "../markdown/code-spans.js";
import { handleAgentEnd } from "./pi-embedded-subscribe.handlers.lifecycle.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";

vi.mock("../infra/agent-events.js", () => ({
  emitAgentEvent: vi.fn(),
}));

function createContext(
  lastAssistant: unknown,
  overrides?: { onAgentEvent?: (event: unknown) => void },
): EmbeddedPiSubscribeContext {
  const onBlockReply = vi.fn();
  return {
    params: {
      runId: "run-1",
      config: {},
      sessionKey: "agent:main:main",
      onAgentEvent: overrides?.onAgentEvent,
      onBlockReply,
    },
    state: {
      lastAssistant: lastAssistant as EmbeddedPiSubscribeContext["state"]["lastAssistant"],
      pendingCompactionRetry: 0,
      pendingToolMediaUrls: [],
      pendingToolAudioAsVoice: false,
      blockState: {
        thinking: true,
        final: true,
        inlineCode: createInlineCodeState(),
      },
    },
    log: {
      debug: vi.fn(),
      warn: vi.fn(),
    },
    flushBlockReplyBuffer: vi.fn(),
    emitBlockReply: onBlockReply,
    resolveCompactionRetry: vi.fn(),
    maybeResolveCompactionWait: vi.fn(),
  } as unknown as EmbeddedPiSubscribeContext;
}

describe("handleAgentEnd", () => {
  it("logs the resolved error message when run ends with assistant error", () => {
    const onAgentEvent = vi.fn();
    const ctx = createContext(
      {
        role: "assistant",
        stopReason: "error",
        errorMessage: "connection refused",
        content: [{ type: "text", text: "" }],
      },
      { onAgentEvent },
    );

    handleAgentEnd(ctx);

    const warn = vi.mocked(ctx.log.warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("embedded run agent end");
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      event: "embedded_run_agent_end",
      runId: "run-1",
      error: "LLM request failed: connection refused by the provider endpoint.",
      rawErrorPreview: "connection refused",
      consoleMessage:
        "embedded run agent end: runId=run-1 isError=true model=unknown provider=unknown error=LLM request failed: connection refused by the provider endpoint. rawError=connection refused",
    });
    expect(onAgentEvent).toHaveBeenCalledWith({
      stream: "lifecycle",
      data: {
        phase: "error",
        error: "LLM request failed: connection refused by the provider endpoint.",
      },
    });
  });

  it("attaches raw provider error metadata and includes model/provider in console output", () => {
    const ctx = createContext({
      role: "assistant",
      stopReason: "error",
      provider: "anthropic",
      model: "claude-test",
      errorMessage: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      content: [{ type: "text", text: "" }],
    });

    handleAgentEnd(ctx);

    const warn = vi.mocked(ctx.log.warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("embedded run agent end");
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      event: "embedded_run_agent_end",
      runId: "run-1",
      error: "The AI service is temporarily overloaded. Please try again in a moment.",
      failoverReason: "overloaded",
      providerErrorType: "overloaded_error",
      consoleMessage:
        'embedded run agent end: runId=run-1 isError=true model=claude-test provider=anthropic error=The AI service is temporarily overloaded. Please try again in a moment. rawError={"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    });
  });

  it("sanitizes model and provider before writing consoleMessage", () => {
    const ctx = createContext({
      role: "assistant",
      stopReason: "error",
      provider: "anthropic\u001b]8;;https://evil.test\u0007",
      model: "claude\tsonnet\n4",
      errorMessage: "connection refused",
      content: [{ type: "text", text: "" }],
    });

    handleAgentEnd(ctx);

    const warn = vi.mocked(ctx.log.warn);
    const meta = warn.mock.calls[0]?.[1];
    expect(meta).toMatchObject({
      consoleMessage:
        "embedded run agent end: runId=run-1 isError=true model=claude sonnet 4 provider=anthropic]8;;https://evil.test error=LLM request failed: connection refused by the provider endpoint. rawError=connection refused",
    });
    expect(meta?.consoleMessage).not.toContain("\n");
    expect(meta?.consoleMessage).not.toContain("\r");
    expect(meta?.consoleMessage).not.toContain("\t");
    expect(meta?.consoleMessage).not.toContain("\u001b");
  });

  it("redacts logged error text before emitting lifecycle events", () => {
    const onAgentEvent = vi.fn();
    const ctx = createContext(
      {
        role: "assistant",
        stopReason: "error",
        errorMessage: "x-api-key: sk-abcdefghijklmnopqrstuvwxyz123456",
        content: [{ type: "text", text: "" }],
      },
      { onAgentEvent },
    );

    handleAgentEnd(ctx);

    const warn = vi.mocked(ctx.log.warn);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      event: "embedded_run_agent_end",
      error: "x-api-key: ***",
      rawErrorPreview: "x-api-key: ***",
    });
    expect(onAgentEvent).toHaveBeenCalledWith({
      stream: "lifecycle",
      data: {
        phase: "error",
        error: "x-api-key: ***",
      },
    });
  });

  it("marks aborted runs on the lifecycle end event with the abort reason", () => {
    const onAgentEvent = vi.fn();
    const ctx = createContext(
      {
        role: "assistant",
        stopReason: "aborted",
        provider: "openai-codex",
        model: "gpt-test",
        errorMessage: "gateway restarting: run did not finish within the 90s drain window",
        content: [],
      },
      { onAgentEvent },
    );

    handleAgentEnd(ctx);

    // Still a phase:"end" (not "error") so subagent announce/channel delivery
    // semantics are unchanged — but with additive aborted/error fields for
    // the gateway to broadcast a chat error on non-user aborts.
    expect(ctx.log.warn).not.toHaveBeenCalled();
    expect(onAgentEvent).toHaveBeenCalledWith({
      stream: "lifecycle",
      data: {
        phase: "end",
        model: "gpt-test",
        provider: "openai-codex",
        aborted: true,
        error: "gateway restarting: run did not finish within the 90s drain window",
      },
    });
  });

  it("does not flag sessions_yield turns as aborted (no error card on yield)", () => {
    const onAgentEvent = vi.fn();
    const ctx = createContext(
      {
        role: "assistant",
        stopReason: "aborted",
        provider: "openai-codex",
        model: "gpt-test",
        content: [],
      },
      { onAgentEvent },
    );
    (ctx.state as { toolMetas?: Array<{ toolName?: string }> }).toolMetas = [
      { toolName: "sessions_yield" },
    ];

    handleAgentEnd(ctx);

    expect(onAgentEvent).toHaveBeenCalledWith({
      stream: "lifecycle",
      data: {
        phase: "end",
        model: "gpt-test",
        provider: "openai-codex",
      },
    });
  });

  it("does not flag benign abort reasons (queue interrupt, model switch) as aborted", () => {
    for (const reason of [
      "interrupted by a new inbound message (queue mode: interrupt)",
      "switching model to anthropic/sonnet-4.6",
      "session reset requested",
    ]) {
      const onAgentEvent = vi.fn();
      const ctx = createContext(
        {
          role: "assistant",
          stopReason: "aborted",
          errorMessage: reason,
          content: [],
        },
        { onAgentEvent },
      );

      handleAgentEnd(ctx);

      const data = onAgentEvent.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data.phase).toBe("end");
      expect(data.aborted).toBeUndefined();
    }
  });

  it("keeps non-error run-end logging on debug only", () => {
    const ctx = createContext(undefined);

    handleAgentEnd(ctx);

    expect(ctx.log.warn).not.toHaveBeenCalled();
    expect(ctx.log.debug).toHaveBeenCalledWith(
      "embedded run agent end: runId=run-1 isError=false aborted=false",
    );
  });

  it("flushes orphaned tool media as a media-only block reply", () => {
    const ctx = createContext(undefined);
    ctx.state.pendingToolMediaUrls = ["/tmp/reply.opus"];
    ctx.state.pendingToolAudioAsVoice = true;

    handleAgentEnd(ctx);

    expect(ctx.emitBlockReply).toHaveBeenCalledWith({
      mediaUrls: ["/tmp/reply.opus"],
      audioAsVoice: true,
    });
    expect(ctx.state.pendingToolMediaUrls).toEqual([]);
    expect(ctx.state.pendingToolAudioAsVoice).toBe(false);
  });
});
