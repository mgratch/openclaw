/**
 * Subagent enricher — synthesize `subagent_hop` events from Agent/Task
 * tool call lifecycle when the runtime doesn't emit native hops.
 *
 * Claude Code's Agent tool (and the general Task tool) spawns a child
 * agent that runs its own session. The ACP runtime may or may not emit
 * explicit `subagent_hop` events for that child. This enricher observes
 * the parent stream, detects Agent/Task tool calls, extracts child
 * metadata from the tool input, and synthesizes `start`/`end` hops so
 * the UI can render a nested subagent card regardless of whether the
 * runtime natively reports hops.
 *
 * Native `subagent_hop` events from the runtime are strictly richer
 * (they carry inner tool calls and progress phases); when present they
 * flow straight through `dispatch-acp.ts` and this enricher should not
 * duplicate them. Callers should prefer native hops and only synthesize
 * when none have been seen for a given agentId.
 */

import type { AcpRuntimeEvent } from "../runtime/types.js";

export interface SyntheticSubagentHop {
  phase: "start" | "end";
  parentToolCallId: string;
  agentId: string;
  subagentType?: string;
  description?: string;
  summary?: string;
}

const AGENT_TOOL_NAMES = new Set([
  "agent",
  "task",
  "subagent",
  "spawn_agent",
]);

function isAgentToolName(name: string | undefined): boolean {
  if (!name) return false;
  return AGENT_TOOL_NAMES.has(name.toLowerCase());
}

function pickString(
  input: unknown,
  keys: readonly string[],
): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function extractAgentId(
  toolCallId: string,
  input: unknown,
): string {
  const fromInput = pickString(input, [
    "agent_id",
    "agentId",
    "id",
    "child_id",
  ]);
  if (fromInput) return fromInput;
  // Stable synthetic id keyed off the parent tool call so start/end
  // deduplicate correctly.
  return `synth:${toolCallId}`;
}

function extractSubagentType(input: unknown): string | undefined {
  return pickString(input, [
    "subagent_type",
    "subagentType",
    "agent_type",
    "type",
    "kind",
  ]);
}

function extractDescription(input: unknown): string | undefined {
  return pickString(input, [
    "description",
    "prompt",
    "task",
    "goal",
    "instructions",
  ]);
}

function extractSummaryFromOutput(event: Extract<AcpRuntimeEvent, { type: "tool_call" }>): string | undefined {
  const blocks = Array.isArray(event.contentBlocks) ? event.contentBlocks : [];
  const firstText = blocks.find(
    (b) => b && typeof b === "object" && (b as { type?: string }).type === "text",
  ) as { text?: unknown } | undefined;
  if (firstText && typeof firstText.text === "string" && firstText.text.trim()) {
    return firstText.text.trim().slice(0, 400);
  }
  if (typeof event.text === "string" && event.text.trim()) {
    return event.text.trim().slice(0, 400);
  }
  return undefined;
}

function isTerminalStatus(status: string | undefined): boolean {
  const s = (status ?? "").toLowerCase().trim();
  return (
    s === "completed" ||
    s === "failed" ||
    s === "error" ||
    s === "done" ||
    s === "cancelled" ||
    s === "canceled"
  );
}

export interface SubagentEnricher {
  /**
   * Consume a runtime event; returns any synthetic hops that the parent
   * stream should emit alongside the original event. Caller is responsible
   * for forwarding these via its normal `subagent_hop` emission path.
   */
  onEvent(event: AcpRuntimeEvent): SyntheticSubagentHop[];
  /**
   * Record that a native `subagent_hop` event was observed for the given
   * parent tool call. After this, the enricher will not synthesize hops
   * for that same parent (the runtime is authoritative).
   */
  markNativeHop(parentToolCallId: string | undefined): void;
}

interface TrackedAgentCall {
  agentId: string;
  subagentType?: string;
  description?: string;
  startEmitted: boolean;
  endEmitted: boolean;
  nativeSeen: boolean;
}

export function createSubagentEnricher(): SubagentEnricher {
  const tracked = new Map<string, TrackedAgentCall>();

  return {
    onEvent(event) {
      if (event.type !== "tool_call") return [];
      if (!isAgentToolName(event.toolName)) return [];
      const parentToolCallId =
        event.toolCallId ?? `${event.toolName ?? "agent"}:anon`;

      let state = tracked.get(parentToolCallId);
      if (!state) {
        const rawInput = event.rawInput;
        state = {
          agentId:
            (typeof event.subagentId === "string" && event.subagentId.trim()
              ? event.subagentId.trim()
              : undefined) ?? extractAgentId(parentToolCallId, rawInput),
          subagentType: extractSubagentType(rawInput),
          description:
            (typeof event.description === "string" && event.description.trim()
              ? event.description.trim()
              : undefined) ?? extractDescription(rawInput),
          startEmitted: false,
          endEmitted: false,
          nativeSeen: false,
        };
        tracked.set(parentToolCallId, state);
      }

      if (state.nativeSeen) return [];

      const hops: SyntheticSubagentHop[] = [];

      if (!state.startEmitted) {
        state.startEmitted = true;
        hops.push({
          phase: "start",
          parentToolCallId,
          agentId: state.agentId,
          subagentType: state.subagentType,
          description: state.description,
        });
      }

      if (!state.endEmitted && isTerminalStatus(event.status)) {
        state.endEmitted = true;
        hops.push({
          phase: "end",
          parentToolCallId,
          agentId: state.agentId,
          subagentType: state.subagentType,
          description: state.description,
          summary: extractSummaryFromOutput(event),
        });
      }

      return hops;
    },
    markNativeHop(parentToolCallId) {
      if (!parentToolCallId) return;
      const existing = tracked.get(parentToolCallId);
      if (existing) {
        existing.nativeSeen = true;
      } else {
        tracked.set(parentToolCallId, {
          agentId: `native:${parentToolCallId}`,
          startEmitted: true,
          endEmitted: true,
          nativeSeen: true,
        });
      }
    },
  };
}
