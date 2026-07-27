// Runner primitives for the upgrade-contracts harness.
//
// Every check is a plain object registered via `defineCheck`. The runner
// resolves prerequisites, invokes the check, and normalizes the result into a
// {status, kind, evidence, notes} record.
//
// There are exactly four terminal-shaped statuses:
//
//   pass    — automated assertion succeeded
//   fail    — automated assertion produced an unexpected result
//   skip    — a stated prerequisite was unavailable, so the check did not run
//   manual  — the check is a documented manual contract; the harness records
//             the contract verbatim, awaiting a human to attach evidence
//
// PASS/FAIL are terminal for gate purposes. SKIP and MANUAL are NOT terminal
// — a strict gate MUST fail while any nonterminal check is present.
//
// The `kind` field classifies the evidence class of the check:
//
//   behavior   — asserts a runtime/behavioral invariant against effective state
//   inventory  — asserts that a specific file/entry/symbol/regex exists in the
//                source, config, or filesystem inventory. NEVER counts as
//                behavioral validation of that behavior.
//   evidence   — attests to an immutable external artifact (e.g., a signed
//                canary result) that PROVES a behavior at a specific point in
//                time. Kind=evidence is authoritative only for the current
//                baseline; the target baseline REQUIRES a new artifact.
//
// The runner NEVER converts a fail into a pass or hides it. A check that
// cannot be automated today must ship as `manual` with concrete prereqs.

/**
 * @typedef {"pass"|"fail"|"skip"|"manual"} CheckStatus
 * @typedef {"behavior"|"inventory"|"evidence"} CheckKind
 * @typedef {{ label: string, value?: unknown }} EvidenceEntry
 * @typedef {{
 *   id: string,
 *   name: string,
 *   groups: string[],
 *   matrixIds: string[],
 *   kind: CheckKind,
 *   requires?: string[],
 *   automated: "auto" | "manual",
 *   manual?: ManualContract,
 *   run?: (ctx: unknown) => Promise<{ status: "pass"|"fail", evidence?: EvidenceEntry[], notes?: string }>,
 * }} CheckDefinition
 * @typedef {{
 *   prerequisites: string[],
 *   steps: string[],
 *   expected: string,
 *   evidence: string[],
 *   safety?: {
 *     stagingOnly?: boolean,
 *     mutatesData?: boolean,
 *     invokesPaidApi?: boolean,
 *     changesAuth?: boolean,
 *     downloadsExternal?: boolean,
 *     writesWorkspaceFiles?: boolean,
 *     expectedMutations?: string[],
 *     cleanupRollback?: string[],
 *     evidenceCapture?: string[],
 *   },
 * }} ManualContract
 */

const ALLOWED_KINDS = new Set(["behavior", "inventory", "evidence"]);
const registry = new Map();

export function defineCheck(check) {
  validateCheckDefinition(check);
  if (registry.has(check.id)) {
    throw new Error(`Duplicate check id: ${check.id}`);
  }
  registry.set(check.id, check);
  return check;
}

export function clearRegistry() {
  registry.clear();
}

export function getRegistry() {
  return [...registry.values()];
}

function validateCheckDefinition(check) {
  if (!check || typeof check !== "object") {
    throw new Error("defineCheck requires an object");
  }
  const required = ["id", "name", "groups", "matrixIds", "automated", "kind"];
  for (const key of required) {
    if (check[key] === undefined) {
      throw new Error(`defineCheck missing "${key}"`);
    }
  }
  if (typeof check.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(check.id)) {
    throw new Error(`Invalid check id: ${JSON.stringify(check.id)}`);
  }
  if (!ALLOWED_KINDS.has(check.kind)) {
    throw new Error(
      `Check ${check.id} has invalid kind ${JSON.stringify(check.kind)} — must be behavior|inventory|evidence`,
    );
  }
  if (!Array.isArray(check.groups) || check.groups.length === 0) {
    throw new Error(`Check ${check.id} must declare at least one group`);
  }
  if (!Array.isArray(check.matrixIds) || check.matrixIds.length === 0) {
    throw new Error(`Check ${check.id} must reference at least one preservation-matrix id`);
  }
  if (check.automated !== "auto" && check.automated !== "manual") {
    throw new Error(`Check ${check.id} automated must be "auto" or "manual"`);
  }
  if (check.automated === "manual") {
    validateManualContract(check.id, check.manual);
  } else if (typeof check.run !== "function") {
    throw new Error(`Automated check ${check.id} must provide run()`);
  }
}

