/**
 * Syllabus content client — downloads the curriculum, caches it, works offline.
 *
 * The curriculum is NOT in the bundle. On first run (or whenever the server's
 * `contentVersion` moves) the client:
 *   1. GETs /api/v1/content/manifest,
 *   2. GETs each pack listed there,
 *   3. writes the lessons into IndexedDB,
 *   4. records the version it now holds.
 *
 * After that the device is self-sufficient: everything renders from IndexedDB
 * with no network at all, which is the whole point of the app. Content
 * updates therefore ship without rebuilding or redeploying the PWA.
 */

import { getLessons, setMeta, getMetaNumber, upsertLessons } from '../db/client';
import type { LessonRecord, SyllabusGradeId, SyllabusSubjectId } from '../db/schema';
import type { LessonCard } from '../modules/lesson/lessonModel';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;
const VERSION_KEY = 'content.version';
const SCHEMA_KEY = 'content.schema';

export interface ContentManifest {
  schema: number;
  contentVersion: number;
  description?: string;
  files: Record<string, string>;
  counts?: Record<string, number>;
}

const SUBJECT_IDS: readonly string[] = ['math', 'science', 'sst', 'english', 'practice'];
const GRADE_IDS: readonly number[] = [8, 9, 10];

export interface RawLesson {
  id: string;
  title: string;
  grade: number;
  subject: string;
  cards: LessonCard[];
}

/** Validate one lesson from a downloaded pack before trusting it. */
function parseLesson(value: unknown): RawLesson | null {
  if (!value || typeof value !== 'object') return null;
  const lesson = value as Partial<RawLesson>;
  if (typeof lesson.id !== 'string' || typeof lesson.title !== 'string') return null;
  if (!Array.isArray(lesson.cards) || lesson.cards.length === 0) return null;
  return {
    id: lesson.id,
    title: lesson.title,
    grade: Number(lesson.grade),
    subject: String(lesson.subject ?? 'practice'),
    cards: lesson.cards,
  };
}

/** Structural rules — mirrors the server-side validator. */
export function validateLessonCards(cards: LessonCard[]): void {
  if (cards.length === 0) throw new Error('lesson has no cards');
  if (!cards.some((c) => c.type === 'quiz')) throw new Error('lesson has no quiz');
  if (cards[cards.length - 1].type !== 'summary') throw new Error('lesson must end with a summary');
  const cardIds = new Set<string>();
  const questionIds = new Set<string>();
  for (const card of cards) {
    if (cardIds.has(card.id)) throw new Error(`duplicate card id "${card.id}"`);
    cardIds.add(card.id);
    if (card.type === 'quiz') {
      if (questionIds.has(card.questionId)) {
        throw new Error(`duplicate questionId "${card.questionId}"`);
      }
      questionIds.add(card.questionId);
      const optionIds = card.options.map((o) => o.id);
      if (!optionIds.includes(card.correctOptionId)) {
        throw new Error(`correct option missing in ${card.questionId}`);
      }
    }
  }
}

function toRecord(lesson: RawLesson, contentVersion: number, updatedAt: number): LessonRecord {
  validateLessonCards(lesson.cards);
  const grade = GRADE_IDS.includes(lesson.grade)
    ? (lesson.grade as SyllabusGradeId & number)
    : undefined;
  const subject = SUBJECT_IDS.includes(lesson.subject)
    ? (lesson.subject as SyllabusSubjectId)
    : 'practice';
  return {
    id: lesson.id,
    title: lesson.title,
    language: 'en',
    version: contentVersion,
    content_json: JSON.stringify({ version: contentVersion, language: 'en', cards: lesson.cards }),
    updated_at: updatedAt,
    grade,
    subject,
  };
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    // The manifest must never come from a stale HTTP cache.
    cache: url.includes('/manifest') ? 'no-store' : 'default',
    signal,
  });
  if (!response.ok) throw new Error(`content request failed (${response.status})`);
  return (await response.json()) as T;
}

export type ContentSyncStatus =
  /** Device already had this version — nothing to do. */
  | 'up-to-date'
  /** Downloaded (or refreshed) lessons. */
  | 'updated'
  /** No network / server unreachable. */
  | 'offline'
  /** Server answered, but the payload was unusable. */
  | 'invalid';

/** Version of the curriculum currently cached on this device (0 = none). */
export async function installedContentVersion(): Promise<number> {
  return getMetaNumber(VERSION_KEY, 0);
}

/**
 * Bring the local curriculum in line with the server.
 * Never throws: failures come back as a status the UI can explain.
 */
export async function syncContent(
  options: { force?: boolean; timeoutMs?: number } = {},
): Promise<{ status: ContentSyncStatus; lessons?: number; version?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const manifest = await fetchJson<ContentManifest>(
      `${API_BASE}/content/manifest`,
      controller.signal,
    );
    if (typeof manifest.contentVersion !== 'number' || !manifest.files) {
      return { status: 'invalid' };
    }

    const installed = await installedContentVersion();
    if (!options.force && installed === manifest.contentVersion) {
      // Still confirm we actually have the lessons (a wiped store would
      // otherwise look up to date forever).
      const local = await getLessons();
      if (local.some((l) => l.grade !== undefined)) return { status: 'up-to-date' };
    }

    const records: LessonRecord[] = [];
    const now = Date.now();
    for (const packUrl of Object.values(manifest.files)) {
      const url = packUrl.startsWith('http') ? packUrl : `${API_BASE}${packUrl.replace(/^\/api\/v1/, '')}`;
      const pack = await fetchJson<unknown>(url, controller.signal);
      const list = Array.isArray(pack) ? pack : (pack as { lessons?: unknown })?.lessons;
      if (!Array.isArray(list)) return { status: 'invalid' };
      for (const entry of list) {
        const lesson = parseLesson(entry);
        if (!lesson) return { status: 'invalid' };
        records.push(toRecord(lesson, manifest.contentVersion, now));
      }
    }

    if (records.length === 0) return { status: 'invalid' };

    await upsertLessons(records);
    await setMeta(VERSION_KEY, String(manifest.contentVersion));
    await setMeta(SCHEMA_KEY, String(manifest.schema ?? 1));
    return { status: 'updated', lessons: records.length, version: manifest.contentVersion };
  } catch {
    // Network error, abort (timeout) or non-JSON — the app still runs on
    // whatever is already cached.
    return { status: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}