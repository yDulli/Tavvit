import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId, generateSnowflake } from '../utils/snowflake.js';
import { DEFAULT_EVERYONE_PERMISSIONS, permissionsToString } from '@backspace/shared/src/permissions.js';

// The Reddit report: content one person chooses that every other person's client fetches by
// itself, from a server of that person's choosing, before anyone clicks. A sticker token or a
// picture address on such a server tells it the reader's IP address and when they read. These
// tests are the attacker's side: each crafted value is refused at the door, and one stored
// before the rule held is not handed to anyone (utils/remoteMedia.ts).

setWorkerId(31);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'mallory';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToChannel: vi.fn(),
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    sendToRoom: vi.fn(),
    sendToAdmins: vi.fn(),
    getUserRoom: () => undefined,
    getRoom: () => undefined,
    getAllRooms: () => new Map(),
    getAllOnlineUserIds: () => [],
    getUserSpaceEntries: () => new Map<string, Set<string>>(),
    leaveCurrentRoom: vi.fn(() => false),
    destroyRoom: vi.fn(),
    clearVoiceUserStatus: vi.fn(),
  },
}));

vi.mock('../ws/events.js', () => ({
  checkVoicePermissions: vi.fn(),
}));

vi.mock('../utils/embedResolver.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/embedResolver.js')>();
  return { ...actual, resolveEmbeds: vi.fn(async () => {}), reResolveEmbeds: vi.fn(async () => {}) };
});

vi.mock('../utils/federationOutbox.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationOutbox.js')>('../utils/federationOutbox.js');
  return {
    ...actual,
    isFederationRelayEnabled: () => false,
    queueDmCloseRelay: vi.fn(),
    sendTypingRelay: vi.fn(),
    queueDmRelay: vi.fn(),
    queueGroupMetadataRelay: vi.fn(),
    appendMutationLog: vi.fn(),
    queueOutboxEvent: vi.fn(),
  };
});

vi.mock('../utils/federationAuth.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/federationAuth.js')>();
  return { ...actual, getOurOrigin: () => 'https://local.test' };
});

vi.mock('../utils/fileCleanup.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/fileCleanup.js')>('../utils/fileCleanup.js');
  return { ...actual, deleteUploadFile: vi.fn(), deleteAttachmentByFilename: vi.fn(), deleteAttachmentFiles: vi.fn(async () => {}) };
});

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
}

const OURS = 'https://local.test';
const HASH = 'b'.repeat(64);
const stickerOn = (origin: string) => `sticker:${origin}/api/stickers/assets/${HASH}.webp`;
const TRACKER = 'https://tracker.example';
const SPACE = 'space-1';
const CHANNEL = 'chan-1';
const DM = 'dm-1';

let app: FastifyInstance;

function seedUser(id: string, homeInstance: string | null = null): void {
  testDb.insert(schema.users).values({
    id, username: id, displayName: id, passwordHash: 'x', homeUserId: id, homeInstance, createdAt: Date.now(), dmPolicy: 'anyone',
  }).run();
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  seedUser('mallory');
  seedUser('victim');
  seedUser('visitor', 'home.test');
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'victim', inviteCode: 'inv', visibility: 'private', createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  for (const userId of ['mallory', 'victim', 'visitor']) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId, joinedAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', position: 0, createdAt: 1 }).run();
  testDb.insert(schema.dmChannels).values({ id: DM, ownerId: null, createdAt: 1 }).run();
  testDb.insert(schema.dmMembers).values([{ dmChannelId: DM, userId: 'mallory' }, { dmChannelId: DM, userId: 'victim' }]).run();
  currentUserId = 'mallory';
  app = Fastify({ logger: false });
  const { messageRoutes } = await import('./messages.js');
  const { dmRoutes } = await import('./dm.js');
  const { userRoutes } = await import('./users.js');
  await app.register(messageRoutes);
  await app.register(dmRoutes);
  await app.register(userRoutes);
  await app.ready();
});

