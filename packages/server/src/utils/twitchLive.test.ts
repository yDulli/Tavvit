import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

// Live on Twitch (docs/systems/activity-presence.md): who is asked about (people
// of this instance with a linked Twitch account, linked-accounts.md), what
// Twitch is asked, what a live stream becomes, and what happens when Twitch
// does not answer. Twitch itself is a stand-in here; nothing leaves the test.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let testDb: ReturnType<typeof drizzle<typeof schema>>;

const twitchConfig = vi.hoisted(() => ({ clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://tavvit.test/linked-accounts/twitch' }));
const world = vi.hoisted(() => ({
  online: new Set<string>(),
  sharing: new Map<string, boolean>(),
  sets: new Map<string, Array<Record<string, unknown>>>(),
  broadcasts: [] as Array<{ userId: string; activities: unknown }>,
  sent: [] as Array<{ userId: string; activities: unknown }>,
  relayed: [] as Array<{ userId: string; activities: unknown }>,
  renamed: [] as Array<[string, string, string, string]>,
}));

vi.mock('../config.js', () => ({ config: { twitch: twitchConfig } }));
vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  schema,
}));
// The set as ConnectionManager composes it (ws/activityCompose.test.ts): derived part first.
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    getAllOnlineUserIds: () => [...world.online],
    isUserOnline: (userId: string) => world.online.has(userId),
    getUserShowActivity: (userId: string) => world.sharing.get(userId) ?? true,
    getUserStatus: () => 'online',
    getDerivedActivities: (userId: string) => (world.sets.get(userId) ?? []).filter((activity) => activity.source !== undefined),
    setDerivedActivities: (userId: string, derived: Array<Record<string, unknown>>) => {
      const next = [...derived, ...(world.sets.get(userId) ?? []).filter((activity) => activity.source === undefined)];
      world.sets.set(userId, next);
      return next;
    },
    broadcastPresence: (userId: string, payload: { activities?: unknown }) => { world.broadcasts.push({ userId, activities: payload.activities }); },
    sendToUser: (userId: string, payload: { activities?: unknown }) => { world.sent.push({ userId, activities: payload.activities }); },
  },
}));
vi.mock('./federationPresence.js', () => ({
  queuePresenceRelay: (userId: string, _status: string, activities: unknown) => { world.relayed.push({ userId, activities }); },
}));
vi.mock('./linkedAccounts.js', () => ({
  noteLinkedAccountName: (provider: string, accountId: string, login: string, name: string) => { world.renamed.push([provider, accountId, login, name]); },
}));

const { askTwitch, clipText, liveActivityOf, readIdentity, readStreams, resetTwitchToken, twitchAuthorizeUrl, twitchIdentityOfCode, TwitchCodeRefused, TwitchUnavailable } = await import('./twitchApi.js');
const { checkTwitchLive, resetTwitchLive, STALE_AFTER_MS, twitchLiveState, withdrawTwitchLive } = await import('./twitchLive.js');

function applyMigrations(sqlite: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(migrationsDir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = statement.trim();
      if (clean) sqlite.exec(clean);
    }
  }
}

/** A person here; `twitch`: the id of the Twitch account they linked. */
function seed(id: string, fields: { twitch?: string; showLive?: number; homeInstance?: string; showActivity?: number; accountKind?: 'person' | 'bot' } = {}): void {
  testDb.insert(schema.users).values({
    id,
    username: fields.homeInstance ? `${id}@${fields.homeInstance}` : id,
    passwordHash: 'x',
    homeUserId: id,
    homeInstance: fields.homeInstance ?? null,
    showActivity: fields.showActivity ?? 1,
    accountKind: fields.accountKind ?? 'person',
    status: 'online',
    createdAt: 1,
  }).run();
  if (fields.twitch) {
    testDb.insert(schema.linkedAccounts).values({
      id: `link-${id}`,
      userId: id,
      provider: 'twitch',
      providerUserId: fields.twitch,
      login: id,
      displayName: id,
      showOnProfile: 1,
      showLive: fields.showLive ?? 1,
      createdAt: 1,
      updatedAt: 1,
    }).run();
  }
  world.online.add(id);
}

