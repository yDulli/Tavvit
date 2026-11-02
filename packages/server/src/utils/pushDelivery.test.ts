import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { DmMessageWithUser, MessageWithUser, User } from '@backspace/shared';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';

// Who gets a push for what: the same rule as an open client, from what the server holds.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

const { pushed } = vi.hoisted(() => ({
  pushed: [] as Array<{ userId: string; payload: { title: string; body: string; tag: string; url: string } }>,
}));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('./webPush.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./webPush.js')>(),
  sendWebPush: async (device: { userId: string }, payload: { title: string; body: string; tag: string; url: string }) => {
    pushed.push({ userId: device.userId, payload });
    return 'sent';
  },
}));

const { _forTests, _resetVapidKeys, getVapidKeys, pushBodyOf } = await import('./pushDelivery.js');

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const AUTHOR = 'user-author';
const READER = 'user-reader';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const DM = 'dm-1';
const NOBODY_FOCUSED = () => false;

const author = { id: AUTHOR, username: 'mara', displayName: 'Mara' } as unknown as User;

function channelMessage(extra: Partial<MessageWithUser> = {}): MessageWithUser {
  return {
    id: 'm1', channelId: CHANNEL, userId: AUTHOR, replyToId: null, content: 'hello', editedAt: null, createdAt: 1,
    user: author, attachments: [], embeds: [], reactions: [], ...extra,
  };
}

function dmMessage(extra: Partial<DmMessageWithUser> = {}): DmMessageWithUser {
  return {
    id: 'd1', dmChannelId: DM, userId: AUTHOR, content: 'hello', createdAt: 1,
    user: author, attachments: [], embeds: [], reactions: [], ...extra,
  };
}

function addDevice(userId: string, extra: Partial<typeof schema.pushSubscriptions.$inferInsert> = {}): void {
  testDb.insert(schema.pushSubscriptions).values({
    id: `device-${userId}-${Math.random()}`, userId, endpoint: `https://fcm.googleapis.com/fcm/send/${userId}-${Math.random()}`,
    p256dh: 'p', auth: 'a', createdAt: 1, ...extra,
  }).run();
}

function setLevel(level: string | null, extra: Partial<typeof schema.notificationSettings.$inferInsert> = {}): void {
  testDb.insert(schema.notificationSettings).values({ id: `set-${Math.random()}`, userId: READER, spaceId: SPACE, level, updatedAt: 1, ...extra } as typeof schema.notificationSettings.$inferInsert).run();
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  _resetVapidKeys();
  pushed.length = 0;
  for (const [id, username] of [[AUTHOR, 'mara'], [READER, 'noor']] as const) {
    testDb.insert(schema.users).values({ id, username, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: AUTHOR, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  for (const id of [AUTHOR, READER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), position: 0, createdAt: 1 }).run();
  testDb.insert(schema.dmChannels).values({ id: DM, createdAt: 1 }).run();
  for (const id of [AUTHOR, READER]) testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: id }).run();
  addDevice(READER);
});

afterEach(() => {
  sqlite.close();
});

const channelPush = (message: MessageWithUser, focused: (id: string) => boolean = NOBODY_FOCUSED) => {
  _forTests.pushChannelMessageNow(SPACE, message, focused);
};

describe('a message in a channel', () => {
  it('alerts someone mentioned, by the default level, and says where it goes', () => {
    channelPush(channelMessage({ content: `<@${READER}> look` }));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      userId: READER,
      payload: { title: 'Mara · #general', body: '@noor look', tag: `channel:${CHANNEL}`, url: `/channels/${SPACE}/${CHANNEL}?message=m1` },
    });
  });

  it('does not alert anyone for a plain message at the default level', () => {
    channelPush(channelMessage());
    expect(pushed).toHaveLength(0);
  });

  const everyMessage = () => setLevel('all');
  const sent = () => pushed.length;

  it('follows the level the person chose for the space, and for the channel over it', () => {
    everyMessage();
    channelPush(channelMessage());
    expect(sent()).toBe(1);
  });

  it('holds back for someone who muted it, even a mention', () => {
    setLevel('all', { muted: 1 });
    channelPush(channelMessage({ id: 'm2', content: `<@${READER}> look` }));
    expect(sent()).toBe(0);
  });

  it('holds back for someone who cannot see the channel', () => {
    everyMessage();
    testDb.insert(schema.channelOverrides).values({ channelId: CHANNEL, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL) }).run();
    channelPush(channelMessage());
    expect(sent()).toBe(0);
  });

  it('holds back for someone who blocked the author', () => {
    everyMessage();
    testDb.insert(schema.userBlocks).values({ blockerId: READER, blockedId: AUTHOR, createdAt: 1 }).run();
    channelPush(channelMessage());
    expect(sent()).toBe(0);
  });

  it('holds back for someone looking at the app, on Do Not Disturb, or suspended', () => {
    everyMessage();
    channelPush(channelMessage(), (id) => id === READER);
    expect(sent()).toBe(0);

    testDb.update(schema.users).set({ chosenStatus: 'dnd' }).where(eq(schema.users.id, READER)).run();
    channelPush(channelMessage());
    expect(sent()).toBe(0);

    testDb.update(schema.users).set({ chosenStatus: 'online', suspendedAt: 1 }).where(eq(schema.users.id, READER)).run();
    channelPush(channelMessage());
    expect(sent()).toBe(0);
  });

  it('never tells the author, and says nothing for a system line', () => {
    everyMessage();
    addDevice(AUTHOR);
    channelPush(channelMessage({ type: 'system', content: '{}' }));
    expect(sent()).toBe(0);
    channelPush(channelMessage());
    expect(sent()).toBe(1);
  });

  it('brings one push for a burst in the same place', () => {
    everyMessage();
    channelPush(channelMessage({ id: 'a' }));
    channelPush(channelMessage({ id: 'b' }));
    expect(sent()).toBe(1);
  });
});

