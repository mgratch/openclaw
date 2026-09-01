import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

export type PersistedSubagentRegistryVersion = 1 | 2;

type PersistedSubagentRegistryV1 = {
  version: 1;
  runs: Record<string, LegacySubagentRunRecord>;
};

type PersistedSubagentRegistryV2 = {
  version: 2;
  runs: Record<string, PersistedSubagentRunRecord>;
};

type PersistedSubagentRegistry = PersistedSubagentRegistryV1 | PersistedSubagentRegistryV2;

const REGISTRY_VERSION = 2 as const;

type PersistedSubagentRunRecord = SubagentRunRecord;

type LegacySubagentRunRecord = PersistedSubagentRunRecord & {
  announceCompletedAt?: unknown;
  announceHandled?: unknown;
  requesterChannel?: unknown;
  requesterAccountId?: unknown;
};

function resolveSubagentStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENCLAW_STATE_DIR?.trim();
  if (explicit) {
    return resolveStateDir(env);
  }
  if (env.VITEST || env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "openclaw-test-state", String(process.pid));
  }
  return resolveStateDir(env);
}

export function resolveSubagentRegistryPath(): string {
  return path.join(resolveSubagentStateDir(process.env), "subagents", "runs.json");
}

// mtime+size-keyed cache of the parsed registry. Display helpers call
// loadSubagentRegistryFromDisk per lookup (cross-process freshness), and
// sessions.list does several lookups per row — without this, one list call
// over ~6k sessions re-read and re-parsed the multi-MB runs.json 10k+ times
// (profiled at ~65% of the call: readFileSync + JSON.parse in a loop).
// Writers go through saveSubagentRegistryToDisk, which bumps mtime and
// invalidates naturally; other processes' writes do the same.
type RegistryDiskCache = {
  mtimeMs: number;
  sizeBytes: number;
  // Writes go through an atomic rename, so every rewrite lands on a new inode
  // — including same-size rewrites within one mtime tick.
  ino: number;
  runs: Map<string, SubagentRunRecord>;
};
let registryDiskCache: RegistryDiskCache | null = null;

/** Test seam: forget the memoized on-disk registry snapshot. */
export function clearSubagentRegistryDiskCacheForTests() {
  registryDiskCache = null;
}

export function loadSubagentRegistryFromDisk(): Map<string, SubagentRunRecord> {
  const pathname = resolveSubagentRegistryPath();
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(pathname);
  } catch {
    registryDiskCache = null;
  }
  if (
    stat &&
    registryDiskCache &&
    registryDiskCache.mtimeMs === stat.mtimeMs &&
    registryDiskCache.sizeBytes === stat.size &&
    registryDiskCache.ino === stat.ino
  ) {
    return registryDiskCache.runs;
  }
  const runs = loadSubagentRegistryFromDiskUncached(pathname);
  registryDiskCache = stat
    ? { mtimeMs: stat.mtimeMs, sizeBytes: stat.size, ino: stat.ino, runs }
    : null;
  return runs;
}

function loadSubagentRegistryFromDiskUncached(pathname: string): Map<string, SubagentRunRecord> {
  const raw = loadJsonFile(pathname);
  if (!raw || typeof raw !== "object") {
    return new Map();
  }
  const record = raw as Partial<PersistedSubagentRegistry>;
  if (record.version !== 1 && record.version !== 2) {
    return new Map();
  }
  const runsRaw = record.runs;
  if (!runsRaw || typeof runsRaw !== "object") {
    return new Map();
  }
  const out = new Map<string, SubagentRunRecord>();
  const isLegacy = record.version === 1;
  let migrated = false;
  for (const [runId, entry] of Object.entries(runsRaw)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const typed = entry as LegacySubagentRunRecord;
    if (!typed.runId || typeof typed.runId !== "string") {
      continue;
    }
    const legacyCompletedAt =
      isLegacy && typeof typed.announceCompletedAt === "number"
        ? typed.announceCompletedAt
        : undefined;
    const cleanupCompletedAt =
      typeof typed.cleanupCompletedAt === "number" ? typed.cleanupCompletedAt : legacyCompletedAt;
    const cleanupHandled =
      typeof typed.cleanupHandled === "boolean"
        ? typed.cleanupHandled
        : isLegacy
          ? Boolean(typed.announceHandled ?? cleanupCompletedAt)
          : undefined;
    const requesterOrigin = normalizeDeliveryContext(
      typed.requesterOrigin ?? {
        channel: typeof typed.requesterChannel === "string" ? typed.requesterChannel : undefined,
        accountId:
          typeof typed.requesterAccountId === "string" ? typed.requesterAccountId : undefined,
      },
    );
    const {
      announceCompletedAt: _announceCompletedAt,
      announceHandled: _announceHandled,
      requesterChannel: _channel,
      requesterAccountId: _accountId,
      ...rest
    } = typed;
    out.set(runId, {
      ...rest,
      requesterOrigin,
      cleanupCompletedAt,
      cleanupHandled,
      spawnMode: typed.spawnMode === "session" ? "session" : "run",
    });
    if (isLegacy) {
      migrated = true;
    }
  }
  if (migrated) {
    try {
      saveSubagentRegistryToDisk(out);
    } catch {
      // ignore migration write failures
    }
  }
  return out;
}

export function saveSubagentRegistryToDisk(runs: Map<string, SubagentRunRecord>) {
  const pathname = resolveSubagentRegistryPath();
  const serialized: Record<string, PersistedSubagentRunRecord> = {};
  for (const [runId, entry] of runs.entries()) {
    serialized[runId] = entry;
  }
  const out: PersistedSubagentRegistry = {
    version: REGISTRY_VERSION,
    runs: serialized,
  };
  saveJsonFile(pathname, out);
}
