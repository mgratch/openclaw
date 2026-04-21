import { describe, expect, it } from "vitest";
import type { AcpRuntimeEvent } from "../runtime/types.js";
import { createSubagentEnricher } from "./subagent-enricher.js";

function toolCall(overrides: Partial<Extract<AcpRuntimeEvent, { type: "tool_call" }>>) {
  return {
    type: "tool_call",
    text: "",
    ...overrides,
  } as Extract<AcpRuntimeEvent, { type: "tool_call" }>;
}

describe("createSubagentEnricher", () => {
  it("emits start hop on first Agent tool_call sighting", () => {
    const enricher = createSubagentEnricher();
    const hops = enricher.onEvent(
      toolCall({
        toolName: "Agent",
        toolCallId: "call-1",
        status: "running",
        rawInput: { subagent_type: "reviewer", description: "Audit the diff" },
      }),
    );
    expect(hops).toHaveLength(1);
    expect(hops[0].phase).toBe("start");
    expect(hops[0].parentToolCallId).toBe("call-1");
    expect(hops[0].subagentType).toBe("reviewer");
    expect(hops[0].description).toBe("Audit the diff");
  });

  it("emits end hop on terminal status and not again on further events", () => {
    const enricher = createSubagentEnricher();
    enricher.onEvent(
      toolCall({
        toolName: "Task",
        toolCallId: "call-2",
        status: "running",
        rawInput: { description: "do work" },
      }),
    );
    const terminal = enricher.onEvent(
      toolCall({
        toolName: "Task",
        toolCallId: "call-2",
        status: "completed",
        contentBlocks: [{ type: "text", text: "done and done" }] as never,
      }),
    );
    expect(terminal.map((h) => h.phase)).toEqual(["end"]);
    expect(terminal[0].summary).toBe("done and done");

    const after = enricher.onEvent(
      toolCall({ toolName: "Task", toolCallId: "call-2", status: "completed" }),
    );
    expect(after).toHaveLength(0);
  });

  it("ignores non-Agent tool calls", () => {
    const enricher = createSubagentEnricher();
    const hops = enricher.onEvent(
      toolCall({ toolName: "Bash", toolCallId: "b-1", status: "running" }),
    );
    expect(hops).toHaveLength(0);
  });

  it("markNativeHop suppresses synthesis for that parent", () => {
    const enricher = createSubagentEnricher();
    enricher.markNativeHop("call-3");
    const hops = enricher.onEvent(
      toolCall({ toolName: "Agent", toolCallId: "call-3", status: "running" }),
    );
    expect(hops).toHaveLength(0);
  });

  it("prefers subagentId from the event over synthetic ids", () => {
    const enricher = createSubagentEnricher();
    const hops = enricher.onEvent(
      toolCall({
        toolName: "Agent",
        toolCallId: "call-4",
        status: "running",
        subagentId: "agent-xyz",
      }),
    );
    expect(hops[0].agentId).toBe("agent-xyz");
  });
});
