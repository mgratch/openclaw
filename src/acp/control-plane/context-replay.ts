/**
 * Context-replay — priming payload + warm-session pool for mid-conversation
 * model switches across an ACP runtime boundary.
 *
 * Background: each ACP session is anchored to a specific backend runtime
 * handle (e.g. a specific `acpx` subprocess pinned to one model). When a
 * user switches models mid-conversation and the switch crosses an ACP
 * boundary (different backend runtime altogether, not just a `--model`
 * override), the existing handle cannot continue the conversation. We need
 * to:
 *
 *   1. Serialize the active branch's conversation history into a shape
 *      the new runtime can accept as priming input.
 *   2. Fork the conversation tree so the old handle's branch stays intact
 *      (the UI's tree-split model, see `useConversationTreeStore`).
 *   3. Keep the old runtime handle warm for ~5 minutes so a back-switch
 *      doesn't pay the spawn+prime cost again. Beyond the TTL we evict.
 *
 * This module implements (1) and (3) as pure data structures. The actual
 * fork + new-session spawn is driven by the ACP session manager using the
 * payload produced here; wiring lives in `manager.core.ts` model-switch
 * paths.
 */

export interface ReplayMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** Optional timestamp for ordering / debugging. */
  timestamp?: number;
}

export interface ReplayPayload {
  /** Identifier of the source session whose history we're replaying. */
  sourceSessionKey: string;
  /** Target model we're switching to — recorded for telemetry, not injected. */
  targetModel: string;
  /** Messages in chronological order, already filtered to replay-safe roles. */
  messages: ReplayMessage[];
  /** Optional system-level prologue (injected as a leading system message
   *  on the new runtime, where supported). */
  systemPrologue?: string;
  /** Total rough character count — callers use this to decide whether to
   *  summarize before replay. */
  approxChars: number;
}

export interface PrepareReplayInput {
  sourceSessionKey: string;
  targetModel: string;
  messages: ReplayMessage[];
  systemPrologue?: string;
  /** Optional soft cap; when total chars exceed this, older turns are
   *  dropped from the front (oldest-first). Defaults to 120k chars. */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 120_000;

/** Build a replay payload from a branch's message history. Drops streaming
 *  placeholders, empty content, and roles outside user/assistant/system.
 *  Enforces a soft char cap by dropping the oldest turns first. */
export function prepareReplay(input: PrepareReplayInput): ReplayPayload {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const cleaned: ReplayMessage[] = [];
  for (const m of input.messages) {
    if (!m || typeof m.content !== "string") continue;
    const text = m.content.trim();
    if (!text) continue;
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") {
      continue;
    }
    cleaned.push({ role: m.role, content: text, timestamp: m.timestamp });
  }

  // Drop from the front (oldest) until under cap. Always keep the last user
  // turn so the new runtime has an anchor to respond to.
  let approx = cleaned.reduce((n, m) => n + m.content.length, 0);
  while (approx > maxChars && cleaned.length > 1) {
    const dropped = cleaned.shift();
    if (!dropped) break;
    approx -= dropped.content.length;
  }

  return {
    sourceSessionKey: input.sourceSessionKey,
    targetModel: input.targetModel,
    messages: cleaned,
    systemPrologue: input.systemPrologue,
    approxChars: approx,
  };
}

/**
 * Render a replay payload as a single priming string suitable for runtimes
 * that take a plain prompt rather than a structured transcript. Format:
 *
 *     <system prologue>
 *
 *     [user] ...
 *     [assistant] ...
 *     [user] ...
 *
 * The caller is responsible for framing this further if the target runtime
 * needs something different.
 */
export function renderReplayAsPrompt(payload: ReplayPayload): string {
  const parts: string[] = [];
  if (payload.systemPrologue?.trim()) {
    parts.push(payload.systemPrologue.trim(), "");
  }
  for (const m of payload.messages) {
    parts.push(`[${m.role}] ${m.content}`);
  }
  return parts.join("\n");
}

// ─── Warm-session pool ──────────────────────────────────────────────────
//
// Holds recently-used (model → sessionKey) mappings so a mid-conversation
// back-switch can reuse the prior handle instead of spawning+priming from
// scratch. Pool is pure in-memory; entries age out after a TTL.

export interface WarmEntry {
  sessionKey: string;
  lastUsedAt: number;
}

export interface WarmSessionPool {
  /** Record that a session is the warm handle for a given model. */
  put(model: string, sessionKey: string): void;
  /** Look up the warm handle for a model; returns null if absent or expired. */
  get(model: string): string | null;
  /** Evict a specific model's entry (e.g. after a forced reset). */
  evict(model: string): void;
  /** Drop all expired entries. Usually invoked on each put/get. */
  gc(): void;
  /** Testing helper — expose current size. */
  size(): number;
}

export function createWarmSessionPool(options?: {
  ttlMs?: number;
  now?: () => number;
}): WarmSessionPool {
  const ttlMs = options?.ttlMs ?? 5 * 60_000;
  const now = options?.now ?? (() => Date.now());
  const entries = new Map<string, WarmEntry>();

  function gc(): void {
    const cutoff = now() - ttlMs;
    for (const [model, entry] of entries) {
      if (entry.lastUsedAt < cutoff) {
        entries.delete(model);
      }
    }
  }

  return {
    put(model, sessionKey) {
      if (!model || !sessionKey) return;
      entries.set(model, { sessionKey, lastUsedAt: now() });
      gc();
    },
    get(model) {
      gc();
      const entry = entries.get(model);
      if (!entry) return null;
      entry.lastUsedAt = now();
      return entry.sessionKey;
    },
    evict(model) {
      entries.delete(model);
    },
    gc,
    size() {
      return entries.size;
    },
  };
}
