/**
 * Real PostgreSQL coverage (embedded binaries — no system install, no root).
 *
 * Everything else in this suite runs on in-memory SQLite, which is exactly
 * how a Postgres-only bug ("transactions are not available on this
 * connection" on the root connection) slipped through to a production
 * crash-loop on Render. This file exercises the production boot path:
 * DATABASE_URL parsing, migrations (which need transactions on the root
 * connection), and a full signed sync batch over HTTP.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { PROGRESS_KEYS } from '../src/sync/crdt.js';
import { createHarness, type TestHarness } from './helpers.js';

const PG_PORT = 55433;
const SECRET = 'pg-test-secret-at-least-16-chars';
const DATABASE_URL = `postgres://postgres:password@127.0.0.1:${PG_PORT}/edumitra_test`;

let pg: EmbeddedPostgres;
let dataDir: string;
let harness: TestHarness | null = null;

/**
 * npm sometimes skips install scripts (interrupted installs, `npm warn
 * install-scripts`), leaving the bundled Postgres `.so` symlinks missing —
 * initdb then dies with "libpq.so.5: cannot open shared object file". The
 * platform package ships a hydrate script that restores them; run it (it is
 * idempotent) so a fresh clone or CI runner always works.
 */
function hydratePostgresSymlinks(): void {
  try {
    const require = createRequire(import.meta.url);
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const platform =
      process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux';
    const entry = require.resolve(`@embedded-postgres/${platform}-${arch}`);
    const pkgRoot = dirname(dirname(entry)); // <pkg>/dist/index.js → <pkg>
    execFileSync(process.execPath, [join(pkgRoot, 'scripts', 'hydrate-symlinks.js')], {
      cwd: pkgRoot,
      stdio: 'ignore',
    });
  } catch {
    // Best effort: if hydration already happened or the layout differs,
    // initdb below surfaces a clear error anyway.
  }
}

beforeAll(async () => {
  hydratePostgresSymlinks();
  dataDir = mkdtempSync(join(tmpdir(), 'edumitra-pg-'));
  pg = new EmbeddedPostgres({
    databaseDir: join(dataDir, 'db'),
    user: 'postgres',
    password: 'password',
    port: PG_PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('edumitra_test');
}, 180_000);

afterAll(async () => {
  await harness?.close();
  await pg?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}, 60_000);

const pgConfig = () =>
  loadConfig({
    NODE_ENV: 'test',
    SYNC_SIGNING_SECRET: SECRET,
    DATABASE_URL,
  } as NodeJS.ProcessEnv);

function envelope(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const timestamp = Date.now();
  const signature = createHmac('sha256', SECRET).update(`${timestamp}.${raw}`).digest('hex');
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-sync-timestamp': String(timestamp),
      'x-sync-signature': signature,
    },
  };
}

describe('PostgreSQL adapter (real server)', () => {
  it('boots from DATABASE_URL and applies migrations — the Render boot path', async () => {
    const config = pgConfig();
    expect(config.db.driver).toBe('postgres');
    expect(config.db.ssl).toBe(false); // no sslmode param → plaintext local TCP

    const db = await createDatabase(config);
    expect(db.driver).toBe('postgres');

    const migrations = await db.query<{ id: string }>(
      'SELECT id FROM schema_migrations ORDER BY id',
    );
    expect(migrations.length).toBeGreaterThan(0);
    await db.close();
  }, 30_000);

  it('supports transactions with rollback on the shared connection', async () => {
    const db = await createDatabase(pgConfig());
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(
          `INSERT INTO schema_migrations (id, applied_at) VALUES ('tx-rollback-smoke', 1)`,
        );
        throw new Error('rollback!');
      }),
    ).rejects.toThrow('rollback!');

    const rows = await db.query(
      `SELECT id FROM schema_migrations WHERE id = 'tx-rollback-smoke'`,
    );
    expect(rows).toHaveLength(0);
    await db.close();
  }, 30_000);

  it('accepts a signed sync batch and merges cmi5 state over HTTP', async () => {
    harness = await createHarness({
      DATABASE_URL,
      SYNC_SIGNING_SECRET: SECRET,
    });
    expect(harness.db.driver).toBe('postgres');

    const batch = envelope({
      deviceId: 'pg-device-1',
      statements: [
        {
          id: 'pg-s1',
          actor: {
            objectType: 'Agent',
            account: { homePage: 'https://edumitra.org', name: 'pg-student' },
          },
          verb: {
            id: 'http://adlnet.gov/expapi/verbs/completed',
            display: { 'en-US': 'completed' },
          },
          object: {
            objectType: 'Activity',
            id: 'https://edumitra.org/activities/lesson/pg-lesson-1',
          },
          timestamp: new Date().toISOString(),
        },
      ],
      checkpoints: [
        {
          id: 'pg-c1',
          studentId: 'pg-student',
          lessonId: 'pg-lesson-1',
          key: PROGRESS_KEYS.completionStatus,
          value: 2,
          ts: 10_000,
          op: 'put',
          sourceStatementId: 'pg-s1',
        },
      ],
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/sync/progress',
      payload: batch.raw,
      headers: batch.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(1);

    const state = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/cmi5/state?student=pg-student',
    });
    expect(state.statusCode).toBe(200);
    const head = state.json().heads[0];
    expect(head.lessonId).toBe('pg-lesson-1');
    expect(head.completionStatus).toBe('completed');
  }, 30_000);
});
