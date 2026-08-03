import {
  DEFAULT_MODEL_APPROVAL_TIMEOUT_MS,
  type ModelApprovalDecision,
  type ModelApprovalRequestPayload,
} from "../infra/model-approvals.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { callGatewayTool } from "./tools/gateway.js";

const log = createSubsystemLogger("model-approval");

// Margin added to the gateway call timeout so the server-side approval
// timeout (which resolves the request with `decision: null`) fires first.
const GATEWAY_CALL_TIMEOUT_MARGIN_MS = 10_000;

function parseSwitchTo(value: unknown): { provider: string; model: string } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const provider = (value as { provider?: unknown }).provider;
  const model = (value as { model?: unknown }).model;
  if (typeof provider !== "string" || typeof model !== "string") {
    return undefined;
  }
  const trimmedProvider = provider.trim();
  const trimmedModel = model.trim();
  if (!trimmedProvider || !trimmedModel) {
    return undefined;
  }
  return { provider: trimmedProvider, model: trimmedModel };
}

function parseDecision(value: unknown): ModelApprovalDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const decision = (value as { decision?: unknown }).decision;
  if (!decision || typeof decision !== "object") {
    return null;
  }
  const kind = (decision as { kind?: unknown }).kind;
  if (kind !== "approve" && kind !== "deny") {
    return null;
  }
  const dontAskAgain = (decision as { dontAskAgain?: unknown }).dontAskAgain === true;
  const switchTo = parseSwitchTo((decision as { switchTo?: unknown }).switchTo);
  return {
    kind,
    ...(dontAskAgain ? { dontAskAgain: true } : {}),
    ...(switchTo ? { switchTo } : {}),
  };
}

/**
 * Ask the gateway for a metered-model approval decision. Single-phase:
 * `model.approval.request` blocks until the user decides, the approval times
 * out, or there is no approvals-capable client (no-route). Returns null for
 * timeout/no-route/deny-equivalent outcomes — callers treat null as skip.
 *
 * Errors are swallowed to null (with a log line): a broken approval channel
 * must degrade to "unapproved" rather than aborting the model fallback loop.
 */
export async function requestModelApprovalDecision(
  params: ModelApprovalRequestPayload,
): Promise<ModelApprovalDecision | null> {
  const approvalTimeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? params.timeoutMs
      : DEFAULT_MODEL_APPROVAL_TIMEOUT_MS;
  try {
    const result = await callGatewayTool<{ decision?: unknown }>(
      "model.approval.request",
      { timeoutMs: approvalTimeoutMs + GATEWAY_CALL_TIMEOUT_MARGIN_MS },
      { ...params, timeoutMs: approvalTimeoutMs },
    );
    return parseDecision(result);
  } catch (err) {
    const message = String(err);
    if (!message.toLowerCase().includes("expired or not found")) {
      log.warn(`model approval request failed; treating as unapproved: ${message}`);
    }
    return null;
  }
}
