// Child-side probe for the recovery-extensions.disposable-behavior contract.
//
// This file runs in a fresh Node 24 subprocess with --experimental-strip-types
// so it can `await import()` the deployed session-context-recovery and
// transcript-archive extensions as .ts files without needing a transpile
// step. The parent harness supplies:
//
//   HOME               — freshly-created disposable directory (becomes
//                        os.homedir() inside the extensions)
//   PROBE_SCR_PATH     — absolute path to session-context-recovery/index.ts
//   PROBE_TA_PATH      — absolute path to transcript-archive/index.ts
//
// The probe exercises the two deployed extension files against disposable
// fixtures rooted at HOME. It NEVER touches production ~/.openclaw,
// archives, UI transcripts, config, gateway, databases, network, or any
// package installer. It writes exactly one JSON payload to stdout with
// assertion booleans/counts/durations only — never transcript contents,
// production paths, env values, session keys, stderr, or raw exceptions.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_TA_HOOK_NAMES = Object.freeze([
  "gateway_start",
  "session_start",
  "session_end",
  "message_received",
  "message_sent",
  "before_prompt_build",
  "llm_input",
  "llm_output",
  "agent_end",
  "before_tool_call",
  "after_tool_call",
  "tool_result_persist",
  "before_compaction",
  "after_compaction",
  "before_reset",
]);

const SNAPSHOT_POLL_DEADLINE_MS = 3_000;
const SNAPSHOT_POLL_INTERVAL_MS = 25;

function tryBool(fn) {
  try {
    return Boolean(fn());
  } catch {
    return false;
  }
}

async function tryBoolAsync(fn) {
  try {
    return Boolean(await fn());
  } catch {
    return false;
  }
}

function safeRmSync(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
}

function makeScrApi(captured, pluginConfig = {}) {
  return {
    id: "session-context-recovery",
    name: "Session Context Recovery",
    config: {},
    pluginConfig,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    on(name, handler, opts) {
      captured.hooks.push({ name, handler, opts });
    },
    resolvePath: (p) => p,
  };
}

function makeTaApi(captured, pluginConfig) {
  return {
    id: "transcript-archive",
    name: "Transcript Archive",
    config: {},
    pluginConfig,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    on(name, handler, opts) {
      captured.hooks.push({ name, handler, opts });
    },
    registerCli(registrar, opts) {
      captured.cli.push({ registrar, opts });
    },
    registerService(service) {
      captured.services.push(service);
    },
    resolvePath: (p) => p,
  };
}

function findHook(captured, name) {
  return captured.hooks.find((h) => h.name === name) ?? null;
}

async function pollForFile(dir, prefix, deadlineMs) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix));
        if (files.length > 0) {
          return files[0];
        }
      }
    } catch {
      // Ignore transient read errors and retry.
    }
    await new Promise((r) => setTimeout(r, SNAPSHOT_POLL_INTERVAL_MS));
  }
  return null;
}

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

