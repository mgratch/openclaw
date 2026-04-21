import { createInterface } from "node:readline";
import { access as fsAccess } from "node:fs/promises";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import type {
  AcpRuntimeAgentDoctorReport,
  AcpRuntimeCapabilities,
  AcpRuntimeDoctorReport,
  AcpRuntime,
  AcpRuntimeEnsureInput,
  AcpRuntimeErrorCode,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeStatus,
  AcpRuntimeTurnInput,
  PluginLogger,
} from "../runtime-api.js";
import { AcpRuntimeError } from "../runtime-api.js";
import { toAcpMcpServers, type ResolvedAcpxPluginConfig } from "./config.js";
import { checkAcpxVersion, type AcpxVersionCheckResult } from "./ensure.js";
import { parseControlJsonError } from "./runtime-internals/control-errors.js";
import {
  parseJsonLines,
  parsePromptEventLine,
  toAcpxErrorEvent,
} from "./runtime-internals/events.js";
import {
  buildMcpProxyAgentCommand,
  resolveAcpxAgentCommand,
} from "./runtime-internals/mcp-agent-command.js";
import {
  resolveSpawnFailure,
  type SpawnCommandCache,
  type SpawnCommandOptions,
  type SpawnResolutionEvent,
  spawnAndCollect,
  spawnWithResolvedCommand,
  waitForExit,
} from "./runtime-internals/process.js";
import {
  asOptionalString,
  asTrimmedString,
  buildPermissionArgs,
  deriveAgentFromSessionKey,
  isRecord,
  type AcpxHandleState,
  type AcpxJsonObject,
} from "./runtime-internals/shared.js";
import { formatPermissionReply } from "./runtime-internals/permission-prompt.js";
import type { AcpxPermissionBaseline } from "./runtime-internals/permission-policy.js";
import {
  createAcpxPtyDemuxState,
  processAcpxPtyChunk,
} from "./runtime-internals/pty-demux.js";
import { spawnAcpxUnderPty, type PtyProcessHandle } from "./runtime-internals/pty-process.js";
import { writePromptToTempFile } from "./runtime-internals/prompt-tempfile.js";
import type { AcpPermissionDecision, AcpPermissionOption } from "../runtime-api.js";

export const ACPX_BACKEND_ID = "acpx";

const ACPX_RUNTIME_HANDLE_PREFIX = "acpx:v1:";
const DEFAULT_AGENT_FALLBACK = "codex";

/**
 * OpenClaw uses stable agent identifiers in session keys and UI, but acpx's
 * built-in agent registry uses shorter names. Map OpenClaw-side aliases to the
 * acpx built-in name at the CLI boundary. Keep this the ONLY place the
 * translation happens so logs, session keys, and persisted state all keep the
 * OpenClaw-side identifier.
 *
 * Today: `claude-code` → acpx's `claude` built-in (which routes to
 * `@agentclientprotocol/claude-agent-acp` and reads subscription auth from
 * `~/.claude`).
 */
const ACPX_AGENT_ALIASES: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  // Chunk 13 — preset variants all resolve to the same `claude` acpx agent;
  // the per-turn model flag (claude-opus-4-6 / claude-sonnet-4-6 / …) is
  // passed separately via `--model <id>` from the OpenClaw dispatcher.
  // See src/acp/presets.ts for the canonical preset list.
  "claude-code-opus": "claude",
  "claude-code-sonnet": "claude",
  "claude-code-haiku": "claude",
};

function toAcpxAgentName(agent: string): string {
  return ACPX_AGENT_ALIASES[agent] ?? agent;
}
const ACPX_EXIT_CODE_PERMISSION_DENIED = 5;
const ACPX_CAPABILITIES: AcpRuntimeCapabilities = {
  controls: ["session/set_mode", "session/set_config_option", "session/status"],
};

type AcpxHealthCheckResult =
  | {
      ok: true;
      versionCheck: Extract<AcpxVersionCheckResult, { ok: true }>;
    }
  | {
      ok: false;
      failure:
        | {
            kind: "version-check";
            versionCheck: Extract<AcpxVersionCheckResult, { ok: false }>;
          }
        | {
            kind: "help-check";
            result: Awaited<ReturnType<typeof spawnAndCollect>>;
          }
        | {
            kind: "exception";
            error: unknown;
          };
    };

type EnsureFailureRecoveryResult = {
  events: AcpxJsonObject[];
  skipPostEnsureReplacement: boolean;
};

function formatPermissionModeGuidance(): string {
  return "Configure plugins.entries.acpx.config.permissionMode to one of: approve-reads, approve-all, deny-all.";
}

function formatAcpxExitMessage(params: {
  stderr: string;
  exitCode: number | null | undefined;
  signal?: NodeJS.Signals | null;
}): string {
  const stderr = params.stderr.trim();
  if (params.exitCode === ACPX_EXIT_CODE_PERMISSION_DENIED) {
    return [
      stderr || "Permission denied by ACP runtime (acpx).",
      "ACPX blocked a write/exec permission request in a non-interactive session.",
      formatPermissionModeGuidance(),
    ].join(" ");
  }
  if (stderr) {
    return stderr;
  }
  if (params.signal) {
    return `acpx exited with signal ${params.signal}`;
  }
  return `acpx exited with code ${params.exitCode ?? "unknown"}`;
}

function didAcpxProcessExitWithFailure(params: {
  exitCode: number | null | undefined;
  signal?: NodeJS.Signals | null;
}): boolean {
  return params.exitCode !== null && params.exitCode !== undefined
    ? params.exitCode !== 0
    : params.signal !== null && params.signal !== undefined;
}

function summarizeLogText(text: string, maxChars = 240): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function shouldRetainNamedSessionForDeadStatus(detail: AcpxJsonObject | undefined): boolean {
  const status = asTrimmedString(detail?.status)?.toLowerCase();
  if (status !== "dead") {
    return false;
  }
  const summary = asTrimmedString(detail?.summary)?.toLowerCase();
  return summary?.includes("queue owner unavailable") ?? false;
}

function resolveResumeSessionIdFromDetail(detail: AcpxJsonObject | undefined): string | undefined {
  return asOptionalString(detail?.acpxSessionId) ?? asOptionalString(detail?.agentSessionId);
}

function formatAcpxControlErrorMessage(params: {
  code?: string;
  message: string;
  stderr: string;
}): string {
  const baseMessage = params.code ? `${params.code}: ${params.message}` : params.message;
  const stderrSummary = summarizeLogText(params.stderr);
  if (!stderrSummary) {
    return baseMessage;
  }
  if (
    /^(?:internal error|acpx reported an error)$/i.test(params.message) &&
    !baseMessage.includes(stderrSummary)
  ) {
    return `${baseMessage} | ${stderrSummary}`;
  }
  return baseMessage;
}

