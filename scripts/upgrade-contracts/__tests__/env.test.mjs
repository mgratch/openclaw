// Deterministic env-probe tests. Uses OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH
// to point the probe at a hermetic fixture so no live host state is touched.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function withFixture(cb) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upgrade-contracts-env-"));
  const cfg = {
    meta: { lastTouchedVersion: "2026.4.2", lastTouchedAt: "2026-07-27T00:00:00Z" },
    agents: {
      defaults: {
        model: "claude-sonnet-4-6",
        models: {
          "anthropic/claude-opus-4-8": { alias: "Opus 4.8" },
          "anthropic/claude-opus-5": { alias: "Opus 5.0" },
        },
      },
      list: [{ id: "one" }, { id: "two" }, { id: "three" }],
    },
    models: {
      providers: {
        anthropic: {
          models: [{ id: "claude-opus-4-8" }, { id: "claude-opus-5" }],
        },
      },
    },
    mcp: { servers: { alpha: {}, beta: {}, gamma: {} } },
    plugins: {
      enabled: true,
      load: { paths: [path.join(dir, "extensions", "memory-lancedb-project")] },
      slots: { memory: "memory-lancedb-project" },
      entries: {
        "memory-lancedb-project": {
          enabled: true,
          config: { embedding: { apiKey: "${OPENAI_API_KEY}" } },
        },
        "session-context-recovery": { enabled: true },
        "transcript-archive": { enabled: false },
      },
    },
    browser: { profiles: { p1: {}, p2: {} } },
  };
  await fs.writeFile(path.join(dir, "openclaw.json"), JSON.stringify(cfg));
  await fs.mkdir(path.join(dir, "extensions", "memory-lancedb-project"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "extensions", "memory-lancedb-project", "openclaw.plugin.json"),
    JSON.stringify({ id: "memory-lancedb-project", kind: "memory" }),
  );
  await fs.mkdir(path.join(dir, "extensions", "session-context-recovery"), { recursive: true });
  await fs.mkdir(path.join(dir, "extensions", "transcript-archive"), { recursive: true });
  await fs.mkdir(path.join(dir, "workspace"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "workspace", "conversations.db"),
    Buffer.from([0x53, 0x51, 0x4c]),
  ); // any non-empty marker
  process.env.OPENCLAW_STATE_DIR = dir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(dir, "openclaw.json");
  process.env.OPENCLAW_WORKSPACE_DB = path.join(dir, "workspace", "conversations.db");
  try {
    await cb(dir);
  } finally {
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_CONFIG_PATH;
    delete process.env.OPENCLAW_WORKSPACE_DB;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("probeOpenClawJson computes agents.list count and mcp.servers count correctly", async () => {
  await withFixture(async () => {
    // Fresh import to pick up new env values.
    const { probeEnvironment } = await import(`../lib/env.mjs?v=${Date.now()}`);
    const { info, capabilities } = await probeEnvironment({ fetchImpl: undefined });
    assert.equal(info.openClawJson.agentListCount, 3);
    assert.equal(info.openClawJson.mcpServerCount, 3);
    assert.deepEqual(info.openClawJson.mcpServerNames, ["alpha", "beta", "gamma"]);
    assert.equal(info.openClawJson.projectMemoryEnabled, true);
    assert.equal(info.openClawJson.stockMemoryEnabled, false);
    assert.equal(info.openClawJson.stockMemoryPresent, false);
    assert.deepEqual(info.openClawJson.requiredModels, [
      { id: "anthropic/claude-opus-4-8", allowed: true, providerDeclared: true },
      { id: "anthropic/claude-opus-5", allowed: true, providerDeclared: true },
    ]);
    assert.equal(capabilities["openclaw.json"], true);
  });
});

test("probeEnvironment never serializes raw plugin apiKey values", async () => {
  await withFixture(async () => {
    const { probeEnvironment } = await import(`../lib/env.mjs?v=${Date.now()}`);
    const { info } = await probeEnvironment({ fetchImpl: undefined });
    const serialized = JSON.stringify(info);
    assert.doesNotMatch(serialized, /OPENAI_API_KEY/);
    // The raw config value MUST NOT be present anywhere in the summary.
    assert.doesNotMatch(serialized, /apiKey/);
  });
});

test("probeEnvironment resolves capability flags for extensions", async () => {
  await withFixture(async () => {
    const { probeEnvironment } = await import(`../lib/env.mjs?v=${Date.now()}`);
    const { capabilities } = await probeEnvironment({ fetchImpl: undefined });
    assert.equal(capabilities["memory.project-plugin"], true);
    assert.equal(capabilities["extension.session-context-recovery"], true);
    assert.equal(capabilities["extension.transcript-archive"], true);
    assert.equal(capabilities["memory.stock-plugin-present"], false);
  });
});
