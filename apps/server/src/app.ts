/**
 * Fastify application factory.
 *
 * The critical piece here is the JSON content-type parser: the sync protocol
 * signs the *decompressed* JSON body, so we capture the raw string after
 * gunzip/inflate/brotli and expose it on the request for HMAC verification.
 * (Fastify does not decompress request bodies by itself.)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { LoadedConfig } from './config.js';
import type { DbPort } from './db/index.js';
import { registerSyncRoutes } from './sync/sync.controller.js';
import { registerTranslateRoutes } from './translate/translate.controller.js';
import { registerContentRoutes } from './content/content.controller.js';
import type { JobQueue, SyncJob } from './sync/queue.js';
import type { SyncService } from './sync/sync.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Decompressed raw body, used for HMAC verification. */
    rawBody?: string;
  }
}

export interface BuildAppOptions {
  config: LoadedConfig;
  db: DbPort;
  syncService: SyncService;
  queue: JobQueue;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, syncService, queue } = options;

  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.logLevel,
        },
    bodyLimit: 5 * 1024 * 1024, // 5 MB — generous for a 200-statement gzip batch
    trustProxy: true,
  });

  registerRawBodyParser(app);

  await app.register(cors, {
    origin: config.corsOrigins === '*' ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Content-Encoding',
      'x-sync-device',
      'x-sync-timestamp',
      'x-sync-signature',
    ],
    maxAge: 86_400,
  });

  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    allowList: [],
  });

  // ---------------------------------------------------------------------
  // Health & readiness
  // ---------------------------------------------------------------------
  app.get('/api/v1/health', async () => {
    const [statementCount, progressRevision] = await Promise.all([
      syncService.lrs.countStatements(),
      syncService.progress.progressRevision(),
    ]);
    return {
      status: 'ok',
      driver: options.db.driver,
      statementCount,
      progressRevision,
      queue: queue.kind,
      queueStats: queue.stats(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  // ---------------------------------------------------------------------
  // Sync API
  // ---------------------------------------------------------------------
  await app.register(
    async (instance) => {
      await registerSyncRoutes(instance, {
        syncService,
        queue,
        config,
        getRawBody: (request) => request.rawBody ?? '',
      });
    },
    { prefix: '/api/v1' },
  );

  // ---------------------------------------------------------------------
  // Live translation proxy (server-side Google key; see translate.controller)
  // ---------------------------------------------------------------------
  await app.register(
    async (instance) => {
      await registerTranslateRoutes(instance, { config });
    },
    { prefix: '/api/v1' },
  );

  // ---------------------------------------------------------------------
  // Downloadable syllabus content (data, not part of the client bundle)
  // ---------------------------------------------------------------------
  await app.register(
    async (instance) => {
      await registerContentRoutes(instance, { config });
    },
    { prefix: '/api/v1' },
  );

  // ---------------------------------------------------------------------
  // Static PWA — served from the same origin as the API so the client's
  // relative VITE_API_BASE (/api/v1) works in production with no CORS and
  // one deployment instead of two. In dev the PWA is served by Vite, so the
  // dist directory simply won't exist and this block is skipped.
  // ---------------------------------------------------------------------
  const serveStatic = existsSync(join(config.clientDist, 'index.html'));
  if (serveStatic) {
    await app.register(fastifyStatic, {
      root: config.clientDist,
      // We own Cache-Control entirely (the plugin default would override
      // whatever setHeaders writes).
      cacheControl: false,
      setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('sw.js')) {
          res.setHeader('cache-control', 'no-cache');
        } else if (path.includes('/assets/')) {
          // Vite content-hashed files — safe to cache forever.
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('cache-control', 'public, max-age=86400');
        }
      },
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    // Unknown API paths stay JSON 404s; everything else gets the SPA shell
    // (the router is hash-based, so any path can render index.html).
    if (serveStatic && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.code(200).type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  app.setErrorHandler(async (error: Error & { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error(error);
    }
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : error.name,
      message: statusCode >= 500 ? 'Internal server error' : error.message,
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Raw body + decompression parser
// ---------------------------------------------------------------------------

function registerRawBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request: FastifyRequest, body: Buffer, done) => {
      try {
        const encoding = String(request.headers['content-encoding'] ?? 'identity').toLowerCase();
        let decoded: Buffer;
        switch (encoding) {
          case 'gzip':
          case 'x-gzip':
            decoded = gunzipSync(body);
            break;
          case 'deflate':
            decoded = inflateSync(body);
            break;
          case 'br':
            decoded = brotliDecompressSync(body);
            break;
          case 'identity':
          case '':
            decoded = body;
            break;
          default: {
            const error = new Error(`unsupported content-encoding: ${encoding}`);
            (error as { statusCode?: number }).statusCode = 415;
            done(error);
            return;
          }
        }
        const raw = decoded.toString('utf8');
        request.rawBody = raw;
        done(null, JSON.parse(raw));
      } catch (error) {
        const parseError = new Error('invalid JSON body');
        (parseError as { statusCode?: number }).statusCode = 400;
        (parseError as { cause?: unknown }).cause = error;
        done(parseError as Error & { statusCode?: number });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Queue job handler
// ---------------------------------------------------------------------------

export interface JobHandlerDeps {
  syncService: SyncService;
  /** Optional external LRS URL to mirror statements into. */
  lrsPostUrl?: string;
  lrsApiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Handles background jobs:
 *  - post_ingest: structured metrics logging (durable counters already written
 *    by LrsService.recordBatch) + optional external LRS mirroring.
 *  - retention: purges expired statements and writes tombstones.
 */
export function createJobHandler(deps: JobHandlerDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async function handleJob(job: SyncJob): Promise<void> {
    switch (job.kind) {
      case 'post_ingest': {
        const payload = job.payload;
        const summary = `device=${job.deviceId} accepted=${String(payload.accepted)} ` +
          `dupes=${String(payload.duplicates)} rejected=${String(payload.rejected)}`;
        if (Number(payload.duplicates) > 50) {
          console.warn(`[sync] high duplicate ratio — possible client retry storm (${summary})`);
        } else {
          console.info(`[sync] ingest complete (${summary})`);
        }
        if (deps.lrsPostUrl) {
          await forwardToExternalLrs(
            deps.lrsPostUrl,
            deps.lrsApiKey,
            fetchImpl,
            payload,
          );
        }
        return;
      }
      case 'retention': {
        const purged = await deps.syncService.runRetention();
        if (purged > 0) console.info(`[retention] purged ${purged} expired statements`);
        return;
      }
      case 'forward_lrs': {
        if (deps.lrsPostUrl) {
          await forwardToExternalLrs(deps.lrsPostUrl, deps.lrsApiKey, fetchImpl, job.payload);
        }
        return;
      }
    }
  };
}

async function forwardToExternalLrs(
  url: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const statements = Array.isArray(payload.statements) ? payload.statements : [];
    if (statements.length === 0) return;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Experience-API-Version': '1.0.3',
    };
    if (apiKey) headers.Authorization = `Basic ${apiKey}`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(statements),
    });
    if (!response.ok) {
      console.warn(`[lrs] external forward failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn('[lrs] external forward error', error);
  }
}
