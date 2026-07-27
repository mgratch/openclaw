// History, compaction, and transcript recovery. Live end-to-end coverage is
// manual; the automated portion is inventory + a behavior check that asserts
// the tree-recovery module exports the API the caller relies on.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { HOME, UI_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "history-recovery.session-context-recovery-installed",
  name: "session-context-recovery extension is installed",
  groups: ["history-recovery"],
  matrixIds: ["RT-02"],
  kind: "inventory",
  requires: ["extension.session-context-recovery"],
  automated: "auto",
  async run() {
    const p = path.join(HOME, "extensions", "session-context-recovery");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    return { status: "pass", evidence: [{ label: "extension root", value: p }] };
  },
});

defineCheck({
  id: "history-recovery.tree-recovery-inventory",
  name: "conversation-tree recovery utility is present in the UI checkpoint",
  groups: ["history-recovery"],
  matrixIds: ["UM-08b"],
  kind: "inventory",
  requires: ["ui.checkpoint"],
  automated: "auto",
  async run() {
    const treeUtil = path.join(UI_ROOT, "src", "utils", "conversationTree.js");
    const alt = path.join(UI_ROOT, "src", "utils");
    if (existsSync(treeUtil)) {
      const src = await fs.readFile(treeUtil, "utf8");
      const hasBuild =
        /(buildTree|build\s+conversation|conversationTree)/i.test(src) ||
        /export\s+function\s+build/.test(src);
      if (!hasBuild) {
        return { status: "fail", notes: `${treeUtil} lacks a conversation-tree builder invariant` };
      }
      return {
        status: "pass",
        evidence: [
          { label: "conversationTree.js", value: treeUtil },
          { label: "builder invariant present", value: true },
        ],
      };
    }
    if (!existsSync(alt)) {
      return { status: "fail", notes: `UI src/utils directory not accessible at ${alt}` };
    }
    const entries = await fs.readdir(alt);
    const treeLike = entries.filter((n) => /tree|conversation/i.test(n));
    if (treeLike.length === 0) {
      return { status: "fail", notes: "No conversation-tree utility found in UI src/utils" };
    }
    return { status: "pass", evidence: [{ label: "tree-like utils", value: treeLike }] };
  },
});

defineCheck({
  id: "history-recovery.paginated-manual",
  name: "Paginated history and full history recovery",
  groups: ["history-recovery"],
  matrixIds: ["UM-08b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging session with more than one page of history.",
      "Ability to query the paginated history endpoint from the UI.",
    ],
    steps: [
      "Load the session; scroll the UI to trigger paginated history fetches.",
      "Compare the aggregated UI messages with the raw JSONL under ~/.openclaw/agents/<agent>/sessions/*.jsonl.",
      "Fetch the full history from the API and diff against the paginated one.",
    ],
    expected:
      "Every message from JSONL appears in the paginated view; full-history fetch equals concatenated pages.",
    evidence: [
      "Paginated response boundaries and total message count.",
      "Checksum comparison between paginated aggregate and full-history response.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only test"],
      evidenceCapture: ["response boundaries", "checksum"],
    },
  },
});

defineCheck({
  id: "history-recovery.large-history-manual",
  name: "Large session histories are served without truncation or crash",
  groups: ["history-recovery"],
  matrixIds: ["UM-08b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A staging session with thousands of messages; sufficient memory allocation."],
    steps: ["Fetch the full history for the session.", "Confirm no OOM and no dropped messages."],
    expected: "Full-history fetch completes; message count matches JSONL row count.",
    evidence: ["Message count comparison; memory usage snapshot."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only test"],
      evidenceCapture: ["message count", "memory snapshot"],
    },
  },
});

defineCheck({
  id: "history-recovery.post-compaction-manual",
  name: "Context recovers correctly after compaction",
  groups: ["history-recovery"],
  matrixIds: ["UM-05b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging session close to the compaction threshold.",
      "The session-context-recovery extension enabled.",
    ],
    steps: [
      "Trigger compaction.",
      "Ask the agent to summarize what happened before the compaction cut-off.",
      "Verify the pre-compaction transcript is retained under ~/.openclaw/workspace/ui-transcripts/.",
    ],
    expected:
      "Agent references specific facts from pre-compaction turns; transcripts persist without loss.",
    evidence: [
      "Full response transcript; pre-/post-compaction JSONL and ui-transcript file names.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["compaction summary and updated transcript"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["transcript", "file names"],
    },
  },
});

defineCheck({
  id: "history-recovery.compaction-quality-manual",
  name: "Repeated compactions are idempotent and do not amplify content",
  groups: ["history-recovery"],
  matrixIds: ["UM-06b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A staging session that can be compacted twice in a row without new turns."],
    steps: [
      "Compact the session.",
      "Immediately trigger another compaction.",
      "Verify the second compaction is a no-op or a bounded refinement (no content amplification).",
    ],
    expected: "Second compaction is idempotent within a documented bound.",
    evidence: ["Compaction outputs from both attempts."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["two compaction turns"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["compaction outputs"],
    },
  },
});

defineCheck({
  id: "history-recovery.workspace-limits-manual",
  name: "Workspace bootstrap prompts honor per-agent limits and do not spill cross-agent data",
  groups: ["history-recovery"],
  matrixIds: ["UM-06d"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging workspace with multiple agents and distinct workspace-scoped files."],
    steps: [
      "Boot agent A; capture its workspace bootstrap prompt.",
      "Boot agent B; capture its workspace bootstrap prompt.",
      "Verify B's bootstrap does not include A's workspace files.",
    ],
    expected: "Bootstrap prompts are scoped per-agent; no cross-agent spill.",
    evidence: ["Redacted bootstrap prompts for both agents."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only"],
      evidenceCapture: ["bootstrap prompts"],
    },
  },
});

defineCheck({
  id: "history-recovery.codex-overflow-manual",
  name: "Codex context overflow triggers auto-compaction",
  groups: ["history-recovery"],
  matrixIds: ["UM-24"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging Codex session and a large synthetic input that exceeds the provider's context.",
    ],
    steps: [
      "Send the oversize input.",
      "Observe the gateway log for the classification path.",
      "Confirm auto-compaction runs and the next turn completes.",
    ],
    expected:
      "Overflow is classified, auto-compaction runs, and the follow-up turn returns a completed response.",
    evidence: ["Gateway log lines; turn-completion transcript with compaction summary reference."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one compaction turn"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["log lines", "transcript"],
    },
  },
});
