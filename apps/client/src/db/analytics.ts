/**
 * Per-student analytics for the teacher dashboard.
 *
 * Everything is derived from the local IndexedDB cache, so a teacher can open
 * a student's profile on a phone with no signal — the same offline-first rule
 * the rest of the app follows.
 *
 * The questions this answers are the ones a teacher actually has:
 *   - Which subjects is this student weak in?          → subject mastery
 *   - Are they improving or stuck?                     → score trend over lessons
 *   - Are they still showing up?                       → activity heatmap
 *   - Which chapters are blocking them?                → per-subject chapter list
 *   - How much work are they actually doing?           → time on task, completion
 */

import { getLessons, getAllProgress, getAllXpEvents, getAllStudents } from './client';
import type { LessonRecord, StudentProgressRecord, XpEvent } from './schema';
import type { Point } from '../charts/Charts';

export interface SubjectMastery {
  subject: string;
  label: string;
  /** Mean score over the lessons attempted in this subject, 0–1. */
  mastery: number;
  lessonsStarted: number;
  lessonsCompleted: number;
}

export interface ChapterResult {
  lessonId: string;
  title: string;
  subject: string;
  grade: number | string | undefined;
  score: number;
  /** False until the student has a graded interaction — score is then a guess. */
  scored: boolean;
  completed: boolean;
  lastActivityAt: number;
}

function gradedFor(list: ChapterResult[]): ChapterResult[] {
  return list.filter((c) => c.scored);
}

export interface StudentAnalytics {
  studentId: string;
  name: string;
  classId: string;
  /** Score by lesson, oldest first — the improvement line. */
  scoreTrend: Point[];
  masteryBySubject: SubjectMastery[];
  /** One entry per day for the last `heatDays` days, oldest first. */
  activity: Point[];
  /** Weakest chapters first. */
  weakestChapters: ChapterResult[];
  strongestChapters: ChapterResult[];
  lessonsStarted: number;
  lessonsCompleted: number;
  completionRatio: number;
  averageScore: number;
  totalTimeOnTaskMs: number;
  /** XP over the trailing week, per day — for the momentum tile. */
  xpTrend: number[];
  level: number;
  totalXp: number;
  /** Days since any recorded activity. */
  daysSinceActivity: number | null;
}

const SUBJECT_LABELS: Record<string, string> = {
  math: 'Math',
  science: 'Science',
  sst: 'Social Studies',
  english: 'English',
  practice: 'Practice',
};

/**
 * Day key for an epoch timestamp.
 *
 * UTC throughout, and the boundaries are derived from this same function. The
 * tempting shortcut — `new Date(ms).setHours(0,0,0,0)` — computes a *local*
 * midnight, which in IST is 18:30 UTC the previous day; pairing that with a
 * UTC key puts a morning's activity in yesterday's bucket. Teacher analytics
 * shifting by a day is the kind of bug nobody reports and everybody trusts.
 */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC midnight at the start of the day containing `ms`. */
function startOfUtcDay(ms: number): number {
  return Date.UTC(
    new Date(ms).getUTCFullYear(),
    new Date(ms).getUTCMonth(),
    new Date(ms).getUTCDate(),
  );
}

function shortDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export interface AnalyticsOptions {
  now?: number;
  /** Days shown in the activity heatmap. */
  heatDays?: number;
}

