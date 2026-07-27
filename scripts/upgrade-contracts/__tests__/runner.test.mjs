// Deterministic tests for the runner. No live services, no real secrets.

import assert from "node:assert/strict";
import test from "node:test";
import {
  defineCheck,
  clearRegistry,
  getRegistry,
  runCheck,
  runChecks,
  summarize,
} from "../lib/runner.mjs";

const BASE = { groups: ["g"], matrixIds: ["M1"], kind: "inventory" };

test("defineCheck requires the kind field", () => {
  clearRegistry();
  assert.throws(
    () =>
      defineCheck({
        id: "a",
        name: "a",
        groups: ["g"],
        matrixIds: ["M1"],
        automated: "auto",
        async run() {
          return { status: "pass" };
        },
      }),
    /missing "kind"/,
  );
});

test("defineCheck rejects unknown kind", () => {
  clearRegistry();
  assert.throws(
    () =>
      defineCheck({
        id: "a",
        name: "a",
        ...BASE,
        kind: "other",
        automated: "auto",
        async run() {
          return { status: "pass" };
        },
      }),
    /invalid kind/,
  );
});

test("defineCheck rejects duplicate ids", () => {
  clearRegistry();
  defineCheck({
    id: "a",
    name: "a",
    ...BASE,
    automated: "auto",
    async run() {
      return { status: "pass" };
    },
  });
  assert.throws(
    () =>
      defineCheck({
        id: "a",
        name: "a2",
        ...BASE,
        automated: "auto",
        async run() {
          return { status: "pass" };
        },
      }),
    /Duplicate check id/,
  );
});

test("defineCheck rejects manual check without contract", () => {
  clearRegistry();
  assert.throws(
    () => defineCheck({ id: "m1", name: "m1", ...BASE, kind: "behavior", automated: "manual" }),
    /missing "manual" contract/,
  );
});

test("runCheck returns manual status for manual definitions", async () => {
  clearRegistry();
  const check = defineCheck({
    id: "m1",
    name: "manual check",
    ...BASE,
    kind: "behavior",
    automated: "manual",
    manual: { prerequisites: ["p1"], steps: ["s1"], expected: "e", evidence: ["ev"] },
  });
  const result = await runCheck(check, { capabilities: {} });
  assert.equal(result.status, "manual");
  assert.equal(result.kind, "behavior");
  assert.deepEqual(result.manual, check.manual);
});

test("runCheck honors skip via missing requires", async () => {
  clearRegistry();
  const check = defineCheck({
    id: "sk",
    name: "requires",
    ...BASE,
    automated: "auto",
    requires: ["capX"],
    async run() {
      return { status: "pass" };
    },
  });
  const result = await runCheck(check, { capabilities: {} });
  assert.equal(result.status, "skip");
  assert.ok(result.skipReason?.includes("capX"));
});

test("runCheck converts thrown error into fail with redacted-safe stack", async () => {
  clearRegistry();
  const check = defineCheck({
    id: "err",
    name: "throws",
    ...BASE,
    automated: "auto",
    async run() {
      throw new Error("boom");
    },
  });
  const result = await runCheck(check, { capabilities: {} });
  assert.equal(result.status, "fail");
  assert.match(result.error.message, /boom/);
});

test("runCheck refuses invalid auto status", async () => {
  clearRegistry();
  const check = defineCheck({
    id: "bad",
    name: "invalid",
    ...BASE,
    automated: "auto",
    async run() {
      return { status: "manual" };
    },
  });
  const result = await runCheck(check, { capabilities: {} });
  assert.equal(result.status, "fail");
});

test("summarize breaks down passes by class", async () => {
  clearRegistry();
  const behaviorPass = defineCheck({
    id: "bp",
    name: "bp",
    groups: ["g"],
    matrixIds: ["M"],
    kind: "behavior",
    automated: "auto",
    async run() {
      return { status: "pass" };
    },
  });
  const inventoryPass = defineCheck({
    id: "ip",
    name: "ip",
    groups: ["g"],
    matrixIds: ["M"],
    kind: "inventory",
    automated: "auto",
    async run() {
      return { status: "pass" };
    },
  });
  const evidencePass = defineCheck({
    id: "ep",
    name: "ep",
    groups: ["g"],
    matrixIds: ["M"],
    kind: "evidence",
    automated: "auto",
    async run() {
      return { status: "pass" };
    },
  });
  const failing = defineCheck({
    id: "f",
    name: "f",
    groups: ["g"],
    matrixIds: ["M"],
    kind: "behavior",
    automated: "auto",
    async run() {
      return { status: "fail" };
    },
  });
  const manual = defineCheck({
    id: "m",
    name: "m",
    groups: ["g"],
    matrixIds: ["M"],
    kind: "behavior",
    automated: "manual",
    manual: { prerequisites: [], steps: ["s"], expected: "x", evidence: [] },
  });
  const skipping = defineCheck({
    id: "s",
    name: "s",
    groups: ["g"],
    matrixIds: ["M"],
    kind: "behavior",
    automated: "auto",
    requires: ["missing"],
    async run() {
      return { status: "pass" };
    },
  });

  const results = await runChecks(
    [behaviorPass, inventoryPass, evidencePass, failing, manual, skipping],
    { capabilities: {} },
  );
  const summary = summarize(results);
  assert.equal(summary.total, 6);
  assert.equal(summary.pass, 3);
  assert.equal(summary.fail, 1);
  assert.equal(summary.skip, 1);
  assert.equal(summary.manual, 1);
  assert.deepEqual(summary.byClass, {
    behaviorPass: 1,
    inventoryPass: 1,
    evidencePass: 1,
    fail: 1,
    skip: 1,
    manual: 1,
  });
});

test("getRegistry lets callers introspect the check set", () => {
  clearRegistry();
  defineCheck({
    id: "one",
    name: "one",
    ...BASE,
    automated: "auto",
    async run() {
      return { status: "pass" };
    },
  });
  const items = getRegistry();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "one");
});
