// PTY-based spawn path for acpx. Needed because acpx's interactive permission
// prompt only fires when both stdin and stderr are TTYs (see
// `canPromptForPermission$1` in acpx session source). Routing acpx under a
// pseudo-terminal lets us:
//
//   * have acpx render `[permission] Allow ...? (y/N)` prompts to stderr,
//   * read those prompts back on the pty master,
//   * and reply with `y\n`/`n\n` by writing to the master fd (which is the
//     child's stdin).
//
// Both stdout (NDJSON events) and stderr (prompt text) appear on the master
// side of the pty because the child sees all three stdio fds pointing at the
// same slave device — just like running in a real terminal. Callers must
// demux by line content; see `permission-prompt.ts` for the matcher we pair
// with this helper.
//
// Deliberately minimal: we wrap node-pty lazily so non-interactive turns that
// never take the pty path do not pay the native binding cost.

import type { SpawnCommandOptions } from "./process.js";
import { resolveSpawnCommand } from "./process.js";

export type PtySpawnParams = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
};

export type PtyProcessHandle = {
  pid: number;
  /** Called once per data chunk from the pty master (merged stdout/stderr). */
  onData(listener: (chunk: string) => void): () => void;
  /** Called once when the child exits, with exit code and signal if any. */
  onExit(
    listener: (result: { exitCode: number; signal?: number }) => void,
  ): () => void;
  /**
   * Write bytes back to the child. For acpx interactive prompts we write
   * `y\n` or `n\n` to answer readline.question on the child's stdin.
   */
  write(data: string): void;
  /**
   * Terminate the child. node-pty accepts a signal name; on Linux this sends
   * SIGTERM by default. Safe to call multiple times.
   */
  kill(signal?: string): void;
};

type LoadedPtyModule = {
  spawn: (
    command: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    },
  ) => {
    pid: number;
    onData(cb: (data: string) => void): { dispose(): void };
    onExit(cb: (ev: { exitCode: number; signal?: number }) => void): {
      dispose(): void;
    };
    write(data: string): void;
    kill(signal?: string): void;
  };
};

let cachedPtyModule: Promise<LoadedPtyModule> | undefined;

async function loadNodePty(): Promise<LoadedPtyModule> {
  if (!cachedPtyModule) {
    cachedPtyModule = import("node-pty").then((mod) => {
      const candidate = (mod as { default?: LoadedPtyModule; spawn?: LoadedPtyModule["spawn"] })
        .default ?? (mod as unknown as LoadedPtyModule);
      if (!candidate || typeof candidate.spawn !== "function") {
        throw new Error(
          "node-pty module did not expose a spawn() function; check native binding build",
        );
      }
      return candidate;
    });
  }
  return cachedPtyModule;
}

/**
 * Returns true if the current platform supports the pty spawn path. We
 * intentionally gate Windows out for the first iteration because acpx's
 * interactive prompt uses POSIX readline behavior and node-pty on Windows
 * runs through ConPTY with different line-buffering semantics.
 */
export function isPtySpawnSupported(): boolean {
  return process.platform !== "win32";
}

/**
 * Spawn acpx under a pseudo-terminal. The returned handle exposes a
 * data/exit/write/kill surface deliberately shaped to parallel the existing
 * child_process-based path without requiring callers to know about node-pty
 * internals.
 *
 * The command resolution goes through `resolveSpawnCommand` so that the same
 * Windows wrapper + node shebang rewriting that the pipe path uses applies
 * here too. On non-Windows platforms the resolution is effectively a passthru
 * unless acpx is installed as a node shebang script, in which case it rewrites
 * to `node <scriptPath>` — safe under a pty.
 */
export async function spawnAcpxUnderPty(
  params: PtySpawnParams,
  options?: SpawnCommandOptions,
): Promise<PtyProcessHandle> {
  if (!isPtySpawnSupported()) {
    throw new Error(
      "pty spawn is not supported on this platform; fall back to the pipe path",
    );
  }
  const pty = await loadNodePty();
  const resolved = resolveSpawnCommand(
    { command: params.command, args: params.args },
    options,
  );
  const child = pty.spawn(resolved.command, resolved.args, {
    name: "xterm-256color",
    cols: params.cols ?? 120,
    rows: params.rows ?? 40,
    cwd: params.cwd,
    env: params.env ?? process.env,
  });
  return {
    pid: child.pid,
    onData(listener) {
      const sub = child.onData(listener);
      return () => sub.dispose();
    },
    onExit(listener) {
      const sub = child.onExit((ev) =>
        listener({ exitCode: ev.exitCode, signal: ev.signal }),
      );
      return () => sub.dispose();
    },
    write(data) {
      child.write(data);
    },
    kill(signal) {
      try {
        child.kill(signal);
      } catch {
        // Ignore kill races when the child has already exited.
      }
    },
  };
}

/** Test-only hook to reset the cached dynamic import. */
export function __resetLoadedPtyModuleForTest(): void {
  cachedPtyModule = undefined;
}
