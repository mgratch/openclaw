// Deterministic helpers for the history-recovery paginated behavior check.
//
// The paginated check calls the gateway RPC `chat.history.full` and compares
// several partitionings of the same session. This module owns the small, pure
// pieces of that check so they can be unit-tested without a live gateway:
//
//   * parseSessionStore        normalize a sessions.json blob into candidate
//                              records (key + updatedAt) with graceful handling
//                              of malformed rows.
//   * discoverSessionCandidates
//                              walk a set of parsed stores and return a sorted
//                              list of candidates, freshest-first.
//   * planPartitionings        pick exactly two distinct multi-page plans
//                              sized near total/2 and total/3 so each plan
//                              traversal is 2 or 3 pages long.
//   * pageBoundaries           compute the expected offsets/limits/hasMore for
//                              one partitioning plan; used both by the check
//                              and by the tests.
//   * assemblePages            verify page-by-page continuity and concatenate
//                              messages in order, reporting every discrepancy.
//   * hashSessionKey           SHA-256(sessionKey) so evidence stays redacted.
//   * canonicalizeMessage      collapse a raw chat.history.full message into a
//                              stable, content-free tuple {role, ts, hash}.
//   * aggregateChecksum        SHA-256 over the ordered canonical tuples.
//   * createCallBudget         call counter that structurally caps how many
//                              gateway RPCs the check can issue.
//
// Nothing in this module talks to the gateway or the filesystem. It only
// operates on values the check has already fetched. That keeps redaction and
// fail-closed reasoning easy: the module cannot leak a session key or message
// body because it never sees the full payload except through the caller.

import { createHash } from "node:crypto";

// chat.history.full clamps limit at 2000 messages per page. The check refuses
// to run against a session larger than one reference page so the reference
// fetch is always exactly one gateway call.
export const HISTORY_HARD_PAGE_LIMIT = 2000;

// Full traversals may never use page size 1 or 2. The check would need too
// many pages, and the task budget forbids that shape. planPartitionings
// enforces this floor.
export const HISTORY_MIN_PARTITION_LIMIT = 3;

// planPartitionings needs the session to be big enough that the smaller of
// its two plans (ceil(total/3)) still lands on a limit >= 3.
export const HISTORY_MIN_TOTAL_FOR_PLAN = 8;

/**
 * @typedef {{
 *   key: string,
 *   updatedAt: number,
 *   agentId?: string,
 *   sessionId?: string,
 * }} SessionCandidate
 * @typedef {{
 *   limit: number,
 *   label: string,
 * }} PartitionPlan
 * @typedef {{
 *   offset: number,
 *   limit: number,
 *   expectedHasMore: boolean,
 * }} PageBoundary
 */

/**
 * Parse a single sessions.json blob into an array of candidates. Malformed
 * rows are silently dropped   the check treats an empty candidate list as
 * "no fixture available" and fails closed on top of that.
 *
 * @param {unknown} store   parsed JSON contents of one sessions.json file.
 * @param {{ agentId?: string }} [options]
 * @returns {SessionCandidate[]}
 */
export function parseSessionStore(store, { agentId } = {}) {
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    return [];
  }
  const out = [];
  for (const [key, entry] of Object.entries(store)) {
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const updatedAt = Number(entry.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      continue;
    }
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
    if (!sessionId) {
      continue;
    }
    out.push({
      key,
      updatedAt,
      agentId: typeof agentId === "string" && agentId.length > 0 ? agentId : undefined,
      sessionId,
    });
  }
  return out;
}

/**
 * Combine multiple parsed session stores into a single freshest-first
 * candidate list. Ties on updatedAt are broken by sessionKey string order so
 * the sort is deterministic across runs.
 *
 * @param {Array<{ agentId?: string, store: unknown }>} stores
 * @returns {SessionCandidate[]}
 */
export function discoverSessionCandidates(stores) {
  const all = [];
  for (const { agentId, store } of stores ?? []) {
    for (const c of parseSessionStore(store, { agentId })) {
      all.push(c);
    }
  }
  all.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return all;
}

