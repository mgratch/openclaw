#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function decodeMountField(value) {
  return value.replace(/\\([0-3][0-7][0-7])/g, (_match, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

export function parseProcMounts(text, mountBase) {
  const mounts = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[2] !== "fuse.sshfs") continue;
    const source = decodeMountField(fields[0]);
    const target = decodeMountField(fields[1]);
    if (target !== mountBase && !target.startsWith(`${mountBase}/`)) continue;
    const options = new Set(fields[3].split(","));
    const separator = source.indexOf(":");
    mounts.set(target, {
      source: separator >= 0 ? source.slice(separator + 1) : source,
      access: options.has("ro") ? "ro" : "rw",
    });
  }
  return mounts;
}

function listMountBaseEntries(mountBase) {
  try {
    return fs.readdirSync(mountBase).toSorted();
  } catch {
    return [];
  }
}

function normalizeEntry(name, raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  return {
    name,
    hostPath: typeof entry.hostPath === "string" ? entry.hostPath : "",
    access: entry.access === "rw" ? "rw" : "ro",
    enabled: entry.enabled !== false,
    kind: entry.kind === "alias" ? "alias" : "mount",
    canonicalMount: typeof entry.canonicalMount === "string" ? entry.canonicalMount : undefined,
    status: typeof entry.status === "string" ? entry.status : undefined,
    reason: typeof entry.reason === "string" ? entry.reason : undefined,
    sourceLink: typeof entry.sourceLink === "string" ? entry.sourceLink : undefined,
  };
}

function findDuplicateHostPaths(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    if (!entry.hostPath) continue;
    const group = byPath.get(entry.hostPath) ?? [];
    group.push({
      name: entry.name,
      access: entry.access,
      enabled: entry.enabled,
      kind: entry.kind,
    });
    byPath.set(entry.hostPath, group);
  }
  return [...byPath.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([hostPath, rows]) => ({ hostPath, rows }));
}

function findNestedHostPaths(entries) {
  const mounts = entries.filter((entry) => entry.hostPath && entry.kind === "mount");
  const nested = [];
  for (const child of mounts) {
    for (const parent of mounts) {
      if (child.name === parent.name || child.hostPath === parent.hostPath) continue;
      const prefix = parent.hostPath.endsWith("/") ? parent.hostPath : `${parent.hostPath}/`;
      if (child.hostPath.startsWith(prefix)) {
        nested.push({
          parent: parent.name,
          parentPath: parent.hostPath,
          child: child.name,
          childPath: child.hostPath,
        });
      }
    }
  }
  return nested.toSorted((a, b) => a.child.localeCompare(b.child));
}

