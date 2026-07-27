// Memory firewall checks. The plan makes this a HARD boundary:
//   * project-scoped memory extension is the ONLY memory plugin active;
//   * source-level fail-closed session mapping and exact projectId filters;
//   * effective plugin config verifies the project extension is enabled and
//     the stock memory-lancedb is not simultaneously configured;
//   * an immutable canary evidence artifact (SHA256-manifested checkpoint)
//     attests to a 13-assertion, zero-residual-row live run for THIS current
//     baseline only. The target baseline REQUIRES a new artifact.
//
// All cross-project / cross-agent / main-bypass / blank-legacy / concurrency /
// duplicate / foreign-delete / cleanup / unknown-session behaviors ship as
// MANUAL contracts referencing pre-existing mapped staging/test sessions plus
// UUID-tagged canary rows. Manual instructions never invoke impossible
// synthetic projectIds.

import crypto from "node:crypto";
import { promises as fs, existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HOME, WORKSPACE_DB, CHECKPOINT_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

const CANARY_CHECKPOINT_DIR = path.join(CHECKPOINT_ROOT, "memory-firewall-20260727-125533");

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
        "Source inventory OK — this is not proof of runtime behavior; see memory-firewall.current-runtime-evidence and manual contracts.",
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

// -- Manual: same-text cross-project (uses mapped staging sessions + UUID) -----

function stagingOptInInstruction() {
  return "Use pre-existing mapped staging/test sessions from conversations.db (e.g. two distinct project_ids that already resolve). Never invent a synthetic projectId — the fail-closed path is deliberately rigged to return null for unknown sessions, so a synthetic id cannot exercise the cross-project semantic.";
}

defineCheck({
  id: "memory-firewall.same-text-cross-project-manual",
  name: "Same-text memory is isolated across two mapped staging projects",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Two pre-existing mapped staging sessions belonging to two distinct project_ids present in conversations.db (verify via SELECT DISTINCT project_id FROM sessions).",
      stagingOptInInstruction(),
    ],
    steps: [
      "In staging project A's session, call memory_store with content prefixed by a reserved canary tag: openclaw-canary-upgrade-<uuid>.",
      "In staging project B's session, call memory_recall on the same exact text.",
      "In staging project B, call memory_recall broadly (empty query, large limit) to force a max-recall scan.",
      "Explicitly delete the canary row in project A (memory_forget by exact tag).",
      "Re-run memory_recall in project A to prove the row is gone.",
    ],
    expected:
      "memory_recall in project B returns zero rows referencing project A content, both exact-text and broad scan. Explicit delete succeeds; no residual rows.",
    evidence: [
      "Redacted memory_recall responses from both projects.",
      "LanceDB row-count deltas before/after cleanup via the extension admin API.",
      "openclaw-agent audit log fragment showing the resolved projectId per call.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one canary row in project A, deleted at cleanup"],
      cleanupRollback: [
        "memory_forget canary row after test",
        "assert row count returns to baseline",
      ],
      evidenceCapture: ["redacted responses", "row-count deltas", "audit log fragment"],
    },
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

// -- Manual: same-project cross-agent leak -------------------------------------

defineCheck({
  id: "memory-firewall.same-project-cross-agent-manual",
  name: "Within a single project, agent A memories do not leak to agent B",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01", "UM-06a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "One mapped staging project with two agents (agent_id A and B) that both have real sessions in conversations.db.",
    ],
    steps: [
      "As agent A in staging project P, memory_store a UUID-tagged canary row.",
      "As agent B in the same project P, memory_recall on the exact same tag.",
      "Also memory_recall broadly.",
      "Delete the canary row as agent A.",
    ],
    expected: "Agent B does not see agent A's row even inside the shared project.",
    evidence: ["Redacted responses; scope resolution log lines from the extension."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one canary row for agent A in project P, deleted at cleanup"],
      cleanupRollback: ["memory_forget canary row", "verify residual==0"],
      evidenceCapture: ["responses", "scope resolution log"],
    },
  },
});

// -- Manual: main agent bypass -------------------------------------------------

defineCheck({
  id: "memory-firewall.main-bypass-manual",
  name: "The 'main' agent does not bypass project scoping",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "One mapped staging project P (not 'main').",
      "A live gateway session for the 'main' agent (agent_id=main) in conversations.db.",
    ],
    steps: [
      "From staging project P, memory_store a UUID-tagged canary row.",
      "Switch to a session whose sessionKey resolves to the 'main' agent.",
      "memory_recall broadly.",
      "Delete the canary row from staging project P.",
    ],
    expected: "The 'main' agent does not see the canary row via any implicit shared-memory path.",
    evidence: [
      "Redacted responses; the resolved projectId for the 'main' session as reported by the extension.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one canary row in project P, deleted at cleanup"],
      cleanupRollback: ["memory_forget canary row", "verify residual==0"],
      evidenceCapture: ["responses", "resolved projectId"],
    },
  },
});

// -- Manual: blank/global legacy rows do not bypass ----------------------------

defineCheck({
  id: "memory-firewall.blank-global-legacy-manual",
  name: "Blank/global legacy rows (empty projectId) cannot bypass project scoping",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A LanceDB admin able to insert a probe row with projectId='' or projectId is NULL (via the extension admin API only) into a disposable table.",
    ],
    steps: [
      "Insert one legacy-style probe row with empty projectId AND known tag openclaw-canary-upgrade-<uuid> (only via admin API; never by hand-editing storage).",
      "From any mapped staging session, memory_recall broadly.",
      "Delete the legacy-style probe row via admin API.",
    ],
    expected:
      "The legacy row is not returned by memory_recall from any mapped session; direct admin cleanup succeeds.",
    evidence: [
      "Redacted admin API responses (insert/query/delete).",
      "LanceDB row-count deltas before/after.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one legacy probe row, deleted at cleanup"],
      cleanupRollback: ["admin delete probe row", "verify residual==0"],
      evidenceCapture: ["admin API responses", "row-count deltas"],
    },
  },
});

