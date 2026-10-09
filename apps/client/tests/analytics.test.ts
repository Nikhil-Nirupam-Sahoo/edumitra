/**
 * Analytics tests.
 *
 * The trap guarded here: `score` is -1 until a student has a graded
 * interaction. Averaging that in drags every subject below zero and makes a
 * student who has only just started look worse than one who genuinely scored
 * 0%. The -1 rows must be excluded from means, and flagged rather than
 * silently treated as a zero.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendXpEvents,
  clearAllData,
  mergeProgress,
  upsertLessons,
  upsertStudents,
} from '../src/db/client';
import { getClassMastery, getStudentAnalytics } from '../src/db/analytics';
import type { LessonRecord, XpEvent } from '../src/db/schema';

const NOW = Date.UTC(2026, 2, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function lesson(id: string, subject: string, title: string): LessonRecord {
  return {
    id,
    title,
    language: 'en',
    version: 1,
    updated_at: 0,
    grade: 8,
    subject: subject as LessonRecord['subject'],
    content_json: JSON.stringify({ cards: [] }),
  };
}

const LESSONS = [
  lesson('l-math-1', 'math', 'Linear Equations'),
  lesson('l-math-2', 'math', 'Mensuration'),
  lesson('l-sci-1', 'science', 'Force and Pressure'),
  lesson('l-sci-2', 'science', 'Combustion'),
];

async function seed(): Promise<void> {
  await clearAllData();
  await upsertStudents([
    { id: 'stu-1', name: 'Aarav', class_id: 'class-8-a', guardian_phone: null, created_at: 0 },
    { id: 'stu-2', name: 'Priya', class_id: 'class-8-a', guardian_phone: null, created_at: 0 },
    { id: 'stu-9', name: 'Other class', class_id: 'class-9-a', guardian_phone: null, created_at: 0 },
  ]);
  await upsertLessons(LESSONS);
}

/**
 * Writes progress through the real merge function so the tests exercise the
 * same invariant the app relies on (score = -1 until graded).
 */
async function putProgress(
  studentId: string,
  rows: Array<{ lesson_id: string; score: number; completion_status: 'not_started' | 'in_progress' | 'completed'; updated_at: number; time_on_task_ms?: number }>,
): Promise<void> {
  for (const row of rows) {
    await mergeProgress(
      studentId,
      row.lesson_id,
      {
        score: row.score,
        completion_status: row.completion_status,
        time_on_task_ms: row.time_on_task_ms ?? 0,
      },
      row.updated_at,
    );
  }
}