/**
 * Return exactly two distinct multi-page partitioning plans for a session of
 * length `total`, sized near one-half and one-third of total so each plan
 * traversal needs only 2 or 3 pages. Returns an empty array when total is too
 * small to produce two distinct >=3-sized plans.
 *
 * Guarantees enforced structurally so the check cannot degenerate into a
 * many-page fan-out:
 *
 *   * exactly two plans, sorted ascending by limit;
 *   * every limit >= HISTORY_MIN_PARTITION_LIMIT (never 1 or 2);
 *   * every limit <= HISTORY_HARD_PAGE_LIMIT;
 *   * every plan produces >= 2 pages (limit < total);
 *   * every plan produces <= 4 pages   `ceil(total / limit) <= 4`.
 *
 * @param {number} total
 * @returns {PartitionPlan[]}
 */
export function planPartitionings(total) {
  if (!Number.isInteger(total) || total < HISTORY_MIN_TOTAL_FOR_PLAN) {
    return [];
  }
  if (total > HISTORY_HARD_PAGE_LIMIT) {
    return [];
  }
  const halfLimit = Math.ceil(total / 2);
  const thirdLimit = Math.ceil(total / 3);
  const plans = [];
  for (const limit of [thirdLimit, halfLimit]) {
    if (
      !Number.isInteger(limit) ||
      limit < HISTORY_MIN_PARTITION_LIMIT ||
      limit > HISTORY_HARD_PAGE_LIMIT ||
      limit >= total
    ) {
      return [];
    }
    const pages = Math.ceil(total / limit);
    if (pages < 2 || pages > 4) {
      return [];
    }
    plans.push({ limit, label: `limit=${limit}` });
  }
  if (plans[0].limit === plans[1].limit) {
    return [];
  }
  return plans;
}

/**
 * Given a partitioning plan and a total message count, return the sequence
 * of (offset, limit, expectedHasMore) tuples that a fully-paginated fetch
 * MUST produce. Used both by the check and by unit tests.
 *
 * @param {number} total
 * @param {number} limit
 * @returns {PageBoundary[]}
 */
export function pageBoundaries(total, limit) {
  if (
    !Number.isInteger(total) ||
    !Number.isInteger(limit) ||
    total < 0 ||
    limit <= 0 ||
    limit > HISTORY_HARD_PAGE_LIMIT
  ) {
    throw new RangeError(
      `pageBoundaries requires 0 <= total, 0 < limit <= ${HISTORY_HARD_PAGE_LIMIT}   got total=${total} limit=${limit}`,
    );
  }
  const out = [];
  let offset = 0;
  // Cap the loop so a pathological input can never spin forever; the caller
  // still sees fewer pages than expected and the check fails.
  const hardCap = Math.ceil(total / limit) + 2;
  let iterations = 0;
  while (offset < total && iterations < hardCap) {
    const expectedHasMore = offset + limit < total;
    out.push({ offset, limit, expectedHasMore });
    offset += limit;
    iterations++;
  }
  return out;
}

/**
 * Return `sha256(sessionKey)` as a lowercase hex digest so the evidence
 * bundle can identify which session was probed without echoing the raw key
 * (which contains channel/thread identifiers we do not want in reports).
 */
