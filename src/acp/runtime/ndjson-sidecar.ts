/**
 * ACP NDJSON sidecar — per-turn raw event logger.
 *
 * Writes every `AcpRuntimeEvent` for a turn to `<transcript>.acp.jsonl`
 * alongside the main session transcript. This gives us a lossless audit
 * trail of everything the runtime emitted (text_delta, tool_call, hooks,
 * permission lifecycle, etc.) independent of the projector's lossy
 * rendering into messaging channels, so upgrades, debugging, and replay
 * harnesses all have a canonical source to read from.
 *
 * The sidecar is intentionally append-only and never reads back: readers
 * should stream the file line-by-line and apply event semantics
 * themselves. Each line is a single JSON object shaped as:
 *
 *   { ts: <epochMs>, runId: <string?>, event: <AcpRuntimeEvent> }
 *
 * Failures to open or write never propagate — we log and swallow so a
 * broken sidecar cannot stall a live turn.
 */

import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AcpRuntimeEvent } from "./types.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { resolveSessionTranscriptPath } from "../../config/sessions/paths.js";
import { logVerbose } from "../../globals.js";

/**
 * 2026-04-30: Webchat session keys (e.g. `web-05005d10`) are not
 * agent-scoped — `parseAgentSessionKey` returns null for them. Without a
 * fallback, every webchat ACP turn would silently no-op the sidecar,
 * making it impossible to debug Claude Code → ACP event streams from the
 * UI. Falls back to `~/.openclaw/workspace/acp-sidecars/<sanitized>.acp.jsonl`
 * so every turn lands somewhere readable on disk.
 */
function fallbackSidecarPath(sessionKey: string): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR
    ? process.env.OPENCLAW_STATE_DIR
    : path.join(os.homedir(), ".openclaw");
  const sanitized = sessionKey.replace(/[^a-zA-Z0-9_\-:.]/g, "_").slice(0, 200) || "_unknown";
  return path.join(stateDir, "workspace", "acp-sidecars", `${sanitized}.acp.jsonl`);
}

export type AcpNdjsonSidecar = {
  /** Append one event. Never throws — errors are logged and swallowed. */
  append: (event: AcpRuntimeEvent) => Promise<void>;
  /** Path the sidecar is writing to, or null if resolution failed. */
  path: string | null;
};

/** Disable via env; useful for tests and for operators who would rather opt in. */
function sidecarDisabled(): boolean {
  const raw = (process.env.OPENCLAW_ACP_NDJSON ?? "").trim().toLowerCase();
  return raw === "0" || raw === "off" || raw === "false" || raw === "no";
}

/**
 * Create a per-turn sidecar for the given session. The sidecar path mirrors
 * the main transcript path with `.jsonl` → `.acp.jsonl`. If we cannot parse
 * the session key (unusual — all ACP turns have canonical agent-scoped
 * keys) the returned sidecar is a no-op.
 */
export function createAcpNdjsonSidecar(
  sessionKey: string,
  runId: string | undefined,
): AcpNdjsonSidecar {
  if (sidecarDisabled()) {
    return { append: async () => {}, path: null };
  }
  let resolved: string | null = null;
  try {
    const parsed = parseAgentSessionKey(sessionKey);
    if (parsed) {
      const transcriptPath = resolveSessionTranscriptPath(parsed.rest, parsed.agentId);
      // Swap the trailing `.jsonl` for `.acp.jsonl` so the sidecar sits
      // next to the main transcript and sorts together in tooling.
      resolved = transcriptPath.endsWith(".jsonl")
        ? transcriptPath.slice(0, -".jsonl".length) + ".acp.jsonl"
        : `${transcriptPath}.acp.jsonl`;
    } else {
      // 2026-04-30: webchat sessions have non-agent-scoped keys
      // (e.g. `web-05005d10`). Fall back to a workspace-rooted directory
      // so every ACP turn lands somewhere readable, instead of silently
      // no-op'ing the sidecar and losing all debug visibility.
      resolved = fallbackSidecarPath(sessionKey);
      console.log(
        `[acp-ndjson] non-agent-scoped session key "${sessionKey}" — using fallback path ${resolved}`,
      );
    }
  } catch (err) {
    logVerbose(
      `acp-ndjson: path resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!resolved) {
    return { append: async () => {}, path: null };
  }

  // Ensure the parent directory exists. If mkdir fails we fall through —
  // append will error on the first write and we'll swallow it there.
  let dirEnsured = false;
  const ensureDir = async () => {
    if (dirEnsured) return;
    try {
      await mkdir(path.dirname(resolved!), { recursive: true });
      dirEnsured = true;
    } catch (err) {
      logVerbose(
        `acp-ndjson: mkdir failed for ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    path: resolved,
    append: async (event: AcpRuntimeEvent) => {
      try {
        await ensureDir();
        const line =
          JSON.stringify({
            ts: Date.now(),
            ...(runId ? { runId } : {}),
            event,
          }) + "\n";
        await appendFile(resolved!, line, "utf8");
      } catch (err) {
        logVerbose(
          `acp-ndjson: append failed for ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
