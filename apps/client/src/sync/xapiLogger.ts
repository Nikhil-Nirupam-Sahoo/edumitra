/**
 * xAPI event logger — the write path that must never lose a student action.
 *
 * Every public function builds an immutable xAPI statement (Actor-Verb-Object,
 * optionally Result/Context) and persists it to `xapi_queue` in a single
 * IndexedDB transaction. Statement ids are deterministic (UUIDv5-style hash of
 * the semantic content): if the same interaction is logged twice — a double
 * tap, a retried render — the queue upsert collapses it and the server treats
 * it as an idempotent duplicate.
 *
 * No network access happens here. Ever.
 */

import { mergeCheckpoints, mergeProgress, enqueueStatement, type ProgressPatch } from '../db/client';
import { progressKey, type XapiQueueRecord } from '../db/schema';
import { getDeviceId } from './deviceId';

// ---------------------------------------------------------------------------
// xAPI vocabulary (ADL verbs where available, xAPI-conformant URIs otherwise)
// ---------------------------------------------------------------------------

export const XAPI_VERBS = {
  attempted: 'http://adlnet.gov/expapi/verbs/attempted',
  answered: 'http://adlnet.gov/expapi/verbs/answered',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
  progressed: 'http://adlnet.gov/expapi/verbs/progressed',
} as const;

export type XapiVerb = (typeof XAPI_VERBS)[keyof typeof XAPI_VERBS];

export interface XapiActor {
  objectType: 'Agent';
  /** Pseudonymous id — never a real name. Names stay in the local students store. */
  account: { homePage: string; name: string };
}

export interface XapiObject {
  objectType: 'Activity';
  id: string;
  definition?: {
    name?: Record<string, string>;
    description?: Record<string, string>;
    type?: string;
    interactionType?: string;
    correctResponsesPattern?: string[];
    choices?: Array<{ id: string; description: Record<string, string> }>;
  };
}

export interface XapiStatement {
  id: string;
  actor: XapiActor;
  verb: { id: XapiVerb; display: Record<string, string> };
  object: XapiObject;
  result?: {
    success?: boolean;
    score?: { scaled: number; raw?: number; min?: number; max?: number };
    completion?: boolean;
    duration?: string;
    response?: string;
  };
  context?: {
    registration?: string;
    platform?: string;
    language?: string;
    extensions?: Record<string, unknown>;
  };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Statement construction
// ---------------------------------------------------------------------------

const LESSON_ACTIVITY_BASE = 'https://edumitra.org/activities/lesson';
const QUESTION_ACTIVITY_BASE = 'https://edumitra.org/activities/question';

export function actorFor(studentId: string): XapiActor {
  return {
    objectType: 'Agent',
    account: { homePage: 'https://edumitra.org', name: studentId },
  };
}

export function lessonActivityId(lessonId: string): string {
  return `${LESSON_ACTIVITY_BASE}/${encodeURIComponent(lessonId)}`;
}

export function questionActivityId(lessonId: string, questionId: string): string {
  return `${QUESTION_ACTIVITY_BASE}/${encodeURIComponent(lessonId)}/${encodeURIComponent(questionId)}`;
}

/** Deterministic (content-addressed) statement id. */
function statementId(parts: readonly (string | number | boolean)[]): string {
  const input = parts.join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  let h3 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ code, 2246822519) >>> 0;
    h3 = (h3 + Math.imul(code, 2654435761)) >>> 0;
  }
  const hex = (value: number) => value.toString(16).padStart(8, '0');
  const device = getDeviceId().replace(/-/g, '');
  return [
    hex(h1),
    hex(h2),
    hex(h3),
    device.slice(0, 8),
    device.slice(8, 16),
  ].join('-');
}

function isoNow(now: number): string {
  return new Date(now).toISOString();
}

/**
 * Canonical checkpoint keys — MUST stay in sync with the server's
 * `apps/server/src/sync/crdt.ts` PROGRESS_KEYS.
 */
export const CHECKPOINT_KEYS = {
  completionStatus: 'completion.status',
  completionRank: { not_started: 0, in_progress: 1, completed: 2 } as const,
  lastCard: 'lesson.last_card',
  timeOnTaskMs: 'time_on_task.ms',
} as const;

/**
 * The CRDT registers the client pushes on every sync. Only **idempotent**
 * register ops are emitted here:
 *  - `completion.status` — `put` carrying the status RANK; the server merges
 *    it monotonically, so completion can never regress.
 *  - `lesson.last_card` — `log-reading` (monotonic max).
 *
 * Additive registers (`time_on_task.ms`, quiz counts) are deliberately NOT
 * emitted client-side: the client store keeps one row per key and cannot hold
 * independent increments, and re-sending an accumulated total would
 * double-count. The server derives those from the statements themselves,
 * deduplicating by statement id, which is exactly equivalent and safe.
 */
