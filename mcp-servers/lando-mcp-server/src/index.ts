#!/usr/bin/env node
/**
 * lando-mcp-server — MCP server for managing Lando development environments.
 *
 * Runs via stdio transport so OpenClaw (or any MCP client) can spawn it
 * as a local process. The server runs on the HOST machine where Docker
 * and Lando are installed, bridging the gap between OpenClaw's sandboxed
 * agent and the host's dev environment.
 *
 * Tools provided:
 *   - lando_discover_projects  — Scan filesystem for Lando projects
 *   - lando_list_running       — List currently running Lando apps
 *   - lando_info               — Get detailed info about a project
 *   - lando_start              — Start a Lando project
 *   - lando_stop               — Stop a Lando project
 *   - lando_restart             — Restart a Lando project
 *   - lando_rebuild             — Rebuild a Lando project
 *   - lando_destroy             — Destroy a Lando project (destructive)
 *   - lando_exec               — Run a command inside a Lando service
 *   - lando_logs               — View logs from a Lando service
 *   - lando_wp                 — Run WP-CLI commands
 *   - lando_composer            — Run Composer commands
 *   - lando_npm                — Run npm commands
 *   - lando_mysql               — Run MySQL commands
 *   - lando_db_export           — Export a database
 *   - lando_db_import           — Import a database
 *   - lando_poweroff            — Stop ALL running Lando apps
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import {
  discoverProjects,
  resolveProjectDir,
  runLando,
  landoList,
  isDestructive,
} from "./lando.js";

// ─── Server Instance ────────────────────────────────────────

const server = new McpServer({
  name: "lando-mcp-server",
  version: "1.0.0",
});

// ─── Shared Schemas ─────────────────────────────────────────

const ProjectParam = z.object({
  project: z.string()
    .min(1)
    .describe("Project name (e.g. 'my-site'), directory name, or absolute path to the Lando project"),
});

// ─── Helper ─────────────────────────────────────────────────

function formatResult(result: { ok: boolean; stdout: string; stderr: string; exitCode: number; timedOut?: boolean }): string {
  const parts: string[] = [];
  if (result.timedOut) parts.push("⚠️ Command timed out.");
  if (result.stdout.trim()) parts.push(result.stdout.trim());
  if (result.stderr.trim()) parts.push(`STDERR:\n${result.stderr.trim()}`);
  if (!result.ok && !parts.length) parts.push(`Command failed with exit code ${result.exitCode}`);
  return parts.join("\n\n") || "(no output)";
}

// ═════════════════════════════════════════════════════════════
// TOOLS
// ═════════════════════════════════════════════════════════════

// ─── Discover Projects ──────────────────────────────────────

server.registerTool(
  "lando_discover_projects",
  {
    title: "Discover Lando Projects",
    description: `Scan the filesystem for directories containing .lando.yml/.lando.yaml files.

Returns a list of all discovered Lando projects with their names, paths, and basic config info (recipe, config file).

By default scans ~/Sites, ~/projects, ~/dev, ~/code, ~/workspace. Override scan paths with LANDO_PROJECTS_DIRS env var (colon-separated).

Use this first to find what projects are available before running other commands.`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const projects = discoverProjects();
    if (!projects.length) {
      return {
        content: [{
          type: "text" as const,
          text: "No Lando projects found. Scanned directories may not exist or contain no .lando.yml files.\n\nSet LANDO_PROJECTS_DIRS environment variable to specify directories to scan.",
        }],
      };
    }

    const lines = [`# Lando Projects (${projects.length} found)\n`];
    for (const p of projects) {
      const recipe = (p.landoConfig?.recipe as string) || "—";
      lines.push(`- **${p.name}** — \`${p.dir}\` (recipe: ${recipe})`);
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      structuredContent: { projects },
    };
  }
);

// ─── List Running ───────────────────────────────────────────

server.registerTool(
  "lando_list_running",
  {
    title: "List Running Lando Apps",
    description: `List all currently running Lando applications across all projects.

Returns JSON output from \`lando list\` showing app names, URLs, running status, and services. Use this to see what's currently active before starting or stopping projects.`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const result = await landoList();
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Info ───────────────────────────────────────────────────

server.registerTool(
  "lando_info",
  {
    title: "Get Lando Project Info",
    description: `Get detailed information about a Lando project including service URLs, ports, container names, volumes, and connection info.

Runs \`lando info\` in the project directory. The project must be started for full info. Returns JSON with service details.`,
    inputSchema: ProjectParam.strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("info", ["--format=json"], dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Start ──────────────────────────────────────────────────

server.registerTool(
  "lando_start",
  {
    title: "Start Lando Project",
    description: `Start a Lando project (boots up all Docker containers for the app).

This may take 30-60 seconds depending on the project. Returns URLs and service info when ready.`,
    inputSchema: ProjectParam.strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("start", [], dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Stop ───────────────────────────────────────────────────

server.registerTool(
  "lando_stop",
  {
    title: "Stop Lando Project",
    description: `Stop a running Lando project (shuts down all its Docker containers).

The project's data is preserved and it can be started again later.`,
    inputSchema: ProjectParam.strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("stop", [], dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Restart ────────────────────────────────────────────────

server.registerTool(
  "lando_restart",
  {
    title: "Restart Lando Project",
    description: `Restart a Lando project (stop + start). Useful after config changes that don't require a full rebuild.`,
    inputSchema: ProjectParam.strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("restart", [], dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Rebuild ────────────────────────────────────────────────

server.registerTool(
  "lando_rebuild",
  {
    title: "Rebuild Lando Project",
    description: `Rebuild a Lando project from scratch. This re-creates Docker containers based on the .lando.yml config.

⚠️ This is a heavier operation than restart — use when you've changed .lando.yml, need to re-provision services, or fix broken containers. Database data is preserved unless volumes are removed.

Takes 1-5 minutes depending on project complexity.`,
    inputSchema: ProjectParam.extend({
      yes: z.boolean().default(true).describe("Skip confirmation prompt (default: true)"),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ project, yes }) => {
    const dir = resolveProjectDir(project);
    const args = yes ? ["--yes"] : [];
    const result = await runLando("rebuild", args, dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Destroy ────────────────────────────────────────────────

server.registerTool(
  "lando_destroy",
  {
    title: "Destroy Lando Project",
    description: `⚠️ DESTRUCTIVE: Completely destroy a Lando project — removes all containers, volumes, and networks. Database data WILL BE LOST.

Only use this when you want to completely clean up a project. The source files are not affected.`,
    inputSchema: ProjectParam.extend({
      yes: z.boolean().default(true).describe("Skip confirmation prompt (default: true)"),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ project, yes }) => {
    const dir = resolveProjectDir(project);
    const args = yes ? ["--yes"] : [];
    const result = await runLando("destroy", args, dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Exec ───────────────────────────────────────────────────

server.registerTool(
  "lando_exec",
  {
    title: "Execute Command in Lando Service",
    description: `Run an arbitrary command inside a Lando service container.

This is the most flexible tool — it runs any shell command inside the specified service (defaults to the appserver). Use for:
- Running scripts, build tools, or one-off commands
- Checking file contents, environment variables, or service status
- Running any CLI tool available inside the container

The command runs with the service's user permissions (usually www-data for web services).

Args:
  - project: Project name or path
  - command: The command to execute (e.g. "ls -la", "cat wp-config.php", "env")
  - service: Which service to run in (default: "appserver")`,
    inputSchema: ProjectParam.extend({
      command: z.string().min(1).describe('Command to execute (e.g. "ls -la", "cat wp-config.php")'),
      service: z.string().default("appserver").describe("Lando service to run the command in (default: appserver)"),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ project, command, service }) => {
    const dir = resolveProjectDir(project);
    // lando exec expects: lando exec <service> -- <command>
    const args = service !== "appserver"
      ? [service, "--", ...command.split(" ")]
      : [service, "--", ...command.split(" ")];
    const result = await runLando("exec", args, dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Logs ───────────────────────────────────────────────────

server.registerTool(
  "lando_logs",
  {
    title: "View Lando Logs",
    description: `View recent logs from a Lando project's services.

Shows Docker container logs for the specified service (or all services). Useful for debugging errors, checking startup output, or monitoring activity.`,
    inputSchema: ProjectParam.extend({
      service: z.string().optional().describe("Specific service to get logs from (omit for all services)"),
      lines: z.number().int().min(1).max(1000).default(100).describe("Number of log lines to retrieve (default: 100)"),
    }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project, service, lines }) => {
    const dir = resolveProjectDir(project);
    const args = [`--lines=${lines}`];
    if (service) args.push(`--service=${service}`);
    const result = await runLando("logs", args, dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── WP-CLI ─────────────────────────────────────────────────

server.registerTool(
  "lando_wp",
  {
    title: "Run WP-CLI Command",
    description: `Run a WP-CLI command inside the Lando WordPress container.

Examples:
  - "plugin list" — list installed plugins
  - "plugin activate woocommerce" — activate a plugin
  - "option get siteurl" — get site URL
  - "user list" — list WordPress users
  - "db query 'SELECT COUNT(*) FROM wp_posts'" — run a database query
  - "search-replace 'oldsite.com' 'newsite.com'" — search and replace in DB
  - "cache flush" — flush the object cache
  - "cron event list" — list scheduled cron events

Only works on WordPress/Lando projects (recipe: wordpress or lamp with WP).`,
    inputSchema: ProjectParam.extend({
      args: z.string().min(1).describe('WP-CLI arguments (e.g. "plugin list", "option get siteurl")'),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ project, args }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("wp", args.split(" "), dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Composer ───────────────────────────────────────────────

server.registerTool(
  "lando_composer",
  {
    title: "Run Composer Command",
    description: `Run a Composer (PHP dependency manager) command inside the Lando container.

Examples:
  - "install" — install dependencies from composer.json
  - "require wpackagist-plugin/woocommerce" — add a dependency
  - "update" — update all dependencies
  - "dump-autoload" — regenerate autoloader`,
    inputSchema: ProjectParam.extend({
      args: z.string().min(1).describe('Composer arguments (e.g. "install", "require package/name")'),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ project, args }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("composer", args.split(" "), dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── npm ────────────────────────────────────────────────────

server.registerTool(
  "lando_npm",
  {
    title: "Run npm Command",
    description: `Run an npm command inside the Lando container.

Examples:
  - "install" — install node_modules
  - "run build" — run the build script
  - "run dev" — start development mode
  - "list --depth=0" — list installed packages`,
    inputSchema: ProjectParam.extend({
      args: z.string().min(1).describe('npm arguments (e.g. "install", "run build")'),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ project, args }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("npm", args.split(" "), dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── MySQL ──────────────────────────────────────────────────

server.registerTool(
  "lando_mysql",
  {
    title: "Run MySQL Command",
    description: `Run a MySQL command/query inside the Lando database container.

The command string is passed directly to the mysql CLI. Useful for quick queries, checking table structure, or database operations.

Examples:
  - "-e 'SHOW TABLES'" — list tables
  - "-e 'SELECT COUNT(*) FROM wp_posts'" — count posts
  - "-e 'DESCRIBE wp_options'" — show table structure`,
    inputSchema: ProjectParam.extend({
      args: z.string().min(1).describe('MySQL CLI arguments (e.g. "-e \'SHOW TABLES\'")'),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ project, args }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("mysql", args.split(" "), dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── DB Export ──────────────────────────────────────────────

server.registerTool(
  "lando_db_export",
  {
    title: "Export Database",
    description: `Export the project's database to a SQL dump file.

The file is saved in the project directory. Useful for backups before destructive operations.`,
    inputSchema: ProjectParam.extend({
      file: z.string().optional().describe("Output filename (default: auto-generated timestamp-based name)"),
    }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project, file }) => {
    const dir = resolveProjectDir(project);
    const args = file ? [file] : [];
    const result = await runLando("db-export", args, dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── DB Import ──────────────────────────────────────────────

server.registerTool(
  "lando_db_import",
  {
    title: "Import Database",
    description: `⚠️ DESTRUCTIVE: Import a SQL dump file into the project's database, REPLACING all existing data.

The SQL file must exist in or be accessible from the project directory.`,
    inputSchema: ProjectParam.extend({
      file: z.string().min(1).describe("Path to the SQL dump file to import (relative to project dir or absolute)"),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ project, file }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("db-import", [file], dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Poweroff ───────────────────────────────────────────────

server.registerTool(
  "lando_poweroff",
  {
    title: "Power Off All Lando Apps",
    description: `⚠️ Stop ALL running Lando applications across all projects. This is a global operation that shuts down every Lando container on the system.

Use when you want a clean slate or need to free up system resources. No data is lost.`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const result = await runLando("poweroff", [], process.cwd());
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ─── Lando Config ───────────────────────────────────────────

server.registerTool(
  "lando_config",
  {
    title: "Show Lando Configuration",
    description: `Show the resolved Lando configuration for a project (merges .lando.yml with defaults and overrides).

Returns the full computed config as JSON. Useful for understanding what services, tooling, proxy routes, and build steps are configured.`,
    inputSchema: ProjectParam.strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project }) => {
    const dir = resolveProjectDir(project);
    const result = await runLando("config", [], dir);
    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  }
);

// ═════════════════════════════════════════════════════════════
// MAIN — stdio or Streamable HTTP transport
// ═════════════════════════════════════════════════════════════

async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🐳 lando-mcp-server running via stdio");
}

async function runHTTP() {
  const app = express();
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "lando-mcp-server", version: "1.0.0" });
  });

  // MCP endpoint (Streamable HTTP — stateless JSON mode)
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Handle GET/DELETE for SSE transport compatibility
  app.get("/mcp", async (req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Use POST for MCP requests" }));
  });

  const port = parseInt(process.env.LANDO_MCP_PORT || process.env.PORT || "3456");
  const bind = process.env.LANDO_MCP_BIND || "127.0.0.1";
  app.listen(port, bind, () => {
    console.error(`🐳 lando-mcp-server running on http://${bind}:${port}/mcp`);
    console.error(`   Health: http://${bind}:${port}/health`);
    console.error(`   mcporter: mcporter call http://${bind}:${port}/mcp lando_discover_projects`);
  });
}

// Choose transport based on env
const transport = process.env.TRANSPORT || "http";
if (transport === "stdio") {
  runStdio().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else {
  runHTTP().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
