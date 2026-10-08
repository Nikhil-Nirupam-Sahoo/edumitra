/**
 * SyncService — the orchestrator behind POST /api/v1/sync/progress.
 *
 * Pipeline per batch:
 *   1. Persist statements into the LRS (idempotent by statement id).
 *   2. Merge explicit CRDT checkpoints; derive checkpoints from statements
 *      for keys the batch did not cover (so no client can lose progress).
 *   3. Rebuild denormalized heads for touched lessons.
 *   4. Return counts + a delta pull for the requesting device.
 *
 * `appendStatements` and `applyCheckpoints` each manage their own transaction
 * so a poison statement cannot roll back an entire multi-day backlog.
 */

import type { LoadedConfig } from '../config.js';
import type { DbPort } from '../db/types.js';
import { LrsService, type StoredStatement } from './lrs.service.js';
import {
  deriveCheckpoints,
  filterDerived,
  ProgressService,
  toCheckpointInput,
} from './progress.service.js';
import type { SyncRequest } from './schemas.js';

export interface SyncIngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  nextCheckpoint: number;
  serverTime: number;
  pull: {
    statements: unknown[];
    checkpoints: Array<{
      id: string;
      studentId: string;
      lessonId: string;
      key: string;
      value: number;
      ts: number;
      op: 'put' | 'log-reading' | 'count-inc';
      sourceStatementId: string;
    }>;
    hasMore: boolean;
  };
}

export class SyncService {
  readonly lrs: LrsService;
  readonly progress: ProgressService;

  constructor(
    private readonly db: DbPort,
    private readonly config: LoadedConfig,
  ) {
    this.lrs = new LrsService(db);
    this.progress = new ProgressService(db);
  }

  async handleProgressSync(
    request: SyncRequest,
    deviceId: string,
    storedAt = Date.now(),
  ): Promise<SyncIngestResult> {
    // 1. LRS append ---------------------------------------------------------
    const maxBatch = this.config.sync.maxBatch;
    const statements = request.statements.slice(0, maxBatch);
    const append = await this.lrs.appendStatements(statements, deviceId, storedAt);

    // 2. CRDT merge ----------------------------------------------------------
    const explicit = request.checkpoints.map(toCheckpointInput);
    const derived = filterDerived(deriveCheckpoints(statements), request.checkpoints);
    const merge = await this.progress.applyCheckpoints([...explicit, ...derived], storedAt);

    // 3. Rebuild heads --------------------------------------------------------
    await this.progress.rebuildHeads(merge.touched);

    // 4. Bookkeeping + delta pull ---------------------------------------------
    await this.lrs.touchDeviceCursor(deviceId, storedAt);
    const cursor = await this.lrs.getDeviceCursor(deviceId);
    const pull = await this.pullDelta(deviceId, cursor.lastStatementTs);

    if (pull.latestTs !== null && pull.latestTs > cursor.lastStatementTs) {
      await this.lrs.setDeviceCursor(deviceId, pull.latestTs, storedAt);
    }

    await this.lrs.recordBatch({
      deviceId,
      statementCount: request.statements.length,
      accepted: append.accepted,
      duplicates: append.duplicates,
      rejected: append.rejected,
      now: storedAt,
    });

    return {
      accepted: append.accepted,
      duplicates: append.duplicates,
      rejected: append.rejected,
      nextCheckpoint: storedAt,
      serverTime: storedAt,
      pull: {
        statements: pull.statements,
        checkpoints: pull.checkpoints,
        hasMore: pull.hasMore,
      },
    };
  }

  /**
   * Delta pull: statements this device has not seen (other handsets, teacher
   * corrections) plus the CRDT registers for the lessons involved so the
   * client cache converges without replaying history.
   */
  private async pullDelta(
    deviceId: string,
    since: number,
  ): Promise<{
    statements: unknown[];
    checkpoints: SyncIngestResult['pull']['checkpoints'];
    hasMore: boolean;
    latestTs: number | null;
  }> {
    const limit = 200;
    const stored: StoredStatement[] = await this.lrs.queryStatements({
      since,
      limit: limit + 1,
      excludeDeviceId: deviceId,
    });
    const hasMore = stored.length > limit;
    const page = hasMore ? stored.slice(0, limit) : stored;
    const latestTs = page.length > 0 ? page[page.length - 1]!.timestamp_ms : null;

    // Registers for the lessons present in this page.
    const lessons = new Map<string, Set<string>>();
    for (const row of page) {
      const studentId = row.student_id;
      const lessonId = row.lesson_id;
      if (!lessonId) continue;
      const bucket = lessons.get(studentId) ?? new Set<string>();
      bucket.add(lessonId);
      lessons.set(studentId, bucket);
    }

    const checkpoints: SyncIngestResult['pull']['checkpoints'] = [];
    for (const [studentId, lessonIds] of lessons) {
      for (const lessonId of lessonIds) {
        const registers = await this.progress.loadRegisters(this.db, studentId, lessonId);
        for (const [key, state] of registers) {
          checkpoints.push({
            id: `${studentId}::${lessonId}::${key}`,
            studentId,
            lessonId,
            key,
            value: state.value,
            ts: state.ts,
            op: state.op,
            sourceStatementId: state.sourceStatementId,
          });
        }
      }
    }

    return {
      statements: page.map((row) => safeParseJson(row.statement_json)),
      checkpoints,
      hasMore,
      latestTs,
    };
  }

  /** Manifest for clients deciding whether to run a delta sync. */
  async getManifest(deviceId: string): Promise<{
    serverTime: number;
    statementCount: number;
    progressRevision: number;
    device: { lastSeenAt: number; lastStatementTs: number };
  }> {
    const [statementCount, progressRevision, device] = await Promise.all([
      this.lrs.countStatements(),
      this.progress.progressRevision(),
      this.lrs.getDeviceCursor(deviceId),
    ]);
    return {
      serverTime: Date.now(),
      statementCount,
      progressRevision,
      device,
    };
  }

  /** Retention job — invoked by the queue on an interval. */
  async runRetention(now = Date.now()): Promise<number> {
    return this.lrs.purgeExpired(this.config.sync.retentionDays, now);
  }
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}
