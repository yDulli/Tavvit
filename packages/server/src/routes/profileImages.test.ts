import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import * as schema from '../db/schema.js';
import { MAX_PROFILE_IMAGE_SOURCE_BYTES, PROFILE_IMAGE_SPECS } from '@backspace/shared/src/profileImage.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(6);

const settings = vi.hoisted(() => ({ uploadDir: '' }));
let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, schema }));
vi.mock('../config.js', () => ({ config: settings }));
vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId: string; homeInstance: string | null; headers: Record<string, string> }, reply: { code: (code: number) => { send: () => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send();
    // "alice" is native; "erin" is signed in through a home instance elsewhere.
    request.userId = request.headers.authorization;
    request.homeInstance = request.headers.authorization === 'erin' ? 'https://elsewhere.test' : null;
  },
  requireLocalUser: async (request: { homeInstance: string | null }, reply: { code: (code: number) => { send: (body: unknown) => void } }) => {
    if (request.homeInstance) return reply.code(403).send({ code: 'forbidden' });
  },
}));
import { profileImageRoutes } from './profileImages.js';

beforeEach(async () => {
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'orbit-profile-images-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });
  for (const id of ['alice', 'erin']) {
    db.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  app = Fastify();
  await app.register(profileImageRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  await rm(settings.uploadDir, { recursive: true, force: true });
});

async function gif(frames = 3): Promise<Buffer> {
  const pngs: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    pngs.push(await sharp({ create: { width: 90, height: 90, channels: 3, background: { r: i * 80, g: 40, b: 200 } } }).png().toBuffer());
  }
  return sharp(pngs, { join: { animated: true } }).gif({ delay: new Array<number>(frames).fill(80), loop: 0 }).toBuffer();
}

const crop = { x: 0, y: 0, width: 90, height: 90 };

function post(payload: unknown, who: string | null = 'alice') {
  return app.inject({
    method: 'POST',
    url: '/api/users/@me/profile-image',
    headers: who ? { authorization: who } : {},
    payload: payload as Record<string, unknown>,
  });
}

describe('POST /api/users/@me/profile-image', () => {
  it('stores an animated avatar and answers with the file to name in the profile update', async () => {
    const res = await post({ kind: 'avatar', image: (await gif()).toString('base64'), crop });
    expect(res.statusCode).toBe(201);
    const { filename } = res.json();
    // A name nobody can count through, as every upload has (utils/uploadNames.ts).
    expect(filename).toMatch(/^\d+-[0-9a-f]{32}\.webp$/);

    const stored = await readFile(path.join(settings.uploadDir, filename));
    const meta = await sharp(stored, { animated: true }).metadata();
    expect([meta.width, meta.pageHeight, meta.pages]).toEqual([PROFILE_IMAGE_SPECS.avatar.width, PROFILE_IMAGE_SPECS.avatar.height, 3]);
  });

  it('records the upload the way a tus upload is recorded, so the profile update cleans it up', async () => {
    const { filename } = (await post({ kind: 'avatar', image: (await gif()).toString('base64'), crop })).json();
    const row = db.select().from(schema.attachments).all().find((r) => r.filename === filename)!;
    expect(row).toMatchObject({
      uploaderId: 'alice', messageId: null, dmMessageId: null, mimetype: 'image/webp', originalName: 'avatar.webp',
      width: PROFILE_IMAGE_SPECS.avatar.width, height: PROFILE_IMAGE_SPECS.avatar.height,
    });
    expect(row.size).toBeGreaterThan(0);
  });

  it('makes a banner at the banner size', async () => {
    const res = await post({ kind: 'banner', image: (await gif()).toString('base64'), crop: { x: 0, y: 0, width: 90, height: 30 } });
    expect(res.statusCode).toBe(201);
    const stored = await readFile(path.join(settings.uploadDir, res.json().filename));
    const meta = await sharp(stored, { animated: true }).metadata();
    expect([meta.width, meta.pageHeight]).toEqual([PROFILE_IMAGE_SPECS.banner.width, PROFILE_IMAGE_SPECS.banner.height]);
  });

  it('requires a signed-in account', async () => {
    const res = await post({ kind: 'avatar', image: (await gif()).toString('base64'), crop }, null);
    expect(res.statusCode).toBe(401);
    expect(await readdir(settings.uploadDir)).toEqual([]);
  });

  it('is not offered to an account whose profile its home instance manages', async () => {
    const res = await post({ kind: 'avatar', image: (await gif()).toString('base64'), crop }, 'erin');
    expect(res.statusCode).toBe(403);
    expect(await readdir(settings.uploadDir)).toEqual([]);
  });

  it.each([
    ['an unknown kind', (image: string) => ({ kind: 'icon', image, crop })],
    ['a missing crop', (image: string) => ({ kind: 'avatar', image })],
  ])('refuses %s without writing anything', async (_label, body) => {
    const res = await post(body((await gif()).toString('base64')));
    expect(res.statusCode).toBe(400);
    expect(await readdir(settings.uploadDir)).toEqual([]);
    expect(db.select().from(schema.attachments).all()).toEqual([]);
  });

  it('refuses text that is not base64, and base64 that is not canonical', async () => {
    expect((await post({ kind: 'avatar', image: 'not base64!!', crop })).json().code).toBe('profile_image_invalid');
    const good = (await gif()).toString('base64');
    expect((await post({ kind: 'avatar', image: `${good}\n`, crop })).statusCode).toBe(400);
  });

  it('refuses a file that is not an animation, with a code', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'red' } }).png().toBuffer();
    const res = await post({ kind: 'avatar', image: png.toString('base64'), crop: { x: 0, y: 0, width: 40, height: 40 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('profile_image_invalid');
    expect(await readdir(settings.uploadDir)).toEqual([]);
  });

  it('refuses a crop that is not inside the image', async () => {
    const res = await post({ kind: 'avatar', image: (await gif()).toString('base64'), crop: { x: 80, y: 80, width: 90, height: 90 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('profile_image_invalid');
  });

  it('refuses an original larger than the limit, before decoding it', async () => {
    const big = Buffer.alloc(MAX_PROFILE_IMAGE_SOURCE_BYTES + 1, 1).toString('base64');
    const res = await post({ kind: 'avatar', image: big, crop });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('profile_image_too_large');
  });
});
