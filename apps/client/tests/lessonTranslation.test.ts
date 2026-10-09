// @vitest-environment jsdom
/**
 * Lesson translation + speech cache tests.
 *
 * Two properties carry all the weight here:
 *  - content must NEVER come back blank. Every failure path — no key, offline,
 *    a malformed response — returns the original English cards, because an
 *    untranslated lesson is strictly better than an empty one.
 *  - a translation must be invalidated when the content it was made from
 *    changes, or a student reads yesterday's wording for today's chapter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cardsForLocale,
  clearSpeechCache,
  clearTranslations,
  fetchSpeechAudio,
  getTranslatedCards,
  putTranslatedCards,
} from '../src/content/lessonTranslation';
import { clearAllData, upsertLessons } from '../src/db/client';

const CARDS = [
  { id: 'c1', type: 'text', title: 'A linear equation', body: 'Highest power is one.' },
];

async function seedLesson(version: number = 2): Promise<void> {
  await clearAllData();
  await upsertLessons([
    {
      id: 'l1',
      title: 'Linear Equations',
      language: 'en',
      version,
      updated_at: 1,
      grade: 8,
      subject: 'math',
      content_json: JSON.stringify({ version, language: 'en', cards: CARDS }),
    } as never,
  ]);
}

beforeEach(async () => {
  await clearAllData();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cardsForLocale', () => {
  // Wrapped, not passed by reference: vitest calls a beforeEach hook with a
  // context object, which would land in seedLesson's `version` parameter and
  // end up stored (and un-clonable) inside the lesson record.
  beforeEach(() => seedLesson());

  it('returns English unchanged with no round-trip for the English locale', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await cardsForLocale('l1', 'en');
    expect(result.translated).toBe(false);
    expect(result.cards).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns English unchanged for a language we do not translate into', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await cardsForLocale('l1', 'fr');
    expect(result.translated).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and caches translated cards for Odia', async () => {
    const translated = [{ id: 'c1', type: 'text', title: 'ରେଖା ସମୀକରଣ', body: 'ଉଚ୍ଚତମ ଘାତ ଏକ।' }];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ cards: translated }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await cardsForLocale('l1', 'or');
    expect(first.translated).toBe(true);
    expect(first.cards[0]!.title).toBe('ରେଖା ସମୀକରଣ');

    // Second visit is served from the device — no second request.
    const second = await cardsForLocale('l1', 'or');
    expect(second.translated).toBe(true);
    expect(second.cards[0]!.title).toBe('ରେଖା ସମୀକରଣ');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to English when the server has no key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 503 })),
    );
    const result = await cardsForLocale('l1', 'hi');
    expect(result.translated).toBe(false);
    expect(result.cards[0]!.title).toBe('A linear equation');
  });

  it('falls back to English offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    const result = await cardsForLocale('l1', 'ta');
    expect(result.translated).toBe(false);
    expect(result.cards).toHaveLength(1);
  });

  it('falls back when the server returns a malformed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );
    const result = await cardsForLocale('l1', 'or');
    expect(result.translated).toBe(false);
    expect(result.cards[0]!.title).toBe('A linear equation');
  });

  it('returns empty cards for a lesson that does not exist', async () => {
    const result = await cardsForLocale('does-not-exist', 'or');
    expect(result.cards).toEqual([]);
    expect(result.translated).toBe(false);
  });
});

describe('translation cache invalidation', () => {
  it('discards a translation made from an older content version', async () => {
    await putTranslatedCards('l1', 'or', 2, [
      { id: 'c1', type: 'text', title: 'old wording', body: '' } as never,
    ]);
    expect(await getTranslatedCards('l1', 'or', 2)).not.toBeNull();
    // The chapter was reworded: yesterday's translation must not be reused.
    expect(await getTranslatedCards('l1', 'or', 3)).toBeNull();
  });

  it('keeps translations separate per language', async () => {
    await putTranslatedCards('l1', 'or', 2, [{ id: 'c1', type: 'text', title: 'odia', body: '' } as never]);
    await putTranslatedCards('l1', 'hi', 2, [{ id: 'c1', type: 'text', title: 'hindi', body: '' } as never]);
    expect((await getTranslatedCards('l1', 'or', 2))?.[0]?.title).toBe('odia');
    expect((await getTranslatedCards('l1', 'hi', 2))?.[0]?.title).toBe('hindi');
  });

  it('clearTranslations drops everything', async () => {
    await putTranslatedCards('l1', 'or', 2, CARDS as never);
    await clearTranslations();
    expect(await getTranslatedCards('l1', 'or', 2)).toBeNull();
  });

  it('never caches for English, which needs no translation', async () => {
    expect(await getTranslatedCards('l1', 'en', 2)).toBeNull();
  });
});

describe('fetchSpeechAudio', () => {
  const audio = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' });

  it('fetches audio and caches it', async () => {
    const fetchMock = vi.fn(
      async () => new Response(audio(), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchSpeechAudio('hello', 'or');
    expect(first).not.toBeNull();
    const second = await fetchSpeechAudio('hello', 'or');
    expect(second).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by language, so Odia and Hindi are separate', async () => {
    const fetchMock = vi.fn(
      async () => new Response(audio(), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchSpeechAudio('hello', 'or');
    await fetchSpeechAudio('hello', 'hi');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by rate', async () => {
    const fetchMock = vi.fn(
      async () => new Response(audio(), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchSpeechAudio('hello', 'en', 0.8);
    await fetchSpeechAudio('hello', 'en', 1.2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null offline so the caller falls back to device voices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await fetchSpeechAudio('hello', 'or')).toBeNull();
  });

  it('returns null when the server has no key configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    expect(await fetchSpeechAudio('hello', 'or')).toBeNull();
  });

  it('returns null for an empty audio body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([]), { status: 200 })),
    );
    expect(await fetchSpeechAudio('hello', 'en')).toBeNull();
  });

  it('refuses a non-audio 200, e.g. a captive portal HTML page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Sign in to continue</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    // Handing HTML to <audio> would fail in the player, not here.
    expect(await fetchSpeechAudio('hello', 'en')).toBeNull();
  });

  it('clearing the cache forces a refetch', async () => {
    const fetchMock = vi.fn(
      async () => new Response(audio(), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchSpeechAudio('hello', 'or');
    await clearSpeechCache();
    await fetchSpeechAudio('hello', 'or');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});