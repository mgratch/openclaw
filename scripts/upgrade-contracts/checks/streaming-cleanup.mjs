// Streaming terminal cleanup. Source presence goes as inventory with tighter
// invariants than the previous check (heartbeat check no longer PASSes on a
// single loose token).

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { UI_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "streaming-cleanup.heartbeat-inventory",
  name: "UI useGatewayEvents separates liveness from progress and does not reset progress on generic heartbeat",
  groups: ["streaming-cleanup"],
  matrixIds: ["UI-03b"],
  kind: "inventory",
  requires: ["ui.checkpoint"],
  automated: "auto",
  async run() {
    const p = path.join(UI_ROOT, "src", "hooks", "useGatewayEvents.ts");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    const src = await fs.readFile(p, "utf8");
    const evidence = [
      { label: "mentions heartbeat", value: /heartbeat/i.test(src) },
      {
        label: "explicitly ignores heartbeat for progress",
        value: /heartbeat[^]{0,200}(?:no(?:-op|op)?|ignore|skip|does not|not\s+reset)/i.test(src),
      },
      {
        label: "separates writing/idle/between phase timeouts",
        value: /(writing|idle|between)/i.test(src) && /timeout/i.test(src),
      },
      {
        label: "does NOT reset run timer on heartbeat",
        value: !/heartbeat[^]{0,120}runStartedAtRef/i.test(src),
      },
    ];
    const missing = evidence.filter((e) => !e.value).map((e) => e.label);
    if (missing.length > 0) {
      return {
        status: "fail",
        evidence,
        notes: `useGatewayEvents inventory missing invariants: ${missing.join("; ")}`,
      };
    }
    return {
      status: "pass",
      evidence,
      notes: "Inventory only — see streaming-cleanup manual contracts for behavior.",
    };
  },
});

defineCheck({
  id: "streaming-cleanup.terminal-cleanup-manual",
  name: "Terminal cleanup clears refs on every completion path",
  groups: ["streaming-cleanup"],
  matrixIds: ["UI-03b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A running UI session with the checkpoint UI build.",
      "Ability to drive normal send, edit, retry, abort, timeout, and HTTP file paths.",
    ],
    steps: [
      "Send a normal WS message; on final, capture window.__openclaw_debug refs (sendingRef, runStartedAtRef, activeRunRef).",
      "Send with an attachment via HTTP; capture the same refs.",
      "Trigger a user abort mid-run.",
      "Trigger a stall auto-abort by delaying tool completion beyond the timeout.",
      "Trigger an error final by sending an invalid model id.",
      "Trigger a session-mismatch final by rehydrating a stale sessionKey.",
    ],
    expected:
      "After each terminal path all three refs are cleared; RunStatusIndicator elapsed time resets; no lingering 'Writing…' state.",
    evidence: [
      "Screenshot or DOM dump of RunStatusIndicator after each terminal path.",
      "The ref values captured immediately after final.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: ["staging chat turns and abort states"],
      cleanupRollback: ["staging-only session"],
      evidenceCapture: ["screenshots", "ref dumps"],
    },
  },
});

defineCheck({
  id: "streaming-cleanup.empty-final-manual",
  name: "Empty final-turn recovery still terminates cleanly",
  groups: ["streaming-cleanup", "history-recovery"],
  matrixIds: ["UM-28a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A live staging session on Codex or another provider prone to empty final turns.",
      "Sufficient staging balance for one conservative wrap-up prompt.",
    ],
    steps: [
      "Trigger the known empty-final path (successful tool work with no assistant text).",
      "Observe the runner emits exactly one wrap-up prompt.",
      "Confirm the UI transitions to Idle after the wrap-up prompt lands.",
    ],
    expected:
      "The wrap-up prompt runs at most once, the UI reaches Idle, and the transcript records the recovered final turn.",
    evidence: [
      "Runner log excerpt showing the wrap-up trigger.",
      "Final transcript row proving the recovered response.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one wrap-up prompt turn and its transcript row"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["runner log", "transcript row"],
    },
  },
});

defineCheck({
  id: "streaming-cleanup.wrap-up-idempotent-manual",
  name: "Wrap-up is idempotent; duplicate wrap-ups do not incur double billing/persistence",
  groups: ["streaming-cleanup", "history-recovery"],
  matrixIds: ["UM-28b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging session prone to empty final; ability to observe billing/persistence side-effects.",
    ],
    steps: [
      "Force a second wrap-up attempt (simulate a reconnect/duplicate trigger).",
      "Verify the second wrap-up is suppressed.",
      "Verify only one billed API call and one transcript row exist for the wrap-up.",
    ],
    expected: "Second wrap-up is suppressed; single billing / single row persisted.",
    evidence: ["Billing snapshot; transcript row count."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one billed wrap-up turn"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["billing snapshot", "row count"],
    },
  },
});

defineCheck({
  id: "streaming-cleanup.toolcallid-correlation-manual",
  name: "Tool completion correlates by toolCallId; searches backward for owning assistant message",
  groups: ["streaming-cleanup"],
  matrixIds: ["UI-03a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging UI session with interleaved tool events; ability to inspect the message list state after each event.",
    ],
    steps: [
      "Emit a tool-result whose toolCallId belongs to an older assistant message.",
      "Verify the UI updates the OWNING message, not the last message.",
      "Emit a stall-warning system message and then a real tool completion; verify the completion is not dropped.",
    ],
    expected:
      "Every tool completion updates the owning assistant message by toolCallId; no drop on interleaved system messages.",
    evidence: ["Before/after message-list state around each event."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: ["staging message-list mutations"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["message state snapshots"],
    },
  },
});

defineCheck({
  id: "streaming-cleanup.ghost-stream-manual",
  name: "Ghost Stream (dead reconnect loop) is bounded and does not persist",
  groups: ["streaming-cleanup"],
  matrixIds: ["UI-03c"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Ability to force disconnect and re-connect the UI to the gateway."],
    steps: [
      "Force a disconnect during an active run.",
      "Rehydrate the session; verify the UI does not enter a reconnect flood.",
      "Confirm the current-run tool count remains accurate across the reconnect.",
    ],
    expected: "No reconnect flood; accurate current-run tool count.",
    evidence: ["WebSocket reconnect log; tool-count snapshot."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["reconnect log", "tool-count snapshot"],
    },
  },
});
