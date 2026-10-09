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

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;
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
  /**
   * Whether the server has a translation provider configured. Probed once so the
   * extra languages can be shown as unavailable up front, instead of letting the
   * student tap through seventeen chips that each end in the same error.
   */
  const [liveAvailable, setLiveAvailable] = useState<boolean | null>(null);

  // Keep the "cached" ticks in sync when a bundle is added/removed.
  const [, force] = useState(0);
  useEffect(() => subscribeRemoteLocales(() => force((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/translate/status`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled: boolean }>) : null))
      .then((body) => {
        if (!cancelled) setLiveAvailable(body?.enabled === true);
      })
      .catch(() => {
        // Offline. A cached bundle may still be selectable, so stay optimistic.
        if (!cancelled) setLiveAvailable(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          ? 'Live translation is switched off on this server, so these extra languages need one connection to fetch. English, हिन्दी and தமிழ் above work right now, offline.'
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
            // A cached bundle stays selectable even with no server configured —
            // it lives on the device, so switching to it must keep working offline.
            disabled={state.kind === 'working' || (liveAvailable === false && !hasRemoteBundle(l.code))}
          >
            {l.label}
            {hasRemoteBundle(l.code) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      {liveAvailable === false && (
        <p className="language-status" role="status">
          Live translation is switched off on this server. The languages above work now, offline.
        </p>
      )}

      {message && (
        <p className="language-status" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}