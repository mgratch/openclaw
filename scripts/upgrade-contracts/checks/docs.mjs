// Documentation preservation checks — inventory only.

import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

function docCheck(id, name, relPath, matrixIds) {
  defineCheck({
    id,
    name,
    groups: ["docs"],
    matrixIds,
    kind: "inventory",
    automated: "auto",
    async run() {
      const p = path.join(REPO_ROOT, relPath);
      if (!existsSync(p)) {
        return { status: "fail", notes: `Missing ${p}` };
      }
      return { status: "pass", evidence: [{ label: "path", value: p }] };
    },
  });
}

docCheck("docs.upgrade-artifacts-inventory", "AGENTS.md is present in core repo", "AGENTS.md", [
  "UM-14a",
]);
docCheck(
  "docs.pr-maintainer-skill-inventory",
  "PR maintainer skill file present",
  ".agents/skills/openclaw-pr-maintainer/SKILL.md",
  ["UM-14b"],
);
docCheck(
  "docs.upgrade-patches-inventory",
  "Upgrade patches inventory doc present",
  "docs/plugins/architecture.md",
  ["UM-14c"],
);
docCheck(
  "docs.local-runtime-inventory",
  "docs/local-runtime-preservation.md is present",
  "docs/local-runtime-preservation.md",
  ["CP-04"],
);
docCheck(
  "docs.checkpoint-validation-inventory",
  "docs/pre-upgrade-checkpoint-validation.md is present",
  "docs/pre-upgrade-checkpoint-validation.md",
  ["CP-05"],
);
docCheck(
  "docs.memory-firewall-inventory",
  "Memory-firewall deployment recorded",
  "docs/local-runtime-preservation.md",
  ["MEM-02"],
);
docCheck(
  "docs.mount-baseline-inventory",
  "Mount baseline reconciliation recorded",
  "audits/MOUNT_BASELINE_RECONCILIATION.md",
  ["MOUNT-02", "MOUNT-05"],
);
