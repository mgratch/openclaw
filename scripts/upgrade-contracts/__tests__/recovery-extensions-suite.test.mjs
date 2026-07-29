// Deterministic tests for the recovery-extensions probe helper. These tests
// never spawn a real child process — they exercise the classifier, evidence
// shape, and fail-closed decisions via a stubbed runFn so the harness cost
// stays bounded and the check semantics remain covered.

import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_SCR_ASSERTIONS,
  REQUIRED_TA_ASSERTIONS,
  REQUIRED_TA_HOOK_COUNT,
  runRecoveryExtensionsProbe,
  summarizeProbeResult,
} from "../lib/recovery-extensions-suite.mjs";

function fakeExists(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

function passingPayload() {
  const scrAssertions = {};
  for (const key of REQUIRED_SCR_ASSERTIONS) {
    scrAssertions[key] = true;
  }
  const taAssertions = {};
  for (const key of REQUIRED_TA_ASSERTIONS) {
    taAssertions[key] = true;
  }
  return {
    ok: true,
    totalMs: 120,
    sessionContextRecovery: {
      durationMs: 40,
      assertions: scrAssertions,
      counts: { hooksRegistered: 1, prependLengthScenarioA: 500, prependLengthScenarioF: 40500 },
    },
    transcriptArchive: {
      durationMs: 80,
      assertions: taAssertions,
      counts: {
        hooksRegistered: REQUIRED_TA_HOOK_COUNT,
        requiredHookNames: REQUIRED_TA_HOOK_COUNT,
        cliRegistrations: 1,
        servicesRegistered: 1,
      },
    },
  };
}

function passingSubprocessResult(payload) {
  return {
    exitCode: 0,
    timedOut: false,
    durationMs: 500,
    stdout: JSON.stringify(payload),
    spawnError: null,
  };
}

test("REQUIRED_SCR_ASSERTIONS covers every behavior clause in the task contract", () => {
  const expected = [
    "hookRegisteredSync",
    "priority10",
    "uiPreferredOverArchive",
    "orderPreserved",
    "malformedIgnored",
    "archiveSentinelAbsent",
    "manyMessagesNoInject",
    "subagentSkipped",
    "runSkipped",
    "missingTranscriptNoInject",
    "archiveFallbackWorks",
    "perMessageBounded",
    "totalBounded",
  ];
  assert.deepEqual([...REQUIRED_SCR_ASSERTIONS], expected);
  // Frozen so accidental mutation cannot silently drop coverage.
  assert.throws(() => {
    REQUIRED_SCR_ASSERTIONS.push("bogus");
  });
});

test("REQUIRED_TA_ASSERTIONS covers every behavior clause in the task contract", () => {
  const expected = [
    "registerSync",
    "hooksInstalled",
    "cliRegistered",
    "serviceRegistered",
    "sparseRoutedToSame",
    "unknownDirNotCreated",
    "traversalContained",
    "hookOrderPreserved",
    "toolResultSplit",
    "toolResultReferenceOnly",
    "snapshotCopied",
    "sourceUnchanged",
  ];
  assert.deepEqual([...REQUIRED_TA_ASSERTIONS], expected);
  assert.throws(() => {
    REQUIRED_TA_ASSERTIONS.push("bogus");
  });
});

test("REQUIRED_TA_HOOK_COUNT matches the extension's 15 installed hooks", () => {
  assert.equal(REQUIRED_TA_HOOK_COUNT, 15);
});

test("summarizeProbeResult passes on a fully-green payload with all assertions true", () => {
  const payload = passingPayload();
  const summary = summarizeProbeResult(passingSubprocessResult(payload), payload);
  assert.equal(summary.status, "pass");
  assert.match(summary.notes, /disposable fixtures/);
  const labelValues = new Map(summary.evidence.map((e) => [e.label, e.value]));
  assert.equal(labelValues.get("exit code"), 0);
  assert.equal(labelValues.get("timed out"), false);
  assert.equal(labelValues.get("session-context-recovery assertions"), "13/13 passed");
  assert.equal(labelValues.get("transcript-archive assertions"), "12/12 passed");
  assert.equal(labelValues.get("transcript-archive hooks registered"), REQUIRED_TA_HOOK_COUNT);
});

test("summarizeProbeResult reports spawn errors as fail without leaking argv/env", () => {
  const summary = summarizeProbeResult(
    {
      exitCode: null,
      timedOut: false,
      durationMs: 5,
      stdout: "",
      spawnError: { code: "ENOENT" },
    },
    null,
  );
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /failed to spawn/);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes("PATH"), "evidence must not include env keys");
});

