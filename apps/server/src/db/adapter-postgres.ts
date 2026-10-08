/**
 * PostgreSQL adapter (DB_DRIVER=postgres) — production primary store.
 *
 * Uses a bounded `pg` pool; transactions check out a dedicated client so
 * BEGIN/COMMIT can never leak onto another request.
 */

import { Pool, type PoolClient } from 'pg';
import {
  toNumber,
  toPostgresPlaceholders,
  type DbPort,
  type Migration,
} from './types.js';

class PostgresConnection implements DbPort {
  readonly driver = 'postgres' as const;

  constructor(
    private readonly executor: {
      query: (sql: string, params: readonly unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
    },
    private readonly transactionRunner?: <T>(fn: (tx: DbPort) => Promise<T>) => Promise<T>,
  ) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.executor.query(toPostgresPlaceholders(sql), params);
    return result.rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<number> {
    const result = await this.executor.query(toPostgresPlaceholders(sql), params);
    return result.rowCount ?? 0;
  }

  async exec(sql: string): Promise<void> {
    await this.executor.query(sql, []);
  }

  async transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
    if (this.transactionRunner) return this.transactionRunner(fn);
    throw new Error('transactions are not available on this connection');
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
    // Pool lifetime is owned by PostgresAdapter.
  }
}

export class PostgresAdapter implements DbPort {
  readonly driver = 'postgres' as const;
  private readonly pool: Pool;
  private readonly root: PostgresConnection;

  constructor(options: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    poolSize: number;
    /** TLS (DATABASE_URL sslmode=require). `rejectUnauthorized: false` matches
     *  PaaS proxies (Render/Neon) whose certs chain to a private CA. */
    ssl?: boolean;
  }) {
    this.pool = new Pool({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      max: options.poolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    this.root = new PostgresConnection({
      query: async (sql, params) => {
        const result = await this.pool.query(sql, params as never[]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    });
  }

  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return this.root.query<T>(sql, params);
  }

  queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | undefined> {
    return this.root.queryOne<T>(sql, params);
  }

  execute(sql: string, params?: readonly unknown[]): Promise<number> {
    return this.root.execute(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.root.exec(sql);
  }

  async transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    const connection = new PostgresConnection({
      query: async (sql, params) => {
        const result = await client.query(sql, params as never[]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    });
    try {
      await client.query('BEGIN');
      const result = await fn(connection);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Connection may be broken; release below handles it.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  migrate(migrations: readonly Migration[]): Promise<string[]> {
    return this.root.migrate(migrations);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export { toNumber };
