// ACP checks. Source presence goes as kind=inventory; runtime behavior ships
// as kind=behavior manual contracts. Every automated check that just proves a
// file exists is labeled inventory so it cannot masquerade as behavior.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { HOME, REPO_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

// -- Inventory: preset catalog + required symbols -------------------------

defineCheck({
  id: "acp.preset-catalog-inventory",
  name: "ACP preset catalog module exists and declares supported routing symbols",
  groups: ["acp"],
  matrixIds: ["UM-02"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(REPO_ROOT, "src", "acp", "presets.ts");
    if (!existsSync(p)) {
      return { status: "fail", notes: `src/acp/presets.ts missing at ${p}` };
    }
    const src = await fs.readFile(p, "utf8");
    const evidence = [
      { label: "path", value: p },
      { label: "declares AcpModelPreset", value: /interface\s+AcpModelPreset\b/.test(src) },
      {
        label: "exports ACP_MODEL_PRESETS",
        value: /export\s+const\s+ACP_MODEL_PRESETS\b/.test(src),
      },
      { label: "declares acpxModel routing", value: /acpxModel\s*\??:/.test(src) },
      { label: "contains supported Opus 4.6 preset", value: /claude-opus-4-6\b/.test(src) },
      { label: "does NOT contain invalid claude-opus-5-0", value: !/claude-opus-5-0\b/.test(src) },
    ];
    const failed = evidence.filter((e) => e.value === false);
    if (failed.length > 0) {
      return {
        status: "fail",
        evidence,
        notes: `Required symbol/entry missing: ${failed.map((e) => e.label).join("; ")}`,
      };
    }
    return {
      status: "pass",
      evidence,
      notes:
        "Direct Opus 4.8/5 selectors come from the gateway model catalog. This ACP inventory intentionally does not require unverified Claude Code ACP presets.",
    };
  },
});

// -- Inventory: context preamble -----------------------------------------

defineCheck({
  id: "acp.context-preamble-inventory",
  name: "ACP context preamble file exists at ~/.openclaw/acp-context-preamble.md",
  groups: ["acp"],
  matrixIds: ["RT-08"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(HOME, "acp-context-preamble.md");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    const stat = await fs.stat(p);
    if (stat.size === 0) {
      return { status: "fail", notes: `Preamble file empty: ${p}` };
    }
    return {
      status: "pass",
      evidence: [
        { label: "path", value: p },
        { label: "sizeBytes", value: stat.size },
      ],
    };
  },
});

// -- Manual: HTTP upload accepts preset -----------------------------------

defineCheck({
  id: "acp.preset-http-upload-manual",
  name: "HTTP upload accepts ACP preset models",
  groups: ["acp", "attachments"],
  matrixIds: ["UM-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Live gateway session and a small HTTP file-upload attachment prepared for staging.",
      "A valid ACP preset id from the current preset catalog.",
    ],
    steps: [
      "Upload a small text file with the preset model id set via HTTP.",
      "Confirm the gateway accepts the upload and echoes the resolved model.",
    ],
    expected:
      "The upload completes and the resolved model equals the preset's underlying model id.",
    evidence: ["Full HTTP response body and gateway log excerpt showing normalization."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one uploaded text file in staging workspace"],
      cleanupRollback: ["delete uploaded file after verification"],
      evidenceCapture: ["response body", "gateway log excerpt"],
    },
  },
});

// -- Manual: runtime flip -------------------------------------------------

defineCheck({
  id: "acp.runtime-flip-manual",
  name: "ACP runtime flip preserves context, session log, and subagent identity",
  groups: ["acp"],
  matrixIds: ["UM-03"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A live staging session with both ACP and embedded runtimes available.",
      "A canary subagent identity established before the flip.",
    ],
    steps: [
      "Send a turn on ACP; record the NDJSON session log line.",
      "Flip to embedded; send a follow-up turn.",
      "Flip back to ACP; ask the agent to recall the canary subagent identity.",
    ],
    expected:
      "No duplicated messages; session log records each transition; subagent identity survives both flips.",
    evidence: ["Session log NDJSON excerpt; chat transcript excerpts around both flips."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["session log lines and canary subagent identity"],
      cleanupRollback: ["retire canary subagent identity after test"],
      evidenceCapture: ["NDJSON excerpt", "transcript excerpts"],
    },
  },
});

