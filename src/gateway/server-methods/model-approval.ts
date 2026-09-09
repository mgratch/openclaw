import { randomUUID } from "node:crypto";
import { resolveAcpModelPreset } from "../../acp/presets.js";
import { loadConfig } from "../../config/config.js";
import { mergeSessionEntryPreserveActivity, updateSessionStore } from "../../config/sessions.js";
import {
  DEFAULT_MODEL_APPROVAL_TIMEOUT_MS,
  MAX_MODEL_APPROVAL_TIMEOUT_MS,
  type ModelApprovalDecision,
  type ModelApprovalReasonKind,
  type ModelApprovalRequestPayload,
} from "../../infra/model-approvals.js";
import type { ModelApprovalManager } from "../model-approval-manager.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelApprovalRequestParams,
  validateModelApprovalResolveParams,
} from "../protocol/index.js";
import { resolveGatewaySessionStoreTarget } from "../session-utils.js";
import type { GatewayRequestHandlers } from "./types.js";

const APPROVAL_NOT_FOUND_DETAILS = {
  reason: ErrorCodes.APPROVAL_NOT_FOUND,
} as const;

type ParsedSwitchTo =
  | { ok: true; value: { provider: string; model: string } | undefined }
  | { ok: false };

/**
 * Parse the resolve-side `switchTo`.
 *
 * Accepts either a "provider/model" ref or an ACP preset id (e.g.
 * "claude-code-opus"). The UI model picker lists presets alongside plain refs
 * and sends the raw catalog id; preset ids carry no slash, so before this they
 * failed validation, the UI restored the card, and the prompt silently
 * reappeared — which is exactly the case a user hits when picking a
 * subscription-backed model to avoid the charge. Presets resolve to their
 * pinned model the same way bare preset rungs resolve in model-fallback.ts.
 */
function parseSwitchTo(raw: string | undefined): ParsedSwitchTo {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  const trimmed = raw.trim();
  if (!trimmed.includes("/")) {
    // A preset with no pinned model ("claude-code" = agent default) has no
    // concrete model to dial, so it stays a hard error rather than a silent
    // no-op that would re-prompt.
    const preset = resolveAcpModelPreset(trimmed);
    return preset?.acpxModel
      ? { ok: true, value: { provider: "anthropic", model: preset.acpxModel } }
      : { ok: false };
  }
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    return { ok: false };
  }
  const provider = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  if (!provider || !model) {
    return { ok: false };
  }
  return { ok: true, value: { provider, model } };
}

/**
 * Persist the per-session "don't ask again for metered models" flag using the
 * same session-target resolution `sessions.patch` uses. Preserve-activity
 * merge keeps `updatedAt` untouched so approvals do not reorder session lists.
 */
async function persistMeteredAutoApprove(sessionKey: string): Promise<void> {
  const cfg = loadConfig();
  const target = resolveGatewaySessionStoreTarget({ cfg, key: sessionKey });
  await updateSessionStore(target.storePath, (store) => {
    const key = target.canonicalKey;
    const existing = store[key];
    if (!existing) {
      return;
    }
    store[key] = mergeSessionEntryPreserveActivity(existing, { meteredAutoApprove: true });
  });
}