export function auditMountRegistry({ registry, procMounts, mountBase, filesystem = fs }) {
  const entries = Object.entries(registry)
    .map(([name, raw]) => normalizeEntry(name, raw))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const results = [];

  for (const entry of entries) {
    const mountPoint = path.join(mountBase, entry.name);
    if (!entry.enabled) {
      results.push({
        ...entry,
        host_path: entry.hostPath,
        mountPoint,
        mount_point: mountPoint,
        active: false,
        ready: false,
        state: "disabled",
      });
      continue;
    }

    if (entry.kind === "alias") {
      const canonical = entry.canonicalMount ? entryByName.get(entry.canonicalMount) : undefined;
      const canonicalPoint = canonical ? path.join(mountBase, canonical.name) : undefined;
      const canonicalMount = canonicalPoint ? procMounts.get(canonicalPoint) : undefined;
      let aliasTarget;
      try {
        aliasTarget = filesystem.lstatSync(mountPoint).isSymbolicLink()
          ? filesystem.realpathSync(mountPoint)
          : undefined;
      } catch {
        aliasTarget = undefined;
      }
      const policySafe = Boolean(
        canonical &&
        canonical.enabled &&
        canonical.kind === "mount" &&
        canonical.access === entry.access &&
        canonical.hostPath === entry.hostPath,
      );
      const active = Boolean(
        policySafe && canonicalMount && aliasTarget && aliasTarget === canonicalPoint,
      );
      results.push({
        ...entry,
        host_path: entry.hostPath,
        mountPoint,
        mount_point: mountPoint,
        active,
        ready: active,
        state: active ? "alias" : policySafe ? "missing-alias" : "invalid-alias",
        aliasTarget,
      });
      continue;
    }

    const mounted = procMounts.get(mountPoint);
    const sourceMatches = mounted?.source === entry.hostPath;
    const accessMatches = mounted?.access === entry.access;
    const active = Boolean(mounted && sourceMatches && accessMatches);
    let state = "missing";
    if (mounted && !sourceMatches) state = "source-mismatch";
    else if (mounted && !accessMatches) state = "access-mismatch";
    else if (active) state = "mounted";
    results.push({
      ...entry,
      host_path: entry.hostPath,
      mountPoint,
      mount_point: mountPoint,
      active,
      ready: active,
      state,
      actualSource: mounted?.source,
      actualAccess: mounted?.access,
    });
  }

  const registryNames = new Set(entries.map((entry) => entry.name));
  const staleDirectories = listMountBaseEntries(mountBase).filter(
    (name) => !registryNames.has(name),
  );
  const expectedTargets = new Set(
    entries
      .filter((entry) => entry.kind === "mount")
      .map((entry) => path.join(mountBase, entry.name)),
  );
  const extraFuseMounts = [...procMounts.keys()].filter((target) => !expectedTargets.has(target));
  const duplicateHostPaths = findDuplicateHostPaths(entries);
  const enabledMountConflicts = duplicateHostPaths
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => row.enabled && row.kind === "mount"),
    }))
    .filter((group) => group.rows.length > 1);
  const nestedHostPaths = findNestedHostPaths(entries);
  const enabled = results.filter((entry) => entry.enabled);
  const disabled = results.filter((entry) => !entry.enabled);
  const ready = enabled.filter((entry) => entry.ready);
  const failedEnabled = enabled.filter((entry) => !entry.ready);
  const activeFuseMounts = [...procMounts.keys()].filter((target) =>
    target.startsWith(`${mountBase}/`),
  ).length;

  const ok =
    failedEnabled.length === 0 &&
    enabledMountConflicts.length === 0 &&
    staleDirectories.length === 0 &&
    extraFuseMounts.length === 0;

  return {
    ok,
    summary: {
      registryRows: entries.length,
      enabledRows: enabled.length,
      disabledRows: disabled.length,
      readyRows: ready.length,
      activeFuseMounts,
      aliases: results.filter((entry) => entry.enabled && entry.kind === "alias").length,
      failedEnabledRows: failedEnabled.length,
      uniqueHostPaths: new Set(entries.map((entry) => entry.hostPath).filter(Boolean)).size,
      duplicateHostPathGroups: duplicateHostPaths.length,
      enabledMountConflicts: enabledMountConflicts.length,
      nestedHostPathGroups: nestedHostPaths.length,
      staleDirectories: staleDirectories.length,
      extraFuseMounts: extraFuseMounts.length,
    },
    mounts: results,
    duplicateHostPaths,
    enabledMountConflicts,
    nestedHostPaths,
    staleDirectories,
    extraFuseMounts,
  };
}

function parseArgs(argv) {
  const options = {
    registry: process.env.OPENCLAW_MOUNT_REGISTRY ?? "/home/node/.openclaw/mount-registry.json",
    procMounts: process.env.OPENCLAW_PROC_MOUNTS ?? "/proc/mounts",
    mountBase: process.env.OPENCLAW_MOUNT_BASE ?? "/mnt/host-projects",
    strict: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--registry") options.registry = argv[++index];
    else if (arg === "--proc-mounts") options.procMounts = argv[++index];
    else if (arg === "--mount-base") options.mountBase = argv[++index];
    else if (arg === "--strict") options.strict = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(fs.readFileSync(options.registry, "utf8"));
  const procMounts = parseProcMounts(
    fs.readFileSync(options.procMounts, "utf8"),
    options.mountBase,
  );
  const report = auditMountRegistry({ registry, procMounts, mountBase: options.mountBase });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (options.strict && !report.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main();
}