describe('a sticker on another server, sent so the reader fetches it', () => {
  it('is refused in a DM, and nothing is stored', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/dm/${DM}/messages`, payload: { content: stickerOn(TRACKER) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('sticker_elsewhere');
    expect(testDb.select().from(schema.dmMessages).all()).toEqual([]);
  });

  it('is refused by any spelling of another server, plain http included', async () => {
    for (const origin of ['http://127.0.0.1:4999', 'http://local.test', 'https://local.test.tracker.example']) {
      const res = await app.inject({ method: 'POST', url: `/api/dm/${DM}/messages`, payload: { content: stickerOn(origin) } });
      expect(res.statusCode, origin).toBe(400);
    }
  });

  it('is refused in a channel, and as an edit of a message there', async () => {
    const sent = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, payload: { content: stickerOn(TRACKER) } });
    expect(sent.statusCode).toBe(400);
    expect(sent.json().code).toBe('sticker_elsewhere');

    const id = generateSnowflake();
    testDb.insert(schema.messages).values({ id, channelId: CHANNEL, userId: 'mallory', content: 'harmless', createdAt: Date.now() }).run();
    const edited = await app.inject({ method: 'PATCH', url: `/api/messages/${id}`, payload: { content: stickerOn(TRACKER) } });
    expect(edited.statusCode).toBe(400);
    expect(testDb.select().from(schema.messages).where(eq(schema.messages.id, id)).get()?.content).toBe('harmless');
  });

  it('is refused as a reaction, which everyone who sees the message would fetch', async () => {
    const { addSpaceReaction } = await import('../utils/reactions.js');
    const id = generateSnowflake();
    testDb.insert(schema.messages).values({ id, channelId: CHANNEL, userId: 'victim', content: 'hi', createdAt: Date.now() }).run();
    const message = testDb.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
    expect(addSpaceReaction(message, 'mallory', stickerOn(TRACKER))?.code).toBe('sticker_elsewhere');
    expect(testDb.select().from(schema.reactions).all()).toEqual([]);
    expect(addSpaceReaction(message, 'mallory', stickerOn(OURS))).toBeNull();
  });

  it('from this instance goes through, and so does one from the home of a federated account', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/dm/${DM}/messages`, payload: { content: stickerOn(OURS) } })).statusCode).toBe(201);
    currentUserId = 'visitor';
    const res = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, payload: { content: stickerOn('https://home.test') } });
    expect(res.statusCode).toBe(201);
    const other = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, payload: { content: stickerOn(TRACKER) } });
    expect(other.statusCode).toBe(400);
  });
});

describe('a profile picture at an address', () => {
  const setPicture = (field: 'avatar' | 'banner', value: string) => app.inject({ method: 'PATCH', url: '/api/users/@me', payload: { [field]: value } });

  it('on another server is refused, as picture and as banner', async () => {
    for (const value of [`${TRACKER}/pixel.png`, 'http://127.0.0.1:4999/avatar.png', `${OURS}/api/uploads/a.png?victim=1`]) {
      const avatar = await setPicture('avatar', value);
      expect(avatar.statusCode, value).toBe(400);
      expect(avatar.json().code).toBe('avatar_url_invalid');
      expect((await setPicture('banner', value)).statusCode, value).toBe(400);
    }
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, 'mallory')).get();
    expect(row?.avatar ?? null).toBeNull();
    expect(row?.banner ?? null).toBeNull();
  });

  it('of an upload here is taken', async () => {
    expect((await setPicture('avatar', `${OURS}/api/uploads/me.png`)).statusCode).toBe(200);
  });

  it('of a federated account shows when it is an upload at its home, and not when it is anywhere else', async () => {
    const { publicUserOf } = await import('../utils/sanitize.js');
    const shown = (avatar: string) => {
      testDb.update(schema.users).set({ avatar }).where(eq(schema.users.id, 'visitor')).run();
      return publicUserOf(testDb.select().from(schema.users).where(eq(schema.users.id, 'visitor')).get()!).avatar;
    };
    expect(shown('https://home.test/api/uploads/me.png')).toBe('https://home.test/api/uploads/me.png');
    expect(shown(`${TRACKER}/me.png`)).toBeNull();
    // The account cannot set it here at all: its home does, over federation.
    currentUserId = 'visitor';
    expect((await setPicture('avatar', `${TRACKER}/me.png`)).statusCode).toBe(403);
  });

  it('stored on another server before the rule is handed to nobody, its owner included', async () => {
    testDb.update(schema.users).set({ avatar: `${TRACKER}/pixel.png?u=mallory`, banner: '//tracker.example/b.png' })
      .where(eq(schema.users.id, 'mallory')).run();
    const own = await app.inject({ method: 'GET', url: '/api/users/@me' });
    expect(own.json().avatar).toBeNull();
    expect(own.json().banner).toBeNull();
    const { publicUserOf } = await import('../utils/sanitize.js');
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, 'mallory')).get()!;
    expect(publicUserOf(row).avatar).toBeNull();
    // The stored value itself stays as it was: nothing of anyone's data is changed.
    expect(row.avatar).toBe(`${TRACKER}/pixel.png?u=mallory`);
  });
});
