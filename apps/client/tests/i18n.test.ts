/**
 * i18n tests — the local-first language bundles must never blank a screen or
 * require a network fetch, and must degrade gracefully for unknown locales.
 */

import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en.json';
import hi from '../src/i18n/locales/hi.json';
import ta from '../src/i18n/locales/ta.json';
import {
  AUDIO_LOCALES,
  createTranslator,
  detectInitialLocale,
  formatDurationShort,
  formatPercent,
  normalizeLocale,
  SUPPORTED_LOCALES,
  translate,
} from '../src/i18n';

describe('bundle integrity', () => {
  it('all supported locales expose exactly the English key set', () => {
    const englishKeys = Object.keys(en).sort();
    expect(Object.keys(hi).sort()).toEqual(englishKeys);
    expect(Object.keys(ta).sort()).toEqual(englishKeys);
  });

  it('bundles have no HTML (rendered as text, never injected)', () => {
    for (const [code, bundle] of Object.entries({ en, hi, ta })) {
      for (const [key, value] of Object.entries(bundle)) {
        expect(value, `${code}.${key}`).not.toMatch(/<script|javascript:/i);
      }
    }
  });

  it('audio locales are a subset of supported locales', () => {
    const supported = new Set(SUPPORTED_LOCALES.map((l) => l.code));
    for (const locale of AUDIO_LOCALES) {
      expect(supported.has(locale)).toBe(true);
    }
  });
});

describe('normalizeLocale', () => {
  it('resolves exact, region-tagged, and unknown locales', () => {
    expect(normalizeLocale('hi')).toBe('hi');
    expect(normalizeLocale('ta-IN')).toBe('ta');
    expect(normalizeLocale('HI-in')).toBe('hi');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale('')).toBe('en');
  });
});

describe('translate', () => {
  it('returns localized strings and falls back to English for missing keys', () => {
    expect(translate('hi', 'nav.lessons')).toBe(hi['nav.lessons' as keyof typeof hi]);
    // Unknown key: key itself is returned, never undefined/blank.
    expect(translate('hi', 'totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('interpolates {placeholder} values', () => {
    expect(translate('en', 'sync.pending', { values: { count: 3 } })).toBe(
      '3 changes waiting to sync',
    );
    expect(translate('hi', 'sync.pending', { values: { count: 3 } })).toContain('3');
  });

  it('leaves unknown placeholders intact instead of printing undefined', () => {
    expect(translate('en', 'sync.pending', { values: {} })).toContain('{count}');
  });

  it('createTranslator binds the normalized locale', () => {
    const { locale, t } = createTranslator('ta-LK');
    expect(locale).toBe('ta');
    expect(t('common.correct')).toBe(ta['common.correct' as keyof typeof ta]);
  });
});

describe('formatters', () => {
  it('formats percentages clamped to 0..100', () => {
    expect(formatPercent(0.756)).toBe('76%');
    expect(formatPercent(-5)).toBe('0%');
    expect(formatPercent(42)).toBe('100%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('formats durations in minutes with localization', () => {
    expect(formatDurationShort(90_000, 'en')).toBe('2 min');
    expect(formatDurationShort(90_000, 'hi')).toContain('2');
  });
});

describe('detectInitialLocale', () => {
  it('returns a supported locale even with no hints', () => {
    expect(SUPPORTED_LOCALES.some((l) => l.code === detectInitialLocale())).toBe(true);
  });
});
