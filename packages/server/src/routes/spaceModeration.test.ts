import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId, generateSnowflake } from '../utils/snowflake.js';
import {
  PermissionBits,
  DEFAULT_EVERYONE_PERMISSIONS,
  permissionsToString,
} from '@backspace/shared/src/permissions.js';
import type { AuditLogResponse, MemberResponse, SpaceModerationSettings } from '@backspace/shared';

// Space moderation on the hosting instance (docs/systems/spaces.md,
// "Moderation"): the rules endpoints, timeouts, the audit log, and how message
// writes over REST and the WebSocket are refused.

setWorkerId(3);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'member';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string; username?: string }) => {
    req.userId = currentUserId;
    req.username = currentUserId;
  },
}));

const sendToUser = vi.fn();
const sendToWs = vi.fn();
const sendToChannel = vi.fn();
const sendToSpace = vi.fn();
const getUserRoom = vi.fn();
const leaveRoom = vi.fn();
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (...args: unknown[]) => sendToUser(...args),
    sendToWs: (...args: unknown[]) => sendToWs(...args),
    sendToChannel: (...args: unknown[]) => sendToChannel(...args),
    sendToSpace: (...args: unknown[]) => sendToSpace(...args),
    getUserRoom: (...args: unknown[]) => getUserRoom(...args),
    leaveRoom: (...args: unknown[]) => leaveRoom(...args),
    clearVoiceWs: vi.fn(),
    clearVoiceUserStatus: vi.fn(),
    addUserSpace: vi.fn(),
    announceSpaceAccessChange: vi.fn(),
    getUserSpaceEntries: () => new Map<string, Set<string>>().entries(),
    pushSpaceVoiceState: vi.fn(),
    sendToDmMembers: vi.fn(),
    sendToRoom: vi.fn(),
    sendToAdmins: vi.fn(),
    getRoom: () => undefined,
    getAllRooms: () => new Map(),
    getAllOnlineUserIds: () => [],
  },
}));

// Embed resolution performs network work; moderation is unrelated to it.
vi.mock('../utils/embedResolver.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/embedResolver.js')>();
  return {
    ...actual,
    resolveEmbeds: vi.fn(async () => {}),
    reResolveEmbeds: vi.fn(async () => {}),
  };
});

const SPACE = 'space';
const CHANNEL = 'channel';
const VOICE = 'voice';
const INVITE = 'abcd1234';
const DAY = 24 * 60 * 60 * 1000;
const LONG_AGO = Date.now() - 400 * DAY;

let app: FastifyInstance;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (sql.trim()) sqlite.exec(sql);
    }
  }
  testDb = drizzle(sqlite, { schema });
  for (const id of ['owner', 'mod', 'helper', 'member', 'stranger']) {
    testDb.insert(schema.users).values({
      id, username: id, displayName: id === 'member' ? 'Mia' : null, passwordHash: 'test', createdAt: LONG_AGO,
    }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'owner', inviteCode: INVITE, createdAt: LONG_AGO }).run();
  testDb.insert(schema.roles).values([
    { id: SPACE, spaceId: SPACE, name: '@everyone', position: 0, permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: LONG_AGO },
    {
      id: 'mods', spaceId: SPACE, name: 'Mods', position: 2, createdAt: LONG_AGO,
      permissions: permissionsToString(PermissionBits.MODERATE_MEMBERS | PermissionBits.VIEW_AUDIT_LOG | PermissionBits.MANAGE_SPACE),
    },
    { id: 'helpers', spaceId: SPACE, name: 'Helpers', position: 1, createdAt: LONG_AGO, permissions: permissionsToString(PermissionBits.MANAGE_MESSAGES) },
  ]).run();
  for (const id of ['owner', 'mod', 'helper', 'member']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: LONG_AGO }).run();
  }
  testDb.insert(schema.memberRoles).values([
    { spaceId: SPACE, userId: 'mod', roleId: 'mods' },
    { spaceId: SPACE, userId: 'helper', roleId: 'helpers' },
  ]).run();
  testDb.insert(schema.channels).values([
    { id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: LONG_AGO },
    { id: VOICE, spaceId: SPACE, name: 'voice', type: 'voice', createdAt: LONG_AGO },
  ]).run();

  currentUserId = 'member';
  for (const fn of [sendToUser, sendToWs, sendToChannel, sendToSpace, leaveRoom]) fn.mockClear();
  getUserRoom.mockReset();
  getUserRoom.mockReturnValue(null);
  const { _resetAuditRetentionSweep } = await import('../utils/auditLog.js');
  _resetAuditRetentionSweep();

  app = Fastify();
  const { messageRoutes } = await import('./messages.js');
  const { spaceRoutes } = await import('./spaces.js');
  const { channelRoutes } = await import('./channels.js');
  const { spaceModerationRoutes } = await import('./spaceModeration.js');
  await app.register(messageRoutes);
  await app.register(spaceRoutes);
  await app.register(channelRoutes);
  await app.register(spaceModerationRoutes);
  await app.ready();
});
afterEach(async () => { await app.close(); sqlite.close(); });

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call(userId: string, method: Method, url: string, payload?: unknown) {
  currentUserId = userId;
  return app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
}

