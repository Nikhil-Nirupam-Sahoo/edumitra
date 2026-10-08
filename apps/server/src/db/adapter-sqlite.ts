/**
 * SQLite adapter (DB_DRIVER=dev).
 *
 * Backed by `node:sqlite` — Node's built-in SQLite binding — so local
 * development and CI need zero native compilation and zero external services.
 *
 * Concurrency model: node:sqlite is synchronous, so a promise-chain mutex
 * serializes transactions and prevents `BEGIN`/`COMMIT` interleaving when
 * several HTTP requests hit the sync endpoint at once.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  toNumber,
  type DbPort,
  type Migration,
} from './types.js';

function createTransactionMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function acquire<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export class SqliteAdapter implements DbPort {
  readonly driver = 'dev' as const;
  private readonly db: DatabaseSync;
  private readonly mutex = createTransactionMutex();
  /** Set while a transaction is active: nested calls reuse the connection. */
  private inTransaction = false;

  constructor(filename: string) {
    if (filename !== ':memory:') {
      mkdirSync(dirname(resolve(filename)), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const statement = this.db.prepare(sql);
    const rows = statement.all(...(params as never[]));
    return rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<number> {
    const statement = this.db.prepare(sql);
    const result = statement.run(...(params as never[]));
    return toNumber(result.changes);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
    // Nested transaction: reuse the outer one (SQLite has no savepoints here).
    if (this.inTransaction) return fn(this);
    return this.mutex(async () => {
      this.inTransaction = true;
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        const result = await fn(this);
        this.db.exec('COMMIT;');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Rollback of an already-aborted transaction is a no-op.
        }
        throw error;
      } finally {
        this.inTransaction = false;
      }
    });
  }

  async migrate(migrations: readonly Migration[]): Promise<string[]> {
    await this.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL);',
    );
    const applied: string[] = [];
    for (const migration of migrations) {
      const existing = await this.queryOne<{ id: string }>(
        'SELECT id FROM schema_migrations WHERE id = ?',
        [migration.id],
      );
      if (existing) continue;
      await this.transaction(async () => {
        await this.exec(migration.sql);
        await this.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
          migration.id,
          Date.now(),
        ]);
      });
      applied.push(migration.id);
    }
    return applied;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
