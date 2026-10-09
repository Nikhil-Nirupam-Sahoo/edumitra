/**
 * Online TTS + lesson-content translation tests.
 *
 * The upstream calls are always stubbed — no real key is used. What is under
 * test is the contract the client depends on:
 *  - TTS is inert (503) without a key and never calls Google in that case;
 *  - the key travels in the query string server-side only, never in a response;
 *  - repeat requests are served from cache, since Google bills per character
 *    and every card on every device asks for the same text;
 *  - content translation preserves card ids and structure while translating
 *    only the prose, and falls back rather than blanking a card if Google
 *    returns a short response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  clearTtsCache,
  registerTtsRoutes,
  resolveVoice,
} from '../src/tts/tts.controller.js';
import {
  clearContentTranslateCache,
  registerContentTranslateRoutes,
} from '../src/translate/content-translate.controller.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DB_DRIVER: 'dev',
  SYNC_SIGNING_SECRET: 'test-secret-at-least-16-chars',
} as NodeJS.ProcessEnv);

async function build(apiKey: string | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(
    async (i) => registerTtsRoutes(i, { config, apiKey }),
    { prefix: '/api/v1' },
  );
  await app.register(
    async (i) => registerContentTranslateRoutes(i, { config, apiKey }),
    { prefix: '/api/v1' },
  );
  await app.ready();
  return app;
}

/** Base64 MP3-ish bytes. */
const AUDIO_B64 = Buffer.from('ID3-fake-audio-payload').toString('base64');

describe('resolveVoice', () => {
  it('maps a short locale onto the region Google expects', () => {
    expect(resolveVoice('or')).toEqual({ languageCode: 'or-IN', name: 'or-IN-Wavenet-A' });
    expect(resolveVoice('hi').languageCode).toBe('hi-IN');
    expect(resolveVoice('ta').languageCode).toBe('ta-IN');
  });

  it('keeps an explicit region tag', () => {
    expect(resolveVoice('en-GB')).toEqual({ languageCode: 'en-GB' });
  });

  it('falls back to a standard voice for an unlisted language', () => {
    expect(resolveVoice('fr')).toEqual({ languageCode: 'fr' });
  });
});

describe('GET /api/v1/tts/status', () => {
  it('reports disabled without a key and enabled with one', async () => {
    const off = await build(null);
    expect((await off.inject({ method: 'GET', url: '/api/v1/tts/status' })).json()).toEqual({
      enabled: false,
    });
    await off.close();

    const on = await build('k');
    expect((await on.inject({ method: 'GET', url: '/api/v1/tts/status' })).json()).toEqual({
      enabled: true,
    });
    await on.close();
  });
});

describe('POST /api/v1/tts', () => {
  beforeEach(() => {
    clearTtsCache();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns 503 and no upstream call when unconfigured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const app = await build(null);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tts',
      payload: { text: 'ନମସ୍କାର', lang: 'or' },
    });
    expect(response.statusCode).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects empty and oversized text', async () => {
    const app = await build('k');
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/tts', payload: { text: '', lang: 'en' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/tts',
          payload: { text: 'x'.repeat(5000), lang: 'en' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('synthesises audio and never leaks the key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ audioContent: AUDIO_B64 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await build('super-secret-tts-key');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tts',
      payload: { text: 'ଆପଣଙ୍କ ସ୍କୋର', lang: 'or', rate: 0.9 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('audio/mpeg');
    expect(response.headers['x-tts-cache']).toBe('miss');
    expect(response.body).not.toContain('super-secret-tts-key');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('texttospeech.googleapis.com');
    // The key is in the upstream URL only — never in anything sent back.
    expect(url).toContain('super-secret-tts-key');
    const body = JSON.parse(String(init.body)) as {
      voice: { languageCode: string; name?: string };
      audioConfig: { speakingRate: number };
    };
    expect(body.voice.languageCode).toBe('or-IN');
    expect(body.voice.name).toBe('or-IN-Wavenet-A');
    expect(body.audioConfig.speakingRate).toBe(0.9);
    await app.close();
  });

  it('serves a repeat request from cache without calling Google again', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ audioContent: AUDIO_B64 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await build('k');
    const payload = { text: 'Same text', lang: 'hi' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/tts', payload });
    const second = await app.inject({ method: 'POST', url: '/api/v1/tts', payload });

    expect(first.headers['x-tts-cache']).toBe('miss');
    expect(second.headers['x-tts-cache']).toBe('hit');
    expect(second.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('surfaces an upstream failure as 502 so the client falls back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('quota', { status: 429 })),
    );
    const app = await build('k');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tts',
      payload: { text: 'hello', lang: 'en' },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('upstream_error');
    await app.close();
  });

  it('treats a response with no audio as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const app = await build('k');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tts',
      payload: { text: 'hello', lang: 'en' },
    });
    expect(response.statusCode).toBe(502);
    await app.close();
  });
});

