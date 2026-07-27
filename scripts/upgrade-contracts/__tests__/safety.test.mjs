// Deterministic tests for the manual-safety validator.

import assert from "node:assert/strict";
import test from "node:test";
import { validateManualSafety, assertAllManualsSafe } from "../lib/safety.mjs";

const safeManual = {
  automated: "manual",
  manual: {
    prerequisites: ["staging session"],
    steps: ["memory_store a UUID-tagged canary row", "verify"],
    expected: "no leak",
    evidence: ["responses"],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["canary row"],
      cleanupRollback: ["delete row"],
      evidenceCapture: ["response"],
    },
  },
};

const unsafeManual = {
  automated: "manual",
  manual: {
    prerequisites: [],
    steps: ["send a prompt and login to Slack"],
    expected: "message posted",
    evidence: ["evidence"],
  },
};

test("safe manual passes validator", () => {
  const v = validateManualSafety({ ...safeManual, id: "safe1" });
  assert.equal(v.ok, true);
});

test("unsafe manual is caught", () => {
  const v = validateManualSafety({ ...unsafeManual, id: "unsafe1" });
  assert.equal(v.ok, false);
  assert.ok(v.missing.length > 0);
});

test("rejects hand-editing live credentials", () => {
  const bad = {
    id: "handedit1",
    automated: "manual",
    manual: {
      prerequisites: [],
      steps: ["hand-edit the credentials file to force burn"],
      expected: "burn",
      evidence: [],
      safety: {
        stagingOnly: true,
        mutatesData: true,
        changesAuth: true,
        expectedMutations: ["credentials"],
        cleanupRollback: ["restore"],
        evidenceCapture: ["log"],
      },
    },
  };
  const v = validateManualSafety(bad);
  assert.equal(v.ok, false);
  assert.ok(v.missing.some((m) => /hand-editing live credentials/.test(m)));
});

test("assertAllManualsSafe aggregates violations", () => {
  const violations = assertAllManualsSafe([
    { ...safeManual, id: "ok1" },
    { ...unsafeManual, id: "unsafe1" },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].id, "unsafe1");
});
