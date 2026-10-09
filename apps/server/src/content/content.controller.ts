/**
 * Syllabus content API.
 *
 * The curriculum is server-owned data, not part of the client bundle: the
 * client downloads the manifest and the packs once, stores the lessons in
 * IndexedDB, and then works entirely offline. Updating a chapter therefore
 * needs a content deploy only — the PWA bundle is untouched, and installed
 * devices refresh because `contentVersion` changed.
 *
 * Pack responses are immutable for a given version (the URL is versioned by
 * content), so they are safe to cache hard; the manifest must never be stale.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LoadedConfig } from '../config.js';

export const CONTENT_META_KEY = 'content.version';

const manifestSchema = z.object({
  schema: z.number(),
  contentVersion: z.number(),
  description: z.string().optional(),
  files: z.record(z.string(), z.string()),
  counts: z.record(z.string(), z.number()).optional(),
  lessons: z.array(z.unknown()).optional(),
});

/** Directory holding manifest.json + packs/. */
export function contentDir(config: LoadedConfig): string {
  return config.contentDir;
}

export interface ContentRouteOptions {
  config: LoadedConfig;
}

export async function registerContentRoutes(
  app: FastifyInstance,
  options: ContentRouteOptions,
): Promise<void> {
  const dir = resolve(options.config.contentDir);

  app.get('/content/manifest', async (_request, reply) => {
    const file = join(dir, 'manifest.json');
    if (!existsSync(file)) {
      return reply.code(404).send({ error: 'content_not_found' });
    }
    const body = await readFile(file, 'utf8');
    // Validate before publishing: a malformed manifest would leave clients
    // unable to fetch anything at all.
    const parsed = manifestSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      options.config.isTest || reply.log.error({ issues: parsed.error.issues }, 'invalid content manifest');
      return reply.code(500).send({ error: 'content_invalid' });
    }
    reply.header('cache-control', 'no-cache');
    return reply.type('application/json').send(body);
  });

  app.get('/content/packs/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    // Allow `class8` or `class8.json`, reject anything that escapes the dir.
    const clean = basename(normalize(name)).replace(/\.json$/i, '');
    if (!/^[a-z0-9_-]+$/i.test(clean) || extname(clean) !== '') {
      return reply.code(400).send({ error: 'invalid_pack_name' });
    }
    const file = join(dir, 'packs', `${clean}.json`);
    if (!file.startsWith(join(dir, 'packs') + sep) || !existsSync(file)) {
      return reply.code(404).send({ error: 'content_not_found' });
    }
    const body = await readFile(file, 'utf8');
    reply.header('cache-control', 'public, max-age=3600');
    return reply.type('application/json').send(body);
  });

  /** Local/dev helper: which packs exist on disk. */
  app.get('/content/packs', async (_request, reply) => {
    const packsDir = join(dir, 'packs');
    if (!existsSync(packsDir)) return reply.send({ packs: [] });
    const files = await readdir(packsDir);
    reply.header('cache-control', 'no-cache');
    return reply.send({
      packs: files.filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json')),
    });
  });
}