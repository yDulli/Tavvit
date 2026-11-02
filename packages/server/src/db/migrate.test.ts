import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ensureDefaults } from './migrate.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE instance_settings (id integer PRIMARY KEY, instance_name text DEFAULT 'Backspace', worker_id integer, instance_id text, discovery_enabled integer NOT NULL DEFAULT 1, max_bitrate_kbps integer, min_bitrate_kbps integer, bitrate_step_kbps integer, allowed_resolutions text, allowed_framerates text, max_resolution integer, max_framerate integer, federated_registration_open integer NOT NULL DEFAULT 1, auto_accept_peering integer NOT NULL DEFAULT 1, directory_browse_enabled integer NOT NULL DEFAULT 1, installed_at integer, updated_at integer);
    CREATE TABLE users (id text PRIMARY KEY, is_admin integer DEFAULT 0, home_instance text, is_deleted integer DEFAULT 0, created_at integer, suspended_at integer, suspended_until integer, account_kind text NOT NULL DEFAULT 'person');
    ALTER TABLE instance_settings ADD COLUMN signup_challenge text NOT NULL DEFAULT 'off';`);
  return db;
}

describe('ensureDefaults instance epoch', () => {
  it('mints an instance_id when null and is idempotent', () => {
    const db = freshDb();
    ensureDefaults(db);
    const first = (db.prepare('SELECT instance_id FROM instance_settings WHERE id = 1').get() as { instance_id: string }).instance_id;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    ensureDefaults(db);
    const second = (db.prepare('SELECT instance_id FROM instance_settings WHERE id = 1').get() as { instance_id: string }).instance_id;
    expect(second).toBe(first); // stable across boots
  });

  it('mints a different id for a separate fresh DB', () => {
    const a = freshDb(); ensureDefaults(a);
    const b = freshDb(); ensureDefaults(b);
    const idA = (a.prepare('SELECT instance_id FROM instance_settings WHERE id = 1').get() as { instance_id: string }).instance_id;
    const idB = (b.prepare('SELECT instance_id FROM instance_settings WHERE id = 1').get() as { instance_id: string }).instance_id;
    expect(idA).not.toBe(idB);
  });
});

describe('ensureDefaults and administrators', () => {
  it('makes nobody an administrator, even with none there: that would be whoever came first', () => {
    const db = freshDb();
    db.exec("INSERT INTO users (id, created_at) VALUES ('first', 1), ('later', 2)");
    ensureDefaults(db);
    expect(db.prepare('SELECT id FROM users WHERE is_admin = 1').all()).toEqual([]);
  });

  it('leaves the administrators that are there', () => {
    const db = freshDb();
    db.exec("INSERT INTO users (id, created_at, is_admin) VALUES ('boss', 1, 1)");
    ensureDefaults(db);
    expect(db.prepare('SELECT id FROM users WHERE is_admin = 1').all()).toEqual([{ id: 'boss' }]);
  });
});

describe('ensureDefaults private-instance defaults', () => {
  const readRow = (db: Database.Database) =>
    db.prepare(
      `SELECT instance_name, discovery_enabled, federated_registration_open, auto_accept_peering,
              directory_browse_enabled
       FROM instance_settings WHERE id = 1`,
    ).get() as Record<string, number | string>;

  it('writes a private, Tavvit-named row into a brand-new database', () => {
    const db = freshDb();
    ensureDefaults(db);
    expect(readRow(db)).toEqual({
      instance_name: 'Tavvit',
      discovery_enabled: 0,
      federated_registration_open: 0,
      auto_accept_peering: 0,
      directory_browse_enabled: 0,
    });
  });

  it('never rewrites the settings of an instance that already has a row', () => {
    const db = freshDb();
    // An existing instance: the upstream column defaults, and a name its admin chose.
    db.prepare(`INSERT INTO instance_settings (id, instance_name, updated_at) VALUES (1, 'Our Place', 1)`).run();
    ensureDefaults(db);
    expect(readRow(db)).toEqual({
      instance_name: 'Our Place',
      discovery_enabled: 1,
      federated_registration_open: 1,
      auto_accept_peering: 1,
      directory_browse_enabled: 1,
    });
  });
});
