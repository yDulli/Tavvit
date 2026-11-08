import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { removalSubjectOf } from '@backspace/shared/src/adminRemoval.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

// What an administrator removes directly (docs/systems/admin.md, "Removing content"), through the
// real routes and a real database: only an administrator may, every removal names its reason and
// ground, the person it concerns is told, and the platform audit log keeps it.

setWorkerId(8);

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
const settings = vi.hoisted(() => ({ uploadDir: '' }));

vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, key, receiver) => (key === 'uploadDir' ? settings.uploadDir : Reflect.get(target, key, receiver)),
    }),
  };
});

vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId?: string; headers: Record<string, string | undefined> }, reply: { code: (code: number) => { send: () => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send();
    request.userId = request.headers.authorization;
  },
  requireAdmin: async (request: { userId: string }, reply: { code: (code: number) => { send: (body: unknown) => void } }) => {
    const caller = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (caller?.isAdmin !== 1) return reply.code(403).send({ code: 'forbidden' });
  },
}));

const sent = vi.hoisted(() => [] as Array<{ method: string; args: unknown[] }>);
vi.mock('../ws/handler.js', () => {
  const answers: Record<string, unknown> = { getAllOnlineUserIds: [], leaveCurrentRoom: false };
  const fns = new Map<string, (...args: unknown[]) => unknown>();
  return {
    connectionManager: new Proxy({}, {
      get: (_target, key: string) => {
        if (!fns.has(key)) fns.set(key, (...args: unknown[]) => { sent.push({ method: key, args }); return answers[key]; });
        return fns.get(key);
      },
    }),
  };
});

vi.mock('../ws/events.js', async () => {
  const actual = await vi.importActual<typeof import('../ws/events.js')>('../ws/events.js');
  return { ...actual, disconnectMemberFromSpaceVoice: vi.fn() };
});

vi.mock('../utils/federationOutbox.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationOutbox.js')>('../utils/federationOutbox.js');
  return { ...actual, isFederationRelayEnabled: () => false, appendMutationLog: vi.fn(), queueOutboxEvent: vi.fn() };
});

import { adminRemovalRoutes } from './adminRemoval.js';

const AVATAR = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.png';
const ICON = 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6.png';

beforeEach(async () => {
  sent.length = 0;
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'tavvit-admin-removal-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });
  const user = (id: string, extra: Partial<typeof schema.users.$inferInsert> = {}) => db.insert(schema.users)
    .values({ id, username: id, displayName: id, passwordHash: 'x', createdAt: 1, ...extra }).run();
  user('admin', { isAdmin: 1 });
  user('alice', {
    avatar: AVATAR, bio: 'Rude words', pronouns: 'she/her', customStatus: 'Bad status', avatarFrame: 'crown', nameEffect: 'gold',
  });
  user('bob');
  user('remote', { homeInstance: 'other.example', homeUserId: 'r1' });
  db.insert(schema.spaces).values({ id: 's1', name: 'Night Shift', ownerId: 'alice', icon: ICON, description: 'About it', tag: '{"text":"NS"}', createdAt: 1 }).run();
  db.insert(schema.channels).values({ id: 'c1', spaceId: 's1', name: 'general', type: 'text', createdAt: 1 }).run();
  db.insert(schema.spaceMembers).values([{ spaceId: 's1', userId: 'alice', joinedAt: 1 }, { spaceId: 's1', userId: 'bob', joinedAt: 1 }]).run();
  db.insert(schema.messages).values({ id: 'm1', channelId: 'c1', userId: 'bob', content: 'Something not allowed', createdAt: 2 }).run();
  db.update(schema.users).set({ spaceTag: JSON.stringify({ spaceId: 's1', text: 'NS', glyph: null, color: null }) }).where(eq(schema.users.id, 'bob')).run();
  db.insert(schema.spaceEmojis).values({ id: '1000001', spaceId: 's1', name: 'rude', size: 10, createdBy: 'bob', createdAt: 3 }).run();
  db.insert(schema.stickerAssets).values({ id: 'asset1', createdAt: 3 }).run();
  db.insert(schema.spaceStickers).values({ id: '1000002', spaceId: 's1', stickerId: 'asset1', name: 'Rude, sticker', size: 10, createdBy: 'bob', createdAt: 3 }).run();
  db.insert(schema.spaceSounds).values({ id: 's-sound', spaceId: 's1', name: 'Loud', mimetype: 'audio/ogg', size: 10, duration: 1, createdBy: null, createdAt: 3 }).run();
  await writeFile(path.join(settings.uploadDir, AVATAR), 'x');
  await writeFile(path.join(settings.uploadDir, ICON), 'x');
  await mkdir(path.join(settings.uploadDir, 'emoji'), { recursive: true });
  await writeFile(path.join(settings.uploadDir, 'emoji', '1000001.webp'), 'x');
  app = Fastify({ logger: false });
  await app.register(adminRemovalRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  await rm(settings.uploadDir, { recursive: true, force: true });
});

const reason = { reason: 'Breaks the rules on hate.', ground: 'terms' };
const post = (user: string, url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { authorization: user }, payload });
const noticesOf = (userId: string) => db.select().from(schema.userNotices).where(eq(schema.userNotices.userId, userId)).all();
const audit = () => db.select().from(schema.platformAuditLog).all();
const userRow = (id: string) => db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
const spaceRow = () => db.select().from(schema.spaces).where(eq(schema.spaces.id, 's1')).get();

