export type AcpRuntimePromptMode = "prompt" | "steer";

export type AcpRuntimeSessionMode = "persistent" | "oneshot";

export type AcpSessionUpdateTag =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "usage_update"
  | "available_commands_update"
  | "current_mode_update"
  | "config_option_update"
  | "session_info_update"
  | "plan"
  | (string & {});

export type AcpRuntimeControl = "session/set_mode" | "session/set_config_option" | "session/status";

export type AcpRuntimeHandle = {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  /** Effective runtime working directory for this ACP session, if exposed by adapter/runtime. */
  cwd?: string;
  /** Backend-local record identifier, if exposed by adapter/runtime (for example acpx record id). */
  acpxRecordId?: string;
  /** Backend-level ACP session identifier, if exposed by adapter/runtime. */
  backendSessionId?: string;
  /** Upstream harness session identifier, if exposed by adapter/runtime. */
  agentSessionId?: string;
};

export type AcpRuntimeEnsureInput = {
  sessionKey: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  resumeSessionId?: string;
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Backend-specific model identifier. Forwarded to acpx's `--model` flag when
   * present. For `claude-code` this maps to claude-agent-acp's model id (for
   * example `claude-sonnet-4-6-20260401`); for `codex` it maps to codex-acp's
   * model id. Omit to use the backend's configured default.
   */
  model?: string;
  /**
   * When true, the session's mount baseline is read-only: reads inside the
   * baseline are auto-approved, writes are surfaced to the user via the
   * interactive permission policy. False (or undefined) means the baseline
   * is read-write: both reads and writes inside the baseline auto-approve.
   * Combined with {@link mountBaselineRoot} to form the policy scope; the
   * flag alone no longer forces acpx into `--deny-all` — the runtime relies
   * on the pty-based policy layer instead so users can still approve
   * write-adjacent operations on a case-by-case basis.
   */
  readOnly?: boolean;
  /**
   * Absolute root path of the session's mount baseline, typically the
   * /mnt/host-projects/<name> directory detected by
   * {@link detectHostProjectMountBaseline}. The acpx runtime auto-approves
   * tool calls whose resolved target path lies within this root (reads
   * always; writes only when {@link readOnly} is false). Anything outside
   * the root is surfaced to the user as an approval card. Leave undefined
   * to surface every prompt.
   */
  mountBaselineRoot?: string;
};

export type AcpRuntimeTurnAttachment = {
  mediaType: string;
  data: string;
};

export type AcpRuntimeTurnInput = {
  handle: AcpRuntimeHandle;
  text: string;
  attachments?: AcpRuntimeTurnAttachment[];
  mode: AcpRuntimePromptMode;
  requestId: string;
  signal?: AbortSignal;
  /**
   * Optional per-turn model override. When present, this takes precedence over
   * any model captured at session-ensure time. Enables mid-conversation model
   * switching without rebuilding the session. See `AcpRuntimeEnsureInput.model`.
   */
  model?: string;
  /**
   * Optional per-turn read-only override. When present, takes precedence over
   * any readOnly captured at session-ensure time. See `AcpRuntimeEnsureInput.readOnly`.
   */
  readOnly?: boolean;
};

export type AcpRuntimeCapabilities = {
  controls: AcpRuntimeControl[];
  /**
   * Optional backend-advertised option keys for session/set_config_option.
   * Empty/undefined means "backend accepts keys, but did not advertise a strict list".
   */
  configOptionKeys?: string[];
};

export type AcpRuntimeStatus = {
  summary?: string;
  /** Backend-local record identifier, if exposed by adapter/runtime. */
  acpxRecordId?: string;
  /** Backend-level ACP session identifier, if known at status time. */
  backendSessionId?: string;
  /** Upstream harness session identifier, if known at status time. */
  agentSessionId?: string;
  details?: Record<string, unknown>;
};

/**
 * Per-agent probe result nested under {@link AcpRuntimeDoctorReport.agentReports}.
 * Runtimes can attach these to surface agent-specific health (for example
 * whether the underlying claude-code CLI is installed and whether the
 * subscription auth directory is populated) alongside the backend-level check.
 */
export type AcpRuntimeAgentDoctorReport = {
  /** Agent id as seen by the runtime (for example `claude-code`, `codex`). */
  agent: string;
  ok: boolean;
  code?: string;
  message: string;
  installCommand?: string;
  details?: string[];
};

