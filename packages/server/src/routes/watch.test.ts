import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { WATCH_LIMITS, type WatchSession } from '@backspace/shared/src/watch.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Watching together is for those in the call: who may start, steer and end a session, what a
// link may be, and who hears of it (docs/systems/watch-together.md).

setWorkerId(33);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

interface FakeRoom {
  roomId: string;
  roomType: 'space';
  participants: Set<string>;
  metadata: { type: 'space'; spaceId: string };
  startedAt: number;
  watch?: WatchSession;
}

const { rooms, sent, titles } = vi.hoisted(() => ({
  rooms: new Map<string, FakeRoom>(),
  sent: [] as Array<{ to: string; args: unknown[] }>,
  titles: {
    next: { kind: 'title', title: 'A film' } as { kind: 'title'; title: string } | { kind: 'not_embeddable' } | { kind: 'unknown' },
    /** What happens while the provider is asked: the call may change meanwhile. */
    during: null as (() => void) | null,
  },
}));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/watchTitles.js', () => ({ lookUpWatchTitle: async () => { titles.during?.(); return titles.next; } }));
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    getRoom: (id: string) => rooms.get(id),
    sendToUsers: (...args: unknown[]) => { sent.push({ to: 'sendToUsers', args }); },
    sendToChannel: (...args: unknown[]) => { sent.push({ to: 'sendToChannel', args }); },
  },
  watchPresenceOf: (room: FakeRoom | undefined) => {
    const current = room?.watch?.current;
    return current ? { title: current.title, provider: current.provider } : null;
  },
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
const ALICE = 'user-alice';
const BOB = 'user-bob';
const MOD = 'user-mod';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const VOICE = 'channel-voice';
const TEXT = 'channel-text';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIMEO = 'https://vimeo.com/76979871';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { watchRoutes, _resetWatchLimitsForTests } = await import('./watch.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  rooms.clear();
  sent.length = 0;
  titles.next = { kind: 'title', title: 'A film' };
  titles.during = null;
  _resetWatchLimitsForTests();
  for (const id of [OWNER, ALICE, BOB, MOD, OUTSIDER]) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: VOICE, spaceId: SPACE, name: 'lounge', type: 'voice', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: TEXT, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  for (const id of [OWNER, ALICE, BOB, MOD]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-mod', spaceId: SPACE, name: 'Mods', position: 1, permissions: permissionsToString(PermissionBits.MOVE_MEMBERS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: MOD, roleId: 'role-mod' }).run();
  rooms.set(VOICE, { roomId: VOICE, roomType: 'space', participants: new Set([ALICE, BOB, MOD]), metadata: { type: 'space', spaceId: SPACE }, startedAt: 1 });
  app = Fastify();
  await app.register(watchRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const add = (url: string, userId = ALICE, channelId = VOICE) => app.inject({
  method: 'POST', url: `/api/channels/${channelId}/watch`, headers: headers(userId), payload: { url },
});
const change = (payload: Record<string, unknown>, userId = ALICE) => app.inject({
  method: 'POST', url: `/api/channels/${VOICE}/watch/state`, headers: headers(userId), payload,
});
const end = (userId = ALICE) => app.inject({ method: 'DELETE', url: `/api/channels/${VOICE}/watch`, headers: headers(userId) });
const react = (reaction: string, userId = BOB) => app.inject({
  method: 'POST', url: `/api/channels/${VOICE}/watch/react`, headers: headers(userId), payload: { reaction },
});
const session = (): WatchSession | undefined => rooms.get(VOICE)?.watch;

describe('starting and adding', () => {
  it('the first link starts a session for the call, the next ones wait in the queue', async () => {
    const started = await add(YOUTUBE);
    expect(started.statusCode).toBe(200);
    expect(started.json().session.current).toMatchObject({ provider: 'youtube', ref: 'dQw4w9WgXcQ', title: 'A film' });
    expect(started.json().session.current).not.toHaveProperty('addedBy');
    expect(session()?.playing).toBe(true);
    expect(session()?.starterId).toBe(ALICE);

    const queued = await add(VIMEO, BOB);
    expect(queued.statusCode).toBe(200);
    expect(session()?.queue.map((item) => item.provider)).toEqual(['vimeo']);
  });

  it('tells the call where it stands, and the channel list what plays', async () => {
    await add(YOUTUBE);
    const toCall = sent.find((entry) => entry.to === 'sendToUsers');
    expect([...(toCall?.args[0] as Set<string>)].sort()).toEqual([ALICE, BOB, MOD].sort());
    expect(toCall?.args[1]).toMatchObject({ type: 'watch_state', channelId: VOICE });
    const toList = sent.find((entry) => entry.to === 'sendToChannel');
    expect(toList?.args.slice(0, 2)).toEqual([SPACE, VOICE]);
    expect(toList?.args[2]).toEqual({ type: 'watch_presence', spaceId: SPACE, channelId: VOICE, presence: { title: 'A film', provider: 'youtube' } });
  });

  it('is only for someone in the call', async () => {
    const res = await add(YOUTUBE, OWNER);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('watch_not_in_call');
    expect(session()).toBeUndefined();
  });

  it('is only in a voice channel', async () => {
    const res = await add(YOUTUBE, ALICE, TEXT);
    expect(res.statusCode).toBe(404);
  });

  it('takes the right to show video to the room (STREAM)', async () => {
    testDb.insert(schema.channelOverrides).values({
      channelId: VOICE, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.STREAM),
    }).run();
    const res = await add(YOUTUBE);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('missing_permission');
    expect(session()).toBeUndefined();
  });

  it('refuses a link no player here plays, and one its provider will not let be embedded', async () => {
    expect((await add('https://example.com/page')).json().code).toBe('watch_link_unsupported');
    expect((await add('javascript:alert(1)')).json().code).toBe('watch_link_unsupported');
    titles.next = { kind: 'not_embeddable' };
    expect((await add(YOUTUBE)).json().code).toBe('watch_link_unsupported');
    expect(session()).toBeUndefined();
  });

  it('leaves a video its provider gave no title for without one, never named by its link', async () => {
    titles.next = { kind: 'unknown' };
    expect((await add(YOUTUBE)).json().session.current.title).toBe('');
    const toList = sent.find((entry) => entry.to === 'sendToChannel');
    expect(toList?.args[2]).toMatchObject({ presence: { title: '', provider: 'youtube' } });
  });

  it('checks the call again once the title is known: someone who left meanwhile adds nothing', async () => {
    titles.during = () => { rooms.get(VOICE)!.participants.delete(ALICE); };
    const res = await add(YOUTUBE);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('watch_not_in_call');
    expect(session()).toBeUndefined();
  });

  it('holds no more than it may send: a queue of long links fills up before its count does', async () => {
    await add(YOUTUBE);
    const long = `https://files.example/${'a'.repeat(1900)}.mp4`;
    let last = 200;
    for (let i = 0; i < WATCH_LIMITS.QUEUE_MAX && last === 200; i += 1) {
      last = (await add(long, BOB)).statusCode;
      _resetWatchLimitsForTests();
    }
    expect(last).toBe(409);
    expect(JSON.stringify(session()).length).toBeLessThanOrEqual(WATCH_LIMITS.SESSION_MAX_BYTES);
    expect(session()!.queue.length).toBeLessThan(WATCH_LIMITS.QUEUE_MAX);
  });

  it('is not for someone who may no longer see the channel, though the room still lists them', async () => {
    await add(YOUTUBE);
    testDb.insert(schema.channelOverrides).values({
      channelId: VOICE, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
    }).run();
    expect((await change({ action: 'pause' }, BOB)).json().code).toBe('watch_not_in_call');
    expect((await app.inject({ method: 'GET', url: `/api/channels/${VOICE}/watch`, headers: headers(BOB) })).statusCode).toBe(403);
    expect((await react('🔥', BOB)).statusCode).toBe(403);
    expect((await add(VIMEO, BOB)).json().code).toBe('watch_not_in_call');
  });

  it('holds at most the queue it may', async () => {
    await add(YOUTUBE);
    const room = rooms.get(VOICE)!;
    room.watch!.queue = Array.from({ length: WATCH_LIMITS.QUEUE_MAX }, (_, i) => ({ ...room.watch!.current!, id: `queued-${i}` }));
    const res = await add(VIMEO, BOB);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'watch_queue_full', details: { max: WATCH_LIMITS.QUEUE_MAX } });
  });

  it('is not for a member who is timed out', async () => {
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 }).run();
    const res = await add(YOUTUBE);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('member_timed_out');
  });
});