async function runSessionContextRecoveryProbe(scrRegister, { home }) {
  const startedAt = Date.now();
  const uiDir = path.join(home, ".openclaw", "workspace", "ui-transcripts");
  const archiveDir = path.join(home, ".openclaw", "workspace", "archives");
  fs.mkdirSync(uiDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const captured = { hooks: [] };
  const api = makeScrApi(captured);

  // Registration must complete synchronously and never return a Promise.
  let registerReturn;
  const registerErrored = !tryBool(() => {
    registerReturn = scrRegister(api);
    return true;
  });
  const hook = findHook(captured, "before_prompt_build");
  const hookRegisteredSync =
    !registerErrored && hook !== null && registerReturn?.then === undefined;
  const priority10 = !!hook && hook.opts?.priority === 10;
  const handler = hook?.handler ?? (() => ({}));

  // Scenario A: UI transcript preferred over archive; role order preserved;
  //             malformed lines ignored; archive sentinel absent.
  const shortA = "scenario-a-fixture";
  const fullA = `agent:testagent:${shortA}`;
  const uiPathA = path.join(uiDir, `${shortA}.jsonl`);
  const archiveDirA = path.join(archiveDir, fullA);
  fs.mkdirSync(archiveDirA, { recursive: true });
  const uiLines = [
    JSON.stringify({ role: "user", content: "UIA_USER_FIRST", timestamp: 1 }),
    JSON.stringify({ role: "assistant", content: "UIA_ASSISTANT_MID", timestamp: 2 }),
    "this-line-is-not-json <<<",
    JSON.stringify({ role: "user", content: "UIA_USER_LAST", timestamp: 3 }),
  ];
  fs.writeFileSync(uiPathA, uiLines.join("\n") + "\n", "utf8");
  fs.writeFileSync(
    path.join(archiveDirA, "transcript.jsonl"),
    JSON.stringify({
      hook: "before_prompt_build",
      data: { prompt: "ARCHIVE_ONLY_SENTINEL_A" },
      ts: "2024-01-01T00:00:00.000Z",
    }) + "\n",
    "utf8",
  );
  let resultA = {};
  const invokedA = tryBool(() => {
    resultA = handler({ prompt: "", messages: [{}] }, { agentId: "testagent", sessionKey: shortA });
    return true;
  });
  const prependA = typeof resultA?.prependContext === "string" ? resultA.prependContext : "";
  const idxUserFirst = prependA.indexOf("UIA_USER_FIRST");
  const idxAssistantMid = prependA.indexOf("UIA_ASSISTANT_MID");
  const idxUserLast = prependA.indexOf("UIA_USER_LAST");
  const uiPreferredOverArchive =
    invokedA && prependA.length > 0 && idxUserFirst >= 0 && idxAssistantMid >= 0;
  const orderPreserved =
    idxUserFirst >= 0 && idxAssistantMid > idxUserFirst && idxUserLast > idxAssistantMid;
  const malformedIgnored = invokedA && !prependA.includes("this-line-is-not-json");
  const archiveSentinelAbsent = invokedA && !prependA.includes("ARCHIVE_ONLY_SENTINEL_A");

  // Scenario B: >2 current messages → no prependContext.
  let resultB = {};
  const invokedB = tryBool(() => {
    resultB = handler(
      { prompt: "", messages: [{}, {}, {}] },
      { agentId: "testagent", sessionKey: shortA },
    );
    return true;
  });
  const manyMessagesNoInject =
    invokedB && (resultB == null || resultB.prependContext === undefined);

  // Scenario C: subagent/run session keys skipped. Matching transcript files
  // are deliberately present, so these assertions cannot pass merely because
  // lookup found no fixture; removing either skip guard would inject content.
  const subSessionKey = "agent:testagent:sub:scenario-c-sub";
  const runSessionKey = "agent:testagent:run:scenario-c-run";
  fs.writeFileSync(
    path.join(uiDir, "sub:scenario-c-sub.jsonl"),
    JSON.stringify({ role: "user", content: "SUBAGENT_MUST_NOT_INJECT" }) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(uiDir, "run:scenario-c-run.jsonl"),
    JSON.stringify({ role: "user", content: "RUN_MUST_NOT_INJECT" }) + "\n",
    "utf8",
  );
  let resultSub = {};
  let resultRun = {};
  const invokedSub = tryBool(() => {
    resultSub = handler(
      { prompt: "", messages: [{}] },
      { agentId: "testagent", sessionKey: subSessionKey },
    );
    return true;
  });
  const invokedRun = tryBool(() => {
    resultRun = handler(
      { prompt: "", messages: [{}] },
      { agentId: "testagent", sessionKey: runSessionKey },
    );
    return true;
  });
  const subagentSkipped = invokedSub && resultSub?.prependContext === undefined;
  const runSkipped = invokedRun && resultRun?.prependContext === undefined;

  // Scenario D: missing transcript → no prependContext.
  let resultD = {};
  const invokedD = tryBool(() => {
    resultD = handler(
      { prompt: "", messages: [{}] },
      { agentId: "testagent", sessionKey: "scenario-d-missing-nonce" },
    );
    return true;
  });
  const missingTranscriptNoInject = invokedD && resultD?.prependContext === undefined;

  // Scenario E: archive fallback (no UI transcript file, archive present).
  const shortE = "scenario-e-fixture";
  const fullE = `agent:testagent:${shortE}`;
  const archiveDirE = path.join(archiveDir, fullE);
  fs.mkdirSync(archiveDirE, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDirE, "transcript.jsonl"),
    JSON.stringify({
      hook: "before_prompt_build",
      data: { prompt: "ARCHIVE_FALLBACK_TEXT_E" },
      ts: "2024-01-01T00:00:00.000Z",
    }) + "\n",
    "utf8",
  );
  let resultE = {};
  const invokedE = tryBool(() => {
    resultE = handler({ prompt: "", messages: [{}] }, { agentId: "testagent", sessionKey: shortE });
    return true;
  });
  const archiveFallbackWorks =
    invokedE &&
    typeof resultE?.prependContext === "string" &&
    resultE.prependContext.includes("ARCHIVE_FALLBACK_TEXT_E");

  // Scenario F: per-message and total recovery bounds enforced.
  const shortF = "scenario-f-bounds";
  const uiPathF = path.join(uiDir, `${shortF}.jsonl`);
  const bigMsgChars = 3000;
  const bigMsgs = [];
  for (let i = 0; i < 25; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    bigMsgs.push(
      JSON.stringify({ role, content: "F".repeat(bigMsgChars) + `-${i}`, timestamp: i + 1 }),
    );
  }
  fs.writeFileSync(uiPathF, bigMsgs.join("\n") + "\n", "utf8");
  let resultF = {};
  const invokedF = tryBool(() => {
    resultF = handler({ prompt: "", messages: [{}] }, { agentId: "testagent", sessionKey: shortF });
    return true;
  });
  const prependF = typeof resultF?.prependContext === "string" ? resultF.prependContext : "";
  // The recovered block is capped at MAX_CONTEXT_CHARS = 40000; the wrapper
  // preamble/postamble adds a small fixed overhead. Allow a generous but
  // finite headroom so a regression that removes the cap fails closed.
  const totalBounded = invokedF && prependF.length > 0 && prependF.length <= 41_000;
  // Per-message truncation at MAX_MESSAGE_CHARS = 2000 appends the literal
  // "..." after the truncated slice. If bounds were removed, the messages
  // would not be truncated (bigMsgChars is 3000).
  const perMessageBounded = invokedF && prependF.includes("...");

  return {
    durationMs: Date.now() - startedAt,
    assertions: {
      hookRegisteredSync,
      priority10,
      uiPreferredOverArchive,
      orderPreserved,
      malformedIgnored,
      archiveSentinelAbsent,
      manyMessagesNoInject,
      subagentSkipped,
      runSkipped,
      missingTranscriptNoInject,
      archiveFallbackWorks,
      perMessageBounded,
      totalBounded,
    },
    counts: {
      hooksRegistered: captured.hooks.length,
      prependLengthScenarioA: prependA.length,
      prependLengthScenarioF: prependF.length,
    },
  };
}

