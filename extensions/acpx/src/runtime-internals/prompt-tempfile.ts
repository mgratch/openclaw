// Tempfile helper for feeding prompt text to acpx under the pty path.
//
// acpx rejects stdin prompts when stdin is a TTY (see cli.js:599,
// `if (process.stdin.isTTY) throw new InvalidArgumentError(...)`) so the pty
// runner cannot reuse the pipe path's `--file -` + `stdin.end(text)` trick.
// Instead we stage the composed prompt string in a private tempfile and pass
// `--file <path>` to acpx. The tempfile lifetime spans the entire turn because
// acpx may reopen or reference the file after spawn; cleanup runs in the
// runner's `finally` block.
//
// Security shape:
//   * `fs.mkdtemp` gives the parent dir 0700 on POSIX systems.
//   * The file itself is written with explicit mode 0o600.
//   * Cleanup is idempotent via `fs.rm({ recursive: true, force: true })` so
//     late-firing cleanups after a hard abort are safe.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

export type AcpxPromptTempFile = {
  /** Absolute path that should be passed to acpx via `--file <path>`. */
  path: string;
  /** Idempotent cleanup; safe to call multiple times. */
  cleanup: () => Promise<void>;
};

/**
 * Write the composed prompt text to a private tempfile and return the absolute
 * path plus an idempotent cleanup function. The caller owns the file's
 * lifetime — typically `try { spawn(...) } finally { await file.cleanup() }`.
 */
export async function writePromptToTempFile(text: string): Promise<AcpxPromptTempFile> {
  const dir = await mkdtemp(pathJoin(tmpdir(), "acpx-prompt-"));
  const filePath = pathJoin(dir, "prompt.txt");
  await writeFile(filePath, text, { mode: 0o600 });
  let cleaned = false;
  return {
    path: filePath,
    async cleanup() {
      if (cleaned) {
        return;
      }
      cleaned = true;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
