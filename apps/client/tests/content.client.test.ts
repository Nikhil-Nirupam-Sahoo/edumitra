/**
 * Content client + bootstrap tests.
 *
 * Content arrives over HTTP and is cached in IndexedDB. These cover the whole
 * lifecycle against fake-indexeddb: first download, offline reuse, version
 * upgrade, and the failure modes that must never blank the app.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, getLessons, getAllStudents } from '../src/db/client';
import { bootstrap, buildSeedStudents } from '../src/db/seed';
import { installedContentVersion, syncContent } from '../src/content/client';
import type { PackLesson } from './fixtures/content';

function manifestResponse(version = 2) {
  return new Response(
    JSON.stringify({
      schema: 1,
      contentVersion: version,
      files: {
        class8: '/api/v1/content/packs/class8',
        class9: '/api/v1/content/packs/class9',
        class10: '/api/v1/content/packs/class10',
      },
      counts: { total: 3 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Fake server: serves the manifest + the three packs. */
function stubServer(version = 2) {
  const packs: Record<string, unknown> = {
    '/api/v1/content/packs/class8': [PACK_LESSONS[0]],
    '/api/v1/content/packs/class9': [PACK_LESSONS[1]],
    '/api/v1/content/packs/class10': [PACK_LESSONS[2]],
  };
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/content/manifest')) return manifestResponse(version);
    const pack = packs[url];
    if (pack) return new Response(JSON.stringify(pack), { status: 200 });
    return new Response('not found', { status: 404 });
  });
}

const PACK_LESSONS: PackLesson[] = [
  {
    id: 'c8-math-rational-numbers',
    title: 'Rational Numbers',
    grade: 8,
    subject: 'math',
    cards: [
      { id: 'c1', type: 'text', title: 'What is a rational number?', body: 'p/q where q is not 0.' },
      {
        id: 'c2',
        type: 'quiz',
        questionId: 'q1',
        question: 'Which is rational?',
        options: [
          { id: 'a', text: '1/3' },
          { id: 'b', text: '√2' },
        ],
        correctOptionId: 'a',
        explanation: '1/3 is a ratio of integers.',
      },
      { id: 'c3', type: 'summary', title: '🌟', body: 'p/q, q ≠ 0.' },
    ],
  },
  {
    id: 'c9-sci-motion',
    title: 'Motion',
    grade: 9,
    subject: 'science',
    cards: [
      { id: 'c1', type: 'text', title: 'Distance vs displacement', body: 'Path length vs straight line.' },
      {
        id: 'c2',
        type: 'quiz',
        questionId: 'q1',
        question: 'SI unit of velocity?',
        options: [
          { id: 'a', text: 'm/s' },
          { id: 'b', text: 'km/h' },
        ],
        correctOptionId: 'a',
        explanation: 'Velocity is metres per second.',
      },
      { id: 'c3', type: 'summary', title: '🌟', body: 'v = u + at.' },
    ],
  },
  {
    id: 'c10-en-clauses',
    title: 'Clauses',
    grade: 10,
    subject: 'english',
    cards: [
      { id: 'c1', type: 'text', title: 'Building blocks', body: 'A clause has a subject and a verb.' },
      {
        id: 'c2',
        type: 'quiz',
        questionId: 'q1',
        question: 'Which is the main clause?',
        options: [
          { id: 'a', text: 'We went out' },
          { id: 'b', text: 'Although it rained' },
        ],
        correctOptionId: 'a',
        explanation: 'The main clause stands alone.',
      },
      { id: 'c3', type: 'summary', title: '🌟', body: 'Main + subordinate.' },
    ],
  },
];

