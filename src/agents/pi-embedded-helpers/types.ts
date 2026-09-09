export type EmbeddedContextFile = { path: string; content: string };

export type FailoverReason =
  | "auth"
  | "auth_permanent"
  | "format"
  | "rate_limit"
  | "overloaded"
  | "billing"
  | "timeout"
  | "model_not_found"
  | "session_expired"
  // Metered-model approval gate outcomes (model-fallback.ts): the user denied
  // the metered candidate, or a headless run skipped it without asking.
  | "metered_denied"
  | "metered_unapproved_headless"
  // The user approved, but chose a DIFFERENT model from the approval card. The
  // dial-time gate cannot swap models mid-attempt, so it records the choice on
  // the run context and fails over with this reason; the chain-level gate in
  // model-fallback.ts consumes it for the next candidate. Distinct from
  // metered_denied so the failure text does not claim the user refused.
  | "metered_switch_requested"
  | "unknown";
