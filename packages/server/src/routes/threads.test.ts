import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { THREAD_ARCHIVE_AFTER_MS, THREAD_LIMITS, threadArchived } from '@backspace/shared/src/threads.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// A thread is a channel with its parent's rights: who may do what, and that no listing shows one.

setWorkerId(27);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ to: string; args: unknown[] }> }));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      sent.push({ to: String(name), args });
      if (name === 'getUserSpaceEntries') return [];
      return name === 'getRoomParticipants' ? new Set() : undefined;
    },
  }),
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
const OTHER = 'user-other';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const SECRET = 'channel-secret';
const VOICE = 'channel-voice';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { threadRoutes } = await import('./threads.js');
const { messageRoutes } = await import('./messages.js');
const { channelRoutes } = await import('./channels.js');

function addMessage(id: string, extra: Partial<typeof schema.messages.$inferInsert> = {}): void {
  testDb.insert(schema.messages).values({ id, channelId: CHANNEL, userId: MEMBER, content: `text of ${id}`, createdAt: 1, ...extra }).run();
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  for (const id of [OWNER, MEMBER, OTHER, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', slowmodeSeconds: 30, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: VOICE, spaceId: SPACE, name: 'lounge', type: 'voice', createdAt: 1 }).run();
  for (const id of [OWNER, MEMBER, OTHER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), position: 0, createdAt: 1 }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  addMessage('m1', { content: '**Plans** for ||secret|| Saturday\nsecond line' });
  app = Fastify();
  await app.register(threadRoutes);
  await app.register(messageRoutes);
  await app.register(channelRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const start = (messageId: string, userId: string, payload: Record<string, unknown> = {}) => app.inject({
  method: 'POST', url: `/api/messages/${messageId}/thread`, headers: headers(userId), payload,
});

describe('starting a thread', () => {
  it('makes a channel with its parent\'s facts, a name from the message without what a spoiler hides, and a follower', async () => {
    const res = await start('m1', MEMBER);
    expect(res.statusCode).toBe(201);
    const thread = res.json();
    expect(thread).toMatchObject({ parentChannelId: CHANNEL, starterMessageId: 'm1', createdBy: MEMBER, following: true, messageCount: 0, spaceId: SPACE });
    expect(thread.name).toBe('Plans for Saturday');
    const row = testDb.select().from(schema.channels).where(eq(schema.channels.id, thread.id)).get();
    expect(row).toMatchObject({ type: 'thread', slowmodeSeconds: 30 });
    const told = sent.find((entry) => entry.to === 'sendToChannel');
    expect(told?.args[1]).toBe(CHANNEL);
    expect(told?.args[2]).toMatchObject({ type: 'thread_updated', starterMessageId: 'm1' });
  });

  it('opens the one a message has instead of a second', async () => {
    const first = await start('m1', MEMBER);
    const again = await start('m1', OTHER);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
  });

  it('asks for the right, for that channel', async () => {
    testDb.update(schema.roles).set({ permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS & ~PermissionBits.CREATE_THREADS) }).where(eq(schema.roles.id, SPACE)).run();
    const refused = await start('m1', MEMBER);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().details).toEqual({ permission: 'CREATE_THREADS' });
    expect((await start('m1', OUTSIDER)).statusCode).toBe(403);
  });

  it('refuses a system line, a voice channel\'s chat, and a thread inside a thread', async () => {
    addMessage('line', { type: 'system', content: '{}' });
    expect((await start('line', MEMBER)).json().code).toBe('system_message_immutable');
    addMessage('in-voice', { channelId: VOICE });
    expect((await start('in-voice', MEMBER)).json().code).toBe('thread_not_allowed');
    const { id } = (await start('m1', MEMBER)).json();
    addMessage('inner', { channelId: id });
    expect((await start('inner', MEMBER)).json().code).toBe('thread_not_allowed');
  });

  it('holds a name to the limit, and a timed out member to their timeout', async () => {
    expect((await start('m1', MEMBER, { name: 'x'.repeat(THREAD_LIMITS.NAME_MAX_LENGTH + 1) })).json().code).toBe('validation_failed');
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 }).where(eq(schema.spaceMembers.userId, MEMBER)).run();
    expect((await start('m1', MEMBER)).json().code).toBe('member_timed_out');
  });
});