export function buildCheckpointsFor(
  statement: XapiStatement,
  studentId: string,
  lessonId: string,
  now: number,
): import('../db/schema').CheckpointRecord[] {
  const verb = statement.verb.id;
  const base = {
    student_id: studentId,
    lesson_id: lessonId,
    acknowledged: 0 as const,
    ts: now,
  };
  const records: import('../db/schema').CheckpointRecord[] = [];

  if (verb.endsWith('/attempted')) {
    records.push({
      ...base,
      id: checkpointRowId(CHECKPOINT_KEYS.completionStatus, studentId, lessonId),
      key: CHECKPOINT_KEYS.completionStatus,
      value: CHECKPOINT_KEYS.completionRank.in_progress,
      op: 'put',
      source_statement_id: statement.id,
    });
  }

  if (verb.endsWith('/completed')) {
    records.push({
      ...base,
      id: checkpointRowId(CHECKPOINT_KEYS.completionStatus, studentId, lessonId),
      key: CHECKPOINT_KEYS.completionStatus,
      value: CHECKPOINT_KEYS.completionRank.completed,
      op: 'put',
      source_statement_id: statement.id,
    });
  }

  if (verb.endsWith('/experienced')) {
    const cardMatch = statement.object.id.match(/\/card\/(\d+)(?:\/|$)/);
    if (cardMatch?.[1]) {
      records.push({
        ...base,
        id: checkpointRowId(CHECKPOINT_KEYS.lastCard, studentId, lessonId),
        key: CHECKPOINT_KEYS.lastCard,
        value: Number(cardMatch[1]),
        op: 'log-reading',
        source_statement_id: statement.id,
      });
    }
  }

  return records;
}

function checkpointRowId(key: string, studentId: string, lessonId: string): string {
  return `${studentId}::${lessonId}::${key}`;
}

/** Parses an xAPI ISO-8601 duration back into milliseconds (0 if unparseable). */
export function parseIsoDuration(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  const ms =
    Number(days ?? 0) * 86_400_000 +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1_000;
  return Number.isFinite(ms) ? Math.round(ms) : 0;
}

async function persist(
  statement: XapiStatement,
  now: number,
  progressPatch: ProgressPatch | null,
  studentId: string,
  lessonId: string,
): Promise<void> {
  const record: XapiQueueRecord = {
    id: statement.id,
    statement_json: JSON.stringify(statement),
    status: 'pending',
    timestamp: now,
    last_attempt_at: null,
    attempts: 0,
    device_id: getDeviceId(),
  };
  // Queue write first: even if the progress merge fails, the event is safe.
  await enqueueStatement(record);
  // Maintain the local CRDT registers the sync engine will push. Merging is
  // idempotent, so a failed/partial persist simply re-merges later.
  const checkpoints = buildCheckpointsFor(statement, studentId, lessonId, now);
  if (checkpoints.length > 0) {
    await mergeCheckpoints(checkpoints);
  }
  if (progressPatch) {
    await mergeProgress(studentId, lessonId, progressPatch, now);
  }
}

// ---------------------------------------------------------------------------
// Public event API
// ---------------------------------------------------------------------------

export interface LogOptions {
  /** Override for deterministic tests. */
  now?: number;
  language?: string;
}

/**
 * Student opened a lesson. Records `attempted` and flips local progress to
 * `in_progress` without regressing an already-completed lesson.
 */
export async function logLessonStarted(
  studentId: string,
  lessonId: string,
  options: LogOptions = {},
): Promise<XapiStatement> {
  const now = options.now ?? Date.now();
  const statement: XapiStatement = {
    id: statementId(['started', studentId, lessonId, now, getDeviceId()]),
    actor: actorFor(studentId),
    verb: {
      id: XAPI_VERBS.attempted,
      display: { 'en-US': 'attempted' },
    },
    object: {
      objectType: 'Activity',
      id: lessonActivityId(lessonId),
      definition: {
        type: 'http://adlnet.gov/expapi/activities/lesson',
      },
    },
    context: {
      registration: `${progressKey(studentId, lessonId)}`,
      platform: 'EduMitra PWA',
      language: options.language ?? 'en',
    },
    timestamp: isoNow(now),
  };
  await persist(statement, now, { completion_status: 'in_progress' }, studentId, lessonId);
  return statement;
}

/**
 * Student advanced past a card without a graded interaction (reading / audio).
 * Powers "time on task" and resume-position analytics offline.
 */
export async function logCardViewed(
  studentId: string,
  lessonId: string,
  cardIndex: number,
  timeOnTaskMs: number,
  options: LogOptions = {},
): Promise<XapiStatement> {
  const now = options.now ?? Date.now();
  const statement: XapiStatement = {
    id: statementId(['card', studentId, lessonId, cardIndex, now, getDeviceId()]),
    actor: actorFor(studentId),
    verb: {
      id: XAPI_VERBS.experienced,
      display: { 'en-US': 'experienced' },
    },
    object: {
      objectType: 'Activity',
      id: `${lessonActivityId(lessonId)}/card/${cardIndex}`,
      definition: {
        type: 'http://adlnet.gov/expapi/activities/slide',
      },
    },
    result: {
      duration: toIsoDuration(timeOnTaskMs),
    },
    context: {
      registration: progressKey(studentId, lessonId),
      platform: 'EduMitra PWA',
      language: options.language ?? 'en',
    },
    timestamp: isoNow(now),
  };
  await persist(
    statement,
    now,
    { completion_status: 'in_progress', last_card_index: cardIndex, time_on_task_ms: timeOnTaskMs },
    studentId,
    lessonId,
  );
  return statement;
}

