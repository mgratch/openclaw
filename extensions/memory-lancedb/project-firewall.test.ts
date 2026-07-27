import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadLanceDbModule } from "./lancedb-runtime.js";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const stillExists = await fs
        .access(tmpDir)
        .then(() => true)
        .catch(() => false);
      expect(stillExists).toBe(false);
      tmpDir = "";
    }
  });

  test("enforces project-scoped isolation across concurrent, duplicate, cross-agent, main-bypass, foreign-delete, unknown-session, and legacy-row paths", async () => {
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

    // Fail-closed: unknown session yields no tool for any of the three tool factories.
    expect(
      factories.get("memory_recall")?.({ agentId: "agent-a", sessionKey: "unknown" }),
    ).toBeNull();
    expect(
      factories.get("memory_store")?.({ agentId: "agent-a", sessionKey: "unknown" }),
    ).toBeNull();
    expect(
      factories.get("memory_forget")?.({ agentId: "agent-a", sessionKey: "unknown" }),
    ).toBeNull();

    // Concurrent same-text store into two distinct projects: both succeed and get distinct UUIDs.
    const storeA = tool("memory_store", context("shared-agent", "session-a"));
    const storeB = tool("memory_store", context("shared-agent", "session-b"));
    const [createdA, createdB] = await Promise.all([
      storeA.execute("store-a", { text: "identical memory" }),
      storeB.execute("store-b", { text: "identical memory" }),
    ]);
    expect(createdA.details).toMatchObject({ action: "created", projectId: "project-a" });
    expect(createdB.details).toMatchObject({ action: "created", projectId: "project-b" });
    const idA = createdA.details.id as string;
    const idB = createdB.details.id as string;
    expect(idA).not.toBe(idB);
    expect(UUID_RE.test(idA)).toBe(true);
    expect(UUID_RE.test(idB)).toBe(true);

    // Same-project duplicate insert is deterministic and does not add a new row.
    const dupA = await storeA.execute("store-a-dup", { text: "identical memory" });
    expect(dupA.details).toMatchObject({ action: "duplicate", existingId: idA });

    // Inject legacy rows straight into the disposable LanceDB table so no real recall path
    // ever exposes projectId="" or projectId="global" values to a scoped caller.
    const legacyEmptyTag = `openclaw-canary-legacy-empty-${randomUUID()}`;
    const legacyGlobalTag = `openclaw-canary-legacy-global-${randomUUID()}`;
    const lancedb = await loadLanceDbModule();
    const conn = await lancedb.connect(lanceDbPath);
    const memoriesTable = await conn.openTable("memories");
    await memoriesTable.add([
      {
        id: randomUUID(),
        text: legacyEmptyTag,
        vector: [1, 0, 0],
        importance: 0.5,
        category: "other",
        createdAt: Date.now(),
        agentId: "",
        projectId: "",
      },
      {
        id: randomUUID(),
        text: legacyGlobalTag,
        vector: [1, 0, 0],
        importance: 0.5,
        category: "other",
        createdAt: Date.now(),
        agentId: "legacy-agent",
        projectId: "global",
      },
    ]);
    const totalRowsAfterLegacyInsert = await memoriesTable.countRows();
    expect(totalRowsAfterLegacyInsert).toBe(4);

    // Cross-project isolation + main bypass: recall by exact project filter never surfaces
    // the sibling project's row or either legacy row.
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
    const recallAMemories = recallA.details.memories as Array<{
      projectId: string;
      text: string;
    }>;
    const recallBMemories = recallB.details.memories as Array<{
      projectId: string;
      text: string;
    }>;
    expect(recallAMemories[0]?.projectId).toBe("project-a");
    expect(recallBMemories[0]?.projectId).toBe("project-b");
    for (const memList of [recallAMemories, recallBMemories]) {
      for (const mem of memList) {
        expect(mem.text).not.toBe(legacyEmptyTag);
        expect(mem.text).not.toBe(legacyGlobalTag);
      }
    }

    // Same-project cross-agent recall: within a single project, another agent's session
    // sees the row (scope is project-level, not per-agent) — the isolation boundary is
    // project, and this contract records the current, deliberate behavior.
    const crossAgentRecall = await tool(
      "memory_recall",
      context("agent-a-observer", "session-a"),
    ).execute("recall-cross-agent", { query: "identical memory" });
    expect(crossAgentRecall.details).toMatchObject({ count: 1 });
    const crossAgentMemories = crossAgentRecall.details.memories as Array<{
      projectId: string;
      agentId: string;
    }>;
    expect(crossAgentMemories[0]?.projectId).toBe("project-a");
    expect(crossAgentMemories[0]?.agentId).toBe("shared-agent");

    // Foreign direct-ID delete denied: predicate is scoped by projectId so project B cannot
    // delete project A's row even if it knows the exact id.
    const foreignDelete = await tool("memory_forget", context("agent-b", "session-b")).execute(
      "forget-foreign",
      { memoryId: idA },
    );
    expect(foreignDelete.details).toMatchObject({ action: "not_found", id: idA });
    const ownerRecall = await tool("memory_recall", context("agent-a", "session-a")).execute(
      "recall-owner",
      { query: "identical memory" },
    );
    expect(ownerRecall.details).toMatchObject({ count: 1 });

    // Cleanup: both project-owned rows are removed by their owning project.
    const forgetA = await tool("memory_forget", context("agent-a", "session-a")).execute(
      "forget-a",
      { memoryId: idA },
    );
    expect(forgetA.details).toMatchObject({ action: "deleted", id: idA });
    const forgetB = await tool("memory_forget", context("shared-agent", "session-b")).execute(
      "forget-b",
      { memoryId: idB },
    );
    expect(forgetB.details).toMatchObject({ action: "deleted", id: idB });

    // Residual assertion: no project-owned rows remain in the disposable table before
    // teardown — only the two legacy rows we injected directly are still present, and they
    // never surfaced to any scoped caller during the run. LanceDB table handles are
    // snapshotted, so re-open the table to observe the post-delete state.
    const freshTable = await conn.openTable("memories");
    const remainingScoped = await freshTable
      .query()
      .where("projectId = 'project-a' OR projectId = 'project-b'")
      .toArray();
    expect(remainingScoped).toEqual([]);
    const finalRowCount = await freshTable.countRows();
    expect(finalRowCount).toBe(2);
  });
});
