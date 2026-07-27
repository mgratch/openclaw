// Environment probe for the upgrade-contracts harness. Everything here is
// strictly read-only. The probe fingerprints just enough of the running
// runtime for downstream checks to decide whether their prerequisites are met.
//
// Guardrails:
//   * never mutate the gateway config;
//   * never restart or hot-reload the gateway;
//   * never call an endpoint that would emit a message externally;
//   * never serialize raw secret values or the raw contents of openclaw.json —
//     only structural counts, whitelisted structure summaries, and paths.
//
// Environment overrides (per-plan):
//   OPENCLAW_STATE_DIR          — override ~/.openclaw
//   OPENCLAW_CONFIG_PATH        — override the openclaw.json path
//   OPENCLAW_UI_ROOT            — override the sibling UI checkpoint root
//   OPENCLAW_WORKSPACE_DB       — override the workspace conversations.db
//   OPENCLAW_MOUNT_REGISTRY     — override the mount-registry.json
//   OPENCLAW_MOUNT_BASE         — override /mnt/host-projects
//   OPENCLAW_PROC_MOUNTS        — override /proc/self/mounts
//   OPENCLAW_GATEWAY_URL        — gateway URL for the /health probe

import { execFile } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const HOME =
  process.env.OPENCLAW_STATE_DIR ??
  process.env.OPENCLAW_HOME ??
  path.join(os.homedir(), ".openclaw");
export const REPO_ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
export const UI_ROOT = process.env.OPENCLAW_UI_ROOT ?? "/mnt/host-projects/openclaw--openclaw-ui";
export const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? path.join(HOME, "openclaw.json");
export const WORKSPACE_DB =
  process.env.OPENCLAW_WORKSPACE_DB ?? path.join(HOME, "workspace", "conversations.db");
export const MOUNT_REGISTRY =
  process.env.OPENCLAW_MOUNT_REGISTRY ?? path.join(HOME, "mount-registry.json");
export const MOUNT_BASE = process.env.OPENCLAW_MOUNT_BASE ?? "/mnt/host-projects";
export const PROC_MOUNTS = process.env.OPENCLAW_PROC_MOUNTS ?? "/proc/self/mounts";
export const CHECKPOINT_ROOT = path.join(HOME, "upgrade-checkpoints");

const DEFAULT_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";

