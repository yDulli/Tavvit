import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { SOUNDBOARD_LIMITS } from '@backspace/shared/src/soundboard.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Who may add a clip, what counts as one, and who a clip reaches: those in the call, on their own devices.

setWorkerId(32);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
let uploadDir: string;

const { sent, room, probed } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; args: unknown[] }>,
  room: new Set<string>(),
  probed: { duration: 2 as number | null },
}));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'uploadDir') return uploadDir;
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});

vi.mock('../utils/thumbnail.js', () => ({
  probeMediaMeta: async () => (probed.duration === null ? null : { duration: probed.duration }),
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      if (name === 'getRoomParticipants') return args[0] === VOICE ? room : new Set();
      sent.push({ to: String(name), args });
      return undefined;
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
const SOUNDS = 'user-sounds';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const VOICE = 'channel-voice';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { soundboardRoutes, sniffAudio, _resetSoundboardLimitForTests } = await import('./soundboard.js');
const { removeUnusedSoundFiles, soundFilePath } = await import('../utils/soundFiles.js');

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);
const clip = (bytes: Buffer = OGG) => bytes.toString('base64');

beforeEach(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-sounds-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  room.clear();
  probed.duration = 2;
  _resetSoundboardLimitForTests();
  for (const id of [OWNER, SOUNDS, MEMBER, OUTSIDER]) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: OTHER_SPACE, name: 'Other', ownerId: OUTSIDER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: VOICE, spaceId: SPACE, name: 'lounge', type: 'voice', createdAt: 1 }).run();
  for (const id of [OWNER, SOUNDS, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-sounds', spaceId: SPACE, name: 'Sounds', position: 1, permissions: permissionsToString(PermissionBits.MANAGE_SOUNDS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: SOUNDS, roleId: 'role-sounds' }).run();
  app = Fastify();
  await app.register(soundboardRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const add = (userId = SOUNDS, payload: Record<string, unknown> = {}) => app.inject({
  method: 'POST', url: `/api/spaces/${SPACE}/sounds`, headers: headers(userId), payload: { name: 'Airhorn', audio: clip(), ...payload },
});
const play = (soundId: string, userId = MEMBER, channelId = VOICE) => app.inject({
  method: 'POST', url: `/api/channels/${channelId}/soundboard/${soundId}/play`, headers: headers(userId),
});
const madeSound = async (): Promise<string> => (await add()).json().id;

describe('adding a clip', () => {
  it('takes MANAGE_SOUNDS, keeps the file, and leaves a line in the audit log', async () => {
    expect((await add(MEMBER)).statusCode).toBe(403);
    expect((await add(OUTSIDER)).statusCode).toBe(403);
    const res = await add();
    expect(res.statusCode).toBe(201);
    const sound = res.json();
    expect(sound).toMatchObject({ name: 'Airhorn', duration: 2, createdBy: SOUNDS });
    expect(fs.existsSync(soundFilePath(sound.id))).toBe(true);
    expect(testDb.select().from(schema.spaceAuditLog).all().map((row) => row.action)).toEqual(['sound_create']);
    expect(sent.find((entry) => entry.to === 'sendToSpace')?.args[1]).toMatchObject({ type: 'space_sounds_changed', spaceId: SPACE });
  });

  it('refuses what is no audio, whatever it says it is, and leaves no file behind', async () => {
    const res = await add(SOUNDS, { audio: clip(Buffer.from('<html><script>alert(1)</script></html>')) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('sound_invalid');
    expect(fs.existsSync(path.join(uploadDir, 'sounds'))).toBe(false);
  });

  it('refuses one that is too long or too large', async () => {
    probed.duration = SOUNDBOARD_LIMITS.MAX_SECONDS + 1;
    const long = await add();
    expect(long.statusCode).toBe(400);
    expect(long.json().code).toBe('sound_too_long');
    expect(fs.readdirSync(path.join(uploadDir, 'sounds'))).toEqual([]);

    probed.duration = 2;
    const large = await add(SOUNDS, { audio: clip(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(SOUNDBOARD_LIMITS.MAX_BYTES)])) });
    expect(large.statusCode).toBe(400);
    expect(large.json().code).toBe('sound_too_large');
  });

  it('reads the length the browser measured on an instance without ffprobe, under the same limit, and needs one', async () => {
    probed.duration = null;
    expect((await add(SOUNDS, { duration: 1.5 })).json().duration).toBe(1.5);
    expect((await add(SOUNDS, { duration: SOUNDBOARD_LIMITS.MAX_SECONDS + 1 })).json().code).toBe('sound_too_long');
    expect((await add(SOUNDS, {})).json().code).toBe('sound_invalid');
  });

  it('holds a limited number', async () => {
    for (let i = 0; i < SOUNDBOARD_LIMITS.PER_SPACE_MAX; i += 1) {
      testDb.insert(schema.spaceSounds).values({ id: `s${i}`, spaceId: SPACE, name: `n${i}`, mimetype: 'audio/ogg', size: 1, duration: 1, createdAt: 1 }).run();
    }
    const res = await add();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('sound_limit_reached');
  });

  it('knows audio files by their first bytes', () => {
    const cases: Array<[Buffer, string | null]> = [
      [OGG, 'audio/ogg'],
      [Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]), 'audio/wav'],
      [Buffer.from([0x49, 0x44, 0x33, 4, 0]), 'audio/mpeg'],
      [Buffer.from([0xff, 0xfb, 0x90, 0]), 'audio/mpeg'],
      [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]), 'audio/webm'],
      [Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')]), 'audio/mp4'],
      [Buffer.from('fLaC'), 'audio/flac'],
      [Buffer.from('%PDF-1.7'), null],
      [Buffer.from('<svg></svg>'), null],
      [Buffer.alloc(0), null],
    ];
    for (const [bytes, expected] of cases) expect(sniffAudio(bytes), bytes.toString('hex').slice(0, 16)).toBe(expected);
  });
});

describe('reading and managing', () => {
  it('lists and serves clips to those in the space, as what they are, without letting them run', async () => {
    const id = await madeSound();
    expect((await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/sounds`, headers: headers(MEMBER) })).json().sounds).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/sounds`, headers: headers(OUTSIDER) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/sounds/${id}/audio`, headers: headers(OUTSIDER) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/sounds/${id}/audio` })).statusCode).toBe(401);
    const audio = await app.inject({ method: 'GET', url: `/api/sounds/${id}/audio`, headers: headers(MEMBER) });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toContain('audio/ogg');
    expect(audio.headers['x-content-type-options']).toBe('nosniff');
    expect(audio.rawPayload.equals(OGG)).toBe(true);
  });

  it('renames and deletes with the right to, and the file goes with it', async () => {
    const id = await madeSound();
    expect((await app.inject({ method: 'PATCH', url: `/api/sounds/${id}`, headers: headers(MEMBER), payload: { name: 'Mine' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/sounds/${id}`, headers: headers(SOUNDS), payload: { name: 'Horn' } })).json().name).toBe('Horn');
    expect((await app.inject({ method: 'DELETE', url: `/api/sounds/${id}`, headers: headers(MEMBER) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/sounds/${id}`, headers: headers(SOUNDS) })).statusCode).toBe(200);
    expect(fs.existsSync(soundFilePath(id))).toBe(false);
  });

  it('clears away files whose space is gone', async () => {
    const id = await madeSound();
    testDb.delete(schema.spaces).where(eq(schema.spaces.id, SPACE)).run();
    expect(removeUnusedSoundFiles()).toBe(1);
    expect(fs.existsSync(soundFilePath(id))).toBe(false);
  });

  it('the hourly sweep leaves a file young enough to be a clip on its way in', async () => {
    const id = await madeSound();
    testDb.delete(schema.spaces).where(eq(schema.spaces.id, SPACE)).run();
    const hour = 60 * 60 * 1000;
    expect(removeUnusedSoundFiles(hour)).toBe(0);
    expect(fs.existsSync(soundFilePath(id))).toBe(true);
    expect(removeUnusedSoundFiles(hour, Date.now() + 2 * hour)).toBe(1);
    expect(fs.existsSync(soundFilePath(id))).toBe(false);
  });

  it("a space deleted takes its clips' files with it, not only their rows", async () => {
    const id = await madeSound();
    const { spaceRoutes } = await import('./spaces.js');
    const spacesApp = Fastify();
    await spacesApp.register(spaceRoutes);
    await spacesApp.ready();
    try {
      expect((await spacesApp.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}`, headers: headers(OWNER) })).statusCode).toBe(200);
    } finally {
      await spacesApp.close();
    }
    expect(testDb.select().from(schema.spaceSounds).all()).toHaveLength(0);
    expect(fs.existsSync(soundFilePath(id))).toBe(false);
  });

  it("counts on its creator's storage, and is refused once that is full", async () => {
    testDb.update(schema.users).set({ storageLimitBytes: OGG.length + 10 }).where(eq(schema.users.id, SOUNDS)).run();
    expect((await add()).statusCode).toBe(201);
    const refused = await add(SOUNDS, { name: 'Second' });
    expect(refused.statusCode).toBe(413);
    expect(refused.json().code).toBe('storage_limit_reached');
    expect(fs.readdirSync(path.join(uploadDir, 'sounds'))).toHaveLength(1);
  });
});

describe('playing a clip', () => {
  const played = () => sent.filter((entry) => entry.to === 'sendToUser' && (entry.args[1] as { type: string }).type === 'soundboard_play');

  it('tells everyone in the call, and only them', async () => {
    const id = await madeSound();
    room.add(MEMBER);
    room.add(OWNER);
    sent.length = 0;
    const res = await play(id);
    expect(res.statusCode).toBe(200);
    expect(played().map((entry) => entry.args[0]).sort()).toEqual([MEMBER, OWNER].sort());
    expect(played()[0]?.args[1]).toEqual({ type: 'soundboard_play', channelId: VOICE, spaceId: SPACE, soundId: id, userId: MEMBER });
  });

  it('takes being in the call', async () => {
    const id = await madeSound();
    const res = await play(id);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('sound_not_in_call');
  });

  it('takes the right to, and a clip of this space', async () => {
    const id = await madeSound();
    room.add(MEMBER);
    testDb.insert(schema.spaceSounds).values({ id: 'foreign', spaceId: OTHER_SPACE, name: 'x', mimetype: 'audio/ogg', size: 1, duration: 1, createdAt: 1 }).run();
    expect((await play('foreign')).statusCode).toBe(404);

    testDb.insert(schema.channelOverrides).values({
      channelId: VOICE, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.USE_SOUNDBOARD),
    }).run();
    const refused = await play(id);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().details?.permission).toBe('USE_SOUNDBOARD');
  });

  it('is not for someone timed out', async () => {
    const id = await madeSound();
    room.add(MEMBER);
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 }).where(eq(schema.spaceMembers.userId, MEMBER)).run();
    expect((await play(id)).json().code).toBe('member_timed_out');
  });

  it('stops at its limit, for that person alone', async () => {
    const id = await madeSound();
    room.add(MEMBER);
    room.add(OWNER);
    for (let i = 0; i < SOUNDBOARD_LIMITS.PLAYS_PER_WINDOW; i += 1) expect((await play(id)).statusCode).toBe(200);
    expect((await play(id)).statusCode).toBe(429);
    expect((await play(id, OWNER)).statusCode).toBe(200);
  });
});
