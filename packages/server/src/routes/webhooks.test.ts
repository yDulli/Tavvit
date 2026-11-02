import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { WEBHOOK_LIMITS, webhookPath } from '@backspace/shared/src/webhooks.js';
import { splitMentions } from '@backspace/shared/src/mentions.js';
import * as schema from '../db/schema.js';
import { signJwt, verifyAccessToken } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// A webhook's address is a secret that posts into one channel, and nothing more: who may make
// one, that the token is kept only as a hash, what a post may say, and that the account behind
// it stays out of everything that lists people.

setWorkerId(30);
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
      if (name === 'getUserSpaceEntries' || name === 'getAllOnlineUserIds') return [];
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
const HOOKER = 'user-hooks';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const VOICE = 'channel-voice';
const SECRET = 'channel-secret';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { webhookRoutes, _resetWebhookLimitForTests } = await import('./webhooks.js');
const { adminRoutes } = await import('./admin.js');
const { adminConsoleRoutes } = await import('./adminConsole.js');
const { platformAdminRoutes } = await import('./platformAdmin.js');
const { socialRoutes } = await import('./social.js');
const { authRoutes } = await import('./auth.js');
const { dmRoutes } = await import('./dm.js');
const { pathForLog, removeUnusedWebhookAccounts } = await import('../utils/webhookAccounts.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  _resetWebhookLimitForTests();
  for (const id of [OWNER, HOOKER, MEMBER, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id.replace('-', '_'), passwordHash: 'x', isAdmin: id === OWNER ? 1 : 0, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: VOICE, spaceId: SPACE, name: 'lounge', type: 'voice', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', createdAt: 1 }).run();
  for (const id of [OWNER, HOOKER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-hooks', spaceId: SPACE, name: 'Hooks', position: 1, permissions: permissionsToString(PermissionBits.MANAGE_WEBHOOKS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: HOOKER, roleId: 'role-hooks' }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  app = Fastify();
  for (const routes of [webhookRoutes, adminRoutes, adminConsoleRoutes, platformAdminRoutes, socialRoutes, authRoutes, dmRoutes]) await app.register(routes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.unstubAllEnvs();
});

const make = (userId: string, channelId = CHANNEL, name: unknown = 'Builds') => app.inject({
  method: 'POST', url: `/api/channels/${channelId}/webhooks`, headers: headers(userId), payload: { name },
});

async function madeWebhook(name = 'Builds'): Promise<{ id: string; token: string; url: string; userId: string }> {
  const res = await make(OWNER, CHANNEL, name);
  expect(res.statusCode).toBe(201);
  const { webhook, token } = res.json();
  const row = testDb.select().from(schema.webhooks).where(eq(schema.webhooks.id, webhook.id)).get();
  return { id: webhook.id, token, url: webhookPath(webhook.id, token), userId: row!.userId };
}

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, payload });

const messagesInChannel = () => testDb.select().from(schema.messages).where(eq(schema.messages.channelId, CHANNEL)).all();

describe('managing webhooks', () => {
  it('takes MANAGE_WEBHOOKS in a channel the person can see', async () => {
    expect((await make(MEMBER)).statusCode).toBe(403);
    expect((await make(OUTSIDER)).statusCode).toBe(403);
    expect((await make(HOOKER, SECRET)).statusCode).toBe(403);
    expect((await make(HOOKER)).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/webhooks`, headers: headers(MEMBER) })).statusCode).toBe(403);
    const audit = testDb.select().from(schema.spaceAuditLog).all();
    expect(audit.map((row) => row.action)).toEqual(['webhook_create']);
  });

  it('is only for a text channel, within the limits, with a real name', async () => {
    expect((await make(OWNER, VOICE)).json().code).toBe('webhook_not_allowed');
    for (const name of ['', '   ', 7, 'x'.repeat(WEBHOOK_LIMITS.NAME_MAX_LENGTH + 1)]) {
      expect((await make(OWNER, CHANNEL, name)).statusCode).toBe(400);
    }
    for (let i = 0; i < WEBHOOK_LIMITS.PER_CHANNEL_MAX; i += 1) expect((await make(OWNER, CHANNEL, `Hook ${i}`)).statusCode).toBe(201);
    const over = await make(OWNER);
    expect(over.statusCode).toBe(400);
    expect(over.json().code).toBe('webhook_limit_reached');
  });

  it('cannot get around a timeout: someone timed out makes no webhook', async () => {
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 }).where(eq(schema.spaceMembers.userId, HOOKER)).run();
    const res = await make(HOOKER);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('member_timed_out');
  });

  it('keeps only a hash of the token and never gives it out again', async () => {
    const hook = await madeWebhook();
    expect(hook.token.length).toBeGreaterThanOrEqual(43);
    const row = testDb.select().from(schema.webhooks).where(eq(schema.webhooks.id, hook.id)).get();
    expect(JSON.stringify(row)).not.toContain(hook.token);
    const listed = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/webhooks`, headers: headers(OWNER) });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(hook.token);
    expect(listed.body).not.toContain(row!.tokenHash);
    expect(listed.json().webhooks[0]).toMatchObject({ id: hook.id, name: 'Builds', lastUsedAt: null, createdBy: OWNER });
  });

  it('a new token stops the old address at once', async () => {
    const hook = await madeWebhook();
    expect((await app.inject({ method: 'POST', url: `/api/webhooks/${hook.id}/rotate`, headers: headers(MEMBER) })).statusCode).toBe(403);
    const rotated = await app.inject({ method: 'POST', url: `/api/webhooks/${hook.id}/rotate`, headers: headers(OWNER) });
    expect(rotated.statusCode).toBe(200);
    const { token } = rotated.json();
    expect(token).not.toBe(hook.token);
    expect((await post(hook.url, { content: 'old' })).statusCode).toBe(404);
    expect((await post(webhookPath(hook.id, token), { content: 'new' })).statusCode).toBe(201);
  });

  it('renames everywhere its messages show it', async () => {
    const hook = await madeWebhook();
    const res = await app.inject({ method: 'PATCH', url: `/api/webhooks/${hook.id}`, headers: headers(HOOKER), payload: { name: 'Deploys' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Deploys');
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, hook.userId)).get()?.displayName).toBe('Deploys');
    expect((await app.inject({ method: 'PATCH', url: `/api/webhooks/${hook.id}`, headers: headers(MEMBER), payload: { name: 'Mine' } })).statusCode).toBe(403);
  });

  it('deleting stops the address and keeps what it posted; without messages the account goes too', async () => {
    const used = await madeWebhook('Used');
    const unused = await madeWebhook('Unused');
    await post(used.url, { content: 'stays' });
    for (const hook of [used, unused]) {
      expect((await app.inject({ method: 'DELETE', url: `/api/webhooks/${hook.id}`, headers: headers(OWNER) })).statusCode).toBe(200);
    }
    expect((await post(used.url, { content: 'late' })).statusCode).toBe(404);
    expect(messagesInChannel().map((row) => row.content)).toEqual(['stays']);
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, used.userId)).get()).toBeDefined();
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, unused.userId)).get()).toBeUndefined();
  });

  it('a person\'s account going leaves the webhook working, without their name on it', async () => {
    const { tombstoneUser } = await import('../utils/userDeletion.js');
    const made = await make(HOOKER);
    const { webhook, token } = made.json();
    tombstoneUser(HOOKER);
    expect(testDb.select().from(schema.webhooks).where(eq(schema.webhooks.id, webhook.id)).get()?.createdBy).toBeNull();
    expect((await post(webhookPath(webhook.id, token), { content: 'still here' })).statusCode).toBe(201);
  });
});

