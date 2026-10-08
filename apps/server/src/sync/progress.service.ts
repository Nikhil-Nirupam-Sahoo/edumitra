/**
 * CRDT progress register store.
 *
 * Design: `progress_state` holds one register per (student, lesson, key).
 * Writes use optimistic concurrency (compare-and-swap on `(ts, source_id)`)
 * with bounded retries, so merges are safe across concurrent requests and
 * multiple API instances without explicit row locks — portable across SQLite
 * and PostgreSQL.
 *
 * Additive registers (`count-inc`) are gated by the `checkpoint_applied`
 * ledger so a re-delivered increment is never double-counted, while genuinely
 * concurrent increments from two offline devices both land.
 *
 * `progress_heads` is a denormalized projection rebuilt after each touched
 * (student, lesson) so state bootstrap is a single indexed read.
 */

import { toNumber, type DbPort } from '../db/types.js';
import {
  COMPLETION_RANK,
  mergeRegister,
  projectHead,
  PROGRESS_KEYS,
  type CheckpointInput,
  type RegisterState,
} from './crdt.js';
import type { SyncCheckpoint, SyncStatement } from './schemas.js';
import { extractLessonId, extractStudentId } from './lrs.service.js';

const MAX_CAS_RETRIES = 6;

export interface ApplySummary {
  applied: number;
  duplicates: number;
  stale: number;
  touched: Map<string, { studentId: string; lessonId: string }>;
}

interface RegisterRow {
  student_id: string;
  lesson_id: string;
  key: string;
  value: unknown;
  ts: unknown;
  op: string;
  source_statement_id: string;
}

function rowToState(row: RegisterRow): RegisterState {
  return {
    value: toNumber(row.value),
    ts: toNumber(row.ts),
    op: row.op as RegisterState['op'],
    sourceStatementId: row.source_statement_id,
  };
}

export class ProgressService {
  constructor(private readonly db: DbPort) {}

  /**
   * Applies a batch of checkpoints. Idempotent: replaying the same batch is a
   * no-op (LWW dedupe / increment ledger).
   */
  async applyCheckpoints(
    checkpoints: readonly CheckpointInput[],
    storedAt = Date.now(),
  ): Promise<ApplySummary> {
    const summary: ApplySummary = {
      applied: 0,
      duplicates: 0,
      stale: 0,
      touched: new Map(),
    };
    if (checkpoints.length === 0) return summary;

    await this.db.transaction(async (tx) => {
      for (const checkpoint of checkpoints) {
        const outcome = await this.applyOne(tx, checkpoint, storedAt);
        if (outcome === 'applied') {
          summary.applied += 1;
          summary.touched.set(`${checkpoint.studentId}::${checkpoint.lessonId}`, {
            studentId: checkpoint.studentId,
            lessonId: checkpoint.lessonId,
          });
        } else {
          summary[outcome === 'stale' ? 'stale' : 'duplicates'] += 1;
        }
      }
    });

    return summary;
  }

  private async applyOne(
    tx: DbPort,
    checkpoint: CheckpointInput,
    storedAt: number,
  ): Promise<'applied' | 'duplicate' | 'stale'> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existingRow = await tx.queryOne<RegisterRow>(
        `SELECT * FROM progress_state WHERE student_id = ? AND lesson_id = ? AND key = ?`,
        [checkpoint.studentId, checkpoint.lessonId, checkpoint.key],
      );
      const existing = existingRow ? rowToState(existingRow) : undefined;

      // Additive registers: consult the dedupe ledger inside the transaction.
      if (checkpoint.op === 'count-inc') {
        const ledger = await tx.queryOne<{ source_statement_id: string }>(
          `SELECT source_statement_id FROM checkpoint_applied
            WHERE lesson_id = ? AND key = ? AND source_statement_id = ?`,
          [checkpoint.lessonId, checkpoint.key, checkpoint.sourceStatementId],
        );
        if (ledger) return 'duplicate';
      }

      const decision = mergeRegister(existing, checkpoint, storedAt);
      if (!decision.applied) {
        return decision.reason === 'duplicate' ? 'duplicate' : 'stale';
      }

