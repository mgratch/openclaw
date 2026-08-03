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
  | "unknown";
