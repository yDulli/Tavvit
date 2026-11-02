import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { MAX_BULK_DELETE_MESSAGES } from '@backspace/shared';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Deleting many messages, forwarding one, and marking attachments as spoilers.

setWorkerId(24);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const { sent, uploadDir } = vi.hoisted(() => {
  const nodeFs = process.getBuiltinModule('node:fs');
  const nodeOs = process.getBuiltinModule('node:os');
  const nodePath = process.getBuiltinModule('node:path');
  return {
    sent: [] as Array<{ to: string; event: { type: string; messageIds?: string[] } }>,
    uploadDir: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'tavvit-forward-')),
  };
});

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      const event = args[args.length - 1] as { type: string } | undefined;
      if (event && typeof event === 'object' && 'type' in event) sent.push({ to: String(name), event });
    },
  }),
}));

vi.mock('../config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config.js')>();
  return { ...original, config: { ...original.config, uploadDir } };
});

// No link in these messages leaves the test.
vi.mock('../utils/embedResolver.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/embedResolver.js')>();
  return { ...original, resolveEmbeds: () => Promise.resolve() };
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

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const MODERATOR = 'user-moderator';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const OTHER_CHANNEL = 'channel-2';
const LOCKED_CHANNEL = 'channel-locked';
const DM = 'dm-1';
const OTHER_DM = 'dm-2';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });
const typesSent = () => sent.map((entry) => entry.event.type);

function addMessage(id: string, extra: Partial<typeof schema.messages.$inferInsert> = {}): void {
  testDb.insert(schema.messages).values({ id, channelId: CHANNEL, userId: MEMBER, content: `text of ${id}`, createdAt: 1, ...extra }).run();
}

function addAttachment(id: string, filename: string, link: { messageId?: string; dmMessageId?: string } = {}): void {
  fs.writeFileSync(path.join(uploadDir, filename), `contents of ${filename}`);
  testDb.insert(schema.attachments).values({
    id, filename, originalName: 'photo.png', mimetype: 'image/png', size: 10, uploaderId: MEMBER, createdAt: 1, ...link,
  }).run();
}

const { messageRoutes } = await import('./messages.js');
const { forwardRoutes } = await import('./forward.js');
const { dmRoutes } = await import('./dm.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  for (const id of [OWNER, MEMBER, MODERATOR, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  for (const id of [CHANNEL, OTHER_CHANNEL, LOCKED_CHANNEL]) {
    testDb.insert(schema.channels).values({ id, spaceId: SPACE, name: id, type: 'text', createdAt: 1 }).run();
  }
  for (const id of [OWNER, MEMBER, MODERATOR]) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  }
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), position: 0, createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-mod', spaceId: SPACE, name: 'Mods', permissions: permissionsToString(PermissionBits.MANAGE_MESSAGES), position: 1, createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: MODERATOR, roleId: 'role-mod' }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: LOCKED_CHANNEL, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.SEND_MESSAGES),
  }).run();
  testDb.insert(schema.dmChannels).values({ id: DM, createdAt: 1 }).run();
  testDb.insert(schema.dmChannels).values({ id: OTHER_DM, createdAt: 1 }).run();
  for (const id of [OWNER, MEMBER]) {
    testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: id }).run();
  }
  testDb.insert(schema.dmMembers).values({ dmChannelId: OTHER_DM, userId: OWNER }).run();
  testDb.insert(schema.dmMembers).values({ dmChannelId: OTHER_DM, userId: OUTSIDER }).run();
  app = Fastify();
  await app.register(messageRoutes);
  await app.register(forwardRoutes);
  await app.register(dmRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe('deleting many messages', () => {
  const remove = (userId: string, messageIds: unknown, channelId = CHANNEL) => app.inject({
    method: 'POST',
    url: `/api/channels/${channelId}/messages/bulk-delete`,
    headers: headers(userId),
    payload: { messageIds },
  });
  const left = () => testDb.select({ id: schema.messages.id }).from(schema.messages).all().map((row) => row.id);

  it('takes MANAGE_MESSAGES in that channel', async () => {
    addMessage('m1');
    const refused = await remove(MEMBER, ['m1']);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'MANAGE_MESSAGES' } });
    expect((await remove(OUTSIDER, ['m1'])).statusCode).toBe(403);
    expect(left()).toEqual(['m1']);
  });

  it('deletes them with their files, says so once, and logs how many without their words', async () => {
    addMessage('m1');
    addMessage('m2');
    addMessage('m3');
    addAttachment('att-1', 'one.png', { messageId: 'm1' });
    const res = await remove(MODERATOR, ['m1', 'm2', 'm1']);
    expect(res.json()).toEqual({ deleted: 2 });
    expect(left()).toEqual(['m3']);
    expect(fs.existsSync(path.join(uploadDir, 'one.png'))).toBe(false);
    expect(sent.filter((entry) => entry.event.type === 'messages_deleted')).toHaveLength(1);

    const [entry] = testDb.select().from(schema.spaceAuditLog).all();
    expect(entry?.action).toBe('channel_messages_delete');
    expect(entry?.targetId).toBe(CHANNEL);
    expect(entry?.changes).toContain('"2"');
    expect(entry?.changes).not.toContain('text of');
  });

  it('touches nothing in another channel, whatever the ids say', async () => {
    addMessage('elsewhere', { channelId: OTHER_CHANNEL });
    addMessage('here');
    const res = await remove(MODERATOR, ['elsewhere', 'here']);
    expect(res.json()).toEqual({ deleted: 1 });
    expect(left()).toEqual(['elsewhere']);
    expect((sent.find((entry) => entry.event.type === 'messages_deleted'))?.event.messageIds).toEqual(['here']);
  });

  it('refuses an empty list, a long one, and one that is not a list', async () => {
    expect((await remove(MODERATOR, [])).statusCode).toBe(400);
    expect((await remove(MODERATOR, 'm1')).statusCode).toBe(400);
    const tooMany = Array.from({ length: MAX_BULK_DELETE_MESSAGES + 1 }, (_, index) => `id-${index}`);
    expect((await remove(MODERATOR, tooMany)).json()).toMatchObject({ code: 'validation_failed' });
  });
});

