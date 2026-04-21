import { SessionManager } from "@mariozechner/pi-coding-agent";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";

type AppendMessageArg = Parameters<SessionManager["appendMessage"]>[0];

export type GatewayInjectedAbortMeta = {
  aborted: true;
  origin: "rpc" | "stop-command";
  runId: string;
};

export type GatewayInjectedTranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};

/**
 * Persist a user message to the Pi session transcript via SessionManager.
 *
 * Used by the mid-run steering path in chat.send: when a user sends a message
 * while an agent run is already streaming, the gateway steers it into the
 * running agent.  The Pi agent's own event pipeline _should_ persist steered
 * user messages, but an extension error inside `_processAgentEvent` can
 * silently swallow the persistence call (the promise chain `.catch(() => {})`
 * eats the error).  Writing the user turn here, before the steer is queued,
 * guarantees the message reaches the JSONL even if the agent-side persistence
 * path fails.
 *
 * De-duplication: the Pi SessionManager tracks entries by `id` in its `byId`
 * map.  We use a fresh `generateId` here so the entry is unique.  If the
 * agent-side persistence _also_ fires, it will create its own entry with a
 * different id — resulting in a harmless duplicate user turn.  In practice,
 * the agent-side path is not reliably firing for steered messages (empirically
 * confirmed: steered user prompts are absent from all persistence layers).
 */
export function appendInjectedUserMessageToTranscript(params: {
  transcriptPath: string;
  message: string;
  sessionKey?: string;
  now?: number;
}): GatewayInjectedTranscriptAppendResult {
  const now = params.now ?? Date.now();
  const messageBody: AppendMessageArg & Record<string, unknown> = {
    role: "user",
    content: [{ type: "text", text: params.message }],
    timestamp: now,
  };
  try {
    const sessionManager = SessionManager.open(params.transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody);
    emitSessionTranscriptUpdate({
      sessionFile: params.transcriptPath,
      sessionKey: params.sessionKey,
      message: messageBody,
      messageId,
    });
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function appendInjectedAssistantMessageToTranscript(params: {
  transcriptPath: string;
  message: string;
  label?: string;
  idempotencyKey?: string;
  abortMeta?: GatewayInjectedAbortMeta;
  now?: number;
  /**
   * Override the `provider` / `model` stamp on the injected assistant
   * message. Used by the ACP dispatch path so the UI badge shows the real
   * runtime (e.g. `claude-code` / `claude-code-opus`) instead of the
   * default `openclaw` / `gateway-injected` stamp. The fallback defaults
   * are preserved when no override is passed (non-ACP gateway injections
   * like aborts, BTW replies, etc.).
   */
  providerOverride?: string;
  modelOverride?: string;
  apiOverride?: string;
}): GatewayInjectedTranscriptAppendResult {
  const now = params.now ?? Date.now();
  const labelPrefix = params.label ? `[${params.label}]\n\n` : "";
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
  const messageBody: AppendMessageArg & Record<string, unknown> = {
    role: "assistant",
    content: [{ type: "text", text: `${labelPrefix}${params.message}` }],
    timestamp: now,
    // Pi stopReason is a strict enum; this is not model output, but we still store it as a
    // normal assistant message so it participates in the session parentId chain.
    stopReason: "stop",
    usage,
    // Make these explicit so downstream tooling never treats this as model output.
    // Defaults describe the gateway-injected stamp; ACP dispatch overrides them
    // with the real runtime (e.g. `claude-code` / `claude-code-opus`).
    api: params.apiOverride ?? "openai-responses",
    provider: params.providerOverride ?? "openclaw",
    model: params.modelOverride ?? "gateway-injected",
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    ...(params.abortMeta
      ? {
          openclawAbort: {
            aborted: true,
            origin: params.abortMeta.origin,
            runId: params.abortMeta.runId,
          },
        }
      : {}),
  };

  try {
    // IMPORTANT: Use SessionManager so the entry is attached to the current leaf via parentId.
    // Raw jsonl appends break the parent chain and can hide compaction summaries from context.
    const sessionManager = SessionManager.open(params.transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody);
    emitSessionTranscriptUpdate({
      sessionFile: params.transcriptPath,
      message: messageBody,
      messageId,
    });
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
