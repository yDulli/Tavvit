import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { matchesKeyword, isMessageAlert, cleanKeyword, KEYWORD_LIMITS } from '@backspace/shared/src/notificationRules.js';
import { SAVED_LIMITS } from '@backspace/shared/src/saved.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// A person's own list, and what alerts them: who can save what, what a reminder may say and when,
// and that a keyword goes through the one rule for sound, notification and push.

setWorkerId(31);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const { sent, pushed } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; args: unknown[] }>,
  pushed: [] as Array<{ userId: string; itemId: string }>,
}));

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

vi.mock('../utils/pushDelivery.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/pushDelivery.js')>();
  return {
    ...real,
    pushSavedReminder: (userId: string, item: { id: string }) => {
      pushed.push({ userId, itemId: item.id });
    },
  };
});

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const READER = 'user-reader';
const AUTHOR = 'user-author';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const SECRET = 'channel-secret';
const DM = 'dm-1';
const OTHERS_DM = 'dm-2';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { savedRoutes } = await import('./saved.js');
const { keywordRoutes } = await import('./keywords.js');
const { sendDueSavedReminders } = await import('../utils/savedReminders.js');

function addMessage(id: string, channelId = CHANNEL, content = `text of ${id}`, userId = AUTHOR): void {
  testDb.insert(schema.messages).values({ id, channelId, userId, content, createdAt: 1 }).run();
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  pushed.length = 0;
  for (const id of [READER, AUTHOR, OUTSIDER]) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: AUTHOR, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', createdAt: 1 }).run();
  for (const id of [READER, AUTHOR]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  testDb.insert(schema.dmChannels).values({ id: DM, createdAt: 1 }).run();
  testDb.insert(schema.dmChannels).values({ id: OTHERS_DM, createdAt: 1 }).run();
  for (const id of [READER, AUTHOR]) testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: id }).run();
  testDb.insert(schema.dmMembers).values({ dmChannelId: OTHERS_DM, userId: AUTHOR }).run();
  addMessage('m1');
  addMessage('m2');
  addMessage('hidden', SECRET);
  testDb.insert(schema.dmMessages).values({ id: 'd1', dmChannelId: DM, userId: AUTHOR, content: 'private words', createdAt: 1 }).run();
  testDb.insert(schema.dmMessages).values({ id: 'd2', dmChannelId: OTHERS_DM, userId: AUTHOR, content: 'not yours', createdAt: 1 }).run();
  app = Fastify();
  await app.register(savedRoutes);
  await app.register(keywordRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const save = (id: string, userId = READER, payload: Record<string, unknown> = {}, kind = 'messages') => app.inject({
  method: 'PUT', url: `/api/saved/${kind}/${id}`, headers: headers(userId), payload,
});
const list = (userId = READER, query = '') => app.inject({ method: 'GET', url: `/api/saved${query}`, headers: headers(userId) });

describe('saving a message', () => {
  it('works for what a person can see, in a channel and in a conversation', async () => {
    const channel = await save('m1');
    expect(channel.statusCode).toBe(200);
    expect(channel.json()).toMatchObject({ kind: 'channel', channelId: CHANNEL, spaceId: SPACE, remindAt: null, message: { id: 'm1' } });
    const dm = await save('d1', READER, {}, 'dm-messages');
    expect(dm.statusCode).toBe(200);
    expect(dm.json()).toMatchObject({ kind: 'dm', channelId: DM, spaceId: null, message: { id: 'd1', content: 'private words' } });
    expect(sent.filter((entry) => entry.to === 'sendToUser').map((entry) => entry.args[0])).toEqual([READER, READER]);
  });

  it('refuses what they cannot see, the same as what does not exist', async () => {
    for (const [id, kind, userId] of [['hidden', 'messages', READER], ['m1', 'messages', OUTSIDER], ['d2', 'dm-messages', READER], ['nope', 'messages', READER]] as const) {
      const res = await save(id, userId, {}, kind);
      expect(res.statusCode, `${kind}/${id}`).toBe(404);
      expect(res.json().code).toBe('message_not_found');
    }
    expect(testDb.select().from(schema.savedMessages).all()).toEqual([]);
  });

  it('counts a message once, and keeps its reminder when saved again', async () => {
    const at = Date.now() + 3_600_000;
    await save('m1', READER, { remindAt: at });
    await save('m1');
    const rows = testDb.select().from(schema.savedMessages).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.remindAt).toBe(at);
    expect((await save('m1', READER, { remindAt: null })).json().remindAt).toBeNull();
  });

  it('stops at the limit', async () => {
    for (let i = 0; i < SAVED_LIMITS.PER_ACCOUNT; i += 1) {
      addMessage(`bulk-${i}`);
      testDb.insert(schema.savedMessages).values({ id: `s${i}`, userId: READER, messageId: `bulk-${i}`, createdAt: 1 }).run();
    }
    const res = await save('m1');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('saved_limit_reached');
  });

  it('refuses a reminder that is not a time ahead', async () => {
    const now = Date.now();
    for (const remindAt of ['tomorrow', now - 1000, now + SAVED_LIMITS.REMIND_WITHIN_MS + 60_000]) {
      expect((await save('m1', READER, { remindAt })).statusCode).toBe(400);
    }
  });

  it('goes with the message, and is each person\'s own', async () => {
    await save('m1');
    await save('m1', AUTHOR);
    testDb.delete(schema.messages).where(eq(schema.messages.id, 'm1')).run();
    expect(testDb.select().from(schema.savedMessages).all()).toEqual([]);

    await save('m2');
    const removed = await app.inject({ method: 'DELETE', url: '/api/saved/messages/m2', headers: headers(AUTHOR) });
    expect(removed.statusCode).toBe(200);
    expect(testDb.select().from(schema.savedMessages).all()).toHaveLength(1);
    await app.inject({ method: 'DELETE', url: '/api/saved/messages/m2', headers: headers(READER) });
    expect(testDb.select().from(schema.savedMessages).all()).toEqual([]);
  });
});

