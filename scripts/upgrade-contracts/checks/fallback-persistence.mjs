// Fallback ordering: persistence and drag-reorder.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { UI_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "fallback-persistence.dnd-inventory",
  name: "UI ModelMultiSelect has drag/drop and keyboard-accessible reorder controls",
  groups: ["fallback-persistence"],
  matrixIds: ["UI-01"],
  kind: "inventory",
  requires: ["ui.checkpoint"],
  automated: "auto",
  async run() {
    const p = path.join(UI_ROOT, "src", "components", "Input", "ModelMultiSelect.tsx");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    const src = await fs.readFile(p, "utf8");
    const evidence = [
      { label: "onDragStart", value: /onDragStart/.test(src) },
      { label: "onDrop and dataTransfer", value: /onDrop/.test(src) && /dataTransfer/.test(src) },
      { label: "move-up button", value: /aria-label=["']Move fallback up["']/.test(src) },
      { label: "move-down button", value: /aria-label=["']Move fallback down["']/.test(src) },
      {
        label: "button handlers call reorder",
        value:
          /onClick[\s\S]{0,120}move\(id,\s*-1\)/.test(src) &&
          /onClick[\s\S]{0,120}move\(id,\s*1\)/.test(src),
      },
    ];
    const missing = evidence.filter((e) => !e.value).map((e) => e.label);
    if (missing.length > 0) {
      return { status: "fail", evidence, notes: `Missing DnD invariants: ${missing.join("; ")}` };
    }
    return { status: "pass", evidence };
  },
});

defineCheck({
  id: "fallback-persistence.fallback-chain-manual",
  name: "Cross-provider fallback chain honors persisted ordering, cooldown, and death-spiral breaker",
  groups: ["fallback-persistence", "model-provenance"],
  matrixIds: ["RUN-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Staging session with a documented misconfigured primary model and >=2 fallback models.",
    ],
    steps: [
      "Send a prompt; observe the primary fails.",
      "Verify the fallback chain fires in the persisted order.",
      "Trigger a cooldown / death-spiral condition; verify the breaker engages.",
    ],
    expected: "Fallback ordering, cooldown, and breaker all behave per documented spec.",
    evidence: [
      "Runner log excerpt across the failover; fallback ordering snapshot from projectApi.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["log excerpt", "ordering snapshot"],
    },
  },
});
