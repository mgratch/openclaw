// Mid-run steering — behavior manual only.

import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "steering.mid-run-manual",
  name: "Mid-run steering redirects the active turn without losing state",
  groups: ["steering"],
  matrixIds: ["UM-03"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging session where the agent is executing a long tool call.",
      "The UI steering input available.",
    ],
    steps: [
      "Start a long-running tool call on staging.",
      "Submit a steering message that modifies the goal.",
      "Observe the agent adopting the new goal without duplicating tool events.",
    ],
    expected:
      "The agent adopts the new goal; prior tool events remain visible; no duplicate final turn.",
    evidence: [
      "Chat transcript showing pre-steering tool events and steering-message boundary.",
      "Gateway log excerpt showing steering-event delivery.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one staging turn with steering"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["transcript", "log excerpt"],
    },
  },
});
