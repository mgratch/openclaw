import { getAcpSessionManager } from "../../acp/control-plane/manager.js";
import type { AcpTurnAttachment } from "../../acp/control-plane/manager.types.js";
import {
  constructReplayPrompt,
  type RuntimeFlipContext,
} from "../../acp/control-plane/runtime-flip.js";
import { createSubagentEnricher } from "../../acp/control-plane/subagent-enricher.js";
import { resolveAcpAgentPolicyError, resolveAcpDispatchPolicyError } from "../../acp/policy.js";
import { resolveAcpModelPresetFlexible, resolvePerTurnAcpModel } from "../../acp/presets.js";
import { formatAcpRuntimeErrorText } from "../../acp/runtime/error-text.js";
import { toAcpRuntimeError } from "../../acp/runtime/errors.js";
import { createAcpNdjsonSidecar } from "../../acp/runtime/ndjson-sidecar.js";
import { resolveAcpThreadSessionDetailLines } from "../../acp/runtime/session-identifiers.js";
import {
  isSessionIdentityPending,
  resolveSessionIdentityFromMeta,
} from "../../acp/runtime/session-identity.js";
import { readAcpSessionEntry } from "../../acp/runtime/session-meta.js";
import {
  buildAcpContextPreamble,
  markAcpContextPreambleDelivered,
  shouldInjectAcpContextPreamble,
} from "../../acp/context-preamble.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { TtsAutoMode } from "../../config/types.tts.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { getSessionBindingService } from "../../infra/outbound/session-binding-service.js";
import { generateSecureUuid } from "../../infra/secure-random.js";
import { prefixSystemMessage } from "../../infra/system-message.js";
import { applyMediaUnderstanding } from "../../media-understanding/apply.js";
import { MediaAttachmentCache } from "../../media-understanding/attachments.js";
import { normalizeAttachments } from "../../media-understanding/attachments.normalize.js";
import { isMediaUnderstandingSkipError } from "../../media-understanding/errors.js";
import { resolveMediaAttachmentLocalRoots } from "../../media-understanding/runner.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { maybeApplyTtsToPayload, resolveTtsConfig } from "../../tts/tts.js";
import {
  isCommandEnabled,
  maybeResolveTextAlias,
  shouldHandleTextCommands,
} from "../commands-registry.js";
import type { FinalizedMsgContext } from "../templating.js";
import { createAcpReplyProjector } from "./acp-projector.js";
import {
  createAcpDispatchDeliveryCoordinator,
  type AcpDispatchDeliveryCoordinator,
} from "./dispatch-acp-delivery.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";

type DispatchProcessedRecorder = (
  outcome: "completed" | "skipped" | "error",
  opts?: {
    reason?: string;
    error?: string;
  },
) => void;

