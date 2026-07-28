// Helpers for the ui-checkpoint focused-behavior check.
//
// Runs a small, deterministic set of Vitest files inside the sibling UI
// checkpoint repository, using the generic focused-vitest-runner. The suite
// deliberately DOES NOT shell out to `pnpm` or `corepack` — everything is a
// direct execFile of Node against a pre-resolved `vitest.mjs` on disk. This
// keeps the harness fail-closed under a "no network / no downloads" gate.
//
// Files that must have run (and pass, none skipped):
//   * src/utils/__tests__/modelFallbackOrder.test.ts     (UI-01)
//   * src/utils/__tests__/projectApi.acp-presets.test.ts (UI-02b, model-provenance)
//   * src/utils/__tests__/toolCallCorrelation.test.ts    (UI-03a)
//   * src/utils/__tests__/runLifecycle.test.ts           (UI-03b)
//
// Together they cover the focused fallback-persistence, model-provenance,
// tool-correlation, heartbeat/stall, terminal-cleanup, and current-run tool
// accounting behaviors that this check is asked to prove.

import { existsSync } from "node:fs";
import path from "node:path";
import {
  runFocusedVitest,
  summarizeVitestResult as summarizeVitestResultGeneric,
} from "./focused-vitest-runner.mjs";

/** Vitest files (repo-relative to UI_ROOT) run by this focused suite. */
export const FOCUSED_UI_TEST_FILES = Object.freeze([
  "src/utils/__tests__/modelFallbackOrder.test.ts",
  "src/utils/__tests__/projectApi.acp-presets.test.ts",
  "src/utils/__tests__/toolCallCorrelation.test.ts",
  "src/utils/__tests__/runLifecycle.test.ts",
]);

/** Minimum tests that must pass across the exact focused file set. */
export const MIN_FOCUSED_UI_TESTS = 52;

/** Free-form label used in the passing notes string. */
const UI_SUITE_LABEL = "Focused UI checkpoint suite";

/** Wall-clock timeout for the whole subprocess. Focused suite is ~1s locally. */
export const UI_VITEST_TIMEOUT_MS = 60_000;
/** Combined stdout/stderr collector budget. */
export const UI_VITEST_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Resolve the UI checkpoint root, honoring the OPENCLAW_UI_ROOT override.
 * The override may come from process.env or from an explicit env-like object
 * (so unit tests can drive resolution without mutating real process.env).
 *
 * @param {{ env?: Record<string, string | undefined>, defaultRoot?: string }} [options]
 * @returns {string}
 */
export function resolveUiRoot({ env = process.env, defaultRoot } = {}) {
  const override = env?.OPENCLAW_UI_ROOT;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  if (typeof defaultRoot === "string" && defaultRoot.length > 0) {
    return defaultRoot;
  }
  return "/mnt/host-projects/openclaw--openclaw-ui";
}

/**
 * Resolve vitest.mjs by trying candidate locations under UI_ROOT, in order:
 *
 *   1. <UI_ROOT>/node_modules/vitest/vitest.mjs
 *   2. <UI_ROOT>/node_modules.linux-binaries.bak/vitest/vitest.mjs
 *
 * We never fetch or install; if none exist, the caller must fail closed.
 *
 * @param {string} uiRoot
 * @param {{ existsSyncImpl?: (p: string) => boolean }} [options]
 * @returns {string | null}
 */
