/**
 * Unified MCP server that bridges ALL gateway tool sources into ACP sessions:
 *
 * 1. Plugin-registered tools (memory, search, etc.) — same as plugin-tools-serve
 * 2. Gateway MCP servers (user-configured + plugin-bundled)
 * 3. Skills (exposed as callable tools)
 *
 * Run via: node --import tsx src/mcp/gateway-bridge-serve.ts
 * Or: bun src/mcp/gateway-bridge-serve.ts
 *
 * Replaces (and is a superset of) plugin-tools-serve.ts when
 * `gatewayToolsBridge: true` is set in the acpx config.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { routeLogsToStderr } from "../logging/console.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { VERSION } from "../version.js";
import { loadEmbeddedPiMcpConfig } from "../agents/embedded-pi-mcp.js";
import { resolveMcpTransport } from "../agents/mcp-transport.js";
import { sanitizeServerName } from "../agents/pi-bundle-mcp-names.js";
import { loadWorkspaceSkillEntries } from "../agents/skills/workspace.js";

// ─── Types ─────────────────────────────────────────────────────

type BridgedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source:
    | { kind: "plugin-tool"; tool: AnyAgentTool }
    | { kind: "mcp"; serverName: string; originalToolName: string; client: Client }
    | { kind: "skill"; skillName: string; filePath: string };
};

type McpSession = {
  serverName: string;
  client: Client;
};

// ─── Helpers ───────────────────────────────────────────────────

function resolveJsonSchemaForTool(tool: AnyAgentTool): Record<string, unknown> {
  const params = tool.parameters;
  if (params && typeof params === "object" && "type" in params) {
    return params as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
}

/** Build a unique, safe tool name for an MCP-sourced tool. */
function buildBridgedMcpToolName(serverName: string, toolName: string): string {
  // Pass an empty Set for usedNames — this bridge sanitizes one server name
  // per call without cross-server collision tracking, since each MCP server
  // gets its own bridged toolset and conflicts are surfaced upstream.
  const safe = sanitizeServerName(serverName, new Set<string>());
  return `${safe}__${toolName}`;
}

// ─── Tool Discovery ────────────────────────────────────────────

function resolvePluginToolsBridged(config: OpenClawConfig): BridgedTool[] {
  const tools = resolvePluginTools({ context: { config }, suppressNameConflicts: true });
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: resolveJsonSchemaForTool(tool),
    source: { kind: "plugin-tool" as const, tool },
  }));
}

