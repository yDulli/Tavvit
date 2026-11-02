import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import type { FederationRelayEvent } from '@backspace/shared';

// A relayed message reaches a person of this instance only as the local routes would let it, and a
// refused one leaves nothing behind: no row for its author (which would ask their home for a
// profile and pictures), no conversation, no message (routes/federation/localConsent.ts).

setWorkerId(1);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToAdmins: vi.fn(),
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    forceDisconnectUser: vi.fn(),
    lateBindFederatedCall: vi.fn(),
    getDmRoomMeta: vi.fn(() => undefined),
    setDmRoomMeta: vi.fn(),
    getAllOnlineUserIds: () => [],
    isUserFocused: () => false,
  },
}));
vi.mock('../utils/federationAuth.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/federationAuth.js')>();
  return { ...actual, getOurOrigin: () => OUR_ORIGIN };
});

const OUR_ORIGIN = 'https://home.test';
const HOME_DOMAIN = 'home.test';
const PEER = 'https://orbit.test';

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

// The federation module is large: loaded once before the cases, so none of them waits for it
// under its own time limit (a case that ran out would go on writing into the next one's database).
beforeAll(async () => {
  await import('./federation.js');
}, 60_000);

beforeEach(() => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  testDb.insert(schema.federationPeers).values({ id: 'peer-orbit', origin: PEER, hmacSecret: 'orbit-secret-0123456789abcdef', status: 'active', createdAt: 1 }).run();
  testDb.insert(schema.users).values({ id: 'lena', username: 'lena', passwordHash: 'x', createdAt: 1 }).run();
});

/** A 1-on-1 message from `author` (homed on the peer) to lena here. */
function createFrom(author: string, messageId: string, extra: Partial<FederationRelayEvent> = {}): FederationRelayEvent {
  return {
    eventType: 'create',
    contextType: 'dm',
    messageId,
    encryptionVersion: 0,
    timestamp: 1_700_000_000_000,
    participants: [
      { homeUserId: author, homeInstance: 'orbit.test', profile: { username: author } },
      { homeUserId: 'lena', homeInstance: HOME_DOMAIN, profile: { username: 'lena' } },
    ],
    message: {
      userId: author,
      homeUserId: author,
      homeInstance: 'orbit.test',
      content: 'hello',
      replyToId: null,
      editedAt: null,
      createdAt: 1_700_000_000_000,
    },
    ...extra,
  };
}

const rowsFor = (homeUserId: string) => testDb.select().from(schema.users).where(eq(schema.users.homeUserId, homeUserId)).all();
const counts = () => ({ channels: testDb.select().from(schema.dmChannels).all().length, messages: testDb.select().from(schema.dmMessages).all().length });

