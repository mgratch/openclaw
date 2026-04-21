import type { ResolvedAcpxPluginConfig } from "../config.js";

export type AcpxHandleState = {
  name: string;
  agent: string;
  cwd: string;
  mode: "persistent" | "oneshot";
  acpxRecordId?: string;
  backendSessionId?: string;
  agentSessionId?: string;
  /**
   * Backend-specific model id last used for this session. Persisted in the
   * opaque runtimeSessionName so a reconnected runtime can forward the same
   * `--model` to acpx across process restarts. Per-turn `model` on
   * `AcpRuntimeTurnInput` takes precedence over this when present.
   */
  model?: string;
  /**
   * When true, the session's mount baseline is read-only: writes inside the
   * baseline require user approval via the pty permission policy. Persisted
   * in the opaque runtimeSessionName so a reconnected runtime still applies
   * the same policy after a process restart. Per-turn `readOnly` on
   * `AcpRuntimeTurnInput` takes precedence when present.
   */
  readOnly?: boolean;
  /**
   * Absolute mount root for the session's auto-approve scope. Tool calls
   * with target paths inside this root are auto-approved by the pty
   * permission policy (reads always; writes when !readOnly); anything
   * outside is surfaced as an approval card. Persisted in runtimeSessionName
   * alongside {@link readOnly} so the scope survives process restarts.
   */
  mountBaselineRoot?: string;
};

export type AcpxJsonObject = Record<string, unknown>;

export type AcpxErrorEvent = {
  message: string;
  code?: string;
  retryable?: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asOptionalString(value: unknown): string | undefined {
  const text = asTrimmedString(value);
  return text || undefined;
}

export function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function deriveAgentFromSessionKey(sessionKey: string, fallbackAgent: string): string {
  const match = sessionKey.match(/^agent:([^:]+):/i);
  const candidate = match?.[1] ? asTrimmedString(match[1]) : "";
  return candidate || fallbackAgent;
}

export function buildPermissionArgs(mode: ResolvedAcpxPluginConfig["permissionMode"]): string[] {
  if (mode === "approve-all") {
    return ["--approve-all"];
  }
  if (mode === "deny-all") {
    return ["--deny-all"];
  }
  return ["--approve-reads"];
}
