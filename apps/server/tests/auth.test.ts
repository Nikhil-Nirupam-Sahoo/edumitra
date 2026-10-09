/**
 * Auth & role tests.
 *
 * The property that matters most: role is enforced by the SERVER. A student
 * token must not reach a teacher-only route no matter what the client does.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  AuthService,
  hashPassword,
  signSession,
  verifyPassword,
  verifySession,
} from '../src/auth/auth.service.js';
import { registerAuthRoutes } from '../src/auth/auth.controller.js';
import { createDatabase } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import type { DbPort } from '../src/db/index.js';

const SECRET = 'test-signing-secret-0123456789';

let db: DbPort;
let auth: AuthService;
let app: FastifyInstance;

async function boot(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  // Same prefix the app registers, so the URLs below match production.
  await instance.register(
    async (scoped) => {
      await registerAuthRoutes(scoped, { auth });
    },
    { prefix: '/api/v1' },
  );
  await instance.ready();
  return instance;
}

describe('password hashing', () => {
  it('round-trips a correct password', () => {
    const stored = hashPassword('learn1234');
    expect(verifyPassword('learn1234', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('learn1234');
    expect(verifyPassword('learn12345', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('never stores the plaintext and salts each hash', () => {
    const a = hashPassword('learn1234');
    const b = hashPassword('learn1234');
    expect(a).not.toBe(b); // different salt
    expect(a).not.toContain('learn1234');
    expect(a.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$')).toBe(false);
    expect(verifyPassword('x', 'scrypt$zz$zz')).toBe(false);
  });
});

describe('sessions', () => {
  it('signs and verifies', () => {
    const token = signSession({ userId: 'u1', role: 'student', exp: Date.now() + 60_000 }, SECRET);
    expect(verifySession(token, SECRET)?.userId).toBe('u1');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession({ userId: 'u1', role: 'student', exp: Date.now() + 60_000 }, 'other');
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSession({ userId: 'u1', role: 'student', exp: Date.now() - 1 }, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signSession({ userId: 'student', role: 'student', exp: Date.now() + 60_000 }, SECRET);
    const [body] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ userId: 'student', role: 'teacher', exp: Date.now() + 60_000 }),
    ).toString('base64url');
    expect(verifySession(`${forged}.${body!.split('.')[1]}`, SECRET)).toBeNull();
  });
});

describe('auth routes', () => {
  beforeEach(async () => {
    const config = { ...loadConfig({ NODE_ENV: 'test', SYNC_SIGNING_SECRET: SECRET }), contentDir: process.cwd() };
    db = await createDatabase(config);
    await db.exec('DROP TABLE IF EXISTS users');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL,
        display_name TEXT NOT NULL, class_id TEXT,
        password_hash TEXT NOT NULL, created_at BIGINT NOT NULL
      );
    `);
    auth = new AuthService(db, SECRET);
    await auth.ensureDemoUsers();
    app = await boot();
  });

  async function login(username: string, password: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password },
    });
    expect(response.statusCode).toBe(200);
    return response.json().token as string;
  }

  it('seeds teacher and student accounts', async () => {
    expect((await auth.findByUsername('meera'))?.role).toBe('teacher');
    expect((await auth.findByUsername('aarav'))?.role).toBe('student');
    expect((await auth.findByUsername('aarav'))?.class_id).toBe('class-8-a');
  });

  it('is idempotent — a second boot does not duplicate users', async () => {
    const again = await auth.ensureDemoUsers();
    expect(again).toBe(0);
  });

  it('logs in a student and returns their profile', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'aarav', password: 'learn1234' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.role).toBe('student');
    expect(body.user.classId).toBe('class-8-a');
    expect(body.token).toBeTruthy();
    // The hash must never be returned.
    expect(JSON.stringify(body)).not.toContain('scrypt$');
  });

  it('logs in a teacher', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'meera', password: 'teach1234' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe('teacher');
  });

  it('rejects a wrong password with the same message as a wrong user', async () => {
    const badPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'aarav', password: 'nope' },
    });
    const badUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'nobody', password: 'nope' },
    });
    expect(badPassword.statusCode).toBe(401);
    expect(badUser.statusCode).toBe(401);
    // Identical bodies: no user enumeration.
    expect(badPassword.json()).toEqual(badUser.json());
  });

  it('validates the login payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('resolves /auth/me from a bearer token', async () => {
    const token = await login('aarav', 'learn1234');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe('aarav');
  });

  it('rejects /auth/me without a token or with a bad one', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer nonsense' },
    });
    expect(bad.statusCode).toBe(401);
  });

  describe('role enforcement (server-side)', () => {
    it('lets a teacher reach a teacher-only route', async () => {
      const token = await login('meera', 'teach1234');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/whoami-teacher',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe('teacher');
    });

    it('BLOCKS a student from the teacher route with 403', async () => {
      const token = await login('aarav', 'learn1234');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/whoami-teacher',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('forbidden');
    });

    it('BLOCKS an anonymous caller from the teacher route with 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/whoami-teacher',
      });
      expect(response.statusCode).toBe(401);
    });

    it('blocks a teacher from the student-only route', async () => {
      const token = await login('meera', 'teach1234');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/whoami-student',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it('cannot be tricked by forging a role into the token', async () => {
      // Even a correctly-signed token naming another user is rejected when
      // that user is not a teacher.
      const token = signSession(
        { userId: 'student-aarav', role: 'teacher', exp: Date.now() + 60_000 },
        SECRET,
      );
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/whoami-teacher',
        headers: { authorization: `Bearer ${token}` },
      });
      // Role comes from the DB row, not the token, so this is a 403.
      expect(response.statusCode).toBe(403);
    });
  });
});