function resolveFirstContextText(
  ctx: FinalizedMsgContext,
  keys: Array<"BodyForAgent" | "BodyForCommands" | "CommandBody" | "RawBody" | "Body">,
): string {
  for (const key of keys) {
    const value = ctx[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function resolveAcpPromptText(ctx: FinalizedMsgContext): string {
  return resolveFirstContextText(ctx, [
    "BodyForAgent",
    "BodyForCommands",
    "CommandBody",
    "RawBody",
    "Body",
  ]).trim();
}

const ACP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ACP_ATTACHMENT_TIMEOUT_MS = 1_000;

async function resolveAcpAttachments(
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): Promise<AcpTurnAttachment[]> {
  const mediaAttachments = normalizeAttachments(ctx).map((attachment) =>
    attachment.path?.trim() ? { ...attachment, url: undefined } : attachment,
  );
  const cache = new MediaAttachmentCache(mediaAttachments, {
    localPathRoots: resolveMediaAttachmentLocalRoots({ cfg, ctx }),
  });
  const results: AcpTurnAttachment[] = [];
  for (const attachment of mediaAttachments) {
    const mediaType = attachment.mime ?? "application/octet-stream";
    if (!mediaType.startsWith("image/")) {
      continue;
    }
    if (!attachment.path?.trim()) {
      continue;
    }
    try {
      const { buffer } = await cache.getBuffer({
        attachmentIndex: attachment.index,
        maxBytes: ACP_ATTACHMENT_MAX_BYTES,
        timeoutMs: ACP_ATTACHMENT_TIMEOUT_MS,
      });
      results.push({
        mediaType,
        data: buffer.toString("base64"),
      });
    } catch (error) {
      if (isMediaUnderstandingSkipError(error)) {
        logVerbose(`dispatch-acp: skipping attachment #${attachment.index + 1} (${error.reason})`);
      } else {
        const errorName = error instanceof Error ? error.name : typeof error;
        logVerbose(
          `dispatch-acp: failed to read attachment #${attachment.index + 1} (${errorName})`,
        );
      }
      // Skip unreadable files. Text content should still be delivered.
    }
  }
  return results;
}

function resolveCommandCandidateText(ctx: FinalizedMsgContext): string {
  return resolveFirstContextText(ctx, ["CommandBody", "BodyForCommands", "RawBody", "Body"]).trim();
}

export function shouldBypassAcpDispatchForCommand(
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): boolean {
  const candidate = resolveCommandCandidateText(ctx);
  if (!candidate) {
    return false;
  }
  const allowTextCommands = shouldHandleTextCommands({
    cfg,
    surface: ctx.Surface ?? ctx.Provider ?? "",
    commandSource: ctx.CommandSource,
  });
  if (maybeResolveTextAlias(candidate, cfg) != null) {
    return allowTextCommands;
  }

  const normalized = candidate.trim();
  if (!normalized.startsWith("!")) {
    return false;
  }

  if (!ctx.CommandAuthorized) {
    return false;
  }

  if (!isCommandEnabled(cfg, "bash")) {
    return false;
  }

  return allowTextCommands;
}

function resolveAcpRequestId(ctx: FinalizedMsgContext): string {
  const id = ctx.MessageSidFull ?? ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }
  if (typeof id === "number" || typeof id === "bigint") {
    return String(id);
  }
  return generateSecureUuid();
}

function hasBoundConversationForSession(params: {
  sessionKey: string;
  channelRaw: string | undefined;
  accountIdRaw: string | undefined;
}): boolean {
  const channel = String(params.channelRaw ?? "")
    .trim()
    .toLowerCase();
  if (!channel) {
    return false;
  }
  const accountId = String(params.accountIdRaw ?? "")
    .trim()
    .toLowerCase();
  const normalizedAccountId = accountId || "default";
  const bindingService = getSessionBindingService();
  const bindings = bindingService.listBySession(params.sessionKey);
  return bindings.some((binding) => {
    const bindingChannel = String(binding.conversation.channel ?? "")
      .trim()
      .toLowerCase();
    const bindingAccountId = String(binding.conversation.accountId ?? "")
      .trim()
      .toLowerCase();
    const conversationId = String(binding.conversation.conversationId ?? "").trim();
    return (
      bindingChannel === channel &&
      (bindingAccountId || "default") === normalizedAccountId &&
      conversationId.length > 0
    );
  });
}

export type AcpDispatchAttemptResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

const ACP_STALE_BINDING_UNBIND_REASON = "acp-session-init-failed";

function isStaleSessionInitError(params: { code: string; message: string }): boolean {
  if (params.code !== "ACP_SESSION_INIT_FAILED") {
    return false;
  }
  return /(ACP (session )?metadata is missing|missing ACP metadata|Session is not ACP-enabled|Resource not found)/i.test(
    params.message,
  );
}

async function maybeUnbindStaleBoundConversations(params: {
  targetSessionKey: string;
  error: { code: string; message: string };
}): Promise<void> {
  if (!isStaleSessionInitError(params.error)) {
    return;
  }
  try {
    const removed = await getSessionBindingService().unbind({
      targetSessionKey: params.targetSessionKey,
      reason: ACP_STALE_BINDING_UNBIND_REASON,
    });
    if (removed.length > 0) {
      logVerbose(
        `dispatch-acp: removed ${removed.length} stale bound conversation(s) for ${params.targetSessionKey} after ${params.error.code}: ${params.error.message}`,
      );
    }
  } catch (error) {
    logVerbose(
      `dispatch-acp: failed to unbind stale bound conversations for ${params.targetSessionKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function finalizeAcpTurnOutput(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  delivery: AcpDispatchDeliveryCoordinator;
  inboundAudio: boolean;
  sessionTtsAuto?: TtsAutoMode;
  ttsChannel?: string;
  shouldEmitResolvedIdentityNotice: boolean;
}): Promise<boolean> {
  await params.delivery.settleVisibleText();
  let queuedFinal =
    params.delivery.hasDeliveredVisibleText() && !params.delivery.hasFailedVisibleTextDelivery();
  const ttsMode = resolveTtsConfig(params.cfg).mode ?? "final";
  const accumulatedBlockText = params.delivery.getAccumulatedBlockText();
  const hasAccumulatedBlockText = accumulatedBlockText.trim().length > 0;

  let finalMediaDelivered = false;
  if (ttsMode === "final" && hasAccumulatedBlockText) {
    try {
      const ttsSyntheticReply = await maybeApplyTtsToPayload({
        payload: { text: accumulatedBlockText },
        cfg: params.cfg,
        channel: params.ttsChannel,
        kind: "final",
        inboundAudio: params.inboundAudio,
        ttsAuto: params.sessionTtsAuto,
      });
      if (ttsSyntheticReply.mediaUrl) {
        const delivered = await params.delivery.deliver("final", {
          mediaUrl: ttsSyntheticReply.mediaUrl,
          audioAsVoice: ttsSyntheticReply.audioAsVoice,
        });
        queuedFinal = queuedFinal || delivered;
        finalMediaDelivered = delivered;
      }
    } catch (err) {
      logVerbose(
        `dispatch-acp: accumulated ACP block TTS failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Some ACP parent surfaces only expose terminal replies, so block routing alone is not enough
  // to prove the final result was visible to the user.
  const shouldDeliverTextFallback =
    ttsMode !== "all" &&
    hasAccumulatedBlockText &&
    !finalMediaDelivered &&
    !params.delivery.hasDeliveredFinalReply() &&
    (!params.delivery.hasDeliveredVisibleText() || params.delivery.hasFailedVisibleTextDelivery());
  if (shouldDeliverTextFallback) {
    const delivered = await params.delivery.deliver(
      "final",
      { text: accumulatedBlockText },
      { skipTts: true },
    );
    queuedFinal = queuedFinal || delivered;
  }

  if (params.shouldEmitResolvedIdentityNotice) {
    const currentMeta = readAcpSessionEntry({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
    })?.acp;
    const identityAfterTurn = resolveSessionIdentityFromMeta(currentMeta);
    if (!isSessionIdentityPending(identityAfterTurn)) {
      const resolvedDetails = resolveAcpThreadSessionDetailLines({
        sessionKey: params.sessionKey,
        meta: currentMeta,
      });
      if (resolvedDetails.length > 0) {
        const delivered = await params.delivery.deliver("final", {
          text: prefixSystemMessage(["Session ids resolved.", ...resolvedDetails].join("\n")),
        });
        queuedFinal = queuedFinal || delivered;
      }
    }
  }

  return queuedFinal;
}

export async function tryDispatchAcpReply(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  runId?: string;
  sessionKey?: string;
  abortSignal?: AbortSignal;
  inboundAudio: boolean;
  sessionTtsAuto?: TtsAutoMode;
  ttsChannel?: string;
  suppressUserDelivery?: boolean;
  shouldRouteToOriginating: boolean;
  originatingChannel?: string;
  originatingTo?: string;
  shouldSendToolSummaries: boolean;
  bypassForCommand: boolean;
  onReplyStart?: () => Promise<void> | void;
  onAgentRunStart?: (runId: string) => void;
  onAcpDispatchStart?: (
    runId: string,
    hint?: { provider?: string; model?: string; api?: string },
  ) => void;
  recordProcessed: DispatchProcessedRecorder;
  markIdle: (reason: string) => void;
  flipContext?: RuntimeFlipContext | null;
}): Promise<AcpDispatchAttemptResult | null> {
  let sessionKey = params.sessionKey?.trim();
  if (!sessionKey || params.bypassForCommand) {
    return null;
  }

  // 2026-04-30: DIAG — unconditionally log dispatch-acp entry so we can
  // confirm webchat ACP turns route through THIS function. Demote to
  // logVerbose once thinking is verified working end-to-end.
  console.log(
    `[dispatch-acp] entered: sessionKey=${sessionKey} runId=${params.runId ?? "(none)"} flipContext=${params.flipContext ? "yes" : "no"} MAX_THINKING_TOKENS=${process.env.MAX_THINKING_TOKENS ?? "(unset)"}`,
  );

  const acpManager = getAcpSessionManager();

  // Handle runtime flip: use warm session key if available (back-switch to same preset).
  // If no warm session and flip detected, the upstream caller should have already
  // spawned the ACP session via performRuntimeFlip and passed it as sessionKey.
  if (params.flipContext && params.flipContext.warmSessionKey) {
    // Reuse the warm session from a prior flip to this preset
    const warmResolution = acpManager.resolveSession({
      cfg: params.cfg,
      sessionKey: params.flipContext.warmSessionKey,
    });
    if (warmResolution.kind === "none") {
      logVerbose(
        `dispatch-acp: warm session ${params.flipContext.warmSessionKey} not found, falling back`,
      );
      return null;
    }
    // Continue with warm session instead of original sessionKey
    sessionKey = warmResolution.sessionKey;
  }

  const acpResolution = acpManager.resolveSession({
    cfg: params.cfg,
    sessionKey,
  });
  if (acpResolution.kind === "none") {
    return null;
  }
  const canonicalSessionKey = acpResolution.sessionKey;

  let queuedFinal = false;
  const delivery = createAcpDispatchDeliveryCoordinator({
    cfg: params.cfg,
    ctx: params.ctx,
    dispatcher: params.dispatcher,
    inboundAudio: params.inboundAudio,
    sessionTtsAuto: params.sessionTtsAuto,
    ttsChannel: params.ttsChannel,
    suppressUserDelivery: params.suppressUserDelivery,
    shouldRouteToOriginating: params.shouldRouteToOriginating,
    originatingChannel: params.originatingChannel,
    originatingTo: params.originatingTo,
    onReplyStart: params.onReplyStart,
  });

  const identityPendingBeforeTurn = isSessionIdentityPending(
    resolveSessionIdentityFromMeta(acpResolution.kind === "ready" ? acpResolution.meta : undefined),
  );
  const shouldEmitResolvedIdentityNotice =
    !params.suppressUserDelivery &&
    identityPendingBeforeTurn &&
    (Boolean(params.ctx.MessageThreadId != null && String(params.ctx.MessageThreadId).trim()) ||
      hasBoundConversationForSession({
        sessionKey: canonicalSessionKey,
        channelRaw: params.ctx.OriginatingChannel ?? params.ctx.Surface ?? params.ctx.Provider,
        accountIdRaw: params.ctx.AccountId,
      }));

  const resolvedAcpAgent =
    acpResolution.kind === "ready"
      ? (
          acpResolution.meta.agent?.trim() ||
          params.cfg.acp?.defaultAgent?.trim() ||
          resolveAgentIdFromSessionKey(canonicalSessionKey)
        ).trim()
      : resolveAgentIdFromSessionKey(canonicalSessionKey);
  const readyMeta = acpResolution.kind === "ready" ? acpResolution.meta : undefined;
  const projector = createAcpReplyProjector({
    cfg: params.cfg,
    shouldSendToolSummaries: params.shouldSendToolSummaries,
    deliver: delivery.deliver,
    provider: params.ctx.Surface ?? params.ctx.Provider,
    accountId: params.ctx.AccountId,
    ...(readyMeta?.backend ? { runtime: readyMeta.backend } : {}),
    ...(readyMeta?.runtimeOptions?.model ? { model: readyMeta.runtimeOptions.model } : {}),
    ...(readyMeta?.runtimeSessionName ? { sessionRef: readyMeta.runtimeSessionName } : {}),
  });

  const acpDispatchStartedAt = Date.now();
  // 2026-04-30: hoisted so the finally block can restore MAX_THINKING_TOKENS
  // regardless of whether runTurn succeeds, throws, or never reaches the
  // mutation point. `mutated` is set to true only after the env actually
  // changed, so we don't restore the wrong value on early bail-outs.
  let thinkingEnvSnapshot: { mutated: boolean; previous: string | undefined } = {
    mutated: false,
    previous: undefined,
  };
  // 2026-04-30 (#96): the OpenClaw context preamble is now ALSO injected
  // as systemPrompt.append (durable across turns + survives compaction)
  // via the OPENCLAW_SYSTEM_PROMPT_APPEND_FILE env var read by the patched
  // claude-agent-acp/dist/acp-agent.js. That env var is set statically in
  // docker-compose.override.yml — no per-turn mutation needed. The
  // user-message preamble below is kept as a fallback for non-Claude-Code
  // ACP backends (codex-acp, etc.) that don't read our env-var patch.
  try {
    const dispatchPolicyError = resolveAcpDispatchPolicyError(params.cfg);
    if (dispatchPolicyError) {
      throw dispatchPolicyError;
    }
    if (acpResolution.kind === "stale") {
      await maybeUnbindStaleBoundConversations({
        targetSessionKey: canonicalSessionKey,
        error: acpResolution.error,
      });
      const delivered = await delivery.deliver("final", {
        text: formatAcpRuntimeErrorText(acpResolution.error),
        isError: true,
      });
      const counts = params.dispatcher.getQueuedCounts();
      delivery.applyRoutedCounts(counts);
      const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
      logVerbose(
        `acp-dispatch: session=${sessionKey} outcome=error code=${acpResolution.error.code} latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
      );
      params.recordProcessed("completed", {
        reason: `acp_error:${acpResolution.error.code.toLowerCase()}`,
      });
      params.markIdle("message_completed");
      return { queuedFinal: delivered, counts };
    }
    const agentPolicyError = resolveAcpAgentPolicyError(params.cfg, resolvedAcpAgent);
    if (agentPolicyError) {
      throw agentPolicyError;
    }
    if (!params.ctx.MediaUnderstanding?.length) {
      try {
        await applyMediaUnderstanding({
          ctx: params.ctx,
          cfg: params.cfg,
        });
      } catch (err) {
        logVerbose(
          `dispatch-acp: media understanding failed, proceeding with raw content: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const promptText = resolveAcpPromptText(params.ctx);
    const attachments = await resolveAcpAttachments(params.ctx, params.cfg);

    // Context replay inlining. runtime-flip.ts intentionally skips the prime
    // turn after spawning a fresh preset session (it was racing acpx queue
    // owner startup and triggering ensureSession repair loops). Instead it
    // threads the prepared ReplayPayload through `flipContext.replayPayload`
    // and expects dispatch-acp to deliver it inline with the first user
    // turn. We do that here, but only when:
    //   - a replayPayload actually exists with messages, AND
    //   - warmSessionKey is unset (fresh spawn, not a back-switch to a
    //     session that already has the history in-context).
    // Back-switches to a warm session skip this branch because their prior
    // turns already delivered the replay. See also runtime-flip.ts:242 which
    // logs "skipping prime turn ... dispatch will deliver inline".
    const replayForFirstTurn =
      params.flipContext?.replayPayload &&
      !params.flipContext.warmSessionKey &&
      params.flipContext.replayPayload.messages.length > 0
        ? params.flipContext.replayPayload
        : undefined;
    // 2026-04-30 (#94): inject the OpenClaw runtime context preamble on the
    // first turn of every fresh acpx process, including post-flip. The
    // spawned ACP agent has no host-environment knowledge by default —
    // without this it will forget about memory, skills, plugins, and the
    // gateway's tool surface. We gate on an in-memory tracker keyed by
    // `(sessionKey, runtimeSessionName)`; runtime-flip mints a new
    // runtimeSessionName, so a flipped session automatically re-injects on
    // its next dispatch. Skip injection on attachment-only turns (no text):
    // prepending a long context block to a bare image upload reads as
    // noise; the next text turn will deliver the preamble instead.
    const hasPromptText = promptText.trim().length > 0;
    const contextPreambleNeeded =
      hasPromptText &&
      shouldInjectAcpContextPreamble({
        sessionKey: canonicalSessionKey,
        runtimeSessionName: readyMeta?.runtimeSessionName,
      });
    const contextPreamble = contextPreambleNeeded ? buildAcpContextPreamble() : "";

    const baseEffectivePrompt = replayForFirstTurn
      ? `${constructReplayPrompt(replayForFirstTurn)}\n---\n\nCurrent user message:\n\n${promptText}`
      : promptText;
    const effectivePromptText = contextPreamble
      ? `${contextPreamble}${baseEffectivePrompt}`
      : baseEffectivePrompt;
    if (replayForFirstTurn) {
      logVerbose(
        `dispatch-acp: prepending replay of ${replayForFirstTurn.messages.length} messages ` +
          `(~${replayForFirstTurn.approxChars} chars) to first turn of flipped session`,
      );
    }
    if (contextPreamble) {
      logVerbose(
        `dispatch-acp: injecting OpenClaw context preamble (~${contextPreamble.length} chars) ` +
          `for fresh acpx process on session=${canonicalSessionKey}`,
      );
    }

    if (!promptText && attachments.length === 0) {
      const counts = params.dispatcher.getQueuedCounts();
      delivery.applyRoutedCounts(counts);
      params.recordProcessed("completed", { reason: "acp_empty_prompt" });
      params.markIdle("message_completed");
      return { queuedFinal: false, counts };
    }

    try {
      await delivery.startReplyLifecycle();
    } catch (error) {
      logVerbose(
        `dispatch-acp: start reply lifecycle failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Per-turn dedupe set for tool_call forwarding. First emission for a
    // given toolCallId flips to phase:"start"; subsequent non-terminal
    // emissions go out as phase:"update".
    const toolCallsSeen = new Set<string>();

    // Chunk 8 — resolve a per-turn model override. Client-facing model
    // switching (the inline ModelPicker) writes to the top-level session
    // entry's `modelOverride` field via the chat.send / sessions-patch
    // path. For ACP turns that override is *not* visible in
    // `readyMeta.runtimeOptions.model` (which holds the spawn-time model),
    // so we read the current session entry and prefer its top-level
    // `modelOverride` when present. This lets the UI model picker switch
    // Claude Code / other ACP runtimes mid-conversation without rebuilding
    // the runtime handle.
    const freshEntry = readAcpSessionEntry({
      cfg: params.cfg,
      sessionKey: canonicalSessionKey,
    });
    const liveModelOverride =
      typeof freshEntry?.entry?.modelOverride === "string"
        ? freshEntry.entry.modelOverride.trim()
        : "";
    const rawPerTurnModel = liveModelOverride || readyMeta?.runtimeOptions?.model || undefined;

    // Chunk 13 — if the UI-facing override names an ACP preset
    // (`claude-code`, `claude-code-opus`, …), translate it into the acpx
    // `--model` flag the preset declares. The preset list lives at
    // src/acp/presets.ts and is mirrored in openclaw-ui. When the preset's
    // agent doesn't match the session's current ACP agent we log and pass
    // through the raw override so acpx surfaces a clear failure rather
    // than silently rebranding the session.
    const presetResolution = resolvePerTurnAcpModel({
      modelOverride: rawPerTurnModel,
      sessionAgent: resolvedAcpAgent,
    });
    if (presetResolution.agentMismatch && presetResolution.preset) {
      logVerbose(
        `dispatch-acp: model preset ${presetResolution.preset.id} expects agent ` +
          `${presetResolution.preset.agent} but session is on agent ${resolvedAcpAgent}; ` +
          `passing raw override through`,
      );
    }
    const perTurnModel = presetResolution.model;

    // 2026-04-30 — Per-turn extended-thinking budget override. When the
    // resolved preset declares `maxThinkingTokens`, set MAX_THINKING_TOKENS
    // on the process env BEFORE runTurn so the acpx subprocess (and via it
    // @zed-industries/claude-agent-acp at acp-agent.js:849) sees the right
    // budget for THIS preset. When the preset explicitly omits it (e.g.
    // claude-code-haiku — no thinking support), we unset the env var so the
    // SDK doesn't try to enable thinking on a model that can't use it.
    //
    // Restored in `finally` (env snapshot hoisted above) so concurrent
    // turns running with different presets don't leak budgets. The env-var
    // path is gateway-wide by design (the docker-compose default applies
    // when no preset is explicit); per-preset overrides happen here.
    // 2026-04-30: presetResolution.preset is undefined when the session's
    // stored model is the acpx flag value (e.g. "claude-opus-4-7") rather
    // than the preset id (e.g. "claude-code-opus"). That happens for fresh
    // sessions spawned by a preset before the user overrides the model.
    // resolveAcpModelPresetFlexible falls back to acpxModel matching so
    // we recover the preset reference for thinking-budget purposes.
    const effectivePreset =
      presetResolution.preset ?? resolveAcpModelPresetFlexible(rawPerTurnModel);
    const presetThinkingBudget = effectivePreset?.maxThinkingTokens;
    if (effectivePreset) {
      thinkingEnvSnapshot = {
        mutated: true,
        previous: process.env.MAX_THINKING_TOKENS,
      };
      if (typeof presetThinkingBudget === "number" && presetThinkingBudget > 0) {
        process.env.MAX_THINKING_TOKENS = String(presetThinkingBudget);
        // Intentionally console.log (not logVerbose) so this fires without
        // OPENCLAW_VERBOSE — diagnostic for confirming the per-preset path
        // ran. Demote to logVerbose once the feature is stable.
        console.log(
          `[dispatch-acp] enabling extended thinking for preset ${effectivePreset.id} (MAX_THINKING_TOKENS=${presetThinkingBudget}, resolvedFrom=${presetResolution.preset ? "id" : "acpxModel"})`,
        );
      } else {
        // Preset explicitly disables thinking (e.g. haiku) — clear so the
        // SDK doesn't try to enable it from a stale gateway-wide default.
        delete process.env.MAX_THINKING_TOKENS;
        console.log(
          `[dispatch-acp] extended thinking disabled for preset ${effectivePreset.id}`,
        );
      }
    }

    // Chunk 8 — per-turn NDJSON sidecar. Captures every raw AcpRuntimeEvent
    // to `<transcript>.acp.jsonl` for lossless replay/debugging, independent
    // of whatever the projector does with it. Disable via env
    // OPENCLAW_ACP_NDJSON=0. Failures are swallowed inside the sidecar.
    const acpSidecar = createAcpNdjsonSidecar(canonicalSessionKey, params.runId);
    // Chunk 8 — per-turn subagent enricher. Synthesizes subagent_hop start/end
    // events from Agent/Task tool call lifecycle when the runtime doesn't emit
    // native hops, so the UI always gets nested subagent cards.
    const subagentEnricher = createSubagentEnricher();

    // Signal to the caller (chat.ts dispatch path) that dispatch-acp has
    // claimed this turn. chat.ts uses this to:
    //   (a) eagerly fire `emitUserTranscriptUpdate()` so the user prompt
    //       lands in the UI transcript for ACP turns the same way non-ACP
    //       turns do (fixes Defect B);
    //   (b) skip the fallback `gateway-injected` Pi transcript append in the
    //       `.then()` block so the UI badge keeps the real ACP provider/model
    //       metadata that flows through streaming lifecycle events (fixes
    //       Defect C), while still broadcasting the final chat event from
    //       `deliveredReplies` so the UI receives `message.content`.
    // We intentionally do NOT reuse `onAgentRunStart` here — that callback
    // flips `agentRunStarted = true`, which suppresses the final chat
    // broadcast on the non-ACP Pi path (Pi emits its own final event), but
    // dispatch-acp needs the broadcast to happen.
    if (params.runId?.trim() && params.onAcpDispatchStart) {
      try {
        // Derive the UI badge hint from the resolved preset when available.
        // Falls back to the ACP agent id so the badge at least reads
        // `claude-code / <agent>` instead of `openclaw / gateway-injected`.
        // Prefer the user-facing preset id the ModelPicker actually sent
        // (`rawPerTurnModel`, e.g. `claude-code-opus`) so the UI badge
        // reflects the picked preset, not the translated acpx `--model`
        // flag or the bare agent id. Fall back to the resolver's preset
        // id, then the raw agent id, then a literal `acp` marker.
        const presetId = presetResolution.preset?.id;
        const acpHint = {
          provider: "claude-code",
          model: rawPerTurnModel || presetId || resolvedAcpAgent || "acp",
          api: "acp",
        };
        params.onAcpDispatchStart(params.runId.trim(), acpHint);
      } catch (err) {
        logVerbose(
          `dispatch-acp: onAcpDispatchStart threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await acpManager.runTurn({
      cfg: params.cfg,
      sessionKey: canonicalSessionKey,
      text: effectivePromptText,
      attachments: attachments.length > 0 ? attachments : undefined,
      mode: "prompt",
      requestId: resolveAcpRequestId(params.ctx),
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
      // Source the per-turn model from the session meta captured at
      // spawn/resume time. Chunk 2 plumbs `runtimeOptions.model` through
      // SessionAcpMeta; mid-conversation switches will overwrite that field
      // on the session meta and this call will pick up the new value on the
      // next turn without any handle rebuild.
      ...(perTurnModel ? { model: perTurnModel } : {}),
      // Source per-turn readOnly from session meta. Auto-detected at spawn
      // time for SSHFS r/o mounts; causes AcpxRuntime to inject `--deny-all`.
      ...(readyMeta?.runtimeOptions?.readOnly !== undefined
        ? { readOnly: readyMeta.runtimeOptions.readOnly }
        : {}),
      onEvent: async (event) => {
        // Chunk 8 — append the raw event to the per-turn NDJSON sidecar
        // before any selective forwarding so the audit log is canonical.
        await acpSidecar.append(event);
        // Forward ACP permission lifecycle events onto the agent-event bus
        // so server-chat can broadcast them as "agent" WS events. The UI's
        // inline approval card subscribes there and hydrates a pending
        // approval slot from `permission_request`; `permission_response`
        // clears the card after the user (or auto-reply) decides. Runs
        // without a runId (e.g. background ingestion) still flow through
        // the projector so messaging channels see a status breadcrumb.
        if (
          params.runId?.trim() &&
          (event.type === "permission_request" || event.type === "permission_response")
        ) {
          emitAgentEvent({
            runId: params.runId.trim(),
            sessionKey: canonicalSessionKey,
            stream: "permission",
            data: { ...event },
          });
        }
        // Chunk 5 — forward `tool_call` events to the agent-event bus as
        // `stream: "tool"` with phase start|update|result so the UI picks
        // up rich tool cards from Claude Code / ACP bridge turns. Track
        // seen toolCallIds in the closure-scoped set above to distinguish
        // first-seen (start) from subsequent (update). Terminal status
        // (completed/failed/error/done) always becomes `result`.
        // Chunk 6 — forward thinking/reasoning deltas. Claude Code surfaces
        // extended-thinking blocks via `text_delta` with `stream: "thought"`.
        // We emit them on a dedicated `stream: "thinking"` channel so the UI
        // can render a collapsible thinking block without polluting the main
        // assistant content stream.
        if (
          params.runId?.trim() &&
          event.type === "text_delta" &&
          event.stream === "thought" &&
          typeof event.text === "string" &&
          event.text.length > 0
        ) {
          // 2026-04-30: DIAG — confirm thought events actually arrive from
          // claude-agent-acp. If this never logs, the SDK isn't emitting
          // thinking_delta despite MAX_THINKING_TOKENS being set, which
          // means the bug is upstream (subscription tier, model, env not
          // reaching the spawned process). Demote to logVerbose once
          // verified.
          console.log(
            `[dispatch-acp] thought delta arrived: ${event.text.length} chars, runId=${params.runId.trim()}`,
          );
          emitAgentEvent({
            runId: params.runId.trim(),
            sessionKey: canonicalSessionKey,
            stream: "thinking",
            data: {
              phase: "delta",
              text: event.text,
              ...(typeof event.signature === "string" ? { signature: event.signature } : {}),
            },
          });
        }
        // Chunk 7 — forward hook_event for inline hook chips. Hooks surface
        // PreToolUse / PostToolUse / Stop / Notification runs from the
        // runtime's hook matcher. Forwarded as stream:"hook" so the UI can
        // render small status chips next to the tool card that triggered
        // them.
        if (params.runId?.trim() && event.type === "hook_event") {
          emitAgentEvent({
            runId: params.runId.trim(),
            sessionKey: canonicalSessionKey,
            stream: "hook",
            data: {
              hookKind: event.hookKind,
              hookName: event.hookName,
              command: event.command,
              statusMessage: event.statusMessage,
              additionalContext: event.additionalContext,
              // permissionDecisionReason intentionally omitted — internal
              // safety reasoning (e.g. "not code or malware") has no user
              // value and clutters the conversation with noise.
              toolName: event.toolName,
              toolCallId: event.toolCallId,
            },
          });
        }
        // Chunk 7 — forward session_system notifications for inline
        // status chips. These cover session-level events that aren't tied
        // to a specific tool call: session_compacted, context_window_warning,
        // model_switched, auth_status, rate_limit, session_resumed (plus
        // runtime-specific open-ended strings). The UI renders these as
        // small status chips distinct from hook chips.
        if (params.runId?.trim() && event.type === "session_system") {
          emitAgentEvent({
            runId: params.runId.trim(),
            sessionKey: canonicalSessionKey,
            stream: "session_system",
            data: {
              kind: event.kind,
              text: event.text,
              details: event.details,
            },
          });
        }
        // Chunk 7 — forward subagent_hop for nested subagent cards. The
        // runtime emits these when a Task tool call spins up a child agent;
        // phases start|progress|end and an optional innerToolCall carry the
        // child's work so the UI can render a nested card inside the parent
        // Task tool card.
        if (params.runId?.trim() && event.type === "subagent_hop") {
          // Native hops are authoritative; tell the enricher to stop
          // synthesizing for this parent tool call.
          subagentEnricher.markNativeHop(event.parentToolCallId);
          emitAgentEvent({
            runId: params.runId.trim(),
            sessionKey: canonicalSessionKey,
            stream: "subagent_hop",
            data: {
              phase: event.phase,
              parentToolCallId: event.parentToolCallId,
              agentId: event.agentId,
              agentSessionId: event.agentSessionId,
              subagentType: event.subagentType,
              description: event.description,
              innerToolCall: event.innerToolCall,
              summary: event.summary,
            },
          });
        }
        // Chunk 8 — synthesize subagent_hop events from Agent/Task tool call
        // lifecycle when the runtime doesn't emit native hops. Produces
        // start on first sighting and end on terminal status; no-ops once a
        // native hop is seen for the same parent tool call.
        if (params.runId?.trim() && event.type === "tool_call") {
          const synth = subagentEnricher.onEvent(event);
          if (synth.length > 0) {
            const rid = params.runId.trim();
            for (const hop of synth) {
              emitAgentEvent({
                runId: rid,
                sessionKey: canonicalSessionKey,
                stream: "subagent_hop",
                data: {
                  phase: hop.phase,
                  parentToolCallId: hop.parentToolCallId,
                  agentId: hop.agentId,
                  subagentType: hop.subagentType,
                  description: hop.description,
                  summary: hop.summary,
                },
              });
            }
          }
        }
        if (params.runId?.trim() && event.type === "tool_call") {
          const rid = params.runId.trim();
          const rawStatus = (event.status ?? "").toLowerCase().trim();
          const isTerminal =
            rawStatus === "completed" ||
            rawStatus === "failed" ||
            rawStatus === "error" ||
            rawStatus === "done" ||
            rawStatus === "cancelled" ||
            rawStatus === "canceled";
          const callId = event.toolCallId ?? `${event.toolName ?? "tool"}:anon`;
          const seenBefore = toolCallsSeen.has(callId);
          let phase: "start" | "update" | "result";
          if (isTerminal) {
            phase = "result";
          } else if (seenBefore) {
            phase = "update";
          } else {
            phase = "start";
            toolCallsSeen.add(callId);
          }
          // Extract a plain-text output for the update/result UI side.
          // contentBlocks are the richer structured shape; surface the
          // first text block as a convenience, and pass rawOutput/blocks
          // along verbatim for renderers that care.
          const firstTextBlock = Array.isArray(event.contentBlocks)
            ? event.contentBlocks.find((b) => b?.type === "text" && typeof b.text === "string")
            : undefined;
          const outputText =
            (typeof firstTextBlock?.text === "string" ? firstTextBlock.text : undefined) ??
            (typeof event.text === "string" && event.text.trim() ? event.text : undefined);
          emitAgentEvent({
            runId: rid,
            sessionKey: canonicalSessionKey,
            stream: "tool",
            data: {
              phase,
              toolCallId: callId,
              name: event.toolName ?? "tool",
              kind: event.kind,
              title: event.title,
              description: event.description,
              status: rawStatus || undefined,
              input: event.rawInput,
              output: outputText,
              rawOutput: event.rawOutput,
              contentBlocks: event.contentBlocks,
              structuredPatch: event.structuredPatch,
              locations: event.locations,
              durationMs: event.durationMs,
              truncated: event.truncated,
              // `partialResult` mirrors the shape that core tool streams use
              // so the existing UI phase:"update" branch picks it up verbatim.
              ...(phase === "update" && outputText ? { partialResult: { text: outputText } } : {}),
              // On terminal, also include `result` for the phase:"result"
              // UI branch which reads `data.result || data.output || data.error`.
              ...(phase === "result" ? { result: outputText } : {}),
            },
          });
        }
        await projector.onEvent(event);
      },
    });

    await projector.flush(true);
    queuedFinal =
      (await finalizeAcpTurnOutput({
        cfg: params.cfg,
        sessionKey: canonicalSessionKey,
        delivery,
        inboundAudio: params.inboundAudio,
        sessionTtsAuto: params.sessionTtsAuto,
        ttsChannel: params.ttsChannel,
        shouldEmitResolvedIdentityNotice,
      })) || queuedFinal;

    const counts = params.dispatcher.getQueuedCounts();
    delivery.applyRoutedCounts(counts);
    const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
    if (params.runId?.trim()) {
      emitAgentEvent({
        runId: params.runId.trim(),
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "end",
          startedAt: acpDispatchStartedAt,
          endedAt: Date.now(),
          ...(readyMeta?.backend ? { runtime: readyMeta.backend } : {}),
          ...(readyMeta?.runtimeOptions?.model ? { model: readyMeta.runtimeOptions.model } : {}),
          ...(readyMeta?.runtimeSessionName ? { sessionRef: readyMeta.runtimeSessionName } : {}),
        },
      });
    }
    logVerbose(
      `acp-dispatch: session=${sessionKey} outcome=ok latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
    );
    // 2026-04-30 (#94): record successful preamble delivery so subsequent
    // turns on this same acpx process don't re-inject. Runtime-flip mints a
    // new `runtimeSessionName`, so a flipped session re-injects naturally.
    if (contextPreamble) {
      markAcpContextPreambleDelivered({
        sessionKey: canonicalSessionKey,
        runtimeSessionName: readyMeta?.runtimeSessionName,
      });
    }
    params.recordProcessed("completed", { reason: "acp_dispatch" });
    params.markIdle("message_completed");
    return { queuedFinal, counts };
  } catch (err) {
    await projector.flush(true);
    const acpError = toAcpRuntimeError({
      error: err,
      fallbackCode: "ACP_TURN_FAILED",
      fallbackMessage: "ACP turn failed before completion.",
    });
    await maybeUnbindStaleBoundConversations({
      targetSessionKey: canonicalSessionKey,
      error: acpError,
    });
    const delivered = await delivery.deliver("final", {
      text: formatAcpRuntimeErrorText(acpError),
      isError: true,
    });
    queuedFinal = queuedFinal || delivered;
    const counts = params.dispatcher.getQueuedCounts();
    delivery.applyRoutedCounts(counts);
    const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
    if (params.runId?.trim()) {
      emitAgentEvent({
        runId: params.runId.trim(),
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "error",
          startedAt: acpDispatchStartedAt,
          endedAt: Date.now(),
          error: acpError.message,
        },
      });
    }
    logVerbose(
      `acp-dispatch: session=${sessionKey} outcome=error code=${acpError.code} latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
    );
    params.recordProcessed("completed", {
      reason: `acp_error:${acpError.code.toLowerCase()}`,
    });
    params.markIdle("message_completed");
    return { queuedFinal, counts };
  } finally {
    // 2026-04-30: restore MAX_THINKING_TOKENS to its pre-dispatch value so
    // concurrent ACP turns dispatched with different presets don't observe
    // each other's thinking budgets. Only touches the env if WE mutated it
    // (preset path); turns dispatched without a preset leave the gateway
    // default in place untouched.
    if (thinkingEnvSnapshot.mutated) {
      if (thinkingEnvSnapshot.previous === undefined) {
        delete process.env.MAX_THINKING_TOKENS;
      } else {
        process.env.MAX_THINKING_TOKENS = thinkingEnvSnapshot.previous;
      }
    }
  }
}
