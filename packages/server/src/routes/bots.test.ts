import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { BOT_LIMITS, BOT_ROUTES, BOT_SOCKET_EVENTS, cleanCommand, parseCommandText } from '@backspace/shared/src/bots.js';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';
import { checkBotAccess, verifyBotToken } from '../utils/botAccess.js';
import { signJwt, verifyAccessToken } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// A bot's token opens only what is on the list below. A route that is not on it refuses one, so
// the account, mail, admin and two-factor routes can never be reached by a program.

setWorkerId(33);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const { sent, connected } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; args: unknown[] }>,
  connected: new Set<string>(),
}));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      sent.push({ to: String(name), args });
      if (name === 'isUserConnected') return connected.has(String(args[0]));
      if (name === 'getUserSpaceEntries' || name === 'getAllOnlineUserIds') return [];
      if (name === 'getUserSpaces') return new Set();
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
const MANAGER = 'user-manager';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const ADMIN = 'user-admin';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const SECRET = 'channel-secret';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });
const botHeaders = (token: string) => ({ authorization: `Bot ${token}` });

/** Every route a bot's token may reach, from the one list the docs are made from too. */
const BOT_ROUTE_NAMES = BOT_ROUTES.map((route) => `${route.method} ${route.path}`).sort();

const modules = {
  bots: () => import('./bots.js').then((m) => m.botRoutes),
  messages: () => import('./messages.js').then((m) => m.messageRoutes),
  spaces: () => import('./spaces.js').then((m) => m.spaceRoutes),
  channels: () => import('./channels.js').then((m) => m.channelRoutes),
  users: () => import('./users.js').then((m) => m.userRoutes),
  auth: () => import('./auth.js').then((m) => m.authRoutes),
  admin: () => import('./admin.js').then((m) => m.adminRoutes),
  platformAdmin: () => import('./platformAdmin.js').then((m) => m.platformAdminRoutes),
  adminConsole: () => import('./adminConsole.js').then((m) => m.adminConsoleRoutes),
  dm: () => import('./dm.js').then((m) => m.dmRoutes),
  social: () => import('./social.js').then((m) => m.socialRoutes),
  email: () => import('./email.js').then((m) => m.emailRoutes),
  twoFactor: () => import('./twoFactor.js').then((m) => m.twoFactorRoutes),
  threads: () => import('./threads.js').then((m) => m.threadRoutes),
  forums: () => import('./forums.js').then((m) => m.forumRoutes),
  translation: () => import('./translation.js').then((m) => m.translationRoutes),
  channelFollows: () => import('./channelFollows.js').then((m) => m.channelFollowRoutes),
  events: () => import('./events.js').then((m) => m.eventRoutes),
  webhooks: () => import('./webhooks.js').then((m) => m.webhookRoutes),
  saved: () => import('./saved.js').then((m) => m.savedRoutes),
  soundboard: () => import('./soundboard.js').then((m) => m.soundboardRoutes),
  pins: () => import('./pins.js').then((m) => m.pinRoutes),
  polls: () => import('./polls.js').then((m) => m.pollRoutes),
  forward: () => import('./forward.js').then((m) => m.forwardRoutes),
  push: () => import('./push.js').then((m) => m.pushRoutes),
  welcome: () => import('./welcome.js').then((m) => m.welcomeRoutes),
  search: () => import('./search.js').then((m) => m.searchRoutes),
  inbox: () => import('./inbox.js').then((m) => m.inboxRoutes),
  moderation: () => import('./spaceModeration.js').then((m) => m.spaceModerationRoutes),
  botFiles: () => import('./botFiles.js').then((m) => m.botFileRoutes),
  accountStorage: () => import('./accountStorage.js').then((m) => m.accountStorageRoutes),
};