function validateManualContract(id, m) {
  if (!m || typeof m !== "object") {
    throw new Error(`Manual check ${id} missing "manual" contract`);
  }
  for (const field of ["prerequisites", "steps", "evidence"]) {
    if (!Array.isArray(m[field])) {
      throw new Error(`Manual check ${id} contract missing array "${field}"`);
    }
  }
  if (typeof m.expected !== "string" || m.expected.trim() === "") {
    throw new Error(`Manual check ${id} contract missing "expected" text`);
  }
}

export async function runCheck(check, ctx) {
  const started = Date.now();
  const base = {
    id: check.id,
    name: check.name,
    groups: check.groups,
    matrixIds: check.matrixIds,
    kind: check.kind,
  };

  if (check.automated === "manual") {
    return {
      ...base,
      status: /** @type {CheckStatus} */ ("manual"),
      manual: check.manual,
      durationMs: Date.now() - started,
      notes: "Manual contract. Requires operator-attached evidence before the gate can pass.",
    };
  }

  if (Array.isArray(check.requires) && check.requires.length > 0) {
    const missing = check.requires.filter((req) => !isCapabilityAvailable(ctx, req));
    if (missing.length > 0) {
      return {
        ...base,
        status: /** @type {CheckStatus} */ ("skip"),
        durationMs: Date.now() - started,
        skipReason: `Missing prerequisites: ${missing.join(", ")}`,
      };
    }
  }

  try {
    const result = await check.run(ctx);
    const status = normalizeAutoStatus(check.id, result?.status);
    return {
      ...base,
      status,
      evidence: Array.isArray(result?.evidence) ? result.evidence : [],
      notes: typeof result?.notes === "string" ? result.notes : undefined,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      status: /** @type {CheckStatus} */ ("fail"),
      durationMs: Date.now() - started,
      error: {
        name: err?.name ?? "Error",
        message: String(err?.message ?? err),
        stack:
          typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 8).join("\n") : undefined,
      },
    };
  }
}

function normalizeAutoStatus(id, status) {
  if (status === "pass" || status === "fail") {
    return status;
  }
  throw new Error(
    `Automated check ${id} must return status "pass" or "fail" — got ${JSON.stringify(status)}. ` +
      "The harness never silently promotes an inconclusive result.",
  );
}

function isCapabilityAvailable(ctx, name) {
  const caps = ctx && typeof ctx === "object" ? ctx.capabilities : null;
  if (!caps || typeof caps !== "object") {
    return false;
  }
  return caps[name] === true;
}

export async function runChecks(checks, ctx, { filter, onProgress } = {}) {
  const selected = filter ? checks.filter((c) => filter(c)) : checks;
  const results = [];
  for (const check of selected) {
    if (typeof onProgress === "function") {
      onProgress({ phase: "start", check });
    }
    const result = await runCheck(check, ctx);
    results.push(result);
    if (typeof onProgress === "function") {
      onProgress({ phase: "end", check, result });
    }
  }
  return results;
}

/**
 * Summarise results with an evidence-class breakdown so the report and the
 * gate can each read what they need. Two related summaries are returned:
 *
 *   byStatus       — total, pass, fail, skip, manual (status only)
 *   byClass        — pass count broken down into behavior / inventory /
 *                    evidence, plus fail/skip/manual counts. This is what
 *                    downstream reporting uses to avoid the "green
 *                    inventory looks like proof" false-positive.
 */
export function summarize(results) {
  const byStatus = { total: results.length, pass: 0, fail: 0, skip: 0, manual: 0 };
  const byClass = {
    behaviorPass: 0,
    inventoryPass: 0,
    evidencePass: 0,
    fail: 0,
    skip: 0,
    manual: 0,
  };
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === "pass") {
      if (r.kind === "behavior") {
        byClass.behaviorPass++;
      } else if (r.kind === "inventory") {
        byClass.inventoryPass++;
      } else if (r.kind === "evidence") {
        byClass.evidencePass++;
      }
    } else if (r.status === "fail") {
      byClass.fail++;
    } else if (r.status === "skip") {
      byClass.skip++;
    } else if (r.status === "manual") {
      byClass.manual++;
    }
  }
  return { ...byStatus, byClass };
}
