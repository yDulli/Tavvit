import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

// Live on Twitch (docs/systems/activity-presence.md): who is asked about, what
// Twitch is asked, what a live stream becomes, and what happens when Twitch
// does not answer. Twitch itself is a stand-in here; nothing leaves the test.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let testDb: ReturnType<typeof drizzle<typeof schema>>;

const twitchConfig = vi.hoisted(() => ({ clientId: 'client-id', clientSecret: 'client-secret' }));
const world = vi.hoisted(() => ({
  online: new Set<string>(),
  sharing: new Map<string, boolean>(),
  sets: new Map<string, Array<Record<string, unknown>>>(),
  broadcasts: [] as Array<{ userId: string; activities: unknown }>,
  sent: [] as Array<{ userId: string; activities: unknown }>,
  relayed: [] as Array<{ userId: string; activities: unknown }>,
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

const { askTwitch, clipText, liveActivityOf, readStreams, resetTwitchToken, TwitchUnavailable } = await import('./twitchApi.js');
const { checkTwitchLive, resetTwitchLive, STALE_AFTER_MS, twitchLiveState } = await import('./twitchLive.js');

function applyMigrations(sqlite: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(migrationsDir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = statement.trim();
      if (clean) sqlite.exec(clean);
    }
  }
}

function seed(id: string, fields: { links?: string[]; homeInstance?: string; showActivity?: number; accountKind?: 'person' | 'bot' } = {}): void {
  testDb.insert(schema.users).values({
    id,
    username: fields.homeInstance ? `${id}@${fields.homeInstance}` : id,
    passwordHash: 'x',
    homeUserId: id,
    homeInstance: fields.homeInstance ?? null,
    profileLinks: fields.links ? JSON.stringify(fields.links.map((url) => ({ url, label: null }))) : null,
    showActivity: fields.showActivity ?? 1,
    accountKind: fields.accountKind ?? 'person',
    status: 'online',
    createdAt: 1,
  }).run();
  world.online.add(id);
}

interface StreamFixture { user_login: string; user_name?: string; title?: string; game_name?: string; started_at?: string; type?: string }

const STARTED = '2026-11-07T18:00:00Z';
const NOW = Date.parse('2026-11-07T19:05:00Z');

/** A stand-in for Twitch: a token, then the streams of the channels asked about that are live. */
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
    const asked = new Set(url.searchParams.getAll('user_login'));
    const data = live.filter((stream) => asked.has(stream.user_login)).map((stream) => ({
      type: 'live', user_name: stream.user_login, title: 'Stream', game_name: '', started_at: STARTED, ...stream,
    }));
    return Response.json({ data, pagination: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, streamCalls: () => calls.filter((call) => call.url.host === 'api.twitch.tv') };
}

beforeEach(() => {
  const sqlite = new Database(':memory:');
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
  resetTwitchToken();
  resetTwitchLive();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what a live stream is shown as', () => {
  const stream = { login: 'mara', shownName: 'Mara', title: 'Any% attempts', game: 'Celeste', startedAt: Date.parse(STARTED) };

  it('is a streaming activity marked as found on Twitch, linking to the channel', () => {
    expect(liveActivityOf(stream, 'mara', NOW)).toEqual({
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
    const activity = liveActivityOf({ ...stream, title: `‮${long}`, game: '' }, 'mara', NOW);
    expect(activity.name.length).toBeLessThanOrEqual(128);
    expect(activity.name.endsWith('…')).toBe(true);
    expect(activity.name).not.toContain('‮');
    expect(activity.details).toBeUndefined();
    expect(clipText('🎮🎮🎮', 4)).toBe('🎮…');
  });

  it('falls back to the channel when there is no title, and never starts in the future', () => {
    const activity = liveActivityOf({ ...stream, title: '  ', shownName: '', startedAt: NOW + 60_000 }, 'mara', NOW);
    expect(activity.name).toBe('mara');
    expect(activity.timestamps).toEqual({ start: NOW });
  });

  it('reads only live streams from an answer, and refuses one without data', () => {
    expect(readStreams({ data: [{ type: 'live', user_login: 'Mara', title: 'x' }, { type: '', user_login: 'diego' }, null, { type: 'live' }] }))
      .toEqual([{ login: 'mara', shownName: '', title: 'x', game: '', startedAt: null }]);
    expect(() => readStreams({ error: 'nope' })).toThrow(TwitchUnavailable);
  });
});

describe('asking Twitch', () => {
  it('signs in once as the application and asks about up to a hundred channels at a time', async () => {
    const stand = twitch([{ user_login: 'c0' }, { user_login: 'c120' }]);
    const channels = Array.from({ length: 150 }, (_, index) => `c${index}`);
    const live = await askTwitch(channels);
    expect([...live.keys()].sort()).toEqual(['c0', 'c120']);
    const [first, second] = stand.streamCalls();
    expect(stand.streamCalls()).toHaveLength(2);
    expect(first?.url.searchParams.getAll('user_login')).toHaveLength(100);
    expect(first?.url.searchParams.get('first')).toBe('100');
    expect(second?.url.searchParams.getAll('user_login')).toHaveLength(50);
    const headers = first?.init?.headers as Record<string, string>;
    expect(headers['Client-Id']).toBe('client-id');
    expect(headers.Authorization).toBe('Bearer token-1');
    await askTwitch(['c0']);
    expect(stand.calls.filter((call) => call.url.host === 'id.twitch.tv')).toHaveLength(1);
  });

  it('renews a token Twitch no longer takes, once', async () => {
    const stand = twitch([{ user_login: 'mara' }], { streamsStatus: [401] });
    expect((await askTwitch(['mara'])).has('mara')).toBe(true);
    const retried = stand.streamCalls()[1];
    expect((retried?.init?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer token-2');
  });

  it('says when Twitch refuses the application', async () => {
    twitch([], { tokenStatus: 403 });
    await expect(askTwitch(['mara'])).rejects.toMatchObject({ credentials: true });
  });
});

describe('the live check', () => {
  it('shows a live stream to everyone the person\'s activity goes to, once', async () => {
    seed('mara', { links: ['https://example.com/', 'https://twitch.tv/Mara'] });
    world.sets.set('mara', [{ type: 'playing', name: 'Celeste' }]);
    twitch([{ user_login: 'mara', title: 'Any% attempts', game_name: 'Celeste' }]);

    await checkTwitchLive(NOW);
    await vi.dynamicImportSettled();

    const expected = [
      { type: 'streaming', name: 'Any% attempts', details: 'Celeste', url: 'https://www.twitch.tv/mara', timestamps: { start: Date.parse(STARTED) }, source: 'twitch' },
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

  it('takes the stream away when it ends, and keeps what the client reported', async () => {
    seed('mara', { links: ['https://www.twitch.tv/mara'] });
    world.sets.set('mara', [{ type: 'playing', name: 'Celeste' }]);
    twitch([{ user_login: 'mara' }]);
    await checkTwitchLive(NOW);
    twitch([]);
    await checkTwitchLive(NOW + 60_000);
    expect(world.sets.get('mara')).toEqual([{ type: 'playing', name: 'Celeste' }]);
    expect(world.broadcasts.at(-1)).toEqual({ userId: 'mara', activities: [{ type: 'playing', name: 'Celeste' }] });
  });

  it('asks only about its own people who share their activity and link a channel', async () => {
    seed('mara', { links: ['https://www.twitch.tv/mara'] });
    seed('diego', { links: ['https://www.twitch.tv/diego'], homeInstance: 'https://peer.test' });
    seed('quiet', { links: ['https://www.twitch.tv/quiet'], showActivity: 0 });
    seed('robot', { links: ['https://www.twitch.tv/robot'], accountKind: 'bot' });
    seed('nolink', { links: ['https://www.twitch.tv/directory'] });
    seed('away', { links: ['https://www.twitch.tv/away'] });
    world.online.delete('away');
    const stand = twitch([]);
    await checkTwitchLive(NOW);
    expect(stand.streamCalls().flatMap((call) => call.url.searchParams.getAll('user_login'))).toEqual(['mara']);
  });

  it('asks nothing while nobody to ask about is signed in', async () => {
    const stand = twitch([]);
    await checkTwitchLive(NOW);
    expect(stand.fetchMock).not.toHaveBeenCalled();
  });

  it('does not show a stream to someone who stopped sharing while Twitch was asked', async () => {
    seed('mara', { links: ['https://www.twitch.tv/mara'] });
    world.sharing.set('mara', false);
    twitch([{ user_login: 'mara' }]);
    await checkTwitchLive(NOW);
    expect(world.sets.get('mara')).toBeUndefined();
    expect(world.broadcasts).toEqual([]);
  });

  it('keeps a stream through a missed answer, and takes it away once Twitch stays silent', async () => {
    seed('mara', { links: ['https://www.twitch.tv/mara'] });
    twitch([{ user_login: 'mara' }]);
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
    seed('mara', { links: ['https://www.twitch.tv/mara'] });
    const stand = twitch([{ user_login: 'mara' }]);
    await checkTwitchLive(NOW);
    expect(stand.fetchMock).not.toHaveBeenCalled();
    expect(twitchLiveState()).toBe('off');
  });
});
