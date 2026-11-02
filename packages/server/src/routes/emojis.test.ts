import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import * as schema from '../db/schema.js';
import { CUSTOM_EMOJI_LIMITS } from '@backspace/shared/src/customEmoji.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(7);

const settings = vi.hoisted(() => ({ uploadDir: '' }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, schema }));
vi.mock('../config.js', () => ({ config: settings }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToAll: (event: Record<string, unknown>) => { sent.push(event); } } }));
vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId: string; headers: Record<string, string> }, reply: { code: (code: number) => { send: () => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send();
    request.userId = request.headers.authorization;
  },
}));
import { emojiRoutes, _resetEmojiUploadLimit } from './emojis.js';

beforeEach(async () => {
  sent.length = 0;
  _resetEmojiUploadLimit();
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'orbit-emoji-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });
  db.insert(schema.users).values([
    { id: 'admin', username: 'admin', passwordHash: 'x', createdAt: 1, isAdmin: 1 },
    { id: 'alice', username: 'alice', passwordHash: 'x', createdAt: 1 },
    { id: 'bob', username: 'bob', passwordHash: 'x', createdAt: 1 },
  ]).run();
  // Most of this file is about the library itself; who may add has its own block below.
  db.insert(schema.instanceSettings).values({ id: 1, emojiPolicy: 'everyone', updatedAt: 1 }).run();
  app = Fastify();
  await app.register(emojiRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  await rm(settings.uploadDir, { recursive: true, force: true });
});

async function png(width = 40, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 1 } } }).png().toBuffer();
}

async function gif(frames = 3): Promise<Buffer> {
  const pngs: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    pngs.push(await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: i * 80, g: 60, b: 200 } } }).png().toBuffer());
  }
  return sharp(pngs, { join: { animated: true } }).gif({ delay: new Array<number>(frames).fill(80), loop: 0 }).toBuffer();
}

const file = (id: string) => path.join(settings.uploadDir, 'emoji', `${id}.webp`);
const exists = (p: string) => access(p).then(() => true, () => false);
/** The stored picture's metadata, read from its bytes: a decoder holding the file open would lock it on Windows. */
const metaOf = async (id: string, animated = false) => sharp(await readFile(file(id)), { animated }).metadata();

function add(name: string, image: Buffer, who: string | null = 'alice') {
  return app.inject({
    method: 'POST', url: '/api/emojis', headers: who ? { authorization: who } : {},
    payload: { name, image: image.toString('base64') },
  });
}