describe('who may remove', () => {
  it.each([
    ['/api/admin/messages/m1/remove', {}],
    ['/api/admin/users/alice/profile/remove', { parts: ['bio'] }],
    ['/api/admin/spaces/s1/content/remove', { parts: ['icon'] }],
    ['/api/admin/spaces/s1/expressions/remove', { kind: 'emoji', id: '1000001' }],
    ['/api/admin/spaces/s1/delete', {}],
  ])('only an administrator: %s', async (url, payload) => {
    expect((await post('bob', url, { ...reason, ...payload })).statusCode).toBe(403);
    expect(audit()).toEqual([]);
  });

  it('asks for a reason and a ground, and for what to remove', async () => {
    expect((await post('admin', '/api/admin/messages/m1/remove', { reason: 'no', ground: 'terms' })).json()).toMatchObject({ code: 'removal_reason_invalid', details: { min: 3, max: 500 } });
    expect((await post('admin', '/api/admin/messages/m1/remove', { reason: 'Long enough.', ground: 'mood' })).json()).toMatchObject({ code: 'report_ground_required' });
    for (const parts of [[], ['soul'], 'bio', ['bio', 'bio', 'bio', 'bio', 'bio', 'bio', 'bio', 'bio', 'bio', 'bio']]) {
      expect((await post('admin', '/api/admin/users/alice/profile/remove', { ...reason, parts })).json()).toMatchObject({ code: 'removal_parts_invalid' });
    }
    expect(db.select().from(schema.messages).all()).toHaveLength(1);
  });
});

describe('a message', () => {
  it('goes from the channel, its author is told why, and the audit log keeps it', async () => {
    expect((await post('admin', '/api/admin/messages/m1/remove', reason)).statusCode).toBe(200);
    expect(db.select().from(schema.messages).all()).toEqual([]);
    expect(sent).toContainEqual(expect.objectContaining({ method: 'sendToChannel', args: ['s1', 'c1', expect.objectContaining({ type: 'message_deleted', messageId: 'm1' })] }));
    expect(noticesOf('bob')).toEqual([expect.objectContaining({ kind: 'content_removed', ground: 'terms', note: 'Breaks the rules on hate.', subject: 'Something not allowed' })]);
    expect(audit()).toEqual([expect.objectContaining({ actorId: 'admin', action: 'message_remove', targetId: 'bob', reason: 'Breaks the rules on hate.' })]);
    expect((await post('admin', '/api/admin/messages/m1/remove', reason)).statusCode).toBe(404);
  });

  it('is never a direct message: an administrator acts on those through a report', async () => {
    db.insert(schema.dmChannels).values({ id: 'dm1', createdAt: 1 }).run();
    db.insert(schema.dmMessages).values({ id: 'dm-m1', dmChannelId: 'dm1', userId: 'bob', content: 'Private words', createdAt: 2 }).run();
    expect((await post('admin', '/api/admin/messages/dm-m1/remove', reason)).json()).toMatchObject({ code: 'message_not_found' });
    expect(db.select().from(schema.dmMessages).all()).toHaveLength(1);
    expect(noticesOf('bob')).toEqual([]);
    expect(audit()).toEqual([]);
  });
});

describe('a person\'s profile', () => {
  it('loses the parts named, its pictures with them, and its owner is told which in their own words', async () => {
    const res = await post('admin', '/api/admin/users/alice/profile/remove', { ...reason, parts: ['bio', 'avatar', 'decorations', 'status'] });
    expect(res.statusCode).toBe(200);
    expect(userRow('alice')).toMatchObject({ avatar: null, bio: null, customStatus: null, avatarFrame: null, nameEffect: null, pronouns: 'she/her', displayName: 'alice' });
    expect(existsSync(path.join(settings.uploadDir, AVATAR))).toBe(false);
    expect(sent).toContainEqual(expect.objectContaining({ method: 'sendToUser', args: ['alice', expect.objectContaining({ type: 'user_updated' })] }));
    const [notice] = noticesOf('alice');
    expect(notice).toMatchObject({ kind: 'profile_content_removed', ground: 'terms' });
    expect(removalSubjectOf(notice!.subject)).toEqual({ parts: ['avatar', 'bio', 'status', 'decorations'] });
    expect(audit()).toEqual([expect.objectContaining({ action: 'profile_content_remove', targetId: 'alice' })]);
  });

  it('is not the administrator\'s own, nor a copy of someone whose home is elsewhere', async () => {
    expect((await post('admin', '/api/admin/users/admin/profile/remove', { ...reason, parts: ['bio'] })).json()).toMatchObject({ code: 'cannot_target_self' });
    expect((await post('admin', '/api/admin/users/remote/profile/remove', { ...reason, parts: ['bio'] })).json()).toMatchObject({ code: 'profile_managed_by_home' });
    expect((await post('admin', '/api/admin/users/nobody/profile/remove', { ...reason, parts: ['bio'] })).statusCode).toBe(404);
  });
});