test("summarizeProbeResult reports subprocess timeouts as fail", () => {
  const summary = summarizeProbeResult(
    { exitCode: null, timedOut: true, durationMs: 30_000, stdout: "", spawnError: null },
    null,
  );
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /timed out after 30000ms/);
});

test("summarizeProbeResult treats an error-shaped payload as fail without leaking exception text", () => {
  const subprocessResult = passingSubprocessResult({ error: "import-failed-scr" });
  const payload = JSON.parse(subprocessResult.stdout);
  const summary = summarizeProbeResult(subprocessResult, payload);
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /import-failed-scr/);
});

test("summarizeProbeResult treats an unparseable payload as fail even with exit 0", () => {
  const summary = summarizeProbeResult(
    { exitCode: 0, timedOut: false, durationMs: 100, stdout: "", spawnError: null },
    null,
  );
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /not parseable JSON/);
});

test("summarizeProbeResult treats missing scr assertions as fail", () => {
  const payload = passingPayload();
  delete payload.sessionContextRecovery.assertions.priority10;
  const summary = summarizeProbeResult(passingSubprocessResult(payload), payload);
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /scr missing assertions: priority10/);
});

test("summarizeProbeResult treats a failing scr assertion as fail", () => {
  const payload = passingPayload();
  payload.sessionContextRecovery.assertions.archiveSentinelAbsent = false;
  const summary = summarizeProbeResult(passingSubprocessResult(payload), payload);
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /scr failing assertions: archiveSentinelAbsent/);
});

test("summarizeProbeResult treats a failing ta assertion as fail", () => {
  const payload = passingPayload();
  payload.transcriptArchive.assertions.traversalContained = false;
  const summary = summarizeProbeResult(passingSubprocessResult(payload), payload);
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /ta failing assertions: traversalContained/);
});

test("summarizeProbeResult treats an insufficient ta hooksRegistered count as fail", () => {
  const payload = passingPayload();
  payload.transcriptArchive.counts.hooksRegistered = 5;
  const summary = summarizeProbeResult(passingSubprocessResult(payload), payload);
  assert.equal(summary.status, "fail");
  assert.match(summary.notes, /hooksRegistered=5 below required 15/);
});

test("runRecoveryExtensionsProbe fails closed when the probe source is missing (no subprocess spawn)", async () => {
  let spawned = false;
  const result = await runRecoveryExtensionsProbe({
    probePath: "/nope/probe.mjs",
    scrSourcePath: "/nope/scr.ts",
    taSourcePath: "/nope/ta.ts",
    existsSyncImpl: fakeExists([]),
    runFn: async () => {
      spawned = true;
      return {};
    },
    mkdtempImpl: () => "/tmp/should-not-be-created",
    rmImpl: () => {},
  });
  assert.equal(spawned, false, "no subprocess must be spawned when preflight fails");
  assert.equal(result.status, "fail");
  assert.match(result.notes, /probe source missing/);
});