describe('steering', () => {
  beforeEach(async () => {
    await add(YOUTUBE);
    await add(VIMEO);
  });

  it('pauses, seeks and plays for everyone in the call by default', async () => {
    expect((await change({ action: 'pause' }, BOB)).statusCode).toBe(200);
    expect(session()?.playing).toBe(false);
    expect((await change({ action: 'seek', positionMs: 90_000 }, MOD)).statusCode).toBe(200);
    expect(session()?.positionMs).toBe(90_000);
    expect((await change({ action: 'play' }, BOB)).statusCode).toBe(200);
    expect(session()?.playing).toBe(true);
  });

  it('skips once when several players report the end of the same video', async () => {
    const first = session()!.current!.id;
    await change({ action: 'next', itemId: first }, BOB);
    await change({ action: 'next', itemId: first }, MOD);
    expect(session()?.current?.provider).toBe('vimeo');
    expect(session()?.queue).toEqual([]);
  });

  it('only the starter decides who steers, and then nobody else does', async () => {
    expect((await change({ action: 'control', control: 'starter' }, BOB)).json().code).toBe('watch_not_controller');
    expect((await change({ action: 'control', control: 'starter' }, ALICE)).statusCode).toBe(200);
    const refused = await change({ action: 'pause' }, BOB);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('watch_not_controller');
    expect((await change({ action: 'pause' }, ALICE)).statusCode).toBe(200);
  });

  it('tells the call a play, pause or seek as a position alone, and a change that changed nothing to nobody', async () => {
    sent.length = 0;
    await change({ action: 'pause' }, BOB);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.args[1]).toMatchObject({ type: 'watch_position', channelId: VOICE, position: { playing: false } });
    sent.length = 0;
    await change({ action: 'pause' }, BOB);
    await change({ action: 'next', itemId: 'not-the-one-playing' }, BOB);
    await change({ action: 'remove', itemId: 'nobody' }, BOB);
    expect(sent).toEqual([]);
    await change({ action: 'seek', positionMs: 5_000 }, BOB);
    expect(sent.map((entry) => (entry.args[1] as { type: string }).type)).toEqual(['watch_position']);
    // The channel list hears of what plays, not of where it stands.
    expect(sent.some((entry) => entry.to === 'sendToChannel')).toBe(false);
    sent.length = 0;
    await change({ action: 'next' }, BOB);
    expect(sent.map((entry) => entry.to)).toEqual(['sendToUsers', 'sendToChannel']);
    expect(sent[0]?.args[1]).toMatchObject({ type: 'watch_state' });
  });

  it('refuses a change it cannot read', async () => {
    expect((await change({ action: 'seek', positionMs: -5 })).statusCode).toBe(400);
    expect((await change({ action: 'teleport' })).statusCode).toBe(400);
    expect((await change({ action: 'control', control: 'nobody' })).statusCode).toBe(400);
  });
});

