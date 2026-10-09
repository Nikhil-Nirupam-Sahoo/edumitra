/**
 * Schema migrations — ordered, append-only, dialect-portable SQL.
 *
 * Notes:
 *  - All epoch-ms columns are BIGINT: 32-bit INTEGER would overflow (ms epoch
 *    is ~1.7e12 > 2^31). SQLite has no width limits; Postgres needs BIGINT.
 *  - JSON is stored as TEXT in both dialects (SQLite has no jsonb); services
 *    parse/stringify at the boundary.
 *  - Booleans are INTEGER 0/1 for portability.
 *  - `ON CONFLICT ... DO NOTHING/UPDATE` is supported by SQLite >= 3.24 and
 *    PostgreSQL >= 9.5.
 */

import type { Migration } from './types.js';

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_core',
    sql: `
      -- Mirrors of client data: full xAPI statement log (the source of truth).
      CREATE TABLE IF NOT EXISTS xapi_statements (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        lesson_id TEXT,
        verb TEXT NOT NULL,
        statement_json TEXT NOT NULL,
        timestamp_ms BIGINT NOT NULL,
        stored_at_ms BIGINT NOT NULL,
        device_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_xapi_student_time ON xapi_statements (student_id, timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_xapi_lesson_time ON xapi_statements (lesson_id, timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_xapi_stored ON xapi_statements (stored_at_ms);
      CREATE INDEX IF NOT EXISTS idx_xapi_verb ON xapi_statements (verb);

      -- CRDT register store: one row per (student, lesson, checkpoint key).
      CREATE TABLE IF NOT EXISTS progress_state (
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        ts BIGINT NOT NULL,
        op TEXT NOT NULL,
        source_statement_id TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (student_id, lesson_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_progress_state_updated ON progress_state (updated_at);

      -- Dedupe ledger for additive (count-inc) checkpoints.
      CREATE TABLE IF NOT EXISTS checkpoint_applied (
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        key TEXT NOT NULL,
        source_statement_id TEXT NOT NULL,
        applied_at BIGINT NOT NULL,
        PRIMARY KEY (lesson_id, key, source_statement_id)
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_applied_at ON checkpoint_applied (applied_at);

      -- Denormalized per-lesson head so clients can bootstrap without replay.
      CREATE TABLE IF NOT EXISTS progress_heads (
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        completion_status TEXT NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        last_card_index INTEGER NOT NULL,
        time_on_task_ms BIGINT NOT NULL,
        latest_ts BIGINT NOT NULL,
        head_statement_id TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (student_id, lesson_id)
      );
      CREATE INDEX IF NOT EXISTS idx_progress_heads_updated ON progress_heads (updated_at);

      -- Device sync cursors (delta pull).
      CREATE TABLE IF NOT EXISTS device_cursors (
        device_id TEXT PRIMARY KEY,
        last_seen_at BIGINT NOT NULL,
        last_statement_ts BIGINT NOT NULL
      );

      -- Batch audit log (observability + replay forensics).
      CREATE TABLE IF NOT EXISTS sync_batches (
        batch_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        received_at BIGINT NOT NULL,
        statement_count INTEGER NOT NULL,
        accepted INTEGER NOT NULL,
        duplicates INTEGER NOT NULL,
        rejected INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_batches_device ON sync_batches (device_id, received_at);

      -- Tombstones for statements purged by retention; lets offline devices
      -- drop local copies without re-uploading them.
      CREATE TABLE IF NOT EXISTS purged_tombstones (
        statement_id TEXT PRIMARY KEY,
        purged_at BIGINT NOT NULL,
        device_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tombstones_purged ON purged_tombstones (purged_at);
    `,
  },
  {
    id: '0002_sync_metrics',
    sql: `
      CREATE TABLE IF NOT EXISTS sync_metrics_daily (
        day TEXT NOT NULL,
        device_id TEXT NOT NULL,
        statements_ingested BIGINT NOT NULL DEFAULT 0,
        statements_duplicate BIGINT NOT NULL DEFAULT 0,
        statements_rejected BIGINT NOT NULL DEFAULT 0,
        batches INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, device_id)
      );
    `,
  },
  {
    id: '0004_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        class_id TEXT,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
    `,
  },
  {
    id: '0005_support_requests',
    sql: `
      -- Questions a student sends to their mentor. The id is a client-generated
      -- UUID rather than a serial so the same DDL works on SQLite and Postgres.
      CREATE TABLE IF NOT EXISTS support_requests (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_support_requests_created ON support_requests (created_at);
      CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests (status, created_at);
    `,
  },
  {
    id: '0006_users_auth_provider',
    sql: `
      -- Self-registration and Google sign-in.
      --
      -- auth_provider records how the account authenticates ('password' or
      -- 'google') so an account created by Google is never asked for a
      -- password, and one created with a password is never offered Google.
      --
      -- google_sub is Google's stable account id: unlike an email address it
      -- never changes, so it is what an account is linked by. The unique index
      -- is what stops one Google account creating two local users.
      ALTER TABLE users ADD COLUMN email TEXT;
      ALTER TABLE users ADD COLUMN google_sub TEXT;
      ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
    `,
  },
];
