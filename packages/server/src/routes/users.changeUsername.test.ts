import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USERNAME_LIMITS } from '@backspace/shared/src/usernames.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { hashPassword, signJwt } from '../utils/auth.js';

setWorkerId(27);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
const sent: Array<[string, Record<string, unknown>]> = [];
const relayed = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (userId: string, event: Record<string, unknown>) => { sent.push([userId, event]); },
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    setUserShowActivity: vi.fn(),
    clearUserActivities: vi.fn(),
    getUserStatus: vi.fn(() => 'online'),
    forceDisconnectUser: vi.fn(),
  },
}));

vi.mock('../utils/federationOutbox.js', async (original) => ({
  ...(await original<typeof import('../utils/federationOutbox.js')>()),
  isFederationRelayEnabled: () => true,
  appendMutationLog: vi.fn(),
  queueOutboxEvent: relayed,
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const ME = '1001';
const FRIEND = '1002';
const PASSWORD = 'a-long-password-1234';
const DAY = 86_400_000;
const auth = () => ({ Authorization: `Bearer ${signJwt({ userId: ME, username: 'mara' })}` });
const change = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/users/@me/username', headers: auth(), payload });
const row = () => testDb.select().from(schema.users).where(eq(schema.users.id, ME)).get()!;

beforeEach(async () => {
  sent.length = 0;
  relayed.mockClear();
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.users).values([
    { id: ME, username: 'mara', displayName: 'Mara', passwordHash: await hashPassword(PASSWORD), createdAt: 1 },
    { id: FRIEND, username: 'noor', displayName: 'Noor', passwordHash: 'x', createdAt: 1 },
  ]).run();
  testDb.insert(schema.dmChannels).values({ id: 'dm', ownerId: null, createdAt: 1 }).run();
  testDb.insert(schema.dmMembers).values([{ dmChannelId: 'dm', userId: ME }, { dmChannelId: 'dm', userId: FRIEND }]).run();
  const { userRoutes } = await import('./users.js');
  app = Fastify();
  await app.register(userRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.useRealTimers();
});

describe('changing a username', () => {
  it('takes the new name, in small letters, and says so to whoever can see the account', async () => {
    const res = await change({ username: '  Mara_New ', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: ME, username: 'mara_new' });
    expect(row().username).toBe('mara_new');
    expect(res.json().user.usernameChangedAt).toBeGreaterThan(0);

    const told = sent.filter(([, event]) => event.type === 'user_updated');
    expect(told.map(([userId]) => userId).sort()).toEqual([ME, FRIEND].sort());
    const toFriend = told.find(([userId]) => userId === FRIEND)?.[1].user as Record<string, unknown>;
    expect(toFriend.username).toBe('mara_new');
    // When it last changed is the account's own business.
    expect(toFriend.usernameChangedAt).toBeUndefined();
  });

  it('notes it in the account\'s security activity', async () => {
    await change({ username: 'mara_new', password: PASSWORD });
    const events = testDb.select().from(schema.securityEvents).where(eq(schema.securityEvents.userId, ME)).all();
    expect(events.map((event) => event.kind)).toContain('username_changed');
  });

  it('goes on signing in with a token that still says the old name', async () => {
    await change({ username: 'mara_new', password: PASSWORD });
    const me = await app.inject({ method: 'GET', url: '/api/users/@me', headers: auth() });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('mara_new');
  });

  it('tells other instances, with a newer version, so they follow', async () => {
    const before = row().profileUpdatedAt ?? 0;
    await change({ username: 'mara_new', password: PASSWORD });
    expect(relayed).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(relayed.mock.calls[0]?.[3])) as { profileUpdate: { username: string; profileUpdatedAt: number; homeUserId: string } };
    expect(payload.profileUpdate).toMatchObject({ username: 'mara_new', homeUserId: ME });
    expect(payload.profileUpdate.profileUpdatedAt).toBeGreaterThan(before);
  });
});

describe('what it takes', () => {
  it('needs an account', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/users/@me/username', payload: { username: 'x_x', password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });

  it('needs the password, and the right one', async () => {
    expect((await change({ username: 'mara_new' })).json().code).toBe('password_required');
    const wrong = await change({ username: 'mara_new', password: 'not-the-password' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe('current_password_incorrect');
    expect(row().username).toBe('mara');
  });

  it('needs the second factor where it is on', async () => {
    testDb.update(schema.users).set({ twoFactorEnabledAt: 1 }).where(eq(schema.users.id, ME)).run();
    const res = await change({ username: 'mara_new', password: PASSWORD });
    expect(res.json().code).toBe('mfa_code_required');
    expect(row().username).toBe('mara');
  });

  it('holds a name to what registration holds it to', async () => {
    const code = async (username: unknown) => (await change({ username, password: PASSWORD })).json().code;
    expect(await code('ab')).toBe('username_length_invalid');
    expect(await code('a'.repeat(USERNAME_LIMITS.MAX_LENGTH + 1))).toBe('username_length_invalid');
    expect(await code('with space')).toBe('username_characters_invalid');
    expect(await code('no-dash')).toBe('username_characters_invalid');
    expect(await code('name@host')).toBe('username_characters_invalid');
    expect(await code(42)).toBe('validation_failed');
    expect(await code('MARA')).toBe('username_same');
    expect(row().username).toBe('mara');
  });

  it('will not take a name someone has', async () => {
    const res = await change({ username: 'noor', password: PASSWORD });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('username_taken');
  });

  it('will not take a name on the operator\'s list', async () => {
    testDb.insert(schema.signupRules).values({ kind: 'username', value: 'admin', createdAt: 1, createdBy: ME }).run();
    expect((await change({ username: 'admin', password: PASSWORD })).json().code).toBe('username_reserved');
  });
});

describe('how often, and what happens to the old name', () => {
  it('holds a change for 30 days, then lets another through', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 });
    expect((await change({ username: 'mara_one', password: PASSWORD })).statusCode).toBe(200);
    const soon = await change({ username: 'mara_two', password: PASSWORD });
    expect(soon.statusCode).toBe(429);
    expect(soon.json().code).toBe('username_change_too_soon');
    vi.setSystemTime(1_800_000_000_000 + USERNAME_LIMITS.CHANGE_EVERY_DAYS * DAY + 1);
    expect((await change({ username: 'mara_two', password: PASSWORD })).statusCode).toBe(200);
  });

  it('keeps the old name out of reach for that long, for sign-up and for anyone changing theirs', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 });
    await change({ username: 'mara_new', password: PASSWORD });
    const { usernameHeld } = await import('../utils/usernames.js');
    expect(usernameHeld('mara')).toBe(true);
    expect(usernameHeld('mara_new')).toBe(false);

    testDb.update(schema.users).set({ usernameChangedAt: null }).where(eq(schema.users.id, ME)).run();
    expect((await change({ username: 'mara', password: PASSWORD })).json().code).toBe('username_taken');

    vi.setSystemTime(1_800_000_000_000 + USERNAME_LIMITS.HELD_DAYS * DAY + 1);
    expect(usernameHeld('mara')).toBe(false);
    expect((await change({ username: 'mara', password: PASSWORD })).statusCode).toBe(200);
  });

  it('takes the name that was given up out of the table once it is free again', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 });
    await change({ username: 'mara_one', password: PASSWORD });
    vi.setSystemTime(1_800_000_000_000 + USERNAME_LIMITS.HELD_DAYS * DAY + 1);
    await change({ username: 'mara_two', password: PASSWORD });
    const held = testDb.select().from(schema.retiredUsernames).all().map((entry) => entry.username);
    expect(held).toEqual(['mara_one']);
  });
});

