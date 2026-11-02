import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  schema,
}));

vi.mock('../utils/federationAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationAuth.js')>(
    '../utils/federationAuth.js',
  );
  return {
    ...actual,
    getOurOrigin: () => 'https://local.example',
  };
});

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const statements = sql.split(/-->\s*statement-breakpoint/);
    for (const stmt of statements) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

async function importSUT() {
  return await import('./federation.js');
}

async function importManager() {
  const mod = await import('../ws/handler.js');
  return mod.connectionManager;
}

let sqlite: Database.Database;

/** Insert a minimal native user row so dmMembers FK constraints pass. */
function seedUser(id: string): void {
  testDb.insert(schema.users).values({
    id,
    username: id,
    passwordHash: '!test',
    createdAt: Date.now(),
  }).run();
}

/** The remote caller as this instance knows them: a call comes from a member of its conversation. */
const CALLER_STUB = 'caller-stub';
function seedCaller(): void {
  testDb.insert(schema.users).values({
    id: CALLER_STUB,
    username: 'caller@remote.example',
    passwordHash: '!federation-replicated',
    homeUserId: 'caller-home',
    homeInstance: 'https://remote.example',
    createdAt: Date.now(),
  }).run();
}

describe('processRelayEvents → processDmCallStartEvent', () => {
  beforeEach(async () => {
    sqlite = new Database(':memory:');
    testDb = drizzle(sqlite, { schema });
    applyMigrations(sqlite);

    const cm = await importManager();
    for (const [fedId] of cm.getAllFederatedCalls()) cm.clearFederatedCall(fedId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sqlite.close();
  });

  it('Path B: zero matches → undeliverable, no FederatedCallEntry created', async () => {
    // Arrange: no local DM, no local user matching the participant list
    const { processRelayEvents } = await importSUT();
    const cm = await importManager();

    const federatedId = 'fed-call-pathB-empty';
    const event = {
      eventType: 'dm_call_start' as const,
      messageId: 'msg-1',
      encryptionVersion: 0 as const,
      timestamp: Date.now(),
      federatedId,
      call: {
        livekitUrl: 'wss://lk.example',
        tokens: { 'caller-home': 'tok-c', 'unknown-home': 'tok-u' },
        caller: {
          homeUserId: 'caller-home',
          homeInstance: 'https://remote.example',
          displayName: 'Caller',
        },
        participants: [
          { homeUserId: 'caller-home', homeInstance: 'https://remote.example', displayName: 'Caller' },
          { homeUserId: 'unknown-home', homeInstance: 'https://remote.example', displayName: 'Unknown' },
        ],
      },
    };

    // Act
    const result = await processRelayEvents([event], 'https://remote.example', 'https://remote.example', testDb);

    // Assert
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.undeliverable).toEqual([
      { messageId: 'msg-1', reason: 'no_recipient' },
    ]);
    expect(cm.getFederatedCall(federatedId)).toBeUndefined();
  });

  it('Path A: zero connected local members → undeliverable, no entry created', async () => {
    const { processRelayEvents } = await importSUT();
    const cm = await importManager();

    // Arrange: local DM channel with federated_id matches; two local members, both offline
    const federatedId = 'fed-call-pathA-all-offline';
    const dmChannelId = 'dm-1';
    seedUser('bob-local');
    seedUser('alice-local');
    seedCaller();
    // A group of the caller's with two people here.
    testDb.insert(schema.dmChannels).values({
      id: dmChannelId,
      ownerId: CALLER_STUB,
      federatedId,
      createdAt: Date.now(),
    }).run();
    testDb.insert(schema.dmMembers).values([
      { dmChannelId, userId: 'bob-local' },
      { dmChannelId, userId: 'alice-local' },
      { dmChannelId, userId: CALLER_STUB },
    ]).run();

    // Stub: both users offline (zero WS connections)
    vi.spyOn(cm, 'getUserConnections').mockImplementation(() => new Set());

    const event = {
      eventType: 'dm_call_start' as const,
      messageId: 'msg-2',
      encryptionVersion: 0 as const,
      timestamp: Date.now(),
      federatedId,
      call: {
        livekitUrl: 'wss://lk.example',
        tokens: {
          'caller-home': 'tok-c',
          'bob-local': 'tok-b',
          'alice-local': 'tok-a',
        },
        caller: {
          homeUserId: 'caller-home',
          homeInstance: 'https://remote.example',
          displayName: 'Caller',
        },
        participants: [],
      },
    };

    const sendToUserSpy = vi.spyOn(cm, 'sendToUser');

    const result = await processRelayEvents([event], 'https://remote.example', 'https://remote.example', testDb);

    expect(result.accepted).toEqual([]);
    expect(result.undeliverable).toEqual([{ messageId: 'msg-2', reason: 'no_recipient' }]);
    // No dm_call_incoming dispatched to anyone
    expect(sendToUserSpy).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'dm_call_incoming' }),
    );
    // No FederatedCallEntry
    expect(cm.getFederatedCall(federatedId)).toBeUndefined();
  });

  it('Path A: mixed online + offline rings only connected members', async () => {
    const { processRelayEvents } = await importSUT();
    const cm = await importManager();

    const federatedId = 'fed-call-pathA-mixed';
    const dmChannelId = 'dm-2';
    seedUser('bob-local');
    seedUser('carol-local');
    seedCaller();
    testDb.insert(schema.dmChannels).values({
      id: dmChannelId,
      ownerId: CALLER_STUB,
      federatedId,
      createdAt: Date.now(),
    }).run();
    testDb.insert(schema.dmMembers).values([
      { dmChannelId, userId: 'bob-local' },
      { dmChannelId, userId: 'carol-local' },
      { dmChannelId, userId: CALLER_STUB },
    ]).run();

    // Bob online, Carol offline
    vi.spyOn(cm, 'getUserConnections').mockImplementation((uid: string) =>
      uid === 'bob-local' ? new Set(['fakews' as unknown as WebSocket]) : new Set(),
    );

    const sendToUserSpy = vi.spyOn(cm, 'sendToUser');

    const event = {
      eventType: 'dm_call_start' as const,
      messageId: 'msg-3',
      encryptionVersion: 0 as const,
      timestamp: Date.now(),
      federatedId,
      call: {
        livekitUrl: 'wss://lk.example',
        tokens: {
          'caller-home': 'tok-c',
          'bob-local': 'tok-b',
          'carol-local': 'tok-car',
        },
        caller: {
          homeUserId: 'caller-home',
          homeInstance: 'https://remote.example',
          displayName: 'Caller',
        },
        participants: [],
      },
    };

    const result = await processRelayEvents([event], 'https://remote.example', 'https://remote.example', testDb);

    expect(result.accepted).toEqual(['msg-3']);
    expect(result.undeliverable).toEqual([]);

    // Bob was rung
    expect(sendToUserSpy).toHaveBeenCalledWith(
      'bob-local',
      expect.objectContaining({ type: 'dm_call_incoming', livekitToken: 'tok-b' }),
    );
    // Carol was NOT rung (offline)
    expect(sendToUserSpy).not.toHaveBeenCalledWith(
      'carol-local',
      expect.anything(),
    );

    const entry = cm.getFederatedCall(federatedId);
    expect(entry).toBeDefined();
    expect(entry!.ringedUserIds).toEqual(['bob-local']);
  });

  /** A first call from a caller nobody here knows, to dana here, who is online. */
  function firstCallToDana(messageId: string, federatedId: string) {
    seedUser('dana-local');
    return {
      eventType: 'dm_call_start' as const,
      messageId,
      encryptionVersion: 0 as const,
      timestamp: Date.now(),
      federatedId,
      call: {
        livekitUrl: 'wss://lk.example',
        tokens: { 'caller-home': 'tok-c', 'dana-local': 'tok-d' },
        caller: {
          homeUserId: 'caller-home',
          homeInstance: 'https://remote.example',
          displayName: 'Friendly Caller',
        },
        participants: [
          { homeUserId: 'caller-home', homeInstance: 'https://remote.example', displayName: 'Friendly Caller' },
          { homeUserId: 'dana-local', homeInstance: 'https://local.example', displayName: 'Dana' },
        ],
      },
    };
  }

  it('a caller first met through a call is not named after their display name', async () => {
    const { processRelayEvents } = await importSUT();
    const cm = await importManager();
    const event = firstCallToDana('msg-name', 'fed-call-caller-name');
    // Dana takes a conversation from anyone, so a caller nobody here knows rings her.
    testDb.update(schema.users).set({ dmPolicy: 'anyone' }).where(eq(schema.users.id, 'dana-local')).run();
    vi.spyOn(cm, 'getUserConnections').mockImplementation((uid: string) =>
      uid === 'dana-local' ? new Set(['fakews' as unknown as WebSocket]) : new Set(),
    );

    const result = await processRelayEvents([event], 'https://remote.example', 'https://remote.example', testDb);
    expect(result.accepted).toEqual(['msg-name']);

    // The display name is not a handle: the row keeps the id-based name until
    // a real username for it arrives.
    const caller = testDb.select().from(schema.users).where(eq(schema.users.homeUserId, 'caller-home')).get();
    expect(caller?.username).toBe('caller-home@remote.example');
  });

  it('a call that rings nobody here makes no row for a caller nobody knows', async () => {
    const { processRelayEvents } = await importSUT();
    const cm = await importManager();
    // Dana is online, but takes a new conversation only from friends and people she shares a space with.
    const event = firstCallToDana('msg-stranger', 'fed-call-stranger');
    vi.spyOn(cm, 'getUserConnections').mockImplementation((uid: string) =>
      uid === 'dana-local' ? new Set(['fakews' as unknown as WebSocket]) : new Set(),
    );
    const sendToUserSpy = vi.spyOn(cm, 'sendToUser');

    const result = await processRelayEvents([event], 'https://remote.example', 'https://remote.example', testDb);

    expect(result.undeliverable).toEqual([{ messageId: 'msg-stranger', reason: 'no_recipient' }]);
    expect(sendToUserSpy).not.toHaveBeenCalledWith('dana-local', expect.anything());
    expect(testDb.select().from(schema.users).where(eq(schema.users.homeUserId, 'caller-home')).get()).toBeUndefined();
  });
});
