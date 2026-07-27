// Deterministic canary tests. Uses fake write/read/remove/verifyCleanup so
// nothing touches the live LanceDB store.

import assert from "node:assert/strict";
import test from "node:test";
import {
  makeCanaryTag,
  withCanary,
  CanaryAggregateError,
  RESERVED_PREFIX,
} from "../lib/canary.mjs";

const okDeps = () => {
  const rows = new Set();
  return {
    projectId: "staging-project",
    write: async ({ tag }) => {
      rows.add(tag);
    },
    read: async ({ tag }) => (rows.has(tag) ? { tag } : null),
    remove: async ({ tag }) => {
      rows.delete(tag);
    },
    verifyCleanup: async ({ tag }) => ({ residual: rows.has(tag) ? 1 : 0 }),
    rows,
  };
};

test("makeCanaryTag requires the reserved prefix", () => {
  assert.throws(
    () => makeCanaryTag("not-canary"),
    /Canary prefix must start with 'openclaw-canary'/,
  );
  const tag = makeCanaryTag();
  assert.ok(tag.startsWith(RESERVED_PREFIX + "-"));
});

test("callback does not receive remove", async () => {
  const deps = okDeps();
  const { result } = await withCanary(deps, async ({ read, tag, projectId, remove }) => {
    assert.equal(remove, undefined, "callback must not be handed remove");
    assert.equal(typeof read, "function");
    assert.equal(projectId, deps.projectId);
    assert.ok(tag.startsWith("openclaw-canary"));
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(deps.rows.size, 0, "row removed after test");
});

test("withCanary aggregates callback failure with cleanup failure", async () => {
  const deps = okDeps();
  deps.remove = async () => {
    throw new Error("remove failed");
  };
  await assert.rejects(
    withCanary(deps, async () => {
      throw new Error("callback exploded");
    }),
    CanaryAggregateError,
  );
  // pull the actual rejection value
  await assert.rejects(
    withCanary(okDeps(), async () => {
      throw new Error("callback exploded");
    }),
    (e) => {
      assert.equal(e.name, "CanaryAggregateError");
      assert.match(e.message, /callback exploded/);
      return true;
    },
  );
});

test("withCanary attempts cleanup even after a partial write throws", async () => {
  const deps = okDeps();
  let cleanupAttempted = false;
  deps.write = async ({ tag }) => {
    deps.rows.add(tag);
    throw new Error("partial write");
  };
  deps.remove = async ({ tag }) => {
    cleanupAttempted = true;
    deps.rows.delete(tag);
  };
  await assert.rejects(withCanary(deps, async () => "unused"));
  assert.equal(cleanupAttempted, true, "cleanup must run even on partial write");
});

test("withCanary flags residual rows via verifyCleanup", async () => {
  const deps = okDeps();
  deps.remove = async () => {
    /* pretend delete but leaves row */
  };
  // rows still contains tag; verifyCleanup will report residual=1
  await assert.rejects(
    withCanary(deps, async () => "unused"),
    /residual row/,
  );
});

test("withCanary requires verifyCleanup and all callables", async () => {
  await assert.rejects(
    withCanary(
      { projectId: "p", write: async () => {}, read: async () => {}, remove: async () => {} },
      async () => {},
    ),
    /verifyCleanup function/,
  );
  await assert.rejects(
    withCanary(
      {
        projectId: "p",
        write: async () => {},
        read: async () => {},
        verifyCleanup: async () => ({ residual: 0 }),
      },
      async () => {},
    ),
    /write\/read\/remove functions/,
  );
  await assert.rejects(
    withCanary(
      {
        write: async () => {},
        read: async () => {},
        remove: async () => {},
        verifyCleanup: async () => ({ residual: 0 }),
      },
      async () => {},
    ),
    /string projectId/,
  );
});

test("withCanary still performs idempotent cleanup when write reports failure", async () => {
  const calls = { remove: 0, verify: 0 };
  const deps = {
    projectId: "staging-project",
    write: async () => {
      throw new Error("write failed");
    },
    read: async () => null,
    remove: async () => {
      calls.remove++;
    },
    verifyCleanup: async () => {
      calls.verify++;
      return { residual: 0 };
    },
  };
  await assert.rejects(
    withCanary(deps, async () => "unused"),
    /write failed/,
  );
  assert.equal(calls.remove, 1);
  assert.equal(calls.verify, 1);
});
