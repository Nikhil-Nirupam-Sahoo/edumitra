/**
 * Environment configuration with safe development defaults.
 *
 * In production the process refuses to boot without a real signing secret —
 * the shared HMAC secret is the only thing preventing arbitrary progress
 * injection, so a default value would be a vulnerability.
 */

import { resolve } from 'node:path';
import { z } from 'zod';

const DEFAULT_SECRET = 'dev-only-insecure-shared-secret';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4600),
  HOST: z.string().default('0.0.0.0'),

  DB_DRIVER: z.enum(['dev', 'postgres']).default('dev'),
  DATA_DIR: z.string().default('./data'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('edumitra'),
  DB_USER: z.string().default('edumitra'),
  DB_PASSWORD: z.string().default(''),
  /**
   * Full connection string (Render/Neon/Railway inject this). When present it
   * overrides DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD and forces the
   * postgres driver. `sslmode=require` (the PaaS default) enables TLS.
   */
  DATABASE_URL: z.string().optional(),
  /** Postgres pool ceiling; low on purpose for small deployments. */
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

  /** Directory of the built PWA (index.html) served by the API process. */
  CLIENT_DIST: z.string().optional(),

  SYNC_SIGNING_SECRET: z.string().min(16).default(DEFAULT_SECRET),
  SYNC_SIGNATURE_MAX_SKEW_MS: z.coerce.number().int().positive().default(300_000),
  SYNC_JOB_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),
  /** Server-side LRS retention; statements older than this may be purged. */
  SYNC_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** Max statements accepted in one POST batch (DoS guard). */
  SYNC_MAX_BATCH: z.coerce.number().int().positive().max(5_000).default(1_000),
  /** Optional Redis connection for the sync job queue. */
  REDIS_URL: z.string().optional(),
  /** Comma-separated allowed CORS origins; "*" allows all (dev only). */
  CORS_ORIGINS: z.string().default('*'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export interface LoadedConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  db: {
    driver: 'dev' | 'postgres';
    dataDir: string;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    poolSize: number;
    /** TLS to the database (DATABASE_URL with sslmode=require, the PaaS default). */
    ssl: boolean;
  };
  /** Directory containing the built PWA to serve at "/". */
  clientDist: string;
  sync: {
    signingSecret: string;
    maxSkewMs: number;
    jobConcurrency: number;
    retentionDays: number;
    maxBatch: number;
  };
  redisUrl: string | null;
  corsOrigins: string[] | '*';
  logLevel: string;
  isProduction: boolean;
  isTest: boolean;
}

/**
 * Parses a PaaS-provided connection string
 * (`postgres://user:pass@host:5432/dbname?sslmode=require`).
 */
function parseDatabaseUrl(raw: string): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be a postgres:// or postgresql:// URL');
  }
  return {
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'edumitra',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    // PaaS URLs default to TLS; only an explicit sslmode=disable opts out.
    ssl: url.searchParams.get('sslmode') !== 'disable',
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';

  // DATABASE_URL (Render/Neon/Railway) wins over individual DB_* fields.
  const fromUrl = value.DATABASE_URL ? parseDatabaseUrl(value.DATABASE_URL) : null;
  const driver: 'dev' | 'postgres' = fromUrl ? 'postgres' : value.DB_DRIVER;

  if (isProduction && value.SYNC_SIGNING_SECRET === DEFAULT_SECRET) {
    throw new Error(
      'SYNC_SIGNING_SECRET must be set to a strong random value in production ' +
        '(generate one with: openssl rand -hex 32)',
    );
  }
  if (isProduction && driver === 'dev') {
    console.warn(
      '[config] DB_DRIVER=dev stores data in a local SQLite file. ' +
        'Use DB_DRIVER=postgres (or DATABASE_URL) for production deployments.',
    );
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    db: {
      driver,
      dataDir: value.DATA_DIR,
      host: fromUrl?.host ?? value.DB_HOST,
      port: fromUrl?.port ?? value.DB_PORT,
      database: fromUrl?.database ?? value.DB_NAME,
      user: fromUrl?.user ?? value.DB_USER,
      password: fromUrl?.password ?? value.DB_PASSWORD,
      poolSize: value.DB_POOL_SIZE,
      ssl: fromUrl?.ssl ?? false,
    },
    sync: {
      signingSecret: value.SYNC_SIGNING_SECRET,
      maxSkewMs: value.SYNC_SIGNATURE_MAX_SKEW_MS,
      jobConcurrency: value.SYNC_JOB_CONCURRENCY,
      retentionDays: value.SYNC_RETENTION_DAYS,
      maxBatch: value.SYNC_MAX_BATCH,
    },
    redisUrl: value.REDIS_URL && value.REDIS_URL.length > 0 ? value.REDIS_URL : null,
    corsOrigins:
      value.CORS_ORIGINS.trim() === '*'
        ? '*'
        : value.CORS_ORIGINS.split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0),
    logLevel: value.LOG_LEVEL,
    isProduction,
    isTest: value.NODE_ENV === 'test',
    // Built PWA location: overridable, defaults to the repo's client build
    // (works from both src/ and dist/ — apps/server/{src,dist}/../../client).
    clientDist: value.CLIENT_DIST && value.CLIENT_DIST.length > 0
      ? value.CLIENT_DIST
      : resolve(import.meta.dirname, '../../client/dist'),
  };
}
