/**
 * Database port — a tiny, dialect-agnostic surface shared by the dev (SQLite)
 * and production (PostgreSQL) adapters.
 *
 * SQL is written with `?` placeholders throughout the codebase; the Postgres
 * adapter rewrites them to `$1..$n`. This keeps every query in the domain
 * services portable without an ORM.
 */

export type DbDriver = 'dev' | 'postgres';

export interface DbPort {
  readonly driver: DbDriver;
  /** SELECT-ish query returning rows. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** SELECT returning the first row or undefined. */
  queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | undefined>;
  /** INSERT/UPDATE/DELETE; returns affected row count. */
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  /** Multi-statement DDL. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside a real transaction with commit/rollback. */
  transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T>;
  /** Applies schema migrations idempotently; returns applied ids. */
  migrate(migrations: readonly Migration[]): Promise<string[]>;
  close(): Promise<void>;
}

export interface Migration {
  id: string;
  sql: string;
}

/** Rewrites `?` placeholders to `$1..$n` for PostgreSQL. */
export function toPostgresPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/** Normalizes driver return values (bigint from SQLite, strings from pg). */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
