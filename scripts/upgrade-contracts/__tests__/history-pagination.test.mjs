// Deterministic tests for the history-pagination helpers.
//
// Every case in here is pure   nothing touches the filesystem, the gateway,
// or a session store on the host. The tests cover parse/discovery, plan
// sizing and its bounded call-count invariant, page continuity, total/hasMore
// mismatches, checksum stability and order sensitivity, and the redaction
// invariants (session key hash, canonical message shape).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  HISTORY_HARD_PAGE_LIMIT,
  HISTORY_MIN_PARTITION_LIMIT,
  HISTORY_MIN_TOTAL_FOR_PLAN,
  aggregateChecksum,
  assemblePages,
  canonicalizeMessage,
  createCallBudget,
  discoverSessionCandidates,
  hashSessionKey,
  pageBoundaries,
  parseSessionStore,
  planPartitionings,
} from "../lib/history-pagination.mjs";

// --- parseSessionStore --------------------------------------------------

test("parseSessionStore accepts well-formed rows and stamps the agentId", () => {
  const rows = parseSessionStore(
    {
      "agent:demo:1": { sessionId: "sid-1", updatedAt: 100 },
      "agent:demo:2": { sessionId: "sid-2", updatedAt: 200 },
    },
    { agentId: "demo" },
  );
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.agentId, "demo");
    assert.match(r.key, /^agent:demo:/);
    assert.ok(typeof r.sessionId === "string" && r.sessionId.length > 0);
  }
});

test("parseSessionStore drops rows without sessionId, without updatedAt, or wrong types", () => {
  const rows = parseSessionStore({
    "no-sid": { updatedAt: 100 },
    "no-updated-at": { sessionId: "sid-x" },
    "bad-updated-at": { sessionId: "sid-y", updatedAt: "yesterday" },
    "empty-sid": { sessionId: "", updatedAt: 100 },
    "negative-updated-at": { sessionId: "sid-z", updatedAt: -1 },
    "": { sessionId: "sid-blank-key", updatedAt: 100 },
    "ok-row": { sessionId: "sid-ok", updatedAt: 100 },
  });
  assert.deepEqual(
    rows.map((r) => r.key),
    ["ok-row"],
  );
});

test("parseSessionStore rejects non-object stores without throwing", () => {
  assert.deepEqual(parseSessionStore(null), []);
  assert.deepEqual(parseSessionStore(undefined), []);
  assert.deepEqual(parseSessionStore([1, 2, 3]), []);
  assert.deepEqual(parseSessionStore("string"), []);
});

// --- discoverSessionCandidates -----------------------------------------

test("discoverSessionCandidates sorts freshest-first and breaks ties deterministically", () => {
  const merged = discoverSessionCandidates([
    {
      agentId: "a",
      store: {
        "agent:a:1": { sessionId: "s1", updatedAt: 100 },
        "agent:a:2": { sessionId: "s2", updatedAt: 300 },
      },
    },
    {
      agentId: "b",
      store: {
        "agent:b:1": { sessionId: "s3", updatedAt: 300 },
        "agent:b:2": { sessionId: "s4", updatedAt: 200 },
      },
    },
  ]);
  // Freshest first (300), then 200, then 100. On ties, key string order.
  assert.deepEqual(
    merged.map((c) => c.key),
    ["agent:a:2", "agent:b:1", "agent:b:2", "agent:a:1"],
  );
});

test("discoverSessionCandidates handles empty and missing stores gracefully", () => {
  assert.deepEqual(discoverSessionCandidates([]), []);
  assert.deepEqual(discoverSessionCandidates([{ agentId: "a", store: null }]), []);
  assert.deepEqual(discoverSessionCandidates(), []);
});

// --- planPartitionings --------------------------------------------------

