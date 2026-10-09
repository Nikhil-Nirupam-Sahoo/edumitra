/**
 * Translated lesson content + synthesised speech, cached on the device.
 *
 * WHY THIS EXISTS
 * Translating the interface is not enough. Lesson cards ship as English JSON,
 * so a student who picked Odia or Hindi was reading English lessons inside a
 * translated shell. This module fetches a lesson's cards in the chosen
 * language, stores them, and hands them back — so a lesson is translated once
 * and then reads correctly with the network off.
 *
 * Failures are never fatal: if the server is unreachable or has no key, the
 * caller keeps the original English cards. An untranslated lesson is strictly
 * better than a blank one.
 */

import { getLessons, openDb } from '../db/client';
import { STORES } from '../db/client';
import type { LessonCard } from '../modules/lesson/lessonModel';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;

/** Locales we translate *content* into. English needs no round-trip. */
const CONTEXT_LOCALES = ['hi', 'ta', 'or', 'bn', 'mr', 'te', 'gu', 'kn', 'ml', 'pa', 'ur'];

function token(): string | null {
  try {
    const raw = localStorage.getItem('edumitra.session');
    if (!raw) return null;
    return (JSON.parse(raw) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* -------------------------------------------------------------------------- */
/* Translated lesson cards                                                     */
/* -------------------------------------------------------------------------- */

interface CachedTranslation {
  lesson_id: string;
  locale: string;
  /** Content version the translation was made from; invalidated on a bump. */
  version: number;
  cards: LessonCard[];
}

export async function getTranslatedCards(
  lessonId: string,
  locale: string,
  contentVersion: number,
): Promise<LessonCard[] | null> {
  if (locale === 'en' || !CONTEXT_LOCALES.includes(locale)) return null;
  const db = await openDb();
  const store = db.transaction(STORES.lessonI18n, 'readonly').objectStore(STORES.lessonI18n);
  const hit = await req<CachedTranslation | undefined>(
    store.get([lessonId, locale]) as IDBRequest<CachedTranslation | undefined>,
  );
  // A content reword invalidates the translation: keeping it would show the
  // student yesterday's wording for today's chapter.
  if (!hit || hit.version !== contentVersion) return null;
  return hit.cards;
}

export async function putTranslatedCards(
  lessonId: string,
  locale: string,
  contentVersion: number,
  cards: LessonCard[],
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.lessonI18n, 'readwrite');
  tx.objectStore(STORES.lessonI18n).put({
    lesson_id: lessonId,
    locale,
    version: contentVersion,
    cards,
  } satisfies CachedTranslation);
  await txDone(tx);
}

/** Drops every stored translation — used when content is re-downloaded. */
export async function clearTranslations(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.lessonI18n, 'readwrite');
  tx.objectStore(STORES.lessonI18n).clear();
  await txDone(tx);
}

/**
 * Returns the lesson's cards in `locale`, fetching and caching them on first
 * request. Falls back to the English cards on any failure.
 */
export async function cardsForLocale(
  lessonId: string,
  locale: string,
): Promise<{ cards: LessonCard[]; translated: boolean }> {
  const lessons = await getLessons();
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) return { cards: [], translated: false };

  let original: LessonCard[] = [];
  let version = 0;
  try {
    const parsed = JSON.parse(lesson.content_json) as {
      version?: number;
      cards?: LessonCard[];
    };
    original = parsed.cards ?? [];
    version = parsed.version ?? 0;
  } catch {
    return { cards: [], translated: false };
  }

  if (locale === 'en' || !CONTEXT_LOCALES.includes(locale)) {
    return { cards: original, translated: false };
  }

  const cached = await getTranslatedCards(lessonId, locale, version);
  if (cached) return { cards: cached, translated: true };

  const bearer = token();
  try {
    const response = await fetch(`${API_BASE}/translate/content`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({
        target: locale,
        lessonId,
        contentVersion: version,
        cards: original,
      }),
    });
    if (!response.ok) return { cards: original, translated: false };
    const body = (await response.json()) as { cards?: LessonCard[] };
    if (!Array.isArray(body.cards) || body.cards.length === 0) {
      return { cards: original, translated: false };
    }
    await putTranslatedCards(lessonId, locale, version, body.cards);
    return { cards: body.cards, translated: true };
  } catch {
    // Offline or the server has no key — English is better than nothing.
    return { cards: original, translated: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Synthesised speech                                                          */
/* -------------------------------------------------------------------------- */

interface CachedSpeech {
  key: string;
  audio: Blob;
}

/** Small, stable hash so the cache key doesn't store whole utterances. */
function speechKey(text: string, lang: string, rate: number): string {
  let hash = 5381;
  const input = `${lang}|${rate}|${text}`;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `${lang}:${(hash >>> 0).toString(36)}`;
}

/**
 * Fetches synthesised audio for `text`, cached on the device.
 *
 * Returns null when online speech is unavailable (no key, offline, or the
 * provider has no voice for the language) so the caller can fall back to the
 * device's own `speechSynthesis` voice.
 */
export async function fetchSpeechAudio(
  text: string,
  lang: string,
  rate = 0.95,
): Promise<Blob | null> {
  const key = speechKey(text, lang, rate);
  try {
    const db = await openDb();
    const store = db.transaction(STORES.speechCache, 'readonly').objectStore(STORES.speechCache);
    const hit = await req<CachedSpeech | undefined>(
      store.get(key) as IDBRequest<CachedSpeech | undefined>,
    );
    if (hit) return hit.audio;
  } catch {
    // Cache unreadable — just fall through and fetch.
  }

  try {
    const response = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, lang, rate }),
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    // Only accept actual audio: a proxy or captive portal can answer 200 with
    // an HTML error page, and handing that to <audio> fails confusingly.
    const type = (response.headers.get('content-type') ?? blob.type ?? '').toLowerCase();
    if (type && !type.startsWith('audio/') && !type.startsWith('application/octet-stream')) {
      return null;
    }

    try {
      const db = await openDb();
      const tx = db.transaction(STORES.speechCache, 'readwrite');
      tx.objectStore(STORES.speechCache).put({ key, audio: blob } satisfies CachedSpeech);
      await txDone(tx);
    } catch {
      // Caching is best-effort; the audio still plays.
    }
    return blob;
  } catch {
    return null;
  }
}

export async function clearSpeechCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.speechCache, 'readwrite');
    tx.objectStore(STORES.speechCache).clear();
    await txDone(tx);
  } catch {
    // Nothing to clear.
  }
}