// Parent-side helper for the recovery-extensions.disposable-behavior check.
//
// Executes the real deployed session-context-recovery and transcript-archive
// TypeScript entrypoints (under ~/.openclaw/extensions/) in a child Node 24
// subprocess with --experimental-strip-types, rooted at a freshly-created
// temporary HOME. The child process runs the assertions defined in
// `probes/recovery-extensions-probe.mjs` and writes a single JSON payload
// containing assertion booleans, counts, and durations to stdout.
//
// Guarantees:
//   * Never touches production ~/.openclaw, archives, UI transcripts, config,
//     gateway, or any database.
//   * Never spawns a package manager, network client, gateway, or restart.
//   * execFile with an explicit args array; shell: false; bounded timeout,
//     bounded maxBuffer, windowsHide: true.
//   * The disposable HOME is always recursively removed in `finally`,
//     including when the child crashes, times out, or the assertions fail.
//   * Fails closed on: missing extension source, missing probe source, spawn
//     error, timeout, non-zero exit, unparseable JSON, error-shaped payload,
//     any missing assertion key, any assertion still false.
//   * Evidence entries carry only integer counts, booleans, and durations —
//     never transcript contents, production paths, env values, session keys,
//     stderr/stdout text, or raw exceptions.

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOME } from "./env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROBE_PATH = path.join(HERE, "..", "probes", "recovery-extensions-probe.mjs");

export const DEFAULT_SCR_SOURCE_PATH = path.join(
  HOME,
  "extensions",
  "session-context-recovery",
  "index.ts",
);
export const DEFAULT_TA_SOURCE_PATH = path.join(
  HOME,
  "extensions",
  "transcript-archive",
  "index.ts",
);

/** Assertion keys that must be true for session-context-recovery. */
export const REQUIRED_SCR_ASSERTIONS = Object.freeze([
  "hookRegisteredSync",
  "priority10",
  "uiPreferredOverArchive",
  "orderPreserved",
  "malformedIgnored",
  "archiveSentinelAbsent",
  "manyMessagesNoInject",
  "subagentSkipped",
  "runSkipped",
  "missingTranscriptNoInject",
  "archiveFallbackWorks",
  "perMessageBounded",
  "totalBounded",
]);

/** Assertion keys that must be true for transcript-archive. */
export const REQUIRED_TA_ASSERTIONS = Object.freeze([
  "registerSync",
  "hooksInstalled",
  "cliRegistered",
  "serviceRegistered",
  "sparseRoutedToSame",
  "unknownDirNotCreated",
  "traversalContained",
  "hookOrderPreserved",
  "toolResultSplit",
  "toolResultReferenceOnly",
  "snapshotCopied",
  "sourceUnchanged",
]);

export const REQUIRED_TA_HOOK_COUNT = 15;

export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
export const DEFAULT_PROBE_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Execute the probe subprocess directly via execFile. The caller supplies
 * fully-resolved paths and env; this helper never chooses them. The result
 * is a structured object with a fixed shape so callers can classify failures
 * without ever inspecting raw stdout/stderr.
 */
export function runProbeSubprocess({
  nodeExecPath,
  probePath,
  tempHome,
  scrSourcePath,
  taSourcePath,
  timeoutMs,
  maxBuffer,
  baseEnv,
}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(
      nodeExecPath,
      ["--no-warnings", "--experimental-strip-types", probePath],
      {
        cwd: tempHome,
        env: {
          PATH: baseEnv?.PATH ?? "/usr/bin:/bin",
          HOME: tempHome,
          PROBE_SCR_PATH: scrSourcePath,
          PROBE_TA_PATH: taSourcePath,
          NODE_NO_WARNINGS: "1",
        },
        timeout: timeoutMs,
        maxBuffer,
        shell: false,
        windowsHide: true,
      },
      (error, stdout) => {
        const durationMs = Date.now() - started;
        const timedOut =
          (error?.killed === true && error?.signal === "SIGTERM") || error?.code === "ETIMEDOUT";
        let exitCode;
        if (timedOut) {
          exitCode = null;
        } else if (error && typeof error.code === "number") {
          exitCode = error.code;
        } else if (error) {
          exitCode = null;
        } else {
          exitCode = 0;
        }
        const spawnError =
          error && typeof error.code === "string" && error.errno !== undefined
            ? { code: error.code }
            : null;
        resolve({
          exitCode: typeof exitCode === "number" ? exitCode : (child.exitCode ?? null),
          timedOut,
          durationMs,
          stdout: String(stdout ?? ""),
          spawnError,
        });
      },
    );
  });
}

