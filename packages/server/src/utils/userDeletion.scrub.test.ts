import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// A tombstone keeps the users row, so no ON DELETE CASCADE fires: everything about the person
// has to be named in tombstoneUser. A table added later and forgotten there stays behind for ever.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const UID = 'user-going';

/** A row in `table` with `column` holding the person, whatever else the table requires. */
function rowFor(table: string, column: string, overrides: Record<string, string | number> = {}): void {
  const columns = sqlite.pragma(`table_info(${table})`) as Array<{ name: string; type: string; notnull: number; pk: number }>;
  const values: Record<string, string | number> = {};
  columns.forEach((col, index) => {
    if (col.notnull === 1 || col.pk > 0) values[col.name] = /INT/i.test(col.type) ? index + 1 : `x-${index}-${column}`;
  });
  values[column] = UID;
  Object.assign(values, overrides);
  const names = Object.keys(values);
  sqlite.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((name) => values[name]));
}

const count = (table: string, where: string, ...params: string[]): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number }).n;

beforeEach(() => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  // These rows point at spaces and channels this test does not need to make.
  sqlite.pragma('foreign_keys = OFF');
  testDb.insert(schema.users).values({
    id: UID,
    username: 'going',
    passwordHash: 'x',
    createdAt: 1,
    suspendedAt: 2,
    suspendedUntil: 3,
    suspensionReason: 'What they did, in the words of an admin',
    badges: '["early_supporter"]',
  }).run();
});

afterEach(() => {
  sqlite.close();
});

describe('deleting an account', () => {
  const SCRUBBED: Array<[table: string, column: string]> = [
    ['user_federation_registry', 'user_id'],
    ['user_blocks', 'blocker_id'],
    ['user_blocks', 'blocked_id'],
    ['notification_settings', 'user_id'],
    ['user_space_layout', 'user_id'],
    ['personal_stickers', 'user_id'],
    ['peer_approval_subscribers', 'user_id'],
    ['peer_approval_notifications', 'user_id'],
    ['channel_slowmode_posts', 'user_id'],
    ['space_departed_timeouts', 'user_id'],
    ['admin_notes', 'user_id'],
    ['poll_votes', 'user_id'],
    ['thread_members', 'user_id'],
    ['space_event_rsvps', 'user_id'],
    ['bots', 'owner_id'],
    ['saved_messages', 'user_id'],
    ['notification_keywords', 'user_id'],
    ['space_events', 'created_by'],
    ['webhooks', 'created_by'],
    ['channel_follows', 'created_by'],
    ['space_sounds', 'created_by'],
    ['space_emojis', 'created_by'],
    ['space_stickers', 'created_by'],
    ['custom_emojis', 'created_by'],
    ['channels', 'thread_created_by'],
    ['push_subscriptions', 'user_id'],
    ['user_notices', 'user_id'],
    ['sessions', 'user_id'],
    ['security_events', 'user_id'],
    ['retired_usernames', 'user_id'],
  ];

  it.each(SCRUBBED)('leaves nothing of them in %s (%s)', async (table, column) => {
    const { tombstoneUser } = await import('./userDeletion.js');
    rowFor(table, column);
    expect(count(table, `${column} = ?`, UID)).toBe(1);
    tombstoneUser(UID);
    expect(count(table, `${column} = ?`, UID)).toBe(0);
  });

  it('takes the rows that name them in a category too, and only those', async () => {
    const { tombstoneUser } = await import('./userDeletion.js');
    rowFor('category_overrides', 'target_id', { target_type: 'member' });
    rowFor('category_overrides', 'category_id', { target_type: 'member', target_id: 'someone-else', category_id: 'other' });
    tombstoneUser(UID);
    expect(count('category_overrides', 'target_id = ?', UID)).toBe(0);
    expect(count('category_overrides', 'target_id = ?', 'someone-else')).toBe(1);
  });

  it('keeps the record that an invite was used, without the name', async () => {
    const { tombstoneUser } = await import('./userDeletion.js');
    rowFor('invite_redemptions', 'user_id', { registrant_username: 'going' });
    tombstoneUser(UID);
    const row = sqlite.prepare('SELECT registrant_username AS name FROM invite_redemptions WHERE user_id = ?').get(UID) as { name: string };
    expect(row.name).toBe('Deleted User');
  });

  it('clears what an admin wrote on the account, and its badges', async () => {
    const { tombstoneUser } = await import('./userDeletion.js');
    tombstoneUser(UID);
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, UID)).get()!;
    expect(row.suspendedAt).toBeNull();
    expect(row.suspendedUntil).toBeNull();
    expect(row.suspensionReason).toBeNull();
    expect(row.badges).toBeNull();
    expect(row.isDeleted).toBe(1);
  });
});