async function connectMcpServer(
  serverName: string,
  rawConfig: Record<string, unknown>,
): Promise<{ session: McpSession; tools: BridgedTool[] } | null> {
  try {
    const resolved = resolveMcpTransport(serverName, rawConfig);
    if (!resolved) {
      process.stderr.write(
        `gateway-bridge: skipping MCP server "${serverName}" — unsupported transport\n`,
      );
      return null;
    }
    const client = new Client(
      { name: `openclaw-gateway-bridge/${serverName}`, version: VERSION },
      { capabilities: {} },
    );

    await connectWithTimeout(client, resolved.transport, resolved.connectionTimeoutMs);
    const listed = await listAllTools(client);

    const tools: BridgedTool[] = listed.map((t) => ({
      name: buildBridgedMcpToolName(serverName, t.name),
      description: t.description
        ? `[${serverName}] ${t.description}`
        : `Tool from MCP server: ${serverName}`,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      source: { kind: "mcp" as const, serverName, originalToolName: t.name, client },
    }));

    process.stderr.write(
      `gateway-bridge: connected to "${serverName}" — ${tools.length} tools\n`,
    );
    return { session: { serverName, client }, tools };
  } catch (err) {
    process.stderr.write(
      `gateway-bridge: failed to connect to "${serverName}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

function connectWithTimeout(
  client: Client,
  transport: import("@modelcontextprotocol/sdk/shared/transport.js").Transport,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP server connection timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    client.connect(transport).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function listAllTools(client: Client) {
  type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

async function discoverAllMcpTools(config: OpenClawConfig): Promise<{
  tools: BridgedTool[];
  sessions: McpSession[];
}> {
  // Load all MCP servers: plugin-bundled + user-configured (merged, config wins)
  const embedded = loadEmbeddedPiMcpConfig({
    workspaceDir: process.cwd(),
    cfg: config,
  });

  const serverEntries = Object.entries(embedded.mcpServers);
  if (serverEntries.length === 0) {
    return { tools: [], sessions: [] };
  }

  process.stderr.write(
    `gateway-bridge: discovering tools from ${serverEntries.length} MCP server(s)...\n`,
  );

  const results = await Promise.allSettled(
    serverEntries.map(async ([name, rawConfig]) =>
      connectMcpServer(name, rawConfig as Record<string, unknown>),
    ),
  );

  const tools: BridgedTool[] = [];
  const sessions: McpSession[] = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      tools.push(...result.value.tools);
      sessions.push(result.value.session);
    }
  }

  return { tools, sessions };
}

// ─── Skill Discovery ───────────────────────────────────────────

function discoverSkillTools(config: OpenClawConfig): BridgedTool[] {
  try {
    const entries = loadWorkspaceSkillEntries(process.cwd(), { config });
    const tools: BridgedTool[] = [];

    for (const entry of entries) {
      const skill = entry.skill;
      // Skip skills that opt out of model invocation
      if (skill.disableModelInvocation) continue;

      const safeName = `skill__${skill.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      tools.push({
        name: safeName,
        description:
          `[Skill] ${skill.description || skill.name}. ` +
          `Call this tool to load the skill instructions. Pass your task as the "request" argument.`,
        inputSchema: {
          type: "object",
          properties: {
            request: {
              type: "string",
              description: "The task or request to accomplish using this skill",
            },
          },
          required: ["request"],
        },
        source: { kind: "skill", skillName: skill.name, filePath: skill.filePath },
      });
    }

    return tools;
  } catch (err) {
    process.stderr.write(
      `gateway-bridge: failed to discover skills: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return [];
  }
}

// ─── Server ────────────────────────────────────────────────────

export async function createGatewayBridgeMcpServer(params: {
  config?: OpenClawConfig;
  pluginTools?: AnyAgentTool[];
}): Promise<{ server: Server; sessions: McpSession[] }> {
  const cfg = params.config ?? loadConfig();

  // Phase 1: plugin-registered tools (synchronous, same as plugin-tools-serve)
  const pluginBridgedTools = resolvePluginToolsBridged(cfg);

  // Phase 2: gateway MCP servers (async, connects to each)
  const { tools: mcpBridgedTools, sessions } = await discoverAllMcpTools(cfg);

  // Phase 3: skills as callable tools
  const skillBridgedTools = discoverSkillTools(cfg);

  // Merge all tools into a single map (plugin tools win on name collision,
  // skills are prefixed with `skill__` so collisions are unlikely)
  const toolMap = new Map<string, BridgedTool>();
  for (const tool of mcpBridgedTools) {
    toolMap.set(tool.name, tool);
  }
  for (const tool of skillBridgedTools) {
    toolMap.set(tool.name, tool);
  }
  for (const tool of pluginBridgedTools) {
    toolMap.set(tool.name, tool);
  }

  const allTools = Array.from(toolMap.values());
  process.stderr.write(
    `gateway-bridge: serving ${allTools.length} tools ` +
      `(${pluginBridgedTools.length} plugin, ${mcpBridgedTools.length} MCP, ${skillBridgedTools.length} skills)\n`,
  );

  const server = new Server(
    { name: "openclaw-gateway-bridge", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }

    try {
      if (tool.source.kind === "skill") {
        // Read the SKILL.md content and return it along with the user's request.
        // Claude Code will use the skill instructions to accomplish the task.
        const skillContent = fs.readFileSync(tool.source.filePath, "utf8");
        const userRequest = (request.params.arguments as Record<string, unknown>)?.request ?? "";
        return {
          content: [
            {
              type: "text",
              text:
                `# Skill: ${tool.source.skillName}\n\n` +
                `## Instructions\n\n${skillContent}\n\n` +
                `## Task\n\n${String(userRequest)}`,
            },
          ],
        };
      }

      if (tool.source.kind === "plugin-tool") {
        const result = await tool.source.tool.execute(
          `mcp-${Date.now()}`,
          request.params.arguments ?? {},
        );
        return {
          content: Array.isArray(result.content)
            ? result.content
            : [{ type: "text", text: String(result.content) }],
        };
      }

      // MCP-sourced tool: forward the call to the originating MCP server
      const callResult = await tool.source.client.callTool({
        name: tool.source.originalToolName,
        arguments: request.params.arguments ?? {},
      });
      return {
        content: Array.isArray(callResult.content)
          ? callResult.content
          : [{ type: "text", text: JSON.stringify(callResult) }],
        ...(callResult.isError === true ? { isError: true } : {}),
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Tool error (${tool.source.kind}): ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return { server, sessions };
}

// ─── Standalone Entry ──────────────────────────────────────────

export async function serveGatewayBridgeMcp(): Promise<void> {
  routeLogsToStderr();

  const config = loadConfig();
  const { server, sessions } = await createGatewayBridgeMcpServer({ config });

  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdin.off("end", shutdown);
    process.stdin.off("close", shutdown);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);

    // Clean up MCP client connections
    for (const session of sessions) {
      session.client.close().catch(() => {});
    }
    void server.close();
  };

  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.connect(transport);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  serveGatewayBridgeMcp().catch((err) => {
    process.stderr.write(
      `gateway-bridge-serve: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
