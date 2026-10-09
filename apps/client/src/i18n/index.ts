/**
 * Local-first i18n.
 *
 * Language bundles are plain JSON files bundled at build time (Vite `import.meta.glob`),
 * so switching language never touches the network. Lookup order:
 *   requested locale -> language subtag (e.g. "hi-IN" -> "hi") -> fallback "en".
 * Interpolation uses `{name}` placeholders; missing keys fall through to the
 * fallback locale and finally return the key itself (never throws, never blanks
 * a screen on a low-end device).
 */

import en from './locales/en.json';
import hi from './locales/hi.json';
import ta from './locales/ta.json';
import { getRemoteBundle, hasRemoteBundle } from './remote';

/**
 * A UI language code. The three bundled locales are enumerated for autocompletion,
 * but any code with a live-translated bundle (see `remote.ts`) is valid too.
 */
export type LocaleCode = 'en' | 'hi' | 'ta' | (string & {});

export type Bundle = Record<string, string>;

const BUNDLES: Record<string, Bundle> = { en, hi, ta };

export const SUPPORTED_LOCALES: Array<{ code: LocaleCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
];

/** Languages that ship audio cues; UI-only locales fall back to silent cues. */
export const AUDIO_LOCALES: readonly LocaleCode[] = ['en', 'hi', 'ta'];

export interface TranslateOptions {
  /** Interpolation values, e.g. { count: 3 }. */
  values?: Record<string, string | number>;
  /** Fallback locale override. */
  fallback?: LocaleCode;
}

export function normalizeLocale(input: string | null | undefined): LocaleCode {
  if (!input) return 'en';
  const lower = input.toLowerCase();
  // A live-translated locale (fetched and cached by remote.ts) is used as-is,
  // even though it has no bundled copy — otherwise it would collapse to "en"
  // and the translation would never be consulted.
  if (hasRemoteBundle(lower)) return lower;
  const exact = SUPPORTED_LOCALES.find((l) => l.code === lower);
  if (exact) return exact.code;
  const subtag = lower.split(/[-_]/)[0] ?? 'en';
  const match = SUPPORTED_LOCALES.find((l) => l.code === subtag);
  return match ? match.code : 'en';
}

export function getBundle(locale: LocaleCode): Bundle {
  return BUNDLES[locale] ?? BUNDLES.en;
}

/** Pure translate — usable outside React (sync engine logs, tests). */
export function translate(
  locale: string | null | undefined,
  key: string,
  options: TranslateOptions = {},
): string {
  const normalized = normalizeLocale(locale);
  const fallback = options.fallback ?? 'en';
  // A live-translated locale (fetched via /api/v1/translate and cached on the
  // device) wins over the bundled copy; bundled locales remain the floor.
  const remote = getRemoteBundle(normalized)?.[key];
  const template = remote ?? getBundle(normalized)[key] ?? getBundle(fallback)[key] ?? key;
  if (!options.values) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = options.values?.[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

/** Creates a bound translator for a locale. */
export function createTranslator(locale: string | null | undefined) {
  const normalized = normalizeLocale(locale);
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(normalized, key, { values });
  return { locale: normalized, t };
}

/** Locale-aware number/percent/date formatters (cheap, cached per call). */
export function formatPercent(ratio: number, locale = 'en'): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return `${Math.round(clamped * 100)}%`;
}

export function formatDurationShort(ms: number, locale = 'en'): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return translate(locale, 'common.minutes', { values: { count: minutes } });
}

export const LOCALE_STORAGE_KEY = 'edumitra.locale';

export function detectInitialLocale(): LocaleCode {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return normalizeLocale(stored);
  } catch {
    // localStorage unavailable (private mode) — fall through to browser hint.
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language);
  }
  return 'en';
}
