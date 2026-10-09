/**
 * Support API tests — mentor requests and the AI tutor proxy.
 *
 * The Anthropic call is always stubbed; no real key is used. What is under test
 * is the contract the browser depends on:
 *  - the tutor is inert (503) unless a key is configured, and no upstream call
 *    is made in that case;
 *  - the key travels in the upstream header only and never in a response;
 *  - mentor questions require a session, are stored, and the inbox is
 *    teacher-only — a student's token gets a 403.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSupportRoutes } from '../src/support/support.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { registerAuthHook, registerAuthRoutes } from '../src/auth/auth.controller.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import type { DbPort } from '../src/db/types.js';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

interface Built {
  app: FastifyInstance;
  db: DbPort;
  close(): Promise<void>;
}

async function build(apiKey: string | null): Promise<Built> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'dev',
    SYNC_SIGNING_SECRET: 'test-secret-at-least-16-chars',
    ANTHROPIC_API_KEY: '',
  } as NodeJS.ProcessEnv);
  const db = await createDatabase(config);
  const auth = new AuthService(db, config.sync.signingSecret);
  await auth.ensureDemoUsers();

  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  // Mirrors app.ts: the session hook lives on the root instance, so the
  // separately-registered support routes can see request.auth.
  registerAuthHook(app, auth);
  await app.register(
    async (instance) => {
      await registerAuthRoutes(instance, { auth });
    },
    { prefix: '/api/v1' },
  );
  await app.register(
    async (instance) => {
      await registerSupportRoutes(instance, { config, db, apiKey });
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

async function token(app: FastifyInstance, username: string): Promise<string> {
  const password = username.startsWith('meera') || username.startsWith('rajesh')
    ? 'teach1234'
    : 'learn1234';
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token as string;
}

describe('GET /api/v1/support/status', () => {
  it('reports disabled without a key and enabled with one', async () => {
    const off = await build(null);
    const offStatus = await off.app.inject({
      method: 'GET',
      url: '/api/v1/support/status',
    });
    expect(offStatus.json()).toEqual({ aiEnabled: false });
    await off.close();

    const on = await build('server-side-key');
    const onStatus = await on.app.inject({
      method: 'GET',
      url: '/api/v1/support/status',
    });
    expect(onStatus.json()).toEqual({ aiEnabled: true });
    await on.close();
  });
});

describe('POST /api/v1/support/ask', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 503 and never calls upstream when unconfigured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { app, close } = await build(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/ask',
      payload: { message: 'Why is 0 not divisible by 2?' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('ai_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
    await close();
  });

  it('rejects an empty or oversized message', async () => {
    const { app, close } = await build('server-side-key');

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/support/ask',
      payload: { message: '' },
    });
    expect(empty.statusCode).toBe(400);

    const huge = await app.inject({
      method: 'POST',
      url: '/api/v1/support/ask',
      payload: { message: 'x'.repeat(5000) },
    });
    expect(huge.statusCode).toBe(400);

    await close();
  });

  it('proxies to Anthropic and never leaks the key to the client', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'Because dividing 0 by 2 gives 0, not a whole number.' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { app, close } = await build('super-secret-ai-key');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/ask',
      payload: {
        message: 'Why is 0 not divisible by 2?',
        history: [{ role: 'user', content: 'hi' }],
        grade: 8,
        className: 'class-8-a',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.answer).toContain('dividing 0 by 2');
    expect(JSON.stringify(body)).not.toContain('super-secret-ai-key');

    // The key went out in the x-api-key header, and the system prompt was
    // grounded in the student's class.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('super-secret-ai-key');
    const sent = JSON.parse(String(init.body)) as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.system).toContain('Class 8');
    expect(sent.messages).toHaveLength(2);
    expect(sent.messages[1]!.content).toBe('Why is 0 not divisible by 2?');
    await close();
  });

  it('surfaces upstream failure as 502 so the UI can fall back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('overloaded', { status: 529 })),
    );
    const { app, close } = await build('server-side-key');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/ask',
      payload: { message: 'Explain linear equations' },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('upstream_error');
    await close();
  });

  it('treats an empty completion as an upstream error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { app, close } = await build('server-side-key');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/ask',
      payload: { message: 'Explain linear equations' },
    });
    expect(response.statusCode).toBe(502);
    await close();
  });
});

describe('mentor requests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists teachers as mentors, read from the users table', async () => {
    const { app, close } = await build(null);
    const response = await app.inject({ method: 'GET', url: '/api/v1/support/mentors' });
    expect(response.statusCode).toBe(200);
    const names = response.json().mentors.map((m: { display_name: string }) => m.display_name);
    expect(names).toContain('Meera Teacher');
    await close();
  });

  it('requires a session to ask a question', async () => {
    const { app, close } = await build(null);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request',
      payload: { subject: 'Linear equations', body: 'I am stuck on question 3' },
    });
    expect(response.statusCode).toBe(401);
    await close();
  });

  it('stores a student question and shows it back to that student', async () => {
    const { app, close } = await build(null);
    const studentToken = await token(app, 'aarav');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request',
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { subject: 'Linear equations', body: 'I am stuck on question 3' },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/support/my-requests',
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(mine.statusCode).toBe(200);
    const requests = mine.json().requests as Array<{ id: string; subject: string; status: string }>;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.id).toBe(id);
    expect(requests[0]!.status).toBe('open');
    await close();
  });

  it('never shows one student another student\'s questions', async () => {
    const { app, close } = await build(null);
    const aarav = await token(app, 'aarav');
    const priya = await token(app, 'priya');

    await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request',
      headers: { authorization: `Bearer ${aarav}` },
      payload: { subject: 'Private question', body: 'Only mine' },
    });

    const theirs = await app.inject({
      method: 'GET',
      url: '/api/v1/support/my-requests',
      headers: { authorization: `Bearer ${priya}` },
    });
    expect(theirs.json().requests).toHaveLength(0);
    await close();
  });

  it('gates the teacher inbox: students get 403, teachers get the list', async () => {
    const { app, close } = await build(null);
    const aarav = await token(app, 'aarav');
    const meera = await token(app, 'meera');

    await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request',
      headers: { authorization: `Bearer ${aarav}` },
      payload: { subject: 'Question for the teacher', body: 'Please help' },
    });

    const asStudent = await app.inject({
      method: 'GET',
      url: '/api/v1/support/mentor-requests',
      headers: { authorization: `Bearer ${aarav}` },
    });
    expect(asStudent.statusCode).toBe(403);

    const asTeacher = await app.inject({
      method: 'GET',
      url: '/api/v1/support/mentor-requests',
      headers: { authorization: `Bearer ${meera}` },
    });
    expect(asTeacher.statusCode).toBe(200);
    const requests = asTeacher.json().requests as Array<{ subject: string; status: string }>;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.subject).toBe('Question for the teacher');
    expect(requests[0]!.status).toBe('open');
    await close();
  });

  it('lets a teacher close a question and removes it from the open list', async () => {
    const { app, db, close } = await build(null);
    const aarav = await token(app, 'aarav');
    const meera = await token(app, 'meera');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request',
      headers: { authorization: `Bearer ${aarav}` },
      payload: { subject: 'Trapezium', body: 'Why is only one pair parallel?' },
    });
    const { id } = created.json() as { id: string };

    const resolved = await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request/resolve',
      headers: { authorization: `Bearer ${meera}` },
      payload: { id, status: 'answered' },
    });
    expect(resolved.statusCode).toBe(200);

    const row = await db.queryOne<{ status: string }>(
      'SELECT status FROM support_requests WHERE id = ?',
      [id],
    );
    expect(row?.status).toBe('answered');

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/support/my-requests',
      headers: { authorization: `Bearer ${aarav}` },
    });
    expect((mine.json().requests as Array<{ status: string }>)[0]!.status).toBe('answered');
    await close();
  });

  it('404s when resolving an unknown question and 403s for a student', async () => {
    const { app, close } = await build(null);
    const aarav = await token(app, 'aarav');
    const meera = await token(app, 'meera');

    const asStudent = await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request/resolve',
      headers: { authorization: `Bearer ${aarav}` },
      payload: { id: 'does-not-exist' },
    });
    expect(asStudent.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request/resolve',
      headers: { authorization: `Bearer ${meera}` },
      payload: { id: 'does-not-exist' },
    });
    expect(missing.statusCode).toBe(404);
    await close();
  });

  it('rejects an empty question body', async () => {
    const { app, close } = await build(null);
    const aarav = await token(app, 'aarav');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/mentor-request',
      headers: { authorization: `Bearer ${aarav}` },
      payload: { subject: 'Hi', body: '' },
    });
    expect(response.statusCode).toBe(400);
    await close();
  });
});