describe('a space', () => {
  it('loses the parts named, its tag from everyone who wore it, and its owner is told', async () => {
    expect((await post('admin', '/api/admin/spaces/s1/content/remove', { ...reason, parts: ['tag', 'icon', 'description'] })).statusCode).toBe(200);
    expect(spaceRow()).toMatchObject({ icon: null, description: null, tag: null, name: 'Night Shift' });
    expect(existsSync(path.join(settings.uploadDir, ICON))).toBe(false);
    expect(userRow('bob').spaceTag).toBeNull();
    expect(sent).toContainEqual(expect.objectContaining({ method: 'sendToSpace', args: ['s1', expect.objectContaining({ type: 'space_updated' })] }));
    const [notice] = noticesOf('alice');
    expect(notice).toMatchObject({ kind: 'space_content_removed' });
    expect(removalSubjectOf(notice!.subject)).toEqual({ space: 'Night Shift', parts: ['icon', 'description', 'tag'] });
    expect(audit()).toEqual([expect.objectContaining({ action: 'space_content_remove', targetId: 's1' })]);
  });

  it('lists its emoji, stickers and sounds to an administrator, who need not be a member', async () => {
    expect((await app.inject({ url: '/api/admin/spaces/s1/expressions', headers: { authorization: 'bob' } })).statusCode).toBe(403);
    const listing = (await app.inject({ url: '/api/admin/spaces/s1/expressions', headers: { authorization: 'admin' } })).json();
    expect(listing.emojis).toEqual([expect.objectContaining({ id: '1000001', name: 'rude' })]);
    expect(listing.stickers).toEqual([expect.objectContaining({ id: '1000002', name: 'Rude, sticker', stickerId: 'asset1' })]);
    expect(listing.sounds).toEqual([expect.objectContaining({ id: 's-sound', name: 'Loud', duration: 1 })]);
    expect((await app.inject({ url: '/api/admin/spaces/nope/expressions', headers: { authorization: 'admin' } })).statusCode).toBe(404);
  });

  it('loses one emoji, sticker or sound, and whoever added it is told, or its owner', async () => {
    expect((await post('admin', '/api/admin/spaces/s1/expressions/remove', { ...reason, kind: 'emoji', id: '1000001' })).statusCode).toBe(200);
    expect(db.select().from(schema.spaceEmojis).all()).toEqual([]);
    expect(existsSync(path.join(settings.uploadDir, 'emoji', '1000001.webp'))).toBe(false);
    expect((await post('admin', '/api/admin/spaces/s1/expressions/remove', { ...reason, kind: 'sticker', id: '1000002' })).statusCode).toBe(200);
    expect(db.select().from(schema.spaceStickers).all()).toEqual([]);
    expect((await post('admin', '/api/admin/spaces/s1/expressions/remove', { ...reason, kind: 'sound', id: 's-sound' })).statusCode).toBe(200);
    expect(db.select().from(schema.spaceSounds).all()).toEqual([]);
    expect(noticesOf('bob').map((notice) => removalSubjectOf(notice.subject))).toEqual([
      { space: 'Night Shift', expression: 'emoji', name: 'rude' },
      { space: 'Night Shift', expression: 'sticker', name: 'Rude, sticker' },
    ]);
    expect(noticesOf('alice').map((notice) => removalSubjectOf(notice.subject))).toEqual([{ space: 'Night Shift', expression: 'sound', name: 'Loud' }]);
    expect((await post('admin', '/api/admin/spaces/s1/expressions/remove', { ...reason, kind: 'emoji', id: '1000001' })).statusCode).toBe(404);
    expect((await post('admin', '/api/admin/spaces/s1/expressions/remove', { ...reason, kind: 'gif', id: '1' })).json()).toMatchObject({ code: 'removal_parts_invalid' });
  });

  it('goes as a whole, its members hear it at once, and its owner is told', async () => {
    expect((await post('admin', '/api/admin/spaces/s1/delete', reason)).statusCode).toBe(200);
    expect(spaceRow()).toBeUndefined();
    expect(db.select().from(schema.messages).all()).toEqual([]);
    const told = sent.findIndex((entry) => entry.method === 'sendToSpace' && (entry.args[1] as { type: string }).type === 'space_deleted');
    expect(sent[told]?.args).toEqual(['s1', { type: 'space_deleted', spaceId: 's1' }]);
    // While they are still its audience: only then are they taken out of it.
    expect(sent.findIndex((entry) => entry.method === 'removeUserSpace')).toBeGreaterThan(told);
    const [notice] = noticesOf('alice');
    expect(notice).toMatchObject({ kind: 'space_removed', note: 'Breaks the rules on hate.' });
    expect(removalSubjectOf(notice!.subject)).toEqual({ space: 'Night Shift' });
    expect(audit()).toEqual([expect.objectContaining({ action: 'space_delete', targetId: 's1', targetLabel: 'Night Shift' })]);
  });
});