function post(userId: string, content: string) {
  return call(userId, 'POST', `/api/channels/${CHANNEL}/messages`, { content });
}

async function ws(userId: string, event: Record<string, unknown>): Promise<void> {
  const { handleClientEvent } = await import('../ws/events.js');
  handleClientEvent(event, userId, userId, {} as never, false);
}

function seedMessage(userId: string, content: string): string {
  const id = generateSnowflake();
  testDb.insert(schema.messages).values({ id, channelId: CHANNEL, userId, content, createdAt: Date.now() }).run();
  return id;
}

async function setRules(patch: Partial<SpaceModerationSettings>): Promise<void> {
  const res = await call('owner', 'PATCH', `/api/spaces/${SPACE}/moderation`, patch);
  expect(res.statusCode).toBe(200);
}

function memberRow(userId: string) {
  return testDb.select().from(schema.spaceMembers)
    .where(and(eq(schema.spaceMembers.spaceId, SPACE), eq(schema.spaceMembers.userId, userId))).get();
}

function auditRows() {
  return testDb.select().from(schema.spaceAuditLog).all();
}

function errorsTo(userId: string): Array<{ code?: string; details?: Record<string, unknown> }> {
  return sendToUser.mock.calls
    .filter(([to, event]) => to === userId && (event as { type?: string }).type === 'error')
    .map(([, event]) => event as { code?: string; details?: Record<string, unknown> });
}

describe('GET and PATCH /spaces/:id/moderation', () => {
  it('needs MANAGE_SPACE and answers the defaults for a space that never changed them', async () => {
    const refused = await call('member', 'GET', `/api/spaces/${SPACE}/moderation`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'MANAGE_SPACE' } });
    expect((await call('member', 'PATCH', `/api/spaces/${SPACE}/moderation`, { blockLinks: true })).statusCode).toBe(403);

    const res = await call('mod', 'GET', `/api/spaces/${SPACE}/moderation`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      blockedWords: [], blockLinks: false, blockInvites: false, maxMentions: 0,
      minAccountAgeMinutes: 0, minMemberAgeMinutes: 0, updatedAt: null,
    });
    expect((await call('owner', 'GET', '/api/spaces/nope/moderation')).statusCode).toBe(404);
  });

  it('stores the rules as normalized and records what changed', async () => {
    const res = await call('mod', 'PATCH', `/api/spaces/${SPACE}/moderation`, { blockedWords: [' Spoiler ', 'spoiler', ''], blockLinks: true });
    expect(res.statusCode).toBe(200);
    const stored = res.json<SpaceModerationSettings>();
    expect(stored).toMatchObject({ blockedWords: ['Spoiler'], blockLinks: true, blockInvites: false });
    expect(typeof stored.updatedAt).toBe('number');
    expect((await call('owner', 'GET', `/api/spaces/${SPACE}/moderation`)).json()).toEqual(stored);

    const [entry] = auditRows();
    expect(entry).toMatchObject({ action: 'moderation_update', actorId: 'mod', targetType: 'space', targetId: SPACE, targetLabel: 'Space' });
    expect(JSON.parse(entry!.changes!)).toEqual([
      { key: 'blocked_word_added', to: 'Spoiler' },
      { key: 'blockLinks', from: false, to: true },
    ]);
  });

  it('refuses a field that is not valid, a body with none and a body that is not an object, writing nothing', async () => {
    const invalid = await call('owner', 'PATCH', `/api/spaces/${SPACE}/moderation`, { blockLinks: true, maxMentions: 500 });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'moderation_settings_invalid', details: { field: 'maxMentions' } });
    expect((await call('owner', 'PATCH', `/api/spaces/${SPACE}/moderation`, { other: 1 })).json()).toMatchObject({ code: 'no_fields_to_update' });
    expect((await call('owner', 'PATCH', `/api/spaces/${SPACE}/moderation`, ['blockLinks'])).json()).toMatchObject({ code: 'validation_failed' });
    expect(testDb.select().from(schema.spaceModerationSettings).all()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it('writes and records nothing when the rules stay as they are', async () => {
    const res = await call('owner', 'PATCH', `/api/spaces/${SPACE}/moderation`, { blockLinks: false, blockedWords: [] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ updatedAt: null });
    expect(testDb.select().from(schema.spaceModerationSettings).all()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });
});

