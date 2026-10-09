/**
 * Online text-to-speech proxy.
 *
 * Uses Google Cloud Text-to-Speech with the SAME key as Cloud Translation —
 * one key in the environment enables both. The browser never sees it: it POSTs
 * text to /api/v1/tts and receives audio.
 *
 * Offline behaviour is deliberate: this endpoint needs the network, so the
 * client prefers it (natural, high-quality voices in every Indian language
 * including Odia) and falls back to the built-in `speechSynthesis` voices when
 * it is unreachable or the key is unset. That way read-aloud never breaks —
 * it just sounds different.
 *
 * Results are cached in memory here (identical text+voice is requested
 * repeatedly by every card on every device) and on the device by the caller.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LoadedConfig } from '../config.js';

const SYNTH_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

const requestSchema = z.object({
  text: z.string().min(1).max(3000),
  /** BCP-47 code, e.g. "hi", "or", "ta", "en-IN". */
  lang: z.string().min(2).max(10),
  /** Speaking rate, 0.25–2.0. Defaults to a learner-friendly pace. */
  rate: z.number().min(0.25).max(2).optional(),
});

/**
 * Preferred voices per language.
 *
 * Odia (`or-IN`) is the reason this exists beyond the bundled UI languages:
 * `speechSynthesis` has no Odia voice on most devices, so the online path is
 * the only way an Odia reader gets read-aloud at all. Anything not listed uses
 * the standard voice for its language code, which always exists.
 */
const PREFERRED_VOICES: Record<string, string> = {
  'or-IN': 'or-IN-Wavenet-A',
  'or': 'or-IN-Wavenet-A',
  'hi-IN': 'hi-IN-Neural2-A',
  'hi': 'hi-IN-Neural2-A',
  'ta-IN': 'ta-IN-Neural2-A',
  'ta': 'ta-IN-Neural2-A',
  'en-IN': 'en-IN-Neural2-A',
  'en': 'en-IN-Neural2-A',
  'bn-IN': 'bn-IN-Standard-A',
  'bn': 'bn-IN-Standard-A',
  'mr-IN': 'mr-IN-Standard-A',
  'te-IN': 'te-IN-Standard-A',
  'gu-IN': 'gu-IN-Standard-A',
  'kn-IN': 'kn-IN-Standard-A',
  'ml-IN': 'ml-IN-Standard-A',
  'pa-IN': 'pa-IN-Standard-A',
  'ur-IN': 'ur-IN-Standard-A',
};

/** Map a short app locale onto the region Google expects. */
const LOCALE_MAP: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  or: 'or-IN',
  bn: 'bn-IN',
  mr: 'mr-IN',
  te: 'te-IN',
  gu: 'gu-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  pa: 'pa-IN',
  ur: 'ur-IN',
};

export function resolveVoice(lang: string): { languageCode: string; name?: string } {
  const exact = PREFERRED_VOICES[lang];
  if (exact) {
    const languageCode = lang.includes('-') ? lang : LOCALE_MAP[lang] ?? lang;
    return { languageCode, name: exact };
  }
  // An explicit region must win: 'en-GB' is not Indian English, and silently
  // serving an en-IN voice for it would be wrong.
  if (lang.includes('-')) return { languageCode: lang };
  const base = lang.split(/[-_]/)[0]!.toLowerCase();
  return { languageCode: LOCALE_MAP[base] ?? lang };
}

interface CacheEntry {
  audio: Buffer;
  contentType: string;
}

const CACHE_LIMIT = 300;
const cache = new Map<string, CacheEntry>();

export interface TtsRouteOptions {
  config: LoadedConfig;
  /** Overrides GOOGLE_TRANSLATION_API_KEY; injected by tests. */
  apiKey?: string | null;
}

export async function registerTtsRoutes(
  app: FastifyInstance,
  options: TtsRouteOptions,
): Promise<void> {
  const apiKey =
    options.apiKey !== undefined
      ? options.apiKey
      : (process.env.GOOGLE_TRANSLATION_API_KEY ?? null);

  app.get('/tts/status', async () => ({ enabled: apiKey !== null }));

  app.post(
    '/tts',
    // Audio is small but a busy classroom replays the same card repeatedly;
    // a per-route bucket also keeps a runaway client from billing the key.
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!apiKey) return reply.code(503).send({ error: 'tts_unavailable' });

      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const { text, lang, rate } = parsed.data;
      const key = `${lang}|${rate ?? ''}|${text}`;
      const hit = cache.get(key);
      if (hit) {
        // Refresh recency for the LRU below.
        cache.delete(key);
        cache.set(key, hit);
        reply.header('x-tts-cache', 'hit');
        reply.header('cache-control', 'public, max-age=86400');
        return reply.type(hit.contentType).send(hit.audio);
      }

      const voice = resolveVoice(lang);
      try {
        const response = await fetch(`${SYNTH_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice,
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: rate ?? 0.95,
            },
          }),
          signal: AbortSignal.timeout(20_000),
        });

        if (!response.ok) {
          // A bad language code or a disabled API must not look like success.
          request.log.warn({ status: response.status, lang }, 'tts upstream failed');
          return reply.code(502).send({ error: 'upstream_error' });
        }

        const payload = (await response.json()) as { audioContent?: string };
        if (!payload.audioContent) {
          return reply.code(502).send({ error: 'empty_audio' });
        }

        const audio = Buffer.from(payload.audioContent, 'base64');
        if (cache.size >= CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest) cache.delete(oldest);
        }
        cache.set(key, { audio, contentType: 'audio/mpeg' });

        reply.header('x-tts-cache', 'miss');
        reply.header('cache-control', 'public, max-age=86400');
        return reply.type('audio/mpeg').send(audio);
      } catch (error) {
        request.log.warn({ err: error }, 'tts request failed');
        return reply.code(502).send({ error: 'upstream_error' });
      }
    },
  );
}

export function clearTtsCache(): void {
  cache.clear();
}