export function resolveVitestPath(uiRoot, { existsSyncImpl = existsSync } = {}) {
  if (typeof uiRoot !== "string" || uiRoot.length === 0) {
    return null;
  }
  const candidates = [
    path.join(uiRoot, "node_modules", "vitest", "vitest.mjs"),
    path.join(uiRoot, "node_modules.linux-binaries.bak", "vitest", "vitest.mjs"),
  ];
  for (const candidate of candidates) {
    if (existsSyncImpl(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Locate the aggregated Linux-binaries directory used for NODE_PATH prepend.
 * Returns null when the backup is not available; the runner then simply falls
 * back to the caller's env.
 *
 * @param {string} uiRoot
 * @param {{ existsSyncImpl?: (p: string) => boolean }} [options]
 * @returns {string | null}
 */
export function resolveLinuxBinariesNodePath(uiRoot, { existsSyncImpl = existsSync } = {}) {
  if (typeof uiRoot !== "string" || uiRoot.length === 0) {
    return null;
  }
  const aggregate = path.join(uiRoot, "node_modules.linux-binaries.bak", ".pnpm", "node_modules");
  return existsSyncImpl(aggregate) ? aggregate : null;
}

/**
 * Build the env for the subprocess. Prepends the Linux-binaries aggregate to
 * NODE_PATH when it exists. Returns a new object; never mutates the input.
 *
 * @param {{ baseEnv: Record<string, string | undefined>, linuxBinariesNodePath: string | null }} args
 */
export function buildSubprocessEnv({ baseEnv, linuxBinariesNodePath }) {
  const env = { ...baseEnv };
  if (linuxBinariesNodePath) {
    const priorNodePath =
      typeof baseEnv.NODE_PATH === "string" && baseEnv.NODE_PATH.length > 0
        ? baseEnv.NODE_PATH
        : "";
    env.NODE_PATH = priorNodePath
      ? `${linuxBinariesNodePath}${path.delimiter}${priorNodePath}`
      : linuxBinariesNodePath;
  }
  return env;
}

/**
 * Execute the focused UI checkpoint Vitest suite. Fail-closed on:
 *   * missing UI root, missing vitest.mjs → no subprocess is spawned;
 *   * spawn errors, timeouts, non-zero exit;
 *   * skipped/failed tests, or fewer than MIN_FOCUSED_UI_TESTS tests;
 *   * unparseable Vitest summary.
 *
 * The subprocess is always Node executing vitest.mjs directly — never pnpm,
 * corepack, or any wrapper — so no packages can be downloaded at runtime.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   uiRoot?: string,
 *   existsSyncImpl?: (p: string) => boolean,
 *   runFn?: typeof runFocusedVitest,
 *   nodeExecPath?: string,
 *   timeoutMs?: number,
 *   maxBuffer?: number,
 * }} [options]
 */
export async function runFocusedUiSuite(options = {}) {
  const env = options.env ?? process.env;
  const existsSyncImpl = options.existsSyncImpl ?? existsSync;
  const runFn = options.runFn ?? runFocusedVitest;
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? UI_VITEST_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? UI_VITEST_MAX_BUFFER;

  const uiRoot = options.uiRoot ?? resolveUiRoot({ env });
  if (!existsSyncImpl(uiRoot)) {
    return {
      status: "fail",
      evidence: [
        { label: "ui root exists", value: false },
        { label: "vitest resolved", value: false },
      ],
      notes: `UI checkpoint root not accessible; refusing to run.`,
    };
  }

  const vitestPath = resolveVitestPath(uiRoot, { existsSyncImpl });
  if (!vitestPath) {
    return {
      status: "fail",
      evidence: [
        { label: "ui root exists", value: true },
        { label: "vitest resolved", value: false },
      ],
      notes:
        "vitest.mjs not found under UI node_modules or node_modules.linux-binaries.bak — refusing to fall back to pnpm/corepack.",
    };
  }

  const linuxBinariesNodePath = resolveLinuxBinariesNodePath(uiRoot, { existsSyncImpl });
  const subprocessEnv = buildSubprocessEnv({ baseEnv: env, linuxBinariesNodePath });

  const args = [vitestPath, "run", "--root", uiRoot, ...FOCUSED_UI_TEST_FILES];

  const result = await runFn({
    execPath: nodeExecPath,
    args,
    cwd: uiRoot,
    env: subprocessEnv,
    timeoutMs,
    maxBuffer,
  });

  return summarizeVitestResultGeneric(result, {
    expectedFiles: FOCUSED_UI_TEST_FILES.length,
    minTests: MIN_FOCUSED_UI_TESTS,
    suiteLabel: UI_SUITE_LABEL,
  });
}
