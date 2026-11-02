import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { MAX_PINS_PER_CHANNEL, type FederationRelayEvent } from '@backspace/shared';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Who may pin what, what a pin leaves behind, and a conversation's pin arriving from a peer.

setWorkerId(23);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const sentToChannel = vi.fn();
const sentToDm = vi.fn();

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToSpace: vi.fn(),
    sendToChannel: (...args: unknown[]) => sentToChannel(...args),
    sendToDmMembers: (...args: unknown[]) => sentToDm(...args),
  },
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const PINNER = 'user-pinner';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const DM = 'dm-1';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

function addMessage(id: string, extra: Partial<typeof schema.messages.$inferInsert> = {}): void {
  testDb.insert(schema.messages).values({ id, channelId: CHANNEL, userId: MEMBER, content: `text of ${id}`, createdAt: 1, ...extra }).run();
}

function addDmMessage(id: string, extra: Partial<typeof schema.dmMessages.$inferInsert> = {}): void {
  testDb.insert(schema.dmMessages).values({ id, dmChannelId: DM, userId: MEMBER, content: `text of ${id}`, createdAt: 1, ...extra }).run();
}

const storedMessage = (id: string) => testDb.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
const storedDmMessage = (id: string) => testDb.select().from(schema.dmMessages).where(eq(schema.dmMessages.id, id)).get();
const pin = (id: string, userId: string) => app.inject({ method: 'PUT', url: `/api/messages/${id}/pin`, headers: headers(userId) });
const unpin = (id: string, userId: string) => app.inject({ method: 'DELETE', url: `/api/messages/${id}/pin`, headers: headers(userId) });

const { pinRoutes } = await import('./pins.js');
const { processPinSetEvent } = await import('./federation/events/dmMessages.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sentToChannel.mockClear();
  sentToDm.mockClear();
  for (const id of [OWNER, MEMBER, PINNER, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  for (const id of [OWNER, MEMBER, PINNER]) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  }
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), position: 0, createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-pin', spaceId: SPACE, name: 'Pins', permissions: permissionsToString(PermissionBits.PIN_MESSAGES), position: 1, createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: PINNER, roleId: 'role-pin' }).run();
  testDb.insert(schema.dmChannels).values({ id: DM, createdAt: 1 }).run();
  for (const id of [OWNER, MEMBER]) {
    testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: id }).run();
  }
  app = Fastify();
  await app.register(pinRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('pinning in a channel', () => {
  it('takes the right: a member without it cannot, someone holding it or managing messages can', async () => {
    addMessage('m1');
    const refused = await pin('m1', MEMBER);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'PIN_MESSAGES' } });
    expect(storedMessage('m1')?.pinnedAt).toBeNull();

    expect((await pin('m1', OUTSIDER)).statusCode).toBe(403);
    expect((await pin('m1', PINNER)).statusCode).toBe(200);
    expect(storedMessage('m1')).toMatchObject({ pinnedBy: PINNER });
    expect((await unpin('m1', OWNER)).statusCode).toBe(200);
    expect(storedMessage('m1')).toMatchObject({ pinnedAt: null, pinnedBy: null });
  });

  it('tells the channel, leaves one passive line and writes the audit log', async () => {
    addMessage('m1');
    await pin('m1', PINNER);

    const events = sentToChannel.mock.calls.map((call) => call[2] as { type: string; message?: { type: string; content: string } });
    expect(events[0]).toMatchObject({ type: 'message_pin_changed', channelId: CHANNEL, messageId: 'm1', pinnedBy: PINNER });
    expect(events[1]?.type).toBe('message_created');
    expect(events[1]?.message?.type).toBe('system');
    expect(JSON.parse(events[1]?.message?.content ?? '{}')).toEqual({ event: 'message_pinned', messageId: 'm1' });

    const actions = testDb.select().from(schema.spaceAuditLog).all().map((row) => row.action);
    expect(actions).toEqual(['message_pin']);
  });

  it('changes nothing when pinned twice or unpinned twice', async () => {
    addMessage('m1');
    await pin('m1', PINNER);
    const first = storedMessage('m1')?.pinnedAt;
    sentToChannel.mockClear();
    const again = await pin('m1', PINNER);
    expect(again.statusCode).toBe(200);
    expect(again.json().pinnedAt).toBe(first);
    expect(sentToChannel).not.toHaveBeenCalled();
    await unpin('m1', PINNER);
    sentToChannel.mockClear();
    expect((await unpin('m1', PINNER)).statusCode).toBe(200);
    expect(sentToChannel).not.toHaveBeenCalled();
  });

  it('refuses a system line and a timed out member, and holds the limit', async () => {
    addMessage('line', { type: 'system', content: '{}' });
    expect((await pin('line', PINNER)).json().code).toBe('system_message_immutable');

    addMessage('m1');
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 }).where(eq(schema.spaceMembers.userId, PINNER)).run();
    expect((await pin('m1', PINNER)).json().code).toBe('member_timed_out');
    testDb.update(schema.spaceMembers).set({ timedOutUntil: null }).where(eq(schema.spaceMembers.userId, PINNER)).run();

    for (let i = 0; i < MAX_PINS_PER_CHANNEL; i += 1) addMessage(`full-${i}`, { pinnedAt: i + 1, pinnedBy: OWNER });
    const full = await pin('m1', PINNER);
    expect(full.statusCode).toBe(400);
    expect(full.json()).toMatchObject({ code: 'pin_limit_reached', details: { max: MAX_PINS_PER_CHANNEL } });
  });

  it('lists the latest pin first, for those who may read the channel', async () => {
    addMessage('older', { pinnedAt: 10, pinnedBy: OWNER });
    addMessage('newer', { pinnedAt: 20, pinnedBy: OWNER });
    addMessage('plain');
    const list = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/pins`, headers: headers(MEMBER) });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((m: { id: string }) => m.id)).toEqual(['newer', 'older']);
    expect(list.json()[0].pinnedAt).toBe(20);
    expect((await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/pins`, headers: headers(OUTSIDER) })).statusCode).toBe(403);
  });
});

