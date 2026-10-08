/**
 * Server entrypoint: config → database → services → queue → HTTP.
 *
 * Graceful shutdown: stop accepting connections, drain the job queue, close
 * the database. Retention runs on a daily interval.
 */

import { buildApp, createJobHandler } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { createJobQueue } from './sync/queue.js';
import { SyncService } from './sync/sync.service.js';

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await createDatabase(config);
  const syncService = new SyncService(db, config);
  const queue = await createJobQueue(config);
  const app = await buildApp({ config, db, syncService, queue });

  await queue.start(
    createJobHandler({
      syncService,
      lrsPostUrl: process.env.LRS_POST_URL,
      lrsApiKey: process.env.LRS_API_KEY,
    }),
  );

  const retentionTimer = setInterval(() => {
    void queue
      .enqueue({
        id: `retention:${Date.now()}`,
        kind: 'retention',
        deviceId: 'system',
        payload: {},
        createdAt: Date.now(),
      })
      .catch((error) => app.log.warn(error, 'failed to enqueue retention job'));
  }, RETENTION_INTERVAL_MS);
  retentionTimer.unref();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(retentionTimer);
    await app.close();
    await queue.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { driver: db.driver, queue: queue.kind, port: config.port },
    'EduMitra sync API ready',
  );
}

main().catch((error) => {
  console.error('Fatal startup error', error);
  process.exit(1);
});