test("planPartitionings returns exactly two distinct plans with bounded page counts", () => {
  for (let total = HISTORY_MIN_TOTAL_FOR_PLAN; total <= 200; total++) {
    const plans = planPartitionings(total);
    assert.equal(plans.length, 2, `total=${total} should produce exactly two plans`);
    const [first, second] = plans;
    assert.ok(first.limit < second.limit, `total=${total} plans must be sorted ascending`);
    assert.notEqual(first.limit, second.limit, `total=${total} plans must be distinct`);
    for (const p of plans) {
      assert.ok(
        p.limit >= HISTORY_MIN_PARTITION_LIMIT,
        `total=${total} limit=${p.limit} must be >= ${HISTORY_MIN_PARTITION_LIMIT}`,
      );
      assert.ok(p.limit < total, `total=${total} limit=${p.limit} must be < total`);
      const pages = Math.ceil(total / p.limit);
      assert.ok(
        pages >= 2 && pages <= 4,
        `total=${total} limit=${p.limit} produced ${pages} pages`,
      );
    }
  }
});

test("planPartitionings never emits page size 1 or 2 for any legal total", () => {
  for (let total = HISTORY_MIN_TOTAL_FOR_PLAN; total <= HISTORY_HARD_PAGE_LIMIT; total++) {
    const plans = planPartitionings(total);
    for (const p of plans) {
      assert.notEqual(p.limit, 1, `total=${total} produced forbidden limit=1`);
      assert.notEqual(p.limit, 2, `total=${total} produced forbidden limit=2`);
    }
  }
});

test("planPartitionings picks limits near total/3 and total/2", () => {
  for (const total of [10, 15, 33, 100, 1000, 1999, HISTORY_HARD_PAGE_LIMIT]) {
    const plans = planPartitionings(total);
    assert.equal(plans.length, 2);
    assert.equal(plans[0].limit, Math.ceil(total / 3), `total=${total} smaller plan == ceil(t/3)`);
    assert.equal(plans[1].limit, Math.ceil(total / 2), `total=${total} larger plan == ceil(t/2)`);
  }
});

test("planPartitionings rejects sessions that cannot support two multi-page plans", () => {
  for (let total = 0; total < HISTORY_MIN_TOTAL_FOR_PLAN; total++) {
    assert.deepEqual(planPartitionings(total), [], `total=${total} must produce no plans`);
  }
  assert.deepEqual(planPartitionings(-1), []);
  assert.deepEqual(planPartitionings(3.5), []);
  assert.deepEqual(planPartitionings("nope"), []);
});

test("planPartitionings refuses totals over the hard page limit", () => {
  assert.deepEqual(planPartitionings(HISTORY_HARD_PAGE_LIMIT + 1), []);
  assert.deepEqual(planPartitionings(HISTORY_HARD_PAGE_LIMIT * 10), []);
});

// --- pageBoundaries ----------------------------------------------------

test("pageBoundaries produces the expected offset/limit/hasMore sequence", () => {
  const boundaries = pageBoundaries(10, 4);
  assert.deepEqual(boundaries, [
    { offset: 0, limit: 4, expectedHasMore: true },
    { offset: 4, limit: 4, expectedHasMore: true },
    { offset: 8, limit: 4, expectedHasMore: false },
  ]);
});

test("pageBoundaries emits zero boundaries for total=0", () => {
  assert.deepEqual(pageBoundaries(0, 10), []);
});

test("pageBoundaries throws on invalid input", () => {
  assert.throws(() => pageBoundaries(10, 0), /pageBoundaries/);
  assert.throws(() => pageBoundaries(-1, 5), /pageBoundaries/);
  assert.throws(() => pageBoundaries(10, HISTORY_HARD_PAGE_LIMIT + 1), /pageBoundaries/);
  assert.throws(() => pageBoundaries(1.5, 3), /pageBoundaries/);
});

// --- assemblePages -----------------------------------------------------

function fakePage(offset, total, hasMore, messages) {
  return { offset, total, hasMore, messages };
}