describe('member timeouts', () => {
  const timeoutUrl = (userId: string) => `/api/spaces/${SPACE}/members/${userId}/timeout`;

  it('needs MODERATE_MEMBERS and refuses the targets kick and ban refuse', async () => {
    const noBit = await call('member', 'PUT', timeoutUrl('helper'), { durationSeconds: 60 });
    expect(noBit.statusCode).toBe(403);
    expect(noBit.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'MODERATE_MEMBERS' } });
    expect((await call('mod', 'PUT', timeoutUrl('mod'), { durationSeconds: 60 })).json()).toMatchObject({ statusCode: 400, code: 'cannot_target_self' });
    expect((await call('mod', 'PUT', timeoutUrl('owner'), { durationSeconds: 60 })).json()).toMatchObject({ statusCode: 400, code: 'cannot_target_owner' });
    expect((await call('mod', 'PUT', timeoutUrl('stranger'), { durationSeconds: 60 })).json()).toMatchObject({ statusCode: 404, code: 'member_not_found' });

    // A lower role with the bit may not reach a member ranked above it.
    testDb.update(schema.roles).set({ permissions: permissionsToString(PermissionBits.MODERATE_MEMBERS) }).where(eq(schema.roles.id, 'helpers')).run();
    expect((await call('helper', 'PUT', timeoutUrl('mod'), { durationSeconds: 60 })).json()).toMatchObject({ statusCode: 403, code: 'role_hierarchy' });
    expect((await call('helper', 'DELETE', timeoutUrl('mod'))).json()).toMatchObject({ statusCode: 403, code: 'role_hierarchy' });
    expect(memberRow('mod')?.timedOutUntil).toBeNull();
  });

  it('takes a whole number of seconds in range and a reason within the limit', async () => {
    for (const durationSeconds of [59, 2_419_201, 60.5, '60', undefined]) {
      const res = await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds });
      expect(res.json()).toMatchObject({ statusCode: 400, code: 'timeout_duration_invalid' });
    }
    const long = await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds: 60, reason: 'x'.repeat(513) });
    expect(long.json()).toMatchObject({ statusCode: 400, code: 'timeout_reason_too_long', details: { max: 512 } });
    expect((await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds: 60, reason: 5 })).json()).toMatchObject({ code: 'validation_failed' });
    expect(memberRow('member')?.timedOutUntil).toBeNull();
    expect(auditRows()).toEqual([]);
  });

  it('times a member out: the answer, member_updated, the audit entry and a voice disconnect', async () => {
    getUserRoom.mockReturnValue({ roomId: VOICE, room: { roomType: 'space', metadata: { type: 'space', spaceId: SPACE }, participants: new Set(['member']) } });
    const before = Date.now();
    const res = await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds: 600, reason: '  spam  ' });
    expect(res.statusCode).toBe(200);
    const { member } = res.json<MemberResponse>();
    expect(member.userId).toBe('member');
    expect(member.timedOutUntil).toBeGreaterThanOrEqual(before + 600_000);
    expect(member.timedOutUntil).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(memberRow('member')?.timedOutUntil).toBe(member.timedOutUntil);
    expect(sendToSpace).toHaveBeenCalledWith(SPACE, { type: 'member_updated', spaceId: SPACE, member });

    expect(leaveRoom).toHaveBeenCalledWith(VOICE, 'member');
    expect(sendToUser).toHaveBeenCalledWith('member', { type: 'voice_disconnected', userId: 'member', channelId: VOICE });

    const [entry] = auditRows();
    expect(entry).toMatchObject({ action: 'member_timeout', actorId: 'mod', targetType: 'member', targetId: 'member', targetLabel: 'Mia', reason: 'spam' });
    expect(JSON.parse(entry!.changes!)).toEqual([{ key: 'durationSeconds', to: 600 }]);
  });

  it('refuses posting, editing, reacting, poking and joining voice while it runs, and lifts it early', async () => {
    const own = seedMessage('member', 'mine');
    const other = seedMessage('owner', 'hello');
    await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds: 3600 });
    const until = memberRow('member')?.timedOutUntil;

    const refused = await post('member', 'hi');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'member_timed_out', details: { until } });
    expect((await call('member', 'PATCH', `/api/messages/${own}`, { content: 'edited' })).json()).toMatchObject({ code: 'member_timed_out' });

    await ws('member', { type: 'message_create', channelId: CHANNEL, content: 'hi' });
    await ws('member', { type: 'reaction_add', messageId: other, emoji: '👍' });
    await ws('member', { type: 'voice_join', channelId: VOICE });
    expect(errorsTo('member').map((e) => e.code)).toEqual(['member_timed_out', 'member_timed_out', 'member_timed_out']);
    expect(errorsTo('member')[0]?.details).toEqual({ until });
    expect(sendToUser).toHaveBeenCalledWith('member', expect.objectContaining({ type: 'voice_disconnected', channelId: VOICE, reason: 'rejected' }));

    // A refused poke goes to the socket that sent it, as every poke refusal does.
    await ws('member', { type: 'channel_poke', channelId: CHANNEL, targetUserId: 'owner' });
    expect(sendToWs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'error', code: 'member_timed_out', details: { until } }));
    expect(testDb.select().from(schema.messages).all()).toHaveLength(2);
    expect(testDb.select().from(schema.reactions).all()).toEqual([]);

    const lifted = await call('mod', 'DELETE', timeoutUrl('member'));
    expect(lifted.statusCode).toBe(200);
    expect(lifted.json<MemberResponse>().member.timedOutUntil).toBeNull();
    expect(auditRows().map((row) => row.action)).toEqual(['member_timeout', 'member_timeout_remove']);
    expect((await post('member', 'back')).statusCode).toBe(201);
  });

  it('reads an ended timeout as none, and a DELETE of none records nothing', async () => {
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() - 1000 })
      .where(and(eq(schema.spaceMembers.spaceId, SPACE), eq(schema.spaceMembers.userId, 'member'))).run();
    const detail = await call('member', 'GET', `/api/spaces/${SPACE}`);
    const members = detail.json<{ members: Array<{ userId: string; timedOutUntil: number | null }> }>().members;
    expect(members.find((m) => m.userId === 'member')?.timedOutUntil).toBeNull();
    expect((await post('member', 'free')).statusCode).toBe(201);

    const res = await call('mod', 'DELETE', timeoutUrl('member'));
    expect(res.json<MemberResponse>().member.timedOutUntil).toBeNull();
    expect(memberRow('member')?.timedOutUntil).toBeNull();
    expect(auditRows()).toEqual([]);
  });

  it('survives leaving and joining again', async () => {
    await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds: 3600 });
    const until = memberRow('member')?.timedOutUntil;
    expect((await call('member', 'DELETE', `/api/spaces/${SPACE}/members/member`)).statusCode).toBe(200);
    expect(memberRow('member')).toBeUndefined();

    sendToSpace.mockClear();
    expect((await call('member', 'POST', '/api/spaces/join', { inviteCode: INVITE })).statusCode).toBe(200);
    expect(memberRow('member')?.timedOutUntil).toBe(until);
    expect(sendToSpace).toHaveBeenCalledWith(SPACE, expect.objectContaining({
      type: 'member_joined', member: expect.objectContaining({ userId: 'member', timedOutUntil: until }),
    }));
    expect(testDb.select().from(schema.spaceDepartedTimeouts).all()).toEqual([]);
    expect((await post('member', 'still out')).json()).toMatchObject({ code: 'member_timed_out' });
  });

  it('is dropped by a ban, one held from an earlier leave included', async () => {
    await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds: 3600 });
    expect((await call('member', 'DELETE', `/api/spaces/${SPACE}/members/member`)).statusCode).toBe(200);
    expect(testDb.select().from(schema.spaceDepartedTimeouts).all()).toHaveLength(1);

    expect((await call('owner', 'POST', `/api/spaces/${SPACE}/bans`, { userId: 'member' })).statusCode).toBe(200);
    expect(testDb.select().from(schema.spaceDepartedTimeouts).all()).toEqual([]);
  });

  it('ends for a member who becomes the owner', async () => {
    await call('mod', 'PUT', timeoutUrl('member'), { durationSeconds: 3600 });
    expect((await call('owner', 'PATCH', `/api/spaces/${SPACE}/transfer-ownership`, { newOwnerId: 'member' })).statusCode).toBe(200);
    expect(memberRow('member')?.timedOutUntil).toBeNull();
    expect(auditRows().map((row) => row.action)).toEqual(['member_timeout', 'ownership_transfer']);
  });
});