describe('a message in a conversation', () => {
  const dmPush = (message: DmMessageWithUser, focused: (id: string) => boolean = NOBODY_FOCUSED) => _forTests.pushDmMessageNow(message, focused);
  const sent = () => pushed.length;

  it('alerts the other members', () => {
    dmPush(dmMessage());
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ userId: READER, payload: { title: 'Mara', body: 'hello', url: `/channels/@me/${DM}?message=d1` } });
  });

  it('follows what the device chose', () => {
    testDb.update(schema.pushSubscriptions).set({ directMessages: false }).run();
    dmPush(dmMessage());
    expect(sent()).toBe(0);
  });

  it('holds back for a block, for a system line, and for an account of another instance', () => {
    dmPush(dmMessage({ type: 'system' }));
    expect(sent()).toBe(0);
    testDb.insert(schema.userBlocks).values({ blockerId: READER, blockedId: AUTHOR, createdAt: 1 }).run();
    dmPush(dmMessage());
    expect(sent()).toBe(0);
    testDb.delete(schema.userBlocks).run();
    testDb.update(schema.users).set({ homeInstance: 'https://peer.example' }).where(eq(schema.users.id, READER)).run();
    dmPush(dmMessage());
    expect(sent()).toBe(0);
  });
});

describe('a message in a thread', () => {
  const THREAD = 'thread-1';

  beforeEach(() => {
    testDb.insert(schema.channels).values({ id: THREAD, spaceId: SPACE, name: 'plans', type: 'thread', parentChannelId: CHANNEL, createdAt: 1 }).run();
  });

  it('alerts only those who follow it, and leads to it through its channel', () => {
    channelPush(channelMessage({ channelId: THREAD, content: `<@${READER}> news` }));
    expect(pushed).toEqual([]);

    testDb.insert(schema.threadMembers).values({ threadId: THREAD, userId: READER, joinedAt: 1 }).run();
    channelPush(channelMessage({ channelId: THREAD, content: 'news' }));
    expect(pushed).toHaveLength(1);
    const { url } = pushed[0]!.payload;
    expect(url).toContain(`/channels/${SPACE}/${CHANNEL}`);
    expect(url).toContain(`thread=${THREAD}`);
  });
});

describe('an event about to start', () => {
  const event = { id: 'e1', spaceId: SPACE, title: 'Game night' };

  it('tells those going, in the device\'s language, and leads to the events', () => {
    testDb.update(schema.pushSubscriptions).set({ locale: 'de' }).run();
    _forTests.pushEventReminderNow(event, [READER], NOBODY_FOCUSED);
    expect(pushed[0]).toMatchObject({ userId: READER, payload: { title: 'Game night', body: 'Beginnt gleich', tag: 'event:e1', url: `/channels/${SPACE}/events` } });
  });

  it('holds back for someone looking at the app, and is in English without a language', () => {
    _forTests.pushEventReminderNow(event, [READER], (id) => id === READER);
    expect(pushed).toEqual([]);
    _forTests.pushEventReminderNow(event, [READER], NOBODY_FOCUSED);
    expect(pushed[0]?.payload.body).toBe('Starts soon');
  });
});

describe('a call ringing', () => {
  it('says who is calling, in the device\'s language', () => {
    testDb.update(schema.pushSubscriptions).set({ locale: 'de' }).run();
    _forTests.pushDmCallNow(DM, AUTHOR, 'Mara', NOBODY_FOCUSED);
    expect(pushed[0]).toMatchObject({ userId: READER, payload: { title: 'Mara', body: 'ruft dich an', tag: `call:${DM}` } });
  });
});

describe('what a notification says', () => {
  const on = { showText: true, locale: 'de' };

  it('hides the words for a device that asked for that', () => {
    expect(pushBodyOf('a secret', 0, { showText: false, locale: 'de' })).toBe('Neue Nachricht');
  });

  it('never shows what a spoiler hides', () => {
    expect(pushBodyOf('it was ||the butler|| all along', 0, on)).toBe('it was [Spoiler] all along');
  });

  it('names people instead of showing ids, and leaves out the marks', () => {
    expect(pushBodyOf(`**hi** <@${AUTHOR}>`, 0, on)).toBe('hi @mara');
  });

  it('says that a message is a voice message', () => {
    expect(pushBodyOf(null, 1, { showText: true, locale: 'de' }, true)).toBe('Sprachnachricht');
    expect(pushBodyOf(null, 1, { showText: false, locale: 'en' }, true)).toBe('New message');
  });

  it('says what a message without words is', () => {
    expect(pushBodyOf(null, 2, on)).toBe('Hat eine Datei gesendet');
    expect(pushBodyOf(null, 2, { showText: true, locale: null })).toBe('Sent a file');
  });

  it('is kept short', () => {
    expect(pushBodyOf('x'.repeat(500), 0, on).length).toBeLessThanOrEqual(180);
  });
});

describe('the signing key', () => {
  it('is made once and kept', () => {
    const first = getVapidKeys();
    _resetVapidKeys();
    expect(getVapidKeys()).toEqual(first);
    expect(testDb.select().from(schema.pushKeys).all()).toHaveLength(1);
  });
});
