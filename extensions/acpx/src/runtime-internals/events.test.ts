import { describe, expect, it } from "vitest";
import { parsePromptEventLine } from "./events.js";

describe("parsePromptEventLine", () => {
  it("parses raw ACP session/update agent_message_chunk lines", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        },
      },
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "text_delta",
      text: "hello",
      stream: "output",
      tag: "agent_message_chunk",
    });
  });

  it("parses usage_update with stable metadata", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "usage_update",
          used: 12,
          size: 500,
        },
      },
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "status",
      text: "usage updated: 12/500",
      tag: "usage_update",
      used: 12,
      size: 500,
    });
  });

  it("parses tool_call_update without using call ids as primary fallback label", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_ABC123",
          status: "in_progress",
        },
      },
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "tool_call",
      text: "tool call (in_progress)",
      tag: "tool_call_update",
      toolCallId: "call_ABC123",
      status: "in_progress",
      title: "tool call",
    });
  });

  it("keeps compatibility with simplified text/done lines", () => {
    expect(parsePromptEventLine(JSON.stringify({ type: "text", content: "alpha" }))).toEqual({
      type: "text_delta",
      text: "alpha",
      stream: "output",
    });
    expect(parsePromptEventLine(JSON.stringify({ type: "done", stopReason: "end_turn" }))).toEqual({
      type: "done",
      stopReason: "end_turn",
    });
  });

  it("extracts rich fields on tool_call when the payload carries them", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_bash_1",
          title: "Bash",
          status: "in_progress",
          kind: "execute",
          toolName: "Bash",
          rawInput: { command: "ls -la", description: "list files" },
          locations: [{ path: "/workspace/foo.ts", line: 42 }],
        },
      },
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "tool_call",
      text: "Bash (in_progress)",
      tag: "tool_call",
      toolCallId: "call_bash_1",
      status: "in_progress",
      title: "Bash",
      kind: "bash",
      toolName: "Bash",
      rawInput: { command: "ls -la", description: "list files" },
      locations: [{ path: "/workspace/foo.ts", line: 42 }],
    });
  });

  it("forwards structured patch + content blocks on file edit tool results", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_edit_1",
          title: "Edit",
          status: "completed",
          toolName: "Edit",
          rawInput: { file_path: "/workspace/foo.ts", old_string: "a", new_string: "b" },
          rawOutput: {
            filePath: "/workspace/foo.ts",
            originalFile: "a\nunchanged\n",
            structuredPatch: [
              { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] },
            ],
            gitDiff: {
              filename: "foo.ts",
              status: "modified",
              additions: 1,
              deletions: 1,
              patch: "@@ -1,1 +1,1 @@\n-a\n+b\n",
            },
          },
          content: [
            {
              type: "content",
              content: { type: "text", text: "Replaced 'a' with 'b' in foo.ts" },
            },
          ],
        },
      },
    });
    const result = parsePromptEventLine(line);
    expect(result).toMatchObject({
      type: "tool_call",
      tag: "tool_call_update",
      toolCallId: "call_edit_1",
      title: "Edit",
      status: "completed",
      kind: "edit",
      toolName: "Edit",
      structuredPatch: {
        filePath: "/workspace/foo.ts",
        originalFile: "a\nunchanged\n",
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] }],
        gitDiff: {
          filename: "foo.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1,1 +1,1 @@\n-a\n+b\n",
        },
      },
      contentBlocks: [{ type: "text", text: "Replaced 'a' with 'b' in foo.ts" }],
    });
  });

  it("parses a permission_request and synthesizes default options when none are provided", () => {
    const line = JSON.stringify({
      sessionUpdate: "permission_request",
      requestId: "perm_1",
      toolName: "Bash",
      toolCallId: "call_bash_2",
      input: { command: "rm -rf build" },
      title: "Run Bash command",
      description: "Delete the build directory",
      reason: "Potentially destructive",
    });
    const result = parsePromptEventLine(line);
    expect(result).toMatchObject({
      type: "permission_request",
      requestId: "perm_1",
      toolName: "Bash",
      toolCallId: "call_bash_2",
      input: { command: "rm -rf build" },
      title: "Run Bash command",
      description: "Delete the build directory",
      reason: "Potentially destructive",
      tag: "permission_request",
    });
    expect(result && result.type === "permission_request" ? result.options.map((o) => o.kind) : []).toEqual([
      "allow_once",
      "allow_session",
      "allow_edit",
      "deny",
      "deny_interrupt",
    ]);
  });

  it("parses a permission_request with runtime-provided options verbatim", () => {
    const line = JSON.stringify({
      sessionUpdate: "permission_request",
      requestId: "perm_2",
      toolName: "Write",
      options: [
        { optionId: "allow_once", label: "Allow once", kind: "allow_once" },
        { optionId: "deny", label: "Deny", kind: "deny" },
      ],
    });
    const result = parsePromptEventLine(line);
    expect(result && result.type === "permission_request" ? result.options : []).toEqual([
      { optionId: "allow_once", label: "Allow once", kind: "allow_once" },
      { optionId: "deny", label: "Deny", kind: "deny" },
    ]);
  });

  it("parses a permission_response allow decision with edited input", () => {
    const line = JSON.stringify({
      sessionUpdate: "permission_response",
      requestId: "perm_1",
      toolCallId: "call_bash_2",
      decision: {
        behavior: "allow",
        updatedInput: { command: "rm -rf build/tmp" },
        scope: "once",
      },
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "permission_response",
      requestId: "perm_1",
      toolCallId: "call_bash_2",
      decision: {
        behavior: "allow",
        updatedInput: { command: "rm -rf build/tmp" },
        scope: "once",
      },
      tag: "permission_response",
    });
  });

  it("parses a permission_response deny with interrupt", () => {
    const line = JSON.stringify({
      sessionUpdate: "permission_response",
      requestId: "perm_3",
      decision: {
        behavior: "deny",
        message: "Not safe to run",
        interrupt: true,
      },
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "permission_response",
      requestId: "perm_3",
      decision: {
        behavior: "deny",
        message: "Not safe to run",
        interrupt: true,
      },
      tag: "permission_response",
    });
  });

  it("parses PreToolUse hook_event payloads", () => {
    const line = JSON.stringify({
      sessionUpdate: "hook_event",
      hookEvent: "PreToolUse",
      hookName: "enforce-safe-bash",
      toolName: "Bash",
      toolCallId: "call_bash_3",
      command: "git push --force origin main",
      statusMessage: "blocked by safety policy",
      permissionDecisionReason: "destructive force-push to main",
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "hook_event",
      hookKind: "PreToolUse",
      hookName: "enforce-safe-bash",
      command: "git push --force origin main",
      statusMessage: "blocked by safety policy",
      permissionDecisionReason: "destructive force-push to main",
      toolName: "Bash",
      toolCallId: "call_bash_3",
      tag: "hook_event",
    });
  });

  it("parses session_compacted as a session_system event", () => {
    const line = JSON.stringify({
      sessionUpdate: "session_compacted",
      message: "Context compacted from 180k to 42k tokens",
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "session_system",
      kind: "session_compacted",
      text: "Context compacted from 180k to 42k tokens",
      tag: "session_compacted",
    });
  });

  it("parses subagent_start and subagent_end hops", () => {
    const start = JSON.stringify({
      sessionUpdate: "subagent_start",
      agentId: "agent_child_1",
      agentSessionId: "sess_child_1",
      subagentType: "code-reviewer",
      parentToolCallId: "call_task_1",
      description: "Review PR for security issues",
    });
    expect(parsePromptEventLine(start)).toEqual({
      type: "subagent_hop",
      phase: "start",
      agentId: "agent_child_1",
      agentSessionId: "sess_child_1",
      subagentType: "code-reviewer",
      parentToolCallId: "call_task_1",
      description: "Review PR for security issues",
      tag: "subagent_start",
    });

    const end = JSON.stringify({
      sessionUpdate: "subagent_end",
      agentId: "agent_child_1",
      parentToolCallId: "call_task_1",
      summary: "No vulnerabilities found; 2 style nits noted.",
    });
    expect(parsePromptEventLine(end)).toEqual({
      type: "subagent_hop",
      phase: "end",
      agentId: "agent_child_1",
      parentToolCallId: "call_task_1",
      summary: "No vulnerabilities found; 2 style nits noted.",
      tag: "subagent_end",
    });
  });

  it("parses done events with usage and duration metadata", () => {
    const line = JSON.stringify({
      sessionUpdate: "done",
      stopReason: "end_turn",
      usage: {
        inputTokens: 1200,
        outputTokens: 340,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 5600,
      },
      durationMs: 18234,
    });
    expect(parsePromptEventLine(line)).toEqual({
      type: "done",
      stopReason: "end_turn",
      usage: {
        inputTokens: 1200,
        outputTokens: 340,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 5600,
      },
      durationMs: 18234,
    });
  });
});
