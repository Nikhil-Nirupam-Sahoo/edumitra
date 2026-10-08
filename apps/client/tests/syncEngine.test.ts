/**
 * Sync engine tests. The engine is exercised with an injected fetch so the
 * exact wire behavior (batching, marking synced, backoff, offline skip, purge)
 * is verified without a network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllData,
  countPending,
  getCheckpoints,
  getPendingStatements,
  mergeCheckpoints,
  setMeta,
} from '../src/db/client';
import { logLessonStarted, logQuestionAnswered } from '../src/sync/xapiLogger';
import {
  SyncEngine,
  signBody,
  DEFAULT_SYNC_CONFIG,
  type SyncConfig,
  type SyncResponsePayload,
} from '../src/sync/syncEngine';

const TEST_CONFIG: Partial<SyncConfig> = {
  apiBase: '/api/v1',
  signingSecret: 'test-secret-at-least-16-chars',
  flushBatchSize: 2,
  requestTimeoutMs: 5_000,
  backoffBaseMs: 10,
  maxBackoffMs: 100,
  purgeAfterMs: 7 * 24 * 60 * 60 * 1000,
  softIntervalMs: 60_000,
};

function okResponse(overrides: Partial<SyncResponsePayload> = {}): SyncResponsePayload {
  return {
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    serverTime: Date.now(),
    nextCheckpoint: Date.now(),
    pull: { statements: [], checkpoints: [], hasMore: false },
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('SyncEngine', () => {
  beforeEach(async () => {
    await clearAllData();
    // Guarantee "online" in jsdom.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('does nothing while offline and keeps statements queued', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await logLessonStarted('student-1', 'math-1', { now: 1_000 });
    const fetchImpl = vi.fn();
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
    const result = await engine.run();
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await countPending()).toBe(1);
  });

  it('pushes queued statements, marks them synced, and acknowledges checkpoints', async () => {
    await logLessonStarted('student-1', 'math-1', { now: 1_000 });
    await logQuestionAnswered('student-1', 'math-1', 'q1', 'b', true, { now: 2_000 });

    const fetchImpl = vi.fn(async () => jsonResponse(okResponse()));
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
    const result = await engine.run();

    expect(result?.ok).toBe(true);
    expect(result?.pushed).toBe(2);
    // With flushBatchSize=2 this is a single request.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/sync/progress');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-sync-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['x-sync-timestamp']).toBeDefined();
    const body = JSON.parse(String(init.body)) as {
      deviceId: string;
      statements: Array<{ id: string }>;
      checkpoints: Array<{ key: string; value: number }>;
    };
    expect(body.statements).toHaveLength(2);
    expect(body.checkpoints.some((cp) => cp.key === 'completion.status')).toBe(true);

    expect(await countPending()).toBe(0);
    const checkpoints = await getCheckpoints();
    expect(checkpoints.every((cp) => cp.acknowledged === 1)).toBe(true);
  });

  it('keeps rows pending and reports failure when the server errors', async () => {
    await logLessonStarted('student-1', 'math-1', { now: 1_000 });
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
    const result = await engine.run();

    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('500');
    const pending = await getPendingStatements(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].last_attempt_at).not.toBeNull();
  });

  it('retries a failed batch successfully on the next run (no data loss)', async () => {
    await logLessonStarted('student-1', 'math-1', { now: 1_000 });
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return jsonResponse(okResponse());
    });
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);

    const first = await engine.run();
    expect(first?.ok).toBe(false);
    expect(await countPending()).toBe(1);

    const second = await engine.run();
    expect(second?.ok).toBe(true);
    expect(await countPending()).toBe(0);
  });

  it('chunks large queues according to flushBatchSize', async () => {
    for (let i = 0; i < 5; i++) {
      await logLessonStarted('student-1', `lesson-${i}`, { now: 1_000 + i });
    }
    const fetchImpl = vi.fn(async () => jsonResponse(okResponse()));
    const engine = new SyncEngine(
      { ...TEST_CONFIG, flushBatchSize: 2 },
      fetchImpl as unknown as typeof fetch,
    );
    const result = await engine.run();
    expect(result?.pushed).toBe(5);
    // ceil(5/2) = 3 requests
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(await countPending()).toBe(0);
  });

  it('purges synced rows older than purgeAfterMs', async () => {
    // Fresh timestamp: the first run must NOT purge this row (it only becomes
    // "too old" when the test backdates it below).
    await logLessonStarted('student-1', 'math-1', { now: Date.now() });
    const fetchImpl = vi.fn(async () => jsonResponse(okResponse()));
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
    await engine.run();
    // Backdate the synced row beyond retention.
    const db = await (await import('../src/db/client')).openDb();
    const tx = db.transaction('xapi_queue', 'readwrite');
    const row = await new Promise<{ id: string; timestamp: number } | undefined>((resolve) => {
      const request = tx.objectStore('xapi_queue').getAll();
      request.onsuccess = () => resolve((request.result as Array<{ id: string; timestamp: number }>)[0]);
    });
    if (row) {
      await new Promise<void>((resolve) => {
        const put = tx.objectStore('xapi_queue').put({
          ...row,
          status: 'synced',
          timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
        });
        put.onsuccess = () => resolve();
      });
    }

    const secondRun = vi.fn(async () => jsonResponse(okResponse()));
    const engine2 = new SyncEngine(TEST_CONFIG, secondRun as unknown as typeof fetch);
    const result = await engine2.run();
    expect(result?.purged).toBeGreaterThanOrEqual(1);
  });

  it('applies pulled statements and checkpoints to the local cache', async () => {
    await logLessonStarted('student-1', 'math-1', { now: 1_000 });
    const remoteStatement = {
      id: 'remote-1',
      actor: { objectType: 'Agent', account: { name: 'student-2' } },
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
      object: { objectType: 'Activity', id: 'https://edumitra.org/activities/lesson/math-1' },
      timestamp: new Date(5_000).toISOString(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        okResponse({
          pull: {
            statements: [remoteStatement],
            checkpoints: [
              {
                id: 'student-2::math-1::completion.status',
                studentId: 'student-2',
                lessonId: 'math-1',
                key: 'completion.status',
                value: 2,
                ts: 5_000,
                op: 'put',
                sourceStatementId: 'remote-1',
              },
            ],
            hasMore: false,
          },
        }),
      ),
    );
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
    const result = await engine.run();
    expect(result?.pulled).toBe(1);

    const queue = await getPendingStatements(10);
    expect(queue).toHaveLength(0);
    const all = await (await import('../src/db/client')).getAllProgress();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const pulledCheckpoint = (await getCheckpoints()).find(
      (cp) => cp.student_id === 'student-2',
    );
    expect(pulledCheckpoint).toMatchObject({ value: 2, acknowledged: 1 });
  });

  it('coalesces concurrent run() calls onto a single in-flight request', async () => {
    await logLessonStarted('student-1', 'math-1', { now: Date.now() });
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
    const first = engine.run();
    const second = engine.run(); // must return null immediately
    expect(await second).toBeNull();
    // fetch is only issued after the engine's async prologue (queue read,
    // payload build) — wait until it's actually in flight before resolving.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    resolveFetch(jsonResponse(okResponse()));
    const result = await first;
    expect(result?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('emits results to registered listeners', async () => {
    await logLessonStarted('student-1', 'math-1', { now: 1_000 });
    const fetchImpl = vi.fn(async () => jsonResponse(okResponse()));
    const engine = new SyncEngine(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
    const seen: string[] = [];
    engine.onResult((result) => seen.push(result.ok ? 'ok' : 'fail'));
    await engine.run();
    expect(seen).toEqual(['ok']);
  });
});

describe('signBody', () => {
  it('produces a stable 64-char hex digest that changes with the payload', async () => {
    const first = await signBody('secret-key', 1_000, '{"a":1}');
    const same = await signBody('secret-key', 1_000, '{"a":1}');
    const differentBody = await signBody('secret-key', 1_000, '{"a":2}');
    const differentTs = await signBody('secret-key', 2_000, '{"a":1}');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(same);
    expect(differentBody).not.toBe(first);
    expect(differentTs).not.toBe(first);
  });
});

describe('defaults', () => {
  it('exposes production-sane defaults for low-bandwidth devices', () => {
    expect(DEFAULT_SYNC_CONFIG.flushBatchSize).toBeLessThanOrEqual(250);
    expect(DEFAULT_SYNC_CONFIG.requestTimeoutMs).toBeGreaterThanOrEqual(10_000);
    expect(DEFAULT_SYNC_CONFIG.purgeAfterMs).toBeGreaterThan(0);
  });
});
