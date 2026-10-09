/**
 * Migration upgrade safety.
 *
 * A freshly-created database applies every migration in order, which hides a
 * class of bug that only bites an EXISTING deployment: a migration that
 * references a table it assumed an earlier migration had created. When that
 * earlier migration was reordered or squashed, the new one crashes the
 * production boot ("relation X does not exist") even though every test on a
 * fresh DB passes. These tests reproduce the real Render boot path by
 * controlling the migrations directly: apply the pre-existing set, then apply
 * the full set on top of that already-initialised database.
 */

import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/migrations.js';
import type { DbPort } from '../src/db/types.js';

async function freshDb(): Promise<DbPort> {
  // The adapter directly (not createDatabase, which auto-applies the whole
  // set) so the test controls exactly which migrations run and when.
  const { SqliteAdapter } = await import('../src/db/adapter-sqlite.js');
  return new SqliteAdapter(':memory:');
}

/** Migrations that shipped before the video/profile work (id prefix <= 6). */
function existingMigrations() {
  return MIGRATIONS.filter((m) => Number(m.id.slice(0, 4)) <= 6);
}

const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');

describe('migrations', () => {
  it('applies the whole set to a fresh database', async () => {
    const db = await freshDb();
    try {
      const applied = await db.migrate(MIGRATIONS);
      expect(applied.length).toBe(MIGRATIONS.length);
      await db.query('SELECT id FROM video_lectures LIMIT 1');
    } finally {
      await db.close();
    }
  });

  it('upgrades an existing (pre-0007) database to the full set', async () => {
    const db = await freshDb();
    try {
      // Simulate production: only the pre-session migrations are applied.
      const first = await db.migrate(existingMigrations());
      expect(first.length).toBe(existingMigrations().length);
      // Now the upgrade applies the new migrations on top of the old DB —
      // the exact path that crashed Render before the foreign key was removed.
      const upgrade = await db.migrate(MIGRATIONS);
      expect(upgrade.length).toBeGreaterThan(0);
      const videoCount = await db.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM video_lectures',
      );
      expect(videoCount?.cnt ?? 0).toBe(0);
    } finally {
      await db.close();
    }
  });

  it('never references a table no earlier-or-same migration creates', () => {
    const createdBy = new Set<string>();
    const violations: string[] = [];
    for (const migration of MIGRATIONS) {
      const sql = stripComments(migration.sql);
      for (const c of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi)) {
        createdBy.add(c[1]!);
      }
      for (const r of sql.matchAll(/REFERENCES\s+(\w+)/gi)) {
        if (!createdBy.has(r[1]!)) violations.push(`${migration.id} -> ${r[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