export async function probeEnvironment({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const capabilities = {};
  const info = {
    now: now().toISOString(),
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    stateDir: HOME,
    repoRoot: REPO_ROOT,
    uiRoot: UI_ROOT,
    configPath: CONFIG_PATH,
    workspaceDbPath: WORKSPACE_DB,
    mountRegistryPath: MOUNT_REGISTRY,
    mountBase: MOUNT_BASE,
    procMountsPath: PROC_MOUNTS,
    gatewayUrl: DEFAULT_GATEWAY_URL,
  };

  info.git = await probeGit();
  info.openClawJson = await probeOpenClawJson(CONFIG_PATH, capabilities);
  info.gateway = await probeGateway(DEFAULT_GATEWAY_URL, fetchImpl, capabilities);
  info.mounts = await probeMounts(capabilities);
  info.extensions = await probeExtensions(capabilities);
  info.mcpServers = await probeMcpDirs();
  info.browser = await probeBrowser();
  info.workspaceDb = await probeWorkspaceDb(capabilities);
  info.uiCheckpoint = await probeUiCheckpoint(capabilities);

  return { info, capabilities };
}

async function probeGit() {
  try {
    const { stdout: head } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
    const { stdout: branch } = await execFileP("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: REPO_ROOT,
    });
    const { stdout: status } = await execFileP("git", ["status", "--porcelain=v1"], {
      cwd: REPO_ROOT,
    });
    return {
      head: head.trim(),
      branch: branch.trim(),
      dirty: status.trim().length > 0,
      dirtyFileCount: status.trim().split(/\n+/).filter(Boolean).length,
    };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

async function probeOpenClawJson(p, capabilities) {
  try {
    const buf = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(buf);
    capabilities["openclaw.json"] = true;

    // Deliberately compute counts from the shapes we know exist in the
    // effective config. NEVER read raw secret values.
    const agents = parsed?.agents;
    const agentListCount = Array.isArray(agents?.list) ? agents.list.length : 0;
    const mcp = parsed?.mcp?.servers;
    const mcpServerNames = mcp && typeof mcp === "object" ? Object.keys(mcp).toSorted() : [];
    const plugins = parsed?.plugins ?? {};
    const entries = plugins?.entries ?? {};
    // We reference "effective enabled entries" — entries listed AND not
    // explicitly disabled. This is what the runtime treats as active.
    const entryIds = Object.keys(entries).toSorted();
    const enabledEntries = entryIds.filter((id) => entries[id]?.enabled !== false);
    const disabledEntries = entryIds.filter((id) => entries[id]?.enabled === false);
    const stockMemoryPresent = Object.prototype.hasOwnProperty.call(entries, "memory-lancedb");
    const stockMemoryEnabled = stockMemoryPresent && entries["memory-lancedb"]?.enabled !== false;
    const projectMemoryEnabled =
      Object.prototype.hasOwnProperty.call(entries, "memory-lancedb-project") &&
      entries["memory-lancedb-project"]?.enabled !== false;
    const allowedModels = parsed?.agents?.defaults?.models ?? {};
    const anthropicProviderModels = Array.isArray(parsed?.models?.providers?.anthropic?.models)
      ? parsed.models.providers.anthropic.models
      : [];
    const requiredModelIds = ["anthropic/claude-opus-4-8", "anthropic/claude-opus-5"];
    const requiredModels = requiredModelIds.map((id) => {
      const providerModelId = id.slice(id.indexOf("/") + 1);
      return {
        id,
        allowed: Object.prototype.hasOwnProperty.call(allowedModels, id),
        providerDeclared: anthropicProviderModels.some((model) => model?.id === providerModelId),
      };
    });

    return {
      path: p,
      version: parsed?.meta?.lastTouchedVersion ?? null,
      lastTouchedAt: parsed?.meta?.lastTouchedAt ?? null,
      topLevelKeys: Object.keys(parsed).toSorted(),
      agentListCount,
      mcpServerCount: mcpServerNames.length,
      mcpServerNames,
      pluginsEnabled: plugins?.enabled !== false,
      pluginSlots: plugins?.slots ?? {},
      pluginLoadPaths: Array.isArray(plugins?.load?.paths) ? plugins.load.paths.slice() : [],
      pluginEntryIds: entryIds,
      pluginEntryStates: entryIds.map((id) => ({ id, enabled: entries[id]?.enabled !== false })),
      enabledEntryIds: enabledEntries,
      disabledEntryIds: disabledEntries,
      stockMemoryPresent,
      stockMemoryEnabled,
      projectMemoryEnabled,
      requiredModels,
      browserProfileCount: Object.keys(parsed?.browser?.profiles ?? {}).length,
    };
  } catch (err) {
    return { path: p, error: `openclaw.json not readable: ${err?.message ?? err}` };
  }
}

async function probeGateway(url, fetchImpl, capabilities) {
  if (!fetchImpl) {
    return { url, error: "no fetch impl" };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    const res = await fetchImpl(`${url}/health`, { signal: ctl.signal });
    clearTimeout(timer);
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    if (res.ok) {
      capabilities["gateway.http"] = true;
    }
    return { url, status: res.status, body: parsed };
  } catch (err) {
    return { url, error: err?.message ?? String(err) };
  }
}

async function probeMounts(capabilities) {
  try {
    if (!existsSync(MOUNT_REGISTRY)) {
      return { path: MOUNT_REGISTRY, error: "no mount registry" };
    }
    const raw = await fs.readFile(MOUNT_REGISTRY, "utf8");
    const registry = JSON.parse(raw);
    const rows = Object.entries(registry).map(([name, v]) => ({
      name,
      access: v?.access === "rw" ? "rw" : "ro",
      enabled: v?.enabled !== false,
      kind: v?.kind === "alias" ? "alias" : "mount",
    }));
    capabilities["mount-registry"] = true;
    return {
      path: MOUNT_REGISTRY,
      totalRows: rows.length,
      enabled: rows.filter((r) => r.enabled).length,
      disabled: rows.filter((r) => !r.enabled).length,
      aliases: rows.filter((r) => r.kind === "alias").length,
      readOnly: rows.filter((r) => r.access === "ro").length,
      readWrite: rows.filter((r) => r.access === "rw").length,
    };
  } catch (err) {
    return { path: MOUNT_REGISTRY, error: err?.message ?? String(err) };
  }
}

async function probeExtensions(capabilities) {
  const extRoot = path.join(HOME, "extensions");
  try {
    const entries = await fs.readdir(extRoot, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .toSorted();
    capabilities["memory.project-plugin"] = dirs.includes("memory-lancedb-project");
    capabilities["memory.stock-plugin-present"] = dirs.includes("memory-lancedb");
    capabilities["extension.session-context-recovery"] = dirs.includes("session-context-recovery");
    capabilities["extension.transcript-archive"] = dirs.includes("transcript-archive");
    return { root: extRoot, entries: dirs };
  } catch (err) {
    return { root: extRoot, error: err?.message ?? String(err) };
  }
}

async function probeMcpDirs() {
  const mcpRoot = path.join(HOME, "mcp");
  try {
    const entries = await fs.readdir(mcpRoot, { withFileTypes: true });
    return {
      root: mcpRoot,
      entries: entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .toSorted(),
    };
  } catch (err) {
    return { root: mcpRoot, error: err?.message ?? String(err) };
  }
}

async function probeBrowser() {
  try {
    const portsPath = path.join(HOME, "browser-ports.json");
    if (!existsSync(portsPath)) {
      return { path: portsPath, error: "no browser-ports.json" };
    }
    const raw = await fs.readFile(portsPath, "utf8");
    const ports = JSON.parse(raw);
    return {
      path: portsPath,
      profileCount: Object.keys(ports).length,
      profileIds: Object.keys(ports).toSorted(),
    };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

async function probeWorkspaceDb(capabilities) {
  try {
    const st = await fs.stat(WORKSPACE_DB);
    capabilities["sqlite.readonly"] = true;
    return {
      path: WORKSPACE_DB,
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
    };
  } catch (err) {
    return { path: WORKSPACE_DB, error: err?.message ?? String(err) };
  }
}

async function probeUiCheckpoint(capabilities) {
  try {
    if (!existsSync(UI_ROOT)) {
      return { path: UI_ROOT, error: "ui checkpoint not accessible" };
    }
    const st = await fs.stat(UI_ROOT);
    capabilities["ui.checkpoint"] = true;
    return { path: UI_ROOT, isDirectory: st.isDirectory() };
  } catch (err) {
    return { path: UI_ROOT, error: err?.message ?? String(err) };
  }
}
