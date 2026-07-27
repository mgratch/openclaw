// Strict gate decision.
//
// The gate is the STRICT default for CLI usage. It fails whenever ANY of the
// following is true:
//
//   * a run was filtered (--filter, --only-groups) — a partial run is not a
//     full gate;
//   * any check ended in FAIL, SKIP, or MANUAL;
//   * any matrix row lacks executed coverage;
//   * any matrix mapping is dangling (row->check or check->row);
//   * any matrix state is nonterminal (assumed | test-only);
//   * an unsafe manual contract is registered.
//
// The report-only mode uses this same decision function but only surfaces the
// resulting blockers for reporting; it does NOT force a non-zero exit code.

export function decideGate({
  filtered,
  results,
  matrixCoverage,
  matrixValidation,
  bidirectionalValidation,
  manualSafetyViolations,
}) {
  const blockers = [];

  if (filtered) {
    blockers.push({
      code: "filtered-run",
      message:
        "Filtered/partial runs cannot qualify as a full gate. Rerun without --filter/--only-groups.",
    });
  }

  if (!matrixValidation.ok) {
    for (const e of matrixValidation.errors) {
      blockers.push({ code: "matrix-invalid", message: e });
    }
  }
  if (!bidirectionalValidation.ok) {
    for (const e of bidirectionalValidation.errors) {
      blockers.push({ code: "matrix-mapping", message: e });
    }
  }
  for (const v of manualSafetyViolations) {
    blockers.push({
      code: "manual-unsafe",
      message: `manual contract ${v.id} unsafe: ${v.missing.join("; ")}`,
    });
  }

  const fails = results.filter((r) => r.status === "fail");
  for (const r of fails) {
    blockers.push({
      code: "check-fail",
      message: `${r.id} FAILED: ${r.notes ?? r.error?.message ?? "no notes"}`,
    });
  }

  const skips = results.filter((r) => r.status === "skip");
  for (const r of skips) {
    blockers.push({
      code: "check-skip",
      message: `${r.id} SKIPPED: ${r.skipReason ?? "unknown skip"}`,
    });
  }

  const manuals = results.filter((r) => r.status === "manual");
  for (const r of manuals) {
    blockers.push({ code: "check-manual", message: `${r.id} pending manual attestation` });
  }

  if (matrixCoverage.uncoveredCheckIds.length > 0) {
    for (const u of matrixCoverage.uncoveredCheckIds) {
      blockers.push({
        code: "matrix-uncovered",
        message: `matrix row ${u.row} has check ids not present in this run: ${u.missing.join(", ")}`,
      });
    }
  }
  if (matrixCoverage.stateNonterminal > 0) {
    blockers.push({
      code: "matrix-nonterminal",
      message: `${matrixCoverage.stateNonterminal} matrix row(s) are still in nonterminal states (assumed|test-only). No row may advance without matrix update.`,
    });
  }

  return {
    passed: blockers.length === 0,
    blockers,
  };
}
