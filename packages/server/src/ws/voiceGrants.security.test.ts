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

// What a moderator takes from someone in a call is taken at LiveKit too: a token never grants it
// again, and one already handed out loses it, whatever the person's client does with the event.

setWorkerId(34);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;
let requestUserId = 'member';

const livekit = vi.hoisted(() => ({
  people: [] as Array<{ identity: string; tracks: Array<{ sid: string; source: number; muted: boolean }> }>,
  updated: [] as Array<{ room: string; identity: string; permission: Record<string, unknown> }>,
  silenced: [] as Array<{ room: string; identity: string; sid: string }>,
}));

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  schema,
}));

vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return { config: { ...actual.config, livekit: { ...actual.config.livekit, apiKey: 'key', apiSecret: 'a-secret-long-enough-for-livekit', url: 'ws://lk' } } };
});

vi.mock('livekit-server-sdk', async (importActual) => ({
  ...(await importActual<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    async listParticipants() { return livekit.people; }
    async updateParticipant(room: string, identity: string, options: { permission: Record<string, unknown> }) {
      livekit.updated.push({ room, identity, permission: options.permission });
    }
    async mutePublishedTrack(room: string, identity: string, sid: string) { livekit.silenced.push({ room, identity, sid }); }
    async removeParticipant() { /* not under test */ }
  },
}));

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

const { TrackSource } = await import('livekit-server-sdk');

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

const SPACE = 'sp-grants';
const VOICE = 'vc-grants';

function seedUser(id: string): void {
  testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', homeUserId: id, homeInstance: null, createdAt: Date.now() }).run();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** The grant a token carries, as LiveKit reads it. */
function grantOf(token: string): { canPublishSources: string[]; canSubscribe: boolean; canPublish: boolean } {
  const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { video: { canPublishSources: string[]; canSubscribe: boolean; canPublish: boolean } };
  return payload.video;
}

beforeEach(() => {
  const sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of ['owner', 'member', 'mod']) seedUser(id);
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'owner', createdAt: Date.now() }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: Date.now() }).run();
  testDb.insert(schema.roles).values({ id: 'role-mod', spaceId: SPACE, name: 'Mods', position: 1, createdAt: Date.now(),
    permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS | PermissionBits.MUTE_MEMBERS | PermissionBits.DEAFEN_MEMBERS) }).run();
  for (const id of ['owner', 'member', 'mod']) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: Date.now() }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: 'mod', roleId: 'role-mod' }).run();
  testDb.insert(schema.channels).values({ id: VOICE, spaceId: SPACE, name: 'lounge', type: 'voice', position: 0, createdAt: Date.now() }).run();
  requestUserId = 'member';
  livekit.people = [{ identity: 'member:member', tracks: [
    { sid: 'TR_mic', source: TrackSource.MICROPHONE, muted: false },
    { sid: 'TR_screen', source: TrackSource.SCREEN_SHARE, muted: false },
  ] }];
  livekit.updated = [];
  livekit.silenced = [];
});

afterEach(async () => {
  const { connectionManager } = await import('./handler.js');
  connectionManager.destroyRoom(VOICE);
  for (const id of ['owner', 'member', 'mod']) {
    for (const ws of [...connectionManager.getUserConnections(id)]) connectionManager.removeConnection(ws);
  }
  vi.restoreAllMocks();
});

async function connect(userId: string) {
  const { connectionManager } = await import('./handler.js');
  const ws = { readyState: 1, send: vi.fn() };
  connectionManager.addConnection(userId, ws as never);
  connectionManager.addUserSpace(userId, SPACE);
  return ws;
}

async function tokenGrant() {
  const { livekitRoutes } = await import('../routes/livekit.js');
  const app = Fastify({ logger: false });
  await app.register(livekitRoutes);
  await app.ready();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/livekit/token', payload: { channelId: VOICE } });
    expect(res.statusCode).toBe(200);
    return grantOf(res.json().token);
  } finally {
    await app.close();
  }
}

const restrict = (type: 'mute' | 'deafen') =>
  testDb.insert(schema.voiceRestrictions).values({ spaceId: SPACE, userId: 'member', restrictionType: type, moderatorId: 'mod', createdAt: Date.now() }).run();

describe('a token for a space voice channel', () => {
  it('grants speaking and hearing to a member who may', async () => {
    const grant = await tokenGrant();
    expect(grant.canPublishSources).toContain('microphone');
    expect(grant.canSubscribe).toBe(true);
  });

  it('grants no sound and no camera to a member a moderator muted, a shared screen\'s sound neither', async () => {
    restrict('mute');
    const grant = await tokenGrant();
    expect(grant.canPublishSources).not.toContain('microphone');
    expect(grant.canPublishSources).not.toContain('camera');
    expect(grant.canPublishSources).not.toContain('screen_share_audio');
    expect(grant.canSubscribe).toBe(true);
  });

  it('lets a member a moderator deafened hear nothing', async () => {
    restrict('deafen');
    expect((await tokenGrant()).canSubscribe).toBe(false);
  });
});

describe('a moderator muting someone already in the call', () => {
  it('tells LiveKit, which takes the microphone and silences the one being sent', async () => {
    const { handleClientEvent } = await import('./events.js');
    const member = await connect('member');
    const mod = await connect('mod');
    handleClientEvent({ type: 'voice_join', channelId: VOICE }, 'member', 'member', member as never, false);
    handleClientEvent({ type: 'voice_space_mute', userId: 'member', muted: true }, 'mod', 'mod', mod as never, false);
    await settle();

    const update = livekit.updated.find((entry) => entry.identity === 'member:member');
    expect(update?.room).toBe(VOICE);
    expect(update?.permission.canPublishSources).not.toContain(TrackSource.MICROPHONE);
    expect(livekit.silenced).toEqual([{ room: VOICE, identity: 'member:member', sid: 'TR_mic' }]);
  });

  it('and deafening them takes what the others send', async () => {
    const { handleClientEvent } = await import('./events.js');
    const member = await connect('member');
    const mod = await connect('mod');
    handleClientEvent({ type: 'voice_join', channelId: VOICE }, 'member', 'member', member as never, false);
    handleClientEvent({ type: 'voice_space_deafen', userId: 'member', deafened: true }, 'mod', 'mod', mod as never, false);
    await settle();
    expect(livekit.updated.find((entry) => entry.identity === 'member:member')?.permission.canSubscribe).toBe(false);
  });
});

describe('a role losing SPEAK while its members are in a call', () => {
  it('takes the microphone at LiveKit too', async () => {
    const { handleClientEvent, checkVoicePermissions } = await import('./events.js');
    const member = await connect('member');
    handleClientEvent({ type: 'voice_join', channelId: VOICE }, 'member', 'member', member as never, false);
    testDb.update(schema.roles).set({ permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS & ~PermissionBits.SPEAK) }).run();
    livekit.updated = [];
    checkVoicePermissions(SPACE);
    await settle();
    expect(livekit.updated.find((entry) => entry.identity === 'member:member')?.permission.canPublishSources).not.toContain(TrackSource.MICROPHONE);
    expect(livekit.silenced.map((entry) => entry.sid)).toContain('TR_mic');
  });
});
