/**
 * ACP model presets — UI-facing identifiers that route through an ACP-backed
 * agent (acpx) with an optional per-turn model flag.
 *
 * A preset is the glue between three concerns:
 *
 *   1. The **UI model picker**: presents a short, human-friendly id
 *      (`claude-code`, `claude-code-opus`, …) alongside regular provider
 *      models so users can choose "Claude Code" without editing config.
 *
 *   2. The **OpenClaw-side agent id**: every preset resolves to a stable
 *      agent identifier (`claude-code`), which must match an agent whose
 *      `runtime.type === "acp"` is already configured. The preset does NOT
 *      change the agent per-turn; that's a spawn-time decision. The preset
 *      simply validates that a given session is compatible.
 *
 *   3. The **acpx `--model` flag**: each preset carries an optional
 *      `acpxModel` string that gets forwarded verbatim to acpx's
 *      `prompt --model <id>` invocation. The acpx agent decides what to do
 *      with it; for `claude` (Claude Code) this is the backend model id.
 *
 * This file is the single authoritative list on the gateway side. The UI has
 * its own small mirror in `openclaw-ui/src/constants/acpPresets.ts` — keep
 * the two in lockstep when adding presets.
 */

export interface AcpModelPreset {
  /** UI-facing id surfaced in the model picker. */
  readonly id: string;
  /** Human-readable label for the picker. */
  readonly label: string;
  /** OpenClaw agent id — must match the session's ACP agent for the preset to apply. */
  readonly agent: string;
  /** Optional acpx `--model` flag value. When omitted, acpx uses the agent default. */
  readonly acpxModel?: string;
  /** Short one-line hint for the picker tooltip. */
  readonly description?: string;
  /**
   * 2026-04-30: Extended-thinking budget in tokens. Forwarded to the
   * Anthropic Claude SDK via `MAX_THINKING_TOKENS` env var (read at
   * @zed-industries/claude-agent-acp/dist/acp-agent.js:849). When set on a
   * thinking-capable model (Sonnet/Opus 4.x), the SDK enables extended
   * thinking and emits `thinking_delta` chunks that flow through ACP as
   * `agent_thought_chunk` → acpx `text_delta stream:"thought"` →
   * dispatch-acp `stream:"thinking"` → UI <ThinkingBlock>.
   *
   * Haiku does NOT support extended thinking — leave undefined. The SDK
   * silently ignores it for non-thinking models, but flagging it
   * explicitly here lets the UI render an honest "thinking unavailable"
   * hint when haiku is selected.
   */
  readonly maxThinkingTokens?: number;
}

export const ACP_MODEL_PRESETS: readonly AcpModelPreset[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    agent: "claude-code",
    description: "Claude Code via acpx (agent default model)",
    // Default: assume agent default is a thinking-capable model. Override
    // if the agent default is changed to haiku in future.
    maxThinkingTokens: 16000,
  },
  // 2026-04-30: NOTE — the bundled @zed-industries/claude-agent-acp +
  // Anthropic Claude Agent SDK only recognizes these Opus IDs:
  //   claude-opus-4-0 / 4-1 / 4-1-20250805 / 4-20250514 / 4-5 / 4-5-20251101 / 4-6
  // `claude-opus-4-7` is NOT in the SDK's known list and the SDK falls
  // back to a default that does NOT enable extended thinking. Keeping the
  // 4-7 preset as Marc's chosen "latest" — when the SDK ships 4-7
  // support it'll start working without a config change. Until then
  // there's also `claude-code-opus-4-6` which DOES emit thinking events,
  // for users who want thinking working today.
  //
  // 2026-07-31: the bundled Claude Code CLI is now 2.1.220, which
  // recognizes `claude-opus-4-8`, `claude-opus-5`, and `claude-fable-5`
  // (verified by grepping the CLI binary in the built image) — hence the
  // opus-4-8 / opus-5 / fable presets below. The acpx `--model` flag is
  // forwarded verbatim (no silent remap anywhere in the chain), so a
  // preset pinning an ID the bundled CLI does not know fails visibly at
  // the acpx/CLI layer rather than being quietly rewritten.
  {
    id: "claude-code-opus",
    label: "Claude Code · Opus 4.7",
    agent: "claude-code",
    acpxModel: "claude-opus-4-7",
    description: "Claude Code pinned to claude-opus-4-7",
    maxThinkingTokens: 16000,
  },
  {
    id: "claude-code-opus-4-6",
    label: "Claude Code · Opus 4.6",
    agent: "claude-code",
    acpxModel: "claude-opus-4-6",
    description: "Claude Code pinned to claude-opus-4-6 (extended thinking on)",
    maxThinkingTokens: 16000,
  },
  {
    id: "claude-code-opus-4-5",
    label: "Claude Code · Opus 4.5",
    agent: "claude-code",
    acpxModel: "claude-opus-4-5-20251101",
    description: "Claude Code pinned to claude-opus-4-5-20251101 (extended thinking on)",
    maxThinkingTokens: 16000,
  },
  {
    id: "claude-code-opus-4-8",
    label: "Claude Code · Opus 4.8",
    agent: "claude-code",
    acpxModel: "claude-opus-4-8",
    description: "Claude Code pinned to claude-opus-4-8 (extended thinking on)",
    maxThinkingTokens: 16000,
  },
  {
    id: "claude-code-opus-5",
    label: "Claude Code · Opus 5.0",
    agent: "claude-code",
    acpxModel: "claude-opus-5",
    description: "Claude Code pinned to claude-opus-5 (extended thinking on)",
    maxThinkingTokens: 16000,
  },
  {
    id: "claude-code-fable",
    label: "Claude Code · Fable 5",
    agent: "claude-code",
    acpxModel: "claude-fable-5",
    description: "Claude Code pinned to claude-fable-5 (extended thinking on)",
    maxThinkingTokens: 16000,
  },
  {
    id: "claude-code-sonnet",
    label: "Claude Code · Sonnet",
    agent: "claude-code",
    acpxModel: "claude-sonnet-4-6",
    description: "Claude Code pinned to claude-sonnet-4-6 (extended thinking on)",
    maxThinkingTokens: 10000,
  },
  {
    id: "claude-code-haiku",
    label: "Claude Code · Haiku",
    agent: "claude-code",
    acpxModel: "claude-haiku-4-5",
    description: "Claude Code pinned to claude-haiku-4-5 (no extended thinking)",
    // Haiku family does not support extended thinking — leave undefined.
  },
];