      const next = decision.state;
      let changed: number;
      if (existing) {
        changed = await tx.execute(
          `UPDATE progress_state
              SET value = ?, ts = ?, op = ?, source_statement_id = ?, updated_at = ?
            WHERE student_id = ? AND lesson_id = ? AND key = ?
              AND ts = ? AND source_statement_id = ?`,
          [
            next.value,
            next.ts,
            next.op,
            next.sourceStatementId,
            storedAt,
            checkpoint.studentId,
            checkpoint.lessonId,
            checkpoint.key,
            existing.ts,
            existing.sourceStatementId,
          ],
        );
      } else {
        changed = await tx.execute(
          `INSERT INTO progress_state
             (student_id, lesson_id, key, value, ts, op, source_statement_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (student_id, lesson_id, key) DO NOTHING`,
          [
            checkpoint.studentId,
            checkpoint.lessonId,
            checkpoint.key,
            next.value,
            next.ts,
            next.op,
            next.sourceStatementId,
            storedAt,
          ],
        );
      }

      if (changed > 0) {
        if (checkpoint.op === 'count-inc') {
          await tx.execute(
            `INSERT INTO checkpoint_applied
               (student_id, lesson_id, key, source_statement_id, applied_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (lesson_id, key, source_statement_id) DO NOTHING`,
            [
              checkpoint.studentId,
              checkpoint.lessonId,
              checkpoint.key,
              checkpoint.sourceStatementId,
              storedAt,
            ],
          );
        }
        return 'applied';
      }
      // CAS lost a race: loop and re-merge against fresh state.
    }
    // Retries exhausted: concurrent writers keep winning. Report as duplicate
    // so the caller stays correct (the operation is not silently lost: the
    // client retains its statement until acknowledged and retries next sync).
    return 'duplicate';
  }

  /** Rebuilds the denormalized head for every touched (student, lesson). */
  async rebuildHeads(touched: ApplySummary['touched']): Promise<void> {
    if (touched.size === 0) return;
    await this.db.transaction(async (tx) => {
      for (const { studentId, lessonId } of touched.values()) {
        const registers = await this.loadRegisters(tx, studentId, lessonId);
        const head = projectHead({ registers });
        await tx.execute(
          `INSERT INTO progress_heads
             (student_id, lesson_id, completion_status, score, last_card_index,
              time_on_task_ms, latest_ts, head_statement_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (student_id, lesson_id) DO UPDATE SET
             completion_status = excluded.completion_status,
             score = excluded.score,
             last_card_index = excluded.last_card_index,
             time_on_task_ms = excluded.time_on_task_ms,
             latest_ts = excluded.latest_ts,
             head_statement_id = excluded.head_statement_id,
             updated_at = excluded.updated_at`,
          [
            studentId,
            lessonId,
            head.completionStatus,
            head.score,
            head.lastCardIndex,
            head.timeOnTaskMs,
            head.latestTs,
            head.headStatementId,
            Date.now(),
          ],
        );
      }
    });
  }

  async loadRegisters(
    db: DbPort,
    studentId: string,
    lessonId: string,
  ): Promise<Map<string, RegisterState>> {
    const rows = await db.query<RegisterRow>(
      `SELECT * FROM progress_state WHERE student_id = ? AND lesson_id = ?`,
      [studentId, lessonId],
    );
    return new Map(rows.map((row) => [row.key, rowToState(row)]));
  }

  /** Full state bootstrap for a student (cmi5 state endpoint). */
  async getStateForStudent(studentId: string): Promise<{
    heads: Array<{
      lessonId: string;
      completionStatus: string;
      score: number;
      lastCardIndex: number;
      timeOnTaskMs: number;
      latestTs: number;
    }>;
    registers: Array<{ lessonId: string; key: string; value: number; ts: number; op: string }>;
  }> {
    const headRows = await this.db.query<{
      lesson_id: string;
      completion_status: string;
      score: unknown;
      last_card_index: unknown;
      time_on_task_ms: unknown;
      latest_ts: unknown;
    }>(
      `SELECT lesson_id, completion_status, score, last_card_index, time_on_task_ms, latest_ts
         FROM progress_heads WHERE student_id = ? ORDER BY lesson_id ASC`,
      [studentId],
    );
    const registerRows = await this.db.query<RegisterRow>(
      `SELECT * FROM progress_state WHERE student_id = ? ORDER BY lesson_id ASC, key ASC`,
      [studentId],
    );
    return {
      heads: headRows.map((row) => ({
        lessonId: row.lesson_id,
        completionStatus: row.completion_status,
        score: toNumber(row.score, -1),
        lastCardIndex: toNumber(row.last_card_index),
        timeOnTaskMs: toNumber(row.time_on_task_ms),
        latestTs: toNumber(row.latest_ts),
      })),
      registers: registerRows.map((row) => ({
        lessonId: row.lesson_id,
        key: row.key,
        value: toNumber(row.value),
        ts: toNumber(row.ts),
        op: row.op,
      })),
    };
  }

  /** Monotonic revision used by the delta manifest. */
  async progressRevision(): Promise<number> {
    const row = await this.db.queryOne<{ revision: unknown }>(
      'SELECT MAX(updated_at) AS revision FROM progress_heads',
    );
    return toNumber(row?.revision);
  }
}

