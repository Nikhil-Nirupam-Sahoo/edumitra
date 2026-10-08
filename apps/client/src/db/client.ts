/**
 * Local-first database (IndexedDB).
 *
 * Every write path here is a bounded, single-store transaction (resolved in
 * one macrotask on low-end hardware), so student interactions are durable
 * within milliseconds and require zero network access.
 */

import type {
  CheckpointRecord,
  LessonRecord,
  StudentProgressRecord,
  StudentRecord,
  XapiQueueRecord,
  XpEvent,
  CompletionStatus,
} from './schema';

const DB_NAME = 'edumitra';
const DB_VERSION = 3;

export const STORES = {
  lessons: 'lessons',
  students: 'students',
  progress: 'progress',
  xapiQueue: 'xapi_queue',
  checkpoints: 'checkpoints',
  meta: 'meta',
  xpEvents: 'xp_events',
} as const;

// ---------------------------------------------------------------------------
// Basic promise wrappers
// ---------------------------------------------------------------------------

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.lessons)) {
        db.createObjectStore(STORES.lessons, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.students)) {
        db.createObjectStore(STORES.students, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.progress)) {
        db.createObjectStore(STORES.progress, { keyPath: ['student_id', 'lesson_id'] });
      }
      if (!db.objectStoreNames.contains(STORES.xapiQueue)) {
        const queue = db.createObjectStore(STORES.xapiQueue, { keyPath: 'id' });
        queue.createIndex('by-status', 'status', { unique: false });
        queue.createIndex('by-timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.checkpoints)) {
        db.createObjectStore(STORES.checkpoints, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.xpEvents)) {
        const xp = db.createObjectStore(STORES.xpEvents, { keyPath: 'id' });
        xp.createIndex('by-student', 'student_id', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open local database'));
    request.onblocked = () => reject(new Error('Local database upgrade blocked by another tab'));
  });
  return dbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store, tx);
  await txDone(tx);
  return result;
}

async function getAll<T>(storeName: string): Promise<T[]> {
  return withStore(storeName, 'readonly', (store) => req(store.getAll() as IDBRequest<T[]>));
}

// ---------------------------------------------------------------------------
// Lessons & students
// ---------------------------------------------------------------------------

export async function getLessons(): Promise<LessonRecord[]> {
  return getAll<LessonRecord>(STORES.lessons);
}

export async function getLesson(id: string): Promise<LessonRecord | undefined> {
  return withStore(STORES.lessons, 'readonly', (store) =>
    req(store.get(id) as IDBRequest<LessonRecord | undefined>),
  );
}

export async function upsertLessons(lessons: LessonRecord[]): Promise<void> {
  return withStore(STORES.lessons, 'readwrite', async (store) => {
    await Promise.all(lessons.map((lesson) => req(store.put(lesson))));
  });
}

export async function getAllStudents(): Promise<StudentRecord[]> {
  return getAll<StudentRecord>(STORES.students);
}

export async function upsertStudents(students: StudentRecord[]): Promise<void> {
  return withStore(STORES.students, 'readwrite', async (store) => {
    await Promise.all(students.map((student) => req(store.put(student))));
  });
}

// ---------------------------------------------------------------------------
// Student progress (total-order merge — never regress completion)
// ---------------------------------------------------------------------------

export interface ProgressPatch {
  completion_status?: CompletionStatus;
  score?: number;
  last_card_index?: number;
  time_on_task_ms?: number;
}

const STATUS_RANK: Record<CompletionStatus, number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
};

export async function getAllProgress(): Promise<StudentProgressRecord[]> {
  return getAll<StudentProgressRecord>(STORES.progress);
}

export async function getProgress(
  studentId: string,
  lessonId: string,
): Promise<StudentProgressRecord | undefined> {
  return withStore(STORES.progress, 'readonly', (store) =>
    req(store.get([studentId, lessonId]) as IDBRequest<StudentProgressRecord | undefined>),
  );
}

