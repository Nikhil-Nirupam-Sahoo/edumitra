/**
 * Syllabus content — pack integrity + the download API.
 *
 * The curriculum lives in `content/` (manifest.json + packs/*.json) and is
 * served over HTTP. These tests guard both halves: the data on disk is
 * well-formed, and the endpoints hand it out safely.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerContentRoutes } from '../src/content/content.controller.js';
import type { LoadedConfig } from '../src/config.js';

const CONTENT_DIR = resolve(import.meta.dirname, '../../../content');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface Manifest {
  schema: number;
  contentVersion: number;
  files: Record<string, string>;
  counts: Record<string, number>;
  lessons: Array<{ id: string; grade: number; subject: string; title: string; cards: number; quizzes: number }>;
}

interface PackLesson {
  id: string;
  title: string;
  grade: number;
  subject: string;
  cards: Array<{ id: string; type: string; questionId?: string; options?: Array<{ id: string }>; correctOptionId?: string }>;
}

const manifest = existsSync(join(CONTENT_DIR, 'manifest.json'))
  ? readJson<Manifest>(join(CONTENT_DIR, 'manifest.json'))
  : null;

async function buildApp(dir = CONTENT_DIR): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(
    async (instance) => {
      await registerContentRoutes(instance, {
        config: { contentDir: dir } as LoadedConfig,
      });
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return app;
}

describe('content packs on disk', () => {
  it('manifest exists and is well formed', () => {
    expect(manifest).not.toBeNull();
    expect(manifest!.schema).toBe(1);
    expect(manifest!.contentVersion).toBeGreaterThan(0);
    expect(Object.keys(manifest!.files).length).toBeGreaterThan(0);
  });

  it('every manifest file resolves to a real pack', () => {
    for (const [name, url] of Object.entries(manifest!.files)) {
      const file = join(CONTENT_DIR, 'packs', `${name}.json`);
      expect(existsSync(file), `${name} pack exists (${url})`).toBe(true);
    }
  });

  it('has 36 lessons across classes 8, 9 and 10', () => {
    const lessons = Object.keys(manifest!.files).flatMap(
      (name) => readJson<PackLesson[]>(join(CONTENT_DIR, 'packs', `${name}.json`)),
    );
    expect(lessons.length).toBe(36);
    for (const grade of [8, 9, 10]) {
      expect(lessons.filter((l) => l.grade === grade).length).toBe(12);
    }
  });

  it('covers math, science, sst and english in every class', () => {
    const lessons = Object.keys(manifest!.files).flatMap(
      (name) => readJson<PackLesson[]>(join(CONTENT_DIR, 'packs', `${name}.json`)),
    );
    for (const grade of [8, 9, 10]) {
      const subjects = new Set(lessons.filter((l) => l.grade === grade).map((l) => l.subject));
      expect(subjects.has('math')).toBe(true);
      expect(subjects.has('science')).toBe(true);
      expect(subjects.has('sst')).toBe(true);
      expect(subjects.has('english')).toBe(true);
    }
  });

  it('manifest lesson index matches the packs', () => {
    const lessons = Object.keys(manifest!.files).flatMap(
      (name) => readJson<PackLesson[]>(join(CONTENT_DIR, 'packs', `${name}.json`)),
    );
    expect(manifest!.lessons.length).toBe(lessons.length);
    for (const entry of manifest!.lessons) {
      const lesson = lessons.find((l) => l.id === entry.id);
      expect(lesson, entry.id).toBeDefined();
      expect(lesson!.title).toBe(entry.title);
      expect(lesson!.cards.length).toBe(entry.cards);
      expect(lesson!.cards.filter((c) => c.type === 'quiz').length).toBe(entry.quizzes);
    }
  });

  it('lesson ids are unique', () => {
    const lessons = Object.keys(manifest!.files).flatMap(
      (name) => readJson<PackLesson[]>(join(CONTENT_DIR, 'packs', `${name}.json`)),
    );
    expect(new Set(lessons.map((l) => l.id)).size).toBe(lessons.length);
  });

  it('every lesson is renderable: has a quiz, ends with a summary, ids unique', () => {
    const lessons = Object.keys(manifest!.files).flatMap(
      (name) => readJson<PackLesson[]>(join(CONTENT_DIR, 'packs', `${name}.json`)),
    );
    for (const lesson of lessons) {
      const cardIds = new Set<string>();
      const questionIds = new Set<string>();
      for (const card of lesson.cards) {
        expect(cardIds.has(card.id), `${lesson.id}: duplicate card ${card.id}`).toBe(false);
        cardIds.add(card.id);
        if (card.type === 'quiz') {
          expect(questionIds.has(card.questionId!), `${lesson.id}: duplicate question`).toBe(false);
          questionIds.add(card.questionId!);
          const optionIds = (card.options ?? []).map((o) => o.id);
          expect(optionIds.length).toBeGreaterThanOrEqual(2);
          expect(optionIds).toContain(card.correctOptionId);
        }
      }
      expect(lesson.cards.some((c) => c.type === 'quiz'), `${lesson.id} has a quiz`).toBe(true);
      expect(lesson.cards.at(-1)?.type, `${lesson.id} ends with a summary`).toBe('summary');
    }
  });
});

describe('content API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves the manifest', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/manifest' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.json().contentVersion).toBe(manifest!.contentVersion);
    await app.close();
  });

  it('serves a pack by name, with or without the .json suffix', async () => {
    const app = await buildApp();
    const bare = await app.inject({ method: 'GET', url: '/api/v1/content/packs/class8' });
    const suffixed = await app.inject({ method: 'GET', url: '/api/v1/content/packs/class8.json' });
    expect(bare.statusCode).toBe(200);
    expect(suffixed.statusCode).toBe(200);
    expect(bare.json().length).toBe(12);
    await app.close();
  });

  it('lists available packs', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/packs' });
    expect(response.statusCode).toBe(200);
    expect(response.json().packs.sort()).toEqual(['class10', 'class8', 'class9']);
    await app.close();
  });

  it('404s an unknown pack', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/packs/nope' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('refuses path traversal out of the content directory', async () => {
    const app = await buildApp();
    for (const attack of [
      '../../../etc/passwd',
      '..%2F..%2Fpackage.json',
      '....//package',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/content/packs/${attack}`,
      });
      expect([400, 404], attack).toContain(response.statusCode);
    }
    await app.close();
  });

  it('404s when the content directory is missing', async () => {
    const app = await buildApp('/tmp/opencode/no-such-content-dir');
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/manifest' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});