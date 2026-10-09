/**
 * Language picker — bundled locales plus live translation on demand.
 *
 * Bundled languages (English/Hindi/Tamil) are instant and offline. Any other
 * language is translated once through our server's Google proxy, then cached
 * on the device, so it is instant and offline from then on. If live
 * translation isn't available the picker says so instead of silently failing.
 */

import { useCallback, useEffect, useState } from 'react';
import { createTranslator, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n';
import {
  hasRemoteBundle,
  loadRemoteLocale,
  subscribeRemoteLocales,
} from '../../i18n/remote';

interface LanguagePickerProps {
  locale: LocaleCode;
  onLocaleChange: (locale: LocaleCode) => void;
}

/** Languages offered for live translation (Google supports all of these). */
const TRANSLATABLE: Array<{ code: string; label: string }> = [
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { code: 'mr', label: 'मराठी (Marathi)' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'ml', label: 'മലയാളം (Malayalam)' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)' },
  { code: 'ur', label: 'اردو (Urdu)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
  { code: 'mr-IN', label: 'Marathi (India)' },
  { code: 'fr', label: 'Français (French)' },
  { code: 'es', label: 'Español (Spanish)' },
  { code: 'pt', label: 'Português (Portuguese)' },
  { code: 'de', label: 'Deutsch (German)' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'sw', label: 'Kiswahili (Swahili)' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'zh-CN', label: '中文 (Chinese)' },
];

type State =
  | { kind: 'idle' }
  | { kind: 'working'; code: string }
  | { kind: 'done'; code: string }
  | { kind: 'unavailable' }
  | { kind: 'error'; reason: string };

export function LanguagePicker({ locale, onLocaleChange }: LanguagePickerProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Keep the "cached" ticks in sync when a bundle is added/removed.
  const [, force] = useState(0);
  useEffect(() => subscribeRemoteLocales(() => force((n) => n + 1)), []);

  const pick = useCallback(
    async (code: string) => {
      const bundled = SUPPORTED_LOCALES.some((l) => l.code === code);
      if (bundled || hasRemoteBundle(code)) {
        onLocaleChange(code);
        return;
      }
      setState({ kind: 'working', code });
      const outcome = await loadRemoteLocale(code);
      if (outcome.status === 'ok') {
        onLocaleChange(code);
        setState({ kind: 'done', code });
      } else if (outcome.status === 'unavailable') {
        setState({ kind: 'unavailable' });
      } else {
        setState({ kind: 'error', reason: outcome.reason });
      }
    },
    [onLocaleChange],
  );

  const { t } = createTranslator(locale);
  const message =
    state.kind === 'working'
      ? `Translating to ${state.code}…`
      : state.kind === 'done'
        ? 'Translated and saved on this device'
        : state.kind === 'unavailable'
          ? 'Live translation is not available on this server'
          : state.kind === 'error'
            ? 'Translation failed — check your connection'
            : '';

  return (
    <div className="language-picker">
      <p className="muted">{t('settings.language')}</p>

      <div className="language-list" role="group" aria-label={t('settings.language')}>
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={`language-chip ${locale === l.code ? 'active' : ''}`}
            onClick={() => void pick(l.code)}
            aria-pressed={locale === l.code}
          >
            {l.label}
          </button>
        ))}
      </div>

      <p className="muted language-more-label">Translate the app into…</p>
      <div className="language-list" role="group" aria-label="Translate the app into another language">
        {TRANSLATABLE.map((l) => (
          <button
            key={l.code}
            type="button"
            className={`language-chip ${locale === l.code ? 'active' : ''} ${
              hasRemoteBundle(l.code) ? 'cached' : ''
            }`}
            onClick={() => void pick(l.code)}
            aria-pressed={locale === l.code}
            disabled={state.kind === 'working'}
          >
            {l.label}
            {hasRemoteBundle(l.code) ? ' ✓' : ''}
          </button>
        ))}
      </div>

      {message && (
        <p className="language-status" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}