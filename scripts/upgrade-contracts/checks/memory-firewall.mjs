// Memory firewall checks. The plan makes this a HARD boundary:
//   * project-scoped memory extension is the ONLY memory plugin active;
//   * source-level fail-closed session mapping and exact projectId filters;
//   * effective plugin config verifies the project extension is enabled and
//     the stock memory-lancedb is not simultaneously configured;
//   * an immutable canary evidence artifact (SHA256-manifested checkpoint)
//     attests to a 13-assertion, zero-residual-row live run for THIS current
//     baseline only. The target baseline REQUIRES a new artifact.
//
// The cross-project / cross-agent / main-bypass / blank-legacy / concurrency /
// duplicate / foreign-delete / cleanup / unknown-session behaviors used to
// ship as manual contracts. They are now exercised by the memory plugin's
// disposable-LanceDB Vitest suite, invoked through
// `memory-firewall.isolated-suite-behavior`. Only subagent-idempotency and
// the target-runtime evidence artifact remain manual.

import crypto from "node:crypto";
import { promises as fs, existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HOME, WORKSPACE_DB, CHECKPOINT_ROOT, REPO_ROOT } from "../lib/env.mjs";
import { runFocusedVitest } from "../lib/focused-vitest-runner.mjs";
import { FOCUSED_MEMORY_TEST_FILES, summarizeVitestResult } from "../lib/memory-firewall-suite.mjs";
import { defineCheck } from "../lib/runner.mjs";

const CANARY_CHECKPOINT_DIR = path.join(CHECKPOINT_ROOT, "memory-firewall-20260727-125533");

const VITEST_TIMEOUT_MS = 180_000; // 3 minutes — focused suite is ~20s locally
const VITEST_MAX_BUFFER = 8 * 1024 * 1024;
const VITEST_ENTRY = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

function runFocusedMemorySuite() {
  return runFocusedVitest({
    execPath: process.execPath,
    args: [VITEST_ENTRY, "run", "--root", REPO_ROOT, ...FOCUSED_MEMORY_TEST_FILES],
    cwd: REPO_ROOT,
    // Execute the already-installed Vitest entry directly: no package-manager
    // wrapper, Corepack lookup, install, or download. Env values are NEVER
    // copied into evidence — see summarizeVitestResult.
    env: process.env,
    timeoutMs: VITEST_TIMEOUT_MS,
    maxBuffer: VITEST_MAX_BUFFER,
  });
}

// -- Behavior: automated isolated-suite runs the focused Vitest files --------

defineCheck({
  id: "memory-firewall.isolated-suite-behavior",
  name: "Focused memory Vitest suite proves cross-project/agent/main/legacy/duplicate/foreign/unknown isolation on a disposable LanceDB",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01", "UM-06a"],
  kind: "behavior",
  automated: "auto",
  async run() {
    if (!existsSync(VITEST_ENTRY)) {
      return {
        status: "fail",
        evidence: [{ label: "local vitest entry exists", value: false }],
        notes: "Local Vitest entry is missing; refusing to fall back to pnpm/Corepack.",
      };
    }
    const result = await runFocusedMemorySuite();
    return summarizeVitestResult(result);
  },
});

// -- Effective plugin config ---------------------------------------------------

