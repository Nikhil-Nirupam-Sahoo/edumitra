/**
 * Lesson CONTENT translation.
 *
 * The UI strings were already translated, but lesson cards were not: content
 * ships as English JSON packs, so a student who picked Odia or Hindi got a
 * translated interface wrapped around English lessons. This endpoint closes
 * that gap.
 *
 * It takes one lesson's cards and returns the same cards translated, preserving
 * ids and structure so the client can render them with no transformation. The
 * client caches the result per (lesson, language) on the device, so a lesson is
 * translated once and then works offline.
 *
 * Same security rule as the rest: the Google key stays here.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LoadedConfig } from '../config.js';
import {
  bhashiniProvider,
  googleProvider,
  myMemoryProvider,
  translateWithFallback,
  type TranslationProvider,
} from './providers.js';

/**
 * A card, loosely typed: we validate the shape we care about and pass through
 * anything else untouched rather than hard-coding the whole lesson model here,
 * which would break whenever a new card type is added.
 */
const cardSchema = z.object({ id: z.string().min(1).max(64), type: z.string().min(1).max(24) }).passthrough();

const requestSchema = z.object({
  /** BCP-47-ish target code. */
  target: z.string().min(2).max(10),
  /** The lesson's cards, translated as one batch. */
  cards: z.array(cardSchema).min(1).max(200),
  /** Optional lesson id, used only for cache keys and logging. */
  lessonId: z.string().max(80).optional(),
  contentVersion: z.number().int().optional(),
});

/**
 * Which fields are prose the user reads, vs. structure we must not touch.
 * Nested paths use dotted notation; a miss is skipped rather than failing.
 */
const TRANSLATABLE_PATHS: Array<{ path: string; max: number }> = [
  { path: 'title', max: 300 },
  { path: 'body', max: 4000 },
  { path: 'caption', max: 500 },
  { path: 'transcript', max: 3000 },
  { path: 'question', max: 1000 },
  { path: 'explanation', max: 2000 },
  { path: 'options', max: 400 }, // handled as a list below
];

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

function set(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]!;
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}

interface CollectEntry {
  text: string;
  write: (value: string) => void;
}

/**
 * Walks the cards collecting every translatable string together with a closure
 * that writes the result back to the same place. Collecting first means one
 * API call per lesson instead of one per field, which is both faster and much
 * cheaper — Google bills per request as well as per character.
 */
function collect(cards: unknown[]): CollectEntry[] {
  const entries: CollectEntry[] = [];

  for (const rawCard of cards) {
    if (!rawCard || typeof rawCard !== 'object') continue;
    const card = rawCard as Record<string, unknown>;

    for (const { path, max } of TRANSLATABLE_PATHS) {
      if (path === 'options') continue;
      const value = get(card, path);
      if (typeof value === 'string' && value.trim().length > 0) {
        const target = card;
        entries.push({
          text: value.slice(0, max),
          write: (translated) => set(target, path, translated),
        });
      }
    }

    // Quiz options are a list of {id, text}; ids must survive untouched.
    const options = card.options;
    if (Array.isArray(options)) {
      options.forEach((option, index) => {
        if (!option || typeof option !== 'object') return;
        const text = (option as Record<string, unknown>).text;
        if (typeof text === 'string' && text.trim().length > 0) {
          const holder = option as Record<string, unknown>;
          entries.push({
            text: text.slice(0, 400),
            write: (translated) => {
              holder.text = translated;
            },
          });
        }
        void index;
      });
    }
  }
  return entries;
}

function apiKeyOf(options: ContentTranslateRouteOptions): string | null {
  return options.apiKey !== undefined
    ? options.apiKey
    : (process.env.GOOGLE_TRANSLATION_API_KEY ?? null);
}

function cacheKey(target: string, texts: string[]): string {
  let hash = 5381;
  for (const text of texts) {
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    hash = (hash ^ 0x9e3779b9) | 0;
  }
  return `${target}:${(hash >>> 0).toString(36)}`;
}

const CACHE_LIMIT = 400;
const cache = new Map<string, string[]>();

export interface ContentTranslateRouteOptions {
  config: LoadedConfig;
  apiKey?: string | null;
  /** Overrides the provider chain; injected by tests. */
  providers?: TranslationProvider[];
}

export async function registerContentTranslateRoutes(
  app: FastifyInstance,
  options: ContentTranslateRouteOptions,
): Promise<void> {
  // Google when a key is configured (better quality), MyMemory otherwise, so
  // content translation works with no key and no billing.
  const providers =
    options.providers ??
    [
      googleProvider(apiKeyOf(options)),
      myMemoryProvider(),
      bhashiniProvider(process.env.BHASHINI_API_KEY ?? null),
    ].filter((p) => p.ready());

  app.post(
    '/translate/content',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (providers.length === 0) {
        return reply.code(503).send({ error: 'translation_unavailable' });
      }

      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const { target, cards } = parsed.data;
      const entries = collect(cards);
      if (entries.length === 0) return { cards, cached: true, translated: 0 };

      const key = cacheKey(target, entries.map((e) => e.text));
      let translated = cache.get(key);

      if (!translated) {
        try {
          const result = await translateWithFallback(
            providers,
            entries.map((e) => e.text),
            target,
            request.log,
          );
          // Any field the provider did not return keeps its original English
          // rather than being blanked — a partly translated card is usable, an
          // empty one is not.
          translated = entries.map((entry, i) => result.translations[i] || entry.text);
          if (result.translations.length !== entries.length) {
            request.log.warn(
              { expected: entries.length, got: result.translations.length, target },
              'content translate partial response',
            );
          }
          if (cache.size >= CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
          }
          cache.set(key, translated);
          reply.header('x-translation-provider', result.provider);
        } catch (error) {
          request.log.warn({ err: error, target }, 'content translate failed');
          const reason = error instanceof Error ? error.message : 'unknown';
          reply.header('x-translation-error', reason.slice(0, 160));
          return reply.code(502).send({ error: 'upstream_error', reason });
        }
      }

      entries.forEach((entry, index) => entry.write(translated![index] || entry.text));

      reply.header('cache-control', 'no-store');
      return { cards, translated: entries.length };
    },
  );
}

export function clearContentTranslateCache(): void {
  cache.clear();
}