function findSessionIdentifierEvent(events: AcpxJsonObject[]): AcpxJsonObject | undefined {
  return events.find(
    (event) =>
      asOptionalString(event.agentSessionId) ||
      asOptionalString(event.acpxSessionId) ||
      asOptionalString(event.acpxRecordId),
  );
}

export function encodeAcpxRuntimeHandleState(state: AcpxHandleState): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${ACPX_RUNTIME_HANDLE_PREFIX}${payload}`;
}

export function decodeAcpxRuntimeHandleState(runtimeSessionName: string): AcpxHandleState | null {
  const trimmed = runtimeSessionName.trim();
  if (!trimmed.startsWith(ACPX_RUNTIME_HANDLE_PREFIX)) {
    return null;
  }
  const encoded = trimmed.slice(ACPX_RUNTIME_HANDLE_PREFIX.length);
  if (!encoded) {
    return null;
  }
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const name = asTrimmedString(parsed.name);
    const agent = asTrimmedString(parsed.agent);
    const cwd = asTrimmedString(parsed.cwd);
    const mode = asTrimmedString(parsed.mode);
    const acpxRecordId = asOptionalString(parsed.acpxRecordId);
    const backendSessionId = asOptionalString(parsed.backendSessionId);
    const agentSessionId = asOptionalString(parsed.agentSessionId);
    const model = asOptionalString(parsed.model);
    const readOnly = parsed.readOnly === true;
    const mountBaselineRoot = asOptionalString(parsed.mountBaselineRoot);
    if (!name || !agent || !cwd) {
      return null;
    }
    if (mode !== "persistent" && mode !== "oneshot") {
      return null;
    }
    return {
      name,
      agent,
      cwd,
      mode,
      ...(acpxRecordId ? { acpxRecordId } : {}),
      ...(backendSessionId ? { backendSessionId } : {}),
      ...(agentSessionId ? { agentSessionId } : {}),
      ...(model ? { model } : {}),
      ...(readOnly ? { readOnly: true } : {}),
      ...(mountBaselineRoot ? { mountBaselineRoot } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Per-session pending state for the pty runTurn path. When the permission
 * policy surfaces a prompt we park it in `pending` keyed by the synthesized
 * requestId and wait for `respondToPermission` to resolve the entry. The
 * `write` closure is captured so the external responder can push `y\n`/`n\n`
 * into the child without needing a handle to node-pty internals.
 */
type AcpxPtyPendingSession = {
  write: (data: string) => void;
  pending: Map<string, (reply: AcpPermissionDecision) => void>;
};

export class AcpxRuntime implements AcpRuntime {
  private healthy = false;
  private readonly logger?: PluginLogger;
  private readonly queueOwnerTtlSeconds: number;
  private readonly spawnCommandCache: SpawnCommandCache = {};
  private readonly mcpProxyAgentCommandCache = new Map<string, string>();
  private readonly spawnCommandOptions: SpawnCommandOptions;
  private readonly loggedSpawnResolutions = new Set<string>();
  /**
   * Map of active pty-driven turns keyed by session name. At most one entry
   * per session because acpx serializes prompt turns on a single session.
   * Populated at the top of `runTurnOverPty` and cleared in its `finally`.
   */
  private readonly ptyPendingSessions = new Map<string, AcpxPtyPendingSession>();

  constructor(
    private readonly config: ResolvedAcpxPluginConfig,
    opts?: {
      logger?: PluginLogger;
      queueOwnerTtlSeconds?: number;
    },
  ) {
    this.logger = opts?.logger;
    const requestedQueueOwnerTtlSeconds = opts?.queueOwnerTtlSeconds;
    this.queueOwnerTtlSeconds =
      typeof requestedQueueOwnerTtlSeconds === "number" &&
      Number.isFinite(requestedQueueOwnerTtlSeconds) &&
      requestedQueueOwnerTtlSeconds >= 0
        ? requestedQueueOwnerTtlSeconds
        : this.config.queueOwnerTtlSeconds;
    this.spawnCommandOptions = {
      strictWindowsCmdWrapper: this.config.strictWindowsCmdWrapper,
      cache: this.spawnCommandCache,
      onResolved: (event) => {
        this.logSpawnResolution(event);
      },
    };
    // BUILD-MARKER-2026-04-15-queue-owner-retain-fix
    this.logger?.warn?.(
      "acpx runtime constructor [BUILD-MARKER-2026-04-15-queue-owner-retain-fix] — dead+queue-owner-unavailable now retained, not repaired",
    );
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  private logSpawnResolution(event: SpawnResolutionEvent): void {
    const key = `${event.command}::${event.strictWindowsCmdWrapper ? "strict" : "compat"}::${event.resolution}`;
    if (event.cacheHit || this.loggedSpawnResolutions.has(key)) {
      return;
    }
    this.loggedSpawnResolutions.add(key);
    this.logger?.debug?.(
      `acpx spawn resolver: command=${event.command} mode=${event.strictWindowsCmdWrapper ? "strict" : "compat"} resolution=${event.resolution}`,
    );
  }

  private async checkVersion(): Promise<AcpxVersionCheckResult> {
    return await checkAcpxVersion({
      command: this.config.command,
      cwd: this.config.cwd,
      expectedVersion: this.config.expectedVersion,
      stripProviderAuthEnvVars: this.config.stripProviderAuthEnvVars,
      spawnOptions: this.spawnCommandOptions,
    });
  }

  private async runHelpCheck(): Promise<Awaited<ReturnType<typeof spawnAndCollect>>> {
    return await spawnAndCollect(
      {
        command: this.config.command,
        args: ["--help"],
        cwd: this.config.cwd,
        stripProviderAuthEnvVars: this.config.stripProviderAuthEnvVars,
      },
      this.spawnCommandOptions,
    );
  }

  private async checkHealth(): Promise<AcpxHealthCheckResult> {
    const versionCheck = await this.checkVersion();
    if (!versionCheck.ok) {
      return {
        ok: false,
        failure: {
          kind: "version-check",
          versionCheck,
        },
      };
    }

    try {
      const result = await this.runHelpCheck();
      if (
        result.error != null ||
        didAcpxProcessExitWithFailure({
          exitCode: result.code,
          signal: result.signal,
        })
      ) {
        return {
          ok: false,
          failure: {
            kind: "help-check",
            result,
          },
        };
      }
      return {
        ok: true,
        versionCheck,
      };
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: "exception",
          error,
        },
      };
    }
  }

  async probeAvailability(): Promise<void> {
    const result = await this.checkHealth();
    this.healthy = result.ok;
  }

  private async createNamedSession(params: {
    agent: string;
    cwd: string;
    sessionName: string;
    resumeSessionId?: string;
  }): Promise<AcpxJsonObject[]> {
    const command = params.resumeSessionId
      ? [
          "sessions",
          "new",
          "--name",
          params.sessionName,
          "--resume-session",
          params.resumeSessionId,
        ]
      : ["sessions", "new", "--name", params.sessionName];
    return await this.runControlCommand({
      args: await this.buildVerbArgs({
        agent: params.agent,
        cwd: params.cwd,
        command,
      }),
      cwd: params.cwd,
      fallbackCode: "ACP_SESSION_INIT_FAILED",
    });
  }

  private async replaceDeadNamedSession(params: {
    detail: AcpxJsonObject | undefined;
    sessionName: string;
    agent: string;
    cwd: string;
    logContext: string;
  }): Promise<AcpxJsonObject[]> {
    const resumeSessionId = resolveResumeSessionIdFromDetail(params.detail);
    if (!resumeSessionId) {
      this.logger?.warn?.(
        `acpx ensureSession repairing dead named session with fresh session owner: session=${params.sessionName} cwd=${params.cwd} ${params.logContext}`,
      );
      return await this.createNamedSession({
        agent: params.agent,
        cwd: params.cwd,
        sessionName: params.sessionName,
      });
    }
    this.logger?.warn?.(
      `acpx ensureSession repairing dead named session by resuming backend session: session=${params.sessionName} cwd=${params.cwd} resumeSessionId=${resumeSessionId} ${params.logContext}`,
    );
    try {
      return await this.createNamedSession({
        agent: params.agent,
        cwd: params.cwd,
        sessionName: params.sessionName,
        resumeSessionId,
      });
    } catch (error) {
      if (!(error instanceof AcpRuntimeError) || error.code !== "ACP_SESSION_INIT_FAILED") {
        throw error;
      }
      this.logger?.warn?.(
        `acpx ensureSession dead-session resume repair failed; retrying with fresh session owner: session=${params.sessionName} cwd=${params.cwd} resumeSessionId=${resumeSessionId} error=${summarizeLogText(error.message) || "<empty>"} ${params.logContext}`,
      );
      return await this.createNamedSession({
        agent: params.agent,
        cwd: params.cwd,
        sessionName: params.sessionName,
      });
    }
  }

  private async shouldReplaceEnsuredSession(params: {
    sessionName: string;
    agent: string;
    cwd: string;
  }): Promise<{ replace: boolean; replacementEvents?: AcpxJsonObject[] }> {
    const args = await this.buildVerbArgs({
      agent: params.agent,
      cwd: params.cwd,
      command: ["status", "--session", params.sessionName],
    });
    let events: AcpxJsonObject[];
    try {
      events = await this.runControlCommand({
        args,
        cwd: params.cwd,
        fallbackCode: "ACP_SESSION_INIT_FAILED",
        ignoreNoSession: true,
      });
    } catch (error) {
      this.logger?.warn?.(
        `acpx ensureSession status probe failed: session=${params.sessionName} cwd=${params.cwd} error=${summarizeLogText(error instanceof Error ? error.message : String(error)) || "<empty>"}`,
      );
      return { replace: false };
    }

    const noSession = events.some((event) => toAcpxErrorEvent(event)?.code === "NO_SESSION");
    if (noSession) {
      this.logger?.warn?.(
        `acpx ensureSession replacing missing named session: session=${params.sessionName} cwd=${params.cwd}`,
      );
      return { replace: true };
    }

    const detail = events.find((event) => !toAcpxErrorEvent(event));
    const status = asTrimmedString(detail?.status)?.toLowerCase();
    if (status === "dead") {
      const summary = summarizeLogText(asOptionalString(detail?.summary) ?? "");
      if (shouldRetainNamedSessionForDeadStatus(detail)) {
        // Benign dead state: the queue owner has not spawned yet because no
        // prompt has run on this freshly-ensured session. Chasing a repair
        // here invents fresh resume UUIDs that the adapter cannot honor and
        // loops indefinitely. Trust the just-ensured session; the first
        // prompt call will spawn the queue owner naturally.
        this.logger?.debug?.(
          `acpx ensureSession retaining just-ensured dead session (queue owner will spawn on first prompt): session=${params.sessionName} cwd=${params.cwd} status=${status} summary=${summary || "<empty>"}`,
        );
        return { replace: false };
      }
      this.logger?.warn?.(
        `acpx ensureSession replacing dead named session: session=${params.sessionName} cwd=${params.cwd} status=${status} summary=${summary || "<empty>"}`,
      );
      return { replace: true };
    }

    return { replace: false };
  }

  private async recoverEnsureFailure(params: {
    sessionName: string;
    agent: string;
    cwd: string;
    error: unknown;
  }): Promise<EnsureFailureRecoveryResult | null> {
    const errorMessage = summarizeLogText(
      params.error instanceof Error ? params.error.message : String(params.error),
    );
    this.logger?.warn?.(
      `acpx ensureSession probing named session after ensure failure: session=${params.sessionName} cwd=${params.cwd} error=${errorMessage || "<empty>"}`,
    );
    const args = await this.buildVerbArgs({
      agent: params.agent,
      cwd: params.cwd,
      command: ["status", "--session", params.sessionName],
    });
    let events: AcpxJsonObject[];
    try {
      events = await this.runControlCommand({
        args,
        cwd: params.cwd,
        fallbackCode: "ACP_SESSION_INIT_FAILED",
        ignoreNoSession: true,
      });
    } catch (statusError) {
      this.logger?.warn?.(
        `acpx ensureSession status fallback failed: session=${params.sessionName} cwd=${params.cwd} error=${summarizeLogText(statusError instanceof Error ? statusError.message : String(statusError)) || "<empty>"}`,
      );
      return null;
    }

    const noSession = events.some((event) => toAcpxErrorEvent(event)?.code === "NO_SESSION");
    if (noSession) {
      this.logger?.warn?.(
        `acpx ensureSession creating named session after ensure failure and missing status: session=${params.sessionName} cwd=${params.cwd}`,
      );
      return {
        events: await this.createNamedSession({
          agent: params.agent,
          cwd: params.cwd,
          sessionName: params.sessionName,
        }),
        skipPostEnsureReplacement: true,
      };
    }

    const detail = events.find((event) => !toAcpxErrorEvent(event));
    const status = asTrimmedString(detail?.status)?.toLowerCase();
    if (status === "dead") {
      const summary = summarizeLogText(asOptionalString(detail?.summary) ?? "");
      if (shouldRetainNamedSessionForDeadStatus(detail)) {
        // Benign dead state after ensure failure: the named session exists
        // but its queue owner has not spawned yet. Reuse the probe events
        // (which carry the session identifiers) and let the first prompt
        // spawn the queue owner. See shouldReplaceEnsuredSession for the
        // matching rationale.
        this.logger?.debug?.(
          `acpx ensureSession retaining named session after ensure failure (queue owner will spawn on first prompt): session=${params.sessionName} cwd=${params.cwd} status=${status} summary=${summary || "<empty>"}`,
        );
        return {
          events,
          skipPostEnsureReplacement: true,
        };
      }
      this.logger?.warn?.(
        `acpx ensureSession replacing dead named session after ensure failure: session=${params.sessionName} cwd=${params.cwd}`,
      );
      return {
        events: await this.createNamedSession({
          agent: params.agent,
          cwd: params.cwd,
          sessionName: params.sessionName,
        }),
        skipPostEnsureReplacement: true,
      };
    }

    if (status === "alive" || findSessionIdentifierEvent(events)) {
      this.logger?.warn?.(
        `acpx ensureSession reusing live named session after ensure failure: session=${params.sessionName} cwd=${params.cwd} status=${status || "unknown"}`,
      );
      return {
        events,
        skipPostEnsureReplacement: false,
      };
    }

    return null;
  }

  async ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    const sessionName = asTrimmedString(input.sessionKey);
    if (!sessionName) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    const agent = asTrimmedString(input.agent);
    if (!agent) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP agent id is required.");
    }
    const cwd = asTrimmedString(input.cwd) || this.config.cwd;
    const mode = input.mode;
    const resumeSessionId = asTrimmedString(input.resumeSessionId);
    // NOTE: input.model is accepted on the runtime contract but not consumed
    // here — acpx's `--model` flag only affects `prompt` calls, not session
    // ensure/new/status. Mid-conversation model switching flows through
    // AcpRuntimeTurnInput.model on each runTurn call instead.
    let events: AcpxJsonObject[];
    let skipPostEnsureReplacement = false;
    if (resumeSessionId) {
      events = await this.createNamedSession({
        agent,
        cwd,
        sessionName,
        resumeSessionId,
      });
    } else {
      try {
        events = await this.runControlCommand({
          args: await this.buildVerbArgs({
            agent,
            cwd,
            command: ["sessions", "ensure", "--name", sessionName],
          }),
          cwd,
          fallbackCode: "ACP_SESSION_INIT_FAILED",
        });
      } catch (error) {
        const recovered = await this.recoverEnsureFailure({
          sessionName,
          agent,
          cwd,
          error,
        });
        if (!recovered) {
          throw error;
        }
        events = recovered.events;
        skipPostEnsureReplacement = recovered.skipPostEnsureReplacement;
      }
    }
    if (events.length === 0) {
      this.logger?.warn?.(
        `acpx ensureSession returned no events after sessions ensure: session=${sessionName} agent=${agent} cwd=${cwd}`,
      );
    }
    let ensuredEvent = findSessionIdentifierEvent(events);

    if (ensuredEvent && !resumeSessionId && !skipPostEnsureReplacement) {
      const replacement = await this.shouldReplaceEnsuredSession({
        sessionName,
        agent,
        cwd,
      });
      if (replacement.replace) {
        events =
          replacement.replacementEvents ??
          (await this.createNamedSession({
            agent,
            cwd,
            sessionName,
          }));
        if (events.length === 0) {
          this.logger?.warn?.(
            `acpx ensureSession returned no events after replacing dead session: session=${sessionName} agent=${agent} cwd=${cwd}`,
          );
        }
        ensuredEvent = findSessionIdentifierEvent(events);
      }
    }

    if (!ensuredEvent && !resumeSessionId) {
      events = await this.createNamedSession({
        agent,
        cwd,
        sessionName,
      });
      if (events.length === 0) {
        this.logger?.warn?.(
          `acpx ensureSession returned no events after sessions new: session=${sessionName} agent=${agent} cwd=${cwd}`,
        );
      }
      ensuredEvent = findSessionIdentifierEvent(events);
    }
    if (!ensuredEvent) {
      throw new AcpRuntimeError(
        "ACP_SESSION_INIT_FAILED",
        resumeSessionId
          ? `ACP session init failed: 'sessions new --resume-session' returned no session identifiers for ${sessionName}.`
          : `ACP session init failed: neither 'sessions ensure' nor 'sessions new' returned valid session identifiers for ${sessionName}.`,
      );
    }

    const acpxRecordId = ensuredEvent ? asOptionalString(ensuredEvent.acpxRecordId) : undefined;
    const agentSessionId = ensuredEvent ? asOptionalString(ensuredEvent.agentSessionId) : undefined;
    const backendSessionId = ensuredEvent
      ? asOptionalString(ensuredEvent.acpxSessionId)
      : undefined;
    const sessionModel = asTrimmedString(input.model) || undefined;
    const sessionReadOnly = input.readOnly === true;
    const sessionMountBaselineRoot = asTrimmedString(input.mountBaselineRoot) || undefined;

    return {
      sessionKey: input.sessionKey,
      backend: ACPX_BACKEND_ID,
      runtimeSessionName: encodeAcpxRuntimeHandleState({
        name: sessionName,
        agent,
        cwd,
        mode,
        ...(acpxRecordId ? { acpxRecordId } : {}),
        ...(backendSessionId ? { backendSessionId } : {}),
        ...(agentSessionId ? { agentSessionId } : {}),
        ...(sessionModel ? { model: sessionModel } : {}),
        ...(sessionReadOnly ? { readOnly: true } : {}),
        ...(sessionMountBaselineRoot ? { mountBaselineRoot: sessionMountBaselineRoot } : {}),
      }),
      cwd,
      ...(acpxRecordId ? { acpxRecordId } : {}),
      ...(backendSessionId ? { backendSessionId } : {}),
      ...(agentSessionId ? { agentSessionId } : {}),
    };
  }

  async *runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent> {
    const state = this.resolveHandleState(input.handle);
    const turnModel = asTrimmedString(input.model) || state.model || undefined;
    // Per-turn readOnly override wins over session-level state; otherwise fall
    // back to the session's persisted readOnly flag (captured at ensureSession).
    const turnReadOnly =
      input.readOnly !== undefined ? input.readOnly : state.readOnly;

    // PTY path: engaged whenever the session carries a mount baseline. The
    // baseline is what makes the mount-scoped permission policy meaningful —
    // without it every prompt would surface with reason `no-baseline` anyway,
    // so there is nothing to gain from paying the pty cost. Non-mounted
    // sessions keep the existing pipe path unchanged.
    if (state.mountBaselineRoot) {
      yield* this.runTurnOverPty({
        state,
        input,
        turnModel,
        turnReadOnly,
      });
      return;
    }

    const args = await this.buildPromptArgs({
      agent: state.agent,
      sessionName: state.name,
      cwd: state.cwd,
      model: turnModel,
      ...(turnReadOnly ? { readOnly: true } : {}),
    });

    const cancelOnAbort = async () => {
      await this.cancel({
        handle: input.handle,
        reason: "abort-signal",
      }).catch((err) => {
        this.logger?.warn?.(`acpx runtime abort-cancel failed: ${String(err)}`);
      });
    };
    const onAbort = () => {
      void cancelOnAbort();
    };

    if (input.signal?.aborted) {
      await cancelOnAbort();
      return;
    }
    if (input.signal) {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
    const child = spawnWithResolvedCommand(
      {
        command: this.config.command,
        args,
        cwd: state.cwd,
        stripProviderAuthEnvVars: this.config.stripProviderAuthEnvVars,
      },
      this.spawnCommandOptions,
    );
    child.stdin.on("error", () => {
      // Ignore EPIPE when the child exits before stdin flush completes.
    });

    if (input.attachments && input.attachments.length > 0) {
      const blocks: unknown[] = [];
      if (input.text) {
        blocks.push({ type: "text", text: input.text });
      }
      for (const attachment of input.attachments) {
        if (attachment.mediaType.startsWith("image/")) {
          blocks.push({ type: "image", mimeType: attachment.mediaType, data: attachment.data });
        }
      }
      child.stdin.end(blocks.length > 0 ? JSON.stringify(blocks) : input.text);
    } else {
      child.stdin.end(input.text);
    }

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    let sawDone = false;
    let sawError = false;
    const lines = createInterface({ input: child.stdout });
    try {
      for await (const line of lines) {
        const parsed = parsePromptEventLine(line);
        if (!parsed) {
          continue;
        }
        if (parsed.type === "done") {
          if (sawDone) {
            continue;
          }
          sawDone = true;
        }
        if (parsed.type === "error") {
          sawError = true;
        }
        yield parsed;
      }

      const exit = await waitForExit(child);
      if (exit.error) {
        const spawnFailure = resolveSpawnFailure(exit.error, state.cwd);
        if (spawnFailure === "missing-command") {
          this.healthy = false;
          throw new AcpRuntimeError(
            "ACP_BACKEND_UNAVAILABLE",
            `acpx command not found: ${this.config.command}`,
            { cause: exit.error },
          );
        }
        if (spawnFailure === "missing-cwd") {
          throw new AcpRuntimeError(
            "ACP_TURN_FAILED",
            `ACP runtime working directory does not exist: ${state.cwd}`,
            { cause: exit.error },
          );
        }
        throw new AcpRuntimeError("ACP_TURN_FAILED", exit.error.message, { cause: exit.error });
      }

      const exitedWithFailure = didAcpxProcessExitWithFailure({
        exitCode: exit.code,
        signal: exit.signal,
      });
      if (exitedWithFailure && !sawError) {
        yield {
          type: "error",
          message: formatAcpxExitMessage({
            stderr,
            exitCode: exit.code,
            signal: exit.signal,
          }),
        };
        return;
      }

      if (!sawDone && !sawError) {
        yield { type: "done" };
      }
    } finally {
      lines.close();
      if (input.signal) {
        input.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  /**
   * PTY-based runTurn. Used whenever the session's mount baseline is set so
   * we can host acpx's interactive `[permission] Allow ...? (y/N)` prompts
   * and auto-answer or surface them according to the mount-scoped policy.
   *
   * Shape:
   *   1. Compose the prompt text the same way the pipe path does (text +
   *      optional JSON blocks for attachments) and stage it in a private
   *      tempfile. acpx rejects stdin prompts under a TTY (cli.js:599), so
   *      `--file <path>` is the only viable input channel here.
   *   2. Spawn acpx under node-pty and wire a single merged data handler
   *      that:
   *        - line-buffers NDJSON events for parsePromptEventLine and
   *          pushes them onto an internal queue consumed by this generator,
   *        - feeds raw chunks to AcpxPermissionPromptMatcher so prompt
   *          tails are identified even when they straddle chunk boundaries,
   *        - resolves each match through decideAcpxPermission and either
   *          writes y\n / n\n back into the pty master, or emits a
   *          permission_request event and parks the prompt for
   *          respondToPermission to resolve.
   *   3. On child exit, drain the queue, emit a trailing `done` or `error`
   *      event if the child produced neither, and clean up the tempfile
   *      plus pending bookkeeping in `finally`.
   */
  private async *runTurnOverPty(params: {
    state: AcpxHandleState;
    input: AcpRuntimeTurnInput;
    turnModel: string | undefined;
    turnReadOnly: boolean | undefined;
  }): AsyncIterable<AcpRuntimeEvent> {
    const { state, input, turnModel, turnReadOnly } = params;
    const baseline: AcpxPermissionBaseline | undefined = state.mountBaselineRoot
      ? {
          root: state.mountBaselineRoot,
          // A per-turn readOnly override wins; otherwise the session-level
          // flag captured at ensureSession drives writability. Mirrors how
          // `turnReadOnly` is resolved above.
          writable: !(turnReadOnly === true),
        }
      : undefined;

    // Compose prompt text identical to the pipe path so acpx sees byte-for-byte
    // the same payload regardless of delivery channel.
    let promptText = input.text;
    if (input.attachments && input.attachments.length > 0) {
      const blocks: unknown[] = [];
      if (input.text) {
        blocks.push({ type: "text", text: input.text });
      }
      for (const attachment of input.attachments) {
        if (attachment.mediaType.startsWith("image/")) {
          blocks.push({
            type: "image",
            mimeType: attachment.mediaType,
            data: attachment.data,
          });
        }
      }
      if (blocks.length > 0) {
        promptText = JSON.stringify(blocks);
      }
    }

    const tempFile = await writePromptToTempFile(promptText);
    let child: PtyProcessHandle | undefined;
    let disposeData: (() => void) | undefined;
    let disposeExit: (() => void) | undefined;
    let registered = false;

    try {
      const args = await this.buildPromptArgs({
        agent: state.agent,
        sessionName: state.name,
        cwd: state.cwd,
        model: turnModel,
        promptFilePath: tempFile.path,
        // Intentionally omit readOnly in the pty path: enforcement happens
        // via the permission policy surfacing write prompts rather than
        // passing --deny-all to acpx. See buildPromptArgs jsdoc for why.
      });

      if (input.signal?.aborted) {
        await this.cancel({ handle: input.handle, reason: "abort-signal" }).catch(() => {});
        return;
      }

      child = await spawnAcpxUnderPty(
        {
          command: this.config.command,
          args,
          cwd: state.cwd,
        },
        this.spawnCommandOptions,
      );

      const pending: AcpxPtyPendingSession = {
        write: (data) => child!.write(data),
        pending: new Map(),
      };
      this.ptyPendingSessions.set(state.name, pending);
      registered = true;

      // Event queue wiring. `queue` holds everything the generator will yield;
      // `__exit` and `__err` sentinels let the data handler push terminal
      // conditions without racing the async loop. `waiters` holds a single
      // pending pull() so we only ever wake once per push.
      type QueueItem =
        | { kind: "event"; event: AcpRuntimeEvent }
        | { kind: "exit"; exitCode: number; signal?: number }
        | { kind: "error"; error: Error };
      const queue: QueueItem[] = [];
      let waiter: (() => void) | undefined;
      const push = (item: QueueItem): void => {
        queue.push(item);
        if (waiter) {
          const w = waiter;
          waiter = undefined;
          w();
        }
      };
      const pull = (): Promise<void> =>
        new Promise<void>((resolve) => {
          if (queue.length > 0) {
            resolve();
            return;
          }
          waiter = resolve;
        });

      const demuxState = createAcpxPtyDemuxState();
      let requestSeq = 0;

      disposeData = child.onData((chunk) => {
        const actions = processAcpxPtyChunk({ chunk, state: demuxState, baseline });
        for (const action of actions) {
          if (action.kind === "event") {
            push({ kind: "event", event: action.event });
            continue;
          }
          if (action.kind === "auto-reply") {
            this.logger?.debug?.(
              `acpx pty auto-${action.reply === "allow" ? "approve" : "deny"}: title=${action.match.title} reason=${action.reason}`,
            );
            child!.write(formatPermissionReply(action.reply));
            continue;
          }
          // Surface: synthesize a requestId and park a resolver. The resolver
          // writes the y/n reply into the pty master when respondToPermission
          // is called, so the async generator below only observes the final
          // permission_response event shape through subsequent acpx output.
          requestSeq += 1;
          const requestId = `acpx-prompt-${requestSeq}`;
          pending.pending.set(requestId, (reply) => {
            if (reply.behavior === "allow") {
              child!.write(formatPermissionReply("allow"));
            } else {
              child!.write(formatPermissionReply("deny"));
            }
          });
          const options: AcpPermissionOption[] = [
            { optionId: "allow_once", label: "Allow", kind: "allow_once" },
            { optionId: "deny", label: "Deny", kind: "deny" },
          ];
          push({
            kind: "event",
            event: {
              type: "permission_request",
              requestId,
              toolName: action.match.kind ?? "acpx",
              title: action.match.title,
              reason: action.reason,
              options,
            },
          });
        }
      });

      disposeExit = child.onExit(({ exitCode, signal }) => {
        push({ kind: "exit", exitCode, signal });
      });

      const onAbort = () => {
        void this.cancel({ handle: input.handle, reason: "abort-signal" }).catch((err) => {
          this.logger?.warn?.(`acpx pty abort-cancel failed: ${String(err)}`);
        });
        child?.kill();
      };
      if (input.signal) {
        input.signal.addEventListener("abort", onAbort, { once: true });
      }

      let sawDone = false;
      let sawError = false;
      try {
        while (true) {
          if (queue.length === 0) {
            await pull();
          }
          const item = queue.shift();
          if (!item) {
            continue;
          }
          if (item.kind === "error") {
            throw item.error;
          }
          if (item.kind === "exit") {
            const exitCode = item.exitCode;
            const exitedWithFailure = didAcpxProcessExitWithFailure({
              exitCode,
              signal: null,
            });
            if (exitedWithFailure && !sawError) {
              yield {
                type: "error",
                message: `acpx (pty) exited with code ${exitCode}`,
              };
              return;
            }
            if (!sawDone && !sawError) {
              yield { type: "done" };
            }
            return;
          }
          const ev = item.event;
          if (ev.type === "done") {
            if (sawDone) {
              continue;
            }
            sawDone = true;
          }
          if (ev.type === "error") {
            sawError = true;
          }
          yield ev;
        }
      } finally {
        if (input.signal) {
          input.signal.removeEventListener("abort", onAbort);
        }
      }
    } finally {
      disposeData?.();
      disposeExit?.();
      if (registered) {
        this.ptyPendingSessions.delete(state.name);
      }
      try {
        child?.kill();
      } catch {
        // kill races are expected when the child has already exited.
      }
      await tempFile.cleanup().catch((err) => {
        this.logger?.warn?.(`acpx pty tempfile cleanup failed: ${String(err)}`);
      });
    }
  }

  /**
   * Deliver a user decision from the UI back into a parked acpx interactive
   * prompt. The pty runner synthesized the `requestId` when it surfaced the
   * prompt and registered a resolver closure under {@link ptyPendingSessions};
   * this method looks that resolver up by session name and hands it the
   * decision, which translates into a `y\n`/`n\n` write on the pty master.
   *
   * No-ops (with a warn) when the session is unknown or the requestId was
   * never surfaced — keeps the control plane forgiving in the face of
   * reconnects and late clicks.
   */
  async respondToPermission(input: {
    handle: AcpRuntimeHandle;
    requestId: string;
    decision: AcpPermissionDecision;
  }): Promise<void> {
    const state = this.resolveHandleState(input.handle);
    const session = this.ptyPendingSessions.get(state.name);
    if (!session) {
      this.logger?.warn?.(
        `acpx respondToPermission: no pty session for ${state.name} (requestId=${input.requestId})`,
      );
      return;
    }
    const resolver = session.pending.get(input.requestId);
    if (!resolver) {
      this.logger?.warn?.(
        `acpx respondToPermission: unknown requestId ${input.requestId} on session ${state.name}`,
      );
      return;
    }
    session.pending.delete(input.requestId);
    resolver(input.decision);
  }

  getCapabilities(): AcpRuntimeCapabilities {
    return ACPX_CAPABILITIES;
  }

  async getStatus(input: {
    handle: AcpRuntimeHandle;
    signal?: AbortSignal;
  }): Promise<AcpRuntimeStatus> {
    const state = this.resolveHandleState(input.handle);
    const args = await this.buildVerbArgs({
      agent: state.agent,
      cwd: state.cwd,
      command: ["status", "--session", state.name],
    });
    const events = await this.runControlCommand({
      args,
      cwd: state.cwd,
      fallbackCode: "ACP_TURN_FAILED",
      ignoreNoSession: true,
      signal: input.signal,
    });
    const detail = events.find((event) => !toAcpxErrorEvent(event)) ?? events[0];
    if (!detail) {
      return {
        summary: "acpx status unavailable",
      };
    }
    const status = asTrimmedString(detail.status) || "unknown";
    const acpxRecordId = asOptionalString(detail.acpxRecordId);
    const acpxSessionId = asOptionalString(detail.acpxSessionId);
    const agentSessionId = asOptionalString(detail.agentSessionId);
    const pid = typeof detail.pid === "number" && Number.isFinite(detail.pid) ? detail.pid : null;
    const summary = [
      `status=${status}`,
      acpxRecordId ? `acpxRecordId=${acpxRecordId}` : null,
      acpxSessionId ? `acpxSessionId=${acpxSessionId}` : null,
      pid != null ? `pid=${pid}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      summary,
      ...(acpxRecordId ? { acpxRecordId } : {}),
      ...(acpxSessionId ? { backendSessionId: acpxSessionId } : {}),
      ...(agentSessionId ? { agentSessionId } : {}),
      details: detail,
    };
  }

  async setMode(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void> {
    const state = this.resolveHandleState(input.handle);
    const mode = asTrimmedString(input.mode);
    if (!mode) {
      throw new AcpRuntimeError("ACP_TURN_FAILED", "ACP runtime mode is required.");
    }
    const args = await this.buildVerbArgs({
      agent: state.agent,
      cwd: state.cwd,
      command: ["set-mode", mode, "--session", state.name],
    });
    await this.runControlCommand({
      args,
      cwd: state.cwd,
      fallbackCode: "ACP_TURN_FAILED",
    });
  }

  async setConfigOption(input: {
    handle: AcpRuntimeHandle;
    key: string;
    value: string;
  }): Promise<void> {
    const state = this.resolveHandleState(input.handle);
    const key = asTrimmedString(input.key);
    const value = asTrimmedString(input.value);
    if (!key || !value) {
      throw new AcpRuntimeError("ACP_TURN_FAILED", "ACP config option key/value are required.");
    }
    const args = await this.buildVerbArgs({
      agent: state.agent,
      cwd: state.cwd,
      command: ["set", key, value, "--session", state.name],
    });
    await this.runControlCommand({
      args,
      cwd: state.cwd,
      fallbackCode: "ACP_TURN_FAILED",
    });
  }

  async doctor(): Promise<AcpRuntimeDoctorReport> {
    const result = await this.checkHealth();
    if (!result.ok && result.failure.kind === "version-check") {
      const { versionCheck } = result.failure;
      this.healthy = false;
      const details = [
        versionCheck.expectedVersion ? `expected=${versionCheck.expectedVersion}` : null,
        versionCheck.installedVersion ? `installed=${versionCheck.installedVersion}` : null,
      ].filter((detail): detail is string => Boolean(detail));
      return {
        ok: false,
        code: "ACP_BACKEND_UNAVAILABLE",
        message: versionCheck.message,
        installCommand: versionCheck.installCommand,
        details,
      };
    }

    if (!result.ok && result.failure.kind === "help-check") {
      const { result: helpResult } = result.failure;
      this.healthy = false;
      if (helpResult.error) {
        const spawnFailure = resolveSpawnFailure(helpResult.error, this.config.cwd);
        if (spawnFailure === "missing-command") {
          return {
            ok: false,
            code: "ACP_BACKEND_UNAVAILABLE",
            message: `acpx command not found: ${this.config.command}`,
            installCommand: this.config.installCommand,
          };
        }
        if (spawnFailure === "missing-cwd") {
          return {
            ok: false,
            code: "ACP_BACKEND_UNAVAILABLE",
            message: `ACP runtime working directory does not exist: ${this.config.cwd}`,
          };
        }
        return {
          ok: false,
          code: "ACP_BACKEND_UNAVAILABLE",
          message: helpResult.error.message,
          details: [String(helpResult.error)],
        };
      }
      return {
        ok: false,
        code: "ACP_BACKEND_UNAVAILABLE",
        message:
          helpResult.stderr.trim() || `acpx exited with code ${helpResult.code ?? "unknown"}`,
      };
    }

    if (!result.ok) {
      this.healthy = false;
      const failure = result.failure;
      return {
        ok: false,
        code: "ACP_BACKEND_UNAVAILABLE",
        message:
          failure.kind === "exception"
            ? failure.error instanceof Error
              ? failure.error.message
              : String(failure.error)
            : "acpx backend unavailable",
      };
    }

    this.healthy = true;
    const agentReports = await this.probeKnownAgents();
    return {
      ok: true,
      message: `acpx command available (${this.config.command}, version ${result.versionCheck.version}${this.config.expectedVersion ? `, expected ${this.config.expectedVersion}` : ""})`,
      ...(agentReports.length > 0 ? { agentReports } : {}),
    };
  }

  /**
   * Probe each OpenClaw-visible agent alias for upstream health (for example
   * whether `claude-code` has an installed CLI and a populated `~/.claude`
   * subscription directory). Runs after the base acpx check; failures are
   * surfaced via AcpRuntimeDoctorReport.agentReports without forcing the
   * top-level doctor report to fail — callers decide how to render per-agent
   * warnings alongside the healthy backend state.
   */
  private async probeKnownAgents(): Promise<AcpRuntimeAgentDoctorReport[]> {
    const reports: AcpRuntimeAgentDoctorReport[] = [];
    for (const openclawAgent of Object.keys(ACPX_AGENT_ALIASES)) {
      if (openclawAgent === "claude-code") {
        reports.push(await this.probeClaudeCodeAgent());
      }
    }
    return reports;
  }

  private async probeClaudeCodeAgent(): Promise<AcpRuntimeAgentDoctorReport> {
    const details: string[] = [];
    const claudeHome = pathJoin(homedir(), ".claude");
    let claudeHomeOk = false;
    try {
      await fsAccess(claudeHome);
      claudeHomeOk = true;
      details.push(`subscriptionDir=${claudeHome}`);
    } catch {
      details.push(`subscriptionDir=${claudeHome} (missing)`);
    }

    // Verify the CLI is resolvable by invoking `claude-code --version` via the
    // same spawn path the runtime would use. We don't hard-fail if this is
    // missing (users may be on a shared container image where the CLI is
    // installed globally by the Dockerfile layer); the details string gives
    // operators enough signal to diagnose themselves.
    const versionResult = await spawnAndCollect(
      {
        command: "claude-code",
        args: ["--version"],
        cwd: this.config.cwd,
      },
      this.spawnCommandOptions,
    ).catch((error) => ({
      code: null,
      signal: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error : new Error(String(error)),
    }));
    const cliOk =
      !versionResult.error &&
      (versionResult.code === 0 || versionResult.code === null) &&
      !!versionResult.stdout.trim();
    if (cliOk) {
      details.push(`cliVersion=${versionResult.stdout.trim()}`);
    } else if (versionResult.error) {
      details.push(`cliError=${versionResult.error.message}`);
    } else {
      details.push(
        `cliExit=${versionResult.code ?? "unknown"} stderr=${versionResult.stderr.trim() || "(empty)"}`,
      );
    }

    const ok = cliOk && claudeHomeOk;
    if (ok) {
      return {
        agent: "claude-code",
        ok: true,
        message: "claude-code CLI and subscription auth look healthy",
        details,
      };
    }
    const missing: string[] = [];
    if (!cliOk) {
      missing.push("claude-code CLI not runnable");
    }
    if (!claudeHomeOk) {
      missing.push(`${claudeHome} missing`);
    }
    return {
      agent: "claude-code",
      ok: false,
      code: "ACP_AGENT_UNAVAILABLE",
      message: `claude-code probe failed: ${missing.join("; ")}`,
      installCommand:
        "npm install -g @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp",
      details,
    };
  }

  async cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void> {
    const state = this.resolveHandleState(input.handle);
    const args = await this.buildVerbArgs({
      agent: state.agent,
      cwd: state.cwd,
      command: ["cancel", "--session", state.name],
    });
    await this.runControlCommand({
      args,
      cwd: state.cwd,
      fallbackCode: "ACP_TURN_FAILED",
      ignoreNoSession: true,
    });
  }

  async close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void> {
    const state = this.resolveHandleState(input.handle);
    const args = await this.buildVerbArgs({
      agent: state.agent,
      cwd: state.cwd,
      command: ["sessions", "close", state.name],
    });
    await this.runControlCommand({
      args,
      cwd: state.cwd,
      fallbackCode: "ACP_TURN_FAILED",
      ignoreNoSession: true,
    });
  }

  private resolveHandleState(handle: AcpRuntimeHandle): AcpxHandleState {
    const decoded = decodeAcpxRuntimeHandleState(handle.runtimeSessionName);
    if (decoded) {
      return decoded;
    }

    const legacyName = asTrimmedString(handle.runtimeSessionName);
    if (!legacyName) {
      throw new AcpRuntimeError(
        "ACP_SESSION_INIT_FAILED",
        "Invalid acpx runtime handle: runtimeSessionName is missing.",
      );
    }

    return {
      name: legacyName,
      agent: deriveAgentFromSessionKey(handle.sessionKey, DEFAULT_AGENT_FALLBACK),
      cwd: this.config.cwd,
      mode: "persistent",
    };
  }

  private async buildPromptArgs(params: {
    agent: string;
    sessionName: string;
    cwd: string;
    model?: string;
    readOnly?: boolean;
    /**
     * Absolute path to a tempfile containing the composed prompt text. When
     * set, buildPromptArgs emits `--file <path>` instead of the default
     * `--file -` (stdin pipe). Required for the pty path because acpx rejects
     * stdin prompts when stdin is a TTY (cli.js:599, `InvalidArgumentError`).
     */
    promptFilePath?: string;
  }): Promise<string[]> {
    // Legacy pipe path: when readOnly is set we override the configured
    // permission mode with `--deny-all` so acpx refuses write-adjacent tools.
    // The pty path does NOT use this branch — it layers its own permission
    // policy on top of acpx's interactive y/N prompts (see runTurnOverPty)
    // and intentionally leaves the configured permissionMode in place so read
    // tools are still auto-approved while writes round-trip through the
    // policy engine. The kernel EROFS backstop from a read-only SSHFS mount
    // remains the final line of defense in both paths.
    const permissionArgs = params.readOnly
      ? ["--deny-all"]
      : buildPermissionArgs(this.config.permissionMode);
    const prefix = [
      "--format",
      "json",
      "--json-strict",
      "--cwd",
      params.cwd,
      ...permissionArgs,
      "--non-interactive-permissions",
      this.config.nonInteractivePermissions,
    ];
    if (this.config.timeoutSeconds) {
      prefix.push("--timeout", String(this.config.timeoutSeconds));
    }
    prefix.push("--ttl", String(this.queueOwnerTtlSeconds));
    // Per-turn model override. Mid-conversation switching forwards the
    // caller-supplied `--model <id>` on each prompt; acpx passes this down to
    // the underlying ACP adapter (claude-agent-acp, codex-acp, etc.), which
    // selects the model for that turn only. Omitted when unset so the backend
    // uses its configured default.
    if (params.model) {
      prefix.push("--model", params.model);
    }
    const fileArg = params.promptFilePath ?? "-";
    return await this.buildVerbArgs({
      agent: params.agent,
      cwd: params.cwd,
      command: ["prompt", "--session", params.sessionName, "--file", fileArg],
      prefix,
    });
  }

  private async buildVerbArgs(params: {
    agent: string;
    cwd: string;
    command: string[];
    prefix?: string[];
  }): Promise<string[]> {
    const prefix = params.prefix ?? ["--format", "json", "--json-strict", "--cwd", params.cwd];
    const acpxAgent = toAcpxAgentName(params.agent);
    const agentCommand = await this.resolveRawAgentCommand({
      agent: acpxAgent,
      cwd: params.cwd,
    });
    if (!agentCommand) {
      return [...prefix, acpxAgent, ...params.command];
    }
    return [...prefix, "--agent", agentCommand, ...params.command];
  }

  private async resolveRawAgentCommand(params: {
    agent: string;
    cwd: string;
  }): Promise<string | null> {
    if (Object.keys(this.config.mcpServers).length === 0) {
      return null;
    }
    const cacheKey = `${params.cwd}::${params.agent}`;
    const cached = this.mcpProxyAgentCommandCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const targetCommand = await resolveAcpxAgentCommand({
      acpxCommand: this.config.command,
      cwd: params.cwd,
      agent: params.agent,
      stripProviderAuthEnvVars: this.config.stripProviderAuthEnvVars,
      spawnOptions: this.spawnCommandOptions,
    });
    if (!targetCommand) {
      return null;
    }
    const resolved = buildMcpProxyAgentCommand({
      targetCommand,
      mcpServers: toAcpMcpServers(this.config.mcpServers),
    });
    this.mcpProxyAgentCommandCache.set(cacheKey, resolved);
    return resolved;
  }

  private async runControlCommand(params: {
    args: string[];
    cwd: string;
    fallbackCode: AcpRuntimeErrorCode;
    ignoreNoSession?: boolean;
    signal?: AbortSignal;
  }): Promise<AcpxJsonObject[]> {
    const result = await spawnAndCollect(
      {
        command: this.config.command,
        args: params.args,
        cwd: params.cwd,
        stripProviderAuthEnvVars: this.config.stripProviderAuthEnvVars,
      },
      this.spawnCommandOptions,
      {
        signal: params.signal,
      },
    );

    if (result.error) {
      const spawnFailure = resolveSpawnFailure(result.error, params.cwd);
      if (spawnFailure === "missing-command") {
        this.healthy = false;
        throw new AcpRuntimeError(
          "ACP_BACKEND_UNAVAILABLE",
          `acpx command not found: ${this.config.command}`,
          { cause: result.error },
        );
      }
      if (spawnFailure === "missing-cwd") {
        throw new AcpRuntimeError(
          params.fallbackCode,
          `ACP runtime working directory does not exist: ${params.cwd}`,
          { cause: result.error },
        );
      }
      throw new AcpRuntimeError(params.fallbackCode, result.error.message, { cause: result.error });
    }

    const events = parseJsonLines(result.stdout);
    const errorEvent =
      events
        .map((event) => toAcpxErrorEvent(event) ?? parseControlJsonError(event))
        .find(Boolean) ?? null;
    if (errorEvent) {
      if (params.ignoreNoSession && errorEvent.code === "NO_SESSION") {
        return events;
      }
      throw new AcpRuntimeError(
        params.fallbackCode,
        formatAcpxControlErrorMessage({
          code: errorEvent.code,
          message: errorEvent.message,
          stderr: result.stderr,
        }),
      );
    }

    if (
      didAcpxProcessExitWithFailure({
        exitCode: result.code,
        signal: result.signal,
      })
    ) {
      throw new AcpRuntimeError(
        params.fallbackCode,
        formatAcpxExitMessage({
          stderr: result.stderr,
          exitCode: result.code,
          signal: result.signal,
        }),
      );
    }
    return events;
  }
}
