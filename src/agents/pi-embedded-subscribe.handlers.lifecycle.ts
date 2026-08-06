import { emitAgentEvent } from "../infra/agent-events.js";
import { createInlineCodeState } from "../markdown/code-spans.js";
import {
  buildApiErrorObservationFields,
  buildTextObservationFields,
  sanitizeForConsole,
} from "./pi-embedded-error-observation.js";
import { classifyFailoverReason, formatAssistantErrorText } from "./pi-embedded-helpers.js";
import { isBenignAbortReasonText } from "./pi-embedded-runner/abort-reasons.js";
import {
  consumePendingToolMediaReply,
  hasAssistantVisibleReply,
} from "./pi-embedded-subscribe.handlers.messages.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";
import { isAssistantMessage } from "./pi-embedded-utils.js";

export {
  handleAutoCompactionEnd,
  handleAutoCompactionStart,
} from "./pi-embedded-subscribe.handlers.compaction.js";

export function handleAgentStart(ctx: EmbeddedPiSubscribeContext) {
  ctx.log.debug(`embedded run agent start: runId=${ctx.params.runId}`);
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "lifecycle",
    data: {
      phase: "start",
      startedAt: Date.now(),
    },
  });
  void ctx.params.onAgentEvent?.({
    stream: "lifecycle",
    data: { phase: "start" },
  });
}

export function handleAgentEnd(ctx: EmbeddedPiSubscribeContext) {
  const lastAssistant = ctx.state.lastAssistant;
  const isError = isAssistantMessage(lastAssistant) && lastAssistant.stopReason === "error";

  if (isError && lastAssistant) {
    const friendlyError = formatAssistantErrorText(lastAssistant, {
      cfg: ctx.params.config,
      sessionKey: ctx.params.sessionKey,
      provider: lastAssistant.provider,
      model: lastAssistant.model,
    });
    const rawError = lastAssistant.errorMessage?.trim();
    const failoverReason = classifyFailoverReason(rawError ?? "");
    const errorText = (friendlyError || lastAssistant.errorMessage || "LLM request failed.").trim();
    const observedError = buildApiErrorObservationFields(rawError);
    const safeErrorText =
      buildTextObservationFields(errorText).textPreview ?? "LLM request failed.";
    const safeRunId = sanitizeForConsole(ctx.params.runId) ?? "-";
    const safeModel = sanitizeForConsole(lastAssistant.model) ?? "unknown";
    const safeProvider = sanitizeForConsole(lastAssistant.provider) ?? "unknown";
    const safeRawErrorPreview = sanitizeForConsole(observedError.rawErrorPreview);
    const rawErrorConsoleSuffix = safeRawErrorPreview ? ` rawError=${safeRawErrorPreview}` : "";
    ctx.log.warn("embedded run agent end", {
      event: "embedded_run_agent_end",
      tags: ["error_handling", "lifecycle", "agent_end", "assistant_error"],
      runId: ctx.params.runId,
      isError: true,
      error: safeErrorText,
      failoverReason,
      model: lastAssistant.model,
      provider: lastAssistant.provider,
      ...observedError,
      consoleMessage: `embedded run agent end: runId=${safeRunId} isError=true model=${safeModel} provider=${safeProvider} error=${safeErrorText}${rawErrorConsoleSuffix}`,
    });
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "lifecycle",
      data: {
        phase: "error",
        error: safeErrorText,
        endedAt: Date.now(),
      },
    });
    void ctx.params.onAgentEvent?.({
      stream: "lifecycle",
      data: {
        phase: "error",
        error: safeErrorText,
      },
    });
  } else {
    // Aborted runs (stopReason === "aborted") also land here: pi-ai providers
    // never throw — an aborted stream resolves normally with stopReason set.
    // Keep phase:"end" so downstream consumers (subagent announce, channel
    // delivery) see a normal end, but attach additive `aborted`/`error`
    // fields so the gateway can broadcast a chat error when the abort was NOT
    // user-initiated (server-chat.ts checks chatAbortedRuns). Incident
    // 2026-08-04: a gateway restart drain-killed a live run and the webchat
    // saw nothing but silence.
    //
    // Expected control-flow aborts must NOT be flagged: sessions_yield turns
    // (detected via the tool having run this turn — yield aborts often carry
    // no errorMessage) and benign reason texts (queue interrupt, model
    // switch, session reset; see abort-reasons.ts). Incident 2026-08-06:
    // without this, every yield painted a spurious "Run aborted" error card.
    const rawAbortReason = isAssistantMessage(lastAssistant)
      ? lastAssistant.errorMessage?.trim()
      : undefined;
    const yieldedThisTurn = (ctx.state.toolMetas ?? []).some(
      (t) => t.toolName === "sessions_yield",
    );
    const wasAborted =
      isAssistantMessage(lastAssistant) &&
      lastAssistant.stopReason === "aborted" &&
      !yieldedThisTurn &&
      !isBenignAbortReasonText(rawAbortReason);
    const abortErrorText = wasAborted
      ? (buildTextObservationFields(rawAbortReason || "Run aborted before completion.")
          .textPreview ?? "Run aborted before completion.")
      : undefined;
    ctx.log.debug(
      `embedded run agent end: runId=${ctx.params.runId} isError=${isError} aborted=${wasAborted}`,
    );
    // Forward resolved model/provider attribution so downstream consumers
    // (chat.message WS events, Responses API SSE) can label the assistant
    // reply on fresh sends without waiting for a UI refresh to hydrate from
    // storage. `ctx.state.lastAssistant` is an AssistantMessage built by
    // `buildAssistantMessage` in stream-message-shared.ts which carries the
    // resolved provider/model/api used for the run.
    const assistantModel = isAssistantMessage(lastAssistant) ? lastAssistant.model : undefined;
    const assistantProvider = isAssistantMessage(lastAssistant)
      ? lastAssistant.provider
      : undefined;
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "lifecycle",
      data: {
        phase: "end",
        endedAt: Date.now(),
        ...(assistantModel ? { model: assistantModel } : {}),
        ...(assistantProvider ? { provider: assistantProvider } : {}),
        ...(wasAborted ? { aborted: true, error: abortErrorText } : {}),
      },
    });
    void ctx.params.onAgentEvent?.({
      stream: "lifecycle",
      data: {
        phase: "end",
        ...(assistantModel ? { model: assistantModel } : {}),
        ...(assistantProvider ? { provider: assistantProvider } : {}),
        ...(wasAborted ? { aborted: true, error: abortErrorText } : {}),
      },
    });
  }

  ctx.flushBlockReplyBuffer();
  const pendingToolMediaReply = consumePendingToolMediaReply(ctx.state);
  if (pendingToolMediaReply && hasAssistantVisibleReply(pendingToolMediaReply)) {
    ctx.emitBlockReply(pendingToolMediaReply);
  }
  // Flush the reply pipeline so the response reaches the channel before
  // compaction wait blocks the run.  This mirrors the pattern used by
  // handleToolExecutionStart and ensures delivery is not held hostage to
  // long-running compaction (#35074).
  void ctx.params.onBlockReplyFlush?.();

  ctx.state.blockState.thinking = false;
  ctx.state.blockState.final = false;
  ctx.state.blockState.inlineCode = createInlineCodeState();

  if (ctx.state.pendingCompactionRetry > 0) {
    ctx.resolveCompactionRetry();
  } else {
    ctx.maybeResolveCompactionWait();
  }
}
