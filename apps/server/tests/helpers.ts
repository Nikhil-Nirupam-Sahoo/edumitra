/**
 * Test harness: builds a Fastify app backed by an in-memory SQLite database
 * and a test config. Each test file gets an isolated instance.
 */

import { buildApp, createJobHandler } from '../src/app.js';
import { loadConfig, type LoadedConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import type { DbPort } from '../src/db/types.js';
import { InProcessQueue } from '../src/sync/queue.js';
import { SyncService } from '../src/sync/sync.service.js';

export interface TestHarness {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: DbPort;
  syncService: SyncService;
  config: LoadedConfig;
  close(): Promise<void>;
}

export async function createHarness(
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<TestHarness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'dev',
    SYNC_SIGNING_SECRET: 'test-secret-at-least-16-chars',
    ...envOverrides,
  } as NodeJS.ProcessEnv);
  const db = await createDatabase(config);
  const syncService = new SyncService(db, config);
  const queue = new InProcessQueue(2);
  const app = await buildApp({ config, db, syncService, queue });
  await queue.start(createJobHandler({ syncService }));
  await app.ready();
  return {
    app,
    db,
    syncService,
    config,
    async close() {
      await app.close();
      await queue.stop();
      await db.close();
    },
  };
}
