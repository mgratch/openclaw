/**
 * Session log reader — post-turn back-fill from acpx's own NDJSON sidecar.
 *
 * acpx writes every session update to `~/.acpx/sessions/<acpxSessionId>.stream.ndjson`.
 * That sidecar is strictly a superset of the live stream OpenClaw consumes:
 * if the runtime drops events (because an abort/timeout cut the async
 * iterator short, or because the event type was filtered before reaching
 * the dispatcher), they still land in the file.
 *
 * This module reads that file after each turn and emits any lines that
 * weren't already forwarded during the live stream. It is intentionally
 * conservative:
 *
 *   - Opt-in via `OPENCLAW_ACP_LOG_READER=1`. Default off until the
 *     acpx sidecar schema is pinned.
 *   - Purely additive: it never rewrites, truncates, or moves the sidecar.
 *   - Tracks a per-session byte offset so repeat invocations only emit
 *     newly-appended lines.
 *   - Best-effort: any filesystem, parse, or forwarding error is logged
 *     and swallowed; the main turn result is unaffected.
 *
 * The plan calls for feeding back-filled `hook_event`, `session_system`,
 * and `subagent_hop` events through the normal agent-events bus so the
 * UI gets the same chips/cards it would have gotten had the events
 * streamed live. Callers supply an `onEvent` forwarder that matches the
 * shape of dispatch-acp's live-stream handler; this module does not
 * know about agent-events directly.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AcpRuntimeEvent } from "../runtime/types.js";

const ENV_FLAG = "OPENCLAW_ACP_LOG_READER";

/** Kinds of events we back-fill. Text/tool_call/text_delta are already
 *  authoritative on the live stream; replaying them would duplicate
 *  content. We only back-fill chips/hops that the UI otherwise misses. */
const BACKFILL_EVENT_TYPES = new Set<AcpRuntimeEvent["type"]>([
  "hook_event",
  "session_system",
  "subagent_hop",
]);

interface OffsetEntry {
  byteOffset: number;
  mtimeMs: number;
}

const offsetsByPath = new Map<string, OffsetEntry>();

function isReaderEnabled(): boolean {
  const v = process.env[ENV_FLAG]?.trim();
  if (!v) return false;
  return v !== "0" && v.toLowerCase() !== "false";
}

function resolveSidecarPath(acpxSessionId: string): string {
  const root = process.env.ACPX_HOME?.trim() || path.join(os.homedir(), ".acpx");
  return path.join(root, "sessions", `${acpxSessionId}.stream.ndjson`);
}

function parseLine(line: string): AcpRuntimeEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as AcpRuntimeEvent;
    }
  } catch {
    return null;
  }
  return null;
}

export interface SessionLogReaderInput {
  acpxSessionId: string | undefined;
  /** Set of already-forwarded event fingerprints from the live stream, so
   *  duplicates are dropped rather than re-emitted. See `fingerprintEvent`. */
  seenFingerprints?: ReadonlySet<string>;
  /** Forwarder the caller uses to push back-filled events upstream. */
  onEvent: (event: AcpRuntimeEvent) => void | Promise<void>;
  /** Optional logger — defaults to silent. */
  logWarn?: (msg: string) => void;
}

/** Fingerprint for dedup between live stream and back-fill. Intentionally
 *  coarse; a few near-duplicates are fine, missing chips are not. */
export function fingerprintEvent(event: AcpRuntimeEvent): string {
  switch (event.type) {
    case "hook_event":
      return `hook:${event.hookKind}:${event.toolCallId ?? ""}:${event.hookName ?? ""}`;
    case "session_system":
      return `sys:${event.kind}:${event.text ?? ""}`;
    case "subagent_hop":
      return `hop:${event.phase}:${event.agentId}:${event.parentToolCallId ?? ""}`;
    default:
      return `${event.type}:anon`;
  }
}

/**
 * Read the acpx sidecar for the given session and forward any new
 * back-fillable events. No-op when the reader is disabled, the session
 * id is unknown, or the sidecar does not exist.
 */
export async function backfillFromSessionLog(
  input: SessionLogReaderInput,
): Promise<{ emitted: number } | null> {
  if (!isReaderEnabled()) return null;
  const acpxSessionId = input.acpxSessionId?.trim();
  if (!acpxSessionId) return null;

  const filePath = resolveSidecarPath(acpxSessionId);
  const logWarn = input.logWarn ?? (() => {});

  let stat: { size: number; mtimeMs: number };
  try {
    const s = await fs.stat(filePath);
    stat = { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    // Sidecar absent — acpx may not have written yet, or this runtime
    // doesn't use the sidecar. Silent no-op.
    return null;
  }

  const prev = offsetsByPath.get(filePath);
  // If the file shrank (rotation) or mtime went backwards (clock skew,
  // recreated session), start from zero again.
  const startFrom =
    prev && prev.byteOffset <= stat.size && prev.mtimeMs <= stat.mtimeMs
      ? prev.byteOffset
      : 0;

  if (startFrom >= stat.size) {
    offsetsByPath.set(filePath, { byteOffset: stat.size, mtimeMs: stat.mtimeMs });
    return { emitted: 0 };
  }

  let raw: string;
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const length = stat.size - startFrom;
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, startFrom);
      raw = buf.toString("utf8");
    } finally {
      await fh.close();
    }
  } catch (err) {
    logWarn(`[session-log-reader] read failed: ${String(err)}`);
    return null;
  }

  // If we started mid-line (shouldn't happen since we only advance past
  // full lines), drop the partial prefix.
  const lines = raw.split("\n");
  let consumedBytes = 0;
  let emitted = 0;
  const seen = input.seenFingerprints ?? new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    // The final chunk might be an incomplete trailing line; don't consume
    // it so the next invocation can pick up the full line.
    if (isLast && !raw.endsWith("\n")) {
      break;
    }
    // When raw ends with '\n', split() yields a trailing "" element that
    // consumes zero bytes — skip it instead of charging a phantom newline.
    if (isLast && line === "" && raw.endsWith("\n")) {
      break;
    }
    consumedBytes += Buffer.byteLength(line, "utf8") + 1; // +1 for '\n'
    const event = parseLine(line);
    if (!event) continue;
    if (!BACKFILL_EVENT_TYPES.has(event.type)) continue;
    const fp = fingerprintEvent(event);
    if (seen.has(fp)) continue;
    try {
      await input.onEvent(event);
      emitted++;
    } catch (err) {
      logWarn(`[session-log-reader] forward failed: ${String(err)}`);
    }
  }

  offsetsByPath.set(filePath, {
    byteOffset: startFrom + consumedBytes,
    mtimeMs: stat.mtimeMs,
  });

  return { emitted };
}

/** Test helper — clear the in-memory offset cache. */
export function __resetSessionLogReaderOffsets(): void {
  offsetsByPath.clear();
}
