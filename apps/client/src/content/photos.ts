/**
 * Chapter photographs — download, cache, and hand out object URLs.
 *
 * The photos are server-owned data (see images.controller), not part of the
 * bundle: hotlinking a remote <img> would show a broken box the moment a
 * student loses signal. Instead they are fetched once, stored as blobs in
 * IndexedDB, and served to the UI from memory — so after the first visit they
 * work with the network off, exactly like the lessons themselves.
 *
 * Failure is never fatal. A chapter with no photo, a failed download or a
 * blocked request simply renders its Manim figure alone, which is a perfectly
 * good-looking chapter on its own.
 */

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;

export interface ChapterPhoto {
  lessonId: string;
  credit: string;
  license: string;
  sourceUrl: string;
  /** Object URL for the small card thumbnail, or null if unavailable. */
  cardUrl: string | null;
  /** Object URL for the large reel hero, or null if unavailable. */
  heroUrl: string | null;
}

interface ManifestEntry {
  credit: string;
  license: string;
  sourceUrl: string;
  commonsTitle: string;
  sizes: { card: number; hero: number };
}

let manifest: Record<string, ManifestEntry> | null = null;
let manifestPromise: Promise<Record<string, ManifestEntry>> | null = null;

/** Resolved object URLs, keyed `${lessonId}:${size}`. */
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

/** Called when the app resets device data, so URLs don't outlive the blobs. */
export function forgetCachedPhotos(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  inFlight.clear();
  manifest = null;
  manifestPromise = null;
}

export async function loadPhotoManifest(): Promise<Record<string, ManifestEntry>> {
  if (manifest) return manifest;
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/images/manifest`, { cache: 'no-cache' });
        if (!response.ok) return {};
        const body = (await response.json()) as { images?: Record<string, ManifestEntry> };
        manifest = body.images ?? {};
        return manifest;
      } catch {
        // Offline with no cache: chapters fall back to their figures.
        return {};
      } finally {
        manifestPromise = null;
      }
    })();
  }
  return manifestPromise;
}

async function fetchImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Loads one chapter's photo. Resolves to null when there is no photo for that
 * lesson — a deliberate, non-error outcome.
 */
export async function loadChapterPhoto(lessonId: string): Promise<ChapterPhoto | null> {
  const images = await loadPhotoManifest();
  const entry = images[lessonId];
  if (!entry) return null;

  const result: ChapterPhoto = {
    lessonId,
    credit: entry.credit,
    license: entry.license,
    sourceUrl: entry.sourceUrl,
    cardUrl: null,
    heroUrl: null,
  };

  // Small first: it is what every card wants, and the hero is optional.
  const sizes: Array<['card' | 'hero', keyof ChapterPhoto]> = [
    ['card', 'cardUrl'],
    ['hero', 'heroUrl'],
  ];
  for (const [size, field] of sizes) {
    const key = `${lessonId}:${size}`;
    const cached = cache.get(key);
    if (cached) {
      result[field] = cached;
      continue;
    }
    let pending = inFlight.get(key);
    if (!pending) {
      pending = fetchImage(`${API_BASE}/images/${lessonId}.${size}.webp`);
      inFlight.set(key, pending);
    }
    const url = await pending;
    inFlight.delete(key);
    if (url) {
      cache.set(key, url);
      result[field] = url;
    }
  }
  return result;
}

/** True when the manifest knows about a photo for this chapter. */
export function hasPhoto(lessonId: string): boolean {
  return manifest !== null && lessonId in manifest;
}