interface StreamFixture { user_id: string; user_login?: string; user_name?: string; title?: string; game_name?: string; started_at?: string; type?: string }

const STARTED = '2026-11-07T18:00:00Z';
const NOW = Date.parse('2026-11-07T19:05:00Z');

/** A stand-in for Twitch: an application token, then the streams of the accounts asked about that are live. */
function twitch(live: StreamFixture[], options: { tokenStatus?: number; streamsStatus?: number[] } = {}) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const streamStatuses = [...(options.streamsStatus ?? [])];
  let tokens = 0;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.host === 'id.twitch.tv') {
      tokens += 1;
      if (options.tokenStatus) return new Response('{}', { status: options.tokenStatus });
      return Response.json({ access_token: `token-${tokens}`, expires_in: 5_000_000, token_type: 'bearer' });
    }
    const status = streamStatuses.shift() ?? 200;
    if (status !== 200) return new Response('{}', { status });
    const asked = new Set(url.searchParams.getAll('user_id'));
    const data = live.filter((stream) => asked.has(stream.user_id)).map((stream) => ({
      type: 'live', user_login: `login${stream.user_id}`, user_name: `Name${stream.user_id}`, title: 'Stream', game_name: '', started_at: STARTED, ...stream,
    }));
    return Response.json({ data, pagination: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, streamCalls: () => calls.filter((call) => call.url.host === 'api.twitch.tv') };
}

beforeEach(() => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  twitchConfig.clientId = 'client-id';
  twitchConfig.clientSecret = 'client-secret';
  world.online.clear();
  world.sharing.clear();
  world.sets.clear();
  world.broadcasts.length = 0;
  world.sent.length = 0;
  world.relayed.length = 0;
  world.renamed.length = 0;
  resetTwitchToken();
  resetTwitchLive();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what a live stream is shown as', () => {
  const stream = { userId: '42', login: 'mara', shownName: 'Mara', title: 'Any% attempts', game: 'Celeste', startedAt: Date.parse(STARTED) };

  it('is a streaming activity marked as found on Twitch, linking to the channel', () => {
    expect(liveActivityOf(stream, NOW)).toEqual({
      type: 'streaming',
      name: 'Any% attempts',
      details: 'Celeste',
      url: 'https://www.twitch.tv/mara',
      timestamps: { start: Date.parse(STARTED) },
      source: 'twitch',
    });
  });

  it('holds its texts to what every instance accepts', () => {
    const long = `${'a'.repeat(126)}\u{1F3AE}\u{1F3AE}`;
    const activity = liveActivityOf({ ...stream, title: `‮${long}`, game: '' }, NOW);
    expect(activity.name.length).toBeLessThanOrEqual(128);
    expect(activity.name.endsWith('…')).toBe(true);
    expect(activity.name).not.toContain('‮');
    expect(activity.details).toBeUndefined();
    expect(clipText('🎮🎮🎮', 4)).toBe('🎮…');
  });

  it('falls back to the login without a title, never starts in the future, and links nowhere for a login Twitch would not give', () => {
    const activity = liveActivityOf({ ...stream, title: '  ', shownName: '', startedAt: NOW + 60_000 }, NOW);
    expect(activity.name).toBe('mara');
    expect(activity.timestamps).toEqual({ start: NOW });
    expect(liveActivityOf({ ...stream, login: '../x' }, NOW).url).toBeUndefined();
  });

  it('reads only live streams from an answer, and refuses one without data', () => {
    expect(readStreams({ data: [{ type: 'live', user_id: '7', user_login: 'Mara', title: 'x' }, { type: '', user_id: '8' }, null, { type: 'live', user_id: 'nine' }] }))
      .toEqual([{ userId: '7', login: 'mara', shownName: '', title: 'x', game: '', startedAt: null }]);
    expect(() => readStreams({ error: 'nope' })).toThrow(TwitchUnavailable);
  });
});

