// OAuth refresh/burn behavior — all manual, staging-only.

import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "auth.oauth-refresh-dedupe-manual",
  name: "Concurrent OAuth refresh requests are deduplicated",
  groups: ["auth"],
  matrixIds: ["UM-07"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A staging provider whose access token is close to expiry."],
    steps: [
      "Fire two concurrent staging runs that will each trigger a refresh.",
      "Inspect the OAuth server logs / gateway logs for the number of refresh calls.",
    ],
    expected: "Exactly one refresh call is issued across both concurrent runs.",
    evidence: ["Redacted log excerpts from both sides."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      changesAuth: true,
      invokesPaidApi: true,
      expectedMutations: ["one refresh token rotation on staging profile"],
      cleanupRollback: ["confirm profile is not burned; observe re-runnable state"],
      evidenceCapture: ["log excerpts"],
    },
  },
});

defineCheck({
  id: "auth.burned-profile-manual",
  name: "Permanent refresh failures retire the burned profile",
  groups: ["auth"],
  matrixIds: ["UM-18"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A dedicated test OAuth profile with a deliberately invalid refresh token."],
    steps: [
      "Trigger a refresh; observe the permanent-failure classification.",
      "Confirm the profile is marked burned and the UI prompts for reauth.",
      "Confirm no further refresh attempts are made until the operator reauthenticates the test profile through the normal UI flow (never by hand-editing credentials).",
    ],
    expected: "Permanent failures retire the profile; transient failures do not.",
    evidence: ["Gateway log excerpt and profile-state snapshot."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      changesAuth: true,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: ["burned state on test profile"],
      cleanupRollback: ["reauth test profile through UI to restore state"],
      evidenceCapture: ["log excerpt", "profile snapshot"],
    },
  },
});

defineCheck({
  id: "auth.stale-refresh-manual",
  name: "Stale on-disk credential is adopted before declaring the token burned",
  groups: ["auth"],
  matrixIds: ["UM-23"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Two staging agents sharing a provider profile.",
      "A documented UI/tooling path that rotates the on-disk credential (never a hand-edit of live credentials).",
    ],
    steps: [
      "From agent A, refresh the token so a newer credential lands on disk.",
      "From agent B, drive a stale in-memory refresh path; verify it adopts the on-disk credential rather than burning.",
    ],
    expected:
      "Stale in-memory credential is replaced by the newer on-disk one; no burn is recorded.",
    evidence: ["Before/after credential file mtimes (redacted); gateway log excerpt."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      changesAuth: true,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: ["credential rotation via documented UI/tooling path"],
      cleanupRollback: ["confirm both agents share a valid credential; no burn"],
      evidenceCapture: ["mtime deltas", "log excerpt"],
    },
  },
});

defineCheck({
  id: "auth.acp-log-identity-manual",
  name: "ACP log events carry authenticated identity; no bypass via log fields",
  groups: ["auth"],
  matrixIds: ["UM-08a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A staging ACP session emitting log events and access to the receiving side."],
    steps: [
      "Emit a log event with a plausibly forged identity field.",
      "Confirm the receiving side ignores forged identity and uses the authenticated session identity.",
    ],
    expected: "Log identity is authenticated; forged fields are ignored.",
    evidence: ["Log event capture and receiver-side identity resolution."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      changesAuth: false,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only"],
      evidenceCapture: ["event capture", "identity resolution"],
    },
  },
});
