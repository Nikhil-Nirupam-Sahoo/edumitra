/**
 * Conflict-free replicated data types for progress reconciliation.
 *
 * The register store is append-only from the client's perspective: every
 * inbound checkpoint is a candidate operation, and the merge below is a pure,
 * total-order function. Given the same set of operations in ANY order, all
 * replicas converge to identical state — the property that makes multi-day
 * offline periods safe (no overwrites, no lockouts, no lost attempts).
 *
 * Ordering rules:
 *  - put: Last-Writer-Wins by `(ts, sourceStatementId)`. `ts` is
 *    `max(clientTs, serverStoredAt)`, so a device with a badly skewed clock
 *    cannot mask genuinely newer data. Ties break on statement id.
 *  - log-reading: MONOTONIC MAX. The value can only ever increase, no matter
 *    what order operations arrive in or how stale a re-sending device is.
 *    This is what prevents "score overwrites" when two devices sync an old
 *    and a new snapshot in the wrong order. Timestamps still advance the
 *    register bookkeeping, but never at the cost of a lower value.
 *  - count-inc: additive registers dedupe by operation id (the statement that
 *    produced the increment). Concurrent devices each add their own deltas.
 */

export type CrdtOp = 'put' | 'log-reading' | 'count-inc';

export interface RegisterState {
  value: number;
  ts: number;
  op: CrdtOp;
  sourceStatementId: string;
}

export interface CheckpointInput {
  studentId: string;
  lessonId: string;
  key: string;
  value: number;
  ts: number;
  op: CrdtOp;
  sourceStatementId: string;
}

export type MergeDecision =
  | { applied: false; reason: 'stale' | 'duplicate'; state: RegisterState }
  | { applied: true; reason: 'new' | 'newer' | 'increment'; state: RegisterState };

/**
 * Total order over operations. Higher tuple wins.
 * Exposed for tests and for deterministic reasoning in service code.
 */
export function operationOrder(
  left: { ts: number; sourceStatementId: string },
  right: { ts: number; sourceStatementId: string },
): number {
  if (left.ts !== right.ts) return left.ts - right.ts;
  if (left.sourceStatementId === right.sourceStatementId) return 0;
  return left.sourceStatementId > right.sourceStatementId ? 1 : -1;
}

/**
 * Pure merge. `existing === undefined` means the register does not exist yet.
 * `storedAt` is the server receive time used to bound clock skew.
 */
export function mergeRegister(
  existing: RegisterState | undefined,
  incoming: CheckpointInput,
  storedAt: number,
): MergeDecision {
  const ts = Math.max(incoming.ts, storedAt);

  if (incoming.op === 'count-inc') {
    if (existing && existing.sourceStatementId === incoming.sourceStatementId) {
      // Re-delivery of the same increment: already counted.
      return { applied: false, reason: 'duplicate', state: existing };
    }
    const value = round6((existing?.value ?? 0) + incoming.value);
    const next: RegisterState = {
      value,
      ts: Math.max(ts, existing?.ts ?? 0),
      op: 'count-inc',
      sourceStatementId: incoming.sourceStatementId,
    };
    return { applied: true, reason: existing ? 'increment' : 'new', state: next };
  }

  if (incoming.op === 'log-reading') {
    // Monotonic max: a stale device can never lower a reading, and an old
    // operation never blocks a newer one from advancing the timestamp.
    if (existing && incoming.sourceStatementId === existing.sourceStatementId) {
      return { applied: false, reason: 'duplicate', state: existing };
    }
    const value = round6(Math.max(existing?.value ?? Number.NEGATIVE_INFINITY, incoming.value));
    const ts2 = Math.max(existing?.ts ?? 0, ts);
    if (existing && existing.value === value && existing.ts >= ts2) {
      return { applied: false, reason: 'stale', state: existing };
    }
    return {
      applied: true,
      reason: existing ? 'newer' : 'new',
      state: {
        value,
        ts: ts2,
        op: 'log-reading',
        sourceStatementId:
          existing && existing.value > incoming.value
            ? existing.sourceStatementId
            : incoming.sourceStatementId,
      },
    };
  }

  if (existing) {
    const order = operationOrder(incoming, existing);
    if (order < 0) return { applied: false, reason: 'stale', state: existing };
    if (order === 0) return { applied: false, reason: 'duplicate', state: existing };
  }

  return {
    applied: true,
    reason: existing ? 'newer' : 'new',
    state: {
      value: round6(incoming.value),
      ts,
      op: incoming.op,
      sourceStatementId: incoming.sourceStatementId,
    },
  };
}

/** Apply a count-inc dedupe ledger check before calling mergeRegister. */
export function isCountIncrementDuplicate(
  appliedOperationIds: ReadonlySet<string>,
  incoming: CheckpointInput,
): boolean {
  return incoming.op === 'count-inc' && appliedOperationIds.has(incoming.sourceStatementId);
}

function round6(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Canonical checkpoint keys + semantic mapping
// ---------------------------------------------------------------------------

export const PROGRESS_KEYS = {
  completionStatus: 'completion.status',
  score: 'score.scaled',
  lastCard: 'lesson.last_card',
  timeOnTaskMs: 'time_on_task.ms',
  quizAttempts: 'quiz.attempts',
  quizCorrect: 'quiz.correct',
} as const;

export const COMPLETION_RANK = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
} as const;

/** Numeric rank of a completion status (safe for unknown input). */
export function completionRank(status: string): number {
  return (COMPLETION_RANK as Record<string, number>)[status] ?? 0;
}

export function rankToCompletionStatus(rank: number): 'not_started' | 'in_progress' | 'completed' {
  if (rank >= 2) return 'completed';
  if (rank >= 1) return 'in_progress';
  return 'not_started';
}

/**
 * Projects the full register set for one (student, lesson) into the
 * denormalized head row returned by the state API and stored in progress_heads.
 */
export interface ProgressRegisterSnapshot {
  registers: Map<string, RegisterState>;
}

export interface ProjectedHead {
  completionStatus: 'not_started' | 'in_progress' | 'completed';
  score: number;
  lastCardIndex: number;
  timeOnTaskMs: number;
  latestTs: number;
  headStatementId: string;
}

export function projectHead(snapshot: ProgressRegisterSnapshot): ProjectedHead {
  const get = (key: string): RegisterState | undefined => snapshot.registers.get(key);
  const completionRank = get(PROGRESS_KEYS.completionStatus)?.value ?? 0;
  const score = get(PROGRESS_KEYS.score)?.value ?? -1;
  const lastCard = get(PROGRESS_KEYS.lastCard)?.value ?? 0;
  const timeOnTask = get(PROGRESS_KEYS.timeOnTaskMs)?.value ?? 0;

  let latestTs = 0;
  let headStatementId = '';
  for (const state of snapshot.registers.values()) {
    if (state.ts > latestTs || (state.ts === latestTs && state.sourceStatementId > headStatementId)) {
      latestTs = state.ts;
      headStatementId = state.sourceStatementId;
    }
  }

  return {
    completionStatus: rankToCompletionStatus(completionRank),
    score,
    lastCardIndex: Math.max(0, Math.round(lastCard)),
    timeOnTaskMs: Math.max(0, Math.round(timeOnTask)),
    latestTs,
    headStatementId,
  };
}
