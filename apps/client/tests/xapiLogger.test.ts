/**
 * Offline write-path test: every interaction lands in `xapi_queue` as
 * `pending` and progress can never regress once completed.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllData,
  countPending,
  getPendingStatements,
  getProgress,
} from '../src/db/client';
import {
  logCardViewed,
  logLessonCompleted,
  logLessonStarted,
  logQuestionAnswered,
  parseStatement,
} from '../src/sync/xapiLogger';

describe('offline xAPI write path', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('queues a lesson-started statement locally', async () => {
    await logLessonStarted('student-a', 'lesson-1', { now: 1_000 });
    expect(await countPending()).toBe(1);
    const [row] = await getPendingStatements(10);
    expect(row.status).toBe('pending');
    const stmt = parseStatement(row.statement_json);
    expect(stmt.verb.id).toBe('http://adlnet.gov/expapi/verbs/attempted');
    expect(stmt.actor.account.name).toBe('student-a');
  });

  it('grades answers locally and tracks furthest card', async () => {
    await logLessonStarted('student-a', 'lesson-1', { now: 1_000 });
    await logQuestionAnswered('student-a', 'lesson-1', 'q1', 'b', true, { now: 2_000 });
    await logCardViewed('student-a', 'lesson-1', 3, 1_500, { now: 3_000 });
    const progress = await getProgress('student-a', 'lesson-1');
    expect(progress?.completion_status).toBe('in_progress');
    expect(progress?.last_card_index).toBe(3);
    expect(progress?.time_on_task_ms).toBe(1_500);
  });

  it('completion is monotonic — it can never be downgraded', async () => {
    await logLessonCompleted('student-a', 'lesson-1', 0.8, { now: 10_000 });
    await logLessonStarted('student-a', 'lesson-1', { now: 20_000 });
    const progress = await getProgress('student-a', 'lesson-1');
    expect(progress?.completion_status).toBe('completed');
    expect(progress?.score).toBe(0.8);
  });
});
