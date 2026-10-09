/**
 * Live translation — remote locale bundles fetched through our server proxy
 * and cached on-device.
 *
 * Why this shape:
 *  - The Google API key never reaches the browser. The client calls
 *    `/api/v1/translate`, our server holds the key.
 *  - A translated UI is a small fixed set of strings. One fetch translates the
 *    whole app, after which lookups are instant and work fully offline.
 *  - Bundled locales stay the floor: if the network is gone, the key is
 *    unset, or Google errors, `translate()` transparently falls back.
 *
 * Cached bundles are persisted to localStorage so a reload keeps the language
 * without another network round-trip.
 */

import en from './locales/en.json';

const STORAGE_KEY = 'edumitra.remoteLocales';
const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;

/** source-language text -> target-language text */
type Bundle = Record<string, string>;

const bundles = new Map<string, Bundle>();
const listeners = new Set<() => void>();
let loadRestored = false;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeRemoteLocales(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** All English source strings — the translation input set. */
export function sourceStrings(): string[] {
  return Object.values(en as Bundle).filter((value) => typeof value === 'string');
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...bundles]));
  } catch {
    /* private mode / quota — the in-memory cache still works this session */
  }
}

/** Restore previously translated bundles (synchronous, called once at boot). */
export function restoreRemoteLocales(): void {
  if (loadRestored) return;
  loadRestored = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as Bundle).__code === 'string'
        ) {
          const { __code, ...rest } = entry as Bundle & { __code: string };
          bundles.set(__code, rest);
        }
      }
    }
  } catch {
    /* corrupt cache — start clean */
  }
}

export function getRemoteBundle(code: string): Bundle | undefined {
  return bundles.get(code);
}

export function hasRemoteBundle(code: string): boolean {
  return bundles.has(code);
}

export type TranslateOutcome =
  | { status: 'ok'; count: number; cached: boolean }
  | { status: 'unavailable' }
  | { status: 'failed'; reason: string };

/**
 * Fetch a full translation of the UI into `target`.
 * Returns what happened so the UI can explain itself honestly.
 */
export async function loadRemoteLocale(target: string): Promise<TranslateOutcome> {
  const texts = sourceStrings();

  // Ask the server whether live translation is even configured.
  let enabled = false;
  try {
    const statusRes = await fetch(`${API_BASE}/translate/status`, { cache: 'no-store' });
    if (!statusRes.ok) return { status: 'unavailable' };
    const status = (await statusRes.json()) as { enabled?: boolean };
    enabled = status.enabled === true;
  } catch {
    return { status: 'unavailable' };
  }
  if (!enabled) return { status: 'unavailable' };

  let translations: string[];
  let cached = false;
  try {
    const res = await fetch(`${API_BASE}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, texts }),
    });
    if (!res.ok) return { status: 'failed', reason: `server_${res.status}` };
    const body = (await res.json()) as { translations?: string[]; cached?: boolean };
    translations = body.translations ?? [];
    cached = body.cached === true;
  } catch {
    return { status: 'failed', reason: 'network' };
  }

  // Rebuild a key->text map by aligning with the English key order.
  const keys = Object.keys(en as Bundle);
  const bundle: Bundle & { __code: string } = { __code: target };
  keys.forEach((key, index) => {
    const value = translations[index];
    if (typeof value === 'string' && value.length > 0) bundle[key] = value;
  });

  bundles.set(target, bundle);
  persist();
  notify();
  return { status: 'ok', count: Object.keys(bundle).length - 1, cached };
}

/** Drop a cached language (e.g. "reset to original"). */
export function forgetRemoteLocale(code: string): void {
  if (bundles.delete(code)) {
    persist();
    notify();
  }
}

/** Test hook — clears every cached bundle and resets the one-shot restore. */
export function clearRemoteForTests(): void {
  bundles.clear();
  listeners.clear();
  loadRestored = true;
}