export type AcpRuntimeDoctorReport = {
  ok: boolean;
  code?: string;
  message: string;
  installCommand?: string;
  details?: string[];
  /**
   * Optional per-agent sub-reports. When present, the backend-level `ok`
   * reflects the acpx CLI itself; individual agents may still be unhealthy
   * (missing upstream CLI, missing subscription auth, etc.).
   */
  agentReports?: AcpRuntimeAgentDoctorReport[];
};

/**
 * Semantic tool kind derived from the underlying runtime's tool name.
 * Open-ended string so new tools from upstream harnesses don't require a type bump.
 */
export type AcpToolCallKind =
  | "bash"
  | "edit"
  | "multi_edit"
  | "write"
  | "read"
  | "glob"
  | "grep"
  | "web_fetch"
  | "web_search"
  | "task"
  | "todo_write"
  | "notebook_edit"
  | "mcp"
  | (string & {});

/** File/line location associated with a tool call, for UI jump-to-file affordances. */
export type AcpToolCallLocation = {
  path?: string;
  line?: number;
  column?: number;
};

export type AcpToolCallStructuredPatchHunk = {
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  lines?: string[];
};

/**
 * Structured patch information for file-editing tool calls.
 * Mirrors the shape Claude Code's FileEditTool returns in tool_result
 * (originalFile + hunks + gitDiff) so renderers can draw inline diffs
 * without reconstructing state.
 */
export type AcpToolCallStructuredPatch = {
  filePath?: string;
  originalFile?: string;
  hunks?: AcpToolCallStructuredPatchHunk[];
  gitDiff?: {
    filename?: string;
    status?: string;
    additions?: number;
    deletions?: number;
    patch?: string;
  };
};

/** Structured tool-result content blocks, forwarded verbatim from the runtime. */
export type AcpToolCallContentBlock = {
  type: string;
  text?: string;
  mimeType?: string;
  data?: unknown;
};

/** Decision payload sent back to the runtime in response to a permission request. */
export type AcpPermissionDecision =
  | {
      behavior: "allow";
      /** If the user edited the tool input before approving, the replacement input. */
      updatedInput?: Record<string, unknown>;
      /** Scope for the approval: "once" for this call, "session" for this turn's session, "always" for persistent. */
      scope?: "once" | "session" | "always";
    }
  | {
      behavior: "deny";
      /** Optional reason shown back to the model. */
      message?: string;
      /** If true, the runtime should interrupt the entire turn after denial. */
      interrupt?: boolean;
    };

/** Variant of a permission-request button offered to the user. */
export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_session"
  | "allow_always"
  | "allow_edit"
  | "deny"
  | "deny_interrupt"
  | (string & {});

export type AcpPermissionOption = {
  optionId: string;
  label: string;
  kind: AcpPermissionOptionKind;
  description?: string;
};

/**
 * Hook event category. Mirrors Claude Code's `SDKHookCallbackRequest` union
 * plus a free-form string tail so upstream additions don't require a type bump.
 */
export type AcpHookEventKind =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "Setup"
  | "SubagentStart"
  | "PermissionRequest"
  | "Elicitation"
  | "Stop"
  | "Notification"
  | (string & {});

/** Session-level system notification category. */
export type AcpSessionSystemKind =
  | "session_compacted"
  | "context_window_warning"
  | "model_switched"
  | "auth_status"
  | "rate_limit"
  | "session_resumed"
  | (string & {});