describe('accounts that live elsewhere', () => {
  it('leaves `handle@home` to its home', async () => {
    testDb.update(schema.users).set({ username: 'mara@home.example', homeInstance: 'home.example', homeUserId: '77' }).where(eq(schema.users.id, ME)).run();
    const res = await change({ username: 'mara_new', password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('username_change_home_only');
  });

  it('leaves a detached account its login name', async () => {
    testDb.update(schema.users).set({ username: 'mara@old.example', federationHomeOrphaned: 1 }).where(eq(schema.users.id, ME)).run();
    expect((await change({ username: 'mara_new', password: PASSWORD })).json().code).toBe('username_change_home_only');
  });

  it('waits while the account is connected to other instances, which know it by this name', async () => {
    testDb.update(schema.users).set({ replicatedInstances: JSON.stringify([{ origin: 'https://b.example', username: 'mara@a.example' }]) }).where(eq(schema.users.id, ME)).run();
    expect((await change({ username: 'mara_new', password: PASSWORD })).json().code).toBe('username_change_connected');
    testDb.update(schema.users).set({ replicatedInstances: '[]' }).where(eq(schema.users.id, ME)).run();
    testDb.insert(schema.userFederationRegistry).values({ userId: ME, origin: 'https://b.example', addedAt: 1 }).run();
    expect((await change({ username: 'mara_new', password: PASSWORD })).json().code).toBe('username_change_connected');
  });
});
