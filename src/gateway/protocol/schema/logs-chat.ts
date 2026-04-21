import { Type } from "@sinclair/typebox";
import { ChatSendSessionKeyString, InputProvenanceSchema, NonEmptyString } from "./primitives.js";

export const LogsTailParamsSchema = Type.Object(
  {
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);

export const LogsTailResultSchema = Type.Object(
  {
    file: NonEmptyString,
    cursor: Type.Integer({ minimum: 0 }),
    size: Type.Integer({ minimum: 0 }),
    lines: Type.Array(Type.String()),
    truncated: Type.Optional(Type.Boolean()),
    reset: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

// WebChat/WebSocket-native chat methods
export const ChatHistoryParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 500_000 })),
  },
  { additionalProperties: false },
);

// Full (untruncated) chat history for UI archive/display — no byte budgets.
// Supports cursor-based pagination so the UI can fetch the full transcript
// without blowing up the WebSocket frame.
export const ChatHistoryFullParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    /** 0-based message offset; omit or 0 for "start from the beginning". */
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Max messages per page (default 500, hard max 2000). */
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
  },
  { additionalProperties: false },
);

export const ChatSendParamsSchema = Type.Object(
  {
    sessionKey: ChatSendSessionKeyString,
    message: Type.String(),
    thinking: Type.Optional(Type.String()),
    deliver: Type.Optional(Type.Boolean()),
    originatingChannel: Type.Optional(Type.String()),
    originatingTo: Type.Optional(Type.String()),
    originatingAccountId: Type.Optional(Type.String()),
    originatingThreadId: Type.Optional(Type.String()),
    attachments: Type.Optional(Type.Array(Type.Unknown())),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    /**
     * Optional per-call model override. Format is `provider/model` (e.g.
     * `anthropic/claude-opus-4-6`) or a bare alias resolvable through the
     * agent's catalog. Mirrors the heartbeat-runner's `heartbeatModelOverride`
     * pattern for non-heartbeat (user-initiated) runs — see
     * `auto-reply/reply/get-reply.ts`. Additive; older clients that do not
     * send this field continue to use the agent's configured model.
     */
    model: Type.Optional(NonEmptyString),
    systemInputProvenance: Type.Optional(InputProvenanceSchema),
    systemProvenanceReceipt: Type.Optional(Type.String()),
    idempotencyKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ChatAbortParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    runId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/**
 * Respond to an ACP `permission_request` event that was previously surfaced
 * from the runtime (see `AcpRuntimeEvent` permission_request variant). The
 * UI's inline approval card calls this RPC when the user clicks Allow /
 * Allow Always / Deny / etc. The shape of `decision` matches
 * `AcpPermissionDecision` — validated loosely as unknown here and refined in
 * the handler so the gateway schema does not drift from the runtime types.
 */
export const AcpPermissionRespondParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    requestId: NonEmptyString,
    decision: Type.Unknown(),
  },
  { additionalProperties: false },
);

export const ChatInjectParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    message: NonEmptyString,
    label: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: false },
);

export const ChatEventSchema = Type.Object(
  {
    runId: NonEmptyString,
    sessionKey: NonEmptyString,
    seq: Type.Integer({ minimum: 0 }),
    state: Type.Union([
      Type.Literal("delta"),
      Type.Literal("final"),
      Type.Literal("aborted"),
      Type.Literal("error"),
    ]),
    message: Type.Optional(Type.Unknown()),
    errorMessage: Type.Optional(Type.String()),
    usage: Type.Optional(Type.Unknown()),
    stopReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
