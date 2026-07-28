// History, compaction, and transcript recovery. Live end-to-end coverage is
// manual; the automated portion is inventory + a behavior check that asserts
// the tree-recovery module exports the API the caller relies on.

import { execFile } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { HOME, UI_ROOT } from "../lib/env.mjs";
import {
  HISTORY_HARD_PAGE_LIMIT,
  HISTORY_MIN_TOTAL_FOR_PLAN,
  aggregateChecksum,
  assemblePages,
  createCallBudget,
  discoverSessionCandidates,
  hashSessionKey,
  pageBoundaries,
  planPartitionings,
} from "../lib/history-pagination.mjs";
import { defineCheck } from "../lib/runner.mjs";

// Successful-path RPC budget:
//   1 reference fetch (limit=min(total,2000)) + 2-page plan + 3-page plan = 6.
// The extra 2 slots cover a retry against alternate candidates when the
// freshest sessions.json entry turns out to be unusable. Any bug that tries
// to fan out beyond this budget fails closed on the next tryAcquire().
const HISTORY_MAX_CALL_BUDGET = 8;
const HISTORY_MAX_CANDIDATE_ATTEMPTS = 3;
const HISTORY_MIN_MESSAGES = HISTORY_MIN_TOTAL_FOR_PLAN;
const HISTORY_MIN_IDLE_MS = 5 * 60 * 1000;
const HISTORY_GATEWAY_TIMEOUT_MS = 10_000;
const HISTORY_SUBPROCESS_GRACE_MS = 5_000;
const HISTORY_MAX_SUBPROCESS_BUFFER = 8 * 1024 * 1024;
const HISTORY_OVERALL_DEADLINE_MS = 60_000;

async function loadAgentSessionStores(agentsRoot) {
  const stores = [];
  let agentDirs = [];
  try {
    agentDirs = await fs.readdir(agentsRoot, { withFileTypes: true });
  } catch {
    return stores;
  }
  for (const d of agentDirs) {
    if (!d.isDirectory()) {
      continue;
    }
    const sessionsJson = path.join(agentsRoot, d.name, "sessions", "sessions.json");
    try {
      const raw = await fs.readFile(sessionsJson, "utf8");
      const parsed = JSON.parse(raw);
      stores.push({ agentId: d.name, store: parsed });
    } catch {
      // Missing/malformed per-agent store is not a failure   the discovery
      // helper skips it and the outer check only fails when NO candidate has
      // a big-enough transcript.
    }
  }
  return stores;
}

/**
 * Return the mtime (ms) of a candidate's per-session transcript file, or 0
 * when the transcript is unreadable. Callers use this to detect mid-check
 * growth so a candidate whose transcript advances during the reference fetch
 * can be discarded before any pagination discrepancy is charged against the
 * check. The gateway resolves transcripts at
 * `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`.
 */
async function transcriptMtimeMs(candidate) {
  const sid = candidate.sessionId;
  const aid = candidate.agentId;
  if (typeof sid !== "string" || sid.length === 0 || typeof aid !== "string" || aid.length === 0) {
    return 0;
  }
  const transcript = path.join(HOME, "agents", aid, "sessions", `${sid}.jsonl`);
  try {
    const st = await fs.stat(transcript);
    return Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0;
  } catch {
    return 0;
  }
}

/**
 * Return the last-activity timestamp for a candidate by combining its
 * sessions.json `updatedAt` with the transcript mtime when that file exists.
 * sessions.json only bumps `updatedAt` when the session record is rewritten,
 * so a transcript that is still growing can look idle even though messages
 * are being appended. Taking the max of both timestamps defends against
 * that race.
 */
async function effectiveLastActivity(candidate) {
  const mtime = await transcriptMtimeMs(candidate);
  return mtime > candidate.updatedAt ? mtime : candidate.updatedAt;
}

/**
 * Invoke `openclaw gateway call` with an outer deadline and a redacted error
 * shape. The result NEVER carries stdout/stderr strings   only a boolean
 * status, the parsed body on success, and a small closed error-code union
 * on failure so callers can log counts without leaking transcript data.
 */