function parseProbeStdout(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Fast path — a clean run with --no-warnings emits exactly one JSON object.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through and try the "last object on stdout" recovery below in
    // case the runtime prefixed the payload with a warning line we could
    // not suppress via NODE_NO_WARNINGS.
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function summarizeAssertions(bag, required) {
  const missing = [];
  const failing = [];
  const assertions = bag && typeof bag === "object" ? (bag.assertions ?? {}) : {};
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(assertions, key)) {
      missing.push(key);
      continue;
    }
    if (assertions[key] !== true) {
      failing.push(key);
    }
  }
  return {
    total: required.length,
    passed: required.length - missing.length - failing.length,
    missing,
    failing,
  };
}

/**
 * Classify the outcome of a completed probe run into a check-result shape.
 * Fail-closed on every non-green branch.
 */
export function summarizeProbeResult(subprocessResult, payload) {
  const evidenceHead = [
    { label: "exit code", value: subprocessResult.exitCode },
    { label: "timed out", value: Boolean(subprocessResult.timedOut) },
    { label: "wall duration ms", value: subprocessResult.durationMs },
  ];

  if (subprocessResult.spawnError) {
    return {
      status: "fail",
      evidence: evidenceHead,
      notes: `probe subprocess failed to spawn: ${subprocessResult.spawnError.code ?? "unknown"}`,
    };
  }
  if (subprocessResult.timedOut) {
    return {
      status: "fail",
      evidence: evidenceHead,
      notes: `probe subprocess timed out after ${subprocessResult.durationMs}ms`,
    };
  }
  if (subprocessResult.exitCode !== 0) {
    return {
      status: "fail",
      evidence: evidenceHead,
      notes: `probe subprocess exit ${subprocessResult.exitCode ?? "null"}`,
    };
  }
  if (!payload) {
    return {
      status: "fail",
      evidence: evidenceHead,
      notes: "probe subprocess exit 0 but stdout payload was not parseable JSON",
    };
  }
  if (typeof payload.error === "string") {
    return {
      status: "fail",
      evidence: evidenceHead,
      notes: `probe reported error code: ${payload.error}`,
    };
  }
  if (payload.ok !== true) {
    return {
      status: "fail",
      evidence: evidenceHead,
      notes: "probe payload missing ok=true sentinel",
    };
  }

  const scrSummary = summarizeAssertions(payload.sessionContextRecovery, REQUIRED_SCR_ASSERTIONS);
  const taSummary = summarizeAssertions(payload.transcriptArchive, REQUIRED_TA_ASSERTIONS);
  const taHooksRegistered =
    typeof payload.transcriptArchive?.counts?.hooksRegistered === "number"
      ? payload.transcriptArchive.counts.hooksRegistered
      : -1;
  const taHooksInstalledCount = taHooksRegistered >= REQUIRED_TA_HOOK_COUNT;

  const evidence = [
    ...evidenceHead,
    { label: "probe total ms", value: payload.totalMs ?? null },
    {
      label: "session-context-recovery duration ms",
      value: payload.sessionContextRecovery?.durationMs ?? null,
    },
    {
      label: "session-context-recovery assertions",
      value: `${scrSummary.passed}/${scrSummary.total} passed`,
    },
    {
      label: "transcript-archive duration ms",
      value: payload.transcriptArchive?.durationMs ?? null,
    },
    {
      label: "transcript-archive assertions",
      value: `${taSummary.passed}/${taSummary.total} passed`,
    },
    { label: "transcript-archive hooks registered", value: taHooksRegistered },
    { label: "transcript-archive required hook count", value: REQUIRED_TA_HOOK_COUNT },
  ];

  const complaints = [];
  if (scrSummary.missing.length > 0) {
    complaints.push(`scr missing assertions: ${scrSummary.missing.join(",")}`);
  }
  if (scrSummary.failing.length > 0) {
    complaints.push(`scr failing assertions: ${scrSummary.failing.join(",")}`);
  }
  if (taSummary.missing.length > 0) {
    complaints.push(`ta missing assertions: ${taSummary.missing.join(",")}`);
  }
  if (taSummary.failing.length > 0) {
    complaints.push(`ta failing assertions: ${taSummary.failing.join(",")}`);
  }
  if (!taHooksInstalledCount) {
    complaints.push(
      `ta hooksRegistered=${taHooksRegistered} below required ${REQUIRED_TA_HOOK_COUNT}`,
    );
  }

  if (complaints.length > 0) {
    return {
      status: "fail",
      evidence,
      notes: complaints.join("; "),
    };
  }
  return {
    status: "pass",
    evidence,
    notes: `Proves deployed extension behavior on disposable fixtures, not real compaction/runtime-flip continuity. All ${scrSummary.total} session-context-recovery and ${taSummary.total} transcript-archive assertions passed; ${taHooksRegistered} lifecycle/message/tool/compaction hooks installed on the disposable API.`,
  };
}

