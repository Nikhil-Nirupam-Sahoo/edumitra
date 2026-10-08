/**
 * LRS (Learning Record Store) repository.
 *
 * Owns the `xapi_statements` table: idempotent append, query, retention purge
 * and tombstone listing. Statements are immutable once stored — corrections
 * arrive as NEW statements, which is what makes the log CRDT-safe.
 *
 * This layer is the seam for swapping in a commercial LRS (Learning Locker,
 * Grasshopper, …): reimplement `appendStatements`/`queryStatements` and the
 * sync service keeps working unchanged.
 */

import { randomUUID } from 'node:crypto';
import { toNumber, type DbPort } from '../db/types.js';
import type { SyncStatement } from './schemas.js';

export interface StoredStatement {
  id: string;
  student_id: string;
  lesson_id: string | null;
  verb: string;
  statement_json: string;
  timestamp_ms: number;
  stored_at_ms: number;
  device_id: string | null;
}

export interface AppendResult {
  accepted: number;
  duplicates: number;
  /** Statements that could not be attributed to a student actor. */
  rejected: number;
  acceptedIds: string[];
  rejectedIds: string[];
}

export interface StatementQuery {
  studentId?: string;
  lessonId?: string;
  verb?: string;
  since?: number;
  limit?: number;
  /** Exclude statements that originated from this device (pull calls). */
  excludeDeviceId?: string;
}

export function extractStudentId(statement: SyncStatement): string | null {
  const actor = statement.actor as {
    account?: { name?: string };
    mbox?: string;
    name?: string;
  };
  if (actor.account?.name) return actor.account.name;
  if (actor.mbox) return actor.mbox.replace(/^mailto:/, '');
  return actor.name ?? null;
}

const QUESTION_ACTIVITY_MARKER = '/activities/question/';