let routes: Array<{ route: string; botAllowed: boolean }>;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  connected.clear();
  testDb.insert(schema.instanceSettings).values({ id: 1, botsEnabled: 1, updatedAt: 1 }).run();
  for (const id of [OWNER, MANAGER, MEMBER, OUTSIDER, ADMIN]) {
    testDb.insert(schema.users).values({ id, username: id.replace('-', '_'), passwordHash: 'x', isAdmin: id === ADMIN ? 1 : 0, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', createdAt: 1 }).run();
  for (const id of [OWNER, MANAGER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-mgr', spaceId: SPACE, name: 'Manager', position: 1, permissions: permissionsToString(PermissionBits.MANAGE_SPACE | PermissionBits.MANAGE_ROLES | DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: MANAGER, roleId: 'role-mgr' }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  routes = [];
  app = Fastify();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      routes.push({ route: `${method} ${route.url}`, botAllowed: (route.config as { botAllowed?: boolean } | undefined)?.botAllowed === true });
    }
  });
  for (const load of Object.values(modules)) await app.register(await load());
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.unstubAllEnvs();
});

const makeBot = async (ownerId = OWNER, name = 'Helper') => {
  const res = await app.inject({ method: 'POST', url: '/api/bots', headers: headers(ownerId), payload: { name } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { bot: { id: string; name: string }; token: string };
};
const READS_AND_WRITES = DEFAULT_EVERYONE_PERMISSIONS;
const addToSpace = (botId: string, userId = OWNER, permissions: bigint = READS_AND_WRITES) => app.inject({
  method: 'POST', url: `/api/bots/${botId}/spaces/${SPACE}`, headers: headers(userId), payload: { permissions: permissionsToString(permissions) },
});

describe('what a token opens', () => {
  it('is exactly the list, and no route comes onto it by accident', () => {
    const open = routes.filter((entry) => entry.botAllowed).map((entry) => entry.route).sort();
    expect(open).toEqual(BOT_ROUTE_NAMES);
    expect(routes.length).toBeGreaterThan(150);
  });

  it('holds nothing about accounts, mail, admin, two factors, conversations or friends', () => {
    for (const route of BOT_ROUTE_NAMES) {
      expect(route, route).not.toMatch(/\/api\/(auth|admin|email|dm|social|two-factor|settings|push)\b/);
    }
    for (const entry of routes.filter((item) => /\/api\/(auth|admin|email|dm|social)\b/.test(item.route) || /two-factor|2fa/.test(item.route))) {
      expect(entry.botAllowed, entry.route).toBe(false);
    }
  });

  it('is refused everywhere else, with a real token, whatever the route does', async () => {
    const { token, bot } = await makeBot();
    await addToSpace(bot.id);
    const cases: Array<[string, string, Record<string, unknown>?]> = [
      ['PATCH', '/api/users/@me', { displayName: 'Hacked' }],
      ['DELETE', '/api/users/@me', { password: 'x' }],
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/overview'],
      ['PUT', '/api/admin/bots/enabled', { enabled: true }],
      ['POST', '/api/dm', { userId: MEMBER }],
      ['POST', '/api/social/requests', { username: 'user_member' }],
      ['GET', '/api/bots'],
      ['POST', '/api/bots', { name: 'Another' }],
      ['POST', `/api/bots/${bot.id}/token`],
      ['DELETE', `/api/bots/${bot.id}`],
      ['POST', `/api/bots/${bot.id}/spaces/${SPACE}`, { permissions: '8' }],
      ['GET', `/api/spaces/${SPACE}/audit-log`],
      ['GET', `/api/bots/${bot.id}`],
      ['POST', `/api/spaces/${SPACE}/roles`, { name: 'Mine', permissions: permissionsToString(PermissionBits.ADMINISTRATOR) }],
      ['DELETE', `/api/spaces/${SPACE}`],
      ['GET', '/api/saved'],
    ];
    for (const [method, url, payload] of cases) {
      const res = await app.inject({ method: method as 'GET', url, headers: botHeaders(token), ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().code, `${method} ${url}`).toBe('bot_route_forbidden');
    }
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, bot.id)).get()?.isAdmin).toBe(0);
  });

  it('cannot be used as a person\'s sign-in, and a person\'s kind of token cannot name a bot', async () => {
    const { bot, token } = await makeBot();
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect(() => verifyAccessToken(signJwt({ userId: bot.id, username: 'x' }))).toThrow();
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, bot.id)).get()!;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: row.username, password: '!' } });
    expect(login.statusCode).toBe(401);
  });

  it('keeps a limited list of socket events', () => {
    expect([...BOT_SOCKET_EVENTS].sort()).toEqual(['reaction_add', 'reaction_remove', 'typing_start']);
  });
});