describe('pinning in a conversation', () => {
  const pinDm = (id: string, userId: string) => app.inject({ method: 'PUT', url: `/api/dm/messages/${id}/pin`, headers: headers(userId) });

  it('is open to its members and closed to everyone else', async () => {
    addDmMessage('d1');
    expect((await pinDm('d1', OUTSIDER)).json().code).toBe('not_dm_member');
    expect((await app.inject({ method: 'GET', url: `/api/dm/${DM}/pins`, headers: headers(OUTSIDER) })).statusCode).toBe(403);

    expect((await pinDm('d1', OWNER)).statusCode).toBe(200);
    expect(storedDmMessage('d1')).toMatchObject({ pinnedBy: OWNER });
    expect(sentToDm.mock.calls[0]?.[1]).toMatchObject({ type: 'message_pin_changed', channelId: DM, messageId: 'd1' });

    const list = await app.inject({ method: 'GET', url: `/api/dm/${DM}/pins`, headers: headers(MEMBER) });
    expect(list.json().map((m: { id: string }) => m.id)).toEqual(['d1']);

    const off = await app.inject({ method: 'DELETE', url: `/api/dm/messages/d1/pin`, headers: headers(MEMBER) });
    expect(off.statusCode).toBe(200);
    expect(storedDmMessage('d1')).toMatchObject({ pinnedAt: null, pinnedBy: null });
  });

  it('refuses a system line', async () => {
    addDmMessage('line', { type: 'system' });
    expect((await pinDm('line', OWNER)).json().code).toBe('system_message_immutable');
  });
});

describe('a conversation pin from a peer', () => {
  const PEER = 'https://peer.example';
  const PEER_USER = 'user-remote';
  const PEER_HOME_ID = 'remote-home-id';

  const relayed = (at: number, pinned = true, extra: Partial<NonNullable<FederationRelayEvent['pin']>> = {}): FederationRelayEvent => ({
    eventType: 'pin_set',
    dmChannelId: DM,
    messageId: `relay-${at}`,
    encryptionVersion: 0,
    timestamp: at,
    pin: { messageId: 'source-id', messageHomeInstance: PEER, userId: PEER_HOME_ID, homeUserId: PEER_HOME_ID, homeInstance: PEER, pinned, at, ...extra },
  });

  const deliver = (event: FederationRelayEvent) => {
    const accepted: string[] = [];
    const rejected: Array<{ messageId: string; reason: string }> = [];
    processPinSetEvent(event, PEER, testDb, accepted, rejected);
    return { accepted, rejected };
  };

  beforeEach(() => {
    testDb.insert(schema.users).values({ id: PEER_USER, username: 'remote@peer.example', passwordHash: 'x', homeInstance: PEER, homeUserId: PEER_HOME_ID, createdAt: 1 }).run();
    testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: PEER_USER }).run();
    addDmMessage('copy', { userId: PEER_USER, sourceInstance: PEER, sourceMessageId: 'source-id' });
  });

  it('sets the state, under the local row of the person who did it', () => {
    expect(deliver(relayed(100))).toEqual({ accepted: ['relay-100'], rejected: [] });
    expect(storedDmMessage('copy')).toMatchObject({ pinnedAt: 100, pinnedBy: PEER_USER, pinChangedAt: 100 });
    expect(sentToDm.mock.calls[0]?.[1]).toMatchObject({ type: 'message_pin_changed', messageId: 'copy', pinnedAt: 100 });
  });

  it('does not let an older state replace a newer one', () => {
    deliver(relayed(200, false));
    expect(deliver(relayed(100, true)).accepted).toEqual(['relay-100']);
    expect(storedDmMessage('copy')).toMatchObject({ pinnedAt: null, pinChangedAt: 200 });
  });

  it('refuses someone outside the conversation, and a claim about a stranger', () => {
    testDb.delete(schema.dmMembers).where(eq(schema.dmMembers.userId, PEER_USER)).run();
    const outside = deliver(relayed(100));
    expect(outside.accepted).toEqual([]);
    expect(outside.rejected).toHaveLength(1);
    expect(storedDmMessage('copy')?.pinnedAt).toBeNull();

    testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: PEER_USER }).run();
    const claimed = deliver(relayed(100, true, { homeInstance: 'https://elsewhere.example' }));
    expect(claimed.accepted).toEqual([]);
    expect(storedDmMessage('copy')?.pinnedAt).toBeNull();
  });
});
