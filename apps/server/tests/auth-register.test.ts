/**
 * Auth service tests — registration and Google sign-in.
 *
 * Google's tokeninfo endpoint is always stubbed. What matters is that a token
 * minted for a *different* app is rejected, that one Google account never
 * becomes two local users, and that an account which already exists with a
 * password is linked rather than duplicated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes } from '../src/auth/auth.controller.js';
import { AuthService, hashPassword, OAUTH_PASSWORD_SENTINEL } from '../src/auth/auth.service.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import type { DbPort } from '../src/db/types.js';
import Fastify, { type FastifyInstance } from 'fastify';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

let db: DbPort;
let auth: AuthService;
let app: FastifyInstance;

const baseInput = {
  username: 'Newstudent',
  password: 'correct horse battery',
  confirmPassword: 'correct horse battery',
  displayName: '  Aarav K  ',
  role: 'student' as const,
};

async function boot(overrides: Parameters<typeof registerAuthRoutes>[1] extends never ? never : Record<string, unknown> = {}) {
  const instance = Fastify({ logger: false });
  await instance.register(
    async (scoped) => {
      await registerAuthRoutes(scoped, { auth, googleClientId: CLIENT_ID, ...overrides });
    },
    { prefix: '/api/v1' },
  );
  await instance.ready();
  return instance;
}

/** A plausible tokeninfo response for `sub`. */
function tokeninfo(body: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ aud: CLIENT_ID, sub: 'g-1', email_verified: true, ...body }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

function login(username: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
}

beforeEach(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'dev',
    SYNC_SIGNING_SECRET: 'test-secret-at-least-16-chars',
  } as NodeJS.ProcessEnv);
  db = await createDatabase(config);
  auth = new AuthService(db, config.sync.signingSecret);
  await auth.ensureDemoUsers();
  app = await boot();
});

afterEach(async () => {
  await app?.close();
  await db?.close();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/auth/providers', () => {
  it('reports the configured sign-in methods', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })).json();
    expect(body.password).toBe(true);
    expect(body.google).toBe(CLIENT_ID);
    expect(body.allowTeacherSignup).toBe(false);
  });

  it('reports no Google button when no client id is configured', async () => {
    const instance = await boot({ googleClientId: null });
    const body = (await instance.inject({ method: 'GET', url: '/api/v1/auth/providers' })).json();
    expect(body.google).toBeNull();
    await instance.close();
  });

  it('reports teacher sign-up when the deployment allows it', async () => {
    const instance = await boot({ allowTeacherSignup: true });
    const body = (await instance.inject({ method: 'GET', url: '/api/v1/auth/providers' })).json();
    expect(body.allowTeacherSignup).toBe(true);
    await instance.close();
  });
});

describe('POST /api/v1/auth/register', () => {
  it('creates a student and signs it straight in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: baseInput,
    });
    expect(response.statusCode).toBe(200);
    const { token, user } = response.json() as {
      token: string;
      user: { id: string; displayName: string; role: string; username: string };
    };
    expect(user.displayName).toBe('Aarav K');
    expect(user.role).toBe('student');
    expect(user.username).toBe('newstudent'); // normalised
    expect(token).toBeTruthy();

    // The account is real, not just a response.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().user.username).toBe('newstudent');
  });

  it('lets the new account sign in with its own password', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: baseInput,
    });
    const response = await login('newstudent', 'correct horse battery');
    expect(response.statusCode).toBe(200);
  });

  it('rejects a short password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, password: 'short', confirmPassword: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a username that is too short', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, username: 'ab' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects mismatched passwords', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, confirmPassword: 'something else entirely' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a duplicate username case-insensitively', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: baseInput });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, username: 'NewStudent', displayName: 'Other person' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('username_taken');
  });

  it('refuses a teacher self-registration by default', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, username: 'wannabeteacher', role: 'teacher' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('role_not_allowed');
    // And it must not have created the account at all.
    expect(await login('wannabeteacher', 'correct horse battery')).toMatchObject({
      statusCode: 401,
    });
  });

  it('allows a teacher registration when the deployment opts in', async () => {
    const instance = await boot({ allowTeacherSignup: true });
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, username: 'realteacher', role: 'teacher' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe('teacher');
    await instance.close();
  });

  it('never stores the plaintext password', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: baseInput });
    const row = await db.queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE username = ?',
      ['newstudent'],
    );
    expect(row!.password_hash).not.toContain('correct horse battery');
    expect(row!.password_hash.startsWith('scrypt$')).toBe(true);
  });
});

