import { Type } from "@sinclair/typebox";
import { MAX_MODEL_APPROVAL_TIMEOUT_MS } from "../../../infra/model-approvals.js";
import { NonEmptyString } from "./primitives.js";

export const ModelApprovalRequestParamsSchema = Type.Object(
  {
    provider: NonEmptyString,
    model: NonEmptyString,
    reasonKind: Type.String({ enum: ["primary", "fallback"] }),
    agentId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_MODEL_APPROVAL_TIMEOUT_MS })),
  },
  { additionalProperties: false },
);

export const ModelApprovalResolveParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    decision: Type.String({ enum: ["approve", "deny"] }),
    dontAskAgain: Type.Optional(Type.Boolean()),
    /** Replacement model as a "provider/model" string. */
    switchTo: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ModelApprovalWaitParamsSchema = Type.Object(
  {
    id: NonEmptyString,
  },
  { additionalProperties: false },
);