export function createModelApprovalHandlers(manager: ModelApprovalManager): GatewayRequestHandlers {
  return {
    "model.approval.request": async ({ params, client, respond, context }) => {
      if (!validateModelApprovalRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid model.approval.request params: ${formatValidationErrors(
              validateModelApprovalRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        provider: string;
        model: string;
        reasonKind: ModelApprovalReasonKind;
        agentId?: string;
        sessionKey?: string;
        runId?: string;
        timeoutMs?: number;
      };
      const timeoutMs = Math.min(
        typeof p.timeoutMs === "number" ? p.timeoutMs : DEFAULT_MODEL_APPROVAL_TIMEOUT_MS,
        MAX_MODEL_APPROVAL_TIMEOUT_MS,
      );
      const request: ModelApprovalRequestPayload = {
        provider: p.provider.trim(),
        model: p.model.trim(),
        reasonKind: p.reasonKind,
        ...(p.agentId?.trim() ? { agentId: p.agentId.trim() } : {}),
        ...(p.sessionKey?.trim() ? { sessionKey: p.sessionKey.trim() } : {}),
        ...(p.runId?.trim() ? { runId: p.runId.trim() } : {}),
      };

      // Always server-generate the id; kind-prefix so /approve-style routing
      // can distinguish model approvals from exec/plugin ids deterministically.
      const record = manager.create(request, timeoutMs, `model:${randomUUID()}`);

      // Register BEFORE responding/broadcasting so the id is immediately
      // resolvable by model.approval.waitDecision / model.approval.resolve.
      let decisionPromise: Promise<ModelApprovalDecision | null>;
      try {
        decisionPromise = manager.register(record, timeoutMs);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `registration failed: ${String(err)}`),
        );
        return;
      }

      context.broadcast(
        "model.approval.requested",
        {
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );

      // No-route short-circuit: without any approvals-capable client there is
      // nobody to answer, so resolve immediately as "no decision" instead of
      // blocking the model fallback loop for the full timeout.
      const hasApprovalClients = context.hasExecApprovalClients?.(client?.connId) ?? false;
      if (!hasApprovalClients) {
        manager.expire(record.id, "no-approval-route");
        respond(
          true,
          {
            id: record.id,
            decision: null,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.expiresAtMs,
          },
          undefined,
        );
        return;
      }

      const decision = await decisionPromise;
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },

    "model.approval.waitDecision": async ({ params, respond }) => {
      const p = params as { id?: string };
      const id = typeof p.id === "string" ? p.id.trim() : "";
      if (!id) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
        return;
      }
      const decisionPromise = manager.awaitDecision(id);
      if (!decisionPromise) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "approval expired or not found"),
        );
        return;
      }
      const snapshot = manager.getSnapshot(id);
      const decision = await decisionPromise;
      respond(
        true,
        {
          id,
          decision,
          createdAtMs: snapshot?.createdAtMs,
          expiresAtMs: snapshot?.expiresAtMs,
        },
        undefined,
      );
    },

    "model.approval.resolve": async ({ params, respond, client, context }) => {
      if (!validateModelApprovalResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid model.approval.resolve params: ${formatValidationErrors(
              validateModelApprovalResolveParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        id: string;
        decision: "approve" | "deny";
        dontAskAgain?: boolean;
        switchTo?: string;
      };
      const parsedSwitchTo = parseSwitchTo(p.switchTo);
      if (!parsedSwitchTo.ok) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "invalid switchTo: expected a 'provider/model' ref or a model-pinned ACP preset id",
          ),
        );
        return;
      }
      const resolvedId = manager.lookupPendingId(p.id);
      if (resolvedId.kind === "none" || resolvedId.kind === "ambiguous") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id", {
            details: APPROVAL_NOT_FOUND_DETAILS,
          }),
        );
        return;
      }
      const approvalId = resolvedId.id;
      const snapshot = manager.getSnapshot(approvalId);
      const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const dontAskAgain = p.dontAskAgain === true;
      const decision: ModelApprovalDecision = {
        kind: p.decision,
        ...(dontAskAgain ? { dontAskAgain: true } : {}),
        ...(p.decision === "approve" && parsedSwitchTo.value
          ? { switchTo: parsedSwitchTo.value }
          : {}),
      };
      const ok = manager.resolve(approvalId, decision, resolvedBy ?? null);
      if (!ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id", {
            details: APPROVAL_NOT_FOUND_DETAILS,
          }),
        );
        return;
      }

      // "Don't ask again for this conversation": persist the per-session flag
      // so later runs (and lazy re-reads in the fallback gate) auto-approve.
      const sessionKey = snapshot?.request.sessionKey?.trim();
      if (p.decision === "approve" && dontAskAgain && sessionKey) {
        void persistMeteredAutoApprove(sessionKey).catch((err) => {
          context.logGateway?.error?.(
            `model approvals: failed to persist meteredAutoApprove: ${String(err)}`,
          );
        });
      }

      context.broadcast(
        "model.approval.resolved",
        {
          id: approvalId,
          decision: p.decision,
          ...(p.switchTo ? { switchTo: p.switchTo } : {}),
          ...(dontAskAgain ? { dontAskAgain: true } : {}),
          resolvedBy,
          ts: Date.now(),
          request: snapshot?.request,
        },
        { dropIfSlow: true },
      );
      respond(true, { ok: true }, undefined);
    },
  };
}