test("assemblePages concatenates messages in order when every page matches the plan", () => {
  const plan = pageBoundaries(6, 3);
  const pages = [
    fakePage(0, 6, true, [
      { role: "user", timestamp: 1, content: "a" },
      { role: "user", timestamp: 2, content: "b" },
      { role: "user", timestamp: 3, content: "c" },
    ]),
    fakePage(3, 6, false, [
      { role: "user", timestamp: 4, content: "d" },
      { role: "user", timestamp: 5, content: "e" },
      { role: "user", timestamp: 6, content: "f" },
    ]),
  ];
  const r = assemblePages(plan, pages);
  assert.equal(r.ok, true);
  assert.equal(r.problems.length, 0);
  assert.equal(r.messages.length, 6);
  assert.equal(r.total, 6);
});

test("assemblePages flags offset discontinuities", () => {
  const plan = pageBoundaries(6, 3);
  const pages = [
    fakePage(0, 6, true, [{ role: "user", content: "a" }]),
    fakePage(4, 6, false, [{ role: "user", content: "b" }]), // wrong offset
  ];
  const r = assemblePages(plan, pages);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /offset 4 != expected 3/.test(p)));
});

test("assemblePages flags total mismatches across pages", () => {
  const plan = pageBoundaries(6, 3);
  const pages = [
    fakePage(0, 6, true, [{ role: "user", content: "a" }]),
    fakePage(3, 7, false, [{ role: "user", content: "b" }]),
  ];
  const r = assemblePages(plan, pages);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /total 7 != first total 6/.test(p)));
});

test("assemblePages flags hasMore mismatches against plan", () => {
  const plan = pageBoundaries(6, 3);
  // Server reports hasMore=false too early on the first page.
  const pages = [
    fakePage(0, 6, false, [{ role: "user", content: "a" }]),
    fakePage(3, 6, false, [{ role: "user", content: "b" }]),
  ];
  const r = assemblePages(plan, pages);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /hasMore=false expected=true/.test(p)));
});

test("assemblePages flags page count mismatch with the plan", () => {
  const plan = pageBoundaries(6, 3);
  const pages = [fakePage(0, 6, true, [{ role: "user", content: "a" }])];
  const r = assemblePages(plan, pages);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /plan\/page count mismatch/.test(p)));
});

test("assemblePages flags a page returning more messages than its declared limit", () => {
  const plan = pageBoundaries(4, 2);
  const pages = [
    fakePage(0, 4, true, [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "user", content: "c" }, // overflow
    ]),
    fakePage(2, 4, false, [
      { role: "user", content: "d" },
      { role: "user", content: "e" },
    ]),
  ];
  const r = assemblePages(plan, pages);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /returned 3 messages \(> limit 2\)/.test(p)));
});

// --- checksum stability, order sensitivity, redaction ------------------

test("aggregateChecksum is stable across identical message arrays", () => {
  const msgs = [
    { role: "user", timestamp: 1, content: "hello" },
    { role: "assistant", timestamp: 2, content: "world" },
  ];
  const a = aggregateChecksum(msgs);
  const b = aggregateChecksum(msgs.map((m) => ({ ...m })));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("aggregateChecksum is order-sensitive", () => {
  const a = aggregateChecksum([
    { role: "user", timestamp: 1, content: "hello" },
    { role: "assistant", timestamp: 2, content: "world" },
  ]);
  const b = aggregateChecksum([
    { role: "assistant", timestamp: 2, content: "world" },
    { role: "user", timestamp: 1, content: "hello" },
  ]);
  assert.notEqual(a, b);
});

test("aggregateChecksum reacts to content, role, and timestamp changes", () => {
  const base = [{ role: "user", timestamp: 1, content: "hello" }];
  const changedContent = [{ role: "user", timestamp: 1, content: "hello world" }];
  const changedRole = [{ role: "assistant", timestamp: 1, content: "hello" }];
  const changedTs = [{ role: "user", timestamp: 999, content: "hello" }];
  const baseHash = aggregateChecksum(base);
  assert.notEqual(baseHash, aggregateChecksum(changedContent));
  assert.notEqual(baseHash, aggregateChecksum(changedRole));
  assert.notEqual(baseHash, aggregateChecksum(changedTs));
});

test("aggregateChecksum never leaks message content into the digest input", () => {
  // The digest is over the canonicalized tuple, which hashes the content.
  // Verify that swapping in a very different content value still yields a
  // 64-char hex digest and does not include the raw string.
  const secret = "SECRET-DO-NOT-LEAK-4d64f7";
  const digest = aggregateChecksum([{ role: "user", timestamp: 1, content: secret }]);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest.includes(secret), false);
});

test("canonicalizeMessage collapses unknown roles and missing timestamps", () => {
  const t = canonicalizeMessage({});
  assert.equal(t.role, "unknown");
  assert.equal(t.timestamp, null);
  assert.match(t.contentHash, /^[0-9a-f]{64}$/);
});

test("canonicalizeMessage produces stable content hashes regardless of key order", () => {
  const a = canonicalizeMessage({ role: "user", timestamp: 1, content: { b: 2, a: 1 } });
  const b = canonicalizeMessage({ role: "user", timestamp: 1, content: { a: 1, b: 2 } });
  assert.equal(a.contentHash, b.contentHash);
});

test("hashSessionKey is deterministic and never returns the raw key", () => {
  const key = "agent:example:acp:preset:xyz:1234567890:abcdef";
  const h = hashSessionKey(key);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h.includes(key), false);
  assert.equal(hashSessionKey(key), h);
  assert.notEqual(hashSessionKey(key + "!"), h);
});