/**
 * Run the full disposable-behavior probe end-to-end. Fail-closed on missing
 * probe source, missing extension sources, spawn error, timeout, unparseable
 * JSON, or any assertion failure. Always cleans up the disposable HOME.
 */
export async function runRecoveryExtensionsProbe(options = {}) {
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const probePath = options.probePath ?? DEFAULT_PROBE_PATH;
  const scrSourcePath = options.scrSourcePath ?? DEFAULT_SCR_SOURCE_PATH;
  const taSourcePath = options.taSourcePath ?? DEFAULT_TA_SOURCE_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_PROBE_MAX_BUFFER;
  const existsSyncImpl = options.existsSyncImpl ?? existsSync;
  const runFn = options.runFn ?? runProbeSubprocess;
  const mkdtempImpl = options.mkdtempImpl ?? mkdtempSync;
  const rmImpl = options.rmImpl ?? rmSync;
  const baseEnv = options.env ?? process.env;

  const preflightEvidence = [
    { label: "probe source exists", value: existsSyncImpl(probePath) },
    { label: "session-context-recovery source exists", value: existsSyncImpl(scrSourcePath) },
    { label: "transcript-archive source exists", value: existsSyncImpl(taSourcePath) },
  ];

  if (!existsSyncImpl(probePath)) {
    return {
      status: "fail",
      evidence: preflightEvidence,
      notes: "probe source missing under scripts/upgrade-contracts/probes",
    };
  }
  if (!existsSyncImpl(scrSourcePath) || !existsSyncImpl(taSourcePath)) {
    return {
      status: "fail",
      evidence: preflightEvidence,
      notes: "one or both deployed recovery extension sources are missing",
    };
  }

  const tempRoot = options.tempHome ?? mkdtempImpl(path.join(os.tmpdir(), "openclaw-recovery-"));
  let outcome;
  let cleanupSucceeded = false;
  try {
    try {
      const subprocessResult = await runFn({
        nodeExecPath,
        probePath,
        tempHome: tempRoot,
        scrSourcePath,
        taSourcePath,
        timeoutMs,
        maxBuffer,
        baseEnv,
      });
      const payload = parseProbeStdout(subprocessResult.stdout);
      outcome = summarizeProbeResult(subprocessResult, payload);
    } catch {
      outcome = {
        status: "fail",
        evidence: [],
        notes: "probe subprocess threw before returning a structured result",
      };
    }
  } finally {
    try {
      rmImpl(tempRoot, { recursive: true, force: true });
      cleanupSucceeded = true;
    } catch {
      cleanupSucceeded = false;
    }
  }

  const evidence = [
    ...(Array.isArray(outcome?.evidence) ? outcome.evidence : []),
    { label: "disposable cleanup succeeded", value: cleanupSucceeded },
  ];
  if (!cleanupSucceeded) {
    return {
      status: "fail",
      evidence,
      notes: `${outcome?.notes ?? "probe outcome unavailable"}; disposable fixture cleanup failed`,
    };
  }
  return { ...outcome, evidence };
}