describe('reading the list', () => {
  it('shows only what the person can still see', async () => {
    await save('m1');
    await save('m2');
    await save('d1', READER, {}, 'dm-messages');
    expect((await list()).json().items.map((item: { message: { id: string } }) => item.message.id)).toEqual(['d1', 'm2', 'm1']);
    expect((await app.inject({ method: 'GET', url: '/api/saved/ids', headers: headers(READER) })).json().messageIds.sort()).toEqual(['d1', 'm1', 'm2']);

    testDb.insert(schema.channelOverrides).values({
      channelId: CHANNEL, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.READ_MESSAGE_HISTORY),
    }).run();
    testDb.delete(schema.dmMembers).where(eq(schema.dmMembers.userId, READER)).run();
    expect((await list()).json().items).toEqual([]);
    expect((await list(AUTHOR)).json().items).toEqual([]);
  });

  it('comes in pages that do not repeat', async () => {
    for (let i = 0; i < SAVED_LIMITS.PAGE + 5; i += 1) {
      addMessage(`p-${i}`);
      await save(`p-${i}`);
    }
    const first = (await list()).json();
    expect(first.items).toHaveLength(SAVED_LIMITS.PAGE);
    expect(first.nextBefore).toBeTruthy();
    const second = (await list(READER, `?before=${first.nextBefore}`)).json();
    expect(second.items).toHaveLength(5);
    expect(second.nextBefore).toBeNull();
    const ids = [...first.items, ...second.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await list(READER, '?before=abc')).statusCode).toBe(400);
  });
});

describe('a reminder', () => {
  const remindIn = async (id: string, ms: number) => {
    await save(id, READER, { remindAt: Date.now() + ms });
    return Date.now() + ms;
  };
  const toldOverSocket = () => sent.filter((entry) => entry.to === 'sendToUser' && (entry.args[1] as { type: string }).type === 'saved_reminder');

  it('comes once when it is due, and not before', async () => {
    const at = await remindIn('m1', 60_000);
    expect(sendDueSavedReminders(at - 30_000)).toBe(0);
    expect(toldOverSocket()).toEqual([]);

    expect(sendDueSavedReminders(at + 1000)).toBe(1);
    expect(toldOverSocket()[0]?.args[0]).toBe(READER);
    expect(toldOverSocket()[0]?.args[1]).toMatchObject({ type: 'saved_reminder', preview: 'text of m1', item: { message: { id: 'm1' } } });
    expect(pushed).toHaveLength(1);

    expect(sendDueSavedReminders(at + 120_000)).toBe(0);
    expect(toldOverSocket()).toHaveLength(1);
  });

  it('asks again whether they can see it, and says nothing if not', async () => {
    const at = await remindIn('m1', 60_000);
    testDb.delete(schema.spaceMembers).where(eq(schema.spaceMembers.userId, READER)).run();
    expect(sendDueSavedReminders(at + 1000)).toBe(0);
    expect(toldOverSocket()).toEqual([]);
    expect(pushed).toEqual([]);
    expect(testDb.select().from(schema.savedMessages).all()[0]?.reminderSentAt).not.toBeNull();
  });

  it('can be set again after it came', async () => {
    const at = await remindIn('m1', 60_000);
    sendDueSavedReminders(at + 1000);
    const again = await remindIn('m1', 120_000);
    expect(sendDueSavedReminders(again + 1000)).toBe(1);
  });
});