export function extractLessonId(statement: SyncStatement): string | null {
  const objectId = statement.object.id;
  // .../activities/lesson/{lessonId} or .../activities/question/{lessonId}/{qid}
  const lessonMatch = objectId.match(/\/activities\/lesson\/([^/]+)/);
  if (lessonMatch?.[1]) {
    return decodeURIComponent(lessonMatch[1]);
  }
  if (objectId.includes(QUESTION_ACTIVITY_MARKER)) {
    const after = objectId.slice(objectId.indexOf(QUESTION_ACTIVITY_MARKER) + QUESTION_ACTIVITY_MARKER.length);
    const [lessonPart] = after.split('/');
    if (lessonPart) return decodeURIComponent(lessonPart);
  }
  // Card activities: .../activities/lesson/{lessonId}/card/{n}
  const cardMatch = objectId.match(/\/activities\/lesson\/([^/]+)\/card\//);
  if (cardMatch?.[1]) return decodeURIComponent(cardMatch[1]);
  return null;
}

export function extractClientTimestamp(statement: SyncStatement): number {
  if (statement.timestamp) {
    const parsed = Date.parse(statement.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export class LrsService {
  constructor(private readonly db: DbPort) {}

  /**
   * Idempotent bulk append. Duplicate ids are counted, never re-written or
   * double-counted — the core guarantee for offline refetch storms.
   */
  async appendStatements(
    statements: readonly SyncStatement[],
    deviceId: string,
    storedAt = Date.now(),
  ): Promise<AppendResult> {
    if (statements.length === 0) {
      return { accepted: 0, duplicates: 0, rejected: 0, acceptedIds: [], rejectedIds: [] };
    }

    const acceptedIds: string[] = [];
    const rejectedIds: string[] = [];
    let duplicates = 0;

    await this.db.transaction(async (tx) => {
      for (const statement of statements) {
        const studentId = extractStudentId(statement);
        if (!studentId) {
          // Un-attributable statements cannot feed progress; surface them as
          // rejected so the client (and metrics) can see them explicitly.
          rejectedIds.push(statement.id);
          continue;
        }
        const row: StoredStatement = {
          id: statement.id,
          student_id: studentId,
          lesson_id: extractLessonId(statement),
          verb: statement.verb.id,
          statement_json: JSON.stringify(statement),
          timestamp_ms: extractClientTimestamp(statement),
          stored_at_ms: storedAt,
          device_id: deviceId,
        };
        const inserted = await tx.execute(
          `INSERT INTO xapi_statements
             (id, student_id, lesson_id, verb, statement_json, timestamp_ms, stored_at_ms, device_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            row.student_id,
            row.lesson_id,
            row.verb,
            row.statement_json,
            row.timestamp_ms,
            row.stored_at_ms,
            row.device_id,
          ],
        );
        if (inserted > 0) {
          acceptedIds.push(statement.id);
        } else {
          duplicates += 1;
        }
      }
    });

    return { accepted: acceptedIds.length, duplicates, rejected: rejectedIds.length, acceptedIds, rejectedIds };
  }

  async queryStatements(query: StatementQuery): Promise<StoredStatement[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.studentId) {
      clauses.push('student_id = ?');
      params.push(query.studentId);
    }
    if (query.lessonId) {
      clauses.push('lesson_id = ?');
      params.push(query.lessonId);
    }
    if (query.verb) {
      clauses.push('verb = ?');
      params.push(query.verb);
    }
    if (query.since !== undefined) {
      clauses.push('timestamp_ms > ?');
      params.push(query.since);
    }
    if (query.excludeDeviceId) {
      clauses.push('(device_id IS NULL OR device_id != ?)');
      params.push(query.excludeDeviceId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(query.limit ?? 100, 1_000);
    const rows = await this.db.query<StoredStatement>(
      `SELECT * FROM xapi_statements ${where} ORDER BY timestamp_ms ASC, id ASC LIMIT ?`,
      [...params, limit],
    );
    return rows;
  }

  async countStatements(): Promise<number> {
    const row = await this.db.queryOne<{ total: unknown }>(
      'SELECT COUNT(*) AS total FROM xapi_statements',
    );
    return toNumber(row?.total);
  }

  async countSince(since: number): Promise<number> {
    const row = await this.db.queryOne<{ total: unknown }>(
      'SELECT COUNT(*) AS total FROM xapi_statements WHERE stored_at_ms > ?',
      [since],
    );
    return toNumber(row?.total);
  }

  /**
   * Retention: removes statements older than the cutoff and records a
   * tombstone for each so offline devices can drop their local copies.
   */
  async purgeExpired(retentionDays: number, now = Date.now()): Promise<number> {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    return this.db.transaction(async (tx) => {
      const expired = await tx.query<{ id: string; device_id: string | null }>(
        'SELECT id, device_id FROM xapi_statements WHERE stored_at_ms < ? LIMIT 5000',
        [cutoff],
      );
      for (const row of expired) {
        await tx.execute(
          `INSERT INTO purged_tombstones (statement_id, purged_at, device_id)
           VALUES (?, ?, ?)
           ON CONFLICT (statement_id) DO NOTHING`,
          [row.id, now, row.device_id],
        );
      }
      if (expired.length === 0) return 0;
      const removed = await tx.execute(
        'DELETE FROM xapi_statements WHERE stored_at_ms < ?',
        [cutoff],
      );
      return removed;
    });
  }

  /** Tombstones purged after `since`; `latest` is the client's next cursor. */
  async listCruft(
    since: number,
    limit = 1_000,
  ): Promise<{ items: Array<{ statementId: string; purgedAt: number }>; latest: number }> {
    const rows = await this.db.query<{ statement_id: string; purged_at: unknown }>(
      'SELECT statement_id, purged_at FROM purged_tombstones WHERE purged_at > ? ORDER BY purged_at ASC LIMIT ?',
      [since, limit],
    );
    const items = rows.map((row) => ({
      statementId: row.statement_id,
      purgedAt: toNumber(row.purged_at),
    }));
    const latest = items.length > 0 ? items[items.length - 1]!.purgedAt : since;
    return { items, latest };
  }

  async recordBatch(batch: {
    batchId?: string;
    deviceId: string;
    statementCount: number;
    accepted: number;
    duplicates: number;
    rejected: number;
    now?: number;
  }): Promise<void> {
    const now = batch.now ?? Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO sync_batches
           (batch_id, device_id, received_at, statement_count, accepted, duplicates, rejected)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          batch.batchId ?? randomUUID(),
          batch.deviceId,
          now,
          batch.statementCount,
          batch.accepted,
          batch.duplicates,
          batch.rejected,
        ],
      );
      await tx.execute(
        `INSERT INTO sync_metrics_daily
           (day, device_id, statements_ingested, statements_duplicate, statements_rejected, batches)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (day, device_id) DO UPDATE SET
           statements_ingested = sync_metrics_daily.statements_ingested + excluded.statements_ingested,
           statements_duplicate = sync_metrics_daily.statements_duplicate + excluded.statements_duplicate,
           statements_rejected = sync_metrics_daily.statements_rejected + excluded.statements_rejected,
           batches = sync_metrics_daily.batches + 1`,
        [day, batch.deviceId, batch.accepted, batch.duplicates, batch.rejected],
      );
    });
  }

  async touchDeviceCursor(deviceId: string, now = Date.now()): Promise<void> {
    await this.db.execute(
      `INSERT INTO device_cursors (device_id, last_seen_at, last_statement_ts)
       VALUES (?, ?, 0)
       ON CONFLICT (device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [deviceId, now],
    );
  }

  async getDeviceCursor(deviceId: string): Promise<{ lastSeenAt: number; lastStatementTs: number }> {
    const row = await this.db.queryOne<{ last_seen_at: unknown; last_statement_ts: unknown }>(
      'SELECT last_seen_at, last_statement_ts FROM device_cursors WHERE device_id = ?',
      [deviceId],
    );
    return {
      lastSeenAt: toNumber(row?.last_seen_at),
      lastStatementTs: toNumber(row?.last_statement_ts),
    };
  }

  async setDeviceCursor(deviceId: string, lastStatementTs: number, now = Date.now()): Promise<void> {
    await this.db.execute(
      `INSERT INTO device_cursors (device_id, last_seen_at, last_statement_ts)
       VALUES (?, ?, ?)
       ON CONFLICT (device_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         last_statement_ts = excluded.last_statement_ts`,
      [deviceId, now, lastStatementTs],
    );
  }
}
