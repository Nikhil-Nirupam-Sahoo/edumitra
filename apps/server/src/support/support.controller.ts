/**
 * Support: mentor requests + an AI tutor proxy.
 *
 * The AI key lives HERE, never in the browser — a key shipped to the client is
 * readable by every visitor and would be abused against the account's billing.
 * The browser calls /api/v1/support/ask and this server proxies to Anthropic.
 * When no key is configured the endpoint reports `enabled: false` and the UI
 * says so, instead of pretending a bot exists.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { toNumber } from '../db/types.js';
import { z } from 'zod';
import type { LoadedConfig } from '../config.js';
import type { DbPort } from '../db/index.js';
import { requireRole } from '../auth/auth.controller.js';

const askSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .default([]),
  grade: z.number().int().min(1).max(12).optional(),
  className: z.string().max(40).optional(),
});

const requestSchema = z.object({
  subject: z.string().min(2).max(120),
  body: z.string().min(1).max(2000),
});

const resolveSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.enum(['open', 'answered']).default('answered'),
});

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** The tutor is grounded in the student's level and told to stay on-syllabus. */
function systemPrompt(grade?: number, className?: string): string {
  const level = grade ? `Class ${grade}` : 'secondary school';
  return [
    `You are a patient tutor inside EduMitra, helping ${level} students in an Indian school (CBSE-aligned syllabus).`,
    className ? `The student's class is ${className}.` : '',
    'Rules:',
    '- Keep answers short (under 150 words) and pitched to the student\'s level.',
    '- Explain the idea with one concrete example, then ask one checking question.',
    '- Never do the whole exercise for them; nudge them to the next step.',
    '- If asked for something outside the syllabus, say so and point back to the topic.',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface SupportRouteOptions {
  config: LoadedConfig;
  db: DbPort;
  /**
   * Overrides ANTHROPIC_API_KEY from the environment. Injected by tests so the
   * upstream call can be exercised without a real key.
   */
  apiKey?: string | null;
}

export async function registerSupportRoutes(
  app: FastifyInstance,
  options: SupportRouteOptions,
): Promise<void> {
  const { db } = options;
  const apiKey =
    options.apiKey !== undefined ? options.apiKey : (process.env.ANTHROPIC_API_KEY ?? null);

  app.get('/support/status', async () => ({
    aiEnabled: apiKey !== null,
  }));

  // ---- Mentors ----------------------------------------------------------
  // Read from the users table rather than a hard-coded list, so adding a
  // teacher account is all it takes to make them contactable.
  app.get('/support/mentors', async () => {
    const rows = await db.query<Mentor>(
      "SELECT id, display_name, class_id FROM users WHERE role = 'teacher' ORDER BY display_name",
    );
    return { mentors: rows };
  });

  // ---- AI tutor ----------------------------------------------------------
  // Tighter bucket than the global limiter: each call costs real money.
  app.post(
    '/support/ask',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!apiKey) {
        return reply.code(503).send({ error: 'ai_unavailable' });
      }
    const parsed = askSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const { message, history, grade, className } = parsed.data;
    try {
      const response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
          max_tokens: 400,
          system: systemPrompt(grade, className),
          messages: [
            ...history,
            { role: 'user', content: message },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        request.log.warn({ status: response.status }, 'anthropic upstream failed');
        return reply.code(502).send({ error: 'upstream_error' });
      }
      const payload = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = (payload.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
        .trim();
      if (!text) return reply.code(502).send({ error: 'empty_response' });
      return { answer: text };
    } catch (error) {
      request.log.warn({ err: error }, 'support ask failed');
      return reply.code(502).send({ error: 'upstream_error' });
    }
    },
  );

  // ---- Mentor requests ---------------------------------------------------
  // Postgres returns BIGINT as a string (it can exceed Number.MAX_SAFE_INTEGER
  // in principle), SQLite as a number or bigint. Normalising here means the
  // client always gets a millisecond number and never has to guess.
  app.post('/support/mentor-request', async (request, reply) => {
    // Anyone signed in can ask a mentor; anonymous spam is not worth storing.
    if (!request.auth) return reply.code(401).send({ error: 'unauthenticated' });
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const student = request.auth.user;
    const id = randomUUID();
    await db.execute(
      `INSERT INTO support_requests (id, student_id, student_name, subject, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      [
        id,
        student.id,
        student.display_name,
        parsed.data.subject,
        parsed.data.body,
        Date.now(),
      ],
    );
    return reply.code(201).send({ ok: true, id });
  });

  app.get('/support/mentor-requests', async (request, reply) => {
    if (!requireRole(request, reply, 'teacher')) return;
    const rows = await db.query<MentorRequest>(
      'SELECT id, student_name, subject, body, status, created_at FROM support_requests ORDER BY created_at DESC LIMIT 50',
    );
    return { requests: rows.map(withNumericCreatedAt) };
  });

  // Teacher closes the loop: mark a question answered so it leaves the inbox.
  app.post('/support/mentor-request/resolve', async (request, reply) => {
    if (!requireRole(request, reply, 'teacher')) return;
    const parsed = resolveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const updated = await db.execute(
      'UPDATE support_requests SET status = ? WHERE id = ?',
      [parsed.data.status, parsed.data.id],
    );
    if (updated === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // A student sees their own thread — only ever their own.
  app.get('/support/my-requests', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthenticated' });
    const rows = await db.query<MentorRequest>(
      'SELECT id, student_name, subject, body, status, created_at FROM support_requests WHERE student_id = ? ORDER BY created_at DESC LIMIT 20',
      [request.auth.user.id],
    );
    return { requests: rows.map(withNumericCreatedAt) };
  });
}

export interface MentorRequest {
  id: string;
  student_name: string;
  subject: string;
  body: string;
  status: string;
  created_at: number;
}

/** Coerces the driver's BIGINT representation to a plain millisecond number. */
function withNumericCreatedAt(row: MentorRequest): MentorRequest {
  return { ...row, created_at: toNumber(row.created_at) };
}

export interface Mentor {
  id: string;
  display_name: string;
  class_id: string | null;
}