describe('a thread\'s rights', () => {
  it('are its parent\'s, for reading and writing', async () => {
    const { id } = (await start('m1', MEMBER)).json();
    const read = (userId: string) => app.inject({ method: 'GET', url: `/api/channels/${id}/messages`, headers: headers(userId) });
    expect((await read(OTHER)).statusCode).toBe(200);
    expect((await read(OUTSIDER)).statusCode).toBe(403);
    const write = await app.inject({ method: 'POST', url: `/api/channels/${id}/messages`, headers: headers(OTHER), payload: { content: 'in the thread' } });
    expect(write.statusCode).toBe(201);
    expect(write.json().channelId).toBe(id);

    // Close the parent to everyone: the thread closes with it.
    testDb.insert(schema.channelOverrides).values({
      channelId: CHANNEL, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
    }).run();
    expect((await read(OTHER)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/threads/${id}`, headers: headers(OTHER) })).statusCode).toBe(403);
  });
});

describe('threads and channels', () => {
  it('leaves threads out of a space\'s channels', async () => {
    const { id } = (await start('m1', MEMBER)).json();
    const list = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/channels`, headers: headers(OWNER) });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((c: { id: string }) => c.id)).not.toContain(id);
  });

  it('keeps a channel\'s routes away from a thread', async () => {
    const { id } = (await start('m1', MEMBER)).json();
    expect((await app.inject({ method: 'PATCH', url: `/api/channels/${id}`, headers: headers(OWNER), payload: { name: 'renamed' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/channels/${id}`, headers: headers(OWNER) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/channels/${id}/overrides`, headers: headers(OWNER) })).statusCode).toBe(404);
  });

  it('goes with its channel, and outlives the message it grew from', async () => {
    const { id } = (await start('m1', MEMBER)).json();
    testDb.insert(schema.messages).values({ id: 'inner', channelId: id, userId: MEMBER, content: 'hello', createdAt: 2 }).run();

    const removed = await app.inject({ method: 'DELETE', url: '/api/messages/m1', headers: headers(MEMBER) });
    expect(removed.statusCode).toBe(200);
    expect(testDb.select().from(schema.channels).where(eq(schema.channels.id, id)).get()).toMatchObject({ threadStarterMessageId: null });
    const opened = await app.inject({ method: 'GET', url: `/api/threads/${id}`, headers: headers(OTHER) });
    expect(opened.json().starter).toBeNull();

    const gone = await app.inject({ method: 'DELETE', url: `/api/channels/${CHANNEL}`, headers: headers(OWNER) });
    expect(gone.statusCode).toBe(200);
    expect(testDb.select().from(schema.channels).where(eq(schema.channels.id, id)).get()).toBeUndefined();
    expect(testDb.select().from(schema.messages).where(eq(schema.messages.id, 'inner')).get()).toBeUndefined();
  });
});