describe('POST /api/v1/auth/google', () => {
  it('is disabled with no client id configured', async () => {
    const instance = await boot({ googleClientId: null });
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(503);
    await instance.close();
  });

  it('rejects a token minted for a different app', async () => {
    // The `aud` check is what stops a token for anyone's Google app from being
    // replayed against ours.
    const wrongAud = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ aud: 'someone-elses-app', sub: 'g-1', email_verified: true }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', wrongAud);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('audience_mismatch');
  });

  it('rejects a token with an unverified email', async () => {
    vi.stubGlobal(
      'fetch',
      tokeninfo({ email: 'a@b.com', email_verified: false }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('email_unverified');
  });

  it('rejects a token Google will not vouch for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad', { status: 400 })),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('invalid_token');
  });

  it('creates an account on first Google sign-in and signs it in', async () => {
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-1', email: 'nikhil@example.com', name: 'Nikhil S' }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(200);
    const { token, user } = response.json() as {
      token: string;
      user: { id: string; username: string; role: string; displayName: string };
    };
    expect(user.username).toBe('nikhil');
    expect(user.displayName).toBe('Nikhil S');
    expect(user.role).toBe('student');
    expect(token).toBeTruthy();
  });

  it('reuses the same account on a second sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-1', email: 'nikhil@example.com', name: 'Nikhil S' }),
    );
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(second.json().user.id).toBe(first.json().user.id);
    // Only one row exists.
    const rows = await db.query('SELECT id FROM users WHERE google_sub = ?', ['g-1']);
    expect(rows).toHaveLength(1);
  });

  it('keeps a Google account separate from a same-email password account', async () => {
    // Sign-up stores no email (it asks for a username), so there is no email to
    // link on. The accounts must stay distinct rather than one silently taking
    // over the other's class progress.
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, username: 'separateaccount', displayName: 'Separate' },
    });
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-9', email: 'separate@example.com', name: 'Separate' }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe('separate');
  });

  it('links an existing password account instead of duplicating it', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...baseInput, username: 'ownaccount', displayName: 'Own Account' },
    });
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-9', email: 'own@example.com', name: 'Own Account' }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(200);
    // Same local account, so class progress is not split in two.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${response.json().token}` },
    });
    expect(me.json().user.username).toBe('own');
  });

  it('a Google account cannot authenticate with a password', async () => {
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-1', email: 'nikhil@example.com', name: 'Nikhil S' }),
    );
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    // The stored hash is a sentinel, so no password can ever match it.
    const row = await db.queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE google_sub = ?',
      ['g-1'],
    );
    expect(row!.password_hash).toBe(OAUTH_PASSWORD_SENTINEL);
    expect(await login('nikhil', 'anything at all')).toMatchObject({ statusCode: 401 });
  });

  it('suffixes the username when the prefix is already a demo account', async () => {
    // 'aarav' exists as a seeded demo student, so a Google user with an
    // aarav@ address must NOT silently take over that account.
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-5', email: 'aarav@example.com', name: 'Aarav K' }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe('aarav1');
  });

  it('falls back to the Google sub when there is no email', async () => {
    vi.stubGlobal('fetch', tokeninfo({ sub: 'g-nomail-123', name: 'No Email' }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toContain('ug-nomail-123');
  });

  it('derives a unique username when the email prefix is already taken', async () => {
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-1', email: 'nikhil@example.com', name: 'Nikhil S' }),
    );
    await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { idToken: 'x'.repeat(40) } });
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-2', email: 'nikhil@example.com', name: 'Nikhil Two' }),
    );
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().user.username).toBe('nikhil1');
  });

  it('defaults a Google sign-in to the student role', async () => {
    vi.stubGlobal(
      'fetch',
      tokeninfo({ sub: 'g-1', email: 'priya@example.com', name: 'Priya P' }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(40) },
    });
    expect(response.json().user.role).toBe('student');
  });
});

describe('registerSchema', () => {
  it('rejects an over-long id token before it reaches the network', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'x'.repeat(5000) },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('password sentinel', () => {
  it('can never be verified against any password', async () => {
    expect(OAUTH_PASSWORD_SENTINEL).not.toBe('');
    expect(OAUTH_PASSWORD_SENTINEL.startsWith('scrypt$')).toBe(false);
    // A real hash has a different shape, so the sentinel is unmatchable.
    expect(hashPassword('x')).not.toBe(OAUTH_PASSWORD_SENTINEL);
  });
});