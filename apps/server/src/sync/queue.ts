/**
 * Sync job queue.
 *
 * Post-ingest side effects (metrics rollups, retention purge, optional LRS
 * forwarding) must never block the HTTP response, and must survive bursty
 * connectivity. Two backends:
 *
 *  - InProcessQueue (default): bounded FIFO with concurrency, zero deps.
 *  - RedisQueue (REDIS_URL set): same interface over a Redis list, so several
 *    API instances share one work queue. `ioredis` is an optional dependency;
 *    if it is missing we log once and fall back to in-process.
 */

import type { LoadedConfig } from '../config.js';

export interface SyncJob {
  id: string;
  kind: 'post_ingest' | 'retention' | 'forward_lrs';
  deviceId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface JobQueue {
  readonly kind: 'in-process' | 'redis';
  enqueue(job: SyncJob): Promise<void>;
  /** Starts consumers. Idempotent. */
  start(handler: (job: SyncJob) => Promise<void>): Promise<void>;
  /** Stops consumers and waits for in-flight jobs (bounded). */
  stop(): Promise<void>;
  stats(): { queued: number; processed: number; failed: number };
}

// ---------------------------------------------------------------------------
// In-process queue
// ---------------------------------------------------------------------------

export class InProcessQueue implements JobQueue {
  readonly kind = 'in-process' as const;
  private readonly pending: SyncJob[] = [];
  private active = 0;
  private processed = 0;
  private failed = 0;
  private handler: ((job: SyncJob) => Promise<void>) | null = null;
  private draining = false;
  private stopped = false;
  private readonly maxDepth: number;

  constructor(private readonly concurrency: number, maxDepth = 10_000) {
    this.maxDepth = maxDepth;
  }

  async enqueue(job: SyncJob): Promise<void> {
    if (this.stopped) return;
    // Backpressure: drop oldest overflow instead of unbounded growth (the
    // retention job is periodic, sync payloads are already persisted).
    if (this.pending.length >= this.maxDepth) {
      this.pending.shift();
      this.failed += 1;
    }
    this.pending.push(job);
    void this.drain();
  }

  async start(handler: (job: SyncJob) => Promise<void>): Promise<void> {
    this.handler = handler;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped || !this.handler) return;
    this.draining = true;
    try {
      while (this.pending.length > 0 && this.active < this.concurrency && !this.stopped) {
        const job = this.pending.shift()!;
        this.active += 1;
        void this.handler(job)
          .then(() => {
            this.processed += 1;
          })
          .catch((error) => {
            this.failed += 1;
            console.error(`[queue] job ${job.kind} failed`, error);
          })
          .finally(() => {
            this.active -= 1;
            void this.drain();
          });
      }
    } finally {
      this.draining = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const deadline = Date.now() + 5_000;
    while (this.active > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  stats() {
    return { queued: this.pending.length, processed: this.processed, failed: this.failed };
  }
}

// ---------------------------------------------------------------------------
// Redis queue (optional)
// ---------------------------------------------------------------------------

const REDIS_LIST_KEY = 'edumitra:sync:jobs';

export class RedisQueue implements JobQueue {
  readonly kind = 'redis' as const;
  private stopped = false;
  private polling = false;
  private processed = 0;
  private failed = 0;
  private handler: ((job: SyncJob) => Promise<void>) | null = null;

  // Loose typing keeps ioredis optional at build time.
  constructor(
    private readonly client: {
      lpush(key: string, value: string): Promise<number>;
      brpop(key: string, timeout: number): Promise<[string, string] | null>;
      llen(key: string): Promise<number>;
      quit(): Promise<unknown>;
    },
    private readonly concurrency: number,
  ) {}

  async enqueue(job: SyncJob): Promise<void> {
    if (this.stopped) return;
    await this.client.lpush(REDIS_LIST_KEY, JSON.stringify(job));
  }

  async start(handler: (job: SyncJob) => Promise<void>): Promise<void> {
    this.handler = handler;
    for (let worker = 0; worker < this.concurrency; worker++) {
      void this.loop();
    }
  }

  private async loop(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    while (!this.stopped && this.handler) {
      try {
        const item = await this.client.brpop(REDIS_LIST_KEY, 2);
        if (!item) continue;
        const [, raw] = item;
        const job = JSON.parse(raw) as SyncJob;
        try {
          await this.handler(job);
          this.processed += 1;
        } catch (error) {
          this.failed += 1;
          console.error(`[queue] redis job ${job.kind} failed`, error);
        }
      } catch (error) {
        if (this.stopped) break;
        console.warn('[queue] redis poll error; retrying in 1s', error);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    this.polling = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.client.quit().catch(() => undefined);
  }

  stats() {
    // Depth is fetched synchronously elsewhere; report local counters here.
    return { queued: 0, processed: this.processed, failed: this.failed };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createJobQueue(config: LoadedConfig): Promise<JobQueue> {
  if (config.redisUrl) {
    try {
      const module = await import('ioredis');
      // ioredis ships CJS; under NodeNext the default export may be the
      // namespace itself — accept either shape.
      const RedisCtor = (module.default ?? module) as unknown as new (
        url: string,
        options?: Record<string, unknown>,
      ) => unknown;
      const client = new RedisCtor(config.redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      });
      console.info('[queue] using Redis sync job queue');
      return new RedisQueue(
        client as ConstructorParameters<typeof RedisQueue>[0],
        config.sync.jobConcurrency,
      );
    } catch (error) {
      console.warn('[queue] ioredis unavailable, falling back to in-process queue', error);
    }
  }
  return new InProcessQueue(config.sync.jobConcurrency);
}