test("hashSessionKey matches a straight SHA-256 hex digest", () => {
  const key = "agent:example:acp:preset:xyz";
  const expected = createHash("sha256").update(key, "utf8").digest("hex");
  assert.equal(hashSessionKey(key), expected);
});

test("hashSessionKey refuses empty or non-string input", () => {
  assert.throws(() => hashSessionKey(""), /hashSessionKey/);
  assert.throws(() => hashSessionKey(null), /hashSessionKey/);
  assert.throws(() => hashSessionKey(123), /hashSessionKey/);
});

// --- createCallBudget guard --------------------------------------------

test("createCallBudget caps the total number of acquired slots", () => {
  const b = createCallBudget(3);
  assert.equal(b.max, 3);
  assert.equal(b.count, 0);
  assert.equal(b.remaining, 3);
  assert.equal(b.tryAcquire(), true);
  assert.equal(b.tryAcquire(), true);
  assert.equal(b.tryAcquire(), true);
  assert.equal(b.tryAcquire(), false, "fourth acquire must be refused");
  assert.equal(b.tryAcquire(), false, "budget exhaustion is sticky");
  assert.equal(b.count, 3, "count is clamped at max");
  assert.equal(b.remaining, 0);
});

test("createCallBudget rejects non-positive budgets", () => {
  assert.throws(() => createCallBudget(0), /createCallBudget/);
  assert.throws(() => createCallBudget(-1), /createCallBudget/);
  assert.throws(() => createCallBudget(1.5), /createCallBudget/);
  assert.throws(() => createCallBudget("a"), /createCallBudget/);
});

// --- integrated bounded-call-count invariant ---------------------------

test("planPartitionings plus reference fetch never exceeds the 8-call budget", () => {
  // Simulates the full-run call shape:
  //   1 reference fetch
  //   + ceil(total/limit_A) pages for plan A (ceil(total/3))
  //   + ceil(total/limit_B) pages for plan B (ceil(total/2))
  // for every legal total. Total calls must always be <= 8.
  for (let total = HISTORY_MIN_TOTAL_FOR_PLAN; total <= HISTORY_HARD_PAGE_LIMIT; total++) {
    const plans = planPartitionings(total);
    assert.equal(plans.length, 2, `total=${total}`);
    const pagesA = pageBoundaries(total, plans[0].limit).length;
    const pagesB = pageBoundaries(total, plans[1].limit).length;
    const totalCalls = 1 + pagesA + pagesB;
    assert.ok(totalCalls <= 8, `total=${total} would issue ${totalCalls} calls (>8)`);
    assert.ok(totalCalls >= 4, `total=${total} would issue too few calls (${totalCalls})`);
  }
});
