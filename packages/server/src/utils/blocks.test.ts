import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

import { addBlock, blockRefusal, hasBlocked, listBlockedIds, oneOnOneBlockRefusal, removeBlock } from './blocks.js';

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

function seedDm(id: string, members: string[], ownerId: string | null = null): void {
  testDb.insert(schema.dmChannels).values({ id, ownerId, createdAt: 1 }).run();
  for (const userId of members) {
    testDb.insert(schema.dmMembers).values({ dmChannelId: id, userId }).run();
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  for (const id of ['alice', 'bob', 'carol']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
});

describe('blockRefusal', () => {
  it('is null while nothing stands between two people', () => {
    expect(blockRefusal('alice', 'bob')).toBeNull();
  });

  it('tells the blocker they blocked, and the blocked person nothing specific', () => {
    addBlock('alice', 'bob');
    expect(blockRefusal('alice', 'bob')).toBe('blocked_by_you');
    expect(blockRefusal('bob', 'alice')).toBe('interaction_unavailable');
  });

  it('puts the actor\'s own block first when both have blocked', () => {
    addBlock('alice', 'bob');
    addBlock('bob', 'alice');
    expect(blockRefusal('alice', 'bob')).toBe('blocked_by_you');
    expect(blockRefusal('bob', 'alice')).toBe('blocked_by_you');
  });

  it('does not touch a third person', () => {
    addBlock('alice', 'bob');
    expect(blockRefusal('alice', 'carol')).toBeNull();
    expect(blockRefusal('carol', 'bob')).toBeNull();
  });
});

describe('oneOnOneBlockRefusal', () => {
  it('closes a 1-on-1 between two people one of whom blocked the other', () => {
    seedDm('dm1', ['alice', 'bob']);
    addBlock('bob', 'alice');
    expect(oneOnOneBlockRefusal('dm1', 'alice')).toBe('interaction_unavailable');
    expect(oneOnOneBlockRefusal('dm1', 'bob')).toBe('blocked_by_you');
  });

  it('is null in a 1-on-1 nobody blocked', () => {
    seedDm('dm1', ['alice', 'bob']);
    expect(oneOnOneBlockRefusal('dm1', 'alice')).toBeNull();
  });

  it('never closes a group: other people share it', () => {
    seedDm('group', ['alice', 'bob', 'carol'], 'alice');
    addBlock('carol', 'bob');
    expect(oneOnOneBlockRefusal('group', 'bob')).toBeNull();
    expect(oneOnOneBlockRefusal('group', 'carol')).toBeNull();
  });

  it('is null for a conversation that does not exist', () => {
    expect(oneOnOneBlockRefusal('nope', 'alice')).toBeNull();
  });
});

describe('addBlock and removeBlock', () => {
  it('reports whether the block is new', () => {
    expect(addBlock('alice', 'bob').created).toBe(true);
    expect(addBlock('alice', 'bob').created).toBe(false);
    expect(hasBlocked('alice', 'bob')).toBe(true);
    expect(hasBlocked('bob', 'alice')).toBe(false);
  });

  it('ends the friendship and withdraws pending requests in one go', () => {
    testDb.insert(schema.friends).values([
      { userId: 'alice', friendId: 'bob', createdAt: 1 },
      { userId: 'bob', friendId: 'alice', createdAt: 1 },
    ]).run();
    testDb.insert(schema.friendRequests).values([
      { id: 'r1', fromId: 'alice', toId: 'bob', status: 'pending', createdAt: 1 },
      { id: 'r2', fromId: 'carol', toId: 'bob', status: 'pending', createdAt: 1 },
    ]).run();
    const result = addBlock('alice', 'bob');
    expect(result.removedFriendship).toBe(true);
    expect(result.removedRequests.map((r) => r.id)).toEqual(['r1']);
    // Bob's request from carol is none of this.
    expect(testDb.select().from(schema.friendRequests).all().map((r) => r.id)).toEqual(['r2']);
  });

  it('lifts the block and reports whether there was one', () => {
    addBlock('alice', 'bob');
    expect(removeBlock('alice', 'bob')).toBe(true);
    expect(removeBlock('alice', 'bob')).toBe(false);
    expect(hasBlocked('alice', 'bob')).toBe(false);
  });

  it('lists the ids a person blocked', () => {
    addBlock('alice', 'bob');
    addBlock('alice', 'carol');
    addBlock('bob', 'alice');
    expect(listBlockedIds('alice').sort()).toEqual(['bob', 'carol']);
  });

  it('removes a block together with the person (cascade)', () => {
    addBlock('alice', 'bob');
    sqlite.prepare('DELETE FROM users WHERE id = ?').run('bob');
    expect(listBlockedIds('alice')).toEqual([]);
  });
});
