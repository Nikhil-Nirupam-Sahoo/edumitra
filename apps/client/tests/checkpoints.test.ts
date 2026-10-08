/**
 * Client CRDT checkpoint tests — the registers the sync engine pushes.
 * These must mirror the server's merge semantics exactly, or multi-device
 * reconciliation diverges.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, getCheckpoints, mergeCheckpoints } from '../src/db/client';
import {
  buildCheckpointsFor,
  CHECKPOINT_KEYS,
  logCardViewed,
  logLessonCompleted,
  logLessonStarted,
  parseStatement,
  type XapiStatement,
} from '../src/sync/xapiLogger';

describe('buildCheckpointsFor', () => {
  const studentId = 'student-1';
  const lessonId = 'math-1';

  it('maps a lesson start to a completion.status put register', () => {
    const statement = {
      id: 's1',
      verb: { id: 'http://adlnet.gov/expapi/verbs/attempted', display: {} },
      object: { objectType: 'Activity', id: 'https://edumitra.org/activities/lesson/math-1' },
    } as unknown as XapiStatement;
    const [record] = buildCheckpointsFor(statement, studentId, lessonId, 1_000);
    expect(record).toMatchObject({
      key: CHECKPOINT_KEYS.completionStatus,
      value: 1,
      op: 'put',
      source_statement_id: 's1',
    });
  });

  it('maps completion to rank 2 and card views to a log-reading register', () => {
    const completion = {
      id: 'c1',
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed', display: {} },
      object: { objectType: 'Activity', id: 'https://edumitra.org/activities/lesson/math-1' },
    } as unknown as XapiStatement;
    expect(buildCheckpointsFor(completion, studentId, lessonId, 1_000)[0]).toMatchObject({
      value: 2,
      op: 'put',
    });

    const card = {
      id: 'v1',
      verb: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: {} },
      object: {
        objectType: 'Activity',
        id: 'https://edumitra.org/activities/lesson/math-1/card/3',
      },
    } as unknown as XapiStatement;
    expect(buildCheckpointsFor(card, studentId, lessonId, 1_000)[0]).toMatchObject({
      key: CHECKPOINT_KEYS.lastCard,
      value: 3,
      op: 'log-reading',
    });
  });

  it('emits nothing additive (time/counts are derived server-side)', () => {
    const card = {
      id: 'v1',
      verb: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: {} },
      object: {
        objectType: 'Activity',
        id: 'https://edumitra.org/activities/lesson/math-1/card/3',
      },
      result: { duration: 'PT1.500S' },
    } as unknown as XapiStatement;
    const keys = buildCheckpointsFor(card, studentId, lessonId, 1_000).map((r) => r.key);
    expect(keys).not.toContain(CHECKPOINT_KEYS.timeOnTaskMs);
  });
});

describe('local checkpoint merge', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('persists checkpoints as a side effect of logging events', async () => {
    await logLessonStarted('student-1', 'math-1', { now: 1_000 });
    const records = await getCheckpoints();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      key: CHECKPOINT_KEYS.completionStatus,
      value: 1,
      acknowledged: 0,
    });
  });

  it('completion can never be downgraded by a later start event', async () => {
    await logLessonCompleted('student-1', 'math-1', 0.9, { now: 1_000 });
    await logLessonStarted('student-1', 'math-1', { now: 2_000 });
    const records = await getCheckpoints();
    const completion = records.find((r) => r.key === CHECKPOINT_KEYS.completionStatus);
    // Value stays at the completed rank (2) even though start (rank 1) arrived later.
    expect(completion?.value).toBe(2);
  });

  it('keeps the furthest card ever reached', async () => {
    await logCardViewed('student-1', 'math-1', 5, 1_000, { now: 1_000 });
    await logCardViewed('student-1', 'math-1', 2, 1_000, { now: 2_000 });
    const records = await getCheckpoints();
    const card = records.find((r) => r.key === CHECKPOINT_KEYS.lastCard);
    expect(card?.value).toBe(5);
  });

  it('is deterministic regardless of merge order', async () => {
    const studentId = 'student-1';
    const lessonId = 'math-1';
    const start = parseStatement(
      JSON.stringify(await logLessonStarted(studentId, lessonId, { now: 1_000 })),
    );
    await clearAllData();
    const completed = parseStatement(
      JSON.stringify(await logLessonCompleted(studentId, lessonId, 0.7, { now: 2_000 })),
    );

    const startRegisters = buildCheckpointsFor(start, studentId, lessonId, 1_000);
    const completedRegisters = buildCheckpointsFor(completed, studentId, lessonId, 2_000);

    // Order A: start then complete.
    await clearAllData();
    await mergeCheckpoints(startRegisters.map((r) => ({ ...r, id: `${r.id}` })));
    await mergeCheckpoints(completedRegisters.map((r) => ({ ...r, id: `${r.id}` })));
    const orderA = (await getCheckpoints()).find(
      (r) => r.key === CHECKPOINT_KEYS.completionStatus,
    );

    // Order B: complete then start.
    await clearAllData();
    await mergeCheckpoints(completedRegisters.map((r) => ({ ...r, id: `${r.id}` })));
    await mergeCheckpoints(startRegisters.map((r) => ({ ...r, id: `${r.id}` })));
    const orderB = (await getCheckpoints()).find(
      (r) => r.key === CHECKPOINT_KEYS.completionStatus,
    );

    expect(orderA?.value).toBe(2);
    expect(orderB?.value).toBe(2);
  });
});
