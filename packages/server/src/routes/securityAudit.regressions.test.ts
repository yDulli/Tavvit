import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';

// What the security audit of 2026-11-14 found in spaces, each held here so it cannot come back:
//
// - Whoever managed roles could write an override on themselves into a channel or category kept
//   from their own roles, and so read and manage it. Overrides are now read and written only by
//   someone who sees the place, and what a write gives must be held there.
// - A kick or leaving left the roles and the overrides naming the person behind. They came back
//   to whoever joined again, and nobody could take them away meanwhile.
// - A ban left a waiting request to join in place, and accepting it later brought the person in.
// - A list of keywords was read whole before it was counted.

setWorkerId(31);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'owner';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
  requireAdmin: async () => undefined,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (): unknown => {
      if (name === 'getUserSpaceEntries') return new Map<string, Set<string>>().entries();
      if (name === 'getRoomParticipants') return new Set<string>();
      return undefined;
    },
  }),
}));

vi.mock('../ws/events.js', () => ({
  checkVoicePermissions: vi.fn(),
  disconnectMemberFromSpaceVoice: vi.fn(),
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(migrationsDir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (statement.trim()) db.exec(statement.trim());
    }
  }
}

const SPACE = 'space-1';
const MOD_ROLE = 'role-mod';
const BOARD_ROLE = 'role-board';
const GENERAL = 'channel-general';
const BOARD = 'channel-board';
const NEWS = 'channel-news';
const STAFF = 'category-staff';
const now = 1_700_000_000_000;
const { VIEW_CHANNEL, SEND_MESSAGES, READ_MESSAGE_HISTORY, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, MANAGE_MESSAGES } = PermissionBits;
const bits = (value: bigint): string => permissionsToString(value);

let app: FastifyInstance;

const as = (userId: string) => { currentUserId = userId; };
const put = (place: 'channels' | 'categories', id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/${place}/${id}/overrides`, payload: body });
const memberOverride = (channelId: string, userId: string) => testDb.select().from(schema.channelOverrides)
  .where(and(eq(schema.channelOverrides.channelId, channelId), eq(schema.channelOverrides.targetType, 'member'), eq(schema.channelOverrides.targetId, userId))).get();
const rolesOf = (userId: string) => testDb.select().from(schema.memberRoles)
  .where(and(eq(schema.memberRoles.spaceId, SPACE), eq(schema.memberRoles.userId, userId))).all().map((row) => row.roleId);

beforeEach(async () => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';

  for (const id of ['owner', 'mod', 'member', 'outsider']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: now }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'owner', inviteCode: 'code', visibility: 'request', createdAt: now }).run();
  for (const userId of ['owner', 'mod', 'member']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId, joinedAt: now }).run();
  }
  testDb.insert(schema.roles).values([
    { id: SPACE, spaceId: SPACE, name: '@everyone', position: 0, permissions: bits(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY), createdAt: now },
    { id: MOD_ROLE, spaceId: SPACE, name: 'Mod', position: 1, permissions: bits(VIEW_CHANNEL | SEND_MESSAGES | MANAGE_ROLES | KICK_MEMBERS | BAN_MEMBERS | MANAGE_MESSAGES), createdAt: now },
    { id: BOARD_ROLE, spaceId: SPACE, name: 'Board', position: 2, permissions: bits(VIEW_CHANNEL | SEND_MESSAGES), createdAt: now },
  ]).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: 'mod', roleId: MOD_ROLE }).run();
  testDb.insert(schema.channelCategories).values({ id: STAFF, spaceId: SPACE, name: 'Staff', position: 0, createdAt: now }).run();
  testDb.insert(schema.channels).values([
    { id: GENERAL, spaceId: SPACE, name: 'general', type: 'text', position: 0, createdAt: now },
    { id: BOARD, spaceId: SPACE, name: 'board', type: 'text', position: 1, createdAt: now },
    { id: NEWS, spaceId: SPACE, name: 'news', type: 'text', position: 2, createdAt: now },
  ]).run();
  // The board's channel: hidden from everyone but the Board. News: everyone reads, only the Board writes.
  testDb.insert(schema.channelOverrides).values([
    { channelId: BOARD, targetType: 'role', targetId: SPACE, allow: '0', deny: bits(VIEW_CHANNEL) },
    { channelId: BOARD, targetType: 'role', targetId: BOARD_ROLE, allow: bits(VIEW_CHANNEL), deny: '0' },
    { channelId: NEWS, targetType: 'role', targetId: SPACE, allow: '0', deny: bits(SEND_MESSAGES) },
    { channelId: NEWS, targetType: 'role', targetId: BOARD_ROLE, allow: bits(SEND_MESSAGES), deny: '0' },
  ]).run();
  testDb.insert(schema.categoryOverrides).values({ categoryId: STAFF, targetType: 'role', targetId: SPACE, allow: '0', deny: bits(VIEW_CHANNEL) }).run();

  const { spaceRoutes } = await import('./spaces.js');
  const { channelRoutes } = await import('./channels.js');
  const { keywordRoutes } = await import('./keywords.js');
  app = Fastify();
  await app.register(spaceRoutes);
  await app.register(channelRoutes);
  await app.register(keywordRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('overrides are for those who see the place', () => {
  it('does not show a hidden channel\'s overrides to someone who manages roles but cannot see it', async () => {
    as('mod');
    const res = await app.inject({ method: 'GET', url: `/api/channels/${BOARD}/overrides` });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'VIEW_CHANNEL' } });
  });

  it('does not let them write themselves into it, nor change or remove what keeps them out', async () => {
    const { computePermissions } = await import('../utils/permissions.js');
    as('mod');
    const self = await put('channels', BOARD, { targetType: 'member', targetId: 'mod', allow: bits(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY), deny: '0' });
    expect(self.statusCode).toBe(403);
    expect(memberOverride(BOARD, 'mod')).toBeUndefined();
    expect((await put('channels', BOARD, { targetType: 'role', targetId: SPACE, allow: bits(VIEW_CHANNEL), deny: '0' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/channels/${BOARD}/overrides/role/${SPACE}` })).statusCode).toBe(403);
    expect(computePermissions('mod', SPACE, BOARD) & VIEW_CHANNEL).toBe(0n);
  });

  it('holds a hidden category the same way', async () => {
    as('mod');
    expect((await app.inject({ method: 'GET', url: `/api/categories/${STAFF}/overrides` })).statusCode).toBe(403);
    const self = await put('categories', STAFF, { targetType: 'member', targetId: 'mod', allow: bits(VIEW_CHANNEL), deny: '0' });
    expect(self.statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/categories/${STAFF}/overrides/role/${SPACE}` })).statusCode).toBe(403);
  });

  it('gives nothing in a channel that its giver does not hold there', async () => {
    const { computePermissions } = await import('../utils/permissions.js');
    as('mod');
    // The moderator reads News and may not write there: neither may they hand out writing, to anyone.
    expect(computePermissions('mod', SPACE, NEWS) & SEND_MESSAGES).toBe(0n);
    for (const targetId of ['mod', 'member']) {
      const res = await put('channels', NEWS, { targetType: 'member', targetId, allow: bits(SEND_MESSAGES), deny: '0' });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('cannot_grant_unowned_permissions');
    }
    // Nor by taking away what denies it.
    const lifted = await app.inject({ method: 'DELETE', url: `/api/channels/${NEWS}/overrides/role/${SPACE}` });
    expect(lifted.statusCode).toBe(403);
    expect(computePermissions('mod', SPACE, NEWS) & SEND_MESSAGES).toBe(0n);
  });

  it('still lets a moderator moderate where they stand', async () => {
    as('mod');
    const denied = await put('channels', GENERAL, { targetType: 'member', targetId: 'member', allow: '0', deny: bits(SEND_MESSAGES) });
    expect(denied.statusCode).toBe(200);
    expect(memberOverride(GENERAL, 'member')?.deny).toBe(bits(SEND_MESSAGES));
    // And undo it: they hold what they give back.
    expect((await app.inject({ method: 'DELETE', url: `/api/channels/${GENERAL}/overrides/member/member` })).statusCode).toBe(200);
    expect(memberOverride(GENERAL, 'member')).toBeUndefined();
  });

  it('keeps whoever makes a place private in it, so they can take it back', async () => {
    const { computePermissions, computeCategoryPermissions } = await import('../utils/permissions.js');
    testDb.insert(schema.channelCategories).values({ id: 'category-open', spaceId: SPACE, name: 'Open', position: 1, createdAt: now }).run();
    as('mod');
    // The Private switch: @everyone's View Channels denied. No allowed role is the moderator's.
    expect((await put('channels', GENERAL, { targetType: 'role', targetId: SPACE, allow: '0', deny: bits(VIEW_CHANNEL) })).statusCode).toBe(200);
    expect(computePermissions('member', SPACE, GENERAL) & VIEW_CHANNEL).toBe(0n);
    expect(computePermissions('mod', SPACE, GENERAL) & VIEW_CHANNEL).toBe(VIEW_CHANNEL);
    // Nothing but sight came with it.
    expect(memberOverride(GENERAL, 'mod')).toMatchObject({ allow: bits(VIEW_CHANNEL), deny: '0' });
    // And back.
    expect((await app.inject({ method: 'DELETE', url: `/api/channels/${GENERAL}/overrides/role/${SPACE}` })).statusCode).toBe(200);
    expect(computePermissions('member', SPACE, GENERAL) & VIEW_CHANNEL).toBe(VIEW_CHANNEL);

    expect((await put('categories', 'category-open', { targetType: 'role', targetId: SPACE, allow: '0', deny: bits(VIEW_CHANNEL) })).statusCode).toBe(200);
    expect(computeCategoryPermissions('mod', SPACE, 'category-open') & VIEW_CHANNEL).toBe(VIEW_CHANNEL);
    expect(computeCategoryPermissions('member', SPACE, 'category-open') & VIEW_CHANNEL).toBe(0n);
    expect((await app.inject({ method: 'DELETE', url: `/api/categories/category-open/overrides/role/${SPACE}` })).statusCode).toBe(200);
  });

  it('names only members of the space, so no text of any length can be stored as one', async () => {
    as('mod');
    for (const targetId of ['outsider', 'nobody-at-all', 'x'.repeat(50_000)]) {
      const res = await put('channels', GENERAL, { targetType: 'member', targetId, allow: '0', deny: '0' });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('member_not_found');
    }
    expect(testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, GENERAL)).all()).toEqual([]);
  });

  it('leaves the owner free to set up any channel', async () => {
    as('owner');
    expect((await app.inject({ method: 'GET', url: `/api/channels/${BOARD}/overrides` })).statusCode).toBe(200);
    expect((await put('channels', BOARD, { targetType: 'member', targetId: 'member', allow: bits(VIEW_CHANNEL), deny: '0' })).statusCode).toBe(200);
    expect((await put('categories', STAFF, { targetType: 'role', targetId: MOD_ROLE, allow: bits(VIEW_CHANNEL), deny: '0' })).statusCode).toBe(200);
  });
});

describe('what a membership held goes with it', () => {
  beforeEach(() => {
    testDb.insert(schema.channelOverrides).values({ channelId: GENERAL, targetType: 'member', targetId: 'mod', allow: bits(MANAGE_MESSAGES), deny: '0' }).run();
    testDb.insert(schema.categoryOverrides).values({ categoryId: STAFF, targetType: 'member', targetId: 'mod', allow: bits(VIEW_CHANNEL), deny: '0' }).run();
    testDb.insert(schema.spaceEvents).values({ id: 'event-1', spaceId: SPACE, title: 'Raid', startsAt: now + 1000, createdAt: now }).run();
    testDb.insert(schema.spaceEventRsvps).values({ eventId: 'event-1', userId: 'mod', createdAt: now }).run();
  });

  const held = () => ({
    roles: rolesOf('mod'),
    channelOverride: memberOverride(GENERAL, 'mod') !== undefined,
    categoryOverride: testDb.select().from(schema.categoryOverrides).where(eq(schema.categoryOverrides.targetId, 'mod')).all().length > 0,
    rsvps: testDb.select().from(schema.spaceEventRsvps).where(eq(schema.spaceEventRsvps.userId, 'mod')).all().length,
  });

  it('on a kick: the roles, the overrides naming them and what they signed up for', async () => {
    const { computePermissions } = await import('../utils/permissions.js');
    expect(held()).toEqual({ roles: [MOD_ROLE], channelOverride: true, categoryOverride: true, rsvps: 1 });
    as('owner');
    expect((await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/members/mod`, payload: {} })).statusCode).toBe(200);
    expect(held()).toEqual({ roles: [], channelOverride: false, categoryOverride: false, rsvps: 0 });

    // Joining again is joining as new: what @everyone holds, and no more.
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: 'mod', joinedAt: now + 1 }).run();
    const again = computePermissions('mod', SPACE);
    expect(again & (MANAGE_ROLES | KICK_MEMBERS | BAN_MEMBERS)).toBe(0n);
    expect(computePermissions('mod', SPACE, GENERAL) & MANAGE_MESSAGES).toBe(0n);
  });

  it('on leaving', async () => {
    as('mod');
    expect((await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/members/mod`, payload: {} })).statusCode).toBe(200);
    expect(held()).toEqual({ roles: [], channelOverride: false, categoryOverride: false, rsvps: 0 });
  });

  it('on a ban, which also answers a request to join that still waits', async () => {
    testDb.insert(schema.joinRequests).values({ id: 'request-1', spaceId: SPACE, userId: 'outsider', status: 'pending', createdAt: now }).run();
    as('owner');
    expect((await app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/bans`, payload: { userId: 'mod' } })).statusCode).toBe(200);
    expect(held()).toEqual({ roles: [], channelOverride: false, categoryOverride: false, rsvps: 0 });

    expect((await app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/bans`, payload: { userId: 'outsider' } })).statusCode).toBe(200);
    const request = testDb.select().from(schema.joinRequests).where(eq(schema.joinRequests.id, 'request-1')).get();
    expect(request).toMatchObject({ status: 'declined', decidedBy: 'owner' });
  });

  it('and what was left behind before is taken at the next start', async () => {
    const { removeGrantsWithoutMembership } = await import('../db/migrate.js');
    // As a kick left it until now: the member row gone, the rest still there.
    testDb.delete(schema.spaceMembers).where(and(eq(schema.spaceMembers.spaceId, SPACE), eq(schema.spaceMembers.userId, 'mod'))).run();
    testDb.insert(schema.channelOverrides).values({ channelId: GENERAL, targetType: 'member', targetId: 'member', allow: '0', deny: bits(SEND_MESSAGES) }).run();
    expect(held().roles).toEqual([MOD_ROLE]);

    removeGrantsWithoutMembership(sqlite);

    expect(held()).toMatchObject({ roles: [], channelOverride: false, categoryOverride: false });
    // A member's override, and every override on a role, stay.
    expect(memberOverride(GENERAL, 'member')).toBeDefined();
    expect(testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.targetType, 'role')).all()).toHaveLength(4);
    removeGrantsWithoutMembership(sqlite);
    expect(memberOverride(GENERAL, 'member')).toBeDefined();
  });
});

describe('a list of keywords', () => {
  it('is counted before it is read', async () => {
    as('member');
    const words = Array.from({ length: 120_000 }, (_unused, at) => `w${at.toString(36)}`);
    const started = Date.now();
    const res = await app.inject({ method: 'PUT', url: '/api/users/@me/keywords', payload: { keywords: words } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('keyword_limit_reached');
    // Read whole it took seconds, with nobody else answered meanwhile.
    expect(Date.now() - started).toBeLessThan(1500);
    expect(testDb.select().from(schema.notificationKeywords).all()).toEqual([]);
  });

  it('still takes a short one', async () => {
    as('member');
    const res = await app.inject({ method: 'PUT', url: '/api/users/@me/keywords', payload: { keywords: ['raid', 'patch'] } });
    expect(res.statusCode).toBe(200);
  });
});