describe('message rules', () => {
  it('refuses accounts and memberships younger than the minimum, except for moderators', async () => {
    await setRules({ minAccountAgeMinutes: 60 });
    testDb.update(schema.users).set({ createdAt: Date.now() }).run();
    expect((await post('member', 'hi')).json()).toMatchObject({ statusCode: 403, code: 'account_too_new' });
    expect((await post('helper', 'hi')).statusCode).toBe(201);
    expect((await post('mod', 'hi')).statusCode).toBe(201);

    await setRules({ minAccountAgeMinutes: 0, minMemberAgeMinutes: 60 });
    testDb.update(schema.spaceMembers).set({ joinedAt: Date.now() }).run();
    expect((await post('member', 'hi')).json()).toMatchObject({ statusCode: 403, code: 'membership_too_new' });
    await ws('member', { type: 'message_create', channelId: CHANNEL, content: 'hi' });
    expect(errorsTo('member').map((e) => e.code)).toEqual(['membership_too_new']);
    expect((await post('owner', 'hi')).statusCode).toBe(201);
  });

  it('slows new messages in a slow mode channel, not edits, and not members who manage messages', async () => {
    expect((await call('owner', 'PATCH', `/api/channels/${CHANNEL}`, { slowmodeSeconds: 7 })).json()).toMatchObject({ statusCode: 400, code: 'slowmode_invalid' });
    const set = await call('owner', 'PATCH', `/api/channels/${CHANNEL}`, { slowmodeSeconds: 60 });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ slowmodeSeconds: 60 });
    expect(sendToChannel).toHaveBeenCalledWith(SPACE, CHANNEL, expect.objectContaining({
      type: 'channel_updated', channel: expect.objectContaining({ slowmodeSeconds: 60 }),
    }));

    const first = await post('member', 'one');
    expect(first.statusCode).toBe(201);
    const second = await post('member', 'two');
    expect(second.statusCode).toBe(429);
    const { details } = second.json<{ code: string; details: { retryAfterSeconds: number } }>();
    expect(second.json()).toMatchObject({ code: 'slowmode_active' });
    expect(details.retryAfterSeconds).toBeGreaterThan(0);
    expect(details.retryAfterSeconds).toBeLessThanOrEqual(60);
    await ws('member', { type: 'message_create', channelId: CHANNEL, content: 'three' });
    expect(errorsTo('member').map((e) => e.code)).toEqual(['slowmode_active']);
    expect((await call('member', 'PATCH', `/api/messages/${first.json<{ id: string }>().id}`, { content: 'edited' })).statusCode).toBe(200);

    expect((await post('helper', 'a')).statusCode).toBe(201);
    expect((await post('helper', 'b')).statusCode).toBe(201);

    // The wait is over once the interval has passed since the last post.
    testDb.update(schema.channelSlowmodePosts).set({ postedAt: Date.now() - 61_000 })
      .where(eq(schema.channelSlowmodePosts.userId, 'member')).run();
    expect((await post('member', 'later')).statusCode).toBe(201);

    expect((await call('owner', 'PATCH', `/api/channels/${CHANNEL}`, { slowmodeSeconds: 0 })).statusCode).toBe(200);
    expect(testDb.select().from(schema.channelSlowmodePosts).all()).toEqual([]);
    expect((await post('member', 'free')).statusCode).toBe(201);
    expect(auditRows().map((row) => row.action)).toEqual(['channel_update', 'channel_update']);
  });

  it('applies the automatic rules to new messages and edits over both transports', async () => {
    await setRules({ blockedWords: ['spoiler'], blockLinks: true, blockInvites: true, maxMentions: 1 });
    expect((await post('member', 'no SPOILER here')).json()).toMatchObject({ statusCode: 403, code: 'automod_blocked_word' });
    expect((await post('member', 'see https://example.com')).json()).toMatchObject({ code: 'automod_link_blocked' });
    expect((await post('member', `come to https://other.host/join/${INVITE}`)).json()).toMatchObject({ code: 'automod_invite_blocked' });
    expect((await post('member', '<@owner> <@mod>')).json()).toMatchObject({ code: 'automod_too_many_mentions', details: { max: 1 } });
    expect((await post('member', 'a spoilers word is fine, and so is <@owner>')).statusCode).toBe(201);

    const id = seedMessage('member', 'clean');
    expect((await call('member', 'PATCH', `/api/messages/${id}`, { content: 'spoiler' })).json()).toMatchObject({ code: 'automod_blocked_word' });
    await ws('member', { type: 'message_edit', messageId: id, content: 'www.example.com' });
    await ws('member', { type: 'message_create', channelId: CHANNEL, content: 'spoiler' });
    expect(errorsTo('member').map((e) => e.code)).toEqual(['automod_link_blocked', 'automod_blocked_word']);
    expect(testDb.select().from(schema.messages).where(eq(schema.messages.id, id)).get()?.content).toBe('clean');

    expect((await post('helper', 'spoiler https://example.com <@owner> <@mod>')).statusCode).toBe(201);
  });

  it('checks a timeout before the other rules', async () => {
    await setRules({ blockedWords: ['spoiler'] });
    await call('mod', 'PUT', `/api/spaces/${SPACE}/members/member/timeout`, { durationSeconds: 60 });
    expect((await post('member', 'spoiler')).json()).toMatchObject({ code: 'member_timed_out' });
  });
});

