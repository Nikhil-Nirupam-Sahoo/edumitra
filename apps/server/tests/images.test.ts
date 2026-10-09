/**
 * Images API tests — the chapter-photograph endpoints.
 *
 * Two properties matter: the manifest is validated before it is published (a
 * malformed one would leave every client unable to load any photo), and the
 * file route cannot be walked out of the images directory.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerImageRoutes } from '../src/images/images.controller.js';
import { loadConfig, type LoadedConfig } from '../src/config.js';

const IMAGES_DIR = resolve(import.meta.dirname, '../../../images');

let app: FastifyInstance;

beforeAll(async () => {
  if (!existsSync(IMAGES_DIR)) {
    // Photo curation is a separate, network-dependent step; don't fail the
    // suite when the directory has not been populated locally.
    return;
  }
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'dev',
    SYNC_SIGNING_SECRET: 'test-secret-at-least-16-chars',
    IMAGES_DIR,
  } as NodeJS.ProcessEnv);
  app = Fastify({ logger: false });
  await app.register(
    async (instance) => {
      await registerImageRoutes(instance, { config: config as LoadedConfig });
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

const maybe = existsSync(IMAGES_DIR) ? it : it.skip;

describe('GET /api/v1/images/manifest', () => {
  maybe('publishes a manifest with attribution for every image', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/images/manifest' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      images: Record<string, { credit: string; license: string; sourceUrl: string }>;
    };
    const entries = Object.entries(body.images);
    expect(entries.length).toBeGreaterThan(0);
    for (const [lessonId, entry] of entries) {
      expect(lessonId, 'attribution').toBeTruthy();
      expect(entry.credit, `${lessonId} credit`).toBeTruthy();
      // CC BY is only lawful with attribution, so a licence must always ship.
      expect(entry.license, `${lessonId} license`).toBeTruthy();
      expect(entry.sourceUrl, `${lessonId} source`).toContain('http');
    }
  });

  maybe('is never cached — a new photo must reach installed devices', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/images/manifest' });
    expect(response.headers['cache-control']).toBe('no-cache');
  });
});

describe('GET /api/v1/images/:name', () => {
  maybe('serves a WebP with a long immutable cache', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/images/c8-math-linear-equations.card.webp',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['cache-control']).toContain('immutable');
  });

  maybe('404s for a photo that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/images/no-such-lesson.card.webp',
    });
    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['../../package.json', 'parent traversal'],
    ['..%2F..%2Fpackage.json', 'encoded traversal'],
    ['/etc/passwd', 'absolute path'],
    ['manifest.json', 'non-image file'],
    ['c8-math-linear-equations.card.webp.exe', 'wrong extension'],
    ['c8-math-linear-equations.jpg', 'wrong image type'],
  ])('rejects %s (%s)', async (name) => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/images/${name}` });
    expect([400, 404]).toContain(response.statusCode);
  });
});

describe('GET /api/v1/images', () => {
  maybe('lists the chapters that have photos', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/images' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { ids: string[] };
    expect(body.ids).toContain('c8-math-linear-equations');
  });
});

describe('photos directory', () => {
  maybe('every manifest entry has both sizes on disk', async () => {
    const manifest = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(join(IMAGES_DIR, 'manifest.json'), 'utf8')),
    ) as { images: Record<string, unknown> };
    for (const lessonId of Object.keys(manifest.images)) {
      for (const size of ['card', 'hero']) {
        const file = join(IMAGES_DIR, `${lessonId}.${size}.webp`);
        expect(existsSync(file), `${lessonId}.${size}.webp missing`).toBe(true);
      }
    }
  });
});