import type { OpenClawConfig } from "../../config/config.js";
import type {
  SessionAcpIdentity,
  AcpSessionRuntimeOptions,
  SessionAcpMeta,
  SessionEntry,
} from "../../config/sessions/types.js";
import type { AcpRuntimeError } from "../runtime/errors.js";
import { requireAcpRuntimeBackend } from "../runtime/registry.js";
import {
  listAcpSessionEntries,
  readAcpSessionEntry,
  upsertAcpSessionMeta,
} from "../runtime/session-meta.js";
import type {
  AcpRuntime,
  AcpRuntimeCapabilities,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimePromptMode,
  AcpRuntimeSessionMode,
  AcpRuntimeStatus,
} from "../runtime/types.js";

export type AcpSessionResolution =
  | {
      kind: "none";
      sessionKey: string;
    }
  | {
      kind: "stale";
      sessionKey: string;
      error: AcpRuntimeError;
    }
  | {
      kind: "ready";
      sessionKey: string;
      meta: SessionAcpMeta;
    };

export type AcpInitializeSessionInput = {
  cfg: OpenClawConfig;
  sessionKey: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  resumeSessionId?: string;
  cwd?: string;
  backendId?: string;
  /** Initial per-session model override persisted in runtimeOptions.model. */
  model?: string;
  /**
   * Initial per-session read-only flag persisted in runtimeOptions.readOnly.
   * Auto-detected from SSHFS mount flags in handleAcpSpawnAction for cwds under
   * /mnt/host-projects/<name>, or set manually for other read-only workflows.
   */
  readOnly?: boolean;
  /**
   * Optional project mount root persisted in runtimeOptions.mountBaselineRoot.
   * Forms the auto-approve scope for the acpx permission policy together with
   * {@link readOnly}; usually the same `/mnt/host-projects/<name>` path that
   * produced the readOnly flag.
   */
  mountBaselineRoot?: string;
};

export type AcpTurnAttachment = {
  mediaType: string;
  data: string;
};

export type AcpRunTurnInput = {
  cfg: OpenClawConfig;
  sessionKey: string;
  text: string;
  attachments?: AcpTurnAttachment[];
  mode: AcpRuntimePromptMode;
  requestId: string;
  signal?: AbortSignal;
  onEvent?: (event: AcpRuntimeEvent) => Promise<void> | void;
  /**
   * Optional per-turn backend model override. Forwarded to the underlying
   * runtime (AcpRuntime.runTurn.model → acpx `--model <id>`) so callers can
   * switch models mid-conversation without rebuilding the session. Omit to use
   * the backend's configured default or the session's last-seen model.
   */
  model?: string;
  /**
   * Optional per-turn read-only override. Forwarded to the underlying runtime
   * (AcpRuntime.runTurn.readOnly → acpx `--deny-all`) so callers can enforce
   * read-only semantics without rebuilding the session. Omit to use the
   * session's persisted runtimeOptions.readOnly.
   */
  readOnly?: boolean;
};

export type AcpCloseSessionInput = {
  cfg: OpenClawConfig;
  sessionKey: string;
  reason: string;
  clearMeta?: boolean;
  allowBackendUnavailable?: boolean;
  requireAcpSession?: boolean;
};

export type AcpCloseSessionResult = {
  runtimeClosed: boolean;
  runtimeNotice?: string;
  metaCleared: boolean;
};

export type AcpSessionStatus = {
  sessionKey: string;
  backend: string;
  agent: string;
  identity?: SessionAcpIdentity;
  state: SessionAcpMeta["state"];
  mode: AcpRuntimeSessionMode;
  runtimeOptions: AcpSessionRuntimeOptions;
  capabilities: AcpRuntimeCapabilities;
  runtimeStatus?: AcpRuntimeStatus;
  lastActivityAt: number;
  lastError?: string;
};

export type AcpManagerObservabilitySnapshot = {
  runtimeCache: {
    activeSessions: number;
    idleTtlMs: number;
    evictedTotal: number;
    lastEvictedAt?: number;
  };
  turns: {
    active: number;
    queueDepth: number;
    completed: number;
    failed: number;
    averageLatencyMs: number;
    maxLatencyMs: number;
  };
  errorsByCode: Record<string, number>;
};

export type AcpStartupIdentityReconcileResult = {
  checked: number;
  resolved: number;
  failed: number;
};

export type ActiveTurnState = {
  runtime: AcpRuntime;
  handle: AcpRuntimeHandle;
  abortController: AbortController;
  cancelPromise?: Promise<void>;
};

export type TurnLatencyStats = {
  completed: number;
  failed: number;
  totalMs: number;
  maxMs: number;
};

export type AcpSessionManagerDeps = {
  listAcpSessions: typeof listAcpSessionEntries;
  readSessionEntry: typeof readAcpSessionEntry;
  upsertSessionMeta: typeof upsertAcpSessionMeta;
  requireRuntimeBackend: typeof requireAcpRuntimeBackend;
};

export const DEFAULT_DEPS: AcpSessionManagerDeps = {
  listAcpSessions: listAcpSessionEntries,
  readSessionEntry: readAcpSessionEntry,
  upsertSessionMeta: upsertAcpSessionMeta,
  requireRuntimeBackend: requireAcpRuntimeBackend,
};

export type { AcpSessionRuntimeOptions, SessionAcpMeta, SessionEntry };
