import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { signJwt } from '../utils/auth.js';

// Linking a Twitch account (docs/systems/linked-accounts.md): only by signing in
// at Twitch, only for the account that started it, one Tavvit account per Twitch
// account, and what the profile then shows. Twitch is a stand-in; nothing leaves the test.

setWorkerId(31);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
const sent: Array<[string, Record<string, unknown>]> = [];
const twitchConfig = vi.hoisted(() => ({ clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://tavvit.test/linked-accounts/twitch' }));

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { config: { ...actual.config, twitch: twitchConfig } };
});

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (userId: string, event: Record<string, unknown>) => { sent.push([userId, event]); },
    getAllOnlineUserIds: () => [],
    isUserOnline: () => false,
    getDerivedActivities: () => [],
  },
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

const ME = '2001';
const OTHER = '2002';
const FRIEND = '2003';
const REMOTE = '2004';
const as = (userId: string, username: string) => ({ Authorization: `Bearer ${signJwt({ userId, username })}` });
const meRow = () => testDb.select().from(schema.users).where(eq(schema.users.id, ME)).get()!;

/** A stand-in for Twitch: the code buys a token naming `account`, and the token is revoked after. */
function twitchSaying(account: { id: string; login: string; display_name: string }) {
  const paths: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === '/oauth2/token') return Response.json({ access_token: 'person-token' });
    if (url.pathname === '/helix/users') return Response.json({ data: [account] });
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { paths, fetchMock };
}

async function start(userId: string, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/users/@me/linked-accounts/twitch/start', headers: as(userId, username) });
  expect(res.statusCode).toBe(200);
  const url = new URL(res.json().url);
  expect(url.host).toBe('id.twitch.tv');
  return url.searchParams.get('state')!;
}

const complete = (userId: string, username: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/users/@me/linked-accounts/twitch', headers: as(userId, username), payload });

beforeEach(async () => {
  sent.length = 0;
  twitchConfig.clientId = 'client-id';
  twitchConfig.clientSecret = 'client-secret';
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.users).values([
    { id: ME, username: 'mara', displayName: 'Mara', passwordHash: 'x', createdAt: 1 },
    { id: OTHER, username: 'diego', passwordHash: 'x', createdAt: 1 },
    { id: FRIEND, username: 'noor', passwordHash: 'x', createdAt: 1 },
    { id: REMOTE, username: 'sam@peer.test', passwordHash: 'x', homeInstance: 'https://peer.test', homeUserId: '9', createdAt: 1 },
  ]).run();
  testDb.insert(schema.friends).values([{ userId: ME, friendId: FRIEND, createdAt: 1 }, { userId: FRIEND, friendId: ME, createdAt: 1 }]).run();
  const { resetLinking } = await import('../utils/linkedAccounts.js');
  resetLinking();
  const { linkedAccountRoutes } = await import('./linkedAccounts.js');
  app = Fastify();
  await app.register(linkedAccountRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.unstubAllGlobals();
});

describe('linking a Twitch account', () => {
  it('links the account Twitch names for the code, and shows it on the profile', async () => {
    const twitch = twitchSaying({ id: '42', login: 'mara_plays', display_name: 'Mara_Plays' });
    const state = await start(ME, 'mara');
    const res = await complete(ME, 'mara', { code: 'the-code', state });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      available: ['twitch'],
      accounts: [{ provider: 'twitch', login: 'mara_plays', name: 'Mara_Plays', showOnProfile: true, showLive: true }],
    });
    expect(twitch.paths).toEqual(['/oauth2/token', '/helix/users', '/oauth2/revoke']);
    expect(JSON.parse(meRow().profileLinkedAccounts!)).toEqual([{ provider: 'twitch', login: 'mara_plays', name: 'Mara_Plays' }]);

    // The person's windows get the list; everyone who sees the profile gets its new look.
    expect(sent.some(([userId, event]) => userId === ME && event.type === 'linked_accounts_update')).toBe(true);
    const toFriend = sent.find(([userId, event]) => userId === FRIEND && event.type === 'user_updated')?.[1].user as Record<string, unknown>;
    expect(toFriend.linkedAccounts).toEqual([{ provider: 'twitch', login: 'mara_plays', name: 'Mara_Plays' }]);
  });

  it('refuses a link started by another account, without asking Twitch about the code', async () => {
    const twitch = twitchSaying({ id: '42', login: 'mara_plays', display_name: 'Mara_Plays' });
    const state = await start(OTHER, 'diego');
    const res = await complete(ME, 'mara', { code: 'the-code', state });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('linked_account_other_account');
    expect(twitch.fetchMock).not.toHaveBeenCalled();
    // Whoever started it can still complete it.
    expect((await complete(OTHER, 'diego', { code: 'the-code', state })).statusCode).toBe(200);
  });

  it('takes a state once, and none it never gave', async () => {
    twitchSaying({ id: '42', login: 'mara_plays', display_name: 'Mara_Plays' });
    const state = await start(ME, 'mara');
    expect((await complete(ME, 'mara', { code: 'the-code', state })).statusCode).toBe(200);
    const again = await complete(ME, 'mara', { code: 'the-code', state });
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('linked_account_expired');
    expect((await complete(ME, 'mara', { code: 'the-code', state: 'made-up' })).json().code).toBe('linked_account_expired');
    expect((await complete(ME, 'mara', { code: 'a code', state })).statusCode).toBe(400);
  });

  it('links one Twitch account to one account here', async () => {
    twitchSaying({ id: '42', login: 'mara_plays', display_name: 'Mara_Plays' });
    await complete(OTHER, 'diego', { code: 'first', state: await start(OTHER, 'diego') });
    const res = await complete(ME, 'mara', { code: 'second', state: await start(ME, 'mara') });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('linked_account_taken');
  });

  it('says a refused code took too long, and Twitch not answering as such', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 400, message: 'Invalid authorization code' }, { status: 400 })));
    expect((await complete(ME, 'mara', { code: 'old', state: await start(ME, 'mara') })).json().code).toBe('linked_account_expired');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    expect((await complete(ME, 'mara', { code: 'new', state: await start(ME, 'mara') })).json().code).toBe('linked_account_failed');
  });

  it('is for accounts homed here, on a server that set Twitch up', async () => {
    const remote = await app.inject({ method: 'POST', url: '/api/users/@me/linked-accounts/twitch/start', headers: as(REMOTE, 'sam@peer.test') });
    expect(remote.statusCode).toBe(403);
    expect(remote.json().code).toBe('linked_account_home_only');

    twitchConfig.clientId = '';
    twitchConfig.clientSecret = '';
    const off = await app.inject({ method: 'POST', url: '/api/users/@me/linked-accounts/twitch/start', headers: as(ME, 'mara') });
    expect(off.statusCode).toBe(503);
    expect(off.json().code).toBe('linked_account_unavailable');
    const listed = await app.inject({ method: 'GET', url: '/api/users/@me/linked-accounts', headers: as(ME, 'mara') });
    expect(listed.json()).toEqual({ available: [], accounts: [] });
  });
});