async function runTranscriptArchiveProbe(taPlugin, { home }) {
  const startedAt = Date.now();
  const archiveDir = path.join(home, ".openclaw", "workspace", "archives");
  fs.mkdirSync(archiveDir, { recursive: true });

  const captured = { hooks: [], cli: [], services: [] };
  const pluginConfig = {
    archiveDir,
    snapshotOnCompaction: true,
    snapshotOnReset: true,
    captureToolResults: true,
    captureLlmTraffic: true,
    toolResultSplitThreshold: 10,
  };
  const api = makeTaApi(captured, pluginConfig);

  let registerReturn;
  const registerErrored = !tryBool(() => {
    registerReturn = taPlugin.register(api);
    return true;
  });
  const registerSync = !registerErrored && registerReturn?.then === undefined;

  const installedNames = new Set(captured.hooks.map((h) => h.name));
  const hooksInstalled = REQUIRED_TA_HOOK_NAMES.every((n) => installedNames.has(n));
  const cliRegistered = captured.cli.length > 0;
  const serviceRegistered = captured.services.some((s) => s?.id === "transcript-archive");

  // Scenario 1: session_start then sparse-context message_received route to
  // the same sanitized in-root archive directory via the session tracker.
  const s1Key = "sparse-session-key-1";
  const s1AgentId = "sparse-agent-1";
  const startHook = findHook(captured, "session_start");
  const msgHook = findHook(captured, "message_received");
  const s1Ok = tryBool(() => {
    startHook.handler(
      { model: "unused" },
      { sessionKey: s1Key, agentId: s1AgentId, sessionId: "sess-1" },
    );
    msgHook.handler(
      { text: "hello" },
      { agentId: s1AgentId, sessionId: "sess-1" }, // NO sessionKey — sparse
    );
    return true;
  });
  const s1Dir = path.join(archiveDir, s1Key);
  const s1File = path.join(s1Dir, "transcript.jsonl");
  const unknownDir = path.join(archiveDir, "_unknown");
  let sparseRoutedToSame = false;
  let unknownDirNotCreated = false;
  if (s1Ok) {
    unknownDirNotCreated = !fs.existsSync(unknownDir);
    try {
      const entries = readJsonl(s1File);
      sparseRoutedToSame =
        entries.length === 2 &&
        entries[0].hook === "session_start" &&
        entries[1].hook === "message_received";
    } catch {
      sparseRoutedToSame = false;
    }
  }

  // Scenario 2: deliberately traversal-shaped session key cannot escape
  // archiveDir. Uses forward-slashes so sanitizeKey replaces them; asserts
  // that no artifact appears above archiveDir.
  const traversalKey = "../../etc/pwn-outside-XYZ-nonce";
  const sanitizedTraversalKey = ".._.._etc_pwn-outside-XYZ-nonce";
  const traversalDir = path.join(archiveDir, sanitizedTraversalKey);
  const traversalCanaryOutside = path.join(archiveDir, "..", "etc", "pwn-outside-XYZ-nonce");
  const traversalCanaryHome = path.join(home, "etc", "pwn-outside-XYZ-nonce");
  const t2Ok = tryBool(() => {
    startHook.handler(
      {},
      { sessionKey: traversalKey, agentId: "traversal-agent", sessionId: "trav" },
    );
    return true;
  });
  let traversalContained = false;
  if (t2Ok) {
    const archiveRoot = `${path.resolve(archiveDir)}${path.sep}`;
    const resolvedTraversalDir = path.resolve(traversalDir);
    const outsideExists =
      fs.existsSync(traversalCanaryOutside) || fs.existsSync(traversalCanaryHome);
    traversalContained =
      resolvedTraversalDir.startsWith(archiveRoot) &&
      fs.existsSync(path.join(resolvedTraversalDir, "transcript.jsonl")) &&
      !outsideExists;
  }

  // Scenario 3: hook order preserved in the transcript JSONL.
  const s3Key = "order-session-key-3";
  const s3AgentId = "order-agent-3";
  const bpb = findHook(captured, "before_prompt_build");
  const endHook = findHook(captured, "session_end");
  const s3Ok = tryBool(() => {
    startHook.handler({}, { sessionKey: s3Key, agentId: s3AgentId, sessionId: "sess-3" });
    bpb.handler({ prompt: "prompt-3", messages: [] }, { sessionKey: s3Key, agentId: s3AgentId });
    msgHook.handler({ text: "msg-3" }, { sessionKey: s3Key, agentId: s3AgentId });
    endHook.handler({}, { sessionKey: s3Key, agentId: s3AgentId });
    return true;
  });
  let hookOrderPreserved = false;
  if (s3Ok) {
    try {
      const entries = readJsonl(path.join(archiveDir, s3Key, "transcript.jsonl"));
      const seq = entries.map((e) => e.hook);
      hookOrderPreserved =
        seq.length === 4 &&
        seq[0] === "session_start" &&
        seq[1] === "before_prompt_build" &&
        seq[2] === "message_received" &&
        seq[3] === "session_end";
    } catch {
      hookOrderPreserved = false;
    }
  }

  // Scenario 4: with toolResultSplitThreshold=10, a large tool result is
  // split to a file under the same in-root session directory and the
  // transcript entry records only reference metadata (no raw result).
  const s4Key = "split-session-key-4";
  const s4AgentId = "split-agent-4";
  const afterTool = findHook(captured, "after_tool_call");
  const largeMarker = "LARGE_TOOL_RESULT_MARKER_XYZ";
  const largeResult = { data: largeMarker.repeat(50) };
  const s4Ok = tryBool(() => {
    startHook.handler({}, { sessionKey: s4Key, agentId: s4AgentId, sessionId: "sess-4" });
    afterTool.handler(
      {
        toolName: "test-tool",
        params: {},
        result: largeResult,
        durationMs: 5,
        error: null,
      },
      { sessionKey: s4Key, agentId: s4AgentId },
    );
    return true;
  });
  let toolResultSplit = false;
  let toolResultReferenceOnly = false;
  if (s4Ok) {
    const toolResultsDir = path.join(archiveDir, s4Key, "tool-results");
    try {
      const entries = readJsonl(path.join(archiveDir, s4Key, "transcript.jsonl"));
      const afterEntry = entries.toReversed().find((e) => e.hook === "after_tool_call");
      const rawEntryText = JSON.stringify(afterEntry ?? {});
      const resultFile = afterEntry?.data?.resultFile;
      const toolResultsRoot = `${path.resolve(toolResultsDir)}${path.sep}`;
      const resolvedResultFile = typeof resultFile === "string" ? path.resolve(resultFile) : "";
      const referencedFileContained =
        resolvedResultFile.startsWith(toolResultsRoot) && fs.existsSync(resolvedResultFile);
      const referencedFileHasResult =
        referencedFileContained &&
        fs.readFileSync(resolvedResultFile, "utf8").includes(largeMarker);
      toolResultSplit = referencedFileContained && referencedFileHasResult;
      toolResultReferenceOnly =
        !!afterEntry &&
        typeof afterEntry.data?.resultSize === "number" &&
        afterEntry.data.resultSize > pluginConfig.toolResultSplitThreshold &&
        !rawEntryText.includes(largeMarker);
    } catch {
      toolResultSplit = false;
      toolResultReferenceOnly = false;
    }
  }

  // Scenario 5: before_compaction snapshot copy completes inside the
  // disposable session archive and the source fixture is unchanged.
  const s5Key = "snapshot-session-key-5";
  const s5AgentId = "snapshot-agent-5";
  const s5SourcePath = path.join(home, "compaction-source.jsonl");
  const s5SourceContent = "SNAPSHOT_SOURCE_CONTENT_XYZ\n";
  fs.writeFileSync(s5SourcePath, s5SourceContent, "utf8");
  const beforeCompaction = findHook(captured, "before_compaction");
  const s5Ok = tryBool(() => {
    startHook.handler({}, { sessionKey: s5Key, agentId: s5AgentId, sessionId: "sess-5" });
    beforeCompaction.handler(
      {
        messageCount: 5,
        compactingCount: 3,
        tokenCount: 100,
        sessionFile: s5SourcePath,
      },
      { sessionKey: s5Key, agentId: s5AgentId },
    );
    return true;
  });
  let snapshotCopied = false;
  let sourceUnchanged = false;
  if (s5Ok) {
    const s5Dir = path.join(archiveDir, s5Key);
    const snapshotName = await pollForFile(
      s5Dir,
      "snapshot-pre-compaction-",
      SNAPSHOT_POLL_DEADLINE_MS,
    );
    if (snapshotName) {
      try {
        const snapContent = fs.readFileSync(path.join(s5Dir, snapshotName), "utf8");
        snapshotCopied = snapContent === s5SourceContent;
      } catch {
        snapshotCopied = false;
      }
    }
    try {
      const sourceStill = fs.readFileSync(s5SourcePath, "utf8");
      sourceUnchanged = sourceStill === s5SourceContent;
    } catch {
      sourceUnchanged = false;
    }
    safeRmSync(s5SourcePath);
  }

  return {
    durationMs: Date.now() - startedAt,
    assertions: {
      registerSync,
      hooksInstalled,
      cliRegistered,
      serviceRegistered,
      sparseRoutedToSame,
      unknownDirNotCreated,
      traversalContained,
      hookOrderPreserved,
      toolResultSplit,
      toolResultReferenceOnly,
      snapshotCopied,
      sourceUnchanged,
    },
    counts: {
      hooksRegistered: captured.hooks.length,
      requiredHookNames: REQUIRED_TA_HOOK_NAMES.length,
      cliRegistrations: captured.cli.length,
      servicesRegistered: captured.services.length,
    },
  };
}

