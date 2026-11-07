import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { PermissionBits } from '../utils/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';

// The voice overlay (docs/systems/voice-overlay.md): a link only someone who may stream in the
// channel can make, shown once, ended by a new one, and a page that learns who is in the channel
// and joins voice only as someone who can neither hear nor send.

setWorkerId(8);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let currentUserId = 'owner';
const channelEvents = vi.hoisted(() => [] as Array<{ type: string; channel?: { streamOverlay?: boolean } }>);
const room = vi.hoisted(() => ({ participants: new Set<string>() }));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; } }));
vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return { config: { ...actual.config, livekit: { url: 'wss://voice.example', apiKey: 'test-key', apiSecret: 'test-secret-that-is-long-enough-1234' } } };
});
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToChannel: (_space: string, _channel: string, event: { type: string; channel?: { streamOverlay?: boolean } }) => { channelEvents.push(event); },
    getRoom: (id: string) => (id === 'voice' ? { roomId: id, participants: room.participants } : undefined),
    getVoiceUserStatus: (id: string) => (id === 'member' ? { isMuted: true, isDeafened: false, isCameraOn: false, isScreenSharing: false } : undefined),
  },
}));

beforeEach(async () => {
  channelEvents.length = 0;
  room.participants = new Set();
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of fs.readdirSync(path.resolve(__dirname, '../../drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.resolve(__dirname, '../../drizzle', file), 'utf8'));
  }
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  for (const id of ['owner', 'member']) {
    testDb.insert(schema.users).values({ id, username: id, displayName: id === 'owner' ? 'Owner' : 'Member', passwordHash: 'x', homeUserId: id, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'owner', joinedAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'member', nickname: 'Kim', joinedAt: 1 }).run();
  // Everyone may join and stream, as a new space's @everyone role allows (its id is the space's).
  testDb.insert(schema.roles).values({ id: 'space', spaceId: 'space', name: '@everyone', permissions: (PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT | PermissionBits.SPEAK | PermissionBits.STREAM).toString(), position: 0, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: 'voice', spaceId: 'space', name: 'lounge', type: 'voice', position: 0, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: 'text', spaceId: 'space', name: 'general', type: 'text', position: 1, createdAt: 1 }).run();
  const { resetVoiceOverlayChannels } = await import('../utils/voiceOverlayChannels.js');
  resetVoiceOverlayChannels([]);
  app = Fastify({ logger: false });
  await app.register((await import('./voiceOverlay.js')).voiceOverlayRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const make = (channel = 'voice') => app.inject({ method: 'POST', url: `/api/channels/${channel}/overlay` });
const ask = (secret: string) => app.inject({ method: 'GET', url: `/api/overlay/voice/${secret}` });

/** The @everyone role takes STREAM away in the whole space. */
function noStreamingForMembers(): void {
  sqlite.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
    .run((PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT | PermissionBits.SPEAK).toString(), 'space');
}

describe('making a link', () => {
  it('needs the right to stream in the channel, and a voice channel', async () => {
    noStreamingForMembers();
    currentUserId = 'member';
    const refused = await make();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'STREAM' } });
    currentUserId = 'owner';
    expect((await make('text')).statusCode).toBe(404);
  });

  it('shows its secret once, marks the channel, and a new one ends the old', async () => {
    const first = await make();
    expect(first.statusCode).toBe(201);
    const { secret } = first.json() as { secret: string };
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(channelEvents.at(-1)).toMatchObject({ type: 'channel_updated', channel: { streamOverlay: true } });
    expect((await app.inject({ method: 'GET', url: '/api/channels/voice/overlay' })).json()).toMatchObject({ exists: true });
    // Only its hash is kept.
    expect(JSON.stringify(testDb.select().from(schema.voiceOverlays).all())).not.toContain(secret);

    const second = (await make()).json() as { secret: string };
    expect((await ask(secret)).statusCode).toBe(404);
    expect((await ask(second.secret)).statusCode).toBe(200);
  });

  it('is taken away, and the channel says so', async () => {
    const { secret } = (await make()).json() as { secret: string };
    const removed = await app.inject({ method: 'DELETE', url: '/api/channels/voice/overlay' });
    expect(removed.json()).toEqual({ success: true });
    expect((await ask(secret)).statusCode).toBe(404);
    expect(channelEvents.at(-1)).toMatchObject({ channel: { streamOverlay: false } });
  });
});

describe('the overlay page', () => {
  it('learns who is in the channel as the space shows them, muted or not', async () => {
    room.participants = new Set(['owner', 'member']);
    const { secret } = (await make()).json() as { secret: string };
    const res = await ask(secret);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const state = res.json() as { channelName: string; people: Array<{ id: string; name: string; muted: boolean }>; livekit: { token: string } };
    expect(state.channelName).toBe('lounge');
    expect(state.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'owner', name: 'Owner', muted: false }),
      expect.objectContaining({ id: 'member', name: 'Kim', muted: true }),
    ]));
    // A participant nobody sees, that can neither hear nor send.
    const payload = JSON.parse(Buffer.from(state.livekit.token.split('.')[1]!, 'base64url').toString('utf8'));
    expect(payload.video).toMatchObject({ room: 'voice', roomJoin: true, hidden: true, canPublish: false, canSubscribe: false, canPublishData: false });
  });

  it('stops working when its maker may no longer stream there, and for a wrong secret', async () => {
    currentUserId = 'member';
    const made = await make();
    expect(made.statusCode).toBe(201);
    const { secret } = made.json() as { secret: string };
    expect((await ask(secret)).statusCode).toBe(200);
    noStreamingForMembers();
    expect((await ask(secret)).json().code).toBe('voice_overlay_unavailable');
    expect((await ask('x'.repeat(43))).statusCode).toBe(404);
    expect((await ask('short')).statusCode).toBe(404);
  });
});
