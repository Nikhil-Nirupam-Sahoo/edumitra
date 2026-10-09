/**
 * Bundled-language integrity.
 *
 * A bundled language is the one thing in this app that must work with no
 * network, no API key and no server round-trip — it is the floor the
 * live-translation feature sits on top of. So every bundled locale is checked
 * for the things that actually break a language in practice:
 *
 *  - key parity with English (a missing key silently falls back mid-sentence)
 *  - placeholder parity (a dropped {count} prints a literal brace at runtime)
 *  - no value left identical to English (the usual sign of an unfinished
 *    translation, with a small allowlist for brand names, XP, emoji and the
 *    "{done}/{target}" ratio)
 *  - locale-specific bugs: Devanagari and Tamil scripts are shaped and
 *    reordered differently, so mixing scripts within a value is a red flag.
 */

import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en.json';
import hi from '../src/i18n/locales/hi.json';
import ta from '../src/i18n/locales/ta.json';
import or_ from '../src/i18n/locales/or.json';
import { AUDIO_LOCALES, SUPPORTED_LOCALES, normalizeLocale, translate } from '../src/i18n';

type Bundle = Record<string, string>;

const EN: Bundle = en;
const BUNDLES: Record<string, Bundle> = { en: EN, hi, ta, or: or_ };

/** Values that are legitimately the same in every language. */
const ALLOWED_IDENTICAL = new Set([
  'app.name', // product name
  'rewards.xp', // "{xp} XP" — XP is a universal gaming term
  'celebration.xp', // "+{xp} XP"
  'combo.fire', // an emoji, not words
  'support.ai_thinking', // an ellipsis
  'quest.progress', // the pure ratio "{done}/{target}"
]);

/** Scripts a value for that locale should stay within. */
const SCRIPT_RANGES: Record<string, RegExp> = {
  hi: /[ऀ-ॿ]/,
  ta: /[஀-௿]/,
  or: /[଀-୿]/,
};

/**
 * `{s}` is not a data placeholder — it is the English "-s" plural trick. A
 * language that inflects for number (Hindi, Tamil, Odia) must drop it or it
 * renders as "star{s}", so parity is checked on the real placeholders only.
 */
function placeholders(value: string): string[] {
  return (value.match(/\{\w+\}/g) ?? []).filter((p) => p !== '{s}').sort();
}

describe('bundled locales', () => {
  it('ships a bundle for every advertised locale', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      expect(BUNDLES[code], `no bundle for ${code}`).toBeDefined();
    }
  });

  it('exposes exactly the English key set', () => {
    const expected = Object.keys(EN).sort();
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      expect(Object.keys(bundle).sort(), `${code} key set`).toEqual(expected);
    }
  });

  it('keeps every placeholder intact', () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      for (const key of Object.keys(EN)) {
        expect(placeholders(bundle[key] ?? ''), `${code}.${key}`).toEqual(
          placeholders(EN[key] ?? ''),
        );
      }
    }
  });

  it('has no unfinished (English-identical) values', () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      if (code === 'en') continue;
      const untranslated = Object.keys(bundle).filter(
        (key) => bundle[key] === EN[key] && !ALLOWED_IDENTICAL.has(key),
      );
      expect(untranslated, `${code} still English: ${untranslated.join(', ')}`).toEqual([]);
    }
  });

  it('has no empty values', () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      for (const [key, value] of Object.entries(bundle)) {
        expect(value.trim(), `${code}.${key}`).not.toBe('');
      }
    }
  });

  it('writes each language in its own script', () => {
    // A value that is mostly one script but contains stray Latin words is a
    // half-finished translation that a speaker will read as a glitch.
    for (const [code, pattern] of Object.entries(SCRIPT_RANGES)) {
      const bundle = BUNDLES[code]!;
      for (const [key, value] of Object.entries(bundle)) {
        if (ALLOWED_IDENTICAL.has(key)) continue;
        // Strip placeholders and the few tokens that stay untranslated by
        // design, so the check only sees prose that should have been written.
        const latin =
          value
            .replace(/\{\w+\}/g, '')
            .replace(/\b(XP|EduMitra)\b/g, '')
            .match(/[A-Za-z]{3,}/g) ?? [];
        expect(latin, `${code}.${key} has untranslated Latin: ${latin.join(' ')}`).toEqual([]);
        // And confirm the value is actually written in that script.
        expect(pattern.test(value), `${code}.${key} is not in its script`).toBe(true);
      }
    }
  });

  it('resolves Odia from the region tag a browser actually sends', () => {
    // Chrome reports Odia as "or" / "or-IN".
    expect(normalizeLocale('or')).toBe('or');
    expect(normalizeLocale('or-IN')).toBe('or');
    expect(normalizeLocale('OR')).toBe('or');
  });

  it('renders real Odia prose with interpolation intact', () => {
    expect(translate('or', 'nav.games')).toBe('ଖେଳ');
    expect(translate('or', 'common.minutes', { values: { count: 5 } })).toBe('5 ମିନିଟ୍');
    expect(translate('or', 'games.summary', {
      values: { correct: 3, total: 5, combo: 2 },
    })).toBe('5 ରୁ 3 ସଠିକ୍ · ସର୍ବୋତ୍ତମ କମ୍ବୋ ×2');
  });

  it('lists every bundled locale for read-aloud pacing', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      expect(AUDIO_LOCALES, `${code} missing from AUDIO_LOCALES`).toContain(code);
    }
  });
});