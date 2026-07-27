// PROJECT.md / PROJECT_FILES.md generation from the UI.
//
// The inventory check must FAIL when the UI checkpoint's server file is
// missing — that was a documented false positive in the previous harness.

import { existsSync } from "node:fs";
import path from "node:path";
import { UI_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "project-files.server-inventory",
  name: "UI split-API server exposes project manifest routes",
  groups: ["project-files"],
  matrixIds: ["PF-01"],
  kind: "inventory",
  requires: ["ui.checkpoint"],
  automated: "auto",
  async run() {
    const server = path.join(UI_ROOT, "src", "server", "projectManifest.js");
    if (!existsSync(server)) {
      return { status: "fail", notes: `Missing ${server}` };
    }
    return { status: "pass", evidence: [{ label: "path", value: server }] };
  },
});

defineCheck({
  id: "project-files.generation-manual",
  name: "PROJECT.md and PROJECT_FILES.md generation flow",
  groups: ["project-files"],
  matrixIds: ["PF-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "UI checkpoint build.",
      "A staging workspace directory with at least three source files.",
    ],
    steps: [
      "Trigger PROJECT.md generation from the UI project view.",
      "Verify the output matches the workspace snapshot.",
      "Trigger PROJECT_FILES.md generation.",
      "Verify each referenced file exists and the file list ordering matches the UI's chosen scope.",
    ],
    expected: "Both files are generated to the expected paths and reflect the workspace snapshot.",
    evidence: [
      "Generated file contents (truncated).",
      "Workspace directory listing at generation time.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["PROJECT.md and PROJECT_FILES.md in staging workspace"],
      cleanupRollback: ["delete generated files after verification"],
      evidenceCapture: ["file contents", "directory listing"],
    },
  },
});
