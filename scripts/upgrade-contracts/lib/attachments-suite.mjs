// Helpers for the attachments focused-behavior check.
//
// Runs a small, deterministic set of Vitest files inside this repository that
// together prove the *actual* 2026.4.2 attachment behavior on the offload
// boundary and hostile-label surface, using the generic focused-vitest-runner.
// The suite deliberately DOES NOT shell out to `pnpm` or `corepack` —
// everything is a direct execFile of Node against the already-resolved local
// `vitest.mjs`. This keeps the harness fail-closed under a "no network / no
// downloads" gate and consistent with the memory-firewall / runner-recovery
// harnesses.
//
// Files that must have run (and pass, none skipped):
//   * src/gateway/chat-attachments.offload.test.ts       (9)
//   * src/gateway/chat-attachments.test.ts               (11)
//   * src/media/base64.test.ts                           (5)
//   * src/media/store.test.ts                            (35)
//   * src/media/input-files.fetch-guard.test.ts          (11)
//
// Together they cover the offload branch (supported-format detection,
// unsupported-format refusal, cleanup on later failure, MediaOffloadError vs
// input-Error classification, no absolute path leakage), the base64
// validation twin, the media-store containment invariants on hostile
// filenames, and the default input-file MIME allowlist (calendar + JSONL
// variants, no blanket text/*).

import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./env.mjs";
import {
  runFocusedVitest,
  summarizeVitestResult as summarizeVitestResultGeneric,
} from "./focused-vitest-runner.mjs";

/** Vitest files (repo-relative to REPO_ROOT) run by this focused suite. */
export const FOCUSED_ATTACHMENTS_TEST_FILES = Object.freeze([
  "src/gateway/chat-attachments.offload.test.ts",
  "src/gateway/chat-attachments.test.ts",
  "src/media/base64.test.ts",
  "src/media/store.test.ts",
  "src/media/input-files.fetch-guard.test.ts",
]);

/**
 * Minimum tests that must pass across the exact focused file set.
 * 9 + 11 + 5 + 35 + 11 = 71. If a test is removed the suite must fail loudly,
 * not silently accept a smaller run.
 */
export const MIN_FOCUSED_ATTACHMENTS_TESTS = 71;

/** Free-form label used in the passing notes string. */
const ATTACHMENTS_SUITE_LABEL = "Focused attachments suite";

/** Wall-clock timeout for the whole subprocess. */
export const ATTACHMENTS_VITEST_TIMEOUT_MS = 180_000;
/** Combined stdout/stderr collector budget. */
export const ATTACHMENTS_VITEST_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Resolve the OpenClaw repo root. Callers may pass an explicit `defaultRoot`
 * (unit tests do this to drive resolution without touching the real repo);
 * otherwise the shared REPO_ROOT from env.mjs is used.
 *
 * @param {{ defaultRoot?: string }} [options]
 * @returns {string}
 */
export function resolveRepoRoot({ defaultRoot } = {}) {
  if (typeof defaultRoot === "string" && defaultRoot.length > 0) {
    return defaultRoot;
  }
  return REPO_ROOT;
}

/**
 * Resolve vitest.mjs under the given repo root. We only look at the local
 * `node_modules/vitest/vitest.mjs` because this suite runs inside the primary
 * repo, which is expected to have its own local install. We never fetch or
 * install; if the entrypoint is missing, the caller must fail closed.
 *
 * @param {string} repoRoot
 * @param {{ existsSyncImpl?: (p: string) => boolean }} [options]
 * @returns {string | null}
 */
export function resolveVitestPath(repoRoot, { existsSyncImpl = existsSync } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    return null;
  }
  const candidate = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  return existsSyncImpl(candidate) ? candidate : null;
}

/**
 * Execute the focused attachments Vitest suite. Fail-closed on:
 *   * missing repo root, missing vitest.mjs → no subprocess is spawned;
 *   * spawn errors, timeouts, non-zero exit;
 *   * skipped/failed tests, or fewer than MIN_FOCUSED_ATTACHMENTS_TESTS;
 *   * unparseable Vitest summary.
 *
 * The subprocess is always Node executing vitest.mjs directly — never pnpm,
 * corepack, or any wrapper — so no packages can be downloaded at runtime.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   repoRoot?: string,
 *   existsSyncImpl?: (p: string) => boolean,
 *   runFn?: typeof runFocusedVitest,
 *   nodeExecPath?: string,
 *   timeoutMs?: number,
 *   maxBuffer?: number,
 * }} [options]
 */
export async function runFocusedAttachmentsSuite(options = {}) {
  const env = options.env ?? process.env;
  const existsSyncImpl = options.existsSyncImpl ?? existsSync;
  const runFn = options.runFn ?? runFocusedVitest;
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? ATTACHMENTS_VITEST_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? ATTACHMENTS_VITEST_MAX_BUFFER;

  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  if (!existsSyncImpl(repoRoot)) {
    return {
      status: "fail",
      evidence: [
        { label: "repo root exists", value: false },
        { label: "vitest resolved", value: false },
      ],
      notes: "OpenClaw repo root not accessible; refusing to run.",
    };
  }

  const vitestPath = resolveVitestPath(repoRoot, { existsSyncImpl });
  if (!vitestPath) {
    return {
      status: "fail",
      evidence: [
        { label: "repo root exists", value: true },
        { label: "vitest resolved", value: false },
      ],
      notes:
        "vitest.mjs not found under repo node_modules — refusing to fall back to pnpm/corepack.",
    };
  }

  const args = [vitestPath, "run", "--root", repoRoot, ...FOCUSED_ATTACHMENTS_TEST_FILES];

  const result = await runFn({
    execPath: nodeExecPath,
    args,
    cwd: repoRoot,
    env,
    timeoutMs,
    maxBuffer,
  });

  return summarizeVitestResultGeneric(result, {
    expectedFiles: FOCUSED_ATTACHMENTS_TEST_FILES.length,
    minTests: MIN_FOCUSED_ATTACHMENTS_TESTS,
    suiteLabel: ATTACHMENTS_SUITE_LABEL,
  });
}
