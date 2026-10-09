/**
 * Chapter photograph API.
 *
 * Same contract as the syllabus content packs: the server owns the files, the
 * client downloads them once, caches them, and works offline afterwards. The
 * alternative — hotlinking a remote <img> — would show a broken box the moment
 * a student loses signal, which is the one situation this app is built for.
 *
 * Every response carries the photographer and licence, because CC BY requires
 * attribution and the app displays it.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LoadedConfig } from '../config.js';

const manifestSchema = z.object({
  schema: z.number(),
  images: z.record(
    z.string(),
    z.object({
      credit: z.string(),
      license: z.string(),
      sourceUrl: z.string(),
      commonsTitle: z.string(),
      sizes: z.object({ card: z.number(), hero: z.number() }),
    }),
  ),
});

export interface ImageRouteOptions {
  config: LoadedConfig;
}

export async function registerImageRoutes(
  app: FastifyInstance,
  options: ImageRouteOptions,
): Promise<void> {
  const dir = resolve(options.config.imagesDir);

  app.get('/images/manifest', async (_request, reply) => {
    const file = join(dir, 'manifest.json');
    if (!existsSync(file)) return reply.code(404).send({ error: 'images_not_found' });
    const body = await readFile(file, 'utf8');
    const parsed = manifestSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      reply.log.error({ issues: parsed.error.issues }, 'invalid images manifest');
      return reply.code(500).send({ error: 'images_invalid' });
    }
    reply.header('cache-control', 'no-cache');
    return reply.type('application/json').send(body);
  });

  app.get('/images/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    // Same traversal guard as the content packs: basename + a strict allowlist.
    const clean = basename(normalize(name));
    if (!/^[a-z0-9-]+\.(card|hero)\.webp$/i.test(clean) || extname(clean) === '') {
      return reply.code(400).send({ error: 'invalid_image_name' });
    }
    const file = join(dir, clean);
    if (!file.startsWith(dir + sep) || !existsSync(file)) {
      return reply.code(404).send({ error: 'image_not_found' });
    }
    const body = await readFile(file);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.header('content-type', 'image/webp');
    // Attribution data is served alongside; keep the image readable cross-origin
    // only if a future CDN needs it.
    reply.header('cross-origin-resource-policy', 'same-origin');
    return reply.send(body);
  });

  /** Local/dev helper: what is actually on disk. */
  app.get('/images', async (_request, reply) => {
    const manifest = join(dir, 'manifest.json');
    if (!existsSync(manifest)) return reply.send({ images: [] });
    const parsed = JSON.parse(await readFile(manifest, 'utf8')) as {
      images: Record<string, unknown>;
    };
    reply.header('cache-control', 'no-cache');
    return reply.send({ ids: Object.keys(parsed.images ?? {}) });
  });
}