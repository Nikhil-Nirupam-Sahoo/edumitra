/**
 * Chapter photograph tests.
 *
 * The invariants that matter here are all about failure: a chapter with no
 * photo, a failed download, or an offline device must render *nothing* — not a
 * broken <img>, not a layout that jumps. The Manim figure alone is a
 * perfectly good-looking chapter, so a missing photo is a non-event.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LessonPhoto } from '../src/art/LessonPhoto';
import {
  forgetCachedPhotos,
  loadChapterPhoto,
  loadPhotoManifest,
} from '../src/content/photos';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const MANIFEST = {
  images: {
    'c8-math-linear-equations': {
      credit: 'A Photographer',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:X',
      commonsTitle: 'File:X.jpg',
      sizes: { card: 640, hero: 1280 },
    },
  },
};

function stubFetch(overrides: Partial<Record<string, () => Promise<Response>>> = {}) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(overrides).find((k) => url.includes(k));
    if (key) return overrides[key]!();
    if (url.includes('/images/manifest')) {
      return new Response(JSON.stringify(MANIFEST), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('.webp')) {
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  forgetCachedPhotos();
});

afterEach(() => {
  vi.unstubAllGlobals();
  forgetCachedPhotos();
});

describe('loadPhotoManifest', () => {
  it('reads the manifest from the server', async () => {
    stubFetch();
    const manifest = await loadPhotoManifest();
    expect(Object.keys(manifest)).toContain('c8-math-linear-equations');
    expect(manifest['c8-math-linear-equations']!.credit).toBe('A Photographer');
  });

  it('returns an empty manifest when the server has none, without throwing', async () => {
    stubFetch({ '/images/manifest': async () => new Response('nope', { status: 404 }) });
    expect(await loadPhotoManifest()).toEqual({});
  });

  it('returns an empty manifest offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await loadPhotoManifest()).toEqual({});
  });
});

describe('loadChapterPhoto', () => {
  it('returns null for a chapter with no photo', async () => {
    stubFetch();
    expect(await loadChapterPhoto('no-such-lesson')).toBeNull();
  });

  it('returns both sizes and the attribution', async () => {
    stubFetch();
    const photo = await loadChapterPhoto('c8-math-linear-equations');
    expect(photo).not.toBeNull();
    expect(photo!.cardUrl).toMatch(/^blob:/);
    expect(photo!.heroUrl).toMatch(/^blob:/);
    expect(photo!.license).toBe('CC BY-SA 4.0');
    expect(photo!.sourceUrl).toContain('commons.wikimedia.org');
  });

  it('still returns a card when the hero is missing', async () => {
    stubFetch({
      '.hero.webp': async () => new Response('missing', { status: 404 }),
    });
    const photo = await loadChapterPhoto('c8-math-linear-equations');
    expect(photo!.cardUrl).toMatch(/^blob:/);
    expect(photo!.heroUrl).toBeNull();
  });

  it('caches object URLs instead of re-downloading', async () => {
    const mock = stubFetch();
    await loadChapterPhoto('c8-math-linear-equations');
    const afterFirst = mock.mock.calls.length;
    await loadChapterPhoto('c8-math-linear-equations');
    // Second call serves from memory: only the manifest probe would repeat.
    expect(mock.mock.calls.length).toBe(afterFirst);
  });

  it('reuses the same object URL across calls', async () => {
    stubFetch();
    const a = await loadChapterPhoto('c8-math-linear-equations');
    const b = await loadChapterPhoto('c8-math-linear-equations');
    expect(a!.cardUrl).toBe(b!.cardUrl);
  });
});

describe('LessonPhoto', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(props: { lessonId: string; alt?: string }) {
    act(() => {
      root.render(<LessonPhoto locale="en" {...props} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  it('renders the image and its attribution once loaded', async () => {
    stubFetch();
    await render({ lessonId: 'c8-math-linear-equations', alt: 'Linear equations' });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('alt')).toBe('Linear equations');
    // CC BY attribution is present and links to the source.
    const link = container.querySelector('figcaption a');
    expect(link?.textContent).toBe('A Photographer');
    expect(link?.getAttribute('href')).toContain('commons.wikimedia.org');
    expect(container.textContent).toContain('CC BY-SA 4.0');
  });

  it('renders nothing for a chapter with no photo', async () => {
    stubFetch();
    await render({ lessonId: 'nope', alt: 'x' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the download fails, rather than a broken image', async () => {
    stubFetch({
      '.card.webp': async () => new Response('gone', { status: 500 }),
      '.hero.webp': async () => new Response('gone', { status: 500 }),
    });
    await render({ lessonId: 'c8-math-linear-equations' });
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders nothing offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await render({ lessonId: 'c8-math-linear-equations' });
    expect(container.querySelector('img')).toBeNull();
  });

  it('loads images lazily — they cost nothing on first paint', async () => {
    stubFetch();
    await render({ lessonId: 'c8-math-linear-equations' });
    expect(container.querySelector('img')!.getAttribute('loading')).toBe('lazy');
  });
});