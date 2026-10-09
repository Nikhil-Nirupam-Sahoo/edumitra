/**
 * Auth routes.
 *
 * Role enforcement lives HERE, on the server. The client hides teacher screens
 * for a tidy UI, but a student token is rejected by `requireRole` no matter
 * what the client does.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService, PublicUser, Role, UserRecord } from './auth.service.js';
import {
  loginSchema,
  profileSchema,
  registerSchema,
} from './auth.service.js';

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
  /** Google Sign-In client id; null hides the Google button. */
  googleClientId?: string | null;
  /** Allow self-registration to create teacher accounts. */
  allowTeacherSignup?: boolean;
}

/**
 * Instances that already carry the authentication hook.
 *
 * Fastify encapsulates hooks per plugin scope: a hook added inside one
 * `app.register()` does NOT run for sibling scopes. Since the role gate is
 * applied by several independent route modules, the hook has to live on the
 * root instance — otherwise those routes see no `request.auth` and reject
 * every request as unauthenticated. Registering it twice would double the
 * token verification work, so it is tracked here.
 */
const hookedInstances = new WeakSet<FastifyInstance>();

/** Attaches `request.auth` for every route under `app` and its children. */
export function registerAuthHook(app: FastifyInstance, auth: AuthService): void {
  if (hookedInstances.has(app)) return;
  hookedInstances.add(app);
  app.addHook('onRequest', async (request) => {
    const resolved = await auth.authenticate(bearer(request));
    if (resolved) request.auth = resolved;
  });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const { auth } = options;

  registerAuthHook(app, auth);

  /**
   * Which sign-in methods this deployment actually offers. The client renders
   * the Google button only when a client id is configured, so an unconfigured
   * deployment never shows a button that cannot work.
   */
  app.get('/auth/providers', async () => ({
    password: true,
    google: options.googleClientId ?? null,
    allowTeacherSignup: options.allowTeacherSignup === true,
  }));

  /**
   * Self-registration. Teacher accounts are refused unless the deployment opts
   * in, because a teacher decides what a class can see.
   */
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const result = await auth.register(parsed.data, {
      allowTeacherAccounts: options.allowTeacherSignup === true,
    });
    if (!result.ok) {
      return reply
        .code(result.reason === 'username_taken' ? 409 : 403)
        .send({ error: result.reason });
    }
    return { token: result.token, user: result.user };
  });

  /**
   * Google sign-in. The browser sends the ID token Google gave it; the server
   * is what verifies it, so a forged token never becomes a session.
   */
  app.post('/auth/google', async (request, reply) => {
    const clientId = options.googleClientId;
    if (!clientId) return reply.code(503).send({ error: 'google_disabled' });

    const parsed = z
      .object({ idToken: z.string().min(20).max(4000) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const profile = await auth.verifyGoogleIdToken(parsed.data.idToken, clientId);
    if (!profile.ok) {
      return reply.code(401).send({ error: profile.reason });
    }

    const result = await auth.findOrCreateGoogleUser(profile);
    return { token: result.token, user: result.user, created: result.created };
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

  /**
   * Updates the caller's own profile (name, class, board, school,
   * avatar, font size). The token is the authority — a user can only
   * ever patch their own record, never another's.
   */
  app.patch('/auth/profile', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthenticated' });

    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    const updated = await auth.updateProfile(request.auth.user.id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { user: updated };
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
    boardId: user.board_id,
    schoolId: user.school_id,
    avatarUrl: user.avatar_url,
    fontSize: user.font_size,
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