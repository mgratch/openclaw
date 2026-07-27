import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  ensureGlobalUndiciEnvProxyDispatcher: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    embeddings = {
      create: vi.fn(async () => ({
        data: [{ embedding: [1, 0, 0] }],
      })),
    };
  },
}));

type ToolContext = {
  agentId: string;
  sessionKey: string;
};

type RegisteredTool = {
  execute: (
    callId: string,
    args: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
};

describe("memory-lancedb project firewall with real LanceDB", () => {
  let tmpDir = "";
  let projectDbPath = "";
  let lanceDbPath = "";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-firewall-live-"));
    projectDbPath = path.join(tmpDir, "projects.db");
    lanceDbPath = path.join(tmpDir, "lancedb");

    const projectDb = new DatabaseSync(projectDbPath);
    projectDb.exec("CREATE TABLE sessions (session_key TEXT PRIMARY KEY, project_id TEXT)");
    const insert = projectDb.prepare(
      "INSERT INTO sessions (session_key, project_id) VALUES (?, ?)",
    );
    insert.run("session-a", "project-a");
    insert.run("session-b", "project-b");
    insert.run("session-main", "main");
    projectDb.close();
  });

  afterEach(async () => {
    vi.resetModules();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("isolates recall, duplicate detection, and direct deletion by exact project", async () => {
    const factories = new Map<string, (ctx: ToolContext) => RegisteredTool | null>();
    const { default: memoryPlugin } = await import("./index.js");

    memoryPlugin.register({
      id: "memory-lancedb",
      name: "Memory (LanceDB)",
      source: "test",
      config: {},
      pluginConfig: {
        embedding: {
          apiKey: "test-key",
          model: "text-embedding-3-small",
          dimensions: 3,
        },
        dbPath: lanceDbPath,
        projectDbPath,
        autoCapture: false,
        autoRecall: false,
      },
      runtime: {},
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      registerTool: (
        factory: (ctx: ToolContext) => RegisteredTool | null,
        options?: { name?: string },
      ) => {
        if (options?.name) {
          factories.set(options.name, factory);
        }
      },
      registerCli: vi.fn(),
      registerService: vi.fn(),
      on: vi.fn(),
      resolvePath: (value: string) => value,
    } as never);

    const context = (agentId: string, sessionKey: string): ToolContext => ({
      agentId,
      sessionKey: `agent:${agentId}:${sessionKey}`,
    });
    const tool = (name: string, ctx: ToolContext): RegisteredTool => {
      const registered = factories.get(name)?.(ctx);
      if (!registered) {
        throw new Error(`${name} was not available for the test context`);
      }
      return registered;
    };

    const storeA = tool("memory_store", context("shared-agent", "session-a"));
    const storeB = tool("memory_store", context("shared-agent", "session-b"));
    const createdA = await storeA.execute("store-a", { text: "identical memory" });
    const createdB = await storeB.execute("store-b", { text: "identical memory" });

    expect(createdA.details).toMatchObject({ action: "created", projectId: "project-a" });
    expect(createdB.details).toMatchObject({ action: "created", projectId: "project-b" });

    const recallA = await tool("memory_recall", context("agent-a", "session-a")).execute(
      "recall-a",
      { query: "identical memory" },
    );
    const recallB = await tool("memory_recall", context("agent-b", "session-b")).execute(
      "recall-b",
      { query: "identical memory" },
    );
    const recallMain = await tool("memory_recall", context("main", "session-main")).execute(
      "recall-main",
      { query: "identical memory" },
    );

    expect(recallA.details).toMatchObject({ count: 1 });
    expect(recallB.details).toMatchObject({ count: 1 });
    expect(recallMain.details).toMatchObject({ count: 0 });
    expect((recallA.details.memories as Array<{ projectId: string }>)[0]?.projectId).toBe(
      "project-a",
    );
    expect((recallB.details.memories as Array<{ projectId: string }>)[0]?.projectId).toBe(
      "project-b",
    );

    const foreignDelete = await tool("memory_forget", context("agent-b", "session-b")).execute(
      "forget-foreign",
      { memoryId: createdA.details.id },
    );
    expect(foreignDelete.details).toMatchObject({ action: "not_found" });

    const ownerRecall = await tool("memory_recall", context("agent-a", "session-a")).execute(
      "recall-owner",
      { query: "identical memory" },
    );
    expect(ownerRecall.details).toMatchObject({ count: 1 });

    expect(
      factories.get("memory_recall")?.({ agentId: "agent-a", sessionKey: "unknown" }),
    ).toBeNull();
  });
});