export function hashSessionKey(sessionKey) {
  if (typeof sessionKey !== "string" || sessionKey.length === 0) {
    throw new TypeError("hashSessionKey requires a non-empty string");
  }
  return createHash("sha256").update(sessionKey, "utf8").digest("hex");
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return JSON.stringify(null);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return JSON.stringify(null);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (seen.has(value)) {
    return JSON.stringify("__cycle__");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v, seen)).join(",")}]`;
  }
  const keys = Object.keys(value).toSorted();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k], seen)}`).join(",")}}`;
}

/**
 * Reduce a raw chat.history.full message into a redacted-safe canonical
 * form. The tuple is:
 *
 *   role         the message's role string (or "unknown")
 *   timestamp    Number(msg.timestamp) or null when absent
 *   contentHash  sha256 of the stableStringify(content ?? "") payload
 *
 * The canonical form never carries the raw message body or the sender
 * identity, so it can be checksummed without exposing any content.
 *
 * @param {unknown} message
 */
export function canonicalizeMessage(message) {
  const role = typeof message?.role === "string" ? message.role : "unknown";
  const ts = Number(message?.timestamp);
  const timestamp = Number.isFinite(ts) ? ts : null;
  const content = message?.content ?? "";
  const contentHash = createHash("sha256").update(stableStringify(content), "utf8").digest("hex");
  return { role, timestamp, contentHash };
}

/**
 * Compute a stable SHA-256 aggregate checksum over an ordered array of raw
 * messages. Never exposes raw content   the digest only depends on the
 * canonicalizeMessage tuple.
 *
 * @param {unknown[]} messages
 */
export function aggregateChecksum(messages) {
  if (!Array.isArray(messages)) {
    throw new TypeError("aggregateChecksum requires an array");
  }
  const hash = createHash("sha256");
  for (let i = 0; i < messages.length; i++) {
    const tuple = canonicalizeMessage(messages[i]);
    hash.update(`${i}|${tuple.role}|${tuple.timestamp ?? "null"}|${tuple.contentHash}\n`, "utf8");
  }
  return hash.digest("hex");
}

/**
 * Assemble an ordered message array from a list of paged responses. Verifies
 * that every page's `offset` matches the running expected offset, that its
 * declared `hasMore` matches the planned expectation, and that the reported
 * `total` never contradicts an earlier page. Returns an object with the
 * concatenated messages and a list of continuity problems (empty on success).
 *
 * @param {{ offset: number, limit: number, expectedHasMore: boolean }[]} plan
 * @param {{ offset: number, hasMore: boolean, total: number, messages: unknown[] }[]} pages
 */
export function assemblePages(plan, pages) {
  const problems = [];
  const messages = [];
  if (!Array.isArray(plan) || !Array.isArray(pages)) {
    return { ok: false, messages, problems: ["plan or pages missing"] };
  }
  if (plan.length !== pages.length) {
    problems.push(`plan/page count mismatch   plan=${plan.length} pages=${pages.length}`);
  }
  let totalSeen = null;
  const count = Math.min(plan.length, pages.length);
  let expectedOffset = 0;
  for (let i = 0; i < count; i++) {
    const p = pages[i];
    const b = plan[i];
    if (typeof p?.offset !== "number" || p.offset !== expectedOffset) {
      problems.push(`page[${i}] offset ${p?.offset} != expected ${expectedOffset}`);
    }
    if (typeof p?.total !== "number") {
      problems.push(`page[${i}] total missing`);
    } else if (totalSeen === null) {
      totalSeen = p.total;
    } else if (p.total !== totalSeen) {
      problems.push(`page[${i}] total ${p.total} != first total ${totalSeen}`);
    }
    if (p?.hasMore !== b.expectedHasMore) {
      problems.push(`page[${i}] hasMore=${p?.hasMore} expected=${b.expectedHasMore}`);
    }
    const msgs = Array.isArray(p?.messages) ? p.messages : [];
    if (msgs.length > b.limit) {
      problems.push(`page[${i}] returned ${msgs.length} messages (> limit ${b.limit})`);
    }
    for (const m of msgs) {
      messages.push(m);
    }
    expectedOffset += b.limit;
  }
  return { ok: problems.length === 0, messages, problems, total: totalSeen };
}

/**
 * Small non-refillable counter used by the check to structurally cap how
 * many gateway RPCs it may issue. Consumers call `tryAcquire()` before every
 * outbound call and treat `false` as fail-closed evidence   the check must
 * never fan out beyond `max` calls regardless of how many candidates or
 * pages it hoped to try.
 *
 * @param {number} max
 */
export function createCallBudget(max) {
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError(`createCallBudget requires a positive integer   got ${max}`);
  }
  let count = 0;
  return {
    tryAcquire() {
      if (count >= max) {
        return false;
      }
      count++;
      return true;
    },
    get count() {
      return count;
    },
    get max() {
      return max;
    },
    get remaining() {
      return max - count;
    },
  };
}