describe('asking Twitch', () => {
  it('signs in once as the application and asks about up to a hundred accounts at a time', async () => {
    const stand = twitch([{ user_id: '0' }, { user_id: '120' }]);
    const accounts = Array.from({ length: 150 }, (_, index) => String(index));
    const live = await askTwitch(accounts);
    expect([...live.keys()].sort()).toEqual(['0', '120']);
    const [first, second] = stand.streamCalls();
    expect(stand.streamCalls()).toHaveLength(2);
    expect(first?.url.searchParams.getAll('user_id')).toHaveLength(100);
    expect(first?.url.searchParams.get('first')).toBe('100');
    expect(second?.url.searchParams.getAll('user_id')).toHaveLength(50);
    const headers = first?.init?.headers as Record<string, string>;
    expect(headers['Client-Id']).toBe('client-id');
    expect(headers.Authorization).toBe('Bearer token-1');
    await askTwitch(['0']);
    expect(stand.calls.filter((call) => call.url.host === 'id.twitch.tv')).toHaveLength(1);
  });

  it('renews a token Twitch no longer takes, once', async () => {
    const stand = twitch([{ user_id: '42' }], { streamsStatus: [401] });
    expect((await askTwitch(['42'])).has('42')).toBe(true);
    const retried = stand.streamCalls()[1];
    expect((retried?.init?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer token-2');
  });

  it('says when Twitch refuses the application', async () => {
    twitch([], { tokenStatus: 403 });
    await expect(askTwitch(['42'])).rejects.toMatchObject({ credentials: true });
  });
});

describe('linking at Twitch', () => {
  it('sends the person to sign in, asking for no permission and every time', () => {
    const url = new URL(twitchAuthorizeUrl('the-state'));
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: 'https://tavvit.test/linked-accounts/twitch',
      response_type: 'code',
      scope: '',
      state: 'the-state',
      force_verify: 'true',
    });
  });

  it('learns who signed in from the code, and revokes the token before it answers', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = new URLSearchParams(String(init?.body ?? ''));
      calls.push(`${url.pathname} ${body.get('grant_type') ?? body.get('token') ?? ''}`);
      if (url.pathname === '/oauth2/token') {
        expect(body.get('code')).toBe('the-code');
        expect(body.get('redirect_uri')).toBe('https://tavvit.test/linked-accounts/twitch');
        return Response.json({ access_token: 'person-token', refresh_token: 'never-kept' });
      }
      if (url.pathname === '/helix/users') return Response.json({ data: [{ id: '42', login: 'Mara', display_name: 'Mara' }] });
      return new Response(null, { status: 200 });
    }));
    expect(await twitchIdentityOfCode('the-code')).toEqual({ id: '42', login: 'mara', name: 'Mara' });
    expect(calls).toEqual(['/oauth2/token authorization_code', '/helix/users ', '/oauth2/revoke person-token']);
  });

  it('revokes the token also when Twitch does not say who signed in', async () => {
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === '/oauth2/token') return Response.json({ access_token: 'person-token' });
      if (url.pathname === '/helix/users') return new Response('{}', { status: 500 });
      return new Response(null, { status: 200 });
    }));
    await expect(twitchIdentityOfCode('the-code')).rejects.toBeInstanceOf(TwitchUnavailable);
    expect(paths).toContain('/oauth2/revoke');
  });

  it('tells a code Twitch refused apart from Twitch not answering', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 400, message: 'Invalid authorization code' }, { status: 400 })));
    await expect(twitchIdentityOfCode('old-code')).rejects.toBeInstanceOf(TwitchCodeRefused);
    expect(() => readIdentity({ data: [{ id: 'x', login: 'mara' }] })).toThrow(TwitchUnavailable);
  });
});

