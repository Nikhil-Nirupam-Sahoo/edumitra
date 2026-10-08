/**
 * End-to-end sync pipeline against an in-process app + SQLite store:
 * HMAC rejection → accepted batch → idempotent replay → gzip variant →
 * merged CRDT state exposed to clients → manifest probe.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeSignature } from '../src/lib/hmac.js';
import { createHarness, type TestHarness } from './helpers.js';

const SECRET = 'test-secret-at-least-16-chars';
const DEVICE = 'it-device-1';

function statement(id: string) {
  return {
    id,
    actor: { objectType: 'Agent', account: { name: 'student-asha', homePage: 'https://edumitra.org' } },
    verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
    object: { objectType: 'Activity', id: 'https://edumitra.org/activities/lesson/math-fractions-1' },
    result: { completion: true, success: true, score: { scaled: 0.8, raw: 8, min: 0, max: 10 } },
    timestamp: new Date().toISOString(),
  };
}

function checkpoint(sourceStatementId: string, ts = Date.now()) {
  return {
    studentId: 'student-asha',
    lessonId: 'math-fractions-1',
    key: 'completion_status',
    value: 2,
    ts,
    op: 'put',
    sourceStatementId,
  };
}

function signedHeaders(body: string): Record<string, string> {
  const ts = Date.now();
  return {
    'x-sync-device': DEVICE,
    'x-sync-timestamp': String(ts),
    'x-sync-signature': computeSignature(SECRET, ts, body),
  };
}

describe('sync API integration', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edumitra-it-'));
    harness = await createHarness({ DATA_DIR: dir });
  });

  afterEach(async () => {
    await harness.close();
  });

  it('rejects unsigned batches', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statements: [], checkpoints: [] }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('accepts a signed batch, dedupes replay, and merges checkpoints', async () => {
    const payload = {
      deviceId: DEVICE,
      clientSentAt: Date.now(),
      statements: [statement('it-stmt-1')],
      checkpoints: [checkpoint('it-stmt-1')],
    };
    const body = JSON.stringify(payload);

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      headers: { 'content-type': 'application/json', ...signedHeaders(body) },
      body,
    });
    expect(first.statusCode).toBe(200);
    const firstJson = first.json();
    expect(firstJson.accepted).toBe(1);
    expect(firstJson.duplicates).toBe(0);

    const replay = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      headers: { 'content-type': 'application/json', ...signedHeaders(body) },
      body,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().duplicates).toBe(1);

    const state = await harness.app.inject({ method: 'GET', url: '/api/v1/cmi5/state?student=student-asha' });
    expect(state.statusCode).toBe(200);
    const stateJson = state.json() as { studentId: string } & Record<string, unknown>;
    expect(stateJson.studentId).toBe('student-asha');
    expect(JSON.stringify(stateJson)).toContain('completion_status');
  });

  it('accepts gzip-encoded bodies and yields pull data to a second device', async () => {
    const original = JSON.stringify({
      deviceId: DEVICE,
      clientSentAt: Date.now(),
      statements: [statement('it-stmt-gz')],
      checkpoints: [],
    });
    const ts = Date.now();
    const gz = gzipSync(Buffer.from(original, 'utf-8'));
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'x-sync-device': DEVICE,
        'x-sync-timestamp': String(ts),
        'x-sync-signature': computeSignature(SECRET, ts, original),
      },
      payload: gz,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);

    // A second device polling manifest should see the stored statement count.
    const manifest = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/sync/manifest',
      headers: { 'x-sync-device': 'other-device' },
    });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json().statementCount).toBe(1);
  });
});
