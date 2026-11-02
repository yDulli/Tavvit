import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Migration 0039 adds the space moderation tables and three columns to an
 * existing database: it only adds, so every row that was there keeps its
 * values and the new columns read as their defaults. The files are found by
 * name, so a later migration does not move what this test applies.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');
const TAG = '0039_orbit_space_moderation';

function statementsOf(file: string): string[] {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    .split(/-->\s*statement-breakpoint/)
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
}

/** Every migration before the one under test, so an older database can be seeded first. */
function applyUpTo(db: Database.Database, tag: string): void {
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql')).sort()) {
    if (file.startsWith(tag)) return;
    for (const statement of statementsOf(file)) db.exec(statement);
  }
  throw new Error(`migration ${tag} not found`);
}

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map(row => row.name);
}

describe(TAG, () => {
  it('only adds: existing rows keep their values and read the new columns as defaults', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      applyUpTo(db, TAG);
      db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES ('alice', 'alice', 'hash', 1)").run();
      db.prepare("INSERT INTO spaces (id, name, owner_id, created_at) VALUES ('space', 'Space', 'alice', 1)").run();
      db.prepare("INSERT INTO space_members (space_id, user_id, nickname, joined_at) VALUES ('space', 'alice', 'Al', 2)").run();
      db.prepare("INSERT INTO channels (id, space_id, name, type, position, created_at) VALUES ('chan', 'space', 'general', 'text', 3, 1)").run();
      const before = tableNames(db);

      for (const statement of statementsOf(`${TAG}.sql`)) db.exec(statement);

      expect(tableNames(db).filter(name => !before.includes(name))).toEqual([
        'channel_slowmode_posts', 'space_audit_log', 'space_departed_timeouts', 'space_moderation_settings',
      ]);
      expect(db.prepare("SELECT name, owner_id, default_notification_level FROM spaces WHERE id = 'space'").get())
        .toEqual({ name: 'Space', owner_id: 'alice', default_notification_level: null });
      expect(db.prepare("SELECT nickname, joined_at, timed_out_until FROM space_members WHERE user_id = 'alice'").get())
        .toEqual({ nickname: 'Al', joined_at: 2, timed_out_until: null });
      expect(db.prepare("SELECT name, position, slowmode_seconds FROM channels WHERE id = 'chan'").get())
        .toEqual({ name: 'general', position: 3, slowmode_seconds: 0 });
      // An insert that names only the older columns, as fixtures and raw SQL do, still works.
      db.prepare("INSERT INTO channels (id, space_id, name, type, created_at) VALUES ('chan2', 'space', 'more', 'text', 1)").run();
      expect(db.prepare("SELECT slowmode_seconds FROM channels WHERE id = 'chan2'").get()).toEqual({ slowmode_seconds: 0 });

      db.prepare("INSERT INTO space_moderation_settings (space_id, updated_at) VALUES ('space', 5)").run();
      expect(db.prepare("SELECT blocked_words, block_links, block_invites, max_mentions, min_account_age_minutes, min_member_age_minutes FROM space_moderation_settings").get())
        .toEqual({ blocked_words: '[]', block_links: 0, block_invites: 0, max_mentions: 0, min_account_age_minutes: 0, min_member_age_minutes: 0 });
      db.prepare("INSERT INTO space_audit_log (id, space_id, actor_id, action, created_at) VALUES ('1', 'space', 'gone-user', 'space_update', 5)").run();
      db.prepare("INSERT INTO channel_slowmode_posts (channel_id, user_id, posted_at) VALUES ('chan', 'alice', 5)").run();
      db.prepare("INSERT INTO space_departed_timeouts (space_id, user_id, timed_out_until) VALUES ('space', 'alice', 9)").run();
      expect(() => db.prepare("INSERT INTO space_audit_log (id, space_id, actor_id, action, created_at) VALUES ('2', 'missing', 'alice', 'space_update', 5)").run())
        .toThrow(/FOREIGN KEY/);
      expect(db.pragma('foreign_key_check')).toEqual([]);

      // Every new row goes with its space.
      db.prepare("DELETE FROM spaces WHERE id = 'space'").run();
      for (const table of ['space_moderation_settings', 'space_audit_log', 'channel_slowmode_posts', 'space_departed_timeouts']) {
        expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
      }
    } finally {
      db.close();
    }
  });
});
