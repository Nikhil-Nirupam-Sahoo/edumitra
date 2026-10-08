/**
 * Dashboard aggregation over the local IndexedDB cache: class summary,
 * struggling-student ranking, completion trend, and attendance derivation.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllData,
  getAttendanceByClassDay,
  mergeProgress,
  upsertStudents,
} from '../src/db/client';
import { getClassSummary, getCompletionTrend, getStrugglingStudents, listClasses } from '../src/db/queries';
import type { StudentRecord } from '../src/db/schema';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-07T12:00:00Z').getTime();

function student(id: string, classId: string): StudentRecord {
  return { id, name: id, class_id: classId, guardian_phone: null, created_at: NOW };
}

describe('db/queries (teacher dashboard)', () => {
  beforeEach(async () => {
    await clearAllData();
    await upsertStudents([
      student('asha', 'grade-5'),
      student('ravi', 'grade-5'),
      student('meena', 'grade-6'),
    ]);
  });

  it('aggregates class completion ratio, scores, and time-on-task', async () => {
    // asha: 2/2 completed, great scores
    await mergeProgress('asha', 'l1', { completion_status: 'completed', score: 0.9, time_on_task_ms: 60_000 }, NOW - 2 * DAY);
    await mergeProgress('asha', 'l2', { completion_status: 'completed', score: 0.8, time_on_task_ms: 30_000 }, NOW - 1 * DAY);
    // ravi: one started, failing, untouched for a while -> struggling
    await mergeProgress('ravi', 'l1', { completion_status: 'in_progress', score: 0.2, time_on_task_ms: 10_000 }, NOW - 10 * DAY);

    const summary = await getClassSummary('grade-5', { now: NOW });
    expect(summary.totalStudents).toBe(2);
    // per-student mean, averaged across students with any activity
    expect(summary.averageScore).toBeCloseTo(((0.9 + 0.8) / 2 + 0.2) / 2, 5);
    expect(summary.strugglingCount).toBe(1);
    expect(summary.totalTimeOnTaskMs).toBe(100_000);

    const asha = summary.students.find((s) => s.student.id === 'asha');
    expect(asha?.completionRatio).toBe(1);
    const ravi = summary.students.find((s) => s.student.id === 'ravi');
    expect(ravi?.completionRatio).toBe(0.5);
    expect(ravi?.struggling).toBe(true);
  });

  it('ranks struggling students by average score', async () => {
    await mergeProgress('asha', 'l1', { completion_status: 'in_progress', score: 0.4 }, NOW - 10 * DAY);
    await mergeProgress('ravi', 'l1', { completion_status: 'in_progress', score: 0.1 }, NOW - 10 * DAY);
    const struggling = await getStrugglingStudents('grade-5', 10, { now: NOW });
    expect(struggling.map((s) => s.student.id)).toEqual(['ravi', 'asha']);
  });

  it('counts daily completions in the trend window', async () => {
    await mergeProgress('asha', 'l1', { completion_status: 'completed', score: 1 }, NOW - 1 * DAY);
    await mergeProgress('asha', 'l2', { completion_status: 'completed', score: 1 }, NOW - 1 * DAY);
    await mergeProgress('ravi', 'l1', { completion_status: 'completed', score: 1 }, NOW - 3 * DAY);
    const trend = await getCompletionTrend('grade-5', 7, NOW);
    expect(trend).toHaveLength(7);
    expect(trend.reduce((sum, bucket) => sum + bucket.completions, 0)).toBe(3);
  });

  it('derives attendance only from real activity on that day', async () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    await mergeProgress('asha', 'l1', { completion_status: 'in_progress' }, NOW);
    await mergeProgress('ravi', 'l1', { completion_status: 'in_progress' }, NOW - 5 * DAY);
    const attendance = await getAttendanceByClassDay('grade-5', today);
    expect(attendance).toEqual([{ student_id: 'asha', present: 1 }]);
  });

  it('lists known class ids', async () => {
    expect(await listClasses()).toEqual(['grade-5', 'grade-6']);
  });
});