describe('the live check', () => {
  it('shows a live stream to everyone the person\'s activity goes to, once', async () => {
    seed('mara', { twitch: '42' });
    world.sets.set('mara', [{ type: 'playing', name: 'Celeste' }]);
    twitch([{ user_id: '42', user_login: 'mara', user_name: 'mara', title: 'Any% attempts', game_name: 'Celeste' }]);

    await checkTwitchLive(NOW);
    await vi.dynamicImportSettled();

    const expected = [
      { type: 'streaming', name: 'Any% attempts', source: 'twitch', url: 'https://www.twitch.tv/mara', details: 'Celeste', timestamps: { start: Date.parse(STARTED) } },
      { type: 'playing', name: 'Celeste' },
    ];
    expect(world.sets.get('mara')).toEqual(expected);
    expect(world.broadcasts).toEqual([{ userId: 'mara', activities: expected }]);
    expect(world.sent).toEqual([{ userId: 'mara', activities: expected }]);
    expect(world.relayed).toEqual([{ userId: 'mara', activities: expected }]);

    await checkTwitchLive(NOW + 60_000);
    expect(world.broadcasts).toHaveLength(1);
    expect(twitchLiveState()).toBe('ok');
  });

  it('follows a rename at Twitch to the linked account', async () => {
    seed('mara', { twitch: '42' });
    twitch([{ user_id: '42', user_login: 'mara_new', user_name: 'Mara_New' }]);
    await checkTwitchLive(NOW);
    expect(world.renamed).toEqual([['twitch', '42', 'mara_new', 'Mara_New']]);
    expect((world.sets.get('mara')?.[0] as { url?: string }).url).toBe('https://www.twitch.tv/mara_new');
  });

  it('takes the stream away when it ends, and keeps what the client reported', async () => {
    seed('mara', { twitch: '42' });
    world.sets.set('mara', [{ type: 'playing', name: 'Celeste' }]);
    twitch([{ user_id: '42' }]);
    await checkTwitchLive(NOW);
    twitch([]);
    await checkTwitchLive(NOW + 60_000);
    expect(world.sets.get('mara')).toEqual([{ type: 'playing', name: 'Celeste' }]);
    expect(world.broadcasts.at(-1)).toEqual({ userId: 'mara', activities: [{ type: 'playing', name: 'Celeste' }] });
  });

  it('takes the stream away at once when asked, not at the next round', async () => {
    seed('mara', { twitch: '42' });
    twitch([{ user_id: '42' }]);
    await checkTwitchLive(NOW);
    withdrawTwitchLive('mara');
    expect(world.sets.get('mara')).toEqual([]);
    withdrawTwitchLive('mara');
    expect(world.broadcasts).toHaveLength(2);
  });

  it('asks only about its own people who share their activity and let a linked account show live', async () => {
    seed('mara', { twitch: '1' });
    seed('diego', { twitch: '2', homeInstance: 'https://peer.test' });
    seed('quiet', { twitch: '3', showActivity: 0 });
    seed('hidden', { twitch: '4', showLive: 0 });
    seed('robot', { twitch: '5', accountKind: 'bot' });
    seed('unlinked');
    seed('away', { twitch: '6' });
    world.online.delete('away');
    const stand = twitch([]);
    await checkTwitchLive(NOW);
    expect(stand.streamCalls().flatMap((call) => call.url.searchParams.getAll('user_id'))).toEqual(['1']);
  });

  it('asks nothing while nobody to ask about is signed in', async () => {
    seed('unlinked');
    const stand = twitch([]);
    await checkTwitchLive(NOW);
    expect(stand.fetchMock).not.toHaveBeenCalled();
  });

  it('does not show a stream to someone who stopped sharing while Twitch was asked', async () => {
    seed('mara', { twitch: '42' });
    world.sharing.set('mara', false);
    twitch([{ user_id: '42' }]);
    await checkTwitchLive(NOW);
    expect(world.sets.get('mara')).toBeUndefined();
    expect(world.broadcasts).toEqual([]);
  });

  it('keeps a stream through a missed answer, and takes it away once Twitch stays silent', async () => {
    seed('mara', { twitch: '42' });
    twitch([{ user_id: '42' }]);
    await checkTwitchLive(NOW);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    twitch([], { streamsStatus: [500, 500, 500] });
    await checkTwitchLive(NOW + 60_000);
    expect(world.sets.get('mara')).toHaveLength(1);
    expect(twitchLiveState()).toBe('failing');
    await checkTwitchLive(NOW + STALE_AFTER_MS + 1);
    expect(world.sets.get('mara')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('does nothing, and says it is off, without the application', async () => {
    twitchConfig.clientId = '';
    twitchConfig.clientSecret = '';
    seed('mara', { twitch: '42' });
    const stand = twitch([{ user_id: '42' }]);
    await checkTwitchLive(NOW);
    expect(stand.fetchMock).not.toHaveBeenCalled();
    expect(twitchLiveState()).toBe('off');
  });
});
