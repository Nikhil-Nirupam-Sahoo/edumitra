/**
 * Authentication & roles.
 *
 * Design notes (this is a real credential path, so the choices matter):
 *  - Passwords are hashed with scrypt + a per-user random salt. Comparison is
 *    constant-time. Plaintext is never stored or logged.
 *  - Sessions are stateless: a signed token carrying userId, role and expiry,
 *    HMAC'd with the same server secret used for sync signing. No session
 *    table, so it survives restarts and needs no extra storage.
 *  - The server is the only authority on role. The client hides teacher
 *    screens for convenience, but every teacher route re-checks the token —
 *    a student token cannot reach the dashboard by editing the app.
 *
 * Offline note: the PWA caches the last session so a student keeps working
 * without a connection; the token is simply re-validated when back online.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DbPort } from '../db/index.js';
import type { Migration } from '../db/types.js';

export const ROLES = ['student', 'teacher'] as const;
export type Role = (typeof ROLES)[number];

export const userSchema = z.object({
  id: z.string().min(1).max(64),
  username: z.string().min(3).max(40),
  role: z.enum(ROLES),
  display_name: z.string().min(1).max(80),
  class_id: z.string().max(40).nullable(),
  password_hash: z.string().min(20),
});

export interface UserRecord {
  id: string;
  username: string;
  role: Role;
  display_name: string;
  class_id: string | null;
  password_hash: string;
  created_at: number;
}

export const loginSchema = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200),
});

/* -------------------------------------------------------------------------- */
/* Password hashing                                                            */
/* -------------------------------------------------------------------------- */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const saltHex = parts[1] as string;
  const hashHex = parts[2] as string;
  // Guard the parse: Buffer.from('zz','hex') yields an EMPTY buffer, and
  // timingSafeEqual on two empty buffers returns true — which would let ANY
  // password "verify" against a malformed hash. Require real, full-hex input.
  if (!/^[0-9a-f]{32}$/i.test(saltHex)) return false;
  if (!/^[0-9a-f]+$/i.test(hashHex) || hashHex.length !== SCRYPT_KEYLEN * 2) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize('NFKC'), salt, expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export interface SessionPayload {
  userId: string;
  role: Role;
  /** Expiry in ms since epoch. */
  exp: number;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** token = base64url(payload).base64url(hmac) */
export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (payload.role !== 'student' && payload.role !== 'teacher') return null;
    return payload;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export const usersMigration: Migration = {
  id: '0004_users',
  sql: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      class_id TEXT,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
  `,
};

/** Demo accounts so the app is usable immediately after deploy. */
export const DEMO_USERS: Array<Omit<UserRecord, 'created_at' | 'password_hash'> & { password: string }> = [
  { id: 'teacher-meera', username: 'meera', role: 'teacher', display_name: 'Meera Teacher', class_id: null, password: 'teach1234' },
  { id: 'teacher-rajesh', username: 'rajesh', role: 'teacher', display_name: 'Rajesh Sir', class_id: null, password: 'teach1234' },
  { id: 'student-aarav', username: 'aarav', role: 'student', display_name: 'Aarav', class_id: 'class-8-a', password: 'learn1234' },
  { id: 'student-priya', username: 'priya', role: 'student', display_name: 'Priya', class_id: 'class-8-a', password: 'learn1234' },
  { id: 'student-rohan', username: 'rohan', role: 'student', display_name: 'Rohan', class_id: 'class-9-a', password: 'learn1234' },
  { id: 'student-diasha', username: 'diasha', role: 'student', display_name: 'Diasha', class_id: 'class-9-a', password: 'learn1234' },
  { id: 'student-kabir', username: 'kabir', role: 'student', display_name: 'Kabir', class_id: 'class-10-a', password: 'learn1234' },
  { id: 'student-ananya', username: 'ananya', role: 'student', display_name: 'Ananya', class_id: 'class-10-a', password: 'learn1234' },
];

export class AuthService {
  constructor(
    private readonly db: DbPort,
    private readonly secret: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Creates any missing demo account. Existing accounts are left alone. */
  async ensureDemoUsers(): Promise<number> {
    let created = 0;
    for (const demo of DEMO_USERS) {
      const existing = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM users WHERE username = ?',
        [demo.username],
      );
      if (existing) continue;
      await this.db.execute(
        `INSERT INTO users (id, username, role, display_name, class_id, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          demo.id,
          demo.username,
          demo.role,
          demo.display_name,
          demo.class_id,
          hashPassword(demo.password),
          this.now(),
        ],
      );
      created += 1;
    }
    return created;
  }

  async findByUsername(username: string): Promise<UserRecord | undefined> {
    return this.db.queryOne<UserRecord>('SELECT * FROM users WHERE username = ?', [
      username.toLowerCase().trim(),
    ]);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    return this.db.queryOne<UserRecord>('SELECT * FROM users WHERE id = ?', [id]);
  }

  /** Returns a signed token on success, or null (never reveals which part failed). */
  async login(username: string, password: string): Promise<{ token: string; user: PublicUser } | null> {
    const user = await this.findByUsername(username);
    if (!user) {
      // Equalise timing so a missing user isn't distinguishable by response time.
      verifyPassword(password, hashPassword('placeholder'));
      return null;
    }
    if (!verifyPassword(password, user.password_hash)) return null;
    const token = signSession(
      { userId: user.id, role: user.role, exp: this.now() + SESSION_TTL_MS },
      this.secret,
    );
    return { token, user: toPublicUser(user) };
  }

  /** Resolves a bearer token to its session + user, or null. */
  async authenticate(token: string | undefined): Promise<{ session: SessionPayload; user: UserRecord } | null> {
    if (!token) return null;
    const session = verifySession(token, this.secret, this.now());
    if (!session) return null;
    const user = await this.findById(session.userId);
    if (!user) return null;
    return { session, user };
  }
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  displayName: string;
  classId: string | null;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    classId: user.class_id,
  };
}