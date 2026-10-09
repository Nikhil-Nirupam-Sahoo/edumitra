/**
 * Auth routes.
 *
 * Role enforcement lives HERE, on the server. The client hides teacher screens
 * for a tidy UI, but a student token is rejected by `requireRole` no matter
 * what the client does.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService, PublicUser, Role, UserRecord } from './auth.service.js';
import { loginSchema } from './auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { session: { userId: string; role: Role; exp: number }; user: UserRecord };
  }
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}

export interface AuthRouteOptions {
  auth: AuthService;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const { auth } = options;

  /** Attaches `request.auth` when a valid token is present. */
  app.addHook('onRequest', async (request) => {
    const resolved = await auth.authenticate(bearer(request));
    if (resolved) request.auth = resolved;
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const result = await auth.login(parsed.data.username, parsed.data.password);
    if (!result) {
      // One message for both wrong-user and wrong-password.
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return { token: result.token, user: result.user };
  });

  /** Current user, or 401. Used by the client to restore a cached session. */
  app.get('/auth/me', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthenticated' });
    return { user: toPublic(request.auth.user) };
  });

  app.post('/auth/logout', async (_request, reply) => {
    // Tokens are stateless; the client drops it. Endpoint exists so the client
    // has a single place to hook "session ended" later (e.g. denylist).
    return reply.code(204).send();
  });

  /** Teacher-only: proves the role gate works, and feeds the teacher dashboard. */
  app.get('/auth/whoami-teacher', async (request, reply) => {
    const guard = requireRole(request, reply, 'teacher');
    if (!guard) return;
    return { user: toPublic(request.auth!.user), role: 'teacher' };
  });

  /** Student-only, mainly to prove the gate rejects teachers. */
  app.get('/auth/whoami-student', async (request, reply) => {
    const guard = requireRole(request, reply, 'student');
    if (!guard) return;
    return { user: toPublic(request.auth!.user), role: 'student' };
  });
}

function toPublic(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    classId: user.class_id,
  };
}

/** Returns true when the request may proceed; otherwise it already replied. */
export function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  role: Role,
): boolean {
  if (!request.auth) {
    void reply.code(401).send({ error: 'unauthenticated' });
    return false;
  }
  if (request.auth.user.role !== role) {
    void reply.code(403).send({ error: 'forbidden', required: role });
    return false;
  }
  return true;
}