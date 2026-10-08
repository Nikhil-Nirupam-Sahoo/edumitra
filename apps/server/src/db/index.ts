/**
 * Database factory. Creates the adapter for the configured driver and applies
 * migrations before the HTTP server starts listening.
 */

import { join } from 'node:path';
import type { LoadedConfig } from '../config.js';
import { PostgresAdapter } from './adapter-postgres.js';
import { MIGRATIONS } from './migrations.js';
import type { DbPort } from './types.js';

export type { DbPort } from './types.js';

export async function createDatabase(config: LoadedConfig): Promise<DbPort> {
  let db: DbPort;
  if (config.db.driver === 'postgres') {
    db = new PostgresAdapter({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      poolSize: config.db.poolSize,
      ssl: config.db.ssl,
    });
  } else {
    // Dynamic import: keeps node:sqlite (experimental, warns on load) out of
    // the Postgres-only production boot path.
    const { SqliteAdapter } = await import('./adapter-sqlite.js');
    // Tests use a fresh in-memory database; dev persists under DATA_DIR.
    const filename = config.isTest
      ? ':memory:'
      : join(config.db.dataDir, 'edumitra.sqlite');
    db = new SqliteAdapter(filename);
  }
  await db.migrate(MIGRATIONS);
  return db;
}

export { MIGRATIONS } from './migrations.js';