describe('a relayed 1-on-1 create', () => {
  it('from an author nobody here knows makes nothing when the person here does not take it', async () => {
    const { processRelayEvents } = await import('./federation.js');
    const result = await processRelayEvents([createFrom('stranger', 'm-1')], PEER, PEER, testDb);

    expect(result.rejected).toEqual([{ messageId: 'm-1', reason: 'recipient_refuses' }]);
    expect(rowsFor('stranger')).toEqual([]);
    expect(counts()).toEqual({ channels: 0, messages: 0 });
  });

  it('from an author nobody here knows reaches someone who takes messages from anyone, and only then makes their row', async () => {
    testDb.update(schema.users).set({ dmPolicy: 'anyone' }).where(eq(schema.users.id, 'lena')).run();
    const { processRelayEvents } = await import('./federation.js');
    const result = await processRelayEvents([createFrom('stranger', 'm-2')], PEER, PEER, testDb);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual(['m-2']);
    expect(rowsFor('stranger')).toHaveLength(1);
    expect(counts()).toEqual({ channels: 1, messages: 1 });
  });

  it('that carries a 1-on-1\'s key is refused, as no sender puts one there, so a block is not passed by', async () => {
    testDb.update(schema.users).set({ dmPolicy: 'anyone' }).where(eq(schema.users.id, 'lena')).run();
    const { processRelayEvents } = await import('./federation.js');
    expect((await processRelayEvents([createFrom('sam', 'm-3')], PEER, PEER, testDb)).accepted).toEqual(['m-3']);
    const pair = testDb.select().from(schema.dmChannels).get()!;
    const sam = rowsFor('sam')[0]!;
    testDb.insert(schema.userBlocks).values({ blockerId: 'lena', blockedId: sam.id, createdAt: 1 }).run();

    const keyed = await processRelayEvents([createFrom('sam', 'm-4', { federatedId: pair.federatedId! })], PEER, PEER, testDb);
    expect(keyed.rejected).toEqual([{ messageId: 'm-4', reason: 'invalid_target' }]);
    // Without the key the block refuses it as the local route would.
    const plain = await processRelayEvents([createFrom('sam', 'm-5')], PEER, PEER, testDb);
    expect(plain.rejected).toEqual([{ messageId: 'm-5', reason: 'recipient_refuses' }]);
    expect(counts()).toEqual({ channels: 1, messages: 1 });
  });

  it('names two people: one that names its author twice, or nobody known here, is refused and makes nothing', async () => {
    testDb.update(schema.users).set({ dmPolicy: 'anyone' }).where(eq(schema.users.id, 'lena')).run();
    const { processRelayEvents } = await import('./federation.js');
    const twice = createFrom('sam', 'm-6');
    twice.participants = [twice.participants![0]!, twice.participants![0]!];
    expect((await processRelayEvents([twice], PEER, PEER, testDb)).rejected).toEqual([{ messageId: 'm-6', reason: 'invalid_target' }]);
    // A person "here" who does not exist: nobody of this instance is in it.
    const ghost = createFrom('sam', 'm-6b');
    ghost.participants = [ghost.participants![0]!, { homeUserId: 'nobody-here', homeInstance: HOME_DOMAIN }];
    expect((await processRelayEvents([ghost], PEER, PEER, testDb)).rejected).toEqual([{ messageId: 'm-6b', reason: 'participant_not_found' }]);
    expect(rowsFor('sam')).toEqual([]);
    expect(counts()).toEqual({ channels: 0, messages: 0 });
  });
});

describe('a relayed reaction in a 1-on-1', () => {
  it('is refused across a block, as the local handler refuses it', async () => {
    testDb.update(schema.users).set({ dmPolicy: 'anyone' }).where(eq(schema.users.id, 'lena')).run();
    const { processRelayEvents } = await import('./federation.js');
    expect((await processRelayEvents([createFrom('sam', 'm-7')], PEER, PEER, testDb)).accepted).toEqual(['m-7']);
    const sam = rowsFor('sam')[0]!;
    const reaction = (messageId: string): FederationRelayEvent => ({
      eventType: 'reaction_add',
      contextType: 'dm',
      messageId,
      encryptionVersion: 0,
      timestamp: 1_700_000_000_100,
      reaction: { messageId: 'm-7', messageHomeInstance: PEER, userId: 'sam', homeUserId: 'sam', homeInstance: 'orbit.test', emoji: '👍', createdAt: 1_700_000_000_100 },
    });

    // Positive control: the same reaction is taken while nobody blocks anybody.
    expect((await processRelayEvents([reaction('r-1')], PEER, PEER, testDb)).accepted).toEqual(['r-1']);
    testDb.delete(schema.dmReactions).run();

    testDb.insert(schema.userBlocks).values({ blockerId: 'lena', blockedId: sam.id, createdAt: 1 }).run();
    const blocked = await processRelayEvents([reaction('r-2')], PEER, PEER, testDb);
    expect(blocked.rejected).toEqual([{ messageId: 'r-2', reason: 'recipient_refuses' }]);
    expect(testDb.select().from(schema.dmReactions).all()).toEqual([]);
  });
});