describe('adding an emoji', () => {
  it('stores the picture and answers with the emoji, telling everyone', async () => {
    const res = await add('party_parrot', await png());
    expect(res.statusCode).toBe(201);
    const emoji = res.json();
    expect(emoji).toMatchObject({ name: 'party_parrot', animated: false, createdBy: 'alice' });
    expect(emoji.id).toMatch(/^\d+$/);
    expect(await exists(file(emoji.id))).toBe(true);
    expect(sent).toEqual([{ type: 'emoji_upserted', emoji }]);
  });

  it('stores a WebP of at most 128 pixels, whatever it was given', async () => {
    const { id } = (await add('wide', await png(600, 200))).json();
    const meta = await metaOf(id);
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(CUSTOM_EMOJI_LIMITS.SIZE);
    // The shape is kept: no square padding is added.
    expect(meta.width!).toBeGreaterThan(meta.height!);
  });

  it('does not enlarge a small picture', async () => {
    const { id } = (await add('tiny', await png(20, 20))).json();
    const meta = await metaOf(id);
    expect([meta.width, meta.height]).toEqual([20, 20]);
  });

  it('keeps an animation animated and says so', async () => {
    const res = await add('dance', await gif(4));
    expect(res.statusCode).toBe(201);
    expect(res.json().animated).toBe(true);
    const meta = await metaOf(res.json().id, true);
    expect(meta.pages).toBe(4);
  });

  it('forgives capitals, spaces and colons around the name', async () => {
    const res = await add(' :Party_Parrot: ', await png());
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('party_parrot');
  });

  it.each(['a', 'x'.repeat(33), 'has space', 'dash-ed', 'ümlaut', ''])('refuses the name %j', async (name) => {
    const res = await add(name, await png());
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('emoji_name_invalid');
    expect(res.json().details).toEqual({ min: 2, max: 32 });
    expect(db.select().from(schema.customEmojis).all()).toEqual([]);
  });

  it('refuses a name that is taken, however it was written, and writes nothing', async () => {
    await add('wave', await png());
    const res = await add('WAVE', await png());
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('emoji_name_taken');
    expect(await readdir(path.join(settings.uploadDir, 'emoji'))).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('refuses a file that is not a picture', async () => {
    const res = await add('nope', Buffer.from('this is not an image at all'));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('emoji_image_invalid');
    expect(db.select().from(schema.customEmojis).all()).toEqual([]);
  });

  it('refuses text that is not base64, and base64 that is not canonical', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/emojis', headers: { authorization: 'alice' }, payload: { name: 'bad', image: 'not base64!!' } });
    expect(bad.json().code).toBe('emoji_image_invalid');
    const good = (await png()).toString('base64');
    const loose = await app.inject({ method: 'POST', url: '/api/emojis', headers: { authorization: 'alice' }, payload: { name: 'bad', image: `${good}\n` } });
    expect(loose.statusCode).toBe(400);
  });

  it('refuses an original larger than the limit', async () => {
    const huge = Buffer.alloc(CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES + 1, 1);
    const res = await add('huge', huge);
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('emoji_image_too_large');
  });

  it('refuses a picture that stays too heavy after shrinking', async () => {
    // Noise does not compress, so even the lowest quality is over the stored limit.
    const frames: Buffer[] = [];
    for (let i = 0; i < 40; i++) {
      const raw = randomBytes(128 * 128 * 3);
      frames.push(await sharp(raw, { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer());
    }
    const animation = await sharp(frames, { join: { animated: true } }).webp({ lossless: true, delay: new Array<number>(40).fill(40), loop: 0 }).toBuffer();
    expect(animation.length).toBeLessThan(CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES);
    const res = await add('noisy', animation);
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('emoji_image_too_large');
    expect(db.select().from(schema.customEmojis).all()).toEqual([]);
  }, 60_000);

  it('requires a signed-in account', async () => {
    expect((await add('wave', await png(), null)).statusCode).toBe(401);
  });

  it('limits each person, but not an administrator', async () => {
    for (let i = 0; i < CUSTOM_EMOJI_LIMITS.MAX_PER_USER; i++) {
      db.insert(schema.customEmojis).values({ id: `10000${i}`, name: `own_${i}`, animated: 0, size: 1, createdBy: 'alice', createdAt: 1 }).run();
    }
    const res = await add('one_more', await png());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'emoji_limit_reached', details: { max: CUSTOM_EMOJI_LIMITS.MAX_PER_USER } });
    // Somebody else is not held to alice's count.
    expect((await add('from_bob', await png(), 'bob')).statusCode).toBe(201);
    for (let i = 0; i < CUSTOM_EMOJI_LIMITS.MAX_PER_USER; i++) {
      db.insert(schema.customEmojis).values({ id: `20000${i}`, name: `adm_${i}`, animated: 0, size: 1, createdBy: 'admin', createdAt: 1 }).run();
    }
    expect((await add('admin_extra', await png(), 'admin')).statusCode).toBe(201);
  });

  it('stops at the limit for the whole instance', async () => {
    const rows = Array.from({ length: CUSTOM_EMOJI_LIMITS.MAX_TOTAL }, (_, i) => ({
      id: String(300000 + i), name: `e${i}_x`, animated: 0, size: 1, createdBy: null, createdAt: 1,
    }));
    for (let start = 0; start < rows.length; start += 100) db.insert(schema.customEmojis).values(rows.slice(start, start + 100)).run();
    const res = await add('late', await png(), 'admin');
    expect(res.statusCode).toBe(409);
    expect(res.json().details).toEqual({ max: CUSTOM_EMOJI_LIMITS.MAX_TOTAL });
  });

  it('allows a limited number of uploads a minute for each person', async () => {
    const image = await png(8, 8);
    for (let i = 0; i < CUSTOM_EMOJI_LIMITS.UPLOADS_PER_MINUTE; i++) {
      expect((await add(`rate_${i}`, image)).statusCode).toBe(201);
    }
    expect((await add('rate_over', image)).statusCode).toBe(429);
    expect((await add('rate_bob', image, 'bob')).statusCode).toBe(201);
  });
});

describe('reading the library', () => {
  it('lists every emoji by name, for anyone signed in', async () => {
    await add('zebra', await png());
    await add('apple', await png(), 'bob');
    const res = await app.inject({ method: 'GET', url: '/api/emojis', headers: { authorization: 'bob' } });
    expect(res.json().emojis.map((e: { name: string }) => e.name)).toEqual(['apple', 'zebra']);
    expect((await app.inject({ method: 'GET', url: '/api/emojis' })).statusCode).toBe(401);
  });

  it('serves the picture without a token, as an immutable sandboxed image', async () => {
    const { id } = (await add('wave', await png())).json();
    const res = await app.inject({ method: 'GET', url: `/api/emojis/${id}.webp` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect((await sharp(res.rawPayload).metadata()).format).toBe('webp');
  });

  it.each(['abc.webp', '12.webp', '../etc/passwd', '1234567.png', '1234567', '1234567.webp.x'])('does not serve %s', async (name) => {
    expect((await app.inject({ method: 'GET', url: `/api/emojis/${encodeURIComponent(name)}` })).statusCode).toBe(404);
  });

  it('says missing for an unknown id and for a row whose file is gone', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/emojis/99999999.webp' })).statusCode).toBe(404);
    const { id } = (await add('wave', await png())).json();
    await rm(file(id));
    const res = await app.inject({ method: 'GET', url: `/api/emojis/${id}.webp` });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('emoji_not_found');
  });
});

describe('renaming', () => {
  it('lets whoever added it rename it, and tells everyone', async () => {
    const { id } = (await add('wave', await png())).json();
    sent.length = 0;
    const res = await app.inject({ method: 'PATCH', url: `/api/emojis/${id}`, headers: { authorization: 'alice' }, payload: { name: 'Hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('hello');
    expect(sent).toEqual([{ type: 'emoji_upserted', emoji: res.json() }]);
  });

  it('lets an administrator rename anyone\'s, and nobody else', async () => {
    const { id } = (await add('wave', await png())).json();
    const patch = (who: string) => app.inject({ method: 'PATCH', url: `/api/emojis/${id}`, headers: { authorization: who }, payload: { name: 'renamed' } });
    expect((await patch('bob')).statusCode).toBe(403);
    expect((await patch('admin')).statusCode).toBe(200);
  });

  it('refuses a name that is taken or malformed, and keeps the old one', async () => {
    await add('first', await png());
    const { id } = (await add('second', await png())).json();
    const patch = (name: string) => app.inject({ method: 'PATCH', url: `/api/emojis/${id}`, headers: { authorization: 'alice' }, payload: { name } });
    expect((await patch('first')).json().code).toBe('emoji_name_taken');
    expect((await patch('x')).json().code).toBe('emoji_name_invalid');
    expect(db.select().from(schema.customEmojis).all().find((e) => e.id === id)!.name).toBe('second');
  });

  it('keeps its own name when renamed to itself', async () => {
    const { id } = (await add('same', await png())).json();
    const res = await app.inject({ method: 'PATCH', url: `/api/emojis/${id}`, headers: { authorization: 'alice' }, payload: { name: 'same' } });
    expect(res.statusCode).toBe(200);
  });

  it('answers 404 for an emoji that does not exist', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/emojis/99999999', headers: { authorization: 'alice' }, payload: { name: 'ok_name' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('emoji_not_found');
  });
});

describe('removing', () => {
  it('removes the row and the picture and tells everyone', async () => {
    const { id } = (await add('wave', await png())).json();
    sent.length = 0;
    const res = await app.inject({ method: 'DELETE', url: `/api/emojis/${id}`, headers: { authorization: 'alice' } });
    expect(res.statusCode).toBe(200);
    expect(db.select().from(schema.customEmojis).all()).toEqual([]);
    expect(await exists(file(id))).toBe(false);
    expect(sent).toEqual([{ type: 'emoji_removed', emojiId: id }]);
  });

  it('lets an administrator remove anyone\'s and refuses everybody else', async () => {
    const { id } = (await add('wave', await png())).json();
    const del = (who: string) => app.inject({ method: 'DELETE', url: `/api/emojis/${id}`, headers: { authorization: who } });
    expect((await del('bob')).statusCode).toBe(403);
    expect(await exists(file(id))).toBe(true);
    expect((await del('admin')).statusCode).toBe(200);
  });

  it('answers 404 for one that is gone', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/emojis/99999999', headers: { authorization: 'alice' } })).statusCode).toBe(404);
  });

  it('keeps the emoji when the person who added it is deleted, with nobody named as its author', async () => {
    const { id } = (await add('wave', await png())).json();
    sqlite.prepare('DELETE FROM users WHERE id = ?').run('alice');
    const row = db.select().from(schema.customEmojis).all().find((e) => e.id === id)!;
    expect(row.createdBy).toBeNull();
    // An administrator can still remove it.
    expect((await app.inject({ method: 'DELETE', url: `/api/emojis/${id}`, headers: { authorization: 'admin' } })).statusCode).toBe(200);
  });
});

describe('who may add', () => {
  beforeEach(() => {
    db.update(schema.instanceSettings).set({ emojiPolicy: 'admins' }).run();
  });

  it('refuses someone who is not an administrator where only administrators add, before reading the picture', async () => {
    const res = await add('wave', Buffer.from('not looked at'), 'alice');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('emoji_admins_only');
  });

  it('leaves an administrator to add, whatever the setting', async () => {
    const res = await add('wave', Buffer.from('not looked at'), 'admin');
    expect(res.statusCode).not.toBe(403);
  });

  it('treats a server with no settings row as administrators only', async () => {
    db.delete(schema.instanceSettings).run();
    expect((await add('wave', Buffer.from('not looked at'), 'alice')).statusCode).toBe(403);
  });
});