describe('posting', () => {
  it('writes a message in the channel under the webhook, marked by the server, and tells the channel', async () => {
    const hook = await madeWebhook();
    sent.length = 0;
    const res = await post(hook.url, { content: '  Build **passed**  ' });
    expect(res.statusCode).toBe(201);
    const [row] = messagesInChannel();
    expect(row).toMatchObject({ id: res.json().id, userId: hook.userId, content: 'Build **passed**' });
    const told = sent.find((entry) => entry.to === 'sendToChannel');
    expect(told?.args[1]).toBe(CHANNEL);
    expect(told?.args[2]).toMatchObject({
      type: 'message_created',
      message: { content: 'Build **passed**', user: { id: hook.userId, displayName: 'Builds', accountKind: 'webhook' } },
    });
    const stored = testDb.select().from(schema.webhooks).where(eq(schema.webhooks.id, hook.id)).get();
    expect(stored?.lastUsedAt).toBeGreaterThan(0);
  });

  it('also takes the `text` field, and refuses what is no message', async () => {
    const hook = await madeWebhook();
    expect((await post(hook.url, { text: 'from a Slack-style sender' })).statusCode).toBe(201);
    for (const payload of [{}, { content: '   ' }, { content: 7 }, { content: { nested: true } }]) {
      const res = await post(hook.url, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const tooLong = await post(hook.url, { content: 'x'.repeat(4001) });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().code).toBe('content_too_long');
  });

  it('answers the same for a wrong token and an unknown webhook, and writes nothing', async () => {
    const hook = await madeWebhook();
    const wrong = await post(webhookPath(hook.id, `${hook.token}x`), { content: 'x' });
    const unknown = await post(webhookPath('12345', hook.token), { content: 'x' });
    expect(wrong.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(wrong.body).toBe(unknown.body);
    expect(messagesInChannel()).toEqual([]);
  });

  it('pings nobody: mass mentions and mentions of people or roles lose their force', async () => {
    const hook = await madeWebhook();
    // Someone named after the keyword is a way to it too, and so is the @everyone role.
    testDb.update(schema.users).set({ displayName: 'everyone' }).where(eq(schema.users.id, MEMBER)).run();
    await post(hook.url, { content: `@everyone @here <@${MEMBER}> <@&${SPACE}> look` });
    const [row] = messagesInChannel();
    expect(splitMentions(row?.content ?? '').every((part) => part.kind === 'text')).toBe(true);
    expect(row?.content).toContain('look');
  });

  it('meets the space\'s automatic rules', async () => {
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, blockedWords: JSON.stringify(['forbidden']), updatedAt: 1 }).run();
    const hook = await madeWebhook();
    const res = await post(hook.url, { content: 'a forbidden word' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toMatch(/^automod_/);
    expect(messagesInChannel()).toEqual([]);
    expect((await post(hook.url, { content: 'fine' })).statusCode).toBe(201);
  });

  it('stops at its limit per minute, and only someone with the token can use that up', async () => {
    const hook = await madeWebhook();
    for (let i = 0; i < 50; i += 1) await post(webhookPath(hook.id, 'wrong-token'), { content: 'x' });
    for (let i = 0; i < WEBHOOK_LIMITS.POSTS_PER_MINUTE; i += 1) {
      expect((await post(hook.url, { content: `n${i}` })).statusCode).toBe(201);
    }
    const over = await post(hook.url, { content: 'too many' });
    expect(over.statusCode).toBe(429);
    expect(over.json().code).toBe('rate_limited');
    expect(over.headers['retry-after']).toBe('60');
    const other = await madeWebhook('Other');
    expect((await post(other.url, { content: 'its own limit' })).statusCode).toBe(201);
  });

  it('does not reach the log with its token', () => {
    expect(pathForLog('/api/webhooks/123/s3cret-token?x=1')).toBe('/api/webhooks/123/[token]');
    expect(pathForLog('/api/webhooks/123/rotate')).toBe('/api/webhooks/123/rotate');
    expect(pathForLog('/api/webhooks/123')).toBe('/api/webhooks/123');
    expect(pathForLog('/api/channels/1/messages?around=2')).toBe('/api/channels/1/messages');
  });
});

describe('the account behind a webhook', () => {
  it('cannot sign in, and a token signed for it is refused', async () => {
    const hook = await madeWebhook();
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, hook.userId)).get()!;
    expect(row).toMatchObject({ accountKind: 'webhook', isAdmin: 0, passwordHash: '!', dmPolicy: 'nobody', friendRequestPolicy: 'nobody' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: row.username, password: '!' } });
    expect(login.statusCode).toBe(401);
    expect(() => verifyAccessToken(signJwt({ userId: hook.userId, username: row.username }))).toThrow();
  });

  it('cannot be a person\'s username, whatever a person registers', async () => {
    const hook = await madeWebhook();
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, hook.userId)).get()!;
    expect(row.username).not.toMatch(/^[a-z0-9_]+$/);
  });

  it('is in no admin list, count, search or file', async () => {
    const hook = await madeWebhook('Findme');
    const list = await app.inject({ method: 'GET', url: '/api/admin/users?pageSize=100', headers: headers(OWNER) });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.body).not.toContain(hook.userId);
    expect(list.json().total).toBe(4);

    const overview = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: headers(OWNER) });
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json().users.total).toBe(4);
    await post(hook.url, { content: 'counted as a message, not as someone active' });
    const after = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: headers(OWNER) });
    expect(after.json().users.active7d).toBe(0);

    const dashboard = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: headers(OWNER) });
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    expect(dashboard.body).not.toContain(hook.userId);
    expect(dashboard.json().accounts.total).toBe(4);

    const search = await app.inject({ method: 'GET', url: '/api/admin/search?q=Findme', headers: headers(OWNER) });
    expect(search.statusCode).toBe(200);
    expect(search.body).not.toContain(hook.userId);

    const csv = await app.inject({ method: 'GET', url: '/api/admin/users.csv', headers: headers(OWNER) });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).not.toContain('Findme');
    expect(csv.body).not.toContain(hook.userId);
  });

  it('is found by no person, and takes neither friend requests nor messages', async () => {
    const hook = await madeWebhook('Findme');
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, hook.userId)).get()!;
    const search = await app.inject({ method: 'GET', url: '/api/social/search?q=webhook', headers: headers(MEMBER) });
    expect(search.statusCode).toBe(200);
    expect(search.body).not.toContain(hook.userId);
    const friend = await app.inject({ method: 'POST', url: '/api/social/requests', headers: headers(MEMBER), payload: { username: row.username } });
    expect(friend.statusCode).toBeGreaterThanOrEqual(400);
    const dm = await app.inject({ method: 'POST', url: '/api/dm', headers: headers(MEMBER), payload: { userId: hook.userId } });
    expect(dm.statusCode).toBeGreaterThanOrEqual(400);
    expect(testDb.select().from(schema.dmChannels).all()).toEqual([]);
  });

  it('cannot be made an admin, given a password or deleted as if it were a person', async () => {
    const hook = await madeWebhook();
    const auth = headers(OWNER);
    const role = await app.inject({ method: 'PATCH', url: `/api/admin/users/${hook.userId}/role`, headers: auth, payload: { isAdmin: true } });
    expect(role.statusCode).toBe(404);
    const reset = await app.inject({ method: 'POST', url: `/api/admin/users/${hook.userId}/reset-password`, headers: auth });
    expect(reset.statusCode).toBe(404);
    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/users/${hook.userId}`, headers: auth, payload: {} });
    expect(removed.statusCode).toBe(404);
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, hook.userId)).get()).toMatchObject({ isAdmin: 0, passwordHash: '!', isDeleted: 0 });
  });

  it('goes away with its channel when no message is left', async () => {
    const hook = await madeWebhook();
    await post(hook.url, { content: 'gone with the channel' });
    testDb.delete(schema.channels).where(eq(schema.channels.id, CHANNEL)).run();
    expect(testDb.select().from(schema.webhooks).all()).toEqual([]);
    expect(removeUnusedWebhookAccounts()).toBe(1);
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, hook.userId)).get()).toBeUndefined();
  });
});