async function main() {
  const home = process.env.HOME;
  const scrPath = process.env.PROBE_SCR_PATH;
  const taPath = process.env.PROBE_TA_PATH;

  if (typeof home !== "string" || home.length === 0) {
    process.stdout.write(JSON.stringify({ error: "missing-home" }));
    process.exit(1);
  }
  if (typeof scrPath !== "string" || !fs.existsSync(scrPath)) {
    process.stdout.write(JSON.stringify({ error: "missing-scr-source" }));
    process.exit(1);
  }
  if (typeof taPath !== "string" || !fs.existsSync(taPath)) {
    process.stdout.write(JSON.stringify({ error: "missing-ta-source" }));
    process.exit(1);
  }
  // Confirm HOME actually resolves to the disposable temp dir the parent set.
  if (os.homedir() !== home) {
    process.stdout.write(JSON.stringify({ error: "home-not-disposable" }));
    process.exit(1);
  }

  let scrMod;
  let taMod;
  try {
    scrMod = await import(pathToFileURL(scrPath).href);
  } catch {
    process.stdout.write(JSON.stringify({ error: "import-failed-scr" }));
    process.exit(1);
  }
  try {
    taMod = await import(pathToFileURL(taPath).href);
  } catch {
    process.stdout.write(JSON.stringify({ error: "import-failed-ta" }));
    process.exit(1);
  }

  const scrRegister = scrMod?.default;
  const taPlugin = taMod?.default;
  if (typeof scrRegister !== "function") {
    process.stdout.write(JSON.stringify({ error: "scr-default-not-function" }));
    process.exit(1);
  }
  if (!taPlugin || typeof taPlugin.register !== "function") {
    process.stdout.write(JSON.stringify({ error: "ta-plugin-shape-invalid" }));
    process.exit(1);
  }

  const started = Date.now();
  const sessionContextRecovery = (await tryBoolAsync(async () => true))
    ? await runSessionContextRecoveryProbe(scrRegister, { home })
    : { durationMs: 0, assertions: {}, counts: {} };
  const transcriptArchive = await runTranscriptArchiveProbe(taPlugin, { home });
  const totalMs = Date.now() - started;

  process.stdout.write(
    JSON.stringify({
      ok: true,
      totalMs,
      sessionContextRecovery,
      transcriptArchive,
    }),
  );
}

main().catch(() => {
  try {
    process.stdout.write(JSON.stringify({ error: "probe-crash" }));
  } catch {
    // If stdout is broken we cannot signal further; the parent's exit-code
    // check will still fail closed.
  }
  process.exit(1);
});
