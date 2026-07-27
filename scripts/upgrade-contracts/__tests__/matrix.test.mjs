// Deterministic tests for matrix validation, coverage, and gate decision.

import assert from "node:assert/strict";
import test from "node:test";
import { decideGate } from "../lib/gate.mjs";
import {
  validateMatrix,
  validateBidirectionalMapping,
  summarizeMatrixCoverage,
} from "../lib/matrix.mjs";

const goodMatrix = {
  schemaVersion: "openclaw-preservation-matrix/v2",
  rows: [
    {
      id: "R-1",
      commit: "1f5e68cda9e8",
      phase: "1",
      groups: ["g"],
      audit: "a",
      intent: "i",
      state: "test-only",
      checks: ["c1"],
    },
    {
      id: "R-2",
      commit: null,
      phase: "1",
      groups: ["g"],
      audit: "a",
      intent: "i",
      state: "ported_tested",
      checks: ["c2"],
    },
  ],
};

test("validateMatrix accepts a good matrix", () => {
  const r = validateMatrix(goodMatrix, { checkIds: new Set(["c1", "c2"]) });
  assert.equal(r.ok, true);
});

test("validateMatrix rejects unknown state and invalid commit", () => {
  const bad = {
    schemaVersion: "openclaw-preservation-matrix/v2",
    rows: [
      {
        id: "R-3",
        commit: "not-a-sha",
        phase: "1",
        groups: ["g"],
        audit: "a",
        intent: "i",
        state: "green",
        checks: ["c1"],
      },
    ],
  };
  const r = validateMatrix(bad, { checkIds: new Set(["c1"]) });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /invalid state/.test(e)));
  assert.ok(r.errors.some((e) => /invalid commit sha/.test(e)));
});

test("validateMatrix rejects duplicate ids and dangling checks", () => {
  const bad = {
    schemaVersion: "openclaw-preservation-matrix/v2",
    rows: [
      {
        id: "R-1",
        commit: null,
        phase: "1",
        groups: ["g"],
        audit: "a",
        intent: "i",
        state: "assumed",
        checks: ["c1"],
      },
      {
        id: "R-1",
        commit: null,
        phase: "1",
        groups: ["g"],
        audit: "a",
        intent: "i",
        state: "assumed",
        checks: ["c2"],
      },
    ],
  };
  const r = validateMatrix(bad, { checkIds: new Set(["c1"]) });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /duplicate row id/.test(e)));
  assert.ok(r.errors.some((e) => /dangling/.test(e)));
});

test("validateMatrix rejects bad schemaVersion", () => {
  const r = validateMatrix({ schemaVersion: "wrong", rows: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /schemaVersion invalid/.test(e)));
});

test("validateBidirectionalMapping catches asymmetric refs", () => {
  const checks = [
    { id: "c1", matrixIds: ["R-1"] },
    { id: "c2", matrixIds: ["R-2"] },
    { id: "c3", matrixIds: ["R-does-not-exist"] },
  ];
  const r = validateBidirectionalMapping(goodMatrix, checks);
  assert.equal(r.ok, false);
  // c3 dangling to nonexistent row
  assert.ok(r.errors.some((e) => /R-does-not-exist/.test(e)));
});

test("summarizeMatrixCoverage reports per-class pass and nonterminal counts", () => {
  const results = [
    { id: "c1", status: "pass", kind: "inventory", matrixIds: ["R-1"] },
    { id: "c2", status: "pass", kind: "behavior", matrixIds: ["R-2"] },
  ];
  const cov = summarizeMatrixCoverage(goodMatrix, results);
  assert.equal(cov.totalRows, 2);
  assert.equal(cov.stateNonterminal, 1); // R-1 is test-only
  assert.equal(cov.stateTerminal, 1); // R-2 is ported_tested
  assert.equal(cov.behaviorPass, 1);
  assert.equal(cov.inventoryPass, 1);
});

test("decideGate blocks on filtered run and nonterminal state", () => {
  const g = decideGate({
    filtered: true,
    results: [],
    matrixCoverage: { uncoveredCheckIds: [], stateNonterminal: 1, stateTerminal: 0 },
    matrixValidation: { ok: true, errors: [] },
    bidirectionalValidation: { ok: true, errors: [] },
    manualSafetyViolations: [],
  });
  assert.equal(g.passed, false);
  assert.ok(g.blockers.some((b) => b.code === "filtered-run"));
  assert.ok(g.blockers.some((b) => b.code === "matrix-nonterminal"));
});

test("decideGate blocks on fail/skip/manual/uncovered", () => {
  const g = decideGate({
    filtered: false,
    results: [
      { id: "c1", status: "fail", notes: "boom" },
      { id: "c2", status: "skip", skipReason: "cap missing" },
      { id: "c3", status: "manual" },
    ],
    matrixCoverage: {
      uncoveredCheckIds: [{ row: "R-x", missing: ["c-x"] }],
      stateNonterminal: 0,
      stateTerminal: 0,
    },
    matrixValidation: { ok: true, errors: [] },
    bidirectionalValidation: { ok: true, errors: [] },
    manualSafetyViolations: [],
  });
  const codes = new Set(g.blockers.map((b) => b.code));
  assert.ok(codes.has("check-fail"));
  assert.ok(codes.has("check-skip"));
  assert.ok(codes.has("check-manual"));
  assert.ok(codes.has("matrix-uncovered"));
  assert.equal(g.passed, false);
});

test("decideGate passes when nothing pending, terminal, and all pass", () => {
  const g = decideGate({
    filtered: false,
    results: [{ id: "c1", status: "pass" }],
    matrixCoverage: { uncoveredCheckIds: [], stateNonterminal: 0, stateTerminal: 1 },
    matrixValidation: { ok: true, errors: [] },
    bidirectionalValidation: { ok: true, errors: [] },
    manualSafetyViolations: [],
  });
  assert.equal(g.passed, true);
  assert.equal(g.blockers.length, 0);
});
