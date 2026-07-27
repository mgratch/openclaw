// Report rendering for the upgrade-contracts harness. Produces two artifacts:
//
//   * machine-readable JSON, with a stable schemaVersion; downstream tooling
//     can diff two baselines without parsing free-form text;
//   * a human-readable Markdown report separated by evidence class.
//
// Every value written to disk first passes through `redact()`. Writes are
// atomic (write-then-rename) with restrictive 0600 permissions.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { redact } from "./redact.mjs";

export const SCHEMA_VERSION = "openclaw-upgrade-contracts/v2";

export function buildJsonReport({
  runId,
  startedAt,
  finishedAt,
  environment,
  matrixCoverage,
  matrixValidation,
  bidirectionalValidation,
  manualSafetyViolations,
  results,
  summary,
  gate,
  mode,
  filtered,
  gitHead,
  version,
}) {
  const report = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    mode,
    filtered,
    startedAt,
    finishedAt,
    gitHead,
    version,
    environment,
    matrixValidation,
    bidirectionalValidation,
    manualSafetyViolations,
    matrixCoverage,
    summary,
    gate,
    results,
  };
  return redact(report);
}

export function renderMarkdownReport(report) {
  const lines = [];
  const bar = "".padEnd(72, "─");
  lines.push("# OpenClaw upgrade-contracts baseline report");
  lines.push("");
  lines.push(
    `_Schema:_ \`${report.schemaVersion}\`  ·  _Run:_ \`${report.runId}\`  ·  _Mode:_ \`${report.mode}\`  ·  _Filtered:_ \`${report.filtered ? "yes" : "no"}\``,
  );
  lines.push(`_Started:_ ${report.startedAt}  ·  _Finished:_ ${report.finishedAt}`);
  if (report.gitHead) {
    lines.push(`_Git HEAD:_ \`${report.gitHead}\``);
  }
  if (report.version) {
    lines.push(`_Runtime version:_ \`${report.version}\``);
  }
  lines.push("");

  lines.push("## Gate decision");
  lines.push("");
  const gate = report.gate ?? {};
  lines.push(`- Result: **${gate.passed ? "PASS" : "FAIL"}**`);
  if (Array.isArray(gate.blockers) && gate.blockers.length > 0) {
    lines.push(`- Blockers: **${gate.blockers.length}**`);
    for (const b of gate.blockers.slice(0, 60)) {
      lines.push(`  - \`${b.code}\` — ${b.message}`);
    }
    if (gate.blockers.length > 60) {
      lines.push(`  - ...(${gate.blockers.length - 60} more truncated)`);
    }
  }
  lines.push("");

  lines.push("## Summary by evidence class");
  lines.push("");
  const s = report.summary ?? {};
  const bc = s.byClass ?? {};
  lines.push("| Class | Count |\n|---|---:|");
  lines.push(`| behavior PASS | ${bc.behaviorPass ?? 0} |`);
  lines.push(`| inventory PASS | ${bc.inventoryPass ?? 0} |`);
  lines.push(`| evidence PASS | ${bc.evidencePass ?? 0} |`);
  lines.push(`| FAIL | ${bc.fail ?? 0} |`);
  lines.push(`| SKIP | ${bc.skip ?? 0} |`);
  lines.push(`| MANUAL pending | ${bc.manual ?? 0} |`);
  lines.push(`| TOTAL | ${s.total ?? 0} |`);
  lines.push("");
  lines.push(
    "> Inventory PASS asserts the source/config/file inventory only. It is NOT proof of the behavior itself.",
  );
  lines.push(
    "> Evidence PASS attests to an immutable artifact for the current baseline; the target baseline requires a fresh artifact.",
  );
  lines.push("");

  if (report.matrixCoverage) {
    const ms = report.matrixCoverage;
    lines.push("## Preservation matrix coverage");
    lines.push("");
    lines.push(`- Total matrix rows: **${ms.totalRows}**`);
    lines.push(
      `- Terminal states: **${ms.stateTerminal}**  ·  Nonterminal states: **${ms.stateNonterminal}**`,
    );
    lines.push(`- Rows fully covered by this run: **${ms.covered}**`);
    lines.push(
      `- Behavior/Inventory/Evidence PASS counts across matrix rows: **${ms.behaviorPass}** / **${ms.inventoryPass}** / **${ms.evidencePass}**`,
    );
    lines.push(
      `- Manual pending: **${ms.manualPending}**  ·  Failed: **${ms.failed}**  ·  Skipped: **${ms.skipped}**`,
    );
    if (ms.uncoveredCheckIds.length > 0) {
      lines.push("");
      lines.push("**Uncovered check ids in this run:**");
      for (const u of ms.uncoveredCheckIds) {
        lines.push(`  - \`${u.row}\` — ${u.missing.join(", ")}`);
      }
    }
    lines.push("");
  }

  if (report.matrixValidation && !report.matrixValidation.ok) {
    lines.push("## Matrix validation errors");
    lines.push("");
    for (const e of report.matrixValidation.errors) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }
  if (report.bidirectionalValidation && !report.bidirectionalValidation.ok) {
    lines.push("## Matrix mapping errors");
    lines.push("");
    for (const e of report.bidirectionalValidation.errors) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }
  if (Array.isArray(report.manualSafetyViolations) && report.manualSafetyViolations.length > 0) {
    lines.push("## Unsafe manual contracts");
    lines.push("");
    for (const v of report.manualSafetyViolations) {
      lines.push(`- \`${v.id}\` — ${(v.missing ?? []).join("; ")}`);
    }
    lines.push("");
  }

  lines.push("## Environment (redacted)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.environment ?? {}, null, 2));
  lines.push("```");
  lines.push("");

  const byBucket = {
    fail: [],
    manual: [],
    skip: [],
    behaviorPass: [],
    inventoryPass: [],
    evidencePass: [],
  };
  for (const r of report.results ?? []) {
    if (r.status === "fail") {
      byBucket.fail.push(r);
    } else if (r.status === "manual") {
      byBucket.manual.push(r);
    } else if (r.status === "skip") {
      byBucket.skip.push(r);
    } else if (r.status === "pass" && r.kind === "behavior") {
      byBucket.behaviorPass.push(r);
    } else if (r.status === "pass" && r.kind === "inventory") {
      byBucket.inventoryPass.push(r);
    } else if (r.status === "pass" && r.kind === "evidence") {
      byBucket.evidencePass.push(r);
    }
  }

  const sectionOrder = [
    ["FAIL", "fail"],
    ["MANUAL (pending)", "manual"],
    ["SKIP (nonterminal)", "skip"],
    ["EVIDENCE PASS (immutable artifact)", "evidencePass"],
    ["BEHAVIOR PASS (runtime invariant)", "behaviorPass"],
    ["INVENTORY PASS (source/file only — NOT behavior)", "inventoryPass"],
  ];

  lines.push("## Results");
  lines.push("");
  for (const [label, key] of sectionOrder) {
    const rows = byBucket[key];
    if (!rows || rows.length === 0) {
      continue;
    }
    lines.push(`### ${label} (${rows.length})`);
    lines.push("");
    for (const r of rows) {
      lines.push(`#### \`${r.id}\` — ${r.name}`);
      lines.push("");
      lines.push(
        `- Status: **${r.status}**  ·  kind: \`${r.kind}\`  ·  duration: ${r.durationMs ?? 0}ms`,
      );
      lines.push(`- Groups: ${r.groups?.map((g) => `\`${g}\``).join(", ") ?? "—"}`);
      lines.push(`- Matrix IDs: ${r.matrixIds?.map((m) => `\`${m}\``).join(", ") ?? "—"}`);
      if (r.notes) {
        lines.push(`- Notes: ${r.notes}`);
      }
      if (r.skipReason) {
        lines.push(`- Skip reason: ${r.skipReason}`);
      }
      if (r.error) {
        lines.push(`- Error: \`${r.error.name}: ${r.error.message}\``);
      }
      if (Array.isArray(r.evidence) && r.evidence.length > 0) {
        lines.push("");
        lines.push("Evidence:");
        for (const e of r.evidence) {
          if (e.value === undefined || e.value === null || e.value === "") {
            lines.push(`  - ${e.label}`);
          } else if (typeof e.value === "string") {
            lines.push(`  - ${e.label}: \`${truncate(e.value)}\``);
          } else {
            lines.push(`  - ${e.label}: \`${truncate(JSON.stringify(e.value))}\``);
          }
        }
      }
      if (r.status === "manual" && r.manual) {
        lines.push("");
        lines.push("**Manual contract**");
        lines.push("");
        lines.push("_Prerequisites:_");
        for (const p of r.manual.prerequisites) {
          lines.push(`  - ${p}`);
        }
        lines.push("");
        lines.push("_Steps:_");
        r.manual.steps.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
        lines.push("");
        lines.push(`_Expected:_ ${r.manual.expected}`);
        lines.push("");
        lines.push("_Evidence to capture:_");
        for (const e of r.manual.evidence) {
          lines.push(`  - ${e}`);
        }
        if (r.manual.safety) {
          lines.push("");
          lines.push("_Safety declaration:_");
          for (const [k, v] of Object.entries(r.manual.safety)) {
            const shown = Array.isArray(v) ? v.map((x) => `\`${x}\``).join(", ") : String(v);
            lines.push(`  - ${k}: ${shown}`);
          }
        }
      }
      lines.push("");
      lines.push(bar);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Atomic write with 0600 permissions. */
export async function writeAtomic(target, content) {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${path.basename(target)}-${randomUUID().slice(0, 8)}`);
  await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, target);
  await fs.chmod(target, 0o600);
}

function truncate(str, n = 400) {
  if (typeof str !== "string") {
    return String(str);
  }
  return str.length > n ? `${str.slice(0, n)}…(truncated ${str.length - n} chars)` : str;
}
