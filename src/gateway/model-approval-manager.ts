import { randomUUID } from "node:crypto";
import type {
  ModelApprovalDecision,
  ModelApprovalRequestPayload,
} from "../infra/model-approvals.js";

// Grace period to keep resolved entries for late awaitDecision calls.
const RESOLVED_ENTRY_GRACE_MS = 15_000;

export type ModelApprovalRecord = {
  id: string;
  request: ModelApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  decision?: ModelApprovalDecision;
  resolvedBy?: string | null;
};

type PendingEntry = {
  record: ModelApprovalRecord;
  resolve: (decision: ModelApprovalDecision | null) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<ModelApprovalDecision | null>;
};

export type ModelApprovalIdLookupResult =
  | { kind: "exact" | "prefix"; id: string }
  | { kind: "ambiguous"; ids: string[] }
  | { kind: "none" };

/**
 * Pending-approval registry for metered-model approval requests. Modeled on
 * `ExecApprovalManager`, but resolves with the richer `ModelApprovalDecision`
 * object (approve/deny + dontAskAgain + switchTo) instead of a string union.
 */
export class ModelApprovalManager {
  private pending = new Map<string, PendingEntry>();

  create(
    request: ModelApprovalRequestPayload,
    timeoutMs: number,
    id?: string | null,
  ): ModelApprovalRecord {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    return {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
  }

  /**
   * Register an approval record and return a promise that resolves when the
   * decision is made. Registration is synchronous so callers can confirm the
   * id is valid before any response is sent.
   */
  register(record: ModelApprovalRecord, timeoutMs: number): Promise<ModelApprovalDecision | null> {
    const existing = this.pending.get(record.id);
    if (existing) {
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      throw new Error(`approval id '${record.id}' already resolved`);
    }
    let resolvePromise!: (decision: ModelApprovalDecision | null) => void;
    const promise = new Promise<ModelApprovalDecision | null>((resolve) => {
      resolvePromise = resolve;
    });
    const entry: PendingEntry = {
      record,
      resolve: resolvePromise,
      timer: null as unknown as ReturnType<typeof setTimeout>,
      promise,
    };
    entry.timer = setTimeout(() => {
      this.expire(record.id);
    }, timeoutMs);
    this.pending.set(record.id, entry);
    return promise;
  }

  resolve(recordId: string, decision: ModelApprovalDecision, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending || pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    pending.resolve(decision);
    this.scheduleCleanup(recordId, pending);
    return true;
  }

  expire(recordId: string, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending || pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = undefined;
    pending.record.resolvedBy = resolvedBy ?? null;
    pending.resolve(null);
    this.scheduleCleanup(recordId, pending);
    return true;
  }

  getSnapshot(recordId: string): ModelApprovalRecord | null {
    return this.pending.get(recordId)?.record ?? null;
  }

  /**
   * Wait for a decision on an already-registered approval.
   * Returns null when the id is unknown or already cleaned up.
   */
  awaitDecision(recordId: string): Promise<ModelApprovalDecision | null> | null {
    return this.pending.get(recordId)?.promise ?? null;
  }

  lookupPendingId(input: string): ModelApprovalIdLookupResult {
    const normalized = input.trim();
    if (!normalized) {
      return { kind: "none" };
    }
    const exact = this.pending.get(normalized);
    if (exact) {
      return exact.record.resolvedAtMs === undefined
        ? { kind: "exact", id: normalized }
        : { kind: "none" };
    }
    const lowerPrefix = normalized.toLowerCase();
    const matches: string[] = [];
    for (const [id, entry] of this.pending.entries()) {
      if (entry.record.resolvedAtMs !== undefined) {
        continue;
      }
      if (id.toLowerCase().startsWith(lowerPrefix)) {
        matches.push(id);
      }
    }
    if (matches.length === 1) {
      return { kind: "prefix", id: matches[0] };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", ids: matches };
    }
    return { kind: "none" };
  }

  private scheduleCleanup(recordId: string, entry: PendingEntry): void {
    // Keep the resolved entry around briefly so in-flight waitDecision calls
    // can still observe the outcome.
    setTimeout(() => {
      if (this.pending.get(recordId) === entry) {
        this.pending.delete(recordId);
      }
    }, RESOLVED_ENTRY_GRACE_MS);
  }
}
