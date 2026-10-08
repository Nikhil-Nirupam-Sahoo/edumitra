/**
 * End-to-end sync tests through the real HTTP layer:
 *  - HMAC signing/replay/Skew enforcement
 *  - idempotent multi-day offline backlog ingest
 *  - CRDT convergence across two devices that were offline concurrently
 *  - delta pull between devices
 */

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { PROGRESS_KEYS } from '../src/sync/crdt.js';

let harness: TestHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const SECRET = 'test-secret-at-least-16-chars';

function sign(body: string, timestamp: number, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function envelope(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const timestamp = Date.now();
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-sync-timestamp': String(timestamp),
      'x-sync-signature': sign(raw, timestamp),
    },
  };
}

function makeStatement(id: string, studentId: string, lessonId: string, timestamp = Date.now()) {
  return {
    id,
    actor: { objectType: 'Agent', account: { homePage: 'https://edumitra.org', name: studentId } },
    verb: { id: 'http://adlnet.gov/expapi/verbs/attempted', display: { 'en-US': 'attempted' } },
    object: { objectType: 'Activity', id: `https://edumitra.org/activities/lesson/${lessonId}` },
    timestamp: new Date(timestamp).toISOString(),
  };
}

describe('POST /api/v1/sync/progress', () => {
  it('accepts a signed batch and returns ingest counts', async () => {
    harness = await createHarness();
    const { raw, headers } = envelope({
      deviceId: 'device-1',
      statements: [makeStatement('s1', 'student-1', 'math-1')],
      checkpoints: [],
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: raw,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(1);
    expect(body.duplicates).toBe(0);
    expect(body.pull).toBeDefined();
  });

  it('rejects unsigned or tampered batches with 401', async () => {
    harness = await createHarness();
    const { raw, headers } = envelope({ deviceId: 'device-1', statements: [], checkpoints: [] });

    const missing = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: raw,
      headers: { 'content-type': 'application/json' },
    });
    expect(missing.statusCode).toBe(401);

    const tampered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: raw.replace('device-1', 'device-2'),
      headers,
    });
    expect(tampered.statusCode).toBe(401);

    const staleTs = Date.now() - 10 * 60_000;
    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: raw,
      headers: {
        'content-type': 'application/json',
        'x-sync-timestamp': String(staleTs),
        'x-sync-signature': sign(raw, staleTs),
      },
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().reason).toBe('skew');
  });

  it('is idempotent across identical multi-day backlog replays', async () => {
    harness = await createHarness();
    const statements = Array.from({ length: 5 }, (_, index) =>
      makeStatement(`stmt-${index}`, 'student-1', 'math-1', 1_700_000_000_000 + index),
    );

    for (let replay = 0; replay < 3; replay++) {
      const { raw, headers } = envelope({ deviceId: 'device-1', statements, checkpoints: [] });
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/sync/progress',
        payload: raw,
        headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      if (replay === 0) {
        expect(body.accepted).toBe(5);
      } else {
        expect(body.accepted).toBe(0);
        expect(body.duplicates).toBe(5);
      }
    }
    expect(await harness.syncService.lrs.countStatements()).toBe(5);
  });

  it('converges CRDT state when two offline devices answered concurrently', async () => {
    harness = await createHarness();

    const deviceA = envelope({
      deviceId: 'device-a',
      statements: [],
      checkpoints: [
        {
          id: 'a-score',
          studentId: 'student-1',
          lessonId: 'math-1',
          key: PROGRESS_KEYS.score,
          value: 0.6,
          ts: 10_000,
          op: 'log-reading',
          sourceStatementId: 'a-stmt',
        },
        {
          id: 'a-time',
          studentId: 'student-1',
          lessonId: 'math-1',
          key: PROGRESS_KEYS.timeOnTaskMs,
          value: 30_000,
          ts: 10_000,
          op: 'count-inc',
          sourceStatementId: 'a-dwell',
        },
        {
          id: 'a-status',
          studentId: 'student-1',
          lessonId: 'math-1',
          key: PROGRESS_KEYS.completionStatus,
          value: 1,
          ts: 10_000,
          op: 'put',
          sourceStatementId: 'a-start',
        },
      ],
    });
    const deviceB = envelope({
      deviceId: 'device-b',
      statements: [],
      checkpoints: [
        {
          id: 'b-score',
          studentId: 'student-1',
          lessonId: 'math-1',
          key: PROGRESS_KEYS.score,
          value: 0.9,
          ts: 20_000,
          op: 'log-reading',
          sourceStatementId: 'b-stmt',
        },
        {
          id: 'b-time',
          studentId: 'student-1',
          lessonId: 'math-1',
          key: PROGRESS_KEYS.timeOnTaskMs,
          value: 20_000,
          ts: 20_000,
          op: 'count-inc',
          sourceStatementId: 'b-dwell',
        },
        {
          id: 'b-status',
          studentId: 'student-1',
          lessonId: 'math-1',
          key: PROGRESS_KEYS.completionStatus,
          value: 2,
          ts: 20_000,
          op: 'put',
          sourceStatementId: 'b-done',
        },
      ],
    });

    // Interleaved arrival, worst case ordering.
    for (const batch of [deviceA, deviceB]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/sync/progress',
        payload: batch.raw,
        headers: { 'content-type': 'application/json', ...batch.headers },
      });
      expect(response.statusCode).toBe(200);
    }

    const state = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/cmi5/state?student=student-1',
    });
    expect(state.statusCode).toBe(200);
    const head = state.json().heads[0];
    expect(head.lessonId).toBe('math-1');
    expect(head.completionStatus).toBe('completed');
    expect(head.score).toBe(0.9);
    // Both device increments land: never lost despite the offline overlap.
    expect(head.timeOnTaskMs).toBe(50_000);
  });

  it('re-running the identical checkpoint batch is a no-op (duplicate ledger)', async () => {
    harness = await createHarness();
    const batch = envelope({
      deviceId: 'device-a',
      statements: [],
      checkpoints: [
        {
          id: 'inc',
          studentId: 'student-1',
          lessonId: 'math-1',
          key: PROGRESS_KEYS.timeOnTaskMs,
          value: 1_000,
          ts: 5_000,
          op: 'count-inc',
          sourceStatementId: 'dwell-1',
        },
      ],
    });
    for (let i = 0; i < 3; i++) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/sync/progress',
        payload: batch.raw,
        headers: { 'content-type': 'application/json', ...batch.headers },
      });
      expect(response.statusCode).toBe(200);
    }
    const state = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/cmi5/state?student=student-1',
    });
    expect(state.json().heads[0].timeOnTaskMs).toBe(1_000);
  });
});

