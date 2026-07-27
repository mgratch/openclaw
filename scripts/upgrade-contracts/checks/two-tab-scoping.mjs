// Two-tab / session connection scoping — behavior manual.

import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "two-tab-scoping.session-scoping-manual",
  name: "Two tabs on the same session do not cross events",
  groups: ["two-tab-scoping"],
  matrixIds: ["TT-01", "UI-03c"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Two browser tabs on the same staging UI attached to identical projectId + sessionKey.",
      "A third tab on a different session for negative control.",
    ],
    steps: [
      "Send a message from tab A.",
      "Confirm tab B receives streaming events for the same run.",
      "Confirm the negative-control tab receives no events.",
      "Send a message from tab B; assert the same fan-out.",
      "Close tab A; send from tab B and confirm no dead reconnection loop.",
    ],
    expected:
      "Both same-session tabs stream identical events; negative-control tab receives no events; no reconnect flood after close.",
    evidence: [
      "Per-tab WebSocket frame captures; gateway log excerpt showing per-connection dispatch scoping.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: ["staging turns from both tabs"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["frame captures", "log excerpt"],
    },
  },
});