export type AcpRuntimeEvent =
  | {
      type: "text_delta";
      text: string;
      stream?: "output" | "thought";
      tag?: AcpSessionUpdateTag;
      /** Monotonic index from the underlying SDK stream event, if known. Preserves sub-block interleave ordering. */
      streamIndex?: number;
      /** Content-block index within the current assistant message, if known. */
      blockIndex?: number;
      /** Opaque signature data for thinking deltas, if the runtime exposes it. */
      signature?: string;
    }
  | {
      type: "status";
      text: string;
      tag?: AcpSessionUpdateTag;
      used?: number;
      size?: number;
    }
  | {
      type: "tool_call";
      text: string;
      tag?: AcpSessionUpdateTag;
      toolCallId?: string;
      status?: string;
      title?: string;
      /** Semantic tool kind derived from the tool name. */
      kind?: AcpToolCallKind;
      /** Raw tool name as emitted by the runtime. */
      toolName?: string;
      /** Raw input payload as the runtime rendered it. */
      rawInput?: Record<string, unknown>;
      /** Raw output payload as the runtime rendered it. */
      rawOutput?: Record<string, unknown>;
      /** Structured tool-result content blocks, forwarded verbatim. */
      contentBlocks?: AcpToolCallContentBlock[];
      /** File/line locations associated with this tool call. */
      locations?: AcpToolCallLocation[];
      /** Structured patch for file-edit tools. */
      structuredPatch?: AcpToolCallStructuredPatch;
      /** Free-form description of what the call is doing. */
      description?: string;
      /** Correlation id if this tool call triggered a subagent. */
      subagentId?: string;
      /** True if the runtime reports that the result payload was truncated. */
      truncated?: boolean;
      /** Duration in milliseconds, for terminal states. */
      durationMs?: number;
    }
  | {
      type: "permission_request";
      /** Correlation id for matching the eventual response. */
      requestId: string;
      toolName: string;
      toolCallId?: string;
      /** Tool input that the runtime wants to execute. */
      input?: Record<string, unknown>;
      title?: string;
      displayName?: string;
      description?: string;
      /** Path that triggered a policy block, if any. */
      blockedPath?: string;
      /** Free-form reason for the request, if the runtime provided one. */
      reason?: string;
      /** Permission-policy suggestions surfaced by the runtime. */
      suggestions?: Array<Record<string, unknown>>;
      /** Buttons to render in the approval card. */
      options: AcpPermissionOption[];
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "permission_response";
      requestId: string;
      toolCallId?: string;
      decision: AcpPermissionDecision;
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "hook_event";
      hookKind: AcpHookEventKind;
      hookName?: string;
      command?: string;
      statusMessage?: string;
      additionalContext?: string;
      permissionDecisionReason?: string;
      /** Tool name associated with this hook, if PreToolUse/PostToolUse. */
      toolName?: string;
      /** Tool-call id associated with this hook, if applicable. */
      toolCallId?: string;
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "session_system";
      kind: AcpSessionSystemKind;
      text: string;
      details?: Record<string, unknown>;
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "subagent_hop";
      /** Lifecycle phase for the nested subagent card. */
      phase: "start" | "progress" | "end";
      /** Tool call id of the Agent/Task tool call in the parent stream. */
      parentToolCallId?: string;
      /** Subagent's own agent id as exposed by the runtime. */
      agentId: string;
      /** Subagent's session id for pulling further events via /v1/sessions/:id/events. */
      agentSessionId?: string;
      /** Claude Code subagent_type, if provided. */
      subagentType?: string;
      /** Free-form description of what the subagent is doing. */
      description?: string;
      /**
       * When a subagent's own tool event is forwarded up to the parent stream
       * (rather than re-emitted as a fresh tool_call), this carries the inner
       * call metadata. Renderers nest these inside the parent tool card.
       */
      innerToolCall?: {
        toolCallId?: string;
        toolName?: string;
        kind?: AcpToolCallKind;
        status?: string;
        title?: string;
      };
      /** Final summary text for the `end` phase. */
      summary?: string;
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "done";
      stopReason?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
      };
      durationMs?: number;
    }
  | {
      type: "error";
      message: string;
      code?: string;
      retryable?: boolean;
    };

export interface AcpRuntime {
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;

  runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;

  getCapabilities?(input: {
    handle?: AcpRuntimeHandle;
  }): Promise<AcpRuntimeCapabilities> | AcpRuntimeCapabilities;

  getStatus?(input: { handle: AcpRuntimeHandle; signal?: AbortSignal }): Promise<AcpRuntimeStatus>;

  setMode?(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void>;

  setConfigOption?(input: { handle: AcpRuntimeHandle; key: string; value: string }): Promise<void>;

  doctor?(): Promise<AcpRuntimeDoctorReport>;

  /**
   * Deliver a user-originated permission decision back to the runtime.
   * Invoked when the UI resolves an approval card that the runtime had
   * previously surfaced via a `permission_request` event with the matching
   * `requestId`. Runtimes that never emit `permission_request` events can
   * leave this unimplemented.
   */
  respondToPermission?(input: {
    handle: AcpRuntimeHandle;
    requestId: string;
    decision: AcpPermissionDecision;
  }): Promise<void>;

  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;

  close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void>;
}
