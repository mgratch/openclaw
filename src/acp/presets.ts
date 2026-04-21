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
}

export const ACP_MODEL_PRESETS: readonly AcpModelPreset[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    agent: "claude-code",
    description: "Claude Code via acpx (agent default model)",
  },
  {
    id: "claude-code-opus",
    label: "Claude Code · Opus 4.7",
    agent: "claude-code",
    acpxModel: "claude-opus-4-7",
    description: "Claude Code pinned to claude-opus-4-7",
  },
  {
    id: "claude-code-opus-4-6",
    label: "Claude Code · Opus 4.6",
    agent: "claude-code",
    acpxModel: "claude-opus-4-6",
    description: "Claude Code pinned to claude-opus-4-6",
  },
  {
    id: "claude-code-sonnet",
    label: "Claude Code · Sonnet",
    agent: "claude-code",
    acpxModel: "claude-sonnet-4-6",
    description: "Claude Code pinned to claude-sonnet-4-6",
  },
  {
    id: "claude-code-haiku",
    label: "Claude Code · Haiku",
    agent: "claude-code",
    acpxModel: "claude-haiku-4-5",
    description: "Claude Code pinned to claude-haiku-4-5",
  },
];

const PRESET_BY_ID: ReadonlyMap<string, AcpModelPreset> = new Map(
  ACP_MODEL_PRESETS.map((p) => [p.id, p] as const),
);

/** Look up a preset by UI-facing id. Returns undefined for unknown ids. */
export function resolveAcpModelPreset(id: string | undefined | null): AcpModelPreset | undefined {
  if (!id) return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  return PRESET_BY_ID.get(trimmed);
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
