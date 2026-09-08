import type { ExecAsk, ExecHost, ExecSecurity, ExecTarget } from "../infra/exec-approvals.js";
import type { SafeBinProfileFixture } from "../infra/exec-safe-bin-policy.js";
import type { BashSandboxConfig } from "./bash-tools.shared.js";

export type ExecToolDefaults = {
  host?: ExecTarget;
  security?: ExecSecurity;
  ask?: ExecAsk;
  trigger?: string;
  node?: string;
  pathPrepend?: string[];
  safeBins?: string[];
  strictInlineEval?: boolean;
  /**
   * Carries `tools.exec.obfuscationPolicy` from config to the exec hosts.
   *
   * "ask" (default) keeps the fail-closed behavior: a command the obfuscation
   * heuristic flags forces an explicit approval even under security=full/
   * ask=off. "warn" keeps the detection log and the ⚠️ warning but defers to
   * the configured security/ask policy — added 2026-08-06 after two heuristic
   * hits (a var-expansion chain and chained heredocs) raised 30-minute
   * approval waits nobody was around to answer on an operator-owned install.
   *
   * The field existed on `ExecToolConfig` and was read by `createExecTool` and
   * both exec hosts, but was never declared here, so the value could not be
   * typed through `resolveExecConfig` -> defaults -> host. See
   * eb6a81a2a08 (policy) and 531d4b13ef3 (plumbing).
   */
  obfuscationPolicy?: "ask" | "warn";
  safeBinTrustedDirs?: string[];
  safeBinProfiles?: Record<string, SafeBinProfileFixture>;
  agentId?: string;
  backgroundMs?: number;
  timeoutSec?: number;
  approvalRunningNoticeMs?: number;
  sandbox?: BashSandboxConfig;
  elevated?: ExecElevatedDefaults;
  allowBackground?: boolean;
  scopeKey?: string;
  sessionKey?: string;
  messageProvider?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  accountId?: string;
  notifyOnExit?: boolean;
  notifyOnExitEmptySuccess?: boolean;
  cwd?: string;
};

export type ExecElevatedDefaults = {
  enabled: boolean;
  allowed: boolean;
  defaultLevel: "on" | "off" | "ask" | "full";
};

export type ExecToolDetails =
  | {
      status: "running";
      sessionId: string;
      pid?: number;
      startedAt: number;
      cwd?: string;
      tail?: string;
    }
  | {
      status: "completed" | "failed";
      exitCode: number | null;
      durationMs: number;
      aggregated: string;
      cwd?: string;
    }
  | {
      status: "approval-pending";
      approvalId: string;
      approvalSlug: string;
      expiresAtMs: number;
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
      warningText?: string;
    }
  | {
      status: "approval-unavailable";
      reason:
        | "initiating-platform-disabled"
        | "initiating-platform-unsupported"
        | "no-approval-route";
      channelLabel?: string;
      sentApproverDms?: boolean;
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
      warningText?: string;
    };
