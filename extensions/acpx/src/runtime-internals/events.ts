import { safeParseJsonWithSchema } from "openclaw/plugin-sdk/extension-shared";
import { z } from "zod";
import type {
  AcpHookEventKind,
  AcpPermissionDecision,
  AcpPermissionOption,
  AcpPermissionOptionKind,
  AcpRuntimeEvent,
  AcpSessionSystemKind,
  AcpSessionUpdateTag,
  AcpToolCallContentBlock,
  AcpToolCallKind,
  AcpToolCallLocation,
  AcpToolCallStructuredPatch,
  AcpToolCallStructuredPatchHunk,
} from "../../runtime-api.js";
import {
  asOptionalBoolean,
  asOptionalString,
  asString,
  asTrimmedString,
  type AcpxErrorEvent,
  type AcpxJsonObject,
  isRecord,
} from "./shared.js";

const AcpxJsonObjectSchema = z.record(z.string(), z.unknown());

const AcpxErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string().trim().min(1).catch("acpx reported an error"),
  code: z.string().optional(),
  retryable: z.boolean().optional(),
});

export function toAcpxErrorEvent(value: unknown): AcpxErrorEvent | null {
  const parsed = AcpxErrorEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseJsonLines(value: string): AcpxJsonObject[] {
  const events: AcpxJsonObject[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = safeParseJsonWithSchema(AcpxJsonObjectSchema, trimmed);
    if (parsed) {
      events.push(parsed);
    }
  }
  return events;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveStructuredPromptPayload(parsed: Record<string, unknown>): {
  type: string;
  payload: Record<string, unknown>;
  tag?: AcpSessionUpdateTag;
} {
  const method = asTrimmedString(parsed.method);
  if (method === "session/update") {
    const params = parsed.params;
    if (isRecord(params) && isRecord(params.update)) {
      const update = params.update;
      const tag = asOptionalString(update.sessionUpdate) as AcpSessionUpdateTag | undefined;
      return {
        type: tag ?? "",
        payload: update,
        ...(tag ? { tag } : {}),
      };
    }
  }

  const sessionUpdate = asOptionalString(parsed.sessionUpdate) as AcpSessionUpdateTag | undefined;
  if (sessionUpdate) {
    return {
      type: sessionUpdate,
      payload: parsed,
      tag: sessionUpdate,
    };
  }

  const type = asTrimmedString(parsed.type);
  const tag = asOptionalString(parsed.tag) as AcpSessionUpdateTag | undefined;
  return {
    type,
    payload: parsed,
    ...(tag ? { tag } : {}),
  };
}

function resolveStatusTextForTag(params: {
  tag: AcpSessionUpdateTag;
  payload: Record<string, unknown>;
}): string | null {
  const { tag, payload } = params;
  if (tag === "available_commands_update") {
    const commands = Array.isArray(payload.availableCommands) ? payload.availableCommands : [];
    return commands.length > 0
      ? `available commands updated (${commands.length})`
      : "available commands updated";
  }
  if (tag === "current_mode_update") {
    const mode =
      asTrimmedString(payload.currentModeId) ||
      asTrimmedString(payload.modeId) ||
      asTrimmedString(payload.mode);
    return mode ? `mode updated: ${mode}` : "mode updated";
  }
  if (tag === "config_option_update") {
    const id = asTrimmedString(payload.id) || asTrimmedString(payload.configOptionId);
    const value =
      asTrimmedString(payload.currentValue) ||
      asTrimmedString(payload.value) ||
      asTrimmedString(payload.optionValue);
    if (id && value) {
      return `config updated: ${id}=${value}`;
    }
    if (id) {
      return `config updated: ${id}`;
    }
    return "config updated";
  }
  if (tag === "session_info_update") {
    return (
      asTrimmedString(payload.summary) || asTrimmedString(payload.message) || "session updated"
    );
  }
  if (tag === "plan") {
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const first = entries.find((entry) => isRecord(entry)) as Record<string, unknown> | undefined;
    const content = asTrimmedString(first?.content);
    return content ? `plan: ${content}` : null;
  }
  return null;
}

function resolveTextChunk(params: {
  payload: Record<string, unknown>;
  stream: "output" | "thought";
  tag: AcpSessionUpdateTag;
}): AcpRuntimeEvent | null {
  const contentRaw = params.payload.content;
  if (isRecord(contentRaw)) {
    const contentType = asTrimmedString(contentRaw.type);
    if (contentType && contentType !== "text") {
      return null;
    }
    const text = asString(contentRaw.text);
    if (text && text.length > 0) {
      return {
        type: "text_delta",
        text,
        stream: params.stream,
        tag: params.tag,
      };
    }
  }
  const text = asString(params.payload.text);
  if (!text || text.length === 0) {
    return null;
  }
  return {
    type: "text_delta",
    text,
    stream: params.stream,
    tag: params.tag,
  };
}

function createTextDeltaEvent(params: {
  content: string | null | undefined;
  stream: "output" | "thought";
  tag?: AcpSessionUpdateTag;
}): AcpRuntimeEvent | null {
  if (params.content == null || params.content.length === 0) {
    return null;
  }
  return {
    type: "text_delta",
    text: params.content,
    stream: params.stream,
    ...(params.tag ? { tag: params.tag } : {}),
  };
}

/**
 * Map the ACP tool `kind` enum to our richer `AcpToolCallKind`.
 * The ACP spec currently defines: read | edit | execute | delete | move | search | think | other.
 * We map those to finer-grained OpenClaw kinds when possible, but pass anything
 * unknown through verbatim so future ACP kinds don't require a code bump.
 */
function resolveToolCallKind(
  payload: Record<string, unknown>,
): { kind?: AcpToolCallKind; toolName?: string } {
  const toolName =
    asOptionalString(payload.toolName) ||
    asOptionalString(payload.tool_name) ||
    asOptionalString(payload.name);
  const rawKind = asOptionalString(payload.kind);
  if (!rawKind && !toolName) {
    return {};
  }

  // Prefer the tool name for kind derivation when both are present, since
  // acpx's `kind` is coarse (just "execute" for every shell-ish tool).
  if (toolName) {
    const lower = toolName.toLowerCase();
    if (lower === "bash" || lower === "shell") {
      return { kind: "bash", toolName };
    }
    if (lower === "edit") {
      return { kind: "edit", toolName };
    }
    if (lower === "multiedit" || lower === "multi_edit") {
      return { kind: "multi_edit", toolName };
    }
    if (lower === "write") {
      return { kind: "write", toolName };
    }
    if (lower === "read") {
      return { kind: "read", toolName };
    }
    if (lower === "glob") {
      return { kind: "glob", toolName };
    }
    if (lower === "grep") {
      return { kind: "grep", toolName };
    }
    if (lower === "webfetch" || lower === "web_fetch") {
      return { kind: "web_fetch", toolName };
    }
    if (lower === "websearch" || lower === "web_search") {
      return { kind: "web_search", toolName };
    }
    if (lower === "task" || lower === "agent") {
      return { kind: "task", toolName };
    }
    if (lower === "todowrite" || lower === "todo_write") {
      return { kind: "todo_write", toolName };
    }
    if (lower === "notebookedit" || lower === "notebook_edit") {
      return { kind: "notebook_edit", toolName };
    }
    if (lower.startsWith("mcp__") || lower.startsWith("mcp:")) {
      return { kind: "mcp", toolName };
    }
  }

  if (rawKind) {
    return { kind: rawKind as AcpToolCallKind, ...(toolName ? { toolName } : {}) };
  }
  return toolName ? { toolName } : {};
}

function resolveToolCallLocations(
  payload: Record<string, unknown>,
): AcpToolCallLocation[] | undefined {
  const raw = payload.locations;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: AcpToolCallLocation[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const path = asOptionalString(entry.path) || asOptionalString(entry.file_path);
    const line =
      typeof entry.line === "number" && Number.isFinite(entry.line) ? entry.line : undefined;
    const column =
      typeof entry.column === "number" && Number.isFinite(entry.column) ? entry.column : undefined;
    if (!path && line == null && column == null) {
      continue;
    }
    out.push({
      ...(path ? { path } : {}),
      ...(line != null ? { line } : {}),
      ...(column != null ? { column } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function resolveToolCallContentBlocks(
  payload: Record<string, unknown>,
): AcpToolCallContentBlock[] | undefined {
  // The ACP `content` field on tool_call is an array of ToolCallContent wrappers.
  // We forward each wrapper's inner content block verbatim, plus a lightweight
  // `{type: "diff", ...}` pass-through for renderer use.
  const raw = payload.content;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: AcpToolCallContentBlock[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const entryType = asOptionalString(entry.type);
    if (entryType === "content") {
      const inner = isRecord(entry.content) ? entry.content : null;
      if (inner) {
        const innerType = asOptionalString(inner.type) ?? "text";
        const text = asOptionalString(inner.text);
        const mimeType = asOptionalString(inner.mimeType);
        out.push({
          type: innerType,
          ...(text != null ? { text } : {}),
          ...(mimeType ? { mimeType } : {}),
          data: inner.data ?? inner.source ?? undefined,
        });
        continue;
      }
    }
    // Pass-through for diff / image / resource / etc.
    const type = entryType ?? "unknown";
    const text = asOptionalString(entry.text);
    out.push({
      type,
      ...(text != null ? { text } : {}),
      data: entry,
    });
  }
  return out.length > 0 ? out : undefined;
}

function resolveStructuredPatch(
  payload: Record<string, unknown>,
): AcpToolCallStructuredPatch | undefined {
  const rawOutput = isRecord(payload.rawOutput) ? payload.rawOutput : null;
  const candidate =
    (isRecord(payload.structuredPatch) ? payload.structuredPatch : null) ||
    (rawOutput && isRecord(rawOutput.structuredPatch) ? rawOutput.structuredPatch : null) ||
    rawOutput;
  if (!candidate) {
    return undefined;
  }

  const filePath =
    asOptionalString(candidate.filePath) ||
    asOptionalString(candidate.file_path) ||
    (rawOutput ? asOptionalString(rawOutput.filePath) : undefined);
  const originalFile =
    asOptionalString(candidate.originalFile) ||
    (rawOutput ? asOptionalString(rawOutput.originalFile) : undefined);

  const rawHunks =
    (Array.isArray(candidate.hunks) ? candidate.hunks : undefined) ||
    (Array.isArray((candidate as Record<string, unknown>).structuredPatch)
      ? ((candidate as Record<string, unknown>).structuredPatch as unknown[])
      : undefined);

  const hunks: AcpToolCallStructuredPatchHunk[] | undefined = Array.isArray(rawHunks)
    ? rawHunks
        .filter((h): h is Record<string, unknown> => isRecord(h))
        .map((h) => ({
          ...(typeof h.oldStart === "number" ? { oldStart: h.oldStart } : {}),
          ...(typeof h.oldLines === "number" ? { oldLines: h.oldLines } : {}),
          ...(typeof h.newStart === "number" ? { newStart: h.newStart } : {}),
          ...(typeof h.newLines === "number" ? { newLines: h.newLines } : {}),
          ...(Array.isArray(h.lines) ? { lines: h.lines.filter((l): l is string => typeof l === "string") } : {}),
        }))
    : undefined;

  const gitDiffRaw =
    (isRecord(candidate.gitDiff) ? candidate.gitDiff : undefined) ||
    (rawOutput && isRecord(rawOutput.gitDiff) ? rawOutput.gitDiff : undefined);
  const gitDiff = gitDiffRaw
    ? {
        ...(asOptionalString(gitDiffRaw.filename) ? { filename: asOptionalString(gitDiffRaw.filename) } : {}),
        ...(asOptionalString(gitDiffRaw.status) ? { status: asOptionalString(gitDiffRaw.status) } : {}),
        ...(typeof gitDiffRaw.additions === "number" ? { additions: gitDiffRaw.additions } : {}),
        ...(typeof gitDiffRaw.deletions === "number" ? { deletions: gitDiffRaw.deletions } : {}),
        ...(asOptionalString(gitDiffRaw.patch) ? { patch: asOptionalString(gitDiffRaw.patch) } : {}),
      }
    : undefined;

  const patch: AcpToolCallStructuredPatch = {
    ...(filePath ? { filePath } : {}),
    ...(originalFile != null ? { originalFile } : {}),
    ...(hunks && hunks.length > 0 ? { hunks } : {}),
    ...(gitDiff && Object.keys(gitDiff).length > 0 ? { gitDiff: gitDiff as AcpToolCallStructuredPatch["gitDiff"] } : {}),
  };
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function createToolCallEvent(params: {
  payload: Record<string, unknown>;
  tag: AcpSessionUpdateTag;
}): AcpRuntimeEvent {
  const title = asTrimmedString(params.payload.title) || "tool call";
  const status = asTrimmedString(params.payload.status);
  const toolCallId = asOptionalString(params.payload.toolCallId);
  const description = asOptionalString(params.payload.description);
  const truncated = asOptionalBoolean(params.payload.truncated);
  const durationMs =
    typeof params.payload.durationMs === "number" && Number.isFinite(params.payload.durationMs)
      ? params.payload.durationMs
      : undefined;
  const subagentId = asOptionalString(params.payload.agentId) || asOptionalString(params.payload.subagentId);

  const kindInfo = resolveToolCallKind(params.payload);
  const rawInput = isRecord(params.payload.rawInput) ? params.payload.rawInput : undefined;
  const rawOutput = isRecord(params.payload.rawOutput) ? params.payload.rawOutput : undefined;
  const contentBlocks = resolveToolCallContentBlocks(params.payload);
  const locations = resolveToolCallLocations(params.payload);
  const structuredPatch = resolveStructuredPatch(params.payload);

  return {
    type: "tool_call",
    text: status ? `${title} (${status})` : title,
    tag: params.tag,
    ...(toolCallId ? { toolCallId } : {}),
    ...(status ? { status } : {}),
    title,
    ...(kindInfo.kind ? { kind: kindInfo.kind } : {}),
    ...(kindInfo.toolName ? { toolName: kindInfo.toolName } : {}),
    ...(rawInput ? { rawInput } : {}),
    ...(rawOutput ? { rawOutput } : {}),
    ...(contentBlocks ? { contentBlocks } : {}),
    ...(locations ? { locations } : {}),
    ...(structuredPatch ? { structuredPatch } : {}),
    ...(description ? { description } : {}),
    ...(subagentId ? { subagentId } : {}),
    ...(truncated != null ? { truncated } : {}),
    ...(durationMs != null ? { durationMs } : {}),
  };
}

/**
 * Derive the set of approval buttons to render for a permission request.
 * If the runtime provided its own option list, preserve it verbatim;
 * otherwise synthesize the standard allow_once/allow_session/deny trio,
 * plus allow_edit when the input is a mutable object and deny_interrupt
 * as an escape hatch.
 */
function resolvePermissionOptions(
  payload: Record<string, unknown>,
): AcpPermissionOption[] {
  const provided = payload.options;
  if (Array.isArray(provided)) {
    const parsed: AcpPermissionOption[] = [];
    for (const raw of provided) {
      if (!isRecord(raw)) continue;
      const optionId = asOptionalString(raw.optionId) || asOptionalString(raw.id);
      const label = asOptionalString(raw.label) || asOptionalString(raw.name);
      const kind = (asOptionalString(raw.kind) || "allow_once") as AcpPermissionOptionKind;
      if (!optionId || !label) continue;
      parsed.push({
        optionId,
        label,
        kind,
        ...(asOptionalString(raw.description) ? { description: asOptionalString(raw.description) } : {}),
      });
    }
    if (parsed.length > 0) return parsed;
  }
  const hasInput = isRecord(payload.input);
  const options: AcpPermissionOption[] = [
    { optionId: "allow_once", label: "Allow once", kind: "allow_once" },
    { optionId: "allow_session", label: "Allow for this session", kind: "allow_session" },
  ];
  if (hasInput) {
    options.push({ optionId: "allow_edit", label: "Allow with edits", kind: "allow_edit" });
  }
  options.push({ optionId: "deny", label: "Deny", kind: "deny" });
  options.push({
    optionId: "deny_interrupt",
    label: "Deny and interrupt turn",
    kind: "deny_interrupt",
  });
  return options;
}

function createPermissionRequestEvent(params: {
  payload: Record<string, unknown>;
  tag: AcpSessionUpdateTag;
}): AcpRuntimeEvent | null {
  const requestId =
    asOptionalString(params.payload.requestId) ||
    asOptionalString(params.payload.request_id) ||
    asOptionalString(params.payload.id);
  const toolName =
    asOptionalString(params.payload.toolName) ||
    asOptionalString(params.payload.tool_name) ||
    asOptionalString(params.payload.name);
  if (!requestId || !toolName) {
    return null;
  }
  const toolCallId =
    asOptionalString(params.payload.toolCallId) ||
    asOptionalString(params.payload.tool_use_id);
  const input = isRecord(params.payload.input) ? params.payload.input : undefined;
  const title = asOptionalString(params.payload.title);
  const displayName = asOptionalString(params.payload.displayName) || asOptionalString(params.payload.display_name);
  const description = asOptionalString(params.payload.description);
  const blockedPath = asOptionalString(params.payload.blockedPath) || asOptionalString(params.payload.blocked_path);
  const reason = asOptionalString(params.payload.reason) || asOptionalString(params.payload.decision_reason);
  const suggestionsRaw = params.payload.permission_suggestions ?? params.payload.suggestions;
  const suggestions = Array.isArray(suggestionsRaw)
    ? suggestionsRaw.filter((s): s is Record<string, unknown> => isRecord(s))
    : undefined;
  return {
    type: "permission_request",
    requestId,
    toolName,
    ...(toolCallId ? { toolCallId } : {}),
    ...(input ? { input } : {}),
    ...(title ? { title } : {}),
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(blockedPath ? { blockedPath } : {}),
    ...(reason ? { reason } : {}),
    ...(suggestions && suggestions.length > 0 ? { suggestions } : {}),
    options: resolvePermissionOptions(params.payload),
    tag: params.tag,
  };
}

function createPermissionResponseEvent(params: {
  payload: Record<string, unknown>;
  tag: AcpSessionUpdateTag;
}): AcpRuntimeEvent | null {
  const requestId =
    asOptionalString(params.payload.requestId) ||
    asOptionalString(params.payload.request_id);
  if (!requestId) return null;
  const decisionRaw = isRecord(params.payload.decision) ? params.payload.decision : params.payload;
  const behavior = asOptionalString(decisionRaw.behavior);
  if (behavior !== "allow" && behavior !== "deny") return null;
  let decision: AcpPermissionDecision;
  if (behavior === "allow") {
    decision = {
      behavior: "allow",
      ...(isRecord(decisionRaw.updatedInput) ? { updatedInput: decisionRaw.updatedInput } : {}),
      ...(asOptionalString(decisionRaw.scope)
        ? { scope: asOptionalString(decisionRaw.scope) as "once" | "session" | "always" }
        : {}),
    };
  } else {
    decision = {
      behavior: "deny",
      ...(asOptionalString(decisionRaw.message) ? { message: asOptionalString(decisionRaw.message) } : {}),
      ...(asOptionalBoolean(decisionRaw.interrupt) != null
        ? { interrupt: asOptionalBoolean(decisionRaw.interrupt) }
        : {}),
    };
  }
  const toolCallId =
    asOptionalString(params.payload.toolCallId) ||
    asOptionalString(params.payload.tool_use_id);
  return {
    type: "permission_response",
    requestId,
    ...(toolCallId ? { toolCallId } : {}),
    decision,
    tag: params.tag,
  };
}

function createHookEvent(params: {
  payload: Record<string, unknown>;
  tag: AcpSessionUpdateTag;
}): AcpRuntimeEvent | null {
  const hookKind =
    asOptionalString(params.payload.hookEvent) ||
    asOptionalString(params.payload.hookEventName) ||
    asOptionalString(params.payload.hookKind);
  if (!hookKind) return null;
  return {
    type: "hook_event",
    hookKind: hookKind as AcpHookEventKind,
    ...(asOptionalString(params.payload.hookName) ? { hookName: asOptionalString(params.payload.hookName) } : {}),
    ...(asOptionalString(params.payload.command) ? { command: asOptionalString(params.payload.command) } : {}),
    ...(asOptionalString(params.payload.statusMessage)
      ? { statusMessage: asOptionalString(params.payload.statusMessage) }
      : {}),
    ...(asOptionalString(params.payload.additionalContext)
      ? { additionalContext: asOptionalString(params.payload.additionalContext) }
      : {}),
    ...(asOptionalString(params.payload.permissionDecisionReason)
      ? {
          permissionDecisionReason: asOptionalString(params.payload.permissionDecisionReason),
        }
      : {}),
    ...(asOptionalString(params.payload.toolName) ? { toolName: asOptionalString(params.payload.toolName) } : {}),
    ...(asOptionalString(params.payload.toolCallId)
      ? { toolCallId: asOptionalString(params.payload.toolCallId) }
      : {}),
    tag: params.tag,
  };
}

function createSessionSystemEvent(params: {
  payload: Record<string, unknown>;
  tag: AcpSessionUpdateTag;
  kind: AcpSessionSystemKind;
}): AcpRuntimeEvent | null {
  const text =
    asTrimmedString(params.payload.message) ||
    asTrimmedString(params.payload.summary) ||
    asTrimmedString(params.payload.text) ||
    params.kind.replaceAll("_", " ");
  return {
    type: "session_system",
    kind: params.kind,
    text,
    ...(isRecord(params.payload.details) ? { details: params.payload.details } : {}),
    tag: params.tag,
  };
}

function createSubagentHopEvent(params: {
  payload: Record<string, unknown>;
  tag: AcpSessionUpdateTag;
  phase: "start" | "progress" | "end";
}): AcpRuntimeEvent | null {
  const agentId =
    asOptionalString(params.payload.agentId) ||
    asOptionalString(params.payload.agent_id) ||
    asOptionalString(params.payload.subagentId);
  if (!agentId) return null;
  const agentSessionId =
    asOptionalString(params.payload.agentSessionId) ||
    asOptionalString(params.payload.session_id);
  const subagentType =
    asOptionalString(params.payload.subagentType) ||
    asOptionalString(params.payload.subagent_type) ||
    asOptionalString(params.payload.type);
  const parentToolCallId =
    asOptionalString(params.payload.parentToolCallId) ||
    asOptionalString(params.payload.parent_tool_call_id) ||
    asOptionalString(params.payload.toolCallId);
  const description = asOptionalString(params.payload.description);
  const summary = asOptionalString(params.payload.summary);
  const innerRaw = isRecord(params.payload.innerToolCall) ? params.payload.innerToolCall : undefined;
  const innerToolCall = innerRaw
    ? {
        ...(asOptionalString(innerRaw.toolCallId) ? { toolCallId: asOptionalString(innerRaw.toolCallId) } : {}),
        ...(asOptionalString(innerRaw.toolName) ? { toolName: asOptionalString(innerRaw.toolName) } : {}),
        ...(asOptionalString(innerRaw.kind) ? { kind: asOptionalString(innerRaw.kind) as AcpToolCallKind } : {}),
        ...(asOptionalString(innerRaw.status) ? { status: asOptionalString(innerRaw.status) } : {}),
        ...(asOptionalString(innerRaw.title) ? { title: asOptionalString(innerRaw.title) } : {}),
      }
    : undefined;

  return {
    type: "subagent_hop",
    phase: params.phase,
    agentId,
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(subagentType ? { subagentType } : {}),
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...(description ? { description } : {}),
    ...(summary ? { summary } : {}),
    ...(innerToolCall && Object.keys(innerToolCall).length > 0 ? { innerToolCall } : {}),
    tag: params.tag,
  };
}

export function parsePromptEventLine(line: string): AcpRuntimeEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = safeParseJsonWithSchema(AcpxJsonObjectSchema, trimmed);
  if (!parsed) {
    return {
      type: "status",
      text: trimmed,
    };
  }

  const structured = resolveStructuredPromptPayload(parsed);
  const type = structured.type;
  const payload = structured.payload;
  const tag = structured.tag;

  switch (type) {
    case "text":
      return createTextDeltaEvent({
        content: asString(payload.content),
        stream: "output",
        tag,
      });
    case "thought":
      return createTextDeltaEvent({
        content: asString(payload.content),
        stream: "thought",
        tag,
      });
    case "tool_call":
      return createToolCallEvent({
        payload,
        tag: (tag ?? "tool_call") as AcpSessionUpdateTag,
      });
    case "tool_call_update":
      return createToolCallEvent({
        payload,
        tag: (tag ?? "tool_call_update") as AcpSessionUpdateTag,
      });
    case "agent_message_chunk":
      return resolveTextChunk({
        payload,
        stream: "output",
        tag: "agent_message_chunk",
      });
    case "agent_thought_chunk":
      return resolveTextChunk({
        payload,
        stream: "thought",
        tag: "agent_thought_chunk",
      });
    case "usage_update": {
      const used = asOptionalFiniteNumber(payload.used);
      const size = asOptionalFiniteNumber(payload.size);
      const text =
        used != null && size != null ? `usage updated: ${used}/${size}` : "usage updated";
      return {
        type: "status",
        text,
        tag: "usage_update",
        ...(used != null ? { used } : {}),
        ...(size != null ? { size } : {}),
      };
    }
    case "available_commands_update":
    case "current_mode_update":
    case "config_option_update":
    case "session_info_update":
    case "plan": {
      const text = resolveStatusTextForTag({
        tag: type as AcpSessionUpdateTag,
        payload,
      });
      if (!text) {
        return null;
      }
      return {
        type: "status",
        text,
        tag: type as AcpSessionUpdateTag,
      };
    }
    case "client_operation": {
      const method = asTrimmedString(payload.method) || "operation";
      const status = asTrimmedString(payload.status);
      const summary = asTrimmedString(payload.summary);
      const text = [method, status, summary].filter(Boolean).join(" ");
      if (!text) {
        return null;
      }
      return { type: "status", text, ...(tag ? { tag } : {}) };
    }
    case "update": {
      const update = asTrimmedString(payload.update);
      if (!update) {
        return null;
      }
      return { type: "status", text: update, ...(tag ? { tag } : {}) };
    }
    case "permission_request":
    case "request_permission":
    case "session/request_permission":
      return createPermissionRequestEvent({
        payload,
        tag: (tag ?? "permission_request") as AcpSessionUpdateTag,
      });
    case "permission_response":
    case "permission_decision":
    case "session/permission_response":
      return createPermissionResponseEvent({
        payload,
        tag: (tag ?? "permission_response") as AcpSessionUpdateTag,
      });
    case "hook_event":
    case "hook_progress":
    case "hook":
      return createHookEvent({
        payload,
        tag: (tag ?? "hook_event") as AcpSessionUpdateTag,
      });
    case "session_compacted":
    case "session_resumed":
    case "context_window_warning":
    case "model_switched":
    case "auth_status":
    case "rate_limit":
    case "rate_limit_event":
      return createSessionSystemEvent({
        payload,
        tag: (tag ?? (type as AcpSessionUpdateTag)),
        kind: (type === "rate_limit_event" ? "rate_limit" : type) as AcpSessionSystemKind,
      });
    case "subagent_start":
    case "agent_start":
      return createSubagentHopEvent({
        payload,
        tag: (tag ?? "subagent_start") as AcpSessionUpdateTag,
        phase: "start",
      });
    case "subagent_progress":
    case "agent_progress":
      return createSubagentHopEvent({
        payload,
        tag: (tag ?? "subagent_progress") as AcpSessionUpdateTag,
        phase: "progress",
      });
    case "subagent_end":
    case "agent_end":
      return createSubagentHopEvent({
        payload,
        tag: (tag ?? "subagent_end") as AcpSessionUpdateTag,
        phase: "end",
      });
    case "done": {
      const usageRaw = isRecord(payload.usage) ? payload.usage : undefined;
      const usage = usageRaw
        ? {
            ...(typeof usageRaw.inputTokens === "number" ? { inputTokens: usageRaw.inputTokens } : {}),
            ...(typeof usageRaw.outputTokens === "number" ? { outputTokens: usageRaw.outputTokens } : {}),
            ...(typeof usageRaw.cacheCreationInputTokens === "number"
              ? { cacheCreationInputTokens: usageRaw.cacheCreationInputTokens }
              : {}),
            ...(typeof usageRaw.cacheReadInputTokens === "number"
              ? { cacheReadInputTokens: usageRaw.cacheReadInputTokens }
              : {}),
          }
        : undefined;
      const durationMs =
        typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
          ? payload.durationMs
          : undefined;
      return {
        type: "done",
        stopReason: asOptionalString(payload.stopReason),
        ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
        ...(durationMs != null ? { durationMs } : {}),
      };
    }
    case "error": {
      const message = asTrimmedString(payload.message) || "acpx runtime error";
      return {
        type: "error",
        message,
        code: asOptionalString(payload.code),
        retryable: asOptionalBoolean(payload.retryable),
      };
    }
    default:
      return null;
  }
}