describe('a token', () => {
  it('is shown once and kept only as a hash, and a new one stops the old', async () => {
    const { token, bot } = await makeBot();
    const row = testDb.select().from(schema.bots).where(eq(schema.bots.id, bot.id)).get()!;
    expect(JSON.stringify(row)).not.toContain(token.split('.')[1]);
    const listed = await app.inject({ method: 'GET', url: '/api/bots', headers: headers(OWNER) });
    expect(listed.body).not.toContain(token);
    expect(listed.body).not.toContain(row.tokenHash);

    const me = () => app.inject({ method: 'GET', url: '/api/users/@me', headers: botHeaders(token) });
    expect((await me()).statusCode).toBe(200);
    const rotated = await app.inject({ method: 'POST', url: `/api/bots/${bot.id}/token`, headers: headers(OWNER) });
    expect(rotated.statusCode).toBe(200);
    expect((await me()).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: botHeaders(rotated.json().token) })).statusCode).toBe(200);
  });

  it('answers the same for a wrong secret and an unknown bot', async () => {
    const { token, bot } = await makeBot();
    const wrong = await app.inject({ method: 'GET', url: '/api/users/@me', headers: botHeaders(`${bot.id}.wrong`) });
    const unknown = await app.inject({ method: 'GET', url: '/api/users/@me', headers: botHeaders(`999.${token.split('.')[1]}`) });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  it('stops with the instance\'s switch, a suspended bot, and a suspended or deleted owner', async () => {
    const { token, bot } = await makeBot();
    const me = () => app.inject({ method: 'GET', url: '/api/users/@me', headers: botHeaders(token) });
    expect((await me()).statusCode).toBe(200);

    testDb.update(schema.instanceSettings).set({ botsEnabled: 0 }).run();
    expect((await me()).json().code).toBe('bots_disabled');
    testDb.update(schema.instanceSettings).set({ botsEnabled: 1 }).run();

    testDb.update(schema.users).set({ suspendedAt: 1 }).where(eq(schema.users.id, OWNER)).run();
    expect((await me()).json().code).toBe('bot_owner_suspended');
    expect(() => checkBotAccess(bot.id)).toThrow();
    testDb.update(schema.users).set({ suspendedAt: null }).where(eq(schema.users.id, OWNER)).run();

    testDb.update(schema.users).set({ suspendedAt: 1 }).where(eq(schema.users.id, bot.id)).run();
    expect((await me()).json().code).toBe('account_suspended');
    testDb.update(schema.users).set({ suspendedAt: null }).where(eq(schema.users.id, bot.id)).run();

    const { tombstoneUser } = await import('../utils/userDeletion.js');
    tombstoneUser(OWNER);
    expect((await me()).statusCode).toBe(401);
    expect(() => verifyBotToken(token)).toThrow();
    expect(testDb.select().from(schema.bots).all()).toEqual([]);
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, bot.id)).get()?.isDeleted).toBe(1);
  });
});