test("runRecoveryExtensionsProbe fails closed when a deployed extension source is missing", async () => {
  const probePath = "/tmp/probe.mjs";
  const scrPath = "/tmp/scr/index.ts";
  const result = await runRecoveryExtensionsProbe({
    probePath,
    scrSourcePath: scrPath,
    taSourcePath: "/tmp/ta/index.ts",
    existsSyncImpl: fakeExists([probePath, scrPath]), // ta missing
    runFn: async () => ({}),
    mkdtempImpl: () => "/tmp/should-not-be-created",
    rmImpl: () => {},
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /recovery extension sources are missing/);
});

test("runRecoveryExtensionsProbe fails closed and cleans the temp HOME when runFn throws", async () => {
  const probePath = "/tmp/probe.mjs";
  const scrPath = "/tmp/scr/index.ts";
  const taPath = "/tmp/ta/index.ts";
  const tempHome = "/tmp/openclaw-recovery-abcdef";
  const removed = [];
  const result = await runRecoveryExtensionsProbe({
    probePath,
    scrSourcePath: scrPath,
    taSourcePath: taPath,
    existsSyncImpl: fakeExists([probePath, scrPath, taPath]),
    mkdtempImpl: () => tempHome,
    rmImpl: (p, opts) => {
      removed.push({ p, opts });
    },
    runFn: async () => {
      throw new Error("simulated runFn crash with private details");
    },
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /threw before returning a structured result/);
  assert.doesNotMatch(JSON.stringify(result), /private details/);
  assert.deepEqual(removed, [{ p: tempHome, opts: { recursive: true, force: true } }]);
  assert.deepEqual(result.evidence.at(-1), {
    label: "disposable cleanup succeeded",
    value: true,
  });
});

test("runRecoveryExtensionsProbe fails closed when disposable cleanup fails", async () => {
  const probePath = "/tmp/probe.mjs";
  const scrPath = "/tmp/scr/index.ts";
  const taPath = "/tmp/ta/index.ts";
  const payload = passingPayload();
  const result = await runRecoveryExtensionsProbe({
    probePath,
    scrSourcePath: scrPath,
    taSourcePath: taPath,
    existsSyncImpl: fakeExists([probePath, scrPath, taPath]),
    mkdtempImpl: () => "/tmp/openclaw-recovery-cleanup-failure",
    rmImpl: () => {
      throw new Error("cleanup path with private details");
    },
    runFn: async () => passingSubprocessResult(payload),
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /disposable fixture cleanup failed/);
  assert.doesNotMatch(JSON.stringify(result), /private details/);
  assert.deepEqual(result.evidence.at(-1), {
    label: "disposable cleanup succeeded",
    value: false,
  });
});

test("runRecoveryExtensionsProbe never spawns pnpm/corepack/network tools", async () => {
  const probePath = "/tmp/probe.mjs";
  const scrPath = "/tmp/scr/index.ts";
  const taPath = "/tmp/ta/index.ts";
  const tempHome = "/tmp/openclaw-recovery-xyz";
  let captured = null;
  const payload = passingPayload();
  const result = await runRecoveryExtensionsProbe({
    probePath,
    scrSourcePath: scrPath,
    taSourcePath: taPath,
    nodeExecPath: "/usr/local/bin/node",
    env: { PATH: "/usr/bin", OPENAI_API_KEY: "sk-proj-should-not-leak" },
    existsSyncImpl: fakeExists([probePath, scrPath, taPath]),
    mkdtempImpl: () => tempHome,
    rmImpl: () => {},
    runFn: async (opts) => {
      captured = opts;
      return {
        exitCode: 0,
        timedOut: false,
        durationMs: 250,
        stdout: JSON.stringify(payload),
        spawnError: null,
      };
    },
  });
  assert.equal(result.status, "pass");
  assert.ok(captured, "runFn must have been invoked");
  assert.equal(captured.nodeExecPath, "/usr/local/bin/node");
  assert.equal(captured.probePath, probePath);
  assert.equal(captured.tempHome, tempHome);
  assert.equal(captured.scrSourcePath, scrPath);
  assert.equal(captured.taSourcePath, taPath);
  assert.equal(captured.baseEnv.OPENAI_API_KEY, "sk-proj-should-not-leak");
  // Any string that looks like pnpm/corepack must never appear in the resolved
  // spawn plan the parent hands to execFile.
  for (const s of [
    captured.nodeExecPath,
    captured.probePath,
    captured.scrSourcePath,
    captured.taSourcePath,
  ]) {
    assert.doesNotMatch(String(s), /\b(pnpm|corepack|npm|npx|yarn|bun)\b/);
  }
  // Evidence must never contain the secret from the parent env.
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("sk-proj-"), "evidence must not include env secrets");
  assert.ok(!serialized.includes("OPENAI_API_KEY"), "evidence must not include env keys");
});

test("runRecoveryExtensionsProbe reports subprocess non-zero exit as fail", async () => {
  const probePath = "/tmp/probe.mjs";
  const scrPath = "/tmp/scr/index.ts";
  const taPath = "/tmp/ta/index.ts";
  const result = await runRecoveryExtensionsProbe({
    probePath,
    scrSourcePath: scrPath,
    taSourcePath: taPath,
    existsSyncImpl: fakeExists([probePath, scrPath, taPath]),
    mkdtempImpl: () => "/tmp/openclaw-recovery-nonzero",
    rmImpl: () => {},
    runFn: async () => ({
      exitCode: 3,
      timedOut: false,
      durationMs: 100,
      stdout: "",
      spawnError: null,
    }),
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /exit 3/);
});
