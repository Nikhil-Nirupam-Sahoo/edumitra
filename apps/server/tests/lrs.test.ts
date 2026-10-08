/**
 * xAPI LRS service tests — the store-level guarantees:
 *  - idempotent append (offline refetch storms can't double-count)
 *  - deterministic derivation of lesson/student from statement payloads
 *  - retention purge writes tombstones that clients can use as cleanup cursors
 *  - batched operations are transactional (a poison row can't abort a batch)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/index.js';
import type { DbPort } from '../src/db/types.js';
import { loadConfig } from '../src/config.js';
import { LrsService } from '../src/sync/lrs.service.js';
import { deriveCheckpoints, filterDerived } from '../src/sync/progress.service.js';
import { PROGRESS_KEYS } from '../src/sync/crdt.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DB_DRIVER: 'dev',
  SYNC_SIGNING_SECRET: 'test-secret-at-least-16-chars',
} as NodeJS.ProcessEnv);

function statement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stmt-1',
    actor: { objectType: 'Agent' as const, account: { homePage: 'https://edumitra.org', name: 'student-1' } },
    verb: { id: 'http://adlnet.gov/expapi/verbs/attempted', display: { 'en-US': 'attempted' } },
    object: { objectType: 'Activity' as const, id: 'https://edumitra.org/activities/lesson/math-1' },
    timestamp: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
}

describe('LrsService', () => {
  let db: DbPort;
  let lrs: LrsService;

  beforeEach(async () => {
    db = await createDatabase(config);
    lrs = new LrsService(db);
  });

  it('appends statements and reports duplicates on replay', async () => {
    const first = await lrs.appendStatements([statement()], 'device-1', 1_000);
    expect(first).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });

    const replay = await lrs.appendStatements([statement()], 'device-1', 2_000);
    expect(replay).toMatchObject({ accepted: 0, duplicates: 1, rejected: 0 });
    expect(await lrs.countStatements()).toBe(1);
  });

  it('rejects unattributable statements without aborting the batch', async () => {
    const good = statement({ id: 'ok-1' });
    const bad = statement({ id: 'bad-1', actor: {} });
    const result = await lrs.appendStatements([bad as never, good], 'device-1', 1_000);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.rejectedIds).toEqual(['bad-1']);
    expect(await lrs.countStatements()).toBe(1);
  });

  it('extracts the lesson id from lesson, question, and card activity ids', async () => {
    const rows = [
      statement({ id: 'a', object: { objectType: 'Activity', id: 'https://edumitra.org/activities/lesson/math-1' } }),
      statement({
        id: 'b',
        object: { objectType: 'Activity', id: 'https://edumitra.org/activities/question/math-1/q1' },
      }),
      statement({
        id: 'c',
        object: { objectType: 'Activity', id: 'https://edumitra.org/activities/lesson/math-1/card/3' },
      }),
    ];
    await lrs.appendStatements(rows as never[], 'device-1', 1_000);
    const stored = await lrs.queryStatements({ studentId: 'student-1', limit: 10 });
    expect(stored.map((row) => row.lesson_id)).toEqual(['math-1', 'math-1', 'math-1']);
  });

  it('purges expired statements and exposes tombstones as a cruft cursor', async () => {
    const old = statement({ id: 'old-1', timestamp: new Date(1_000).toISOString() });
    const fresh = statement({ id: 'fresh-1', timestamp: new Date(9_000_000_000_000).toISOString() });
    await lrs.appendStatements([old as never], 'device-1', 1_000);
    await lrs.appendStatements([fresh as never], 'device-2', 9_000_000_000_000);

    const purged = await lrs.purgeExpired(90, 9_000_000_000_000);
    expect(purged).toBe(1);
    expect(await lrs.countStatements()).toBe(1);

    const cruft = await lrs.listCruft(0);
    expect(cruft.items.map((item) => item.statementId)).toEqual(['old-1']);
    expect(cruft.latest).toBe(9_000_000_000_000);
  });

  it('orders queries by timestamp and respects since/limit', async () => {
    await lrs.appendStatements(
      [
        statement({ id: 's1', timestamp: new Date(1_000).toISOString() }),
        statement({ id: 's2', timestamp: new Date(2_000).toISOString() }),
        statement({ id: 's3', timestamp: new Date(3_000).toISOString() }),
      ] as never[],
      'device-1',
      10_000,
    );
    const all = await lrs.queryStatements({ studentId: 'student-1', limit: 10 });
    expect(all.map((row) => row.id)).toEqual(['s1', 's2', 's3']);
    const sinceSecond = await lrs.queryStatements({ studentId: 'student-1', since: 2_000, limit: 10 });
    expect(sinceSecond.map((row) => row.id)).toEqual(['s3']);
    const limited = await lrs.queryStatements({ studentId: 'student-1', limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('excludes the requesting device from pull queries', async () => {
    await lrs.appendStatements([statement({ id: 'mine' })], 'device-a', 1_000);
    await lrs.appendStatements([statement({ id: 'theirs' })], 'device-b', 2_000);
    const pulled = await lrs.queryStatements({ excludeDeviceId: 'device-a', limit: 10 });
    expect(pulled.map((row) => row.id)).toEqual(['theirs']);
  });
});

describe('checkpoint derivation from xAPI statements', () => {
  it('maps attempted/answered/completed verbs into canonical registers', () => {
    const derived = deriveCheckpoints([
      statement() as never,
      statement({
        id: 'q1',
        verb: { id: 'http://adlnet.gov/expapi/verbs/answered', display: { 'en-US': 'answered' } },
        object: { objectType: 'Activity', id: 'https://edumitra.org/activities/question/math-1/q1' },
        result: { success: true, score: { scaled: 1 } },
      }) as never,
      statement({
        id: 'done',
        verb: { id: 'http://adlnet.gov/expapi/verbs/completed', display: { 'en-US': 'completed' } },
        result: { completion: true, score: { scaled: 0.75 } },
      }) as never,
    ]);

    const byKey = new Map(derived.map((cp) => [cp.key, cp]));
    expect(byKey.get(PROGRESS_KEYS.completionStatus)?.op).toBe('put');
    expect(byKey.get(PROGRESS_KEYS.completionStatus)?.value).toBe(2); // completed wins (later puts applied in order)
    expect(byKey.get(PROGRESS_KEYS.quizAttempts)?.op).toBe('count-inc');
    expect(byKey.get(PROGRESS_KEYS.quizCorrect)?.value).toBe(1);
    expect(byKey.get(PROGRESS_KEYS.score)?.value).toBe(0.75);
  });

  it('drops derived checkpoints when the client sent explicit ones for the same key', () => {
    const derived = deriveCheckpoints([statement() as never]);
    const filtered = filterDerived(derived, [
      {
        studentId: 'student-1',
        lessonId: 'math-1',
        key: PROGRESS_KEYS.completionStatus,
        value: 1,
        ts: 1_000,
        op: 'put',
        sourceStatementId: 'client-1',
      },
    ]);
    expect(filtered.find((cp) => cp.key === PROGRESS_KEYS.completionStatus)).toBeUndefined();
  });
});
