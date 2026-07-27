// UUID-scoped disposable canary helper. Any check that must mutate production
// data uses this so the write is:
//
//   * uniquely identifiable (reserved-prefix UUID tag);
//   * scoped to a caller-supplied projectId that is expected to be a
//     pre-existing mapped staging/test project;
//   * cleaned up in a guaranteed try/finally, even when the callback throws or
//     the write itself half-succeeds;
//   * verified for zero residual rows via a caller-provided `verifyCleanup`
//     function;
//   * NEVER exposes `remove` to the callback — cleanup is harness-owned only.
//
// The caller supplies concrete write/read/remove/verifyCleanup functions, which
// keeps this module free of runtime dependencies and lets us unit-test it
// without touching the live LanceDB store.

import { randomUUID } from "node:crypto";

const RESERVED_PREFIX = "openclaw-canary-upgrade";

export function makeCanaryTag(prefix = RESERVED_PREFIX) {
  if (typeof prefix !== "string" || !prefix.startsWith("openclaw-canary")) {
    throw new Error(
      "Canary prefix must start with 'openclaw-canary' to be recognizable as disposable",
    );
  }
  return `${prefix}-${randomUUID()}`;
}

class CanaryAggregateError extends Error {
  constructor(message, causes) {
    super(message);
    this.name = "CanaryAggregateError";
    this.causes = causes;
  }
}

/**
 * Run a body of work against a UUID-scoped canary row. The lifecycle is:
 *   1. write({ tag, projectId }) — after the write is attempted, cleanup is
 *      always attempted by UUID tag, even if the write throws before reporting
 *      whether it committed a partial side effect.
 *   2. callback({ tag, projectId, read })  — callback CANNOT delete rows.
 *   3. remove({ tag, projectId })  — always attempted when the write ran, even
 *      if the callback throws. A cleanup exception is captured and aggregated
 *      with the primary failure rather than being swallowed.
 *   4. verifyCleanup({ tag, projectId })  — must return { residual: number }
 *      or `{ residualRows: [...] }`. If any residual rows remain after remove,
 *      the aggregate throws.
 *
 * Cleanup failures loudly aggregate with callback errors so the caller sees
 * both signals. This exists because the plan explicitly forbids silent-cleanup
 * behavior.
 */
export async function withCanary(
  { write, read, remove, verifyCleanup, projectId },
  callback,
  { prefix } = {},
) {
  if (typeof write !== "function" || typeof read !== "function" || typeof remove !== "function") {
    throw new Error("withCanary requires write/read/remove functions");
  }
  if (typeof verifyCleanup !== "function") {
    throw new Error("withCanary requires a verifyCleanup function to assert zero residual rows");
  }
  if (!projectId || typeof projectId !== "string") {
    throw new Error(
      "withCanary requires a string projectId (must be a pre-existing mapped staging/test project)",
    );
  }
  const tag = makeCanaryTag(prefix);

  let writeSucceeded = false;
  let primaryError = null;
  let primaryPhase = null;
  let callbackResult;
  const errors = [];

  // Write phase. Cleanup is always attempted after this call returns or
  // throws. Removing a never-created UUID tag is safe and avoids relying on a
  // writer to correctly report whether a partial side effect occurred.
  try {
    await write({ tag, projectId });
    writeSucceeded = true;
  } catch (err) {
    primaryError = err;
    primaryPhase = "write";
  }

  // Callback phase — only if write reported success. `remove` is never exposed
  // to the callback so a check cannot dodge the harness-owned cleanup.
  if (writeSucceeded) {
    try {
      callbackResult = await callback({ tag, projectId, read });
    } catch (err) {
      primaryError = err;
      primaryPhase = "callback";
    }
  }

  // Cleanup phase. This runs even when write() threw.
  {
    try {
      await remove({ tag, projectId });
    } catch (err) {
      errors.push({ phase: "remove", error: err });
    }
    try {
      const v = await verifyCleanup({ tag, projectId });
      const residual =
        typeof v?.residual === "number"
          ? v.residual
          : Array.isArray(v?.residualRows)
            ? v.residualRows.length
            : null;
      if (residual === null) {
        errors.push({
          phase: "verifyCleanup",
          error: new Error("verifyCleanup must return {residual:number} or {residualRows:[]}"),
        });
      } else if (residual > 0) {
        errors.push({
          phase: "verifyCleanup",
          error: new Error(`Canary cleanup left ${residual} residual row(s) for tag=${tag}`),
        });
      }
    } catch (err) {
      errors.push({ phase: "verifyCleanup", error: err });
    }
  }

  if (primaryError || errors.length > 0) {
    const causes = [];
    if (primaryError) {
      causes.push({ phase: primaryPhase ?? "primary", error: primaryError });
    }
    for (const e of errors) {
      causes.push(e);
    }
    const summary = causes.map((c) => `${c.phase}: ${c.error?.message ?? c.error}`).join("; ");
    throw new CanaryAggregateError(`Canary failed: ${summary}`, causes);
  }

  return { tag, projectId, result: callbackResult };
}

export { CanaryAggregateError, RESERVED_PREFIX };
