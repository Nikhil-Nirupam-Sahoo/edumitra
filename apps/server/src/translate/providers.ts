/**
 * Translation providers, best-available first.
 *
 * Google Cloud Translation is the highest quality but requires a billing
 * account, which is a non-starter for a school project. MyMemory is free,
 * needs no key and no billing, and handles every Indian language we ship
 * (verified against Odia and Hindi), so it is the default. Adding a Google key
 * transparently upgrades quality — nothing else changes.
 *
 * Both live behind one interface so the routes do not care which is answering,
 * and a provider that fails or is exhausted falls through to the next rather
 * than surfacing an error to a student mid-lesson.
 */

export interface TranslationProvider {
  readonly name: string;
  /** True when enough strings to be worth a call. */
  ready(): boolean;
  translate(texts: string[], target: string): Promise<string[]>;
}

/* -------------------------------------------------------------------------- */
/* Google Cloud Translation                                                    */
/* -------------------------------------------------------------------------- */

const GOOGLE_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

export function googleProvider(apiKey: string | null): TranslationProvider {
  return {
    name: 'google',
    ready: () => apiKey !== null && apiKey.length > 0,
    async translate(texts, target) {
      const response = await fetch(GOOGLE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey! },
        body: JSON.stringify({ q: texts, target, format: 'text' }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`google ${response.status}`);
      const payload = (await response.json()) as {
        data?: { translations?: Array<{ translatedText?: string }> };
      };
      const list = payload.data?.translations ?? [];
      // A provider may return fewer items than asked for. Falling back to the
      // source string keeps the request useful — one untranslated string beats
      // no translation at all — and callers never write a blank field.
      return texts.map((source, i) => list[i]?.translatedText || source);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* MyMemory — free, no key, no billing                                         */
/* -------------------------------------------------------------------------- */

const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

/** MyMemory answers a bad language pair with an error *inside* the text. */
const MYMEMORY_ERROR = 'INVALID TARGET LANGUAGE';

/**
 * MyMemory takes one query per request, so a lesson's strings are translated
 * concurrently and in small batches. Anonymous quota is ~5000 words/day,
 * which is why the caller's cache matters more here than with Google.
 */
export function myMemoryProvider(batchSize = 4): TranslationProvider {
  return {
    name: 'mymemory',
    ready: () => true,
    async translate(texts, target) {
      const out: string[] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const translated = await Promise.all(batch.map((t) => translateOne(t, target)));
        out.push(...translated);
      }
      return out;
    },
  };
}

async function translateOne(text: string, target: string): Promise<string> {
  const url =
    `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}` +
    `&langpair=en%7C${encodeURIComponent(target)}`;
  const response = await fetch(url, {
    headers: {
      // Some CDNs reject the default Node user-agent outright.
      'user-agent': 'EduMitra/1.0 (+https://github.com/Nikhil-Nirupam-Sahoo/edumitra)',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`mymemory http ${response.status}`);
  const payload = (await response.json()) as {
    responseStatus?: number | string;
    responseData?: { translatedText?: string };
    responseDetails?: string;
    quotaFinished?: boolean;
  };
  const result = payload.responseData?.translatedText;
  if (!result) throw new Error('mymemory empty body');
  // Both of these mean "no translation happened" — returning them would put
  // the API's error text into a lesson card.
  if (String(payload.responseStatus) !== '200' || payload.quotaFinished === true) {
    throw new Error(
      `mymemory status ${String(payload.responseStatus)} quota=${String(payload.quotaFinished)}`,
    );
  }
  if (result.includes(MYMEMORY_ERROR)) throw new Error('mymemory bad language');
  return result;
}

/* -------------------------------------------------------------------------- */
/* Bhashini — Government of India, free key, no billing                         */
/* -------------------------------------------------------------------------- */

const BHASHINI_TRANSLATE = 'https://tts.bhashini.ai/v2/translate/batch';

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
};

/**
 * Bhashini's batch endpoint takes a list and returns the same order, which is
 * exactly the shape we need — one request per lesson rather than per string.
 *
 * It requires a key, but the key is free and needs no card, unlike Google's.
 */
export function bhashiniProvider(apiKey: string | null): TranslationProvider {
  return {
    name: 'bhashini',
    ready: () => apiKey !== null && apiKey.length > 0,
    async translate(texts, target) {
      const outputLanguage = BHASHINI_LANGUAGE[target.split(/[-_]/)[0]!.toLowerCase()];
      if (!outputLanguage) throw new Error(`bhashini unsupported target ${target}`);

      const response = await fetch(BHASHINI_TRANSLATE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-KEY': apiKey! },
        body: JSON.stringify(
          texts.map((inputText) => ({ inputText, inputLanguage: 'English', outputLanguage })),
        ),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`bhashini http ${response.status}`);
      const payload = (await response.json()) as {
        translatedSentences?: string[];
      };
      const list = payload.translatedSentences ?? [];
      return texts.map((source, i) => list[i] || source);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Chain                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returns the first provider that answers, so a quota-exhausted free tier
 * still produces a translated lesson rather than an error.
 */
export async function translateWithFallback(
  providers: TranslationProvider[],
  texts: string[],
  target: string,
  log?: { warn: (meta: unknown, msg: string) => void },
): Promise<{ provider: string; translations: string[] }> {
  let lastError: unknown = null;
  for (const provider of providers) {
    if (!provider.ready()) continue;
    try {
      return { provider: provider.name, translations: await provider.translate(texts, target) };
    } catch (error) {
      lastError = error;
      log?.warn({ err: error, provider: provider.name }, 'translation provider failed');
    }
  }
  throw lastError ?? new Error('no translation provider available');
}