describe('keywords', () => {
  const put = (keywords: unknown, userId = READER) => app.inject({ method: 'PUT', url: '/api/users/@me/keywords', headers: headers(userId), payload: { keywords } });
  const matches = (userId = READER) => app.inject({ method: 'GET', url: '/api/users/@me/keyword-matches', headers: headers(userId) });

  it('are a person\'s own, cleaned, without repeats, within the limit', async () => {
    const res = await put(['  Raid ', 'raid', 'night shift']);
    expect(res.statusCode).toBe(200);
    expect(res.json().keywords).toEqual(['raid', 'night shift']);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me/keywords', headers: headers(READER) })).json().keywords).toEqual(['raid', 'night shift']);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me/keywords', headers: headers(AUTHOR) })).json().keywords).toEqual([]);

    const tooMany = await put(Array.from({ length: KEYWORD_LIMITS.MAX + 1 }, (_, i) => `word${i}`));
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().code).toBe('keyword_limit_reached');
    for (const bad of ['x', '', 7, 'y'.repeat(KEYWORD_LIMITS.MAX_LENGTH + 1)]) {
      expect((await put([bad])).statusCode).toBe(400);
    }
    expect((await put('raid')).statusCode).toBe(400);
    expect((await put([])).json().keywords).toEqual([]);
  });

  it('find whole words, in any case, in any alphabet, outside code', () => {
    const words = ['raid', 'c++', 'ночь', '夜班'];
    for (const text of ['Raid tonight?', 'the RAID.', '(raid)', 'I love c++ a lot', 'Ночь близко', '今晚夜班见', 'raid\nnext']) {
      expect(matchesKeyword(text, words), text).toBe(true);
    }
    for (const text of ['afraid of this', 'raiders', 'raid_team', '`raid`', '```\nraid\n```', '', null]) {
      expect(matchesKeyword(text, words), String(text)).toBe(false);
    }
    expect(matchesKeyword('anything', [])).toBe(false);
    expect(cleanKeyword('  Night Shift ')).toBe('night shift');
    expect(cleanKeyword('a')).toBeNull();
  });

  it('alert through the one rule, where a mention would and nowhere else', () => {
    const input = {
      authoredBySelf: false, isDmChannel: false, allChannels: false, myId: READER, content: 'raid tonight', keywords: ['raid'],
    };
    expect(isMessageAlert({ ...input, notification: { level: 'mentions', muted: false } })).toBe(true);
    expect(isMessageAlert({ ...input, keywords: [], notification: { level: 'mentions', muted: false } })).toBe(false);
    expect(isMessageAlert({ ...input, notification: { level: 'nothing', muted: false } })).toBe(false);
    expect(isMessageAlert({ ...input, notification: { level: 'mentions', muted: true } })).toBe(false);
    expect(isMessageAlert({ ...input, authoredBySelf: true, notification: { level: 'mentions', muted: false } })).toBe(false);
  });

  it('list their matches from what the person can read, and not their own', async () => {
    await put(['raid']);
    addMessage('hit', CHANNEL, 'Raid tonight');
    addMessage('near', CHANNEL, 'afraid of this');
    addMessage('secret-hit', SECRET, 'raid in here');
    addMessage('mine', CHANNEL, 'my raid', READER);
    const res = await matches();
    expect(res.statusCode).toBe(200);
    expect(res.json().mentions.map((item: { message: { id: string }; via: string }) => [item.message.id, item.via])).toEqual([['hit', 'keyword']]);
    expect((await matches(AUTHOR)).json().mentions).toEqual([]);
  });
});
