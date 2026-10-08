/**
 * Environment configuration with safe development defaults.
 *
 * In production the process refuses to boot without a real signing secret —
 * the shared HMAC secret is the only thing preventing arbitrary progress
 * injection, so a default value would be a vulnerability.
 */

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
  /** Postgres pool ceiling; low on purpose for small deployments. */
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

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
  };
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

  if (isProduction && value.SYNC_SIGNING_SECRET === DEFAULT_SECRET) {
    throw new Error(
      'SYNC_SIGNING_SECRET must be set to a strong random value in production ' +
        '(generate one with: openssl rand -hex 32)',
    );
  }
  if (isProduction && value.DB_DRIVER === 'dev') {
    console.warn(
      '[config] DB_DRIVER=dev stores data in a local SQLite file. ' +
        'Use DB_DRIVER=postgres for production deployments.',
    );
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    db: {
      driver: value.DB_DRIVER,
      dataDir: value.DATA_DIR,
      host: value.DB_HOST,
      port: value.DB_PORT,
      database: value.DB_NAME,
      user: value.DB_USER,
      password: value.DB_PASSWORD,
      poolSize: value.DB_POOL_SIZE,
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
  };
}
