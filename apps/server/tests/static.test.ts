/**
 * The API process also serves the built PWA (same-origin deployment):
 * app shell at "/", immutable caching for hashed assets, SPA fallback for
 * unknown non-API paths, and JSON 404s preserved for the API namespace.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';

const SHELL = '<!doctype html><title>edumitra</title>';

describe('static PWA serving (built client present)', () => {
  let harness: TestHarness;
  let dist: string;
  let dataDir: string;

  beforeEach(async () => {
    dist = mkdtempSync(join(tmpdir(), 'edumitra-dist-'));
    dataDir = mkdtempSync(join(tmpdir(), 'edumitra-data-'));
    writeFileSync(join(dist, 'index.html'), SHELL);
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1);');
    harness = await createHarness({ DATA_DIR: dataDir, CLIENT_DIST: dist });
  });

  afterEach(async () => {
    await harness.close();
    rmSync(dist, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves the app shell at / with no-cache', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>edumitra</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to the SPA shell for unknown non-API routes', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/some/deep/route' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>edumitra</title>');
  });

  it('serves hashed assets with immutable caching', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('keeps unknown API routes as JSON 404s', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/definitely-not-here' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('still answers the API next to the static site', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/sync/manifest' });
    expect(res.statusCode).toBe(200);
  });
});

describe('static PWA serving (no built client — dev mode)', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createHarness({
      DATA_DIR: mkdtempSync(join(tmpdir(), 'edumitra-data-')),
      CLIENT_DIST: join(tmpdir(), 'edumitra-definitely-missing-dist'),
    });
  });

  afterEach(async () => {
    await harness.close();
  });

  it('returns a JSON 404 at / (Vite serves the PWA in dev)', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
