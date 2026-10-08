/**
 * Local data model — IndexedDB records.
 *
 * All writes are append-only or total-order merges so that any amount of
 * offline time can be reconciled deterministically with the server.
 */

export type CompletionStatus = 'not_started' | 'in_progress' | 'completed';

export interface LessonRecord {
  id: string;
  title: string;
  language: string;
  version: number;
  content_json: string;
  updated_at: number;
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