// -- Manual: NDJSON sidecar ---------------------------------------------

defineCheck({
  id: "acp.sidecar-manual",
  name: "ACP NDJSON sidecar persists per-turn metadata",
  groups: ["acp"],
  matrixIds: ["UM-04b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A live ACP session and access to ~/.openclaw/agents/<agent>/sessions/<session>.jsonl.",
    ],
    steps: [
      "Send a turn.",
      "Inspect the NDJSON sidecar for the turn.",
      "Verify runtime, model, and thinking effort metadata is present.",
    ],
    expected:
      "The sidecar has one JSON line per turn with runtime, model, and effort fields populated.",
    evidence: ["The exact JSONL lines for the turn."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one JSONL line in staging session log"],
      cleanupRollback: ["staging-only; no rollback of session log lines needed"],
      evidenceCapture: ["JSONL lines"],
    },
  },
});

// -- Manual: plugin-sdk collision ---------------------------------------

defineCheck({
  id: "acp.plugin-sdk-collision-manual",
  name: "ACP plugin-sdk exports do not collide with core internals",
  groups: ["acp"],
  matrixIds: ["UM-04c"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Ability to load the plugin-sdk barrel and diff exports against src/acp core internals.",
    ],
    steps: [
      "Compare exported names from openclaw/plugin-sdk/acp with src/acp internals.",
      "Verify no third-party plugin can import a core internal through the sdk barrel by name.",
    ],
    expected:
      "The public surface is a narrow, documented subset. No internal-only symbol is re-exported.",
    evidence: [
      "Diff of the SDK barrel exports vs the core internals; test import from a third-party stub.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["observational only"],
      evidenceCapture: ["diff output"],
    },
  },
});

// -- Manual: dispatch pipeline ------------------------------------------

defineCheck({
  id: "acp.dispatch-pipeline-manual",
  name: "ACP dispatch pipeline delivers events without duplication",
  groups: ["acp"],
  matrixIds: ["UM-05a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A live ACP session and the UI streaming view."],
    steps: [
      "Trigger a turn with tool events.",
      "Compare gateway-emitted events with UI-rendered events.",
      "Trigger post-compaction context injection; verify projection order.",
    ],
    expected:
      "1:1 mapping between gateway events and UI events; post-compaction ordering preserved.",
    evidence: ["Event log capture from both sides."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one staging turn with tool events"],
      cleanupRollback: ["staging-only; retain events for evidence"],
      evidenceCapture: ["event captures"],
    },
  },
});

// -- Manual: lifecycle channel delivery ---------------------------------

defineCheck({
  id: "acp.lifecycle-channel-manual",
  name: "ACP lifecycle commands terminate cleanly across every configured messaging channel",
  groups: ["acp"],
  matrixIds: ["UM-05c"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "For each configured channel (webchat, Slack, Telegram, Discord, Signal, iMessage, WhatsApp web, Matrix, Zalo, Voice Call as applicable), a staging session or dry-run harness.",
    ],
    steps: [
      "Issue an ACP lifecycle command (start/stop/reset).",
      "Verify each configured channel reflects the terminal state.",
    ],
    expected: "Every channel reaches the terminal state consistently; no lingering runs.",
    evidence: ["Per-channel state snapshots after the command."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: false,
      changesAuth: false,
      downloadsExternal: false,
      writesWorkspaceFiles: false,
      externalMessaging: false,
      expectedMutations: ["lifecycle state changes"],
      cleanupRollback: ["staging-only; restart is not permitted by this harness"],
      evidenceCapture: ["state snapshots"],
    },
  },
});

// -- Manual: PTY / permission -------------------------------------------

