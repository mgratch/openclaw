/**
 * lando.ts — Shell execution layer for Lando CLI commands.
 *
 * Runs `lando` commands in the context of a specific project directory.
 * Includes safety checks, timeout handling, and output sanitization.
 */

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ─── Configuration ──────────────────────────────────────────

/** Max execution time for any single command (ms) */
const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const LONG_TIMEOUT = 300_000;    // 5 minutes (for start/rebuild)

/** Max output size to return (chars) */
const MAX_OUTPUT = 50_000;

/**
 * Directories to scan for Lando projects.
 * Override via LANDO_PROJECTS_DIRS env var (colon-separated).
 */
function getProjectDirs(): string[] {
  if (process.env.LANDO_PROJECTS_DIRS) {
    return process.env.LANDO_PROJECTS_DIRS.split(":").map(d => resolve(d));
  }
  const home = homedir();
  return [
    join(home, "Sites"),
    join(home, "projects"),
    join(home, "dev"),
    join(home, "code"),
    join(home, "workspace"),
  ].filter(d => existsSync(d));
}

// ─── Types ──────────────────────────────────────────────────

export interface LandoProject {
  name: string;
  dir: string;
  hasLandoFile: boolean;
  landoConfig?: Record<string, unknown>;
}

export interface LandoResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

// ─── Safety ─────────────────────────────────────────────────

/** Commands that are allowed via this MCP server */
const ALLOWED_COMMANDS = new Set([
  "list", "info", "start", "stop", "restart", "rebuild",
  "destroy", "logs", "ssh", "exec", "config", "version",
  "wp", "drush", "composer", "npm", "node", "php", "mysql",
  "db-import", "db-export", "poweroff",
]);

/** Commands considered destructive — require extra caution */
const DESTRUCTIVE_COMMANDS = new Set([
  "destroy", "rebuild", "poweroff", "db-import",
]);

function validateCommand(command: string): void {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(
      `Command "${command}" is not allowed. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`
    );
  }
}

// ─── Project Discovery ──────────────────────────────────────

/**
 * Find all directories containing a .lando.yml or .lando.yaml file.
 * Scans one level deep in each configured project directory.
 */
export function discoverProjects(): LandoProject[] {
  const projects: LandoProject[] = [];
  const seen = new Set<string>();

  for (const parentDir of getProjectDirs()) {
    try {
      const entries = readdirSync(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = join(parentDir, entry.name);
        if (seen.has(dir)) continue;
        seen.add(dir);

        const hasYml = existsSync(join(dir, ".lando.yml"));
        const hasYaml = existsSync(join(dir, ".lando.yaml"));
        if (hasYml || hasYaml) {
          let landoConfig: Record<string, unknown> | undefined;
          try {
            const configFile = hasYml ? ".lando.yml" : ".lando.yaml";
            const raw = readFileSync(join(dir, configFile), "utf8");
            // Basic YAML name extraction (avoids needing a yaml dep)
            const nameMatch = raw.match(/^name:\s*['"]?(\S+?)['"]?\s*$/m);
            const recipeMatch = raw.match(/^recipe:\s*['"]?(\S+?)['"]?\s*$/m);
            landoConfig = {
              name: nameMatch?.[1] || basename(dir),
              recipe: recipeMatch?.[1] || "unknown",
              configFile,
            };
          } catch { /* ignore parse errors */ }

          projects.push({
            name: landoConfig?.name as string || basename(dir),
            dir,
            hasLandoFile: true,
            landoConfig,
          });
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a project name or path to an absolute directory.
 * Accepts: project name (matched against discovered projects), or an absolute path.
 */
export function resolveProjectDir(nameOrPath: string): string {
  // Absolute path
  if (nameOrPath.startsWith("/")) {
    const resolved = resolve(nameOrPath);
    if (!existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    return resolved;
  }

  // ~ expansion
  if (nameOrPath.startsWith("~")) {
    const resolved = resolve(nameOrPath.replace("~", homedir()));
    if (!existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    return resolved;
  }

  // Match by project name
  const projects = discoverProjects();
  const match = projects.find(
    p => p.name.toLowerCase() === nameOrPath.toLowerCase()
      || basename(p.dir).toLowerCase() === nameOrPath.toLowerCase()
  );
  if (match) return match.dir;

  // Try each project dir as parent
  for (const parent of getProjectDirs()) {
    const candidate = join(parent, nameOrPath);
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Could not resolve project "${nameOrPath}". Known projects: ${projects.map(p => p.name).join(", ") || "(none found)"}`
  );
}

// ─── Command Execution ──────────────────────────────────────

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return text.slice(0, MAX_OUTPUT) + `\n\n… [truncated, ${text.length - MAX_OUTPUT} chars omitted]`;
}

/**
 * Run a lando command in the specified project directory.
 */
export async function runLando(
  command: string,
  args: string[],
  projectDir: string,
  options?: { timeout?: number }
): Promise<LandoResult> {
  validateCommand(command);

  const isLong = ["start", "rebuild", "destroy", "db-import", "db-export"].includes(command);
  const timeout = options?.timeout || (isLong ? LONG_TIMEOUT : DEFAULT_TIMEOUT);

  try {
    const { stdout, stderr } = await execFileAsync(
      "lando",
      [command, ...args],
      {
        cwd: projectDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: {
          ...process.env,
          // Suppress Lando's interactive prompts
          LANDO_NO_TELEMETRY: "1",
        },
      }
    );

    return {
      ok: true,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      exitCode: 0,
    };
  } catch (err: any) {
    const timedOut = err.killed || err.signal === "SIGTERM";
    return {
      ok: false,
      stdout: truncate(err.stdout || ""),
      stderr: truncate(err.stderr || err.message || "Unknown error"),
      exitCode: err.code ?? 1,
      timedOut,
    };
  }
}

/**
 * Run `lando list` globally (not project-specific) to get running apps.
 */
export async function landoList(): Promise<LandoResult> {
  try {
    const { stdout, stderr } = await execAsync("lando list --format=json", {
      timeout: DEFAULT_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, LANDO_NO_TELEMETRY: "1" },
    });
    return { ok: true, stdout: truncate(stdout), stderr: truncate(stderr), exitCode: 0 };
  } catch (err: any) {
    return {
      ok: false,
      stdout: truncate(err.stdout || ""),
      stderr: truncate(err.stderr || err.message || ""),
      exitCode: err.code ?? 1,
    };
  }
}

/**
 * Check if a command is destructive.
 */
export function isDestructive(command: string): boolean {
  return DESTRUCTIVE_COMMANDS.has(command);
}
