export type ExecApprovalForwardingMode = "session" | "targets" | "both";

export type ExecApprovalForwardTarget = {
  /** Channel id (e.g. "discord", "slack", or plugin channel id). */
  channel: string;
  /** Destination id (channel id, user id, etc. depending on channel). */
  to: string;
  /** Optional account id for multi-account channels. */
  accountId?: string;
  /** Optional thread id to reply inside a thread. */
  threadId?: string | number;
};

export type ExecApprovalForwardingConfig = {
  /** Enable forwarding exec approvals to chat channels. Default: false. */
  enabled?: boolean;
  /** Delivery mode (session=origin chat, targets=config targets, both=both). Default: session. */
  mode?: ExecApprovalForwardingMode;
  /** Only forward approvals for these agent IDs. Omit = all agents. */
  agentFilter?: string[];
  /** Only forward approvals matching these session key patterns (substring or regex). */
  sessionFilter?: string[];
  /** Explicit delivery targets (used when mode includes targets). */
  targets?: ExecApprovalForwardTarget[];
};

/**
 * Blanket approval policy.
 *
 * - "off" (default): every approval gate behaves normally.
 * - "non-spend": approve every human-gated exec and plugin prompt automatically,
 *   so an unattended run cannot stall waiting for a click. Deliberately does NOT
 *   cover the metered-model spend gate: decisions that cost money are always
 *   asked. An explicit `security: "deny"` also still wins.
 *
 * Named as a mode rather than a boolean so the spend carve-out is stated by the
 * value itself, and so further policies can be added without a breaking change.
 */
export type ApprovalsAutoApproveMode = "off" | "non-spend";

export type ApprovalsConfig = {
  exec?: ExecApprovalForwardingConfig;
  plugin?: ExecApprovalForwardingConfig;
  /** Blanket approval policy. Default: "off". See ApprovalsAutoApproveMode. */
  autoApprove?: ApprovalsAutoApproveMode;
};
