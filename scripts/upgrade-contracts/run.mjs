#!/usr/bin/env node
// upgrade-contracts CLI. Strict gate by default; --report-only for baseline
// capture. Filtered runs are NEVER a full gate.
//
// Exit codes:
//   0 — gate passed (strict) OR --report-only complete
//   1 — gate failed (strict) or fatal error
//
// Usage:
//   node scripts/upgrade-contracts/run.mjs --report-only [--out-dir <dir>]
//   node scripts/upgrade-contracts/run.mjs                # strict gate
//   node scripts/upgrade-contracts/run.mjs --filter <sub> # scoped, cannot gate
//
// Guarantees:
//   * never restarts the gateway;
//   * never mutates the gateway config;
//   * never emits external messages;
//   * writes reports atomically at 0600 with redacted content.

import { randomUUID } from "node:crypto";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import "./checks/index.mjs";
import { probeEnvironment, REPO_ROOT } from "./lib/env.mjs";
import { decideGate } from "./lib/gate.mjs";
import {
  validateMatrix,
  validateBidirectionalMapping,
  summarizeMatrixCoverage,
} from "./lib/matrix.mjs";
import { buildJsonReport, renderMarkdownReport, writeAtomic } from "./lib/report.mjs";
import { getRegistry, runChecks, summarize } from "./lib/runner.mjs";
import { assertAllManualsSafe } from "./lib/safety.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.join(HERE, "baseline");
const MATRIX_PATH = path.join(HERE, "preservation-matrix.json");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const runId =
    args.runId ?? new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();

  const matrix = JSON.parse(await fs.readFile(MATRIX_PATH, "utf8"));
  const checks = getRegistry();
  const checkIds = new Set(checks.map((c) => c.id));

  const matrixValidation = validateMatrix(matrix, { checkIds });
  const bidirectionalValidation = validateBidirectionalMapping(matrix, checks);
  const manualSafetyViolations = assertAllManualsSafe(checks);

  const { info: env, capabilities } = await probeEnvironment();

  const filter = makeFilter(args);
  const filtered = Boolean(args.filter || args.onlyGroups);
  const results = await runChecks(
    checks,
    { env, capabilities },
    {
      filter,
      onProgress({ phase, check, result }) {
        if (!args.quiet && phase === "end") {
          const badge = badgeFor(result.status);
          process.stderr.write(`${badge} ${check.id} [${check.kind}] (${result.durationMs}ms)\n`);
        }
      },
    },
  );

  const summary = summarize(results);
  const matrixCoverage = summarizeMatrixCoverage(matrix, results);
  const finishedAt = new Date().toISOString();

  const gate = decideGate({
    filtered,
    results,
    matrixCoverage,
    matrixValidation,
    bidirectionalValidation,
    manualSafetyViolations,
  });

  const mode = args.reportOnly ? "report-only" : "gate-strict";

  const report = buildJsonReport({
    runId,
    startedAt,
    finishedAt,
    environment: env,
    matrixCoverage,
    matrixValidation,
    bidirectionalValidation,
    manualSafetyViolations,
    summary,
    results,
    gate,
    mode,
    filtered,
    gitHead: env?.git?.head ?? null,
    version: env?.openClawJson?.version ?? null,
  });

  const outDir = args.outDir;
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = args.json ?? path.join(outDir, `report-${runId}.json`);
  const mdPath = args.md ?? path.join(outDir, `report-${runId}.md`);
  const latestStem = args.reportOnly ? "latest" : "latest-gate";
  const latestJsonPath = path.join(outDir, `${latestStem}.json`);
  const latestMdPath = path.join(outDir, `${latestStem}.md`);
  const jsonStr = JSON.stringify(report, null, 2) + "\n";
  const mdStr = renderMarkdownReport(report);
  await writeAtomic(jsonPath, jsonStr);
  await writeAtomic(mdPath, mdStr);
  await writeAtomic(latestJsonPath, jsonStr);
  await writeAtomic(latestMdPath, mdStr);
  if (args.durableJson) {
    await writeAtomic(args.durableJson, jsonStr);
  }
  if (args.durableMd) {
    await writeAtomic(args.durableMd, mdStr);
  }

  process.stderr.write(
    `\nMode: ${mode}  Filtered: ${filtered ? "yes" : "no"}\n` +
      `Evidence classes: behaviorPass=${summary.byClass.behaviorPass} inventoryPass=${summary.byClass.inventoryPass} evidencePass=${summary.byClass.evidencePass}  fail=${summary.byClass.fail} skip=${summary.byClass.skip} manual=${summary.byClass.manual}  (total=${summary.total})\n` +
      `Gate: ${gate.passed ? "PASS" : "FAIL"} (${gate.blockers.length} blocker${gate.blockers.length === 1 ? "" : "s"})\n` +
      `JSON: ${relPath(jsonPath)}\nMD:   ${relPath(mdPath)}\n`,
  );

  if (mode === "gate-strict" && !gate.passed) {
    process.exitCode = 1;
  }
}

