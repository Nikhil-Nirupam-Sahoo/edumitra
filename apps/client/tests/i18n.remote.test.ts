/**
 * Live-translation client tests.
 *
 * The contract that matters: a remote bundle overrides the bundled locale,
 * unknown locales fall back to English instead of blanking, and everything
 * degrades to the bundled locales when the network or the server says no.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/locales/en.json';
import {
  createTranslator,
  normalizeLocale,
  translate,
} from '../src/i18n';
import {
  clearRemoteForTests,
  getRemoteBundle,
  loadRemoteLocale,
  sourceStrings,
} from '../src/i18n/remote';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? status : status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('remote translation', () => {
  beforeEach(() => {
    clearRemoteForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends every English source string to the server', async () => {
    expect(sourceStrings().length).toBe(Object.keys(en).length);
  });

  it('reports unavailable when the server has no key configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: false })),
    );
    const outcome = await loadRemoteLocale('fr');
    expect(outcome).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const outcome = await loadRemoteLocale('fr');
    expect(outcome).toEqual({ status: 'unavailable' });
  });

  it('loads a translated bundle and makes translate() use it', async () => {
    const keys = Object.keys(en);
    const fakeTranslations = keys.map((_, i) => `T${i}`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/translate/status')
          ? jsonResponse({ enabled: true })
          : jsonResponse({ translations: fakeTranslations, cached: false }),
      ),
    );

    const outcome = await loadRemoteLocale('fr');
    expect(outcome.status).toBe('ok');
    expect(getRemoteBundle('fr')).toBeDefined();

    // A translated key wins over the bundled English text.
    const someKey = keys[3] as string;
    expect(translate('fr', someKey)).toBe(`T${3}`);
  });

  it('keeps unknown locales working via English fallback', () => {
    // No bundle cached -> bundled fallback, never a blank screen.
    expect(translate('de', 'nav.lessons')).toBe(en['nav.lessons']);
    expect(normalizeLocale('de')).toBe('en');
  });

  it('normalizes to the requested code once a bundle exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/translate/status')
          ? jsonResponse({ enabled: true })
          : jsonResponse({
              translations: Object.keys(en).map(() => 'x'),
              cached: false,
            }),
      ),
    );
    await loadRemoteLocale('sw');
    expect(normalizeLocale('sw')).toBe('sw');
  });

  it('surfaces upstream errors instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/translate/status')
          ? jsonResponse({ enabled: true })
          : jsonResponse({ error: 'upstream_error' }, false, 502),
      ),
    );
    const outcome = await loadRemoteLocale('fr');
    expect(outcome).toEqual({ status: 'failed', reason: 'server_502' });
  });

  it('interpolates placeholders in translated strings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/translate/status')
          ? jsonResponse({ enabled: true })
          : jsonResponse({
              translations: Object.keys(en).map((k) =>
                k === 'rewards.xp' ? '{xp} XP (traduit)' : en[k as keyof typeof en],
              ),
              cached: false,
            }),
      ),
    );
    await loadRemoteLocale('fr');
    const { t } = createTranslator('fr');
    expect(t('rewards.xp', { xp: 120 })).toBe('120 XP (traduit)');
  });
});