describe('content sync', () => {
  beforeEach(async () => {
    await clearAllData();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with no content cached', async () => {
    expect(await getLessons()).toHaveLength(0);
    expect(await installedContentVersion()).toBe(0);
  });

  it('downloads every pack and writes lessons into IndexedDB', async () => {
    vi.stubGlobal('fetch', stubServer());
    const result = await syncContent();

    expect(result).toEqual({ status: 'updated', lessons: 3, version: 2 });
    const lessons = await getLessons();
    expect(lessons).toHaveLength(3);
    expect(lessons.map((l) => l.id).sort()).toEqual([
      'c10-en-clauses',
      'c8-math-rational-numbers',
      'c9-sci-motion',
    ]);
    // Grade/subject metadata survives so the home tabs can group them.
    const c8 = lessons.find((l) => l.id === 'c8-math-rational-numbers');
    expect(c8?.grade).toBe(8);
    expect(c8?.subject).toBe('math');
    expect(await installedContentVersion()).toBe(2);
  });

  it('preserves the full card payload, including quizzes', async () => {
    vi.stubGlobal('fetch', stubServer());
    await syncContent();
    const lesson = (await getLessons()).find((l) => l.id === 'c8-math-rational-numbers');
    const parsed = JSON.parse(lesson!.content_json);
    expect(parsed.cards).toHaveLength(3);
    const quiz = parsed.cards.find((c: { type: string }) => c.type === 'quiz');
    expect(quiz.correctOptionId).toBe('a');
    expect(quiz.options).toHaveLength(2);
  });

  it('is a no-op when the cached version already matches', async () => {
    vi.stubGlobal('fetch', stubServer());
    await syncContent();
    const second = await syncContent();
    expect(second.status).toBe('up-to-date');
  });

  it('re-downloads when the server bumps contentVersion', async () => {
    vi.stubGlobal('fetch', stubServer(2));
    await syncContent();
    expect(await installedContentVersion()).toBe(2);

    vi.stubGlobal('fetch', stubServer(3));
    const result = await syncContent();
    expect(result.status).toBe('updated');
    expect(await installedContentVersion()).toBe(3);
    // Existing lesson content is refreshed, not duplicated.
    expect(await getLessons()).toHaveLength(3);
  });

  it('keeps cached lessons when offline (no throw, no data loss)', async () => {
    vi.stubGlobal('fetch', stubServer());
    await syncContent();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await syncContent();
    expect(result.status).toBe('offline');
    expect(await getLessons()).toHaveLength(3);
  });

  it('rejects a malformed pack rather than corrupting the store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/content/manifest')) return manifestResponse();
        // A lesson with no cards is unusable.
        return new Response(
          JSON.stringify([{ id: 'bad', title: 'Bad', grade: 8, subject: 'math', cards: [] }]),
          { status: 200 },
        );
      }),
    );
    const result = await syncContent();
    expect(result.status).toBe('invalid');
    expect(await getLessons()).toHaveLength(0);
  });

  it('reports offline on a 500 from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    expect((await syncContent()).status).toBe('offline');
  });
});

describe('bootstrap', () => {
  beforeEach(async () => {
    await clearAllData();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads content and seeds the roster', async () => {
    vi.stubGlobal('fetch', stubServer());
    const result = await bootstrap();

    expect(result.content).toBe('updated');
    expect(result.lessons).toBe(3);
    expect(result.contentUnavailable).toBe(false);
    expect(await getAllStudents()).toHaveLength(6);
  });

  it('is idempotent across repeated boots', async () => {
    vi.stubGlobal('fetch', stubServer());
    await bootstrap();
    const second = await bootstrap();
    expect(second.content).toBe('up-to-date');
    expect(await getLessons()).toHaveLength(3);
    expect(await getAllStudents()).toHaveLength(6);
  });

  it('flags contentUnavailable when nothing is cached and the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const result = await bootstrap();
    expect(result.content).toBe('offline');
    expect(result.lessons).toBe(0);
    // The UI must tell the user, not show an empty classroom.
    expect(result.contentUnavailable).toBe(true);
    // Students still seed so the app is usable the moment content arrives.
    expect(await getAllStudents()).toHaveLength(6);
  });

  it('does NOT flag unavailable when cached content survives an offline boot', async () => {
    vi.stubGlobal('fetch', stubServer());
    await bootstrap();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const result = await bootstrap();
    expect(result.contentUnavailable).toBe(false);
    expect(result.lessons).toBe(3);
  });

  it('builds a roster across classes 8, 9 and 10', () => {
    const classes = new Set(buildSeedStudents().map((s) => s.class_id));
    expect([...classes].sort()).toEqual(['class-10-a', 'class-8-a', 'class-9-a']);
  });
});