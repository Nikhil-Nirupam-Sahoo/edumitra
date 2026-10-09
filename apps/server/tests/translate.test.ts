/**
 * Live-translation proxy tests.
 *
 * These never call Google — the upstream fetch is stubbed globally. The point
 * is the contract the browser depends on: the route is inert unless a key is
 * configured, requests are validated, and cache hits skip the upstream.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  clearTranslationCache,
  registerTranslateRoutes,
} from '../src/translate/translate.controller.js';
import type { LoadedConfig } from '../src/config.js';

function configWith(key: string | null): LoadedConfig {
  return {
    googleTranslationApiKey: key,
  } as LoadedConfig;
}

async function buildApp(key: string | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(
    async (instance) => {
      await registerTranslateRoutes(instance, { config: configWith(key) });
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return app;
}

describe('GET /api/v1/translate/status', () => {
  it('reports disabled when no key is configured', async () => {
    const app = await buildApp(null);
    const response = await app.inject({ method: 'GET', url: '/api/v1/translate/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: false });
    await app.close();
  });

  it('reports enabled when a key is configured', async () => {
    const app = await buildApp('server-side-key');
    const response = await app.inject({ method: 'GET', url: '/api/v1/translate/status' });
    expect(response.json()).toEqual({ enabled: true });
    await app.close();
  });
});

describe('POST /api/v1/translate', () => {
  beforeEach(() => {
    clearTranslationCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 503 (and no upstream call) when translation is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const app = await buildApp(null);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate',
      payload: { target: 'fr', texts: ['Hello'] },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('translation_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects malformed payloads', async () => {
    const app = await buildApp('server-side-key');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate',
      payload: { target: 'f', texts: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');
    await app.close();
  });

  it('translates via Google and never leaks the key to the client payload', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { translations: [{ translatedText: 'Bonjour' }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp('super-secret-server-key');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate',
      payload: { target: 'fr', texts: ['Hello'] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.translations).toEqual(['Bonjour']);
    expect(body.cached).toBe(false);
    // The key must travel in the upstream header only, never in the response.
    expect(JSON.stringify(body)).not.toContain('super-secret-server-key');

    // It was sent to Google in the header (server-side), not in the URL.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('translation.googleapis.com');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'super-secret-server-key',
    );
    await app.close();
  });

  it('serves repeat requests from cache without calling Google again', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { translations: [{ translatedText: 'Bonjour' }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp('server-side-key');
    const payload = { target: 'fr', texts: ['Hello', 'Goodbye'] };

    const first = await app.inject({ method: 'POST', url: '/api/v1/translate', payload });
    const second = await app.inject({ method: 'POST', url: '/api/v1/translate', payload });

    expect(first.json().cached).toBe(false);
    expect(second.json().cached).toBe(true);
    expect(second.json().translations).toEqual(['Bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('surfaces upstream failures as 502 so the client falls back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('quota exceeded', { status: 429 })),
    );

    const app = await buildApp('server-side-key');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate',
      payload: { target: 'fr', texts: ['Hello'] },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('upstream_error');
    await app.close();
  });

  it('handles a network error without crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const app = await buildApp('server-side-key');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate',
      payload: { target: 'fr', texts: ['Hello'] },
    });

    expect(response.statusCode).toBe(502);
    await app.close();
  });
});