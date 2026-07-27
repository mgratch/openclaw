// Deterministic tests for report rendering + atomic writes.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildJsonReport,
  renderMarkdownReport,
  SCHEMA_VERSION,
  writeAtomic,
} from "../lib/report.mjs";

function sampleReport(overrides = {}) {
  return buildJsonReport({
    runId: "test-run",
    startedAt: "2026-07-27T00:00:00Z",
    finishedAt: "2026-07-27T00:00:01Z",
    environment: { node: "24", token: "abc" },
    matrixValidation: { ok: true, errors: [] },
    bidirectionalValidation: { ok: true, errors: [] },
    manualSafetyViolations: [],
    matrixCoverage: {
      totalRows: 3,
      covered: 2,
      uncoveredCheckIds: [{ row: "MEM-01", missing: ["c"] }],
      stateNonterminal: 1,
      stateTerminal: 2,
      behaviorPass: 1,
      inventoryPass: 1,
      evidencePass: 0,
      manualPending: 1,
      failed: 1,
      skipped: 0,
      perRow: [],
    },
    summary: {
      total: 3,
      pass: 2,
      fail: 1,
      skip: 0,
      manual: 0,
      byClass: { behaviorPass: 1, inventoryPass: 1, evidencePass: 0, fail: 1, skip: 0, manual: 0 },
    },
    gate: { passed: false, blockers: [{ code: "check-fail", message: "two failed" }] },
    mode: "gate-strict",
    filtered: false,
    gitHead: "deadbeef",
    version: "2026.4.2",
    results: [
      {
        id: "one",
        name: "One",
        groups: ["g"],
        matrixIds: ["M1"],
        kind: "behavior",
        status: "pass",
        evidence: [{ label: "ok", value: "yes" }],
        durationMs: 1,
      },
      {
        id: "two",
        name: "Two",
        groups: ["g"],
        matrixIds: ["M2"],
        kind: "behavior",
        status: "fail",
        error: { name: "Error", message: "boom" },
        durationMs: 2,
      },
      {
        id: "three",
        name: "Three",
        groups: ["g"],
        matrixIds: ["MEM-01"],
        kind: "inventory",
        status: "pass",
        evidence: [],
        durationMs: 0,
      },
    ],
    ...overrides,
  });
}

test("buildJsonReport carries schema version and redacts environment", () => {
  const r = sampleReport();
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.environment.token, "<redacted:key>");
});

test("renderMarkdownReport separates evidence classes", () => {
  const md = renderMarkdownReport(sampleReport());
  assert.match(md, /## Summary by evidence class/);
  assert.match(md, /FAIL \(1\)/);
  assert.match(md, /BEHAVIOR PASS/);
  assert.match(md, /INVENTORY PASS/);
  assert.match(md, /Gate decision/);
});

test("writeAtomic writes with 0600 mode", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "uc-report-"));
  try {
    const target = path.join(dir, "out.txt");
    await writeAtomic(target, "hello");
    const st = await fs.stat(target);
    // Mask to file mode bits.
    const mode = st.mode & 0o777;
    assert.equal(mode, 0o600);
    const contents = await fs.readFile(target, "utf8");
    assert.equal(contents, "hello");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