defineCheck({
  id: "memory-firewall.effective-plugin-config",
  name: "Effective plugin config: project slot enabled, stock lancedb not active",
  groups: ["memory-firewall", "memory-schema"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  requires: ["openclaw.json"],
  automated: "auto",
  async run(ctx) {
    const cfg = ctx?.env?.openClawJson;
    if (!cfg || cfg.error) {
      return { status: "fail", notes: `openclaw.json unreadable: ${cfg?.error ?? "unknown"}` };
    }
    const slot = cfg.pluginSlots?.memory;
    const evidence = [
      { label: "plugins.slots.memory", value: slot ?? "(none)" },
      {
        label: "plugins.entries.memory-lancedb-project.enabled",
        value: cfg.projectMemoryEnabled === true,
      },
      { label: "plugins.entries.memory-lancedb present", value: cfg.stockMemoryPresent === true },
      { label: "plugins.entries.memory-lancedb enabled", value: cfg.stockMemoryEnabled === true },
      { label: "plugins.load.paths", value: cfg.pluginLoadPaths },
    ];
    const problems = [];
    if (slot !== "memory-lancedb-project") {
      problems.push(
        `slots.memory must equal "memory-lancedb-project" — got ${JSON.stringify(slot)}`,
      );
    }
    if (!cfg.projectMemoryEnabled) {
      problems.push("plugins.entries.memory-lancedb-project must be enabled");
    }
    if (cfg.stockMemoryEnabled) {
      problems.push(
        "stock memory-lancedb entry is enabled — firewall requires it to be absent or explicitly disabled",
      );
    }
    if (problems.length > 0) {
      return { status: "fail", evidence, notes: problems.join("; ") };
    }
    return {
      status: "pass",
      evidence,
      notes:
        "Effective config binds memory slot to the project extension; no stock memory-lancedb entry is active.",
    };
  },
});

// -- Extension inventory + no duplicate discovered ext -------------------------

defineCheck({
  id: "memory-firewall.project-plugin-installed",
  name: "memory-lancedb-project extension is installed and no duplicate lancedb ext discovered",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01", "RT-01"],
  kind: "inventory",
  requires: ["memory.project-plugin"],
  automated: "auto",
  async run(ctx) {
    const root = path.join(HOME, "extensions", "memory-lancedb-project");
    const pluginJsonPath = path.join(root, "openclaw.plugin.json");
    if (!existsSync(pluginJsonPath)) {
      return { status: "fail", notes: `Missing ${pluginJsonPath}` };
    }
    const raw = await fs.readFile(pluginJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.id !== "memory-lancedb-project") {
      return { status: "fail", notes: `Unexpected plugin id ${JSON.stringify(parsed.id)}` };
    }
    const otherExt = ctx?.env?.extensions?.entries?.includes("memory-lancedb") === true;
    if (otherExt) {
      return {
        status: "fail",
        notes: "Duplicate discovered extension memory-lancedb present alongside project extension.",
      };
    }
    return {
      status: "pass",
      evidence: [
        { label: "plugin id", value: parsed.id },
        { label: "kind", value: parsed.kind },
        { label: "duplicate stock extension present", value: false },
      ],
    };
  },
});

// -- Source-level fail-closed session mapping ---------------------------------

defineCheck({
  id: "memory-firewall.source-fail-closed-inventory",
  name: "extension source contains fail-closed session mapping and exact projectId filters",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "inventory",
  requires: ["memory.project-plugin"],
  automated: "auto",
  async run() {
    const indexTs = path.join(HOME, "extensions", "memory-lancedb-project", "index.ts");
    if (!existsSync(indexTs)) {
      return { status: "fail", notes: `Missing ${indexTs}` };
    }
    const src = await fs.readFile(indexTs, "utf8");
    const evidence = [
      {
        label: "resolveProjectId returns null on missing sessionKey",
        value: /if\s*\(\s*!sessionKey\s*\)\s*\{\s*return null/.test(src),
      },
      {
        label: "returns null on empty short session key",
        value: /shortSessionKey.*return null/s.test(src),
      },
      {
        label: "opens conversations.db read-only",
        value: /new DatabaseSync\([^)]*readOnly:\s*true/.test(src),
      },
      {
        label: "filters by projectId in search",
        value: /projectId\s*=\s*\$\{quoteSqlString\(projectId\)\}/.test(src),
      },
      {
        label: "delete predicate scoped by projectId",
        value:
          /predicate\s*=\s*`id\s*=\s*\$\{quoteSqlString\(id\)\}\s+AND\s+projectId\s*=\s*\$\{quoteSqlString\(projectId\)/.test(
            src,
          ),
      },
      {
        label: "fail-closed scope resolution (agentId && projectId)",
        value: /agentId\s*&&\s*projectId\s*\?[^:]+:\s*null/.test(src),
      },
    ];
    const missing = evidence.filter((e) => !e.value).map((e) => e.label);
    if (missing.length > 0) {
      return {
        status: "fail",
        evidence,
        notes: `Fail-closed invariant missing in source: ${missing.join("; ")}`,
      };
    }
    return {
      status: "pass",
      evidence,
      notes:
        "Source inventory OK — this is not proof of runtime behavior; see memory-firewall.current-runtime-evidence and memory-firewall.isolated-suite-behavior.",
    };
  },
});

// -- projectId REQUIRED in memory schema (inventory only) ---------------------

defineCheck({
  id: "memory-schema.projectId-required-inventory",
  name: "memory table schema requires projectId column",
  groups: ["memory-schema"],
  matrixIds: ["MEM-01"],
  kind: "inventory",
  requires: ["memory.project-plugin"],
  automated: "auto",
  async run() {
    // The projectDbPath in the plugin config is a POINTER to conversations.db;
    // it does NOT define the memory schema. The memory schema is enforced in
    // the extension's index.ts (see how it creates the table and refuses if
    // projectId/agentId columns are absent).
    const indexTs = path.join(HOME, "extensions", "memory-lancedb-project", "index.ts");
    if (!existsSync(indexTs)) {
      return { status: "fail", notes: "Extension index.ts missing" };
    }
    const src = await fs.readFile(indexTs, "utf8");
    const hasSchemaGuard = /existing memories table is missing projectId or agentId/.test(src);
    const declaresProjectIdField = /projectId:\s*string/.test(src) || /projectId\s*=\s*/.test(src);
    if (!hasSchemaGuard || !declaresProjectIdField) {
      return {
        status: "fail",
        notes: "Extension index.ts does not enforce a projectId column on the memories table.",
        evidence: [
          { label: "schema-guard present", value: hasSchemaGuard },
          { label: "projectId declared", value: declaresProjectIdField },
        ],
      };
    }
    return {
      status: "pass",
      evidence: [
        { label: "schema-guard present", value: true },
        { label: "projectId declared", value: true },
      ],
    };
  },
});

// -- Behavior: session mapping DB has the required schema/columns -------------

defineCheck({
  id: "memory-schema.session-mapping-behavior",
  name: "conversations.db sessions table exposes the columns project resolution needs",
  groups: ["memory-schema"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  requires: ["sqlite.readonly"],
  automated: "auto",
  async run(ctx) {
    const meta = ctx?.env?.workspaceDb;
    if (!meta || meta.error) {
      return {
        status: "fail",
        notes: `workspace/conversations.db not readable: ${meta?.error ?? "unknown"}`,
      };
    }
    if (!(meta.sizeBytes > 0)) {
      return { status: "fail", notes: `Session mapping db is empty: ${JSON.stringify(meta)}` };
    }
    let db;
    try {
      db = new DatabaseSync(WORKSPACE_DB, { readOnly: true });
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','projects')",
        )
        .all();
      const tableSet = new Set(tables.map((t) => t.name));
      if (!tableSet.has("sessions")) {
        return { status: "fail", notes: "sessions table missing from conversations.db" };
      }
      if (!tableSet.has("projects")) {
        return { status: "fail", notes: "projects table missing from conversations.db" };
      }
      const sessionsCols = db
        .prepare("PRAGMA table_info(sessions)")
        .all()
        .map((r) => r.name);
      const need = ["session_key", "project_id", "agent_id"];
      const missing = need.filter((n) => !sessionsCols.includes(n));
      if (missing.length > 0) {
        return { status: "fail", notes: `sessions table missing columns: ${missing.join(", ")}` };
      }
      const projectsCols = db
        .prepare("PRAGMA table_info(projects)")
        .all()
        .map((r) => r.name);
      const projectsMissing = ["id", "name"].filter((n) => !projectsCols.includes(n));
      if (projectsMissing.length > 0) {
        return {
          status: "fail",
          notes: `projects table missing columns: ${projectsMissing.join(", ")}`,
        };
      }
      return {
        status: "pass",
        evidence: [
          { label: "sessions columns", value: sessionsCols.slice(0, 12) },
          { label: "projects columns", value: projectsCols.slice(0, 12) },
        ],
      };
    } catch (err) {
      return { status: "fail", notes: `sqlite probe error: ${err?.message ?? err}` };
    } finally {
      db?.close?.();
    }
  },
});

// -- Evidence: immutable canary checkpoint for THIS baseline only -------------

defineCheck({
  id: "memory-firewall.current-runtime-evidence",
  name: "Immutable canary checkpoint proves 13 assertions and zero residual rows (CURRENT baseline only)",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "evidence",
  automated: "auto",
  async run() {
    if (!existsSync(CANARY_CHECKPOINT_DIR)) {
      return { status: "fail", notes: `Checkpoint dir missing: ${CANARY_CHECKPOINT_DIR}` };
    }
    const manifest = path.join(CANARY_CHECKPOINT_DIR, "SHA256SUMS");
    const canary = path.join(CANARY_CHECKPOINT_DIR, "live-canary-result.json");
    if (!existsSync(manifest)) {
      return { status: "fail", notes: `SHA256SUMS manifest missing: ${manifest}` };
    }
    if (!existsSync(canary)) {
      return { status: "fail", notes: `live-canary-result.json missing: ${canary}` };
    }

    const manifestText = await fs.readFile(manifest, "utf8");
    const entries = manifestText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
        return m ? { sha256: m[1], name: m[2] } : null;
      })
      .filter(Boolean);
    if (entries.length === 0) {
      return { status: "fail", notes: `Manifest has no entries: ${manifest}` };
    }

    // Verify every file in the manifest matches its SHA256. We ONLY hash files
    // referenced in the manifest — this is the closed set that constitutes
    // "the immutable checkpoint".
    const mismatches = [];
    for (const e of entries) {
      const p = path.join(CANARY_CHECKPOINT_DIR, e.name);
      if (!existsSync(p)) {
        mismatches.push({ file: e.name, error: "missing" });
        continue;
      }
      const hash = crypto.createHash("sha256");
      await new Promise((resolve, reject) => {
        const s = createReadStream(p);
        s.on("data", (chunk) => hash.update(chunk));
        s.on("end", resolve);
        s.on("error", reject);
      });
      const got = hash.digest("hex");
      if (got !== e.sha256) {
        mismatches.push({ file: e.name, expected: e.sha256, got });
      }
    }
    if (mismatches.length > 0) {
      return {
        status: "fail",
        notes: `Checkpoint tampered: ${mismatches.length} SHA256 mismatch(es)`,
        evidence: [{ label: "mismatches", value: mismatches }],
      };
    }

    const canaryDoc = JSON.parse(await fs.readFile(canary, "utf8"));
    if (canaryDoc.ok !== true) {
      return { status: "fail", notes: `Canary result not OK: ${JSON.stringify(canaryDoc)}` };
    }
    if (canaryDoc.assertions !== 13) {
      return {
        status: "fail",
        notes: `Canary assertion count is ${canaryDoc.assertions}, expected 13`,
      };
    }
    if (canaryDoc.remainingCanaryRows !== 0) {
      return { status: "fail", notes: `Canary residual rows: ${canaryDoc.remainingCanaryRows}` };
    }

    return {
      status: "pass",
      evidence: [
        { label: "checkpoint dir", value: CANARY_CHECKPOINT_DIR },
        { label: "manifest files verified", value: entries.length },
        { label: "assertions", value: canaryDoc.assertions },
        { label: "projects", value: canaryDoc.projects },
        { label: "residual rows", value: canaryDoc.remainingCanaryRows },
      ],
      notes:
        "Evidence class only. Authoritative for the CURRENT baseline; the target baseline requires a fresh evidence artifact.",
    };
  },
});

// -- Manual: subagent announcement idempotency --------------------------------

defineCheck({
  id: "memory-firewall.subagent-idempotency-manual",
  name: "Subagent announcement is idempotent; same subagent does not multi-register",
  groups: ["memory-firewall"],
  matrixIds: ["UM-06c"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging session capable of triggering subagent announcement more than once.",
    ],
    steps: [
      "Force N=3 subagent announcements for the same subagent identity in rapid succession.",
      "Inspect the runtime state to confirm the subagent registers exactly once.",
    ],
    expected: "Only one subagent record exists after the repeated announcements.",
    evidence: ["Runtime state before/after; subagent registry snapshot."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: ["one subagent registry entry"],
      cleanupRollback: ["deregister the canary subagent after verification"],
      evidenceCapture: ["registry snapshot", "state diff"],
    },
  },
});

// -- Manual: target-runtime evidence (must be a NEW artifact) -----------------

defineCheck({
  id: "memory-firewall.target-runtime-manual",
  name: "Target runtime canary evidence artifact must be produced fresh; current baseline does NOT count",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "evidence",
  automated: "manual",
  manual: {
    prerequisites: [
      "The target-runtime canary artifact directory (fresh timestamp) with a SHA256SUMS manifest and live-canary-result.json produced against the target runtime.",
      "The manifest MUST NOT reuse the current baseline directory memory-firewall-20260727-125533; a new UPGRADE_CHECKPOINT is required.",
    ],
    steps: [
      "Rerun the canary suite against the target runtime.",
      "Publish the new artifact directory under ~/.openclaw/upgrade-checkpoints/memory-firewall-<target-ts>/ with SHA256SUMS.",
      "Point the target-runtime evidence checker at the new path.",
    ],
    expected:
      "A fresh evidence directory exists with 13-assertion PASS and zero residual rows for the TARGET runtime.",
    evidence: ["New artifact directory path and manifest SHA256s."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["target-runtime canary rows created and deleted"],
      cleanupRollback: ["delete every UUID-tagged canary row", "verify residual==0"],
      evidenceCapture: ["new artifact directory", "manifest SHA256s"],
    },
  },
});