describe('a linked account', () => {
  beforeEach(async () => {
    twitchSaying({ id: '42', login: 'mara_plays', display_name: 'Mara_Plays' });
    await complete(ME, 'mara', { code: 'the-code', state: await start(ME, 'mara') });
    sent.length = 0;
  });

  it('leaves the profile when its owner hides it, and comes back', async () => {
    const hide = await app.inject({ method: 'PATCH', url: '/api/users/@me/linked-accounts/twitch', headers: as(ME, 'mara'), payload: { showOnProfile: false } });
    expect(hide.statusCode).toBe(200);
    expect(hide.json().accounts[0]).toMatchObject({ showOnProfile: false, showLive: true });
    expect(meRow().profileLinkedAccounts).toBeNull();
    expect(sent.some(([userId, event]) => userId === FRIEND && event.type === 'user_updated')).toBe(true);

    sent.length = 0;
    const live = await app.inject({ method: 'PATCH', url: '/api/users/@me/linked-accounts/twitch', headers: as(ME, 'mara'), payload: { showLive: false } });
    expect(live.json().accounts[0]).toMatchObject({ showOnProfile: false, showLive: false });
    // Nothing the profile shows changed: only the person's own windows hear of it.
    expect(sent.map(([userId, event]) => `${userId} ${String(event.type)}`)).toEqual([`${ME} linked_accounts_update`]);

    expect((await app.inject({ method: 'PATCH', url: '/api/users/@me/linked-accounts/twitch', headers: as(ME, 'mara'), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/users/@me/linked-accounts/twitch', headers: as(ME, 'mara'), payload: { showLive: 'yes' } })).statusCode).toBe(400);
  });

  it('goes when unlinked, also once Twitch is no longer set up', async () => {
    twitchConfig.clientId = '';
    twitchConfig.clientSecret = '';
    const res = await app.inject({ method: 'DELETE', url: '/api/users/@me/linked-accounts/twitch', headers: as(ME, 'mara') });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual([]);
    expect(meRow().profileLinkedAccounts).toBeNull();
    expect(testDb.select().from(schema.linkedAccounts).all()).toEqual([]);
    const again = await app.inject({ method: 'DELETE', url: '/api/users/@me/linked-accounts/twitch', headers: as(ME, 'mara') });
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe('linked_account_not_found');
  });

  it('follows a rename at Twitch', async () => {
    const { noteLinkedAccountName } = await import('../utils/linkedAccounts.js');
    noteLinkedAccountName('twitch', '42', 'mara_new', 'Mara_New');
    expect(JSON.parse(meRow().profileLinkedAccounts!)).toEqual([{ provider: 'twitch', login: 'mara_new', name: 'Mara_New' }]);
    sent.length = 0;
    noteLinkedAccountName('twitch', '42', 'mara_new', 'Mara_New');
    expect(sent).toEqual([]);
  });
});