export async function mergeProgress(
  studentId: string,
  lessonId: string,
  patch: ProgressPatch,
  now: number,
): Promise<StudentProgressRecord> {
  return withStore(STORES.progress, 'readwrite', async (store) => {
    const existing = (await req(
      store.get([studentId, lessonId]) as IDBRequest<StudentProgressRecord | undefined>,
    )) ?? {
      student_id: studentId,
      lesson_id: lessonId,
      completion_status: 'not_started' as CompletionStatus,
      score: -1,
      last_card_index: 0,
      time_on_task_ms: 0,
      updated_at: 0,
    };

    // Completion may only move forward; score keeps the best attempt; the
    // resume position keeps the furthest card; time accumulates.
    const nextStatus =
      patch.completion_status && STATUS_RANK[patch.completion_status] > STATUS_RANK[existing.completion_status]
        ? patch.completion_status
        : existing.completion_status;

    const merged: StudentProgressRecord = {
      student_id: studentId,
      lesson_id: lessonId,
      completion_status: nextStatus,
      score:
        patch.score !== undefined ? Math.max(existing.score, patch.score) : existing.score,
      last_card_index:
        patch.last_card_index !== undefined
          ? Math.max(existing.last_card_index, patch.last_card_index)
          : existing.last_card_index,
      time_on_task_ms:
        patch.time_on_task_ms !== undefined
          ? existing.time_on_task_ms + Math.max(0, patch.time_on_task_ms)
          : existing.time_on_task_ms,
      updated_at: Math.max(existing.updated_at, now),
    };
    await req(store.put(merged));
    return merged;
  });
}

/**
 * Attendance proxy: students of a class with any progress activity on `day`
 * (YYYY-MM-DD). Returning only *active* rows lets the dashboard fall back to
 * its own heuristic when nobody was active.
 */
export async function getAttendanceByClassDay(
  classId: string,
  day: string,
): Promise<Array<{ student_id: string; present: number }>> {
  const [students, progress] = await Promise.all([getAllStudents(), getAllProgress()]);
  const classStudentIds = new Set(
    students.filter((student) => student.class_id === classId).map((student) => student.id),
  );
  const present = new Map<string, number>();
  for (const row of progress) {
    if (!classStudentIds.has(row.student_id)) continue;
    const rowDay = new Date(row.updated_at).toISOString().slice(0, 10);
    if (rowDay === day) present.set(row.student_id, 1);
  }
  return [...present.keys()].map((student_id) => ({ student_id, present: 1 }));
}

// ---------------------------------------------------------------------------
// xAPI queue
// ---------------------------------------------------------------------------

export async function enqueueStatement(record: XapiQueueRecord): Promise<void> {
  await withStore(STORES.xapiQueue, 'readwrite', async (store) => {
    await req(store.put(record));
  });
}

export async function getPendingStatements(limit = 200): Promise<XapiQueueRecord[]> {
  return withStore(STORES.xapiQueue, 'readonly', async (store) => {
    const index = store.index('by-status');
    const rows = await req(index.getAll('pending') as IDBRequest<XapiQueueRecord[]>);
    return rows.sort((a, b) => a.timestamp - b.timestamp).slice(0, limit);
  });
}

export async function countPending(): Promise<number> {
  return withStore(STORES.xapiQueue, 'readonly', async (store) => {
    const index = store.index('by-status');
    return req(index.count('pending'));
  });
}

export async function countSynced(): Promise<number> {
  return withStore(STORES.xapiQueue, 'readonly', async (store) => {
    const index = store.index('by-status');
    return req(index.count('synced'));
  });
}

export async function patchQueueStatus(
  ids: string[],
  patch: { status?: XapiQueueRecord['status']; attempts?: number; last_attempt_at?: number | null },
): Promise<void> {
  if (ids.length === 0) return;
  await withStore(STORES.xapiQueue, 'readwrite', async (store) => {
    await Promise.all(
      ids.map(async (id) => {
        const row = (await req(store.get(id) as IDBRequest<XapiQueueRecord | undefined>)) ?? null;
        if (!row) return;
        const next: XapiQueueRecord = {
          ...row,
          status: patch.status ?? row.status,
          attempts: patch.attempts !== undefined ? patch.attempts : row.attempts,
          last_attempt_at:
            patch.last_attempt_at !== undefined ? patch.last_attempt_at : row.last_attempt_at,
        };
        await req(store.put(next));
      }),
    );
  });
}

export async function purgeSyncedStatements(olderThanMs: number): Promise<number> {
  if (olderThanMs <= 0) {
    // Purge everything synced.
    return withStore(STORES.xapiQueue, 'readwrite', async (store) => {
      const index = store.index('by-status');
      const rows = await req(index.getAllKeys('synced') as IDBRequest<IDBValidKey[]>);
      await Promise.all(rows.map((key) => req(store.delete(key))));
      return rows.length;
    });
  }
  const cutoff = Date.now() - olderThanMs;
  return withStore(STORES.xapiQueue, 'readwrite', async (store) => {
    const index = store.index('by-status');
    const rows = await req(index.getAll('synced') as IDBRequest<XapiQueueRecord[]>);
    let removed = 0;
    await Promise.all(
      rows.map(async (row) => {
        if (row.timestamp <= cutoff) {
          await req(store.delete(row.id));
          removed += 1;
        }
      }),
    );
    return removed;
  });
}

