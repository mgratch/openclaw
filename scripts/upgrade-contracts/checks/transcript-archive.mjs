// Transcript archive checks.

import { existsSync } from "node:fs";
import path from "node:path";
import { HOME } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "transcript-archive.installed",
  name: "transcript-archive extension is installed",
  groups: ["transcript-archive"],
  matrixIds: ["RT-03"],
  kind: "inventory",
  requires: ["extension.transcript-archive"],
  automated: "auto",
  async run() {
    const p = path.join(HOME, "extensions", "transcript-archive");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    return { status: "pass", evidence: [{ label: "extension root", value: p }] };
  },
});

defineCheck({
  id: "transcript-archive.injection-manual",
  name: "Transcript injection retains prior turns after runtime flip",
  groups: ["transcript-archive"],
  matrixIds: ["UM-08d"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging session with several assistant turns.",
      "Ability to trigger a runtime flip (ACP <-> embedded).",
    ],
    steps: [
      "Record the last three assistant turns from the current staging session.",
      "Trigger a runtime flip.",
      "Ask the agent to summarize what it said in the previous three turns.",
    ],
    expected:
      "Post-flip agent references pre-flip turns via transcript injection without loss of ordering.",
    evidence: [
      "Full pre- and post-flip transcript excerpts; session-log NDJSON showing injection payload.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one staging summary turn"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["transcript excerpts", "NDJSON"],
    },
  },
});