function callGateway(method, params, { deadlineAt }) {
  return new Promise((resolve) => {
    const now = Date.now();
    if (typeof deadlineAt === "number" && now >= deadlineAt) {
      resolve({ ok: false, durationMs: 0, errorCode: "deadline" });
      return;
    }
    const started = now;
    const proc = execFile(
      "openclaw",
      [
        "gateway",
        "call",
        method,
        "--json",
        "--params",
        JSON.stringify(params),
        "--timeout",
        String(HISTORY_GATEWAY_TIMEOUT_MS),
      ],
      {
        timeout: HISTORY_GATEWAY_TIMEOUT_MS + HISTORY_SUBPROCESS_GRACE_MS,
        maxBuffer: HISTORY_MAX_SUBPROCESS_BUFFER,
        shell: false,
        windowsHide: true,
      },
      (error, stdout) => {
        const durationMs = Date.now() - started;
        if (error) {
          const code = error?.killed ? "subprocess-timeout" : "subprocess-error";
          resolve({ ok: false, durationMs, errorCode: code });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout));
          resolve({ ok: true, durationMs, body: parsed });
        } catch {
          resolve({ ok: false, durationMs, errorCode: "unparseable-response" });
        }
      },
    );
    if (typeof deadlineAt === "number") {
      const untilDeadline = deadlineAt - now;
      const remaining = Math.max(0, Math.min(untilDeadline, HISTORY_GATEWAY_TIMEOUT_MS + 1_000));
      const t = setTimeout(() => {
        if (!proc.killed) {
          try {
            proc.kill("SIGTERM");
          } catch {
            // Best effort   the callback still resolves via the exec error path.
          }
        }
      }, remaining);
      t.unref?.();
    }
  });
}

async function guardedCall(budget, method, params, { deadlineAt }) {
  if (!budget.tryAcquire()) {
    return { ok: false, errorCode: "budget-exhausted", durationMs: 0 };
  }
  return callGateway(method, params, { deadlineAt });
}

async function fetchPlanPages(sessionKey, plan, total, budget, { deadlineAt }) {
  const expected = pageBoundaries(total, plan.limit);
  const pages = [];
  for (const b of expected) {
    const res = await guardedCall(
      budget,
      "chat.history.full",
      { sessionKey, offset: b.offset, limit: plan.limit },
      { deadlineAt },
    );
    if (!res.ok || !res.body || typeof res.body !== "object") {
      return { ok: false, pages, expected, error: res.errorCode ?? "no body" };
    }
    pages.push(res.body);
  }
  return { ok: true, pages, expected };
}

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