describe('owning bots', () => {
  it('is off until the operator turns it on', async () => {
    testDb.update(schema.instanceSettings).set({ botsEnabled: 0 }).run();
    const res = await app.inject({ method: 'POST', url: '/api/bots', headers: headers(OWNER), payload: { name: 'Helper' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('bots_disabled');
    expect((await app.inject({ method: 'GET', url: '/api/bots', headers: headers(OWNER) })).json().enabled).toBe(false);
  });

  it('only the operator turns it on, and sees who runs what', async () => {
    const { bot } = await makeBot();
    expect((await app.inject({ method: 'PUT', url: '/api/admin/bots/enabled', headers: headers(OWNER), payload: { enabled: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/bots', headers: headers(OWNER) })).statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: '/api/admin/bots', headers: headers(ADMIN) });
    expect(list.json().bots[0]).toMatchObject({ id: bot.id, name: 'Helper', ownerId: OWNER, ownerName: 'user_owner', spaces: 0 });
    expect((await app.inject({ method: 'PUT', url: '/api/admin/bots/enabled', headers: headers(ADMIN), payload: { enabled: false } })).json().enabled).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/bots/${bot.id}`, headers: headers(ADMIN) })).statusCode).toBe(200);
    expect(testDb.select().from(schema.platformAuditLog).all().map((row) => row.action).sort()).toEqual(['bot_delete', 'bots_update']);
  });

  it('holds a limit, and someone else\'s bot looks like none at all', async () => {
    for (let i = 0; i < BOT_LIMITS.PER_OWNER; i += 1) await makeBot(OWNER, `Bot ${i}`);
    const over = await app.inject({ method: 'POST', url: '/api/bots', headers: headers(OWNER), payload: { name: 'One more' } });
    expect(over.json().code).toBe('bot_limit_reached');
    const { bot } = await makeBot(MEMBER);
    for (const [method, url, payload] of [
      ['PATCH', `/api/bots/${bot.id}`, { name: 'Mine' }],
      ['POST', `/api/bots/${bot.id}/token`, undefined],
      ['DELETE', `/api/bots/${bot.id}`, undefined],
    ] as const) {
      expect((await app.inject({ method, url, headers: headers(OWNER), ...(payload ? { payload } : {}) })).statusCode, url).toBe(404);
    }
  });

  it('makes accounts that are not people', async () => {
    const { bot } = await makeBot();
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, bot.id)).get()!;
    expect(row).toMatchObject({ accountKind: 'bot', isAdmin: 0, passwordHash: '!', dmPolicy: 'nobody', friendRequestPolicy: 'nobody' });
    expect(row.username).not.toMatch(/^[a-z0-9_]+$/);
    const list = await app.inject({ method: 'GET', url: '/api/admin/users?pageSize=100', headers: headers(ADMIN) });
    expect(list.body).not.toContain(bot.id);
    const role = await app.inject({ method: 'PATCH', url: `/api/admin/users/${bot.id}/role`, headers: headers(ADMIN), payload: { isAdmin: true } });
    expect(role.statusCode).toBe(404);
    const dm = await app.inject({ method: 'POST', url: '/api/dm', headers: headers(MEMBER), payload: { userId: bot.id } });
    expect(dm.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('bringing one into a space', () => {
  it('offers each person the spaces they may manage, and only those', async () => {
    const { bot } = await makeBot();
    const offered = async (userId: string) => (await app.inject({ method: 'GET', url: `/api/bots/${bot.id}/public`, headers: headers(userId) })).json();
    expect(await offered(OWNER)).toMatchObject({ name: 'Helper', ownerName: 'user_owner', spaces: [{ id: SPACE, name: 'Space' }] });
    expect((await offered(MANAGER)).spaces).toEqual([{ id: SPACE, name: 'Space' }]);
    expect((await offered(MEMBER)).spaces).toEqual([]);
    expect((await offered(OUTSIDER)).spaces).toEqual([]);
  });

  it('takes the right to manage the space', async () => {
    const { bot } = await makeBot();
    expect((await addToSpace(bot.id, MEMBER)).statusCode).toBe(403);
    expect((await addToSpace(bot.id, OUTSIDER)).statusCode).toBe(403);
    const res = await addToSpace(bot.id, MANAGER, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES);
    expect(res.statusCode, res.body).toBe(200);
    expect(testDb.select().from(schema.spaceAuditLog).all().map((row) => row.action)).toContain('bot_add');
  });

  it('gives it a role of its own, never ADMINISTRATOR, and only what the person holds', async () => {
    const { bot } = await makeBot();
    const admin = await addToSpace(bot.id, OWNER, PermissionBits.ADMINISTRATOR);
    expect(admin.statusCode).toBe(403);
    expect(admin.json().code).toBe('bot_admin_forbidden');
    const beyond = await addToSpace(bot.id, MANAGER, PermissionBits.BAN_MEMBERS);
    expect(beyond.statusCode).toBe(403);
    expect((await addToSpace(bot.id, OWNER, PermissionBits.VIEW_CHANNEL)).statusCode).toBe(200);
    const role = testDb.select().from(schema.roles).where(eq(schema.roles.botId, bot.id)).get();
    expect(role?.name).toBe('Helper');
    expect(testDb.select().from(schema.memberRoles).where(eq(schema.memberRoles.userId, bot.id)).all().map((row) => row.roleId)).toEqual([role?.id]);
  });

  it('refuses one that is banned or already there, and takes it back into its old role after a kick', async () => {
    const { bot } = await makeBot();
    await addToSpace(bot.id);
    expect((await addToSpace(bot.id)).json().code).toBe('bot_already_member');
    const kicked = await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/members/${bot.id}`, headers: headers(OWNER), payload: {} });
    expect(kicked.statusCode, kicked.body).toBe(200);
    const again = await addToSpace(bot.id);
    expect(again.statusCode, again.body).toBe(200);
    expect(testDb.select().from(schema.roles).where(eq(schema.roles.botId, bot.id)).all()).toHaveLength(1);
  });

  it('is not held back by rules or ages meant for people arriving by themselves', async () => {
    testDb.update(schema.spaces).set({ rulesText: 'Be kind', rulesRequiredSince: 1 }).where(eq(schema.spaces.id, SPACE)).run();
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, minAccountAgeMinutes: 600, minMemberAgeMinutes: 600, updatedAt: 1 }).run();
    const { bot, token } = await makeBot();
    await addToSpace(bot.id);
    const res = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, headers: botHeaders(token), payload: { content: 'Hello' } });
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe('what a bot does in a space', () => {
  const inSpace = async (permissions: bigint = READS_AND_WRITES) => {
    const made = await makeBot();
    await addToSpace(made.bot.id, OWNER, permissions);
    return made;
  };

  it('writes, reads, edits and deletes under its own rights, marked by the server', async () => {
    const { token, bot } = await inSpace();
    const posted = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, headers: botHeaders(token), payload: { content: 'Hello' } });
    expect(posted.statusCode, posted.body).toBe(201);
    expect(posted.json().user).toMatchObject({ id: bot.id, accountKind: 'bot' });
    const told = sent.find((entry) => entry.to === 'sendToChannel');
    expect(told?.args[2]).toMatchObject({ type: 'message_created', message: { user: { accountKind: 'bot' } } });

    const history = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/messages`, headers: botHeaders(token) });
    expect(history.statusCode).toBe(200);

    const { id } = posted.json();
    expect((await app.inject({ method: 'PATCH', url: `/api/messages/${id}`, headers: botHeaders(token), payload: { content: 'Edited' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/messages/${id}`, headers: botHeaders(token) })).statusCode).toBe(200);
  });

  it('sees only what its role lets it, and cannot write outside', async () => {
    const { token } = await inSpace();
    const secret = await app.inject({ method: 'GET', url: `/api/channels/${SECRET}/messages`, headers: botHeaders(token) });
    expect(secret.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/channels/${SECRET}/messages`, headers: botHeaders(token), payload: { content: 'x' } })).statusCode).toBe(403);
    const channels = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/channels`, headers: botHeaders(token) });
    expect(channels.json().map((channel: { id: string }) => channel.id)).toEqual([CHANNEL]);

    testDb.insert(schema.channelOverrides).values({
      channelId: CHANNEL, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.SEND_MESSAGES),
    }).run();
    expect((await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, headers: botHeaders(token), payload: { content: 'x' } })).statusCode).toBe(403);
  });

  it('cannot mention everyone without the right, and meets the automatic rules', async () => {
    const { token } = await inSpace();
    const mass = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, headers: botHeaders(token), payload: { content: '@everyone look' } });
    expect(mass.statusCode).toBe(403);
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, blockedWords: JSON.stringify(['forbidden']), updatedAt: 1 }).run();
    const word = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, headers: botHeaders(token), payload: { content: 'a forbidden word' } });
    expect(word.statusCode).toBe(403);
    expect(word.json().code).toMatch(/^automod_/);
  });

  it('assigns roles only as its own rights allow', async () => {
    const { token } = await inSpace();
    const refused = await app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/members/${MEMBER}/roles`, headers: botHeaders(token), payload: { roleId: 'role-mgr' } });
    expect(refused.statusCode).toBe(403);
    expect(testDb.select().from(schema.memberRoles).where(eq(schema.memberRoles.userId, MEMBER)).all()).toEqual([]);
  });

  it('says who it is and where', async () => {
    const { token, bot } = await inSpace();
    const me = await app.inject({ method: 'GET', url: '/api/bots/@me', headers: botHeaders(token) });
    expect(me.json()).toMatchObject({ bot: { id: bot.id, name: 'Helper' }, spaces: [{ id: SPACE, name: 'Space' }] });
    const asPerson = await app.inject({ method: 'GET', url: '/api/bots/@me', headers: headers(OWNER) });
    expect(asPerson.statusCode).toBe(403);
  });

  it('can be retired, and what it wrote stays', async () => {
    const { token, bot } = await inSpace();
    await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/messages`, headers: botHeaders(token), payload: { content: 'Stays' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/bots/${bot.id}`, headers: headers(OWNER) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: botHeaders(token) })).statusCode).toBe(401);
    expect(testDb.select().from(schema.messages).where(eq(schema.messages.userId, bot.id)).all()).toHaveLength(1);
    expect(testDb.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, bot.id)).all()).toEqual([]);
    expect(testDb.select().from(schema.roles).where(eq(schema.roles.botId, bot.id)).all()).toEqual([]);
  });
});

describe('commands', () => {
  const setup = async () => {
    const made = await makeBot();
    await addToSpace(made.bot.id);
    const set = await app.inject({ method: 'PUT', url: '/api/bots/@me/commands', headers: botHeaders(made.token), payload: { commands: [{ name: 'roll', description: 'Roll a die' }] } });
    expect(set.statusCode, set.body).toBe(200);
    return made;
  };
  const invoke = (botId: string, userId = MEMBER, name = 'roll', channelId = CHANNEL) => app.inject({
    method: 'POST', url: `/api/channels/${channelId}/commands/${botId}/${name}`, headers: headers(userId), payload: { args: '2d6' },
  });

  it('are listed to those who can write in the channel, where the bot can too', async () => {
    const { bot } = await setup();
    const listed = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/commands`, headers: headers(MEMBER) });
    expect(listed.json().commands).toEqual([{ botId: bot.id, botName: 'Helper', name: 'roll', description: 'Roll a die' }]);
    expect((await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/commands`, headers: headers(OUTSIDER) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/channels/${SECRET}/commands`, headers: headers(OWNER) })).json().commands).toEqual([]);
  });

  it('reach the bot with who asked and where, and post nothing in their name', async () => {
    const { bot } = await setup();
    connected.add(bot.id);
    sent.length = 0;
    const res = await invoke(bot.id);
    expect(res.statusCode, res.body).toBe(200);
    const told = sent.find((entry) => entry.to === 'sendToUser');
    expect(told?.args[0]).toBe(bot.id);
    expect(told?.args[1]).toMatchObject({ type: 'command_invoked', name: 'roll', args: '2d6', channelId: CHANNEL, spaceId: SPACE, user: { id: MEMBER } });
    expect((told?.args[1] as { user: Record<string, unknown> }).user).not.toHaveProperty('email');
    expect(testDb.select().from(schema.messages).all()).toEqual([]);
  });

  it('take someone who may write, a bot that is there, and one that is listening', async () => {
    const { bot } = await setup();
    expect((await invoke(bot.id)).json().code).toBe('bot_offline');
    connected.add(bot.id);
    expect((await invoke(bot.id, OUTSIDER)).statusCode).toBe(403);
    expect((await invoke(bot.id, MEMBER, 'nope')).json().code).toBe('bot_command_not_found');
    expect((await invoke(bot.id, OWNER, 'roll', SECRET)).json().code).toBe('bot_command_not_found');
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 }).where(eq(schema.spaceMembers.userId, MEMBER)).run();
    expect((await invoke(bot.id)).json().code).toBe('member_timed_out');
  });

  it('are checked when set, and read from a composer\'s text', async () => {
    const { token } = await setup();
    for (const commands of [[{ name: 'Bad Name', description: 'x' }], [{ name: 'ok', description: '' }], [{ name: 'a', description: 'x' }, { name: 'a', description: 'y' }], 'roll']) {
      expect((await app.inject({ method: 'PUT', url: '/api/bots/@me/commands', headers: botHeaders(token), payload: { commands } })).statusCode).toBe(400);
    }
    expect(cleanCommand({ name: 'roll', description: ' Roll ' })).toEqual({ name: 'roll', description: 'Roll' });
    expect(parseCommandText('/roll 2d6  ')).toEqual({ name: 'roll', args: '2d6' });
    expect(parseCommandText('/roll')).toEqual({ name: 'roll', args: '' });
    expect(parseCommandText('roll')).toBeNull();
    expect(parseCommandText('/Roll it')).toBeNull();
  });
});
