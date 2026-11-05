import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { SPACE_EXPRESSION_LIMITS } from '@backspace/shared/src/spaceExpressions.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// A space's own emoji and stickers: who may add, rename and remove them (checked on the server,
// whatever a client shows), what the space holds at most, what counts on the creator's storage,
// what the audit log keeps and who hears of a change.

setWorkerId(33);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
let uploadDir: string;

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ to: string; args: unknown[] }> }));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'uploadDir' || prop === 'tusUploadDir') return uploadDir;
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});

vi.mock('../utils/federationAuth.js', () => ({ getOurOrigin: () => 'https://chat.test' }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
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
const KEEPER = 'user-keeper';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { spaceExpressionRoutes, _resetSpaceExpressionLimits } = await import('./spaceExpressions.js');
const { emojiRoutes } = await import('./emojis.js');
const { storageUsage } = await import('../utils/accountLimits.js');
const { getReferencedStickerIds, stickerAssetPath } = await import('../utils/stickerAssets.js');
const { emojiFilePath } = await import('../utils/emojiImage.js');
const { removeUnusedEmojiFiles } = await import('../utils/spaceExpressions.js');
const { runMediaJob, MediaBusyError } = await import('../utils/thumbnail.js');
const { MAX_STICKER_FRAMES } = await import('@backspace/shared/src/stickers.js');

async function picture(color: { r: number; g: number; b: number } = { r: 240, g: 80, b: 60 }, size = 64): Promise<string> {
  const bytes = await sharp({ create: { width: size, height: size, channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer();
  return bytes.toString('base64');
}

beforeEach(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-expressions-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  _resetSpaceExpressionLimits();
  for (const id of [OWNER, KEEPER, MEMBER, OUTSIDER]) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: OTHER_SPACE, name: 'Other', ownerId: OUTSIDER, createdAt: 1 }).run();
  for (const id of [OWNER, KEEPER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: OTHER_SPACE, userId: OUTSIDER, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-keeper', spaceId: SPACE, name: 'Keepers', position: 1, permissions: permissionsToString(PermissionBits.MANAGE_EMOJIS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: KEEPER, roleId: 'role-keeper' }).run();
  app = Fastify();
  await app.register(spaceExpressionRoutes);
  await app.register(emojiRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const addEmoji = async (userId = KEEPER, payload: Record<string, unknown> = {}, spaceId = SPACE) => app.inject({
  method: 'POST', url: `/api/spaces/${spaceId}/emojis`, headers: headers(userId), payload: { name: 'Party_Parrot', image: await picture(), ...payload },
});
const addSticker = async (userId = KEEPER, payload: Record<string, unknown> = {}) => app.inject({
  method: 'POST', url: `/api/spaces/${SPACE}/stickers`, headers: headers(userId), payload: { name: 'Wave', image: await picture({ r: 30, g: 160, b: 90 }, 300), ...payload },
});
const audit = (action: string) => testDb.select().from(schema.spaceAuditLog).where(eq(schema.spaceAuditLog.action, action)).all();
const events = (type: string) => sent.filter((entry) => entry.to === 'sendToSpace' && (entry.args[1] as { type?: string })?.type === type);

describe('listing', () => {
  it('shows the lists to members and those who manage them, and to nobody else', async () => {
    const member = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/emojis`, headers: headers(MEMBER) });
    expect(member.statusCode).toBe(200);
    expect(member.json()).toEqual({ emojis: [], max: SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE });
    const stickers = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/stickers`, headers: headers(MEMBER) });
    expect(stickers.json()).toEqual({ stickers: [], max: SPACE_EXPRESSION_LIMITS.STICKERS_PER_SPACE });
    const outsider = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/emojis`, headers: headers(OUTSIDER) });
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().code).toBe('not_space_member');
  });
});

describe('what a person may pick', () => {
  it('lists the library and every space they are in, those with nothing too, and no other', async () => {
    testDb.insert(schema.customEmojis).values({ id: '9000001', name: 'lib', size: 1, createdBy: OWNER, createdAt: 1 }).run();
    testDb.insert(schema.spaceEmojis).values({ id: '9000002', spaceId: SPACE, name: 'ours', size: 1, createdBy: OWNER, createdAt: 1 }).run();
    testDb.insert(schema.spaceEmojis).values({ id: '9000003', spaceId: OTHER_SPACE, name: 'theirs', size: 1, createdBy: OUTSIDER, createdAt: 1 }).run();
    const member = await app.inject({ method: 'GET', url: '/api/emojis/available', headers: headers(MEMBER) });
    expect(member.statusCode).toBe(200);
    const body = member.json() as { library: Array<{ id: string }>; spaces: Array<{ spaceId: string; emojis: Array<{ id: string }>; stickers: unknown[] }> };
    expect(body.library.map((entry) => entry.id)).toEqual(['9000001']);
    expect(body.spaces).toEqual([{ spaceId: SPACE, emojis: [expect.objectContaining({ id: '9000002', name: 'ours' })], stickers: [] }]);
    const outsider = (await app.inject({ method: 'GET', url: '/api/emojis/available', headers: headers(OUTSIDER) })).json() as typeof body;
    expect(outsider.spaces.map((entry) => entry.spaceId)).toEqual([OTHER_SPACE]);
  });
});

describe('emoji', () => {
  it('refuses a member without the right, on the server, before anything is written', async () => {
    const response = await addEmoji(MEMBER);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'MANAGE_EMOJIS' } });
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(0);
    expect(fs.existsSync(path.join(uploadDir, 'emoji'))).toBe(false);
  });

  it('refuses someone with the right while they are timed out', async () => {
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60 * 60 * 1000 })
      .where(eq(schema.spaceMembers.userId, KEEPER)).run();
    const response = await addEmoji(KEEPER);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('member_timed_out');
  });

  it('adds one: a re-encoded picture, a row with its size and creator, an audit entry and word to the space', async () => {
    const response = await addEmoji(KEEPER);
    expect(response.statusCode).toBe(201);
    const emoji = response.json();
    expect(emoji).toMatchObject({ spaceId: SPACE, name: 'party_parrot', animated: false, createdBy: KEEPER });
    const row = testDb.select().from(schema.spaceEmojis).where(eq(schema.spaceEmojis.id, emoji.id)).get()!;
    expect(row.size).toBeGreaterThan(0);
    expect((await sharp(fs.readFileSync(emojiFilePath(emoji.id))).metadata()).format).toBe('webp');
    expect(storageUsage(KEEPER).usedBytes).toBe(row.size);
    expect(audit('emoji_create')).toMatchObject([{ spaceId: SPACE, actorId: KEEPER, targetId: emoji.id, targetLabel: 'party_parrot' }]);
    expect(events('space_emojis_changed')).toHaveLength(1);

    // The one public address of an emoji's picture serves a space's too.
    const served = await app.inject({ method: 'GET', url: `/api/emojis/${emoji.id}.webp` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
  });

  it('refuses a name the space has, a name that is none and a picture that is none', async () => {
    expect((await addEmoji(KEEPER)).statusCode).toBe(201);
    const taken = await addEmoji(KEEPER, { name: 'PARTY_PARROT' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('space_emoji_name_taken');
    const badName = await addEmoji(KEEPER, { name: 'a' });
    expect(badName.json().code).toBe('emoji_name_invalid');
    const notPicture = await addEmoji(KEEPER, { name: 'words', image: Buffer.from('just some words').toString('base64') });
    expect(notPicture.statusCode).toBe(400);
    expect(notPicture.json().code).toBe('emoji_image_invalid');
    const notBase64 = await addEmoji(KEEPER, { name: 'broken', image: 'not*base64' });
    expect(notBase64.json().code).toBe('emoji_image_invalid');
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(1);
  });

  it('lets two spaces have an emoji of the same name', async () => {
    expect((await addEmoji(KEEPER)).statusCode).toBe(201);
    expect((await addEmoji(OUTSIDER, {}, OTHER_SPACE)).statusCode).toBe(201);
  });

  it('holds a space to its limit', async () => {
    for (let index = 0; index < SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE; index += 1) {
      testDb.insert(schema.spaceEmojis).values({
        id: String(1_000_000 + index), spaceId: SPACE, name: `e${index}`, size: 10, createdBy: OWNER, createdAt: 1,
      }).run();
    }
    const response = await addEmoji(KEEPER);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'space_emoji_limit_reached', details: { max: SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE } });
  });

  it('refuses one that would pass the creator\'s storage', async () => {
    testDb.update(schema.users).set({ storageLimitBytes: 1 }).where(eq(schema.users.id, KEEPER)).run();
    const response = await addEmoji(KEEPER);
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('storage_limit_reached');
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(0);
  });

  it('renames and removes with the audit trail, and only for those with the right', async () => {
    const { id } = (await addEmoji(KEEPER)).json();
    const refused = await app.inject({ method: 'PATCH', url: `/api/space-emojis/${id}`, headers: headers(MEMBER), payload: { name: 'parrot' } });
    expect(refused.statusCode).toBe(403);

    const renamed = await app.inject({ method: 'PATCH', url: `/api/space-emojis/${id}`, headers: headers(KEEPER), payload: { name: 'Parrot' } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('parrot');
    const [entry] = audit('emoji_update');
    expect(JSON.parse(entry!.changes!)).toEqual([{ key: 'name', from: 'party_parrot', to: 'parrot' }]);

    const removed = await app.inject({ method: 'DELETE', url: `/api/space-emojis/${id}`, headers: headers(OWNER) });
    expect(removed.statusCode).toBe(200);
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(0);
    expect(fs.existsSync(emojiFilePath(id))).toBe(false);
    expect(audit('emoji_delete')).toMatchObject([{ targetId: id, targetLabel: 'parrot' }]);
    const gone = await app.inject({ method: 'GET', url: `/api/emojis/${id}.webp` });
    expect(gone.statusCode).toBe(404);
  });

  it('sweeps pictures no emoji names any more, and keeps those that one does', async () => {
    const { id } = (await addEmoji(KEEPER)).json();
    const stray = path.join(uploadDir, 'emoji', '123456789.webp');
    fs.writeFileSync(stray, 'left over');
    expect(removeUnusedEmojiFiles(0)).toBe(1);
    expect(fs.existsSync(stray)).toBe(false);
    expect(fs.existsSync(emojiFilePath(id))).toBe(true);
  });
});

describe('picture work', () => {
  it('lets an account have one picture job under way; a second is refused at once, not queued', async () => {
    let release!: () => void;
    const first = runMediaJob(() => new Promise<void>((resolve) => { release = resolve; }), KEEPER);
    await expect(runMediaJob(async () => undefined, KEEPER)).rejects.toBeInstanceOf(MediaBusyError);
    // Someone else's goes on.
    await expect(runMediaJob(async () => 'other', MEMBER)).resolves.toBe('other');
    const refused = await addEmoji(KEEPER);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().code).toBe('rate_limited');
    release();
    await first;
    expect((await addEmoji(KEEPER)).statusCode).toBe(201);
  });
});

describe('stickers', () => {
  it('adds one with a description; its picture is the shared asset a member can collect', async () => {
    const response = await addSticker(KEEPER, { description: 'A waving hand' });
    expect(response.statusCode).toBe(201);
    const sticker = response.json();
    expect(sticker).toMatchObject({ spaceId: SPACE, name: 'Wave', description: 'A waving hand', createdBy: KEEPER });
    expect(sticker.token).toBe(`sticker:https://chat.test/api/stickers/assets/${sticker.stickerId}.webp`);
    expect(fs.existsSync(stickerAssetPath(sticker.stickerId))).toBe(true);
    expect(getReferencedStickerIds().has(sticker.stickerId)).toBe(true);
    const row = testDb.select().from(schema.spaceStickers).where(eq(schema.spaceStickers.id, sticker.id)).get()!;
    expect(storageUsage(KEEPER).usedBytes).toBe(row.size);
    expect(audit('sticker_create')).toHaveLength(1);
    expect(events('space_stickers_changed')).toHaveLength(1);
  });

  it('refuses a member without the right, a taken name in any case, and a description of many lines', async () => {
    expect((await addSticker(MEMBER)).statusCode).toBe(403);
    expect((await addSticker(KEEPER)).statusCode).toBe(201);
    const taken = await addSticker(KEEPER, { name: 'WAVE' });
    expect(taken.json().code).toBe('space_sticker_name_taken');
    const description = await addSticker(KEEPER, { name: 'Other', description: 'two\nlines' });
    expect(description.statusCode).toBe(400);
    expect(description.json()).toMatchObject({ code: 'validation_failed', details: { field: 'description' } });
  });

  it('changes name and description in one go, and records both', async () => {
    const { id } = (await addSticker(KEEPER)).json();
    const changed = await app.inject({
      method: 'PATCH', url: `/api/space-stickers/${id}`, headers: headers(KEEPER), payload: { name: 'Hello', description: 'Says hello' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ name: 'Hello', description: 'Says hello' });
    const [entry] = audit('sticker_update');
    expect(JSON.parse(entry!.changes!)).toEqual([
      { key: 'name', from: 'Wave', to: 'Hello' },
      { key: 'description', from: null, to: 'Says hello' },
    ]);
    const cleared = await app.inject({ method: 'PATCH', url: `/api/space-stickers/${id}`, headers: headers(KEEPER), payload: { description: '' } });
    expect(cleared.json().description).toBeNull();
  });

  it('refuses an animation with more frames than any sticker needs, before encoding it', async () => {
    const frames = MAX_STICKER_FRAMES + 1;
    // A 2x2 animation: tiny in pixels, long in frames.
    const strip = Buffer.alloc(2 * 2 * 4 * frames, 0);
    for (let frame = 0; frame < frames; frame += 1) strip.fill(frame % 2 ? 255 : 0, frame * 16, frame * 16 + 16);
    const gif = await sharp(strip, { raw: { width: 2, height: 2 * frames, channels: 4, pageHeight: 2 } }).gif().toBuffer();
    const response = await addSticker(KEEPER, { image: gif.toString('base64') });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('sticker_invalid_image');
  });

  it('removing one keeps its picture for the messages and collections that show it', async () => {
    const sticker = (await addSticker(KEEPER)).json();
    const removed = await app.inject({ method: 'DELETE', url: `/api/space-stickers/${sticker.id}`, headers: headers(KEEPER) });
    expect(removed.statusCode).toBe(200);
    expect(testDb.select().from(schema.spaceStickers).all()).toHaveLength(0);
    expect(fs.existsSync(stickerAssetPath(sticker.stickerId))).toBe(true);
    expect(audit('sticker_delete')).toMatchObject([{ targetId: sticker.id, targetLabel: 'Wave' }]);
  });
});
