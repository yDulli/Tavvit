import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
    const sqlText = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

describe('tombstoneUser — federation_home_orphaned cleanup', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    testDb = drizzle(sqlite, { schema });
    applyMigrations(sqlite);
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('clears federation_home_orphaned when tombstoning', async () => {
    const { getDb } = await import('../db/index.js');
    const { tombstoneUser } = await import('./userDeletion.js');
    const db = getDb();
    const uid = 'user_test_orphan';
    db.insert(schema.users).values({
      id: uid, username: 'carol@remote.example', passwordHash: 'x',
      createdAt: Date.now(), federationHomeOrphaned: 1,
    }).run();
    tombstoneUser(uid, { purgeContent: false });
    const row = db.select().from(schema.users).where(eq(schema.users.id, uid)).get();
    expect(row?.federationHomeOrphaned ?? 0).toBe(0);
    expect(row?.isDeleted).toBe(1);
  });

  it('clears the profile card fields and hands back the space profile pictures', async () => {
    const { getDb } = await import('../db/index.js');
    const { tombstoneUser } = await import('./userDeletion.js');
    const db = getDb();
    const uid = 'user_test_profile';
    db.insert(schema.users).values({
      id: uid, username: 'dana', passwordHash: 'x', createdAt: 1,
      pronouns: 'she/her', profileLinks: JSON.stringify([{ url: 'https://example.com/', label: null }]),
      profileLayout: 'compact', accentColorSecondary: '#112233', avatar: 'dana.webp',
    }).run();
    db.insert(schema.users).values({ id: 'space_owner', username: 'owner', passwordHash: 'x', createdAt: 1 }).run();
    db.insert(schema.spaces).values({ id: 'space_profile', name: 'Space', ownerId: 'space_owner', createdAt: 1 }).run();
    db.insert(schema.spaceMembers).values({ spaceId: 'space_profile', userId: uid, joinedAt: 1, avatar: 'dana-space.webp' }).run();

    const files = tombstoneUser(uid, { purgeContent: false });

    const row = db.select().from(schema.users).where(eq(schema.users.id, uid)).get();
    expect(row).toMatchObject({ pronouns: null, profileLinks: null, profileLayout: null, accentColorSecondary: null, avatar: null });
    expect(files).toEqual(expect.arrayContaining(['dana.webp', 'dana-space.webp']));
  });
});