function relPath(p) {
  try {
    return path.relative(REPO_ROOT, p);
  } catch {
    return p;
  }
}

function parseArgs(argv) {
  const args = {
    json: null,
    md: null,
    durableJson: null,
    durableMd: null,
    filter: null,
    onlyGroups: null,
    outDir: DEFAULT_OUT_DIR,
    runId: null,
    quiet: false,
    help: false,
    reportOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--report-only":
        args.reportOnly = true;
        break;
      case "--json":
        args.json = argv[++i];
        break;
      case "--md":
        args.md = argv[++i];
        break;
      case "--durable-json":
        args.durableJson = argv[++i];
        break;
      case "--durable-md":
        args.durableMd = argv[++i];
        break;
      case "--filter":
        args.filter = argv[++i];
        break;
      case "--only-groups":
        args.onlyGroups = argv[++i]?.split(",") ?? null;
        break;
      case "--out-dir":
        args.outDir = argv[++i];
        break;
      case "--run-id":
        args.runId = argv[++i];
        break;
      case "--quiet":
        args.quiet = true;
        break;
      default:
        if (a.startsWith("--")) {
          throw new Error(`Unknown flag: ${a}`);
        }
    }
  }
  return args;
}

function makeFilter(args) {
  const substring = args.filter ? args.filter.toLowerCase() : null;
  const groups = args.onlyGroups?.map((g) => g.toLowerCase()) ?? null;
  if (!substring && !groups) {
    return null;
  }
  return (c) => {
    if (
      substring &&
      !c.id.toLowerCase().includes(substring) &&
      !c.name.toLowerCase().includes(substring)
    ) {
      return false;
    }
    if (groups && !c.groups.some((g) => groups.includes(g.toLowerCase()))) {
      return false;
    }
    return true;
  };
}

function badgeFor(status) {
  return { pass: "[PASS]", fail: "[FAIL]", skip: "[SKIP]", manual: "[MANUAL]" }[status] ?? "[?]";
}

function usage() {
  return `Usage: node scripts/upgrade-contracts/run.mjs [--report-only] [options]

Modes:
  (default)              Strict gate. Non-zero exit on ANY fail/skip/manual/
                         uncovered/nonterminal/dangling/unsafe-manual issue.
                         Refuses to gate when a filter is applied.
  --report-only          Capture the current baseline. Exit 0 even when there
                         are pending manual/skip contracts. Blockers still
                         reported.

Common options:
  --json <path>          Write the JSON report to <path>
  --md <path>            Write the Markdown report to <path>
  --durable-json <path>  ALSO write JSON to a durable audit path
  --durable-md <path>    ALSO write MD to a durable audit path
  --out-dir <dir>        Directory for baseline artifacts (default:
                         scripts/upgrade-contracts/baseline)
  --filter <substring>   Only run checks whose id or name contains the
                         substring. Disqualifies the strict gate.
  --only-groups a,b      Only run checks belonging to any of the listed groups.
                         Disqualifies the strict gate.
  --run-id <id>          Override the auto-generated run id
  --quiet                Suppress per-check progress output
  --help                 Show this message

Guarantees: never restarts the gateway, never mutates gateway config, never
emits external messages. Reports are redacted and written atomically at 0600.
`;
}

if (!existsSync(path.join(HERE, "checks", "index.mjs"))) {
  process.stderr.write("upgrade-contracts: missing checks/index.mjs\n");
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`upgrade-contracts: ${err?.stack ?? err}\n`);
  process.exit(1);
});