describe('getStudentAnalytics', () => {
  beforeEach(seed);

  it('returns null for a student who does not exist locally', async () => {
    expect(await getStudentAnalytics('nobody', { now: NOW })).toBeNull();
  });

  it('excludes ungraded rows (-1) from the average score', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 1, completion_status: 'completed', updated_at: NOW - 4 * DAY },
      { lesson_id: 'l-math-2', score: 0, completion_status: 'completed', updated_at: NOW - 3 * DAY },
      // Started but never graded — must not drag the mean below 0%.
      { lesson_id: 'l-sci-1', score: -1, completion_status: 'in_progress', updated_at: NOW - 2 * DAY },
    ]);

    const data = await getStudentAnalytics('stu-1', { now: NOW });
    expect(data).not.toBeNull();
    expect(data!.lessonsStarted).toBe(3);
    // Mean of 1 and 0 only.
    expect(data!.averageScore).toBeCloseTo(0.5);
  });

  it('marks chapters with no grade so they can be shown differently', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 0.8, completion_status: 'completed', updated_at: NOW - DAY },
      { lesson_id: 'l-sci-1', score: -1, completion_status: 'in_progress', updated_at: NOW - DAY },
    ]);
    const data = (await getStudentAnalytics('stu-1', { now: NOW }))!;
    const math = data.weakestChapters.concat(data.strongestChapters).find((c) => c.lessonId === 'l-sci-1');
    // An ungraded chapter is not "weak" — it is simply unknown.
    expect(math).toBeUndefined();
  });

  it('computes per-subject mastery, weakest first', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 0.9, completion_status: 'completed', updated_at: NOW - 3 * DAY },
      { lesson_id: 'l-math-2', score: 0.7, completion_status: 'completed', updated_at: NOW - 2 * DAY },
      { lesson_id: 'l-sci-1', score: 0.3, completion_status: 'in_progress', updated_at: NOW - 1 * DAY },
      { lesson_id: 'l-sci-2', score: 0.5, completion_status: 'in_progress', updated_at: NOW },
    ]);
    const data = (await getStudentAnalytics('stu-1', { now: NOW }))!;

    expect(data.masteryBySubject.map((s) => s.subject)).toEqual(['science', 'math']);
    expect(data.masteryBySubject[0]!.mastery).toBeCloseTo(0.4);
    expect(data.masteryBySubject[1]!.mastery).toBeCloseTo(0.8);
  });

  it('lists the weakest chapters first for reteaching', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 0.9, completion_status: 'completed', updated_at: NOW - 4 * DAY },
      { lesson_id: 'l-math-2', score: 0.2, completion_status: 'in_progress', updated_at: NOW - 3 * DAY },
      { lesson_id: 'l-sci-1', score: 0.4, completion_status: 'in_progress', updated_at: NOW - 2 * DAY },
      { lesson_id: 'l-sci-2', score: 1, completion_status: 'completed', updated_at: NOW - 1 * DAY },
    ]);
    const data = (await getStudentAnalytics('stu-1', { now: NOW }))!;
    expect(data.weakestChapters[0]!.lessonId).toBe('l-math-2');
    expect(data.strongestChapters[0]!.lessonId).toBe('l-sci-2');
  });

  it('builds a score trend in chronological order', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-2', score: 0.3, completion_status: 'in_progress', updated_at: NOW - 3 * DAY },
      { lesson_id: 'l-sci-1', score: 0.5, completion_status: 'in_progress', updated_at: NOW - 2 * DAY },
      { lesson_id: 'l-math-1', score: 0.9, completion_status: 'completed', updated_at: NOW - 1 * DAY },
    ]);
    const data = (await getStudentAnalytics('stu-1', { now: NOW }))!;
    expect(data.scoreTrend.map((p) => p.value)).toEqual([0.3, 0.5, 0.9]);
  });

  it('reports an activity heatmap with no gaps', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 0.5, completion_status: 'in_progress', updated_at: NOW - 2 * DAY },
    ]);
    const data = (await getStudentAnalytics('stu-1', { now: NOW, heatDays: 14 }))!;
    expect(data.activity).toHaveLength(14);
    expect(data.activity.filter((d) => d.value > 0)).toHaveLength(1);
  });

  it('reports how long since the student was last seen', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 0.5, completion_status: 'in_progress', updated_at: NOW - 5 * DAY },
    ]);
    const data = (await getStudentAnalytics('stu-1', { now: NOW }))!;
    expect(data.daysSinceActivity).toBe(5);
  });

  it('reports null inactivity for a student with no progress at all', async () => {
    const data = (await getStudentAnalytics('stu-2', { now: NOW }))!;
    expect(data.daysSinceActivity).toBeNull();
    expect(data.lessonsStarted).toBe(0);
    expect(data.averageScore).toBe(0);
  });

  it('totals time on task', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 0.5, completion_status: 'in_progress', updated_at: NOW, time_on_task_ms: 60_000 },
      { lesson_id: 'l-sci-1', score: 0.5, completion_status: 'in_progress', updated_at: NOW, time_on_task_ms: 120_000 },
    ]);
    const data = (await getStudentAnalytics('stu-1', { now: NOW }))!;
    expect(data.totalTimeOnTaskMs).toBe(180_000);
  });

  it('buckets XP into a seven-day trend', async () => {
    const events: XpEvent[] = [
      { id: 'x1', student_id: 'stu-1', kind: 'card_read', xp: 25, created_at: NOW - 2 * 60 * 60 * 1000 },
      { id: 'x2', student_id: 'stu-1', kind: 'card_read', xp: 50, created_at: NOW - DAY - 60 * 60 * 1000 },
      { id: 'x3', student_id: 'stu-2', kind: 'card_read', xp: 999, created_at: NOW },
    ];
    await appendXpEvents(events);
    const data = (await getStudentAnalytics('stu-1', { now: NOW }))!;
    expect(data.xpTrend).toHaveLength(7);
    // Today's bucket holds x1 only; another student's XP must not leak in.
    expect(data.xpTrend[6]).toBe(25);
    expect(data.xpTrend[5]).toBe(50);
    expect(data.totalXp).toBe(75);
  });
});

describe('getClassMastery', () => {
  beforeEach(seed);

  it('averages mastery across the whole class, per subject', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: 1, completion_status: 'completed', updated_at: NOW },
    ]);
    await putProgress('stu-2', [
      { lesson_id: 'l-math-1', score: 0, completion_status: 'in_progress', updated_at: NOW },
    ]);
    const rows = await getClassMastery('class-8-a', { now: NOW });
    const math = rows.find((r) => r.subject === 'math');
    expect(math!.mastery).toBeCloseTo(0.5);
  });

  it('excludes students in other classes', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-sci-1', score: 1, completion_status: 'completed', updated_at: NOW },
    ]);
    await putProgress('stu-9', [
      { lesson_id: 'l-sci-1', score: 0, completion_status: 'in_progress', updated_at: NOW },
    ]);
    const rows = await getClassMastery('class-8-a', { now: NOW });
    expect(rows.find((r) => r.subject === 'science')!.mastery).toBeCloseTo(1);
  });

  it('ignores ungraded rows so an unstarted class reads as 0, not negative', async () => {
    await putProgress('stu-1', [
      { lesson_id: 'l-math-1', score: -1, completion_status: 'in_progress', updated_at: NOW },
    ]);
    const rows = await getClassMastery('class-8-a', { now: NOW });
    // No graded data at all → no misleading negative bar.
    expect(rows).toHaveLength(0);
  });

  it('returns an empty list for a class with no data', async () => {
    expect(await getClassMastery('class-8-a', { now: NOW })).toEqual([]);
  });
});