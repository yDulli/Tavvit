import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../db/schema.js';

// What a person here decides, which no peer decides for them: a relayed group add, conversation,
// call or friend request reaches them only as the local routes would let it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;

vi.mock('../../db/index.js', () => ({ getDb: () => testDb, schema }));

const {
  relayedCallRefusal, relayedConversationRefusal, relayedConversationRefusalFromStranger, relayedFriendRequestRefusal, relayedGroupAddRefusal,
} = await import('./localConsent.js');
const { GROUP_DMS_PER_ACCOUNT } = await import('../../utils/groupDmLimits.js');

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

const HERE = 'here';
const REMOTE = 'remote-stub';
const row = (id: string) => testDb.select().from(schema.users).where(eq(schema.users.id, id)).get()!;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.users).values([
    { id: HERE, username: 'here', passwordHash: 'x', createdAt: 1 },
    { id: REMOTE, username: 'someone@peer.example', passwordHash: '!federation-replicated', homeUserId: 'someone', homeInstance: 'https://peer.example', createdAt: 1 },
  ]).run();
});

const befriend = () => testDb.insert(schema.friends).values({ userId: REMOTE, friendId: HERE, createdAt: 1 }).run();
const block = (blocker: string, blocked: string) => testDb.insert(schema.userBlocks).values({ blockerId: blocker, blockedId: blocked, createdAt: 1 }).run();

describe('a relayed group add of someone here', () => {
  it('is taken from a friend, and refused from a stranger or across a block', () => {
    expect(relayedGroupAddRefusal(REMOTE, row(HERE), false)).toBe('not_a_friend');
    befriend();
    expect(relayedGroupAddRefusal(REMOTE, row(HERE), false)).toBeNull();
    block(HERE, REMOTE);
    expect(relayedGroupAddRefusal(REMOTE, row(HERE), false)).toBe('blocked');
  });

  it('is taken from the owner they share a 1-on-1 with, as a group made from it is, and from no other member', () => {
    testDb.insert(schema.dmChannels).values({ id: 'pair', ownerId: null, createdAt: 1 }).run();
    testDb.insert(schema.dmMembers).values([{ dmChannelId: 'pair', userId: HERE }, { dmChannelId: 'pair', userId: REMOTE }]).run();
    expect(relayedGroupAddRefusal(REMOTE, row(HERE), true)).toBeNull();
    // Any member adds only a friend (POST /api/dm/:id/members).
    expect(relayedGroupAddRefusal(REMOTE, row(HERE), false)).toBe('not_a_friend');
  });

  it('is refused once they are in as many groups as an account may be', () => {
    befriend();
    for (let i = 0; i < GROUP_DMS_PER_ACCOUNT; i += 1) {
      testDb.insert(schema.dmChannels).values({ id: `g${i}`, ownerId: REMOTE, createdAt: 1 }).run();
      testDb.insert(schema.dmMembers).values({ dmChannelId: `g${i}`, userId: HERE }).run();
    }
    expect(relayedGroupAddRefusal(REMOTE, row(HERE), false)).toBe('group_limit');
  });

  it('of someone homed elsewhere is their home\'s to decide, but a block they made here holds', () => {
    testDb.insert(schema.users).values({ id: 'other', username: 'o@x.example', passwordHash: 'x', homeUserId: 'o', homeInstance: 'https://x.example', createdAt: 1 }).run();
    expect(relayedGroupAddRefusal(REMOTE, row('other'), false)).toBeNull();
    // An account homed elsewhere that signs in here can block here, as the local routes honour.
    block('other', REMOTE);
    expect(relayedGroupAddRefusal(REMOTE, row('other'), false)).toBe('blocked');
    expect(relayedConversationRefusal(REMOTE, row('other'), false)).toBe('blocked');
    expect(relayedCallRefusal(REMOTE, row('other'))).toBe('blocked');
    expect(relayedFriendRequestRefusal(REMOTE, row('other'))).toBe('blocked');
  });
});

describe('a relayed 1-on-1 to someone here', () => {
  it('starts one only as their rule on who may write lets it, and never across a block', () => {
    testDb.update(schema.users).set({ dmPolicy: 'nobody' }).where(eq(schema.users.id, HERE)).run();
    expect(relayedConversationRefusal(REMOTE, row(HERE), true)).toBe('policy');
    // A conversation they already have goes on: the rule is about starting one.
    expect(relayedConversationRefusal(REMOTE, row(HERE), false)).toBeNull();
    testDb.update(schema.users).set({ dmPolicy: 'anyone' }).where(eq(schema.users.id, HERE)).run();
    expect(relayedConversationRefusal(REMOTE, row(HERE), true)).toBeNull();
    block(REMOTE, HERE);
    expect(relayedConversationRefusal(REMOTE, row(HERE), false)).toBe('blocked');
  });

  it('from an author nobody here knows reaches only someone who takes messages from anyone', () => {
    expect(relayedConversationRefusalFromStranger(row(HERE))).toBe('policy');
    testDb.update(schema.users).set({ dmPolicy: 'friends_and_spaces' }).where(eq(schema.users.id, HERE)).run();
    expect(relayedConversationRefusalFromStranger(row(HERE))).toBe('policy');
    testDb.update(schema.users).set({ dmPolicy: 'anyone' }).where(eq(schema.users.id, HERE)).run();
    expect(relayedConversationRefusalFromStranger(row(HERE))).toBeNull();
  });
});

describe('a relayed call or friend request to someone here', () => {
  it('rings nobody who blocked the caller, and asks nobody who takes no request', () => {
    expect(relayedCallRefusal(REMOTE, row(HERE))).toBeNull();
    block(HERE, REMOTE);
    expect(relayedCallRefusal(REMOTE, row(HERE))).toBe('blocked');
    expect(relayedFriendRequestRefusal(REMOTE, row(HERE))).toBe('blocked');
  });

  it('follows their rule on who may send a friend request', () => {
    testDb.update(schema.users).set({ friendRequestPolicy: 'nobody' }).where(eq(schema.users.id, HERE)).run();
    expect(relayedFriendRequestRefusal(REMOTE, row(HERE))).toBe('policy');
  });
});
