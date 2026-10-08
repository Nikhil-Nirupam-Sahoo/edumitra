/**
 * Offline analytics queries.
 *
 * These are the client-side equivalent of SQL aggregation over the local
 * progress tables. IndexedDB has no GROUP BY, so aggregation runs in a single
 * pass over `student_progress` (bounded by class size, typically < 100 rows)
 * and results are memoized by the UI layer. Every query is 100% offline.
 */

import { getAllProgress, getAllStudents, getAttendanceByClassDay } from './client';
import type { StudentProgressRecord, StudentRecord } from './schema';

export interface StudentSummary {
  student: StudentRecord;
  lessonsStarted: number;
  lessonsCompleted: number;
  /** Mean of completion ratios (completed=1, in_progress=0.5) over assigned work. */
  completionRatio: number;
  averageScore: number;
  totalTimeOnTaskMs: number;
  lastActivityAt: number;
  /** Flag: not completed anything in the window AND low score. */
  struggling: boolean;
  activeToday: boolean;
}

export interface ClassSummary {
  classId: string;
  day: string;
  totalStudents: number;
  activeToday: number;
  averageCompletion: number;
  averageScore: number;
  strugglingCount: number;
  presentToday: number;
  totalTimeOnTaskMs: number;
  students: StudentSummary[];
}

export interface ClassAnalyticsOptions {
  /** ISO day string used for "active today"/attendance; defaults to today. */
  day?: string;
  /** Struggle thresholds. */
  struggleScoreThreshold?: number;
  struggleInactivityMs?: number;
  /** Injected for deterministic tests. */
  now?: number;
}

function isoDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function startOfDayMs(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Single-pass class aggregation. O(progress rows + students + attendance).
 */
export async function getClassSummary(
  classId: string,
  options: ClassAnalyticsOptions = {},
): Promise<ClassSummary> {
  const now = options.now ?? Date.now();
  const day = options.day ?? isoDay(now);
  const scoreThreshold = options.struggleScoreThreshold ?? 0.5;
  const inactivityMs = options.struggleInactivityMs ?? 3 * 24 * 60 * 60 * 1000;

  const [students, allProgress, attendance] = await Promise.all([
    getAllStudents(),
    getAllProgress(),
    getAttendanceByClassDay(classId, day),
  ]);

  const classStudents = students.filter((student) => student.class_id === classId);
  const studentIds = new Set(classStudents.map((student) => student.id));
  const attendanceByStudent = new Map(attendance.map((row) => [row.student_id, row]));

  // Aggregate per student in one pass.
  interface Accumulator {
    started: number;
    completed: number;
    ratioSum: number;
    scoreSum: number;
    scoreCount: number;
    timeSum: number;
    lastActivityAt: number;
  }
  const byStudent = new Map<string, Accumulator>();
  for (const row of allProgress) {
    if (!studentIds.has(row.student_id)) continue;
    let acc = byStudent.get(row.student_id);
    if (!acc) {
      acc = {
        started: 0,
        completed: 0,
        ratioSum: 0,
        scoreSum: 0,
        scoreCount: 0,
        timeSum: 0,
        lastActivityAt: 0,
      };
      byStudent.set(row.student_id, acc);
    }
    acc.started += 1;
    if (row.completion_status === 'completed') {
      acc.completed += 1;
      acc.ratioSum += 1;
    } else if (row.completion_status === 'in_progress') {
      acc.ratioSum += 0.5;
    }
    if (row.score >= 0) {
      acc.scoreSum += row.score;
      acc.scoreCount += 1;
    }
    acc.timeSum += row.time_on_task_ms;
    acc.lastActivityAt = Math.max(acc.lastActivityAt, row.updated_at);
  }

  const todayStart = startOfDayMs(now);
  const studentSummaries = classStudents.map<StudentSummary>((student) => {
    const acc = byStudent.get(student.id);
    const started = acc?.started ?? 0;
    const completed = acc?.completed ?? 0;
    const completionRatio = started > 0 ? (acc?.ratioSum ?? 0) / started : 0;
    const averageScore = acc && acc.scoreCount > 0 ? acc.scoreSum / acc.scoreCount : 0;
    const lastActivityAt = acc?.lastActivityAt ?? 0;
    const inactive = lastActivityAt === 0 || now - lastActivityAt > inactivityMs;
    const struggling =
      started > 0 && completed < started && inactive && averageScore < scoreThreshold;
    const activeToday = lastActivityAt >= todayStart;
    return {
      student,
      lessonsStarted: started,
      lessonsCompleted: completed,
      completionRatio,
      averageScore,
      totalTimeOnTaskMs: acc?.timeSum ?? 0,
      lastActivityAt,
      struggling,
      activeToday,
    };
  });

  await Promise.resolve(); // keep async signature stable for future backends
  return summarizeClass(
    classId,
    day,
    studentSummaries,
    attendanceByStudent.size > 0
      ? [...attendanceByStudent.values()].filter((row) => row.present === 1).length
      : studentSummaries.filter((s) => s.activeToday).length,
  );
}

function summarizeClass(
  classId: string,
  day: string,
  students: StudentSummary[],
  presentToday: number,
): ClassSummary {
  const totalStudents = students.length;
  const averageCompletion =
    totalStudents > 0
      ? students.reduce((sum, s) => sum + s.completionRatio, 0) / totalStudents
      : 0;
  const scored = students.filter((s) => s.lessonsStarted > 0);
  const averageScore =
    scored.length > 0 ? scored.reduce((sum, s) => sum + s.averageScore, 0) / scored.length : 0;
  return {
    classId,
    day,
    totalStudents,
    activeToday: students.filter((s) => s.activeToday).length,
    averageCompletion,
    averageScore,
    strugglingCount: students.filter((s) => s.struggling).length,
    presentToday,
    totalTimeOnTaskMs: students.reduce((sum, s) => sum + s.totalTimeOnTaskMs, 0),
    students: students.sort((a, b) => a.averageScore - b.averageScore),
  };
}

/** Distinct class ids known locally — powers the dashboard class picker. */
export async function listClasses(): Promise<string[]> {
  const students = await getAllStudents();
  return [...new Set(students.map((student) => student.class_id))].sort();
}

/**
 * Students needing intervention, ranked by (lowest average score, then most
 * inactive). Used by the "Needs support" panel.
 */
export async function getStrugglingStudents(
  classId: string,
  limit = 10,
  options: ClassAnalyticsOptions = {},
): Promise<StudentSummary[]> {
  const summary = await getClassSummary(classId, options);
  return summary.students
    .filter((student) => student.struggling)
    .sort((a, b) => a.averageScore - b.averageScore || a.lastActivityAt - b.lastActivityAt)
    .slice(0, limit);
}

/**
 * Class completion trend for the last N days, computed from progress
 * `updated_at` timestamps — no server round-trip required.
 */
export async function getCompletionTrend(
  classId: string,
  days = 7,
  now = Date.now(),
): Promise<Array<{ day: string; completions: number }>> {
  const students = await getAllStudents();
  const studentIds = new Set(
    students.filter((student) => student.class_id === classId).map((student) => student.id),
  );
  const progress = await getAllProgress();
  const buckets: Array<{ day: string; completions: number }> = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let offset = days - 1; offset >= 0; offset--) {
    const dayStart = startOfDayMs(now - offset * dayMs);
    const dayEnd = dayStart + dayMs;
    const completions = progress.filter(
      (row: StudentProgressRecord) =>
        studentIds.has(row.student_id) &&
        row.completion_status === 'completed' &&
        row.updated_at >= dayStart &&
        row.updated_at < dayEnd,
    ).length;
    buckets.push({ day: isoDay(dayStart), completions });
  }
  return buckets;
}