describe('ending', () => {
  beforeEach(async () => {
    await add(YOUTUBE);
    await change({ action: 'control', control: 'starter' }, ALICE);
  });

  it('is for its starter, or someone who may move members, while only the starter steers', async () => {
    expect((await end(BOB)).json().code).toBe('watch_not_controller');
    expect(session()).toBeDefined();
    expect((await end(MOD)).statusCode).toBe(200);
    expect(session()).toBeUndefined();
    const toList = sent.filter((entry) => entry.to === 'sendToChannel').at(-1);
    expect(toList?.args[2]).toMatchObject({ type: 'watch_presence', presence: null });
  });

  it('the starter ends it', async () => {
    expect((await end(ALICE)).statusCode).toBe(200);
    expect(session()).toBeUndefined();
    expect((await end(ALICE)).json().code).toBe('watch_not_found');
  });
});

describe('reactions', () => {
  it('fly to those in the call, from the fixed set only, and not without end', async () => {
    expect((await react('🔥')).json().code).toBe('watch_not_found');
    await add(YOUTUBE);
    sent.length = 0;
    expect((await react('🔥')).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.args[1]).toEqual({ type: 'watch_reaction', channelId: VOICE, reaction: '🔥' });
    expect((await react('💩')).statusCode).toBe(400);
    for (let i = 1; i < WATCH_LIMITS.REACTIONS_PER_WINDOW; i += 1) await react('🎉');
    expect((await react('🎉')).statusCode).toBe(429);
  });
});
