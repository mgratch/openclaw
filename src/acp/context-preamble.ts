/**
 * ACP context preamble — restores the lost "Claude Code knows about
 * OpenClaw's memory/skills/plugins/tools" surface (#94, 2026-04-30).
 *
 * Background: ACP runtimes (acpx → claude-code, codex, …) spawn an external
 * agent process whose system prompt is OWNED BY that process. OpenClaw's
 * `buildAgentSystemPrompt` is therefore not in the loop, so the
 * gateway-side description of memory/skills/plugins/tools never reaches the
 * agent. The agent then drifts: it forgets about OpenClaw's persistent
 * memory dir, the slash-command skills installed in the workspace, the
 * connected plugins/MCPs, and the gateway-injected tools.
 *
 * Fix: prepend a short "OpenClaw runtime context" block to the FIRST user
 * turn of every fresh ACP session (and again after a runtime flip — the
 * spawned acpx process is brand new and starts with no in-context
 * knowledge of the host environment). One delivery per acpx process is
 * enough because subsequent turns share that process's accumulated context.
 *
 * Trigger logic lives in dispatch-acp.ts and gates on
 * `SessionAcpMeta.contextPreambleAt`. After a successful first dispatch
 * the gateway writes `contextPreambleAt: Date.now()`; runtime-flip clears
 * it (alongside the rest of the acp meta swap) so the next first-turn
 * after a flip re-injects.
 *
 * Tunable: drop a markdown override at `$OPENCLAW_STATE_DIR/acp-context-preamble.md`
 * to replace the default text with site-specific guidance. Empty file
 * disables the feature for the user.
 */

import fs from "node:fs";
import nodePath from "node:path";

const DEFAULT_PREAMBLE = `### OpenClaw runtime context (auto-injected)

You are running inside an OpenClaw ACP session. The host environment provides:

- **Persistent memory**: a project-scoped memory directory at \`~/.openclaw/spaces/<spaceId>/memory/\` containing \`MEMORY.md\` (the index) and individual memory files. Read these at the start of any task that touches user preferences, project context, or prior decisions. Update them when you learn durable facts.
- **Skills**: invocable via slash commands like \`/skill-name\`. Common skills include \`docx\`, \`pptx\`, \`xlsx\`, \`pdf\` for document work, plus user-installed skills under \`~/.openclaw/plugins/\`.
- **Plugins / MCP servers**: connected MCP servers expose namespaced tools (Slack, Gmail, Calendar, Linear, etc.) — prefer them over computer-use for the apps they cover.
- **Tools**: in addition to your built-in toolset, OpenClaw routes additional tool calls through the gateway. These appear under their normal names; treat them as available unless a tool call returns a "not connected" error.

This context is injected ONCE per ACP runtime process. If you appear to have lost track of any of these capabilities mid-conversation, tell the user — there may have been a runtime flip and re-injection failed.

---

`;

const PREAMBLE_OVERRIDE_FILENAME = "acp-context-preamble.md";

function resolveStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR
    ? process.env.OPENCLAW_STATE_DIR
    : nodePath.join(process.env.HOME ?? "~", ".openclaw");
}

/**
 * Build the ACP context preamble. Prefers a user-provided override file at
 * `$OPENCLAW_STATE_DIR/acp-context-preamble.md`; falls back to the bundled
 * default. Returns an empty string when the override exists but is empty,
 * which acts as an opt-out.
 */
export function buildAcpContextPreamble(): string {
  try {
    const overridePath = nodePath.join(resolveStateDir(), PREAMBLE_OVERRIDE_FILENAME);
    if (fs.existsSync(overridePath)) {
      const raw = fs.readFileSync(overridePath, "utf8");
      // Empty override = explicit opt-out.
      if (raw.trim().length === 0) {
        return "";
      }
      return raw.endsWith("\n") ? raw : `${raw}\n`;
    }
  } catch {
    // Best effort — fall through to default on any read error.
  }
  return DEFAULT_PREAMBLE;
}

/**
 * In-memory tracker for "we already delivered the preamble to this acpx
 * runtime session". Keyed by `${sessionKey}\0${runtimeSessionName}` so a
 * runtime flip (which mints a new runtimeSessionName) automatically forces
 * re-injection on the next dispatch. Lost on gateway restart, which is the
 * desired behavior — the acpx process is also gone after a gateway
 * restart, so its memory of the preamble is gone too.
 *
 * Exported for testing only.
 */
export const acpContextPreambleDelivered = new Set<string>();

function preambleKey(sessionKey: string, runtimeSessionName: string | undefined): string {
  return `${sessionKey}\0${runtimeSessionName ?? ""}`;
}

/**
 * @returns true if the preamble should be prepended to the next dispatch
 * for this `(sessionKey, runtimeSessionName)` pair. Pure read — call
 * `markAcpContextPreambleDelivered` after a successful dispatch.
 */
export function shouldInjectAcpContextPreamble(params: {
  sessionKey: string;
  runtimeSessionName: string | undefined;
}): boolean {
  return !acpContextPreambleDelivered.has(preambleKey(params.sessionKey, params.runtimeSessionName));
}

/**
 * Record that the preamble was delivered for this `(sessionKey,
 * runtimeSessionName)` pair so subsequent dispatches don't re-inject.
 */
export function markAcpContextPreambleDelivered(params: {
  sessionKey: string;
  runtimeSessionName: string | undefined;
}): void {
  acpContextPreambleDelivered.add(preambleKey(params.sessionKey, params.runtimeSessionName));
}
