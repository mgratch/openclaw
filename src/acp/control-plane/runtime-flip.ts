/**
 * Runtime-flip — per-turn dispatch routing across ACP boundaries via preset
 * model selection. When a user selects an ACP preset model (e.g.
 * `claude-code-opus`) on a non-ACP session, or vice versa, this module
 * synthesizes a warm-session entry + replay payload so the dispatcher can
 * route through ACP with the prior conversation history primed.
 *
 * Design:
 *   - Detects preset override BEFORE tryDispatchAcpReply in dispatch-from-config.ts
 *   - If preset is selected on a non-ACP session, looks up warm pool for a prior
 *     ACP session with this preset. If absent, returns flip context with empty
 *     replay (caller must fork a new ACP session + prime on first turn).
 *   - If a non-preset override is selected on an ACP session, signals passthrough
 *     to allow normal provider dispatch (TODO: implement if needed).
 *   - Warm pool keyed by `${sourceSessionKey}::${presetId}` so back-switches to
 *     the same preset reuse the prior runtime handle (5-minute TTL).
 *   - Replay payload built from the source session's transcript using
 *     prepareReplay from context-replay.ts; trimmed to maxChars if needed.
 *
 * Session-key format audit:
 *   - Spawned ACP session keys follow canonical agent-scoped format:
 *     agent:<agentId>:acp:preset:<presetId>:<timestamp>:<random>
 *   - Verified compatible with parseAgentSessionKey (src/sessions/session-key-utils.ts)
 *     which checks first 2 parts (agent:<agentId>) then rest starts with acp:.
 *   - Also verified compatible with isAcpSessionKey check (line 114-119 of same file)
 *     which recognizes both raw acp: prefix and parsed rest pattern.
 *   - No collision risk with existing binding format (agent:<id>:acp:binding:...)
 *     because preset namespace is distinct (acp:preset:... vs acp:binding:...).
 */

import type { FinalizedMsgContext } from "../../auto-reply/templating.js";
import type { OpenClawConfig } from "../../config/config.js";
import { logVerbose } from "../../globals.js";
import { getLogger } from "../../logging/logger.js";

function logInfo(message: string) {
  try {
    getLogger().info({ message }, "runtime-flip");
  } catch {
    // fall through to logVerbose below
  }
  logVerbose(message);
}
import { resolveAcpModelPreset } from "../presets.js";
import {
  prepareReplay,
  createWarmSessionPool,
  type ReplayPayload,
  type WarmSessionPool,
} from "./context-replay.js";
import { getAcpSessionManager } from "./manager.js";

export interface RuntimeFlipContext {
  /** Detected ACP preset, if any. */
  preset: ReturnType<typeof resolveAcpModelPreset>;
  /** Source session we're flipping from (non-ACP session selecting ACP preset). */
  sourceSessionKey?: string;
  /** Target warm-session key to reuse if available (from prior flip to same preset). */
  warmSessionKey?: string;
  /** Newly spawned ACP session key (set after performRuntimeFlip succeeds). */
  spawnedSessionKey?: string;
  /** Replay payload if switching to a new ACP session (prime the conversation). */
  replayPayload?: ReplayPayload;
}

export interface RuntimeFlipInput {
  modelOverride?: string;
  sourceSessionKey?: string;
  isSourceAcpSession: boolean;
  /** Optional callback to read source session's message history. */
  readSourceMessages?: () => Promise<
    Array<{
      role: "user" | "assistant" | "system";
      content: string;
      timestamp?: number;
    }>
  >;
}

export class RuntimeFlipManager {
  private warmPool: WarmSessionPool;

  constructor() {
    this.warmPool = createWarmSessionPool({
      ttlMs: 5 * 60_000, // 5 minutes
    });
  }