// ---------------------------------------------------------------------------
// Statement → checkpoint derivation
// ---------------------------------------------------------------------------

/**
 * Derives CRDT checkpoints from xAPI statements. Used as a fallback when a
 * batch does not carry explicit checkpoints for a given key, so progress is
 * never lost even for third-party clients that only speak xAPI.
 *
 * Idempotency: derived checkpoints use the statement id as their operation id.
 */
export function deriveCheckpoints(statements: readonly SyncStatement[]): CheckpointInput[] {
  const derived: CheckpointInput[] = [];
  for (const statement of statements) {
    const studentId = extractStudentId(statement);
    const lessonId = extractLessonId(statement);
    if (!studentId || !lessonId) continue;

    const base = {
      studentId,
      lessonId,
      ts: statementTimestamp(statement),
    };
    const sourceStatementId = statement.id;
    const verb = statement.verb.id;

    if (verb.endsWith('/attempted')) {
      derived.push({
        ...base,
        key: PROGRESS_KEYS.completionStatus,
        value: COMPLETION_RANK.in_progress,
        op: 'put',
        sourceStatementId,
      });
    }

    if (verb.endsWith('/answered')) {
      derived.push({
        ...base,
        key: PROGRESS_KEYS.quizAttempts,
        value: 1,
        op: 'count-inc',
        sourceStatementId: `${sourceStatementId}:attempts`,
      });
      const correct = statement.result?.success === true || statement.result?.score?.scaled === 1;
      derived.push({
        ...base,
        key: PROGRESS_KEYS.quizCorrect,
        value: correct ? 1 : 0,
        op: 'count-inc',
        sourceStatementId: `${sourceStatementId}:correct`,
      });
    }

    if (verb.endsWith('/experienced')) {
      const cardIndex = extractCardIndex(statement.object.id);
      if (cardIndex !== null) {
        derived.push({
          ...base,
          key: PROGRESS_KEYS.lastCard,
          value: cardIndex,
          op: 'log-reading',
          sourceStatementId,
        });
      }
      const dwellMs = parseIsoDurationMs(statement.result?.duration);
      if (dwellMs > 0) {
        derived.push({
          ...base,
          key: PROGRESS_KEYS.timeOnTaskMs,
          value: dwellMs,
          op: 'count-inc',
          sourceStatementId: `${sourceStatementId}:dwell`,
        });
      }
    }

    if (verb.endsWith('/completed')) {
      derived.push({
        ...base,
        key: PROGRESS_KEYS.completionStatus,
        value: COMPLETION_RANK.completed,
        op: 'put',
        sourceStatementId,
      });
      const scaled = statement.result?.score?.scaled;
      if (typeof scaled === 'number') {
        derived.push({
          ...base,
          key: PROGRESS_KEYS.score,
          value: scaled,
          op: 'log-reading',
          sourceStatementId,
        });
      }
    }
  }
  return derived;
}

/**
 * Drops derived checkpoints when the batch already carries an explicit
 * checkpoint for the same (student, lesson, key) — preventing double counting.
 */
export function filterDerived(
  derived: readonly CheckpointInput[],
  explicit: readonly SyncCheckpoint[],
): CheckpointInput[] {
  const covered = new Set(explicit.map((cp) => `${cp.studentId}::${cp.lessonId}::${cp.key}`));
  return derived.filter(
    (checkpoint) =>
      !covered.has(`${checkpoint.studentId}::${checkpoint.lessonId}::${checkpoint.key}`),
  );
}

function statementTimestamp(statement: SyncStatement): number {
  if (statement.timestamp) {
    const parsed = Date.parse(statement.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function extractCardIndex(objectId: string): number | null {
  const match = objectId.match(/\/card\/(\d+)(?:\/|$)/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** ISO 8601 duration → milliseconds. Returns 0 when unparseable. */
export function parseIsoDurationMs(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  const ms =
    Number(days ?? 0) * 86_400_000 +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1_000;
  return Number.isFinite(ms) ? Math.round(ms) : 0;
}

export function toCheckpointInput(checkpoint: SyncCheckpoint): CheckpointInput {
  return {
    studentId: checkpoint.studentId,
    lessonId: checkpoint.lessonId,
    key: checkpoint.key,
    value: checkpoint.value,
    ts: checkpoint.ts,
    op: checkpoint.op,
    sourceStatementId: checkpoint.sourceStatementId,
  };
}
