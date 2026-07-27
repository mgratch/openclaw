// Provider generated-bundle disposition — manual only.

import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "providers.generated-bundle-manual",
  name: "Provider generated bundles are not carried onto the upgrade target",
  groups: ["providers"],
  matrixIds: ["UM-17a", "UM-27b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A clean v2026.7.1 worktree.",
      "Access to the current runtime provider catalog.",
    ],
    steps: [
      "In the stable worktree, run the standard provider catalog generator (pnpm run providers:generate or the documented equivalent).",
      "Diff the freshly generated catalog against the current 2026.4.2 runtime catalog.",
      "For each model missing from the fresh catalog, decide whether it is: (a) intentionally retired, or (b) still required — in which case add a source patch and regenerate.",
    ],
    expected:
      "The upgraded runtime uses regenerated provider catalogs; no hand-edited generated bundles remain.",
    evidence: ["Diff output for the two catalogs and the decision log for each divergence."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only diff"],
      evidenceCapture: ["diff output", "decision log"],
    },
  },
});

defineCheck({
  id: "providers.zap-baseline-manual",
  name: "ZAP security scan baselines preserved as evidence, not runtime carry-over",
  groups: ["providers"],
  matrixIds: ["UM-17b"],
  kind: "evidence",
  automated: "manual",
  manual: {
    prerequisites: ["Access to the ZAP baseline artifacts stored alongside the fork checkpoint."],
    steps: [
      "Locate the ZAP baseline artifacts.",
      "Confirm they are archived (not layered into the runtime image).",
      "Cross-reference the artifact manifest with the current threat model doc.",
    ],
    expected: "Baselines are archived; not shipped in the runtime image.",
    evidence: ["Archive location + artifact manifest."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only"],
      evidenceCapture: ["archive path", "manifest"],
    },
  },
});