// ---------------------------------------------------------------------------
// CRDT checkpoints
// ---------------------------------------------------------------------------

export async function getCheckpoints(): Promise<CheckpointRecord[]> {
  return getAll<CheckpointRecord>(STORES.checkpoints);
}

export async function markCheckpointsAcknowledged(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withStore(STORES.checkpoints, 'readwrite', async (store) => {
    await Promise.all(
      ids.map(async (id) => {
        const row = (await req(store.get(id) as IDBRequest<CheckpointRecord | undefined>)) ?? null;
        if (row) await req(store.put({ ...row, acknowledged: 1 }));
      }),
    );
  });
}

export async function mergeCheckpoints(records: CheckpointRecord[]): Promise<void> {
  if (records.length === 0) return;
  await withStore(STORES.checkpoints, 'readwrite', async (store) => {
    await Promise.all(
      records.map(async (incoming) => {
        const existing =
          (await req(store.get(incoming.id) as IDBRequest<CheckpointRecord | undefined>)) ?? null;
        if (!existing) {
          await req(store.put(incoming));
          return;
        }
        if (incoming.source_statement_id === existing.source_statement_id) {
          // Exact same operation: nothing new to learn.
          return;
        }
        // Mirrors the server CRDT exactly (apps/server/src/sync/crdt.ts).
        if (incoming.op === 'log-reading' || incoming.key === 'completion.status') {
          // Monotonic registers: value can only grow; ts only advances.
          const nextValue = Math.max(existing.value, incoming.value);
          const nextTs = Math.max(existing.ts, incoming.ts);
          const incomingWins = incoming.value > existing.value;
          await req(
            store.put({
              ...existing,
              value: nextValue,
              ts: nextTs,
              source_statement_id: incomingWins
                ? incoming.source_statement_id
                : existing.source_statement_id,
              // winner's op phrasing is cosmetic; keep the stable one
              op: incomingWins ? incoming.op : existing.op,
            }),
          );
          return;
        }
        // put (and any future additive op): total order on (ts, source).
        const incomingKey = `${incoming.ts}|${incoming.source_statement_id}`;
        const existingKey = `${existing.ts}|${existing.source_statement_id}`;
        if (incomingKey > existingKey) {
          await req(store.put({ ...incoming, acknowledged: existing.acknowledged }));
        }
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Gamification events (append-only XP log)
// ---------------------------------------------------------------------------

/**
 * Idempotent `put`-based append: re-writing an event with the same `id` is a
 * no-op merge (the survival rule of the sync engine), so replaying an offline
 * session never double-counts rewards.
 */
export async function appendXpEvents(events: XpEvent[]): Promise<void> {
  if (events.length === 0) return;
  return withStore(STORES.xpEvents, 'readwrite', async (store) => {
    await Promise.all(events.map((event) => req(store.put(event))));
  });
}

export async function getXpEvents(studentId: string): Promise<XpEvent[]> {
  return withStore(STORES.xpEvents, 'readonly', async (store) => {
    const index = store.index('by-student');
    const cursor = await req(index.getAll(IDBKeyRange.only(studentId)) as IDBRequest<XpEvent[]>);
    return cursor.sort((a, b) => a.created_at - b.created_at);
  });
}

/** Every student's events — used for class leaderboards (bounded by class size). */
export async function getAllXpEvents(): Promise<XpEvent[]> {
  return getAll<XpEvent>(STORES.xpEvents);
}

// ---------------------------------------------------------------------------
// Meta + storage + reset
// ---------------------------------------------------------------------------

export async function setMeta(key: string, value: string): Promise<void> {
  await withStore(STORES.meta, 'readwrite', async (store) => {
    await req(store.put({ key, value }));
  });
}

export async function getMeta(key: string): Promise<string | null> {
  return withStore(STORES.meta, 'readonly', async (store) => {
    const row = (await req(store.get(key) as IDBRequest<{ key: string; value: string } | undefined>)) ?? null;
    return row ? row.value : null;
  });
}

export async function getMetaNumber(key: string, fallback: number): Promise<number> {
  const value = await getMeta(key);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function estimateStorage(): Promise<{ usageBytes: number; quotaBytes: number }> {
  try {
    const estimate = await navigator.storage?.estimate();
    return { usageBytes: estimate?.usage ?? 0, quotaBytes: estimate?.quota ?? 0 };
  } catch {
    return { usageBytes: 0, quotaBytes: 0 };
  }
}

export async function clearAllData(): Promise<void> {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  const tx = db.transaction(names, 'readwrite');
  names.forEach((name) => tx.objectStore(name).clear());
  await txDone(tx);
}
