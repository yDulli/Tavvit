import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { WELCOME_LIMITS } from '@backspace/shared/src/welcome.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// A space's welcome and rules: who may set them, and that rules hold back only those who joined after.

setWorkerId(29);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => () => (name === 'getUserSpaceEntries' ? [] : undefined),
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
const ADMIN = 'user-admin';
const OLD_MEMBER = 'user-old';
const OUTSIDER = 'user-outsider';
const NEWCOMER = 'user-new';
const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const CHANNEL = 'channel-1';
const SECRET = 'channel-secret';
const FOREIGN = 'channel-foreign';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { welcomeRoutes } = await import('./welcome.js');
const { messageRoutes } = await import('./messages.js');
const { memberActionRefusal } = await import('../utils/spaceModeration.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of [OWNER, ADMIN, OLD_MEMBER, OUTSIDER, NEWCOMER]) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: OTHER_SPACE, name: 'Other', ownerId: OUTSIDER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: FOREIGN, spaceId: OTHER_SPACE, name: 'theirs', type: 'text', createdAt: 1 }).run();
  for (const id of [OWNER, ADMIN, OLD_MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-admin', spaceId: SPACE, name: 'Admin', position: 1, permissions: permissionsToString(PermissionBits.MANAGE_SPACE), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: ADMIN, roleId: 'role-admin' }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  app = Fastify();
  await app.register(welcomeRoutes);
  await app.register(messageRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const put = (userId: string, payload: Record<string, unknown>) => app.inject({
  method: 'PUT', url: `/api/spaces/${SPACE}/welcome`, headers: headers(userId), payload,
});
const get = (userId: string) => app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/welcome`, headers: headers(userId) });
const accept = (userId: string) => app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/rules/accept`, headers: headers(userId) });
const join = (userId: string, joinedAt = Date.now() + 1000) => testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId, joinedAt }).run();
const post = (userId: string) => app.inject({
  method: 'POST', url: `/api/channels/${CHANNEL}/messages`, headers: headers(userId), payload: { content: 'Hello' },
});

describe('setting the welcome', () => {
  it('takes the right to manage the space, and is read by members only', async () => {
    expect((await put(OLD_MEMBER, { welcomeText: 'Hi' })).statusCode).toBe(403);
    expect((await put(OUTSIDER, { welcomeText: 'Hi' })).statusCode).toBe(403);
    const res = await put(ADMIN, { welcomeText: '  Hi there  ', rulesText: 'Be kind', channelIds: [CHANNEL] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ welcomeText: 'Hi there', rulesText: 'Be kind', rulesRequired: false, mustAccept: false, channels: [{ id: CHANNEL, name: 'general' }] });
    expect(testDb.select().from(schema.spaceAuditLog).all().map((row) => row.action)).toEqual(['welcome_update']);
    expect((await get(OLD_MEMBER)).json()).toMatchObject({ welcomeText: 'Hi there' });
    expect((await get(OUTSIDER)).statusCode).toBe(403);
  });

  it('refuses what does not fit', async () => {
    for (const payload of [
      { welcomeText: 'x'.repeat(WELCOME_LIMITS.WELCOME_MAX_LENGTH + 1) },
      { rulesText: 'x'.repeat(WELCOME_LIMITS.RULES_MAX_LENGTH + 1) },
      { rulesRequired: true },
      { rulesText: '   ', rulesRequired: true },
      { channelIds: [FOREIGN] },
      { channelIds: ['missing'] },
      { channelIds: Array.from({ length: WELCOME_LIMITS.CHANNELS_MAX + 1 }, (_, i) => `c${i}`) },
    ]) {
      const res = await put(OWNER, payload);
      expect(res.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
  });

  it('names to each reader only the channels they can see', async () => {
    await put(OWNER, { channelIds: [CHANNEL, SECRET] });
    expect((await get(OWNER)).json().channels.map((c: { id: string }) => c.id)).toEqual([CHANNEL, SECRET]);
    expect((await get(OLD_MEMBER)).json().channels.map((c: { id: string }) => c.id)).toEqual([CHANNEL]);
  });
});

describe('required rules', () => {
  beforeEach(async () => {
    await put(OWNER, { rulesText: 'Be kind', rulesRequired: true });
  });

  it('hold back someone who joined after, across every way of taking part, until they agree', async () => {
    join(NEWCOMER);
    expect((await get(NEWCOMER)).json()).toMatchObject({ mustAccept: true, acceptedAt: null, rulesRequired: true });
    expect(memberActionRefusal(SPACE, NEWCOMER)).toMatchObject({ status: 403, code: 'rules_not_accepted' });
    const refused = await post(NEWCOMER);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('rules_not_accepted');

    const agreed = await accept(NEWCOMER);
    expect(agreed.statusCode).toBe(200);
    expect(agreed.json()).toMatchObject({ mustAccept: false });
    expect(agreed.json().acceptedAt).toBeGreaterThan(0);
    expect(memberActionRefusal(SPACE, NEWCOMER)).toBeNull();
    expect((await post(NEWCOMER)).statusCode).toBe(201);
  });

  it('do not lock out those who were already there, those who run the space, or its owner', async () => {
    expect((await get(OLD_MEMBER)).json().mustAccept).toBe(false);
    expect(memberActionRefusal(SPACE, OLD_MEMBER)).toBeNull();
    expect((await post(OLD_MEMBER)).statusCode).toBe(201);

    testDb.delete(schema.spaceMembers).where(eq(schema.spaceMembers.userId, ADMIN)).run();
    join(ADMIN);
    expect((await get(ADMIN)).json().mustAccept).toBe(false);

    testDb.update(schema.spaceMembers).set({ joinedAt: Date.now() + 1000 }).where(eq(schema.spaceMembers.userId, OWNER)).run();
    expect(memberActionRefusal(SPACE, OWNER)).toBeNull();
  });

  it('name a timeout first: it says when it ends', () => {
    join(NEWCOMER);
    const until = Date.now() + 60_000;
    testDb.update(schema.spaceMembers).set({ timedOutUntil: until }).where(eq(schema.spaceMembers.userId, NEWCOMER)).run();
    expect(memberActionRefusal(SPACE, NEWCOMER)).toMatchObject({ code: 'member_timed_out', details: { until } });
  });

  it('count from when they were first required: saving again does not move the moment', async () => {
    const before = testDb.select().from(schema.spaces).where(eq(schema.spaces.id, SPACE)).get()?.rulesRequiredSince;
    expect(before).toBeGreaterThan(0);
    await put(OWNER, { rulesText: 'Be kinder', rulesRequired: true });
    expect(testDb.select().from(schema.spaces).where(eq(schema.spaces.id, SPACE)).get()?.rulesRequiredSince).toBe(before);
  });

  it('turned off free everyone, and turned on again ask only those who join after that', async () => {
    join(NEWCOMER);
    await put(OWNER, { rulesText: 'Be kind', rulesRequired: false });
    expect(memberActionRefusal(SPACE, NEWCOMER)).toBeNull();

    testDb.update(schema.spaceMembers).set({ joinedAt: Date.now() - 1000 }).where(eq(schema.spaceMembers.userId, NEWCOMER)).run();
    await put(OWNER, { rulesText: 'Be kind', rulesRequired: true });
    expect(memberActionRefusal(SPACE, NEWCOMER)).toBeNull();
  });

  it('are agreed to by members only', async () => {
    expect((await accept(OUTSIDER)).statusCode).toBe(403);
  });
});
