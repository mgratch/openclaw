// Deterministic tests for the runner-recovery focused-Vitest helper. These
// never spawn Vitest — they drive path resolution and the fail-closed
// classification via a stubbed runFn.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  FOCUSED_RUNNER_RECOVERY_TEST_FILES,
  MIN_FOCUSED_RUNNER_RECOVERY_TESTS,
  resolveRepoRoot,
  resolveVitestPath,
  runFocusedRunnerRecoverySuite,
} from "../lib/runner-recovery-suite.mjs";

function fakeExists(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

const PASSING_STDOUT = `
 RUN  v4.1.2 /fake/repo

 ✓ src/agents/pi-embedded-runner/run/attempt.empty-final-turn.test.ts (13)
 ✓ src/agents/pi-embedded-helpers/provider-error-patterns.test.ts (22)
 ✓ src/agents/pi-embedded-runner/run.overflow-compaction.test.ts (11)
 ✓ src/agents/pi-embedded-runner/run.overflow-compaction.loop.test.ts (11)

 Test Files  4 passed (4)
      Tests  57 passed (57)
   Start at  16:17:15
   Duration  25.86s
`;

test("FOCUSED_RUNNER_RECOVERY_TEST_FILES lists exactly the four expected files, in order", () => {
  assert.deepEqual(
    [...FOCUSED_RUNNER_RECOVERY_TEST_FILES],
    [
      "src/agents/pi-embedded-runner/run/attempt.empty-final-turn.test.ts",
      "src/agents/pi-embedded-helpers/provider-error-patterns.test.ts",
      "src/agents/pi-embedded-runner/run.overflow-compaction.test.ts",
      "src/agents/pi-embedded-runner/run.overflow-compaction.loop.test.ts",
    ],
  );
  // Deliberate mutation must fail — accidental drift would silently drop
  // coverage otherwise.
  assert.throws(() => {
    FOCUSED_RUNNER_RECOVERY_TEST_FILES.push("src/other.test.ts");
  });
});

test("MIN_FOCUSED_RUNNER_RECOVERY_TESTS reflects the exact focused suite (13+22+11+11=57)", () => {
  assert.equal(MIN_FOCUSED_RUNNER_RECOVERY_TESTS, 57);
});

test("resolveRepoRoot honors an explicit defaultRoot", () => {
  assert.equal(resolveRepoRoot({ defaultRoot: "/custom/repo" }), "/custom/repo");
});

test("resolveRepoRoot falls back to the shared REPO_ROOT when nothing is provided", () => {
  const resolved = resolveRepoRoot();
  assert.equal(typeof resolved, "string");
  assert.ok(resolved.length > 0);
});

test("resolveVitestPath returns node_modules/vitest/vitest.mjs when present", () => {
  const repoRoot = "/tmp/fake-repo";
  const primary = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  assert.equal(resolveVitestPath(repoRoot, { existsSyncImpl: fakeExists([primary]) }), primary);
});

test("resolveVitestPath returns null when the local install is missing (no pnpm fallback)", () => {
  assert.equal(resolveVitestPath("/tmp/fake-repo", { existsSyncImpl: fakeExists([]) }), null);
});

test("resolveVitestPath rejects empty repo roots", () => {
  assert.equal(resolveVitestPath("", { existsSyncImpl: fakeExists([]) }), null);
});

test("runFocusedRunnerRecoverySuite fails closed when the repo root is missing (no subprocess spawn)", async () => {
  let spawned = false;
  const runFn = async () => {
    spawned = true;
    return {};
  };
  const result = await runFocusedRunnerRecoverySuite({
    repoRoot: "/nope",
    existsSyncImpl: fakeExists([]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(spawned, false);
  assert.equal(result.status, "fail");
  assert.match(result.notes, /OpenClaw repo root not accessible/);
});

test("runFocusedRunnerRecoverySuite fails closed when vitest.mjs cannot be resolved (never falls back to pnpm/corepack)", async () => {
  const repoRoot = "/tmp/fake-repo";
  let spawnedArgs = null;
  const runFn = async ({ execPath, args }) => {
    spawnedArgs = { execPath, args };
    return {};
  };
  const result = await runFocusedRunnerRecoverySuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(spawnedArgs, null, "no subprocess must be spawned when vitest is missing");
  assert.equal(result.status, "fail");
  assert.match(result.notes, /refusing to fall back to pnpm\/corepack/);
});

test("runFocusedRunnerRecoverySuite spawns Node directly against vitest.mjs — no pnpm, no corepack", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  let captured = null;
  const runFn = async (opts) => {
    captured = opts;
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: PASSING_STDOUT,
      stderr: "",
      durationMs: 25_000,
      spawnError: null,
    };
  };
  const result = await runFocusedRunnerRecoverySuite({
    repoRoot,
    env: { PATH: "/usr/bin" },
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(result.status, "pass");
  assert.ok(captured, "runFn must have been called");
  assert.equal(captured.execPath, "/usr/local/bin/node");
  assert.equal(captured.cwd, repoRoot);
  assert.equal(captured.args[0], vitest);
  assert.equal(captured.args[1], "run");
  assert.deepEqual(captured.args.slice(-4), [...FOCUSED_RUNNER_RECOVERY_TEST_FILES]);
  // The --root argument must anchor Vitest inside the target repo.
  const rootIdx = captured.args.indexOf("--root");
  assert.ok(rootIdx >= 0, "--root flag must be present");
  assert.equal(captured.args[rootIdx + 1], repoRoot);
  // Any string that looks like pnpm/corepack must never appear in args/execPath.
  for (const s of [captured.execPath, ...captured.args]) {
    assert.doesNotMatch(String(s), /\b(pnpm|corepack)\b/);
  }
});

test("runFocusedRunnerRecoverySuite classifies short/missing-file runs as fail even with exit 0", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  3 passed (3)\nTests  56 passed (56)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const short = await runFocusedRunnerRecoverySuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(short.status, "fail");
  assert.match(short.notes, /3\/4 required files/);
});

test("runFocusedRunnerRecoverySuite classifies below-minimum test counts as fail even with exit 0", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  4 passed (4)\nTests  56 passed (56)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const low = await runFocusedRunnerRecoverySuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(low.status, "fail");
  assert.match(low.notes, /require at least 57/);
});

test("runFocusedRunnerRecoverySuite fails when tests report a skipped case", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  4 passed (4)\nTests  1 skipped | 56 passed (57)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const skipped = await runFocusedRunnerRecoverySuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(skipped.status, "fail");
  assert.match(skipped.notes, /none skipped/);
});

test("runFocusedRunnerRecoverySuite reports subprocess timeouts as fail without leaking env values", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: null,
    signal: "SIGTERM",
    timedOut: true,
    stdout: "",
    stderr: "",
    durationMs: 180_000,
    spawnError: null,
  });
  const result = await runFocusedRunnerRecoverySuite({
    repoRoot,
    env: {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-proj-supersecrettoken1234567890abcdef",
    },
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /timed out/);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("sk-proj-"), "evidence must not include env secrets");
  assert.ok(!serialized.includes("OPENAI_API_KEY"), "evidence must not include env keys");
});

test("runFocusedRunnerRecoverySuite reports spawn errors as fail without shell/argv details", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    durationMs: 5,
    spawnError: { code: "ENOENT", message: "spawn node ENOENT" },
  });
  const result = await runFocusedRunnerRecoverySuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /failed to spawn/);
});

test("runFocusedRunnerRecoverySuite passes on a green run and never leaks env values into evidence", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: PASSING_STDOUT,
    stderr: "",
    durationMs: 25_000,
    spawnError: null,
  });
  const result = await runFocusedRunnerRecoverySuite({
    repoRoot,
    env: {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-proj-supersecrettoken1234567890abcdef",
      ANTHROPIC_API_KEY: "sk-ant-anothersecretvaluewithlength",
    },
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(result.status, "pass");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("sk-proj-"), "evidence must not include OpenAI secrets");
  assert.ok(!serialized.includes("sk-ant-"), "evidence must not include Anthropic secrets");
  assert.ok(!serialized.includes("OPENAI_API_KEY"), "evidence must not include env keys");
  assert.ok(!serialized.includes("ANTHROPIC_API_KEY"), "evidence must not include env keys");
  assert.match(result.notes, /Focused runner-recovery suite passed 57\/57/);
});
