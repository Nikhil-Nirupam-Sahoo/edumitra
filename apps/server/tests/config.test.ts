/**
 * Deployment configuration: PaaS connection strings, TLS, and the built-PWA
 * directory the server serves.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const SECRET = 'test-secret-at-least-16-chars';

function load(env: Record<string, string>) {
  return loadConfig({ NODE_ENV: 'test', SYNC_SIGNING_SECRET: SECRET, ...env } as NodeJS.ProcessEnv);
}

describe('DATABASE_URL', () => {
  it('overrides DB_* fields, forces postgres, and enables TLS', () => {
    const cfg = load({
      DATABASE_URL: 'postgres://appuser:s3cr%40et@db.internal:5433/edumitra_prod?sslmode=require',
      DB_HOST: 'ignored',
      DB_PASSWORD: 'ignored',
    });
    expect(cfg.db.driver).toBe('postgres');
    expect(cfg.db.host).toBe('db.internal');
    expect(cfg.db.port).toBe(5433);
    expect(cfg.db.database).toBe('edumitra_prod');
    expect(cfg.db.user).toBe('appuser');
    expect(cfg.db.password).toBe('s3cr@et'); // percent-decoded
    expect(cfg.db.ssl).toBe(true);
  });

  it('honours an explicit sslmode=disable', () => {
    const cfg = load({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db?sslmode=disable' });
    expect(cfg.db.ssl).toBe(false);
    expect(cfg.db.driver).toBe('postgres');
  });

  it('keeps plain DB_* configuration when no URL is present', () => {
    const cfg = load({ DB_DRIVER: 'dev', DATA_DIR: '/tmp/x' });
    expect(cfg.db.driver).toBe('dev');
    expect(cfg.db.ssl).toBe(false);
  });

  it('rejects non-postgres URLs with a clear error', () => {
    expect(() => load({ DATABASE_URL: 'mysql://user:pw@host/db' })).toThrow(/postgres/);
    expect(() => load({ DATABASE_URL: 'not a url' })).toThrow(/valid URL/);
  });
});

describe('clientDist', () => {
  it('defaults to the repo client build', () => {
    expect(load({}).clientDist).toContain('apps/client/dist');
  });

  it('honours an explicit CLIENT_DIST override', () => {
    expect(load({ CLIENT_DIST: '/srv/www' }).clientDist).toBe('/srv/www');
  });
});
