/**
 * Metered-model approval gate: shared wire types between the gateway RPC
 * surface (`model.approval.*`) and the host-side request client used by the
 * model fallback loop. Mirrors the exec/plugin approval pattern in
 * `./exec-approvals.ts` / `./plugin-approvals.ts`.
 */

export type ModelApprovalReasonKind = "primary" | "fallback";

export type ModelApprovalRequestPayload = {
  provider: string;
  model: string;
  reasonKind: ModelApprovalReasonKind;
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  timeoutMs?: number;
};

/**
 * Decision returned to the waiting gate. `switchTo` is the replacement model
 * the user chose from the UI; it is dialed instead of the requested candidate
 * and is NOT re-gated (the UI already confirmed it).
 */
export type ModelApprovalDecision = {
  kind: "approve" | "deny";
  dontAskAgain?: boolean;
  switchTo?: { provider: string; model: string };
};

export const DEFAULT_MODEL_APPROVAL_TIMEOUT_MS = 180_000;
export const MAX_MODEL_APPROVAL_TIMEOUT_MS = 600_000;