describe('forwarding a message', () => {
  const forward = (id: string, userId: string, payload: Record<string, unknown>) => app.inject({
    method: 'POST', url: `/api/messages/${id}/forward`, headers: headers(userId), payload,
  });

  it('makes a new message of the person forwarding, naming neither the place nor the author', async () => {
    addMessage('m1', { content: 'worth reading' });
    const res = await forward('m1', OWNER, { channelId: OTHER_CHANNEL });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ channelId: OTHER_CHANNEL, userId: OWNER, content: 'worth reading', forwarded: true });
    expect(typesSent()).toContain('message_created');
    expect(JSON.stringify(res.json())).not.toContain(MEMBER);
    expect(JSON.stringify(res.json())).not.toContain(CHANNEL);
  });

  it('asks to read the source and to write in the target', async () => {
    addMessage('m1');
    expect((await forward('m1', OUTSIDER, { channelId: OTHER_CHANNEL })).statusCode).toBe(403);
    const locked = await forward('m1', MEMBER, { channelId: LOCKED_CHANNEL });
    expect(locked.statusCode).toBe(403);
    expect(locked.json()).toMatchObject({ details: { permission: 'SEND_MESSAGES' } });
  });

  it('wants exactly one target, and never a system line', async () => {
    addMessage('m1');
    expect((await forward('m1', OWNER, {})).json().code).toBe('validation_failed');
    expect((await forward('m1', OWNER, { channelId: OTHER_CHANNEL, dmChannelId: DM })).json().code).toBe('validation_failed');
    addMessage('line', { type: 'system', content: '{}' });
    expect((await forward('line', OWNER, { channelId: OTHER_CHANNEL })).json().code).toBe('system_message_immutable');
  });

  it('turns mentions into plain names, so it alerts nobody where it lands', async () => {
    testDb.update(schema.users).set({ displayName: 'Mara <@1> @everyone' }).where(eq(schema.users.id, MEMBER)).run();
    addMessage('m1', { content: `<@${MEMBER}> and @everyone, see \`@here\`` });
    const res = await forward('m1', OWNER, { channelId: OTHER_CHANNEL });
    const { content, mentionEveryone } = res.json();
    expect(content).not.toContain('<@');
    expect(content).toContain('@\u200BMara 1 everyone');
    expect(content).toContain('@​everyone');
    expect(content).toContain('`@here`');
    expect(mentionEveryone).toBe(false);
  });

  it('copies the files, so deleting the original leaves the copy whole', async () => {
    addMessage('m1', { content: null });
    addAttachment('att-1', 'kept.png', { messageId: 'm1' });
    testDb.update(schema.attachments).set({ spoiler: true }).where(eq(schema.attachments.id, 'att-1')).run();
    const res = await forward('m1', OWNER, { channelId: OTHER_CHANNEL });
    expect(res.statusCode).toBe(201);
    const [copy] = res.json().attachments as Array<{ filename: string; spoiler: boolean }>;
    expect(copy?.filename).not.toBe('kept.png');
    expect(copy?.spoiler).toBe(true);
    fs.rmSync(path.join(uploadDir, 'kept.png'));
    expect(fs.readFileSync(path.join(uploadDir, copy!.filename), 'utf8')).toBe('contents of kept.png');
  });

  it('refuses a message whose only file has not arrived here yet', async () => {
    addMessage('m1', { content: null });
    testDb.insert(schema.attachments).values({
      id: 'att-remote', messageId: 'm1', filename: 'https://peer.example/api/uploads/x.png', originalName: 'x.png', mimetype: 'image/png', size: 1, createdAt: 1,
    }).run();
    expect((await forward('m1', OWNER, { channelId: OTHER_CHANNEL })).json().code).toBe('attachment_invalid');
  });

  it('goes into a conversation only for a member of it, and out of one only for a member', async () => {
    addMessage('m1');
    const intoDm = await forward('m1', OWNER, { dmChannelId: DM });
    expect(intoDm.statusCode).toBe(201);
    expect(intoDm.json()).toMatchObject({ dmChannelId: DM, userId: OWNER, forwarded: true });
    expect((await forward('m1', MEMBER, { dmChannelId: OTHER_DM })).json().code).toBe('not_dm_member');

    testDb.insert(schema.dmMessages).values({ id: 'd1', dmChannelId: DM, userId: MEMBER, content: 'between us', createdAt: 1 }).run();
    const out = (userId: string) => app.inject({ method: 'POST', url: '/api/dm/messages/d1/forward', headers: headers(userId), payload: { channelId: OTHER_CHANNEL } });
    expect((await out(MODERATOR)).json().code).toBe('not_dm_member');
    expect((await out(OWNER)).json()).toMatchObject({ channelId: OTHER_CHANNEL, content: 'between us', forwarded: true });
  });

  it('holds to the rules of the place it lands in', async () => {
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, blockedWords: '["worth"]', updatedAt: 1 }).run();
    addMessage('m1', { content: 'worth reading' });
    expect((await forward('m1', MEMBER, { channelId: OTHER_CHANNEL })).statusCode).toBe(403);
  });
});

describe('marking attachments as spoilers', () => {
  it('marks only the ones named, on a channel message', async () => {
    addAttachment('att-1', 'a.png');
    addAttachment('att-2', 'b.png');
    testDb.update(schema.attachments).set({ uploaderId: MEMBER }).run();
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${CHANNEL}/messages`,
      headers: headers(MEMBER),
      payload: { content: 'look', attachments: ['att-1', 'att-2'], spoilerAttachments: ['att-2', 'not-mine'] },
    });
    expect(res.statusCode).toBe(201);
    const flags = Object.fromEntries((res.json().attachments as Array<{ id: string; spoiler: boolean }>).map((a) => [a.id, a.spoiler]));
    expect(flags).toEqual({ 'att-1': false, 'att-2': true });
  });

  it('marks them on a conversation message too', async () => {
    addAttachment('att-1', 'a.png');
    const res = await app.inject({
      method: 'POST',
      url: `/api/dm/${DM}/messages`,
      headers: headers(MEMBER),
      payload: { content: 'look', attachments: ['att-1'], spoilerAttachments: ['att-1'] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().attachments[0].spoiler).toBe(true);
  });
});