describe('delta pull', () => {
  it('delivers only statements the requesting device has not seen', async () => {
    harness = await createHarness();

    const fromA = envelope({
      deviceId: 'device-a',
      statements: [makeStatement('from-a', 'student-1', 'math-1', 1_000)],
      checkpoints: [],
    });
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: fromA.raw,
      headers: { 'content-type': 'application/json', ...fromA.headers },
    });

    // Device B connects for the first time.
    const fromB = envelope({
      deviceId: 'device-b',
      statements: [makeStatement('from-b', 'student-1', 'math-1', 2_000)],
      checkpoints: [],
    });
    const bResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: fromB.raw,
      headers: { 'content-type': 'application/json', ...fromB.headers },
    });
    const pulled = bResponse.json().pull.statements.map((s: { id: string }) => s.id);
    expect(pulled).toContain('from-a');
    expect(pulled).not.toContain('from-b');

    // Device A's second sync must not receive its own statements back.
    const fromA2 = envelope({ deviceId: 'device-a', statements: [], checkpoints: [] });
    const aResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: fromA2.raw,
      headers: { 'content-type': 'application/json', ...fromA2.headers },
    });
    const aPulled = aResponse.json().pull.statements.map((s: { id: string }) => s.id);
    expect(aPulled).toContain('from-b');
    expect(aPulled).not.toContain('from-a');
  });
});

describe('GET /api/v1/cmi5/state and /lrs/statements', () => {
  it('serves merged state and queryable LRS statements', async () => {
    harness = await createHarness();
    const { raw, headers } = envelope({
      deviceId: 'device-1',
      statements: [makeStatement('q1', 'student-1', 'math-1', 5_000)],
      checkpoints: [],
    });
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: raw,
      headers,
    });

    const lrs = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/lrs/statements?student=student-1&limit=10',
    });
    expect(lrs.statusCode).toBe(200);
    expect(lrs.json().statements[0].id).toBe('q1');

    const wrongStudent = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/cmi5/state?student=',
    });
    expect(wrongStudent.statusCode).toBe(400);
  });

  it('exposes a cheap manifest for pre-sync probes', async () => {
    harness = await createHarness();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/sync/manifest',
      headers: { 'x-sync-device': 'device-1' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.statementCount).toBe(0);
    expect(body.device).toEqual({ lastSeenAt: 0, lastStatementTs: 0 });
  });

  it('serves health with the active driver', async () => {
    harness = await createHarness();
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(response.json().driver).toBe('dev');
  });
});
