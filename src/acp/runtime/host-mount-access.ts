import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const HOST_PROJECTS_ROOT = "/mnt/host-projects/";

type MountEntry = {
  target: string;
  options: string[];
};

/**
 * Parse `/proc/mounts` into an array of (target, options) records.
 * Each line has the form `source target fstype options dump pass`.
 */
function parseProcMounts(raw: string): MountEntry[] {
  const entries: MountEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }
    entries.push({
      target: parts[1] ?? "",
      options: (parts[3] ?? "").split(","),
    });
  }
  return entries;
}

/**
 * Find the longest mount target that is an ancestor of `path`.
 * Returns undefined if no mount is found.
 */
function findOwningMount(path: string, mounts: MountEntry[]): MountEntry | undefined {
  let best: MountEntry | undefined;
  for (const entry of mounts) {
    if (!entry.target) {
      continue;
    }
    if (path === entry.target || path.startsWith(`${entry.target}/`)) {
      if (!best || entry.target.length > best.target.length) {
        best = entry;
      }
    }
  }
  return best;
}

/**
 * Per-session mount baseline derived from /proc/mounts. When the agent's cwd
 * is rooted under /mnt/host-projects/<name>, we report both the absolute
 * mount root path and whether it is mounted read-write. The runtime's
 * permission policy uses this to auto-approve tool calls whose target path
 * lies inside `root` (reads always; writes only when `writable`).
 */
export type HostProjectMountBaseline = {
  /** Absolute mount target, for example `/mnt/host-projects/foo`. */
  root: string;
  /** True if the mount is read-write, false if mounted `ro`. */
  writable: boolean;
};

/**
 * Detect the project-mount baseline for the given cwd. Returns the owning
 * /mnt/host-projects/<name> mount (root + writable flag) or `undefined` when
 * the cwd is not under /mnt/host-projects/ or mount info is unavailable
 * (non-Linux, /proc/mounts unreadable, etc.). Callers treat `undefined` as
 * "no baseline, surface every prompt."
 */
export async function detectHostProjectMountBaseline(
  cwd: string | undefined,
): Promise<HostProjectMountBaseline | undefined> {
  if (!cwd || !isAbsolute(cwd)) {
    return undefined;
  }
  const resolved = resolve(cwd);
  if (!resolved.startsWith(HOST_PROJECTS_ROOT)) {
    return undefined;
  }
  let raw: string;
  try {
    raw = await readFile("/proc/mounts", "utf8");
  } catch {
    return undefined;
  }
  const mounts = parseProcMounts(raw);
  const owning = findOwningMount(resolved, mounts);
  if (!owning) {
    return undefined;
  }
  // `ro` and `rw` are mutually exclusive mount options. Prefer explicit `ro`
  // over absence so we don't false-positive when the option list is empty.
  const writable = !owning.options.includes("ro");
  return { root: owning.target, writable };
}

/**
 * Back-compat shim for callers that only care about the boolean. Delegates
 * to {@link detectHostProjectMountBaseline} and drops the root. New code
 * should prefer the baseline variant so the policy layer can scope auto
 * approval to the owning mount.
 */
export async function detectHostProjectMountReadOnly(
  cwd: string | undefined,
): Promise<boolean | undefined> {
  const baseline = await detectHostProjectMountBaseline(cwd);
  if (!baseline) {
    return undefined;
  }
  return !baseline.writable;
}
