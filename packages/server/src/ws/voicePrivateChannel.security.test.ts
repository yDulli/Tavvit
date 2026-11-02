import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';

// A private voice channel is one @everyone may not see. Nothing about permissions is implied by
// sight (permissions.md), so every voice check names VIEW_CHANNEL itself: a member who may
// CONNECT anywhere still may not join, hear, or learn who is in a channel hidden from them.

setWorkerId(33);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;
let requestUserId = 'member';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  schema,
}));

vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return { config: { ...actual.config, livekit: { ...actual.config.livekit, apiKey: 'key', apiSecret: 'a-secret-long-enough-for-livekit', url: 'ws://lk' } } };
});

vi.mock('../utils/auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/auth.js')>();
  return {
    ...actual,
    authenticate: async (req: { userId?: string; username?: string }) => {
      req.userId = requestUserId;
      req.username = requestUserId;
    },
  };
});

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

const SPACE = 'sp-private-voice';
const HIDDEN = 'vc-staff';
const OPEN = 'vc-lounge';

function seedUser(id: string): void {
  testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', homeUserId: id, homeInstance: null, createdAt: Date.now() }).run();
}

function fakeWs(): { readyState: number; send: ReturnType<typeof vi.fn> } {
  return { readyState: 1, send: vi.fn() };
}

function eventsOf(ws: { send: ReturnType<typeof vi.fn> }): Array<Record<string, unknown>> {
  return ws.send.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

beforeEach(() => {
  const sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of ['owner', 'member', 'mod']) seedUser(id);
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'owner', createdAt: Date.now() }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: Date.now() }).run();
  // A moderator by role: may move and mute everywhere, but the hidden channel is hidden from them too.
  testDb.insert(schema.roles).values({ id: 'role-mod', spaceId: SPACE, name: 'Mods', position: 1, createdAt: Date.now(),
    permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS | PermissionBits.MOVE_MEMBERS | PermissionBits.MUTE_MEMBERS | PermissionBits.DISCONNECT_MEMBERS) }).run();
  for (const id of ['owner', 'member', 'mod']) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: Date.now() }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: 'mod', roleId: 'role-mod' }).run();
  for (const id of [HIDDEN, OPEN]) {
    testDb.insert(schema.channels).values({ id, spaceId: SPACE, name: id, type: 'voice', position: 0, createdAt: Date.now() }).run();
  }
  testDb.insert(schema.channelOverrides).values({ channelId: HIDDEN, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL) }).run();
  requestUserId = 'member';
});

afterEach(async () => {
  const { connectionManager } = await import('./handler.js');
  for (const id of [HIDDEN, OPEN]) connectionManager.destroyRoom(id);
  for (const id of ['owner', 'member', 'mod']) {
    for (const ws of [...connectionManager.getUserConnections(id)]) connectionManager.removeConnection(ws);
  }
  vi.restoreAllMocks();
});

async function connect(userId: string) {
  const { connectionManager } = await import('./handler.js');
  const ws = fakeWs();
  connectionManager.addConnection(userId, ws as never);
  connectionManager.addUserSpace(userId, SPACE);
  return ws;
}

describe('a voice channel hidden from @everyone', () => {
  it('cannot be joined by its id over the socket', async () => {
    const { connectionManager } = await import('./handler.js');
    const { handleClientEvent } = await import('./events.js');
    const ws = await connect('member');
    handleClientEvent({ type: 'voice_join', channelId: HIDDEN }, 'member', 'member', ws as never, false);
    expect(connectionManager.getUserRoom('member')).toBeNull();
    handleClientEvent({ type: 'voice_join', channelId: OPEN }, 'member', 'member', ws as never, false);
    expect(connectionManager.getUserRoom('member')?.roomId).toBe(OPEN);
  });

  it('gives no LiveKit token to someone who cannot see it', async () => {
    const { livekitRoutes } = await import('../routes/livekit.js');
    const app = Fastify({ logger: false });
    await app.register(livekitRoutes);
    await app.ready();
    const hidden = await app.inject({ method: 'POST', url: '/api/livekit/token', payload: { channelId: HIDDEN } });
    expect(hidden.statusCode).toBe(403);
    expect(hidden.json().code).toBe('voice_connect_forbidden');
    requestUserId = 'owner';
    expect((await app.inject({ method: 'POST', url: '/api/livekit/token', payload: { channelId: HIDDEN } })).statusCode).toBe(200);
    await app.close();
  });

  it('tells only those who can see it who joins it', async () => {
    const { handleClientEvent } = await import('./events.js');
    const member = await connect('member');
    const owner = await connect('owner');
    handleClientEvent({ type: 'voice_join', channelId: HIDDEN }, 'owner', 'owner', owner as never, false);
    const seen = (ws: typeof member) => eventsOf(ws).filter((e) => e.channelId === HIDDEN);
    expect(seen(owner).some((e) => e.type === 'voice_state_update' && e.action === 'join')).toBe(true);
    expect(seen(member)).toEqual([]);
  });

  it('cannot be a moderator\'s way in or out when they cannot see it', async () => {
    const { connectionManager } = await import('./handler.js');
    const { handleClientEvent } = await import('./events.js');
    const owner = await connect('owner');
    const mod = await connect('mod');
    const member = await connect('member');
    handleClientEvent({ type: 'voice_join', channelId: HIDDEN }, 'owner', 'owner', owner as never, false);
    handleClientEvent({ type: 'voice_join', channelId: OPEN }, 'member', 'member', member as never, false);
    // Moving the member into the hidden channel, and the owner out of it, are both refused.
    handleClientEvent({ type: 'voice_move', userId: 'member', targetChannelId: HIDDEN }, 'mod', 'mod', mod as never, false);
    expect(connectionManager.getUserRoom('member')?.roomId).toBe(OPEN);
    expect(connectionManager.getUserRoom('owner')?.roomId).toBe(HIDDEN);
  });
});