describe('what a message shows', () => {
  it('has the thread\'s name and how much was said, for everyone reading the channel', async () => {
    const { id } = (await start('m1', MEMBER, { name: 'Saturday' })).json();
    testDb.insert(schema.messages).values({ id: 'inner', channelId: id, userId: OTHER, content: 'count me in', createdAt: 5 }).run();
    testDb.insert(schema.messages).values({ id: 'line', channelId: id, userId: OTHER, type: 'system', content: '{}', createdAt: 6 }).run();
    const history = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/messages`, headers: headers(OTHER) });
    const starter = (history.json() as Array<{ id: string; thread?: unknown }>).find((m) => m.id === 'm1');
    expect(starter?.thread).toEqual({ id, name: 'Saturday', messageCount: 1, lastMessageAt: 5 });
  });
});

describe('a channel\'s list', () => {
  const list = (query = '') => app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/threads${query}`, headers: headers(OTHER) });

  it('shows what is active, the latest first, and what went quiet under archived', async () => {
    addMessage('m2');
    const quiet = (await start('m1', MEMBER, { name: 'Old one' })).json();
    const live = (await start('m2', MEMBER, { name: 'New one' })).json();
    const longAgo = Date.now() - THREAD_ARCHIVE_AFTER_MS - 1000;
    testDb.update(schema.channels).set({ createdAt: longAgo }).where(eq(schema.channels.id, quiet.id)).run();

    expect((await list()).json().threads.map((t: { id: string }) => t.id)).toEqual([live.id]);
    expect((await list('?archived=1')).json().threads.map((t: { id: string }) => t.id)).toEqual([quiet.id]);

    // A new message brings it back: going quiet is worked out, nothing was closed.
    testDb.insert(schema.messages).values({ id: 'back', channelId: quiet.id, userId: OTHER, content: 'still here', createdAt: Date.now() }).run();
    expect((await list()).json().threads.map((t: { id: string }) => t.id)).toEqual([quiet.id, live.id]);
  });

  it('is closed to those who cannot read the channel', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/threads`, headers: headers(OUTSIDER) });
    expect(res.statusCode).toBe(403);
  });

  it('works out going quiet from the last message', () => {
    const now = 10 * THREAD_ARCHIVE_AFTER_MS;
    expect(threadArchived({ lastMessageAt: now - 1, createdAt: 0 }, now)).toBe(false);
    expect(threadArchived({ lastMessageAt: now - THREAD_ARCHIVE_AFTER_MS - 1, createdAt: now }, now)).toBe(true);
    expect(threadArchived({ lastMessageAt: null, createdAt: now - 1 }, now)).toBe(false);
  });
});

describe('following', () => {
  it('is each person\'s own', async () => {
    const { id } = (await start('m1', MEMBER)).json();
    const followers = () => testDb.select().from(schema.threadMembers).where(eq(schema.threadMembers.threadId, id)).all().map((row) => row.userId).sort();
    expect(followers()).toEqual([MEMBER]);
    expect((await app.inject({ method: 'PUT', url: `/api/threads/${id}/follow`, headers: headers(OTHER) })).json().following).toBe(true);
    expect(followers()).toEqual([MEMBER, OTHER].sort());
    expect((await app.inject({ method: 'DELETE', url: `/api/threads/${id}/follow`, headers: headers(MEMBER) })).json().following).toBe(false);
    expect(followers()).toEqual([OTHER]);
    expect((await app.inject({ method: 'PUT', url: `/api/threads/${id}/follow`, headers: headers(OUTSIDER) })).statusCode).toBe(403);
  });

  // Unfollowing answered with the thread's name, its channel and its last message to anyone who knew the id.
  it('tells someone who cannot read a thread nothing about it when they unfollow', async () => {
    const { id } = (await start('m1', MEMBER, { name: 'Raid plans' })).json();
    const res = await app.inject({ method: 'DELETE', url: `/api/threads/${id}/follow`, headers: headers(OUTSIDER) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id });
    expect(res.body).not.toContain('Raid plans');
    // Someone who can read it still gets what it is.
    const own = await app.inject({ method: 'DELETE', url: `/api/threads/${id}/follow`, headers: headers(MEMBER) });
    expect(own.json()).toMatchObject({ id, name: 'Raid plans', following: false });
  });
});

describe('renaming and deleting', () => {
  it('is for who started it, or someone who may manage the channel\'s messages', async () => {
    const { id } = (await start('m1', MEMBER)).json();
    const rename = (userId: string, name: string) => app.inject({ method: 'PATCH', url: `/api/threads/${id}`, headers: headers(userId), payload: { name } });
    expect((await rename(OTHER, 'Mine now')).statusCode).toBe(403);
    expect((await rename(MEMBER, 'Better name')).json().name).toBe('Better name');
    expect((await rename(OWNER, 'Even better')).json().name).toBe('Even better');
    expect((await app.inject({ method: 'DELETE', url: `/api/threads/${id}`, headers: headers(OTHER) })).statusCode).toBe(403);
  });

  it('takes everything said in it, keeps the message it grew from, and logs it', async () => {
    const { id } = (await start('m1', MEMBER)).json();
    testDb.insert(schema.messages).values({ id: 'inner', channelId: id, userId: OTHER, content: 'hello', createdAt: 2 }).run();
    testDb.insert(schema.readStates).values({ userId: OTHER, channelId: id, lastReadMessageId: 'inner', updatedAt: 1 }).run();
    const res = await app.inject({ method: 'DELETE', url: `/api/threads/${id}`, headers: headers(MEMBER) });
    expect(res.statusCode).toBe(200);
    expect(testDb.select().from(schema.channels).where(eq(schema.channels.id, id)).get()).toBeUndefined();
    expect(testDb.select().from(schema.messages).where(eq(schema.messages.id, 'inner')).get()).toBeUndefined();
    expect(testDb.select().from(schema.messages).where(eq(schema.messages.id, 'm1')).get()).toBeDefined();
    expect(testDb.select().from(schema.readStates).all()).toEqual([]);
    expect(sent.some((entry) => (entry.args[2] as { type?: string } | undefined)?.type === 'thread_deleted')).toBe(true);
    expect(testDb.select().from(schema.spaceAuditLog).all().map((row) => row.action)).toEqual(['thread_create', 'thread_delete']);
  });
});