defineCheck({
  id: "acp.pty-permission-manual",
  name: "ACPX PTY spawn and permission policy behave as documented",
  groups: ["acp"],
  matrixIds: ["UM-10a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A live ACPX session where permission prompts are enabled."],
    steps: [
      "Trigger a tool that requires approval.",
      "Approve it; verify the tool runs.",
      "Trigger a tool that requires approval; deny it; verify it does not run.",
    ],
    expected: "Approval gates operate as expected; PTY spawn does not leak to a shared TTY.",
    evidence: ["Screenshots of the approval prompt and the deny path."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: ["one tool invocation on approve; nothing on deny"],
      cleanupRollback: ["staging-only; roll back any tool side-effect"],
      evidenceCapture: ["screenshots"],
    },
  },
});

// -- Manual: prompt-tempfile & noninteractive ---------------------------

defineCheck({
  id: "acp.prompt-tempfile-manual",
  name: "ACPX prompt-tempfile transport cleans up and honors noninteractive policy",
  groups: ["acp"],
  matrixIds: ["UM-10b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A staging ACPX session with a large prompt that triggers the tempfile path."],
    steps: [
      "Send a large prompt; observe tempfile creation and cleanup after the turn.",
      "Verify path safety (no traversal, no shared tmp).",
      "Repeat in noninteractive mode; confirm noninteractive-policy behavior.",
    ],
    expected:
      "Tempfile is created in an isolated path, cleaned up post-turn, and noninteractive policy is honored.",
    evidence: ["Tempfile path listing before/after; noninteractive session output."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one tempfile created and deleted"],
      cleanupRollback: ["assert tempfile removed after turn"],
      evidenceCapture: ["path listings", "session output"],
    },
  },
});

// -- Manual: event parsing + process cleanup ---------------------------

defineCheck({
  id: "acp.event-parsing-manual",
  name: "ACPX expanded event parsing tolerates duplicate/unknown events; process cleanup on exit",
  groups: ["acp", "streaming-cleanup"],
  matrixIds: ["UM-10c"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging ACPX session with the ability to inject duplicate/unknown NDJSON lines.",
    ],
    steps: [
      "Inject one duplicate event and one unknown-type event during a turn.",
      "Confirm the runtime does not crash and the turn completes.",
      "Exit the session; verify process cleanup releases child processes.",
    ],
    expected: "Turn completes; no zombie processes remain after exit.",
    evidence: ["Turn transcript; ps snapshot before/after exit."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["ps snapshot proves cleanup"],
      evidenceCapture: ["transcript", "ps snapshots"],
    },
  },
});

// -- Manual: session metadata ------------------------------------------

defineCheck({
  id: "acp.session-metadata-manual",
  name: "Session metadata records ACP runtime information",
  groups: ["acp", "history-recovery"],
  matrixIds: ["UM-11"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A live ACP session and read access to session metadata."],
    steps: [
      "Retrieve session metadata for the current run.",
      "Confirm the ACP runtime, model, and thinking effort are present.",
    ],
    expected: "Metadata contains the ACP runtime, model, and effort fields.",
    evidence: ["Metadata JSON payload."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only; no rollback"],
      evidenceCapture: ["metadata payload"],
    },
  },
});

// -- Manual: patched shim ----------------------------------------------

defineCheck({
  id: "acp.patched-shim-manual",
  name: "Patched Claude ACP shim is bind-mounted and active",
  groups: ["acp"],
  matrixIds: ["RT-07"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Host filesystem access with the patched claude-agent-acp-local directory."],
    steps: [
      "Verify the compose file bind-mounts the patched shim path.",
      "From inside the container, resolve the shim's entry file and check for the systemPrompt.append patch.",
    ],
    expected:
      "Container uses the patched shim; the patch is present and matches the recovery-archive checksum.",
    evidence: ["File checksum comparison against the recovery archive."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["observational only"],
      evidenceCapture: ["checksum comparison"],
    },
  },
});
