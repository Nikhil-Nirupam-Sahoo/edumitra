/**
 * sync.controller.ts — HTTP boundary for the sync API.
 *
 * Responsibilities kept here (and nowhere else): raw-body capture for HMAC
 * verification, request validation, idempotency logging, and shaping the
 * response the client expects. Business logic lives in sync.service.ts.
 *
 * Routes (all under /api/v1):
 *   POST /sync/progress   bulk ingest + delta pull (HMAC-signed)
 *   GET  /sync/manifest   cheap "should I sync?" probe
 *   GET  /sync/cruft      purged-statement tombstones
 *   GET  /cmi5/state      merged CRDT state per student
 *   GET  /lrs/statements  xAPI LRS query
 *   POST /cmi5/state      explicit checkpoint merge (non-statement clients)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LoadedConfig } from '../config.js';
import { verifySignature } from '../lib/hmac.js';
import type { JobQueue } from './queue.js';
import {
  checkpointSchema,
  cruftQuerySchema,
  lrsQuerySchema,
  syncRequestSchema,
} from './schemas.js';
import type { SyncService } from './sync.service.js';

export interface SyncControllerDeps {
  syncService: SyncService;
  queue: JobQueue;
  config: LoadedConfig;
  /** Raw body capture plugin result attached by the route config. */
  getRawBody(request: FastifyRequest): string;
}

export async function registerSyncRoutes(
  app: FastifyInstance,
  deps: SyncControllerDeps,
): Promise<void> {
  const { syncService, queue, config } = deps;

  // ---------------------------------------------------------------------
  // POST /sync/progress — bulk ingest + delta pull
  // ---------------------------------------------------------------------
  app.post(
    '/sync/progress',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = deps.getRawBody(request);
      const deviceHeader = headerValue(request.headers['x-sync-device']);
      const verification = verifySignature({
        secret: config.sync.signingSecret,
        timestampHeader: headerValue(request.headers['x-sync-timestamp']),
        signatureHeader: headerValue(request.headers['x-sync-signature']),
        rawBody,
        maxSkewMs: config.sync.maxSkewMs,
      });
      if (!verification.ok) {
        request.log.warn({ reason: verification.reason }, 'rejected unsigned sync batch');
        return reply.code(401).send({ error: 'invalid_signature', reason: verification.reason });
      }

      const parsed = syncRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_payload',
          issues: parsed.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const deviceId = parsed.data.deviceId;
      if (deviceHeader && deviceHeader !== deviceId) {
        return reply.code(400).send({ error: 'device_mismatch' });
      }

      const result = await syncService.handleProgressSync(parsed.data, deviceId);

      // Side effects off the request path.
      void queue.enqueue({
        id: `post-ingest:${deviceId}:${result.serverTime}`,
        kind: 'post_ingest',
        deviceId,
        payload: {
          accepted: result.accepted,
          duplicates: result.duplicates,
          rejected: result.rejected,
          statementCount: parsed.data.statements.length,
        },
        createdAt: result.serverTime,
      });

      return reply.code(200).send(result);
    },
  );

  // ---------------------------------------------------------------------
  // GET /sync/manifest — cheap probe before a full delta sync
  // ---------------------------------------------------------------------
  app.get('/sync/manifest', async (request, reply) => {
    const deviceId = headerValue(request.headers['x-sync-device']) ?? 'anonymous';
    const manifest = await syncService.getManifest(deviceId);
    return reply.code(200).send(manifest);
  });

  // ---------------------------------------------------------------------
  // GET /sync/cruft — tombstones of server-purged statements
  // ---------------------------------------------------------------------
  app.get('/sync/cruft', async (request, reply) => {
    const parsed = cruftQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query' });
    }
    const { items, latest } = await syncService.lrs.listCruft(parsed.data.since, parsed.data.limit);
    return reply.code(200).send({ items, latest });
  });

  // ---------------------------------------------------------------------
  // GET /cmi5/state — merged progress state for a student
  // ---------------------------------------------------------------------
  app.get('/cmi5/state', async (request, reply) => {
    const query = request.query as { student?: string } | undefined;
    const studentId = query?.student;
    if (!studentId || studentId.length === 0 || studentId.length > 200) {
      return reply.code(400).send({ error: 'student_required' });
    }
    const state = await syncService.progress.getStateForStudent(studentId);
    return reply.code(200).send({ studentId, ...state });
  });

  // ---------------------------------------------------------------------
  // GET /lrs/statements — xAPI LRS query
  // ---------------------------------------------------------------------
  app.get('/lrs/statements', async (request, reply) => {
    const parsed = lrsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query' });
    }
    const rows = await syncService.lrs.queryStatements({
      studentId: parsed.data.student,
      lessonId: parsed.data.lesson,
      verb: parsed.data.verb,
      since: parsed.data.since,
      limit: parsed.data.limit,
    });
    return reply.code(200).send({
      statements: rows.map((row) => JSON.parse(row.statement_json) as unknown),
      count: rows.length,
    });
  });

  // ---------------------------------------------------------------------
  // POST /cmi5/state — explicit checkpoint merge (non-statement clients)
  // ---------------------------------------------------------------------
  app.post(
    '/cmi5/state',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const rawBody = deps.getRawBody(request);
      const verification = verifySignature({
        secret: config.sync.signingSecret,
        timestampHeader: headerValue(request.headers['x-sync-timestamp']),
        signatureHeader: headerValue(request.headers['x-sync-signature']),
        rawBody,
        maxSkewMs: config.sync.maxSkewMs,
      });
      if (!verification.ok) {
        return reply.code(401).send({ error: 'invalid_signature', reason: verification.reason });
      }
      const body = request.body as { checkpoints?: unknown } | undefined;
      const parsed = checkpointSchema.array().max(5_000).safeParse(body?.checkpoints ?? []);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload' });
      }
      const summary = await syncService.progress.applyCheckpoints(
        parsed.data.map((checkpoint) => ({
          studentId: checkpoint.studentId,
          lessonId: checkpoint.lessonId,
          key: checkpoint.key,
          value: checkpoint.value,
          ts: checkpoint.ts,
          op: checkpoint.op,
          sourceStatementId: checkpoint.sourceStatementId,
        })),
      );
      await syncService.progress.rebuildHeads(summary.touched);
      return reply.code(200).send({
        applied: summary.applied,
        duplicates: summary.duplicates,
        stale: summary.stale,
      });
    },
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