export async function getStudentAnalytics(
  studentId: string,
  options: AnalyticsOptions = {},
): Promise<StudentAnalytics | null> {
  const now = options.now ?? Date.now();
  const heatDays = options.heatDays ?? 70;

  const [students, lessons, allProgress, allXp] = await Promise.all([
    getAllStudents(),
    getLessons(),
    getAllProgress(),
    getAllXpEvents(),
  ]);

  const student = students.find((s) => s.id === studentId);
  if (!student) return null;

  const lessonById = new Map<string, LessonRecord>(lessons.map((l) => [l.id, l]));
  const rows = allProgress
    .filter((p) => p.student_id === studentId)
    .sort((a, b) => a.updated_at - b.updated_at);

  /**
   * `score` is -1 until the first graded interaction. Averaging that in would
   * pull every subject below zero and make a student who has only just started
   * look worse than one who actually scored 0.
   */
  const scored = (value: number): value is number => value >= 0;

  // ---- Chapters --------------------------------------------------------
  const chapters: ChapterResult[] = rows.map((row) => {
    const lesson = lessonById.get(row.lesson_id);
    return {
      lessonId: row.lesson_id,
      title: lesson?.title ?? row.lesson_id,
      subject: lesson?.subject ?? 'practice',
      grade: lesson?.grade,
      score: scored(row.score) ? row.score : 0,
      scored: scored(row.score),
      completed: row.completion_status === 'completed',
      lastActivityAt: row.updated_at,
    };
  });

  // ---- Score trend -----------------------------------------------------
  const scoreTrend: Point[] = chapters.map((c) => ({
    label: shortDay(c.lastActivityAt),
    value: c.score,
  }));

  /** Chapters with an actual grade — the only ones a mean should use. */
  const graded = chapters.filter((c) => c.scored);

  // ---- Subject mastery -------------------------------------------------
  const bySubject = new Map<string, ChapterResult[]>();
  for (const chapter of chapters) {
    const list = bySubject.get(chapter.subject) ?? [];
    list.push(chapter);
    bySubject.set(chapter.subject, list);
  }
  const masteryBySubject: SubjectMastery[] = [...bySubject.entries()]
    .map(([subject, list]) => ({
      subject,
      label: SUBJECT_LABELS[subject] ?? subject,
      mastery:
        gradedFor(list).length > 0
          ? gradedFor(list).reduce((sum, c) => sum + c.score, 0) / gradedFor(list).length
          : 0,
      lessonsStarted: list.length,
      lessonsCompleted: list.filter((c) => c.completed).length,
    }))
    .sort((a, b) => a.mastery - b.mastery);

  // ---- Activity heatmap ------------------------------------------------
  const perDay = new Map<string, number>();
  for (const chapter of chapters) {
    const key = dayKey(chapter.lastActivityAt);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const maxPerDay = Math.max(1, ...perDay.values());
  const activity: Point[] = [];
  for (let i = heatDays - 1; i >= 0; i -= 1) {
    const key = dayKey(now - i * 24 * 60 * 60 * 1000);
    activity.push({ label: key, value: (perDay.get(key) ?? 0) / maxPerDay });
  }

  // ---- Gamification ----------------------------------------------------
  const xpEvents: XpEvent[] = allXp.filter((e) => e.student_id === studentId);
  /**
   * XP per calendar day, oldest first.
   *
   * Bucketed by calendar day rather than a rolling 24-hour window: a rolling
   * window puts an event from this morning into "tomorrow's" bar, so the last
   * column is always empty and the trend never sums to the student's total.
   */
  const xpByDay = new Map<string, number>();
  for (const event of xpEvents) {
    const key = dayKey(event.created_at);
    xpByDay.set(key, (xpByDay.get(key) ?? 0) + event.xp);
  }
  const todayStart = startOfUtcDay(now);
  const xpTrend = Array.from({ length: 7 }, (_, i) => {
    const key = dayKey(todayStart - (6 - i) * 24 * 60 * 60 * 1000);
    return xpByDay.get(key) ?? 0;
  });

  const lessonsStarted = chapters.length;
  const lessonsCompleted = chapters.filter((c) => c.completed).length;
  const lastActivity = chapters.length > 0 ? chapters[chapters.length - 1]!.lastActivityAt : null;

  return {
    studentId,
    name: student.name,
    classId: student.class_id,
    scoreTrend,
    masteryBySubject,
    activity,
    weakestChapters: [...chapters]
      .filter((c) => c.scored && (!c.completed || c.score < 0.7))
      .sort((a, b) => a.score - b.score)
      .slice(0, 6),
    strongestChapters: [...graded]
      .filter((c) => c.completed && c.score >= 0.7)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6),
    lessonsStarted,
    lessonsCompleted,
    completionRatio: lessonsStarted > 0 ? lessonsCompleted / lessonsStarted : 0,
    averageScore:
      graded.length > 0 ? graded.reduce((sum, c) => sum + c.score, 0) / graded.length : 0,
    totalTimeOnTaskMs: rows.reduce((sum, r) => sum + r.time_on_task_ms, 0),
    xpTrend,
    level: 1,
    totalXp: xpEvents.reduce((sum, e) => sum + e.xp, 0),
    daysSinceActivity:
      lastActivity === null ? null : Math.floor((now - lastActivity) / (24 * 60 * 60 * 1000)),
  };
}

/**
 * Class-level mastery by subject, averaged across students. Lets a teacher see
 * that the whole class is weak in one area rather than one student.
 */
export async function getClassMastery(
  classId: string,
  options: AnalyticsOptions = {},
): Promise<SubjectMastery[]> {
  const now = options.now ?? Date.now();
  const [students, lessons, progress] = await Promise.all([
    getAllStudents(),
    getLessons(),
    getAllProgress(),
  ]);
  const ids = new Set(students.filter((s) => s.class_id === classId).map((s) => s.id));
  const lessonById = new Map<string, LessonRecord>(lessons.map((l) => [l.id, l]));

  const bySubject = new Map<string, number[]>();
  for (const row of progress) {
    if (!ids.has(row.student_id)) continue;
    const subject = lessonById.get(row.lesson_id)?.subject ?? 'practice';
    if (row.score < 0) continue; // no grade recorded yet
    const list = bySubject.get(subject) ?? [];
    list.push(row.score);
    bySubject.set(subject, list);
  }

  return [...bySubject.entries()]
    .map(([subject, scores]) => ({
      subject,
      label: SUBJECT_LABELS[subject] ?? subject,
      mastery: scores.reduce((sum, s) => sum + s, 0) / (scores.length || 1),
      lessonsStarted: scores.length,
      lessonsCompleted: 0,
    }))
    .sort((a, b) => a.mastery - b.mastery);
}

/** Re-exported so the dashboard does not import the chart module directly. */
export type { Point };
export type ProgressRow = StudentProgressRecord;