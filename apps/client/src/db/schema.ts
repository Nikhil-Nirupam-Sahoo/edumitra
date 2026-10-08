/**
 * Local data model — IndexedDB records.
 *
 * All writes are append-only or total-order merges so that any amount of
 * offline time can be reconciled deterministically with the server.
 */

export type CompletionStatus = 'not_started' | 'in_progress' | 'completed';

/** Syllabus subjects taught in the seeded curriculum (Class 8-10). */
export type SyllabusSubjectId = 'math' | 'science' | 'sst' | 'english' | 'practice';

/** Syllabus grades shipped by the seed. */
export type SyllabusGradeId = 8 | 9 | 10 | 'practice';

export interface LessonRecord {
  id: string;
  title: string;
  language: string;
  version: number;
  content_json: string;
  updated_at: number;
  /** Syllabus grade (8/9/10) when the lesson ships with the syllabus seed. */
  grade?: SyllabusGradeId;
  /** Syllabus subject when the lesson ships with the syllabus seed. */
  subject?: SyllabusSubjectId;
}

export interface StudentRecord {
  id: string;
  name: string;
  class_id: string;
  guardian_phone: string | null;
  created_at: number;
}

export interface StudentProgressRecord {
  student_id: string;
  lesson_id: string;
  completion_status: CompletionStatus;
  /** 0..1 scaled score, -1 when no graded interaction yet. */
  score: number;
  last_card_index: number;
  time_on_task_ms: number;
  updated_at: number;
}

export type XapiQueueStatus = 'pending' | 'synced';

export interface XapiQueueRecord {
  id: string;
  statement_json: string;
  status: XapiQueueStatus;
  timestamp: number;
  last_attempt_at: number | null;
  attempts: number;
  device_id: string;
}

/**
 * Gamification events — append-only, one row per reward. History is never
 * rewritten: XP totals, levels, streaks, stars, badges and daily quests are
 * all derived from this log (see `gamification/engine.ts`), so the same
 * doctrine as xAPI holds: any amount of offline activity reconciles by simple
 * idempotent `put`s keyed on `id`.
 */
export type XpEventKind =
  | 'card_read'
  | 'quiz_correct'
  | 'quiz_wrong'
  | 'lesson_completed'
  | 'perfect_bonus'
  | 'daily_first'
  | 'streak_bonus'
  | 'quest_bonus';

export interface XpEvent {
  id: string;
  student_id: string;
  kind: XpEventKind;
  /** Amount awarded at earn time — frozen in history by design. */
  xp: number;
  created_at: number;
  /** Set for lesson-scoped events. */
  lesson_id?: string;
  /** Quiz question id (or any sub-card reference). */
  question_id?: string;
  /** Card id for `card_read` events (dedupe key with `lesson_id`). */
  card_id?: string;
  /** Completion score 0..1 for `lesson_completed` / `perfect_bonus`. */
  score?: number;
  /** Quest id for `quest_bonus` events (one grant per quest per day). */
  quest_id?: string;
}

export type CheckpointOp = 'put' | 'log-reading' | 'count-inc';

export interface CheckpointRecord {
  id: string;
  student_id: string;
  lesson_id: string;
  key: string;
  value: number;
  ts: number;
  op: CheckpointOp;
  source_statement_id: string;
  acknowledged: 0 | 1;
}

export function progressKey(studentId: string, lessonId: string): string {
  return `${studentId}::${lessonId}`;
}

export function checkpointKey(studentId: string, lessonId: string, key: string): string {
  return `${studentId}::${lessonId}::${key}`;
}