/**
 * Student submitted a quiz answer. `isCorrect` is graded locally so students
 * get instant feedback with zero latency; the server simply merges the result.
 */
export async function logQuestionAnswered(
  studentId: string,
  lessonId: string,
  questionId: string,
  selectedOption: string,
  isCorrect: boolean,
  options: LogOptions = {},
): Promise<XapiStatement> {
  const now = options.now ?? Date.now();
  const statement: XapiStatement = {
    id: statementId([
      'answered',
      studentId,
      lessonId,
      questionId,
      selectedOption,
      isCorrect,
      now,
      getDeviceId(),
    ]),
    actor: actorFor(studentId),
    verb: {
      id: XAPI_VERBS.answered,
      display: { 'en-US': 'answered' },
    },
    object: {
      objectType: 'Activity',
      id: questionActivityId(lessonId, questionId),
      definition: {
        type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
        interactionType: 'choice',
      },
    },
    result: {
      success: isCorrect,
      response: selectedOption,
      score: { scaled: isCorrect ? 1 : 0, raw: isCorrect ? 1 : 0, min: 0, max: 1 },
    },
    context: {
      registration: progressKey(studentId, lessonId),
      platform: 'EduMitra PWA',
      language: options.language ?? 'en',
    },
    timestamp: isoNow(now),
  };
  await persist(statement, now, { completion_status: 'in_progress' }, studentId, lessonId);
  return statement;
}

/**
 * Lesson finished. The final score is clamped to 0..1 and the local progress
 * row is marked completed; completion can never be downgraded later.
 */
export async function logLessonCompleted(
  studentId: string,
  lessonId: string,
  finalScore: number,
  options: LogOptions = {},
): Promise<XapiStatement> {
  const now = options.now ?? Date.now();
  const scaled = clamp01(finalScore);
  const statement: XapiStatement = {
    id: statementId(['completed', studentId, lessonId, scaled, now, getDeviceId()]),
    actor: actorFor(studentId),
    verb: {
      id: XAPI_VERBS.completed,
      display: { 'en-US': 'completed' },
    },
    object: {
      objectType: 'Activity',
      id: lessonActivityId(lessonId),
      definition: {
        type: 'http://adlnet.gov/expapi/activities/lesson',
      },
    },
    result: {
      completion: true,
      success: scaled >= 0.5,
      score: { scaled, min: 0, max: 1 },
    },
    context: {
      registration: progressKey(studentId, lessonId),
      platform: 'EduMitra PWA',
      language: options.language ?? 'en',
    },
    timestamp: isoNow(now),
  };
  await persist(statement, now, { completion_status: 'completed', score: scaled }, studentId, lessonId);
  return statement;
}

/** Emits a `progressed` statement for partial-progress checkpoints. */
export async function logProgressed(
  studentId: string,
  lessonId: string,
  progressRatio: number,
  options: LogOptions = {},
): Promise<XapiStatement> {
  const now = options.now ?? Date.now();
  const scaled = clamp01(progressRatio);
  const statement: XapiStatement = {
    id: statementId(['progressed', studentId, lessonId, scaled, now, getDeviceId()]),
    actor: actorFor(studentId),
    verb: {
      id: XAPI_VERBS.progressed,
      display: { 'en-US': 'progressed' },
    },
    object: {
      objectType: 'Activity',
      id: lessonActivityId(lessonId),
      definition: { type: 'http://adlnet.gov/expapi/activities/lesson' },
    },
    result: { score: { scaled, min: 0, max: 1 } },
    context: {
      registration: progressKey(studentId, lessonId),
      platform: 'EduMitra PWA',
      language: options.language ?? 'en',
    },
    timestamp: isoNow(now),
  };
  await persist(statement, now, null, studentId, lessonId);
  return statement;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** ms -> ISO 8601 duration (xAPI result.duration). */
export function toIsoDuration(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const seconds = Math.floor(totalMs / 1000);
  const millis = totalMs % 1000;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  let out = 'PT';
  if (h > 0) out += `${h}H`;
  if (m > 0) out += `${m}M`;
  if (s > 0 || millis > 0 || out === 'PT') {
    out += millis > 0 ? `${s}.${String(millis).padStart(3, '0')}S` : `${s}S`;
  }
  return out;
}

/** Parses a statement previously serialized into the queue. */
export function parseStatement(statementJson: string): XapiStatement {
  return JSON.parse(statementJson) as XapiStatement;
}