  /**
   * Detect preset override and synthesize flip context. Called BEFORE
   * tryDispatchAcpReply in the dispatch flow to intercept preset selections.
   */
  async detectFlip(input: RuntimeFlipInput): Promise<RuntimeFlipContext | null> {
    const preset = resolveAcpModelPreset(input.modelOverride);
    if (!preset) {
      return null;
    }

    // Preset selected. If source is already ACP-backed, no flip needed
    // (dispatch-acp will handle the per-turn model override).
    if (input.isSourceAcpSession) {
      logInfo(
        `preset ${preset.id} selected on ACP session ` +
          `${input.sourceSessionKey}; passing through to dispatch-acp`,
      );
      return null;
    }

    // Non-ACP session selecting ACP preset. Check warm pool for a prior
    // session with this preset.
    const warmPoolKey = input.sourceSessionKey ? `${input.sourceSessionKey}::${preset.id}` : null;
    const warmSessionKey = warmPoolKey ? this.warmPool.get(warmPoolKey) : null;

    logInfo(
      `preset ${preset.id} selected on non-ACP session ` +
        `${input.sourceSessionKey}; warmPoolKey=${warmPoolKey} warm=${warmSessionKey ? "HIT" : "MISS"}`,
    );

    let replayPayload: ReplayPayload | undefined;
    if (!warmSessionKey && input.readSourceMessages) {
      // No warm session; build replay payload from source transcript.
      try {
        const messages = await input.readSourceMessages();
        replayPayload = prepareReplay({
          sourceSessionKey: input.sourceSessionKey ?? "unknown",
          targetModel: preset.acpxModel ?? preset.agent,
          messages,
          maxChars: 120_000,
        });
      } catch (error) {
        logVerbose(
          `runtime-flip: failed to read source messages for replay: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      preset,
      sourceSessionKey: input.sourceSessionKey,
      warmSessionKey: warmSessionKey ?? undefined,
      replayPayload,
    };
  }

  /**
   * Record a warm session for this (sourceSessionKey, preset) pair so a
   * back-switch reuses the handle.
   */
  recordWarmSession(sourceSessionKey: string, presetId: string, newSessionKey: string): void {
    const warmPoolKey = `${sourceSessionKey}::${presetId}`;
    this.warmPool.put(warmPoolKey, newSessionKey);
    logVerbose(`runtime-flip: recorded warm session ${newSessionKey} for ${warmPoolKey}`);
  }

  /** Testing helper. */
  getWarmPoolSize(): number {
    return this.warmPool.size();
  }
}

// Singleton instance shared across the gateway.
const sharedFlipManager = new RuntimeFlipManager();

export function getOrCreateRuntimeFlipManager(): RuntimeFlipManager {
  return sharedFlipManager;
}

export function recordWarmSessionForPreset(
  sourceSessionKey: string,
  presetId: string,
  newSessionKey: string,
): void {
  sharedFlipManager.recordWarmSession(sourceSessionKey, presetId, newSessionKey);
}

export async function detectRuntimeFlip(
  input: RuntimeFlipInput,
): Promise<RuntimeFlipContext | null> {
  return sharedFlipManager.detectFlip(input);
}

/**
 * Perform a new runtime flip: spawn a fresh ACP session for the preset,
 * prime it with the replay payload, and record it in the warm pool.
 * Called when a flip is detected but no warm session exists yet.
 * Returns the new ACP session key or null if spawn fails.
 */
export async function performRuntimeFlip(params: {
  flipContext: RuntimeFlipContext;
  cfg: OpenClawConfig;
  ctx: FinalizedMsgContext;
  sourceSessionKey?: string;
}): Promise<string | null> {
  if (!params.flipContext.preset || !params.flipContext.sourceSessionKey) {
    logVerbose("runtime-flip: cannot perform flip without preset and sourceSessionKey");
    return null;
  }

  const acpManager = getAcpSessionManager();
  const preset = params.flipContext.preset;

  // Generate a new ACP session key for this preset flip
  // Use canonical agent-scoped format: agent:<agentId>:acp:preset:<preset>:<timestamp>:<random>
  // This ensures compatibility with parseAgentSessionKey and all session-key routing logic.
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 9);
  const newSessionKey = `agent:${preset.agent}:acp:preset:${preset.id}:${timestamp}:${randomPart}`;

  try {
    logInfo(
      `spawning ACP session ${newSessionKey} for preset ${preset.id} from source ${params.flipContext.sourceSessionKey}`,
    );

    // Initialize new ACP session
    const { handle } = await acpManager.initializeSession({
      cfg: params.cfg,
      sessionKey: newSessionKey,
      agent: preset.agent,
      model: preset.acpxModel,
      mode: "persistent",
    });

    logInfo(
      `initialized ACP session ${newSessionKey} with handle ${handle?.runtimeSessionName ?? "?"}`,
    );

    // Prime turn intentionally disabled for now.
    //
    // Earlier this path called `acpManager.runTurn(...)` right after
    // `initializeSession` to replay prior conversation into the new ACP
    // session. In the Docker acpx runtime this caused an ensureSession repair
    // loop ("status=dead summary=queue owner unavailable") because acpx
    // `sessions new` does not leave a queue owner running — the first prompt
    // spawns one — and our prime turn was racing that startup on the fresh
    // session handle before the OpenClaw acpx backend had cached a healthy
    // handle. The natural first user turn sets everything up cleanly.
    //
    // Trade-off: the ACP session does not receive the prior transcript as a
    // prime; replay context must be delivered inline with the first user turn
    // if we want it. Dispatch-from-config already has the replay payload and
    // can prepend it in a follow-up change.
    if (params.flipContext.replayPayload && params.flipContext.replayPayload.messages.length > 0) {
      logInfo(
        `skipping prime turn for ${newSessionKey} (replay has ${params.flipContext.replayPayload.messages.length} messages, ~${params.flipContext.replayPayload.approxChars} chars) — dispatch will deliver inline`,
      );
    }

    // Record the warm session so back-switches reuse it
    if (params.flipContext.sourceSessionKey && preset.id) {
      recordWarmSessionForPreset(params.flipContext.sourceSessionKey, preset.id, newSessionKey);
    }

    return newSessionKey;
  } catch (error) {
    logInfo(
      `FAILED to spawn ACP session for preset ${preset.id}: ${error instanceof Error ? `${error.message}${error.stack ? "\n" + error.stack : ""}` : String(error)}`,
    );
    return null;
  }
}

/**
 * Construct a replay prompt from the replay payload to prime a new ACP session.
 * Formats the conversation history as a system message.
 *
 * Exported so dispatch-acp can prepend this to the first user turn after a
 * preset flip (runtime-flip intentionally skips prime; dispatch delivers
 * inline). See dispatch-acp.ts where `flipContext.replayPayload` is spliced
 * into `promptText` when `warmSessionKey` is unset.
 */
export function constructReplayPrompt(payload: ReplayPayload): string {
  if (payload.messages.length === 0) {
    return "";
  }

  const lines: string[] = [
    "The following is the conversation history from another session.",
    "Use this context to understand the user's previous questions and answers.",
    "You may reference this history when responding to new messages.",
    "",
  ];

  for (const msg of payload.messages) {
    const role = msg.role === "assistant" ? "Assistant" : msg.role === "system" ? "System" : "User";
    lines.push(`${role}:`, msg.content, "");
  }

  return lines.join("\n");
}
