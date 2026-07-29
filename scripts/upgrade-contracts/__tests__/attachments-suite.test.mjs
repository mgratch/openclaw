// Deterministic tests for the attachments focused-Vitest helper. These never
// spawn Vitest — they drive path resolution and the fail-closed
// classification via a stubbed runFn.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  FOCUSED_ATTACHMENTS_TEST_FILES,
  MIN_FOCUSED_ATTACHMENTS_TESTS,
  resolveRepoRoot,
  resolveVitestPath,
  runFocusedAttachmentsSuite,
} from "../lib/attachments-suite.mjs";

function fakeExists(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

const PASSING_STDOUT = `
 RUN  v4.1.2 /fake/repo

 ✓ src/gateway/chat-attachments.offload.test.ts (9)
 ✓ src/gateway/chat-attachments.test.ts (11)
 ✓ src/media/base64.test.ts (5)
 ✓ src/media/store.test.ts (35)
 ✓ src/media/input-files.fetch-guard.test.ts (11)

 Test Files  5 passed (5)
      Tests  71 passed (71)
   Start at  17:29:36
   Duration  26.47s
`;

test("FOCUSED_ATTACHMENTS_TEST_FILES lists exactly the five expected files, in order", () => {
  assert.deepEqual(
    [...FOCUSED_ATTACHMENTS_TEST_FILES],
    [
      "src/gateway/chat-attachments.offload.test.ts",
      "src/gateway/chat-attachments.test.ts",
      "src/media/base64.test.ts",
      "src/media/store.test.ts",
      "src/media/input-files.fetch-guard.test.ts",
    ],
  );
  // Deliberate mutation must fail — accidental drift would silently drop
  // coverage otherwise.
  assert.throws(() => {
    FOCUSED_ATTACHMENTS_TEST_FILES.push("src/other.test.ts");
  });
});

test("MIN_FOCUSED_ATTACHMENTS_TESTS reflects the exact focused suite (9+11+5+35+11=71)", () => {
  assert.equal(MIN_FOCUSED_ATTACHMENTS_TESTS, 71);
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

test("runFocusedAttachmentsSuite fails closed when the repo root is missing (no subprocess spawn)", async () => {
  let spawned = false;
  const runFn = async () => {
    spawned = true;
    return {};
  };
  const result = await runFocusedAttachmentsSuite({
    repoRoot: "/nope",
    existsSyncImpl: fakeExists([]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(spawned, false);
  assert.equal(result.status, "fail");
  assert.match(result.notes, /OpenClaw repo root not accessible/);
});

test("runFocusedAttachmentsSuite fails closed when vitest.mjs cannot be resolved (never falls back to pnpm/corepack)", async () => {
  const repoRoot = "/tmp/fake-repo";
  let spawnedArgs = null;
  const runFn = async ({ execPath, args }) => {
    spawnedArgs = { execPath, args };
    return {};
  };
  const result = await runFocusedAttachmentsSuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(spawnedArgs, null, "no subprocess must be spawned when vitest is missing");
  assert.equal(result.status, "fail");
  assert.match(result.notes, /refusing to fall back to pnpm\/corepack/);
});

test("runFocusedAttachmentsSuite spawns Node directly against vitest.mjs — no pnpm, no corepack", async () => {
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
  const result = await runFocusedAttachmentsSuite({
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
  assert.deepEqual(captured.args.slice(-FOCUSED_ATTACHMENTS_TEST_FILES.length), [
    ...FOCUSED_ATTACHMENTS_TEST_FILES,
  ]);
  // The --root argument must anchor Vitest inside the target repo.
  const rootIdx = captured.args.indexOf("--root");
  assert.ok(rootIdx >= 0, "--root flag must be present");
  assert.equal(captured.args[rootIdx + 1], repoRoot);
  // Any string that looks like pnpm/corepack must never appear in args/execPath.
  for (const s of [captured.execPath, ...captured.args]) {
    assert.doesNotMatch(String(s), /\b(pnpm|corepack)\b/);
  }
});

test("runFocusedAttachmentsSuite classifies short/missing-file runs as fail even with exit 0", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  4 passed (4)\nTests  71 passed (71)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const short = await runFocusedAttachmentsSuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(short.status, "fail");
  assert.match(short.notes, /4\/5 required files/);
});

test("runFocusedAttachmentsSuite classifies below-minimum test counts as fail even with exit 0", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  5 passed (5)\nTests  70 passed (70)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const low = await runFocusedAttachmentsSuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(low.status, "fail");
  assert.match(low.notes, /require at least 71/);
});

test("runFocusedAttachmentsSuite fails when tests report a skipped case", async () => {
  const repoRoot = "/tmp/fake-repo";
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const runFn = async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Test Files  5 passed (5)\nTests  1 skipped | 70 passed (71)\nDuration  1.0s",
    stderr: "",
    durationMs: 1000,
    spawnError: null,
  });
  const skipped = await runFocusedAttachmentsSuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(skipped.status, "fail");
  assert.match(skipped.notes, /none skipped/);
});

test("runFocusedAttachmentsSuite reports subprocess timeouts as fail without leaking env values", async () => {
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
  const result = await runFocusedAttachmentsSuite({
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

test("runFocusedAttachmentsSuite reports spawn errors as fail without shell/argv details", async () => {
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
  const result = await runFocusedAttachmentsSuite({
    repoRoot,
    existsSyncImpl: fakeExists([repoRoot, vitest]),
    runFn,
    nodeExecPath: "/usr/local/bin/node",
  });
  assert.equal(result.status, "fail");
  assert.match(result.notes, /failed to spawn/);
});

test("runFocusedAttachmentsSuite passes on a green run and never leaks env values into evidence", async () => {
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
  const result = await runFocusedAttachmentsSuite({
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
  assert.match(result.notes, /Focused attachments suite passed 71\/71/);
});
