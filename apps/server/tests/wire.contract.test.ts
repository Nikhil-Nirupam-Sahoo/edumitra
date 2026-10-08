/**
 * Wire-contract test: reproduce the exact request the PWA client's
 * `SyncEngine` produces — same header names, same signature scheme
 * (hex HMAC-SHA256 over `${timestamp}.${bodyText}`), gzipped body — against
 * a real listening server, and assert the response keys the client reads.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createHarness, type TestHarness } from './helpers.js';

const SECRET = 'dev-only-insecure-shared-secret';

/** Mirrors client `SyncEngine.signBody`. */
function signBody(secret: string, timestamp: number, bodyText: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${bodyText}`).digest('hex');
}

describe('client → server wire contract', () => {
  let harness: TestHarness;
  let baseUrl: string;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edumitra-wire-'));
    harness = await createHarness({ DATA_DIR: dir, SYNC_SIGNING_SECRET: SECRET });
    await harness.app.listen({ port: 0, host: '127.0.0.1' });
    const address = harness.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await harness.app.close();
    await harness.close().catch(() => {});
  });

  it('accepts the client’s gzip sync payload and returns the expected shape', async () => {
    // Built exactly like the client: deviceId + clientSentAt + statements +
    // camelCase checkpoints; signed over the *uncompressed* JSON text, sent
    // gzipped with Content-Encoding.
    const bodyText = JSON.stringify({
      deviceId: 'wire-device-1',
      clientSentAt: Date.now(),
      statements: [
        {
          id: 'wire-stmt-1',
          actor: { objectType: 'Agent', account: { name: 'student-asha', homePage: 'https://edumitra.org' } },
          verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
          object: { objectType: 'Activity', id: 'https://edumitra.org/activities/lesson/math-fractions-1' },
          result: { completion: true, success: true, score: { scaled: 1, min: 0, max: 1 } },
          timestamp: new Date().toISOString(),
        },
      ],
      checkpoints: [
        {
          id: 'student-asha::math-fractions-1::completion_status',
          studentId: 'student-asha',
          lessonId: 'math-fractions-1',
          key: 'completion_status',
          value: 2,
          ts: Date.now(),
          op: 'put',
          sourceStatementId: 'wire-stmt-1',
        },
      ],
    });
    const timestamp = Date.now();
    const gzipped = gzipSync(Buffer.from(bodyText, 'utf-8'));

    const res = await fetch(`${baseUrl}/api/v1/sync/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'x-sync-device': 'wire-device-1',
        'x-sync-timestamp': String(timestamp),
        'x-sync-signature': signBody(SECRET, timestamp, bodyText),
      },
      body: gzipped,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, any>;
    // Fields the client's SyncEngine reads:
    expect(typeof json.accepted).toBe('number');
    expect(typeof json.duplicates).toBe('number');
    expect(typeof json.rejected).toBe('number');
    expect(typeof json.serverTime).toBe('number');
    expect(json.pull).toMatchObject({ hasMore: false });
    expect(json.accepted).toBe(1);
    expect(json.duplicates).toBe(0);
    expect(json.rejected).toBe(0);

    // Merged progress is visible through the public read API.
    const state = await fetch(`${baseUrl}/api/v1/cmi5/state?student=student-asha`);
    expect(state.status).toBe(200);
    expect(JSON.stringify(await state.json())).toContain('completion_status');
  });

  it('rejects the same payload when the body is tampered after signing', async () => {
    const bodyText = JSON.stringify({
      deviceId: 'wire-device-1',
      clientSentAt: Date.now(),
      statements: [],
      checkpoints: [],
    });
    const timestamp = Date.now();
    const gzipped = gzipSync(Buffer.from(bodyText + ' ', 'utf-8'));
    const res = await fetch(`${baseUrl}/api/v1/sync/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'x-sync-device': 'wire-device-1',
        'x-sync-timestamp': String(timestamp),
        'x-sync-signature': signBody(SECRET, timestamp, bodyText),
      },
      body: gzipped,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
