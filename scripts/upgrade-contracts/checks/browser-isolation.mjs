// Per-project browser isolation checks.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { HOME } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "browser-isolation.ports-inventory",
  name: "Per-project browser port registry is present and non-empty with unique ports",
  groups: ["browser-isolation"],
  matrixIds: ["RT-06"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(HOME, "browser-ports.json");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    const profileCount = Object.keys(parsed).length;
    const uniquePorts = new Set(Object.values(parsed).filter((v) => typeof v === "number"));
    if (profileCount < 2 || uniquePorts.size !== profileCount) {
      return {
        status: "fail",
        notes: `Expected >=2 projects with unique ports; got ${profileCount} projects and ${uniquePorts.size} unique ports`,
      };
    }
    return {
      status: "pass",
      evidence: [
        { label: "profileCount", value: profileCount },
        { label: "uniquePortCount", value: uniquePorts.size },
      ],
    };
  },
});

defineCheck({
  id: "browser-isolation.per-project-manual",
  name: "Per-project Chrome containers isolate cookies and downloads",
  groups: ["browser-isolation"],
  matrixIds: ["RT-06"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "browser-manager.sh available",
      "Two staging projects with browser profiles configured",
    ],
    steps: [
      "Start browser for staging project A; log into a distinct account or site.",
      "Start browser for staging project B; open the same site.",
      "Confirm project B does NOT inherit project A's session.",
      "Download a file in project A; confirm it lands in the project A downloads directory only.",
      "Stop and restart project A's browser; confirm the session persists.",
    ],
    expected:
      "Sessions and downloads are strictly isolated per project; data survives a container restart.",
    evidence: ["Screenshots; per-project downloads directory listing."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      writesWorkspaceFiles: true,
      downloadsExternal: true,
      expectedMutations: ["staging profile mutations; one downloaded canary file"],
      cleanupRollback: ["delete downloaded canary file"],
      evidenceCapture: ["screenshots", "directory listing"],
    },
  },
});
