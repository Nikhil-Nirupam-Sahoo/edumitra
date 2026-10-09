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

/**
 * Bhashini (Government of India) — free, and the only genuinely free source I
 * could find that has an Odia voice. Google TTS needs a billing account and
 * Edge's voices stop at Hindi/Tamil/etc; Bhashini covers Odia and the rest of
 * the Indic set. A free key (no card) raises the rate limits.
 */
const BHASHINI_ENDPOINT = 'https://tts.bhashini.ai/v2/synthesize';

/** Bhashini names languages in full, not by code. */
const BHASHINI_LANGUAGE: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  bn: 'Bengali',
  mr: 'Marathi',
  te: 'Telugu',
  ta: 'Tamil',
  gu: 'Gujarati',
  ur: 'Urdu',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
  or: 'Odia',
  as: 'Assamese',
  ne: 'Nepali',
  sa: 'Sanskrit',
  mai: 'Maithili',
  bod: 'Bodo',
  doi: 'Dogri',
};

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
  /** Overrides BHASHINI_API_KEY; injected by tests. */
  bhashiniKey?: string | null;
}

export async function registerTtsRoutes(
  app: FastifyInstance,
  options: TtsRouteOptions,
): Promise<void> {
  const apiKey =
    options.apiKey !== undefined
      ? options.apiKey
      : (process.env.GOOGLE_TRANSLATION_API_KEY ?? null);

  /**
   * Order matters: Google is the best voice but costs money to switch on,
   * Bhashini is free and covers Odia. Whichever answers first wins.
   */
  const bhashiniKey =
    options.bhashiniKey !== undefined
      ? options.bhashiniKey
      : (process.env.BHASHINI_API_KEY ?? null);
  const engines = [
    apiKey ? ('google' as const) : null,
    bhashiniKey !== null ? ('bhashini' as const) : null,
  ].filter((e): e is 'google' | 'bhashini' => e !== null);

  app.get('/tts/status', async () => ({
    enabled: engines.length > 0,
    engines,
  }));

  app.post(
    '/tts',
    // Audio is small but a busy classroom replays the same card repeatedly;
    // a per-route bucket also keeps a runaway client from burning a free quota.
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (engines.length === 0) return reply.code(503).send({ error: 'tts_unavailable' });

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

      for (const engine of engines) {
        try {
          const audio =
            engine === 'google'
              ? await synthesiseGoogle(apiKey!, text, lang, rate)
              : await synthesiseBhashini(bhashiniKey, text, lang, rate);
          if (!audio) continue;

          if (cache.size >= CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
          }
          cache.set(key, { audio, contentType: 'audio/mpeg' });

          reply.header('x-tts-cache', 'miss');
          reply.header('x-tts-engine', engine);
          reply.header('cache-control', 'public, max-age=86400');
          return reply.type('audio/mpeg').send(audio);
        } catch (error) {
          request.log.warn({ err: error, engine }, 'tts engine failed');
          // Try the next engine before giving up.
        }
      }
      return reply.code(502).send({ error: 'upstream_error' });
    },
  );
}

async function synthesiseGoogle(
  apiKey: string,
  text: string,
  lang: string,
  rate: number | undefined,
): Promise<Buffer | null> {
  const voice = resolveVoice(lang);
  const response = await fetch(`${SYNTH_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice,
      audioConfig: { audioEncoding: 'MP3', speakingRate: rate ?? 0.95 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { audioContent?: string };
  if (!payload.audioContent) return null;
  return Buffer.from(payload.audioContent, 'base64');
}

/**
 * Bhashini returns raw MP3. A free key goes in `X-API-KEY`; without one it
 * still serves requests at a lower rate limit.
 */
async function synthesiseBhashini(
  apiKey: string | null,
  text: string,
  lang: string,
  rate: number | undefined,
): Promise<Buffer | null> {
  const base = lang.split(/[-_]/)[0]!.toLowerCase();
  const language = BHASHINI_LANGUAGE[base];
  if (!language) return null; // unsupported here; the device voice will do

  const response = await fetch(BHASHINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
    },
    body: JSON.stringify({
      text,
      language,
      voiceName: 'Female1',
      voiceStyle: 'Neutral',
      ...(rate ? { speechRate: rate } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`bhashini ${response.status}: ${(await response.text().catch(() => '')).slice(0, 120)}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  return audio.length > 0 ? audio : null;
}

export function clearTtsCache(): void {
  cache.clear();
}