describe('POST /api/v1/translate/content', () => {
  const CARDS = [
    {
      id: 'c1',
      type: 'text',
      title: 'A linear equation',
      body: 'An equation whose highest power of the variable is one.',
    },
    {
      id: 'c2',
      type: 'quiz',
      questionId: 'q1',
      question: 'Which of these is rational?',
      options: [
        { id: 'a', text: 'one third' },
        { id: 'b', text: 'the square root of two' },
      ],
      correctOptionId: 'a',
      explanation: 'One third is a ratio of two integers.',
    },
  ];

  beforeEach(() => {
    clearContentTranslateCache();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubGoogle(texts: string[]): ReturnType<typeof vi.fn> {
    const mock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { translations: texts.map((t) => ({ translatedText: t })) },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('returns 503 with no key and never calls Google', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const app = await build(null);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'or', cards: CARDS },
    });
    expect(response.statusCode).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('translates prose while preserving ids and structure', async () => {
    // Collected in document order: title, body, question, explanation, options.
    stubGoogle(['ଟି', 'ଶବ୍ଦ', 'ପ୍ରଶ୍ନ', 'କାହିଁକି', 'ହଁ', 'ନା']);
    const app = await build('k');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'or', cards: CARDS, lessonId: 'l1' },
    });

    expect(response.statusCode).toBe(200);
    const { cards } = response.json() as { cards: typeof CARDS };
    // Structure survives verbatim — a changed id would break progress tracking.
    expect(cards.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(cards[0]!.type).toBe('text');
    expect(cards[1]!.correctOptionId).toBe('a');
    expect(cards[1]!.questionId).toBe('q1');
    // Prose is translated.
    expect(cards[0]!.title).toBe('ଟି');
    expect(cards[0]!.body).toBe('ଶବ୍ଦ');
    const quiz = cards[1]!;
    expect(quiz.question).toBe('ପ୍ରଶ୍ନ');
    expect(quiz.explanation).toBe('କାହିଁକି');
    expect(quiz.options?.[0]?.text).toBe('ହଁ');
    expect(quiz.options?.[1]?.text).toBe('ନା');
    expect(quiz.options?.[0]?.id).toBe('a');
    await app.close();
  });

  it('translates the explanation too when Google returns enough strings', async () => {
    stubGoogle(['t', 'b', 'q', 'why', 'o1', 'o2']);
    const app = await build('k');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'hi', cards: CARDS },
    });
    const { cards } = response.json() as { cards: typeof CARDS };
    expect(cards[1]!.explanation).toBe('why');
    await app.close();
  });

  it('sends one request per lesson rather than one per field', async () => {
    const mock = stubGoogle(['t', 'b', 'q', 'why', 'o1', 'o2']);
    const app = await build('k');
    await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'ta', cards: CARDS },
    });
    expect(mock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(
      (mock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as { q: string[] };
    expect(sent.q.length).toBe(6);
    await app.close();
  });

  it('caches by content, so re-opening a lesson costs nothing', async () => {
    const mock = stubGoogle(['t', 'b', 'q', 'why', 'o1', 'o2']);
    const app = await build('k');
    await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'or', cards: CARDS },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'or', cards: CARDS },
    });
    expect(mock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('keys the cache by language, so switching back and forth is free', async () => {
    const mock = stubGoogle(['t', 'b', 'q', 'why', 'o1', 'o2']);
    const app = await build('k');
    await app.inject({ method: 'POST', url: '/api/v1/translate/content', payload: { target: 'or', cards: CARDS } });
    await app.inject({ method: 'POST', url: '/api/v1/translate/content', payload: { target: 'hi', cards: CARDS } });
    expect(mock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('refuses a short response rather than blanking a card', async () => {
    // Google returned fewer items than asked for; writing these would leave
    // the last card with no text at all.
    stubGoogle(['only one']);
    const app = await build('k');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'or', cards: CARDS },
    });
    expect(response.statusCode).toBe(502);
    await app.close();
  });

  it('rejects malformed requests', async () => {
    const app = await build('k');
    expect(
      (await app.inject({
        method: 'POST',
        url: '/api/v1/translate/content',
        payload: { target: 'or', cards: [] },
      })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({
        method: 'POST',
        url: '/api/v1/translate/content',
        payload: { target: 'o', cards: CARDS },
      })).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('short-circuits a lesson with nothing translatable', async () => {
    const mock = stubGoogle([]);
    const app = await build('k');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/content',
      payload: { target: 'or', cards: [{ id: 'c1', type: 'image', imageUrl: '/x.webp' }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().translated).toBe(0);
    expect(mock).not.toHaveBeenCalled();
    await app.close();
  });
});