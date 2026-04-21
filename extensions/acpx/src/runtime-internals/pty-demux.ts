// Pure reducer for the pty-wrapped acpx stream.
//
// Under the pty path, stdout (NDJSON events) and stderr (interactive prompt
// text) are merged on a single master-side stream. This module does the
// per-chunk demuxing in a shape that is easy to unit-test in isolation:
//
//   1. accumulate bytes into a line buffer,
//   2. extract any complete `\n`-terminated lines and feed them to
//      `parsePromptEventLine` to recover NDJSON events,
//   3. feed the raw chunk to an `AcpxPermissionPromptMatcher` to detect
//      interactive `[permission] ...? (y/N)` prompt tails,
//   4. run a detected prompt through `decideAcpxPermission` to turn it into
//      an auto-reply or a surface request.
//
// The reducer is intentionally free of process / timer / queue concerns so
// tests can drive it chunk-by-chunk without a real pty.

import type { AcpRuntimeEvent } from "../../runtime-api.js";
import { parsePromptEventLine } from "./events.js";
import {
  type AcpxPermissionBaseline,
  decideAcpxPermission,
} from "./permission-policy.js";
import {
  type AcpxPermissionPromptMatch,
  AcpxPermissionPromptMatcher,
} from "./permission-prompt.js";

export type AcpxPtyDemuxAction =
  | { kind: "event"; event: AcpRuntimeEvent }
  | {
      kind: "auto-reply";
      reply: "allow" | "deny";
      match: AcpxPermissionPromptMatch;
      reason: string;
    }
  | {
      kind: "surface";
      match: AcpxPermissionPromptMatch;
      reason: string;
    };

/**
 * Mutable per-turn state the reducer updates as chunks arrive. Callers own
 * lifetime; the reducer never reads/writes anything outside this object.
 */
export type AcpxPtyDemuxState = {
  lineBuffer: string;
  matcher: AcpxPermissionPromptMatcher;
};

export function createAcpxPtyDemuxState(): AcpxPtyDemuxState {
  return {
    lineBuffer: "",
    matcher: new AcpxPermissionPromptMatcher(),
  };
}

/**
 * Drive the demuxer for a single chunk from the pty master. Returns an
 * ordered list of actions the caller should apply: yield NDJSON events,
 * write `y\n`/`n\n` replies, or emit a permission-surface event.
 *
 * Events always come before any prompt decision from the same chunk so that
 * a `done` line that arrives in the same buffer as a trailing prompt is still
 * visible to consumers before the prompt is surfaced.
 */
export function processAcpxPtyChunk(params: {
  chunk: string;
  state: AcpxPtyDemuxState;
  baseline: AcpxPermissionBaseline | undefined;
}): AcpxPtyDemuxAction[] {
  const actions: AcpxPtyDemuxAction[] = [];
  const { state } = params;

  state.lineBuffer += params.chunk;
  while (true) {
    const nlIdx = state.lineBuffer.indexOf("\n");
    if (nlIdx < 0) {
      break;
    }
    const line = state.lineBuffer.slice(0, nlIdx).replace(/\r$/, "");
    state.lineBuffer = state.lineBuffer.slice(nlIdx + 1);
    if (!line) {
      continue;
    }
    const parsed = parsePromptEventLine(line);
    if (parsed) {
      actions.push({ kind: "event", event: parsed });
    }
  }

  const match = state.matcher.push(params.chunk);
  if (!match) {
    return actions;
  }

  // The prompt itself has no trailing newline (readline.question is waiting),
  // so its text sits in `lineBuffer` as the residual partial line. If we
  // leave it there, the next chunk's first newline will glue the prompt
  // text onto the next NDJSON line and we will emit a bogus status event.
  // After the complete-line extraction above, `lineBuffer` holds nothing
  // but that partial trailing line, so dropping it entirely is safe.
  state.lineBuffer = "";

  const decision = decideAcpxPermission(match, params.baseline);
  if (decision.action === "auto-approve") {
    actions.push({ kind: "auto-reply", reply: "allow", match, reason: decision.reason });
    return actions;
  }
  if (decision.action === "auto-deny") {
    actions.push({ kind: "auto-reply", reply: "deny", match, reason: decision.reason });
    return actions;
  }
  actions.push({ kind: "surface", match, reason: decision.reason });
  return actions;
}