const PRESET_BY_ID: ReadonlyMap<string, AcpModelPreset> = new Map(
  ACP_MODEL_PRESETS.map((p) => [p.id, p] as const),
);

// 2026-04-30: also index by acpxModel so we can resolve a preset back from
// the value stored in `SessionAcpMeta.runtimeOptions.model`. After spawn,
// the session meta carries the acpx flag value (e.g. "claude-opus-4-7"),
// not the preset id (e.g. "claude-code-opus") — without this fallback,
// per-preset features (extended thinking, future per-preset tweaks) would
// never apply to fresh sessions that haven't had their model overridden.
const PRESET_BY_ACPX_MODEL: ReadonlyMap<string, AcpModelPreset> = new Map(
  ACP_MODEL_PRESETS.flatMap((p) =>
    typeof p.acpxModel === "string" && p.acpxModel ? [[p.acpxModel, p] as const] : [],
  ),
);

/** Look up a preset by UI-facing id. Returns undefined for unknown ids. */
export function resolveAcpModelPreset(id: string | undefined | null): AcpModelPreset | undefined {
  if (!id) {
    return undefined;
  }
  const trimmed = id.trim();
  if (!trimmed) {
    return undefined;
  }
  return PRESET_BY_ID.get(trimmed);
}

/**
 * 2026-04-30: Look up a preset by either UI id OR the acpx model flag value
 * stored on persisted session meta. Use this when reading from
 * `SessionAcpMeta.runtimeOptions.model` — that field can hold either form
 * depending on whether the user has overridden the model.
 */
export function resolveAcpModelPresetFlexible(
  idOrAcpxModel: string | undefined | null,
): AcpModelPreset | undefined {
  if (!idOrAcpxModel) {
    return undefined;
  }
  const trimmed = idOrAcpxModel.trim();
  if (!trimmed) {
    return undefined;
  }
  return PRESET_BY_ID.get(trimmed) ?? PRESET_BY_ACPX_MODEL.get(trimmed);
}

/** True if the given id names an ACP preset (any variant). */
export function isAcpModelPreset(id: string | undefined | null): boolean {
  return resolveAcpModelPreset(id) !== undefined;
}

/**
 * Apply a preset to a per-turn model override. If `modelOverride` names a
 * preset AND the session's current acp agent matches the preset's agent,
 * returns the acpx model flag the preset wants (or `undefined` to fall back
 * to the agent default). Returns the original `modelOverride` unchanged
 * when it is not a preset, or when the preset agent does not match the
 * session agent (in which case the caller should reject or surface a
 * warning — this function is purely a resolver, it does not enforce).
 */
export function resolvePerTurnAcpModel(params: {
  modelOverride: string | undefined;
  sessionAgent: string | undefined;
}): { model: string | undefined; preset?: AcpModelPreset; agentMismatch?: boolean } {
  const preset = resolveAcpModelPreset(params.modelOverride);
  if (!preset) {
    return { model: params.modelOverride };
  }
  const sessionAgent = params.sessionAgent?.trim() ?? "";
  if (sessionAgent && sessionAgent !== preset.agent) {
    // Caller should decide whether to block, warn, or pass through. We
    // hand back the preset + agentMismatch so the dispatcher can log and
    // fall back to the raw override.
    return { model: params.modelOverride, preset, agentMismatch: true };
  }
  return { model: preset.acpxModel, preset };
}
