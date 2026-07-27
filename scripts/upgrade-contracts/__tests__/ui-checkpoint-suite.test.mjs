// Deterministic tests for the UI checkpoint focused-Vitest helper. These
// never spawn Vitest — they drive path resolution, env construction, and the
// fail-closed classification via a stubbed runFn.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  FOCUSED_UI_TEST_FILES,
  MIN_FOCUSED_UI_TESTS,
  buildSubprocessEnv,
  resolveLinuxBinariesNodePath,
  resolveUiRoot,
  resolveVitestPath,
  runFocusedUiSuite,
} from "../lib/ui-checkpoint-suite.mjs";

function fakeExists(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

const PASSING_STDOUT = `
 RUN  v4.1.5 /fake/ui

 ✓ src/utils/__tests__/modelFallbackOrder.test.ts (5)
 ✓ src/utils/__tests__/projectApi.acp-presets.test.ts (10)
 ✓ src/utils/__tests__/toolCallCorrelation.test.ts (6)

 Test Files  3 passed (3)
      Tests  21 passed (21)
   Start at  19:20:17
   Duration  1.10s
`;

test("FOCUSED_UI_TEST_FILES lists exactly the three expected files, in order", () => {
  assert.deepEqual(
    [...FOCUSED_UI_TEST_FILES],
    [
      "src/utils/__tests__/modelFallbackOrder.test.ts",
      "src/utils/__tests__/projectApi.acp-presets.test.ts",
      "src/utils/__tests__/toolCallCorrelation.test.ts",
    ],
  );
  // Deliberate mutation must fail — accidental drift would silently drop
  // coverage otherwise.
  assert.throws(() => {
    FOCUSED_UI_TEST_FILES.push("src/other.test.ts");
  });
});

test("MIN_FOCUSED_UI_TESTS reflects the two new tests added to the focused suite", () => {
  // 5 + 10 + 6 = 21 tests across the three files. If a test is removed the
  // suite must fail loudly, not silently accept a smaller run.
  assert.equal(MIN_FOCUSED_UI_TESTS, 21);
});

test("resolveUiRoot honors OPENCLAW_UI_ROOT override", () => {
  assert.equal(resolveUiRoot({ env: { OPENCLAW_UI_ROOT: "/custom/ui" } }), "/custom/ui");
});

test("resolveUiRoot falls back to defaultRoot then to the plan default", () => {
  assert.equal(resolveUiRoot({ env: {}, defaultRoot: "/fallback" }), "/fallback");
  assert.equal(resolveUiRoot({ env: {} }), "/mnt/host-projects/openclaw--openclaw-ui");
});

test("resolveVitestPath prefers node_modules/vitest/vitest.mjs when present", () => {
  const uiRoot = "/tmp/fake-ui";
  const primary = path.join(uiRoot, "node_modules", "vitest", "vitest.mjs");
  const backup = path.join(uiRoot, "node_modules.linux-binaries.bak", "vitest", "vitest.mjs");
  assert.equal(
    resolveVitestPath(uiRoot, { existsSyncImpl: fakeExists([primary, backup]) }),
    primary,
  );
});

test("resolveVitestPath falls through to node_modules.linux-binaries.bak", () => {
  const uiRoot = "/tmp/fake-ui";
  const backup = path.join(uiRoot, "node_modules.linux-binaries.bak", "vitest", "vitest.mjs");
  assert.equal(resolveVitestPath(uiRoot, { existsSyncImpl: fakeExists([backup]) }), backup);
});

test("resolveVitestPath returns null when neither candidate exists (no pnpm fallback)", () => {
  assert.equal(resolveVitestPath("/tmp/fake-ui", { existsSyncImpl: fakeExists([]) }), null);
});

test("resolveLinuxBinariesNodePath resolves the aggregate .pnpm/node_modules when present", () => {
  const uiRoot = "/tmp/fake-ui";
  const agg = path.join(uiRoot, "node_modules.linux-binaries.bak", ".pnpm", "node_modules");
  assert.equal(resolveLinuxBinariesNodePath(uiRoot, { existsSyncImpl: fakeExists([agg]) }), agg);
  assert.equal(resolveLinuxBinariesNodePath(uiRoot, { existsSyncImpl: fakeExists([]) }), null);
});

test("buildSubprocessEnv prepends the linux binaries directory to NODE_PATH without mutating base env", () => {
  const baseEnv = { PATH: "/usr/bin", NODE_PATH: "/pre/existing" };
  const built = buildSubprocessEnv({
    baseEnv,
    linuxBinariesNodePath: "/linux/bins",
  });
  assert.notEqual(built, baseEnv);
  assert.equal(baseEnv.NODE_PATH, "/pre/existing"); // untouched
  assert.equal(built.NODE_PATH, `/linux/bins${path.delimiter}/pre/existing`);
  assert.equal(built.PATH, "/usr/bin");
});

test("buildSubprocessEnv sets NODE_PATH directly when the base env has no prior value", () => {
  const built = buildSubprocessEnv({
    baseEnv: { PATH: "/usr/bin" },
    linuxBinariesNodePath: "/linux/bins",
  });
  assert.equal(built.NODE_PATH, "/linux/bins");
});

test("buildSubprocessEnv leaves NODE_PATH unset when no linux binaries dir is available", () => {
  const built = buildSubprocessEnv({
    baseEnv: { PATH: "/usr/bin" },
    linuxBinariesNodePath: null,
  });
  assert.equal(built.NODE_PATH, undefined);
});

test("runFocusedUiSuite fails closed when the UI root is missing (no subprocess spawn)", async () => {
  let spawned = false;
  const runFn = async () => {
    spawned = true;
    return {};
  };
  const result = await runFocusedUiSuite({
    env: { OPENCLAW_UI_ROOT: "/nope" },
    existsSyncImpl: fakeExists([]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(spawned, false);
  assert.equal(result.status, "fail");
  assert.match(result.notes, /UI checkpoint root not accessible/);
});

test("runFocusedUiSuite fails closed when vitest.mjs cannot be resolved (never falls back to pnpm/corepack)", async () => {
  const uiRoot = "/tmp/fake-ui";
  let spawnedArgs = null;
  const runFn = async ({ execPath, args }) => {
    spawnedArgs = { execPath, args };
    return {};
  };
  const result = await runFocusedUiSuite({
    env: { OPENCLAW_UI_ROOT: uiRoot },
    existsSyncImpl: fakeExists([uiRoot]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(spawnedArgs, null, "no subprocess must be spawned when vitest is missing");
  assert.equal(result.status, "fail");
  assert.match(result.notes, /refusing to fall back to pnpm\/corepack/);
});

test("runFocusedUiSuite spawns Node directly against vitest.mjs — no pnpm, no corepack", async () => {
  const uiRoot = "/tmp/fake-ui";
  const vitest = path.join(uiRoot, "node_modules", "vitest", "vitest.mjs");
  const agg = path.join(uiRoot, "node_modules.linux-binaries.bak", ".pnpm", "node_modules");
  let captured = null;
  const runFn = async (opts) => {
    captured = opts;
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: PASSING_STDOUT,
      stderr: "",
      durationMs: 1100,
      spawnError: null,
    };
  };
  const result = await runFocusedUiSuite({
    env: { OPENCLAW_UI_ROOT: uiRoot, PATH: "/usr/bin" },
    existsSyncImpl: fakeExists([uiRoot, vitest, agg]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(result.status, "pass");
  assert.ok(captured, "runFn must have been called");
  assert.equal(captured.execPath, "/usr/local/bin/node");
  assert.equal(captured.cwd, uiRoot);
  assert.equal(captured.args[0], vitest);
  assert.equal(captured.args[1], "run");
  assert.deepEqual(captured.args.slice(-3), [...FOCUSED_UI_TEST_FILES]);
  // Any string that looks like pnpm/corepack must never appear in args/execPath.
  for (const s of [captured.execPath, ...captured.args]) {
    assert.doesNotMatch(String(s), /\b(pnpm|corepack)\b/);
  }
  // NODE_PATH was prepended.
  assert.equal(captured.env.NODE_PATH, agg);
});

test("runFocusedUiSuite classifies short/skipped runs as fail even with exit 0", async () => {
  const uiRoot = "/tmp/fake-ui";
  const vitest = path.join(uiRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  2 passed (2)\nTests  20 passed (20)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const short = await runFocusedUiSuite({
    env: { OPENCLAW_UI_ROOT: uiRoot },
    existsSyncImpl: fakeExists([uiRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(short.status, "fail");
  assert.match(short.notes, /2\/3 required files/);
});

test("runFocusedUiSuite fails when tests reports a skipped case", async () => {
  const uiRoot = "/tmp/fake-ui";
  const vitest = path.join(uiRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  3 passed (3)\nTests  1 skipped | 20 passed (21)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const skipped = await runFocusedUiSuite({
    env: { OPENCLAW_UI_ROOT: uiRoot },
    existsSyncImpl: fakeExists([uiRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(skipped.status, "fail");
  assert.match(skipped.notes, /none skipped/);
});

test("runFocusedUiSuite passes on a green run and never leaks env values into evidence", async () => {
  const uiRoot = "/tmp/fake-ui";
  const vitest = path.join(uiRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: PASSING_STDOUT,
    stderr: "",
    durationMs: 1100,
    spawnError: null,
  });
  const result = await runFocusedUiSuite({
    env: {
      OPENCLAW_UI_ROOT: uiRoot,
      OPENAI_API_KEY: "sk-proj-supersecrettoken1234567890abcdef",
      PATH: "/usr/bin",
    },
    existsSyncImpl: fakeExists([uiRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(result.status, "pass");
  const serialized = JSON.stringify(result.evidence);
  assert.ok(!serialized.includes("sk-proj-"), "evidence must not include env secrets");
  assert.ok(!serialized.includes("OPENAI_API_KEY"), "evidence must not include env keys");
  assert.match(result.notes, /Focused UI checkpoint suite passed 21\/21/);
});