// -- Manual: concurrent writers ------------------------------------------------

defineCheck({
  id: "memory-firewall.concurrency-manual",
  name: "Concurrent memory_store writers cannot corrupt project scoping",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Two mapped staging sessions (may be same or different agents/projects) able to issue simultaneous memory_store calls.",
    ],
    steps: [
      "Issue N=10 concurrent memory_store calls with distinct UUID tags across both sessions.",
      "memory_recall broadly from each session; verify only the calling scope sees its own tags.",
      "Delete every canary row created.",
    ],
    expected:
      "Concurrent writes do not leak across scope; every row is deleted at the end and residual is zero.",
    evidence: ["Full memory_recall responses; row-count deltas; cleanup verification."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["N canary rows created and deleted"],
      cleanupRollback: ["delete every UUID-tagged canary row", "verify residual==0"],
      evidenceCapture: ["responses", "row-count deltas"],
    },
  },
});

// -- Manual: duplicate insert into the same tag --------------------------------

defineCheck({
  id: "memory-firewall.duplicate-manual",
  name: "Duplicate-insert of the same canary tag is handled deterministically",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["One mapped staging session."],
    steps: [
      "memory_store the same canary tag twice back-to-back.",
      "memory_recall on the tag.",
      "Delete the canary rows and verify none remain.",
    ],
    expected:
      "Duplicate insert has a documented outcome (dedupe or explicit duplicate row) and cleanup removes every trace.",
    evidence: ["Redacted memory_recall/memory_forget responses."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one or two canary rows, then all deleted"],
      cleanupRollback: ["delete every duplicate row", "verify residual==0"],
      evidenceCapture: ["responses"],
    },
  },
});

// -- Manual: foreign delete ---------------------------------------------------

defineCheck({
  id: "memory-firewall.foreign-delete-manual",
  name: "Foreign projectId cannot delete another project's memories",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Two mapped staging projects A and B, each with one canary row."],
    steps: [
      "From staging project A, call memory_forget with the tag belonging to staging project B.",
      "From staging project B, memory_recall to verify the row still exists.",
      "From staging project B, memory_forget with the correct tag.",
    ],
    expected:
      "Cross-project delete is refused; project B's row remains; only owning project can delete its own row.",
    evidence: ["Full memory_forget and memory_recall responses; LanceDB row-count deltas."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one canary row in each staging project, deleted at cleanup"],
      cleanupRollback: ["delete own canary row", "verify residual==0"],
      evidenceCapture: ["responses", "row-count deltas"],
    },
  },
});

// -- Manual: unknown session fail-closed --------------------------------------

defineCheck({
  id: "memory-firewall.unknown-session-fail-closed-manual",
  name: "Unknown session fails closed; no silent memory return",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Access to submit a memory_store / memory_recall call with a sessionKey that does NOT exist in conversations.db.",
      "Access to gateway logs for the same window; the gateway must NOT be restarted.",
    ],
    steps: [
      "Submit memory_store with an unknown sessionKey (openclaw-unknown-<uuid>).",
      "Submit memory_recall with the same unknown sessionKey.",
      "Capture the gateway logs and the tool responses.",
    ],
    expected:
      "Both calls fail closed. No project-A row is exposed as fallback; no write is persisted.",
    evidence: ["Redacted gateway log excerpts; tool responses proving zero rows returned/written."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["confirm no row was persisted"],
      evidenceCapture: ["gateway log excerpt", "tool responses"],
    },
  },
});

// -- Manual: cleanup path -----------------------------------------------------

defineCheck({
  id: "memory-firewall.cleanup-manual",
  name: "Explicit cleanup returns residual rows to zero for the tested tag family",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Any mapped staging project."],
    steps: [
      "Create N=3 canary rows with reserved openclaw-canary-upgrade-<uuid> tags.",
      "Verify their presence via memory_recall.",
      "Call memory_forget for each tag.",
      "Verify residual == 0 via the extension admin API.",
    ],
    expected: "All rows are removed; residual count is exactly zero.",
    evidence: ["memory_recall snapshots before/after; residual count."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["N canary rows, all deleted"],
      cleanupRollback: ["memory_forget every UUID tag", "verify residual==0"],
      evidenceCapture: ["responses", "residual count"],
    },
  },
});

// -- Manual: executable / copied-state isolation contracts (pending) ----------

defineCheck({
  id: "memory-firewall.executable-isolation-manual",
  name: "Executable/copied-state isolation between running gateway and any copied working set",
  groups: ["memory-firewall"],
  matrixIds: ["MEM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Ability to identify the running gateway process and any copied/detached memory state on the host.",
    ],
    steps: [
      "Enumerate the memory DB paths referenced by the running gateway.",
      "Verify no additional writable copy of the LanceDB directory is being loaded by any other process.",
      "If a copied state exists (backup, snapshot), verify it is not being registered as a live memory backend.",
    ],
    expected:
      "Only one live LanceDB store is active; copies are dormant and cannot bleed writes into the live scope.",
    evidence: ["Process listing referencing DB paths; ls of memory dirs; extension config path."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["no mutation; observational check"],
      evidenceCapture: ["process listing", "directory listings"],
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