// Behavior: paginated history equals full history against the LIVE gateway.
// Replaces the former history-recovery.paginated-manual contract. Fails
// closed on every branch where the gateway, discovery, or a suitable idle
// multi-page fixture is unavailable   no silent skip/pass.
//
// Structural safety:
//   * total RPC budget capped at HISTORY_MAX_CALL_BUDGET (8)   the shared
//     createCallBudget slot must succeed before every outbound call;
//   * only HISTORY_MAX_CANDIDATE_ATTEMPTS (3) candidates are probed;
//   * only the freshest sessions.json entries that have been idle for at
//     least HISTORY_MIN_IDLE_MS are considered;
//   * a run-wide deadline (HISTORY_OVERALL_DEADLINE_MS) bounds wall time so
//     a hung gateway cannot pin the harness for many minutes;
//   * evidence carries counts, booleans, durations, and SHA-256 checksums
//     never session keys, message bodies, transcript paths, sender IDs, or
//     raw CLI errors.
defineCheck({
  id: "history-recovery.paginated-behavior",
  name: "chat.history.full paginates correctly and matches the full-history checksum",
  groups: ["history-recovery"],
  matrixIds: ["UM-08b"],
  kind: "behavior",
  automated: "auto",
  async run(ctx) {
    if (ctx?.capabilities?.["gateway.http"] !== true) {
      return {
        status: "fail",
        notes: "Gateway not reachable   cannot exercise chat.history.full.",
        evidence: [
          { label: "gateway health OK", value: false },
          { label: "gateway status", value: ctx?.env?.gateway?.status ?? null },
        ],
      };
    }

    const startedAt = Date.now();
    const deadlineAt = startedAt + HISTORY_OVERALL_DEADLINE_MS;
    const budget = createCallBudget(HISTORY_MAX_CALL_BUDGET);

    const stores = await loadAgentSessionStores(path.join(HOME, "agents"));
    if (stores.length === 0) {
      return {
        status: "fail",
        notes: "No agent session stores discovered; cannot select a fixture.",
        evidence: [{ label: "agent stores discovered", value: 0 }],
      };
    }
    const candidates = discoverSessionCandidates(stores);
    if (candidates.length === 0) {
      return {
        status: "fail",
        notes: "No session candidates survived parseSessionStore validation.",
        evidence: [
          { label: "agent stores discovered", value: stores.length },
          { label: "session candidates", value: 0 },
        ],
      };
    }

    // Reject active/growing sessions. A session that is still being written
    // to would grow between our reference fetch and each plan fetch, so we
    // could not attribute discrepancies to a real pagination regression.
    // sessions.json `updatedAt` alone is not enough: the transcript jsonl
    // grows as messages append without necessarily rewriting sessions.json.
    // We take the maximum of both timestamps as the effective last activity.
    const now = Date.now();
    const activityStamped = await Promise.all(
      candidates.map(async (c) => ({ candidate: c, lastActivity: await effectiveLastActivity(c) })),
    );
    const idleCandidates = activityStamped
      .filter(({ lastActivity }) => now - lastActivity >= HISTORY_MIN_IDLE_MS)
      .map(({ candidate }) => candidate);
    if (idleCandidates.length === 0) {
      return {
        status: "fail",
        notes: `No session has been idle for at least ${Math.round(HISTORY_MIN_IDLE_MS / 1000)}s; refusing to race a live transcript.`,
        evidence: [
          { label: "candidates seen", value: candidates.length },
          { label: "min idle seconds required", value: Math.round(HISTORY_MIN_IDLE_MS / 1000) },
        ],
      };
    }

    let chosen = null;
    let referenceMessages = null;
    let referenceTotal = 0;
    let attempted = 0;
    let attemptFailures = 0;
    let attemptTooSmall = 0;
    let attemptTooLarge = 0;
    let attemptRaced = 0;

    for (const c of idleCandidates.slice(0, HISTORY_MAX_CANDIDATE_ATTEMPTS)) {
      // Successful traversal needs 1 (reference) + 2 (plan A) + 3 (plan B) = 6
      // more slots. Stop attempting alternate candidates once that headroom
      // is gone so we never blow past HISTORY_MAX_CALL_BUDGET.
      if (budget.remaining < 6) {
        break;
      }
      attempted++;
      const preMtime = await transcriptMtimeMs(c);
      const ref = await guardedCall(
        budget,
        "chat.history.full",
        { sessionKey: c.key, offset: 0, limit: HISTORY_HARD_PAGE_LIMIT },
        { deadlineAt },
      );
      if (!ref.ok || !ref.body || typeof ref.body.total !== "number") {
        attemptFailures++;
        continue;
      }
      const t = ref.body.total;
      if (t > HISTORY_HARD_PAGE_LIMIT) {
        attemptTooLarge++;
        continue;
      }
      if (t < HISTORY_MIN_MESSAGES) {
        attemptTooSmall++;
        continue;
      }
      if (!Array.isArray(ref.body.messages) || ref.body.messages.length !== t) {
        attemptFailures++;
        continue;
      }
      // Post-reference stability probe. If the transcript file mtime
      // advanced while the reference fetch was in flight, this candidate is
      // still growing   using it would race the plan fetches. Discard and
      // try the next candidate; no additional RPC budget is spent.
      const postMtime = await transcriptMtimeMs(c);
      if (postMtime > preMtime) {
        attemptRaced++;
        continue;
      }
      chosen = c;
      referenceMessages = ref.body.messages;
      referenceTotal = t;
      break;
    }

    if (!chosen) {
      return {
        status: "fail",
        notes: `No usable idle fixture across ${attempted} candidate attempts.`,
        evidence: [
          { label: "candidates seen", value: candidates.length },
          { label: "idle candidates", value: idleCandidates.length },
          { label: "candidates attempted", value: attempted },
          { label: "attempt failures", value: attemptFailures },
          { label: "attempts too small", value: attemptTooSmall },
          { label: "attempts too large", value: attemptTooLarge },
          { label: "attempts raced", value: attemptRaced },
          { label: "min messages required", value: HISTORY_MIN_MESSAGES },
          { label: "hard page limit", value: HISTORY_HARD_PAGE_LIMIT },
          { label: "budget calls used", value: budget.count },
          { label: "budget max", value: HISTORY_MAX_CALL_BUDGET },
        ],
      };
    }

    const sessionKeyHash = hashSessionKey(chosen.key);
    const plans = planPartitionings(referenceTotal);
    if (plans.length !== 2) {
      return {
        status: "fail",
        notes: `planPartitionings did not return exactly two distinct multi-page plans for total=${referenceTotal}.`,
        evidence: [
          { label: "sessionKey sha256", value: sessionKeyHash },
          { label: "total messages", value: referenceTotal },
          { label: "distinct plans", value: plans.length },
        ],
      };
    }

    const referenceChecksum = aggregateChecksum(referenceMessages);
    const planResults = [];
    for (const plan of plans) {
      const fetched = await fetchPlanPages(chosen.key, plan, referenceTotal, budget, {
        deadlineAt,
      });
      if (!fetched.ok) {
        return {
          status: "fail",
          notes: `${plan.label}: paginated fetch failed (${fetched.error}).`,
          evidence: [
            { label: "sessionKey sha256", value: sessionKeyHash },
            { label: "plan label", value: plan.label },
            { label: "expected pages", value: fetched.expected.length },
            { label: "returned pages", value: fetched.pages.length },
            { label: "budget calls used", value: budget.count },
          ],
        };
      }
      const assembled = assemblePages(fetched.expected, fetched.pages);
      if (
        !assembled.ok ||
        assembled.messages.length !== referenceTotal ||
        assembled.total !== referenceTotal
      ) {
        return {
          status: "fail",
          notes: `${plan.label}: pagination discontinuity (${assembled.problems.length} problems).`,
          evidence: [
            { label: "sessionKey sha256", value: sessionKeyHash },
            { label: "plan label", value: plan.label },
            { label: "expected pages", value: fetched.expected.length },
            { label: "returned pages", value: fetched.pages.length },
            { label: "assembled messages", value: assembled.messages.length },
            { label: "reported total on page[0]", value: assembled.total },
            { label: "expected total", value: referenceTotal },
            { label: "continuity problem count", value: assembled.problems.length },
            { label: "budget calls used", value: budget.count },
          ],
        };
      }
      planResults.push({
        plan,
        pages: fetched.expected.length,
        checksum: aggregateChecksum(assembled.messages),
      });
    }

    const uniqueChecksums = new Set([referenceChecksum, ...planResults.map((p) => p.checksum)]);
    if (uniqueChecksums.size !== 1) {
      return {
        status: "fail",
        notes: "Aggregate checksums diverged across partitionings   pagination is not stable.",
        evidence: [
          { label: "sessionKey sha256", value: sessionKeyHash },
          { label: "reference checksum sha256", value: referenceChecksum },
          ...planResults.map((p) => ({
            label: `${p.plan.label} checksum sha256`,
            value: p.checksum,
          })),
          { label: "budget calls used", value: budget.count },
        ],
      };
    }

    const totalDurationMs = Date.now() - startedAt;
    return {
      status: "pass",
      evidence: [
        { label: "sessionKey sha256", value: sessionKeyHash },
        { label: "total messages", value: referenceTotal },
        { label: "distinct partitionings", value: planResults.length },
        ...planResults.map((p) => ({
          label: `${p.plan.label} pages`,
          value: p.pages,
        })),
        { label: "aggregate checksum sha256", value: referenceChecksum },
        { label: "budget calls used", value: budget.count },
        { label: "budget max", value: HISTORY_MAX_CALL_BUDGET },
        { label: "min messages required", value: HISTORY_MIN_MESSAGES },
        { label: "hard page limit", value: HISTORY_HARD_PAGE_LIMIT },
        { label: "candidates attempted", value: attempted },
        { label: "elapsed ms", value: totalDurationMs },
      ],
      notes: `Confirmed offset/hasMore/total continuity across ${planResults.length} partitionings; aggregated checksum equals the full-history checksum. Used ${budget.count}/${HISTORY_MAX_CALL_BUDGET} RPC slots.`,
    };
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