describe('default notification level', () => {
  it('is set by PATCH /spaces/:id, carried on the space and recorded', async () => {
    const res = await call('mod', 'PATCH', `/api/spaces/${SPACE}`, { defaultNotificationLevel: 'all' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ defaultNotificationLevel: 'all' });
    expect(sendToSpace).toHaveBeenCalledWith(SPACE, expect.objectContaining({
      type: 'space_updated', space: expect.objectContaining({ defaultNotificationLevel: 'all' }),
    }));
    expect((await call('mod', 'PATCH', `/api/spaces/${SPACE}`, { defaultNotificationLevel: 'nothing' })).json())
      .toMatchObject({ statusCode: 400, code: 'notification_level_invalid' });
    expect((await call('mod', 'PATCH', `/api/spaces/${SPACE}`, { defaultNotificationLevel: null })).json())
      .toMatchObject({ defaultNotificationLevel: null });

    const entries = auditRows();
    expect(entries.map((row) => row.action)).toEqual(['space_update', 'space_update']);
    expect(JSON.parse(entries[0]!.changes!)).toEqual([{ key: 'defaultNotificationLevel', from: null, to: 'all' }]);
  });
});

describe('GET /spaces/:id/audit-log', () => {
  it('needs VIEW_AUDIT_LOG', async () => {
    const res = await call('helper', 'GET', `/api/spaces/${SPACE}/audit-log`);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'VIEW_AUDIT_LOG' } });
  });

  it('pages newest first with the users the entries name, and filters by action and actor', async () => {
    await call('mod', 'PUT', `/api/spaces/${SPACE}/members/member/timeout`, { durationSeconds: 60 });
    await setRules({ blockLinks: true });
    await call('mod', 'DELETE', `/api/spaces/${SPACE}/members/member/timeout`);

    const all = (await call('mod', 'GET', `/api/spaces/${SPACE}/audit-log`)).json<AuditLogResponse>();
    expect(all.entries.map((e) => e.action)).toEqual(['member_timeout_remove', 'moderation_update', 'member_timeout']);
    expect(all.nextBefore).toBeNull();
    expect(all.users.map((u) => u.id).sort()).toEqual(['member', 'mod', 'owner']);

    const first = (await call('mod', 'GET', `/api/spaces/${SPACE}/audit-log?limit=1`)).json<AuditLogResponse>();
    expect(first.entries.map((e) => e.action)).toEqual(['member_timeout_remove']);
    expect(first.nextBefore).toBe(first.entries[0]?.id);
    const second = (await call('mod', 'GET', `/api/spaces/${SPACE}/audit-log?limit=1&before=${first.nextBefore}`)).json<AuditLogResponse>();
    expect(second.entries.map((e) => e.action)).toEqual(['moderation_update']);

    const byAction = (await call('mod', 'GET', `/api/spaces/${SPACE}/audit-log?action=member_timeout`)).json<AuditLogResponse>();
    expect(byAction.entries.map((e) => e.action)).toEqual(['member_timeout']);
    const byActor = (await call('mod', 'GET', `/api/spaces/${SPACE}/audit-log?actorId=owner`)).json<AuditLogResponse>();
    expect(byActor.entries.map((e) => e.action)).toEqual(['moderation_update']);
    expect(byActor.users.map((u) => u.id)).toEqual(['owner']);

    for (const query of ['limit=abc', 'action=nope', 'before=x1']) {
      expect((await call('mod', 'GET', `/api/spaces/${SPACE}/audit-log?${query}`)).json()).toMatchObject({ statusCode: 400, code: 'validation_failed' });
    }
  });

  it('records a message a moderator deleted, not one its author deleted', async () => {
    const theirs = seedMessage('member', 'oops');
    const mine = seedMessage('helper', 'mine');
    expect((await call('helper', 'DELETE', `/api/messages/${theirs}`)).statusCode).toBe(200);
    expect((await call('helper', 'DELETE', `/api/messages/${mine}`)).statusCode).toBe(200);
    const page = (await call('mod', 'GET', `/api/spaces/${SPACE}/audit-log`)).json<AuditLogResponse>();
    expect(page.entries).toEqual([expect.objectContaining({
      action: 'message_delete', actorId: 'helper', targetType: 'message', targetId: theirs, targetLabel: 'Mia',
      changes: [{ key: 'channel', to: 'general' }],
    })]);
  });

  it('drops entries older than 180 days when it records a new one', async () => {
    const old = Date.now() - 200 * DAY;
    const recent = Date.now() - 100 * DAY;
    testDb.insert(schema.spaceAuditLog).values([
      { id: '1', spaceId: SPACE, actorId: 'owner', action: 'space_update', createdAt: old },
      { id: '2', spaceId: SPACE, actorId: 'owner', action: 'space_update', createdAt: recent },
    ]).run();
    await setRules({ blockInvites: true });
    expect(auditRows().map((row) => row.id).filter((id) => id === '1' || id === '2')).toEqual(['2']);
  });
});
