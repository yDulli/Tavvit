import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

// Who may use which custom emoji outside a space's channels: in direct messages written here and
// in forwarded copies (the routes' own checks are in routes/channelsMessages.errorCodes.test.ts).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const { emojiUseRefusal, forwardableEmojiText, namesEmojiOfThisInstance, reactionEmojiRefusal, dmReactionExists } = await import('./emojiUse.js');

const SPACE = 'space-club';
const OTHER = 'space-other';
const CLUB = '8000001';
const OTHERS = '8000002';
const LIBRARY = '8000003';

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const [id, homeInstance] of [['ana', null], ['ben', null], ['remote', 'far.example']] as const) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', homeInstance, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Club', ownerId: 'ana', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: OTHER, name: 'Other', ownerId: 'ben', createdAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: 'ana', joinedAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: OTHER, userId: 'ben', joinedAt: 1 }).run();
  testDb.insert(schema.spaceEmojis).values({ id: CLUB, spaceId: SPACE, name: 'club', size: 1, createdBy: 'ana', createdAt: 1 }).run();
  testDb.insert(schema.spaceEmojis).values({ id: OTHERS, spaceId: OTHER, name: 'others', size: 1, createdBy: 'ben', createdAt: 1 }).run();
  testDb.insert(schema.customEmojis).values({ id: LIBRARY, name: 'lib', size: 1, createdBy: 'ana', createdAt: 1 }).run();
});

afterEach(() => {
  sqlite.close();
});

describe('in a direct message written here', () => {
  it('lets a member use their spaces\' emoji, and anyone the library\'s', () => {
    expect(emojiUseRefusal(`<:club:${CLUB}> <:lib:${LIBRARY}>`, 'ana', null)).toBeNull();
    expect(emojiUseRefusal(`<:others:${OTHERS}>`, 'ana', null)).toEqual({ status: 403, code: 'emoji_unavailable' });
  });

  it('judges only accounts that live here', () => {
    expect(namesEmojiOfThisInstance('ana')).toBe(true);
    expect(namesEmojiOfThisInstance('remote')).toBe(false);
  });

  it('checks reactions the same way, refusing an unknown emoji and allowing a +1', () => {
    expect(reactionEmojiRefusal(`emoji:${CLUB}`, 'ana', null, false)).toBeNull();
    expect(reactionEmojiRefusal(`emoji:${OTHERS}`, 'ana', null, false)?.code).toBe('emoji_unavailable');
    expect(reactionEmojiRefusal('emoji:8000099', 'ana', null, false)?.code).toBe('emoji_not_found');
    expect(reactionEmojiRefusal(`emoji:${OTHERS}`, 'ana', null, true)).toBeNull();
    expect(reactionEmojiRefusal('👍', 'ana', null, false)).toBeNull();
    expect(dmReactionExists('no-such-message', `emoji:${CLUB}`)).toBe(false);
  });
});

describe('a forwarded copy', () => {
  const text = `look <:club:${CLUB}> <:others:${OTHERS}> <:lib:${LIBRARY}> <:gone:8000099>`;

  it('keeps the emoji the forwarder may use where it lands, and makes the rest their name', () => {
    expect(forwardableEmojiText(text, 'ana', null)).toBe(`look <:club:${CLUB}> :others: <:lib:${LIBRARY}> <:gone:8000099>`);
    // Into the other space's channel, its own emoji may come; the club's, ana's own, too.
    expect(forwardableEmojiText(text, 'ana', OTHER)).toBe(text);
  });

  it('makes every emoji text in a direct message by an account whose home is elsewhere', () => {
    expect(forwardableEmojiText(text, 'remote', null)).toBe('look :club: :others: :lib: :gone:');
  });
});
