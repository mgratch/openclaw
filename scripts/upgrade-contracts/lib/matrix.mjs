// Preservation-matrix loader + validator.
//
// The matrix is the source of truth for what has to survive the upgrade.
// It is the *only* place the state of a row can be recorded — checks report
// evidence, but they cannot advance a row past `test-only` on their own.
//
// This validator enforces:
//   * schemaVersion presence and format;
//   * unique row IDs;
//   * allowed states (terminal + intermediate);
//   * required fields per row;
//   * commit SHA format (when a commit is claimed);
//   * bidirectional coverage — every row.checks[] id must exist in the check
//     registry, and every check.matrixIds[] must exist in the matrix;
//   * detection of dangling / mismatched mappings.
//
// Nothing here decides whether the gate passes. That is `gate.mjs`.

const REQUIRED_ROW_FIELDS = ["id", "phase", "groups", "audit", "intent", "state", "checks"];
const ALLOWED_STATES = new Set([
  "assumed",
  "test-only",
  "upstream_equivalent_tested",
  "ported_tested",
  "retired_with_marc_approval",
]);
const TERMINAL_STATES = new Set([
  "upstream_equivalent_tested",
  "ported_tested",
  "retired_with_marc_approval",
]);
const NONTERMINAL_STATES = new Set(["assumed", "test-only"]);
const SHORT_SHA = /^[0-9a-f]{7,40}$/;
const SCHEMA_VERSION = /^openclaw-preservation-matrix\/v\d+$/;

export function isTerminalState(s) {
  return TERMINAL_STATES.has(s);
}

export function isNonterminalState(s) {
  return NONTERMINAL_STATES.has(s);
}

export function validateMatrix(matrix, { checkIds = new Set() } = {}) {
  const errors = [];
  const warnings = [];

  if (!matrix || typeof matrix !== "object") {
    return { ok: false, errors: ["matrix is not an object"], warnings: [] };
  }
  if (typeof matrix.schemaVersion !== "string" || !SCHEMA_VERSION.test(matrix.schemaVersion)) {
    errors.push(`matrix.schemaVersion invalid: ${JSON.stringify(matrix.schemaVersion)}`);
  }
  if (!Array.isArray(matrix.rows)) {
    errors.push("matrix.rows must be an array");
    return { ok: false, errors, warnings };
  }

  const seen = new Set();
  const referencedCheckIds = new Set();
  const rowIds = new Set();
  for (const row of matrix.rows) {
    if (!row || typeof row !== "object") {
      errors.push("row is not an object");
      continue;
    }
    for (const f of REQUIRED_ROW_FIELDS) {
      if (row[f] === undefined) {
        errors.push(`row ${row.id ?? "(no-id)"} missing field ${f}`);
      }
    }
    if (typeof row.id !== "string") {
      continue;
    }
    if (seen.has(row.id)) {
      errors.push(`duplicate row id: ${row.id}`);
    }
    seen.add(row.id);
    rowIds.add(row.id);

    if (!ALLOWED_STATES.has(row.state)) {
      errors.push(`row ${row.id} has invalid state ${JSON.stringify(row.state)}`);
    }
    if (Object.prototype.hasOwnProperty.call(row, "commit") && row.commit !== null) {
      if (typeof row.commit !== "string" || !SHORT_SHA.test(row.commit)) {
        errors.push(`row ${row.id} has invalid commit sha ${JSON.stringify(row.commit)}`);
      }
    }
    if (!Array.isArray(row.groups) || row.groups.length === 0) {
      errors.push(`row ${row.id} must have at least one group`);
    }
    if (!Array.isArray(row.checks) || row.checks.length === 0) {
      errors.push(`row ${row.id} must reference at least one check id`);
    } else {
      for (const cid of row.checks) {
        if (typeof cid !== "string") {
          errors.push(`row ${row.id} check id is not a string`);
          continue;
        }
        referencedCheckIds.add(cid);
        if (checkIds.size > 0 && !checkIds.has(cid)) {
          errors.push(`row ${row.id} references nonexistent check id ${cid} (dangling)`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    rowIds,
    referencedCheckIds,
  };
}

export function validateBidirectionalMapping(matrix, checks) {
  const errors = [];
  const rowIds = new Set(matrix.rows.map((r) => r.id));
  const rowToChecks = new Map(matrix.rows.map((r) => [r.id, new Set(r.checks ?? [])]));
  const checkById = new Map(checks.map((c) => [c.id, c]));

  // Every check.matrixIds must exist in the matrix, and the row must list the
  // check id in its checks[] array.
  for (const check of checks) {
    for (const rid of check.matrixIds) {
      if (!rowIds.has(rid)) {
        errors.push(`check ${check.id} references nonexistent matrix row ${rid} (dangling)`);
        continue;
      }
      const rowChecks = rowToChecks.get(rid);
      if (!rowChecks?.has(check.id)) {
        errors.push(
          `check ${check.id} claims matrix row ${rid} but row.checks[] does not list ${check.id}`,
        );
      }
    }
  }

  // Every row.checks[] must resolve to a real registered check.
  for (const row of matrix.rows) {
    for (const cid of row.checks ?? []) {
      if (!checkById.has(cid)) {
        errors.push(`row ${row.id} references check ${cid} which is not registered`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function summarizeMatrixCoverage(matrix, results) {
  const rows = matrix.rows;
  const resultById = new Map(results.map((r) => [r.id, r]));

  const rowStates = {
    covered: 0,
    uncoveredCheckIds: [],
    behaviorPass: 0,
    inventoryPass: 0,
    evidencePass: 0,
    manualPending: 0,
    failed: 0,
    skipped: 0,
    stateNonterminal: 0,
    stateTerminal: 0,
  };
  const perRow = [];

  for (const row of rows) {
    const checkIds = row.checks ?? [];
    const resolved = checkIds.map((id) => resultById.get(id)).filter(Boolean);
    const missing = checkIds.filter((id) => !resultById.has(id));
    const rowSummary = {
      id: row.id,
      state: row.state,
      matrixTerminal: TERMINAL_STATES.has(row.state),
      checks: checkIds.length,
      executed: resolved.length,
      missingInRun: missing,
      pass: resolved.filter((r) => r.status === "pass").length,
      fail: resolved.filter((r) => r.status === "fail").length,
      manual: resolved.filter((r) => r.status === "manual").length,
      skip: resolved.filter((r) => r.status === "skip").length,
      byClass: {
        behavior: resolved.filter((r) => r.status === "pass" && r.kind === "behavior").length,
        inventory: resolved.filter((r) => r.status === "pass" && r.kind === "inventory").length,
        evidence: resolved.filter((r) => r.status === "pass" && r.kind === "evidence").length,
      },
    };
    perRow.push(rowSummary);
    if (resolved.length > 0 && missing.length === 0) {
      rowStates.covered++;
    }
    if (missing.length > 0) {
      rowStates.uncoveredCheckIds.push({ row: row.id, missing });
    }
    rowStates.behaviorPass += rowSummary.byClass.behavior;
    rowStates.inventoryPass += rowSummary.byClass.inventory;
    rowStates.evidencePass += rowSummary.byClass.evidence;
    rowStates.manualPending += rowSummary.manual;
    rowStates.failed += rowSummary.fail;
    rowStates.skipped += rowSummary.skip;
    if (TERMINAL_STATES.has(row.state)) {
      rowStates.stateTerminal++;
    } else if (NONTERMINAL_STATES.has(row.state)) {
      rowStates.stateNonterminal++;
    }
  }

  return {
    totalRows: rows.length,
    ...rowStates,
    perRow,
  };
}
