import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { CUSTOM_DECORATION_LIMITS, PICTURE_PATH } from '@backspace/shared/src/customDecorations.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

// Decorations people make (docs/systems/decorations.md, "Made by people") through the real routes,
// a real database and real pictures: making one, the gallery, wearing one, taking one away, the
// pictures, a report about one and an account that goes.

setWorkerId(7);

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
const settings = vi.hoisted(() => ({ uploadDir: '' }));

vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));

// The real settings, with pictures kept in a directory of each test's own.
vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, key, receiver) => (key === 'uploadDir' ? settings.uploadDir : Reflect.get(target, key, receiver)),
    }),
  };
});

vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId?: string; headers: Record<string, string | undefined> }, reply: { code: (code: number) => { send: () => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send();
    request.userId = request.headers.authorization;
  },
  requireAdmin: async (request: { userId: string }, reply: { code: (code: number) => { send: (body: unknown) => void } }) => {
    const caller = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (caller?.isAdmin !== 1) return reply.code(403).send({ code: 'forbidden' });
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToDmMembers: vi.fn(),
    sendToAdmins: vi.fn(),
    sendToChannel: vi.fn(),
    getAllOnlineUserIds: () => [],
    getRoom: () => undefined,
    getUserRoom: () => undefined,
    leaveCurrentRoom: vi.fn(() => false),
    destroyRoom: vi.fn(),
    clearVoiceUserStatus: vi.fn(),
    forceDisconnectUser: vi.fn(),
  },
}));

vi.mock('../utils/federationOutbox.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationOutbox.js')>('../utils/federationOutbox.js');
  return { ...actual, isFederationRelayEnabled: () => false, appendMutationLog: vi.fn(), queueOutboxEvent: vi.fn() };
});

import { customDecorationRoutes, _resetDecorationLimits } from './customDecorations.js';
import { _resetCustomDecorationCache, decorationFilePath } from '../utils/customDecorations.js';
import { connectionManager } from '../ws/handler.js';

/** The profile everyone who sees `userId` was last sent. */
function lastProfileSentTo(userId: string): Record<string, unknown> | undefined {
  const calls = vi.mocked(connectionManager.sendToUser).mock.calls
    .filter(([to, event]) => to === userId && (event as { type: string }).type === 'user_updated');
  return (calls.at(-1)?.[1] as { user?: Record<string, unknown> } | undefined)?.user;
}

beforeEach(async () => {
  vi.mocked(connectionManager.sendToUser).mockClear();
  _resetDecorationLimits();
  _resetCustomDecorationCache();
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'tavvit-decorations-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });
  for (const id of ['alice', 'bob', 'carol']) {
    db.insert(schema.users).values({ id, username: id, displayName: id, passwordHash: 'x', homeUserId: id, createdAt: 1, isAdmin: id === 'carol' ? 1 : 0 }).run();
  }
  app = Fastify({ logger: false });
  await app.register(customDecorationRoutes);
  const { userRoutes } = await import('./users.js');
  await app.register(userRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  await rm(settings.uploadDir, { recursive: true, force: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const as = (user: string) => ({ authorization: user });
const make = (user: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/decorations', headers: as(user), payload });
const wear = (user: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/api/users/@me', headers: as(user), payload });
const gallery = (user: string, query: string) => app.inject({ url: `/api/decorations?${query}`, headers: as(user) });
const userRow = (id: string) => db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
const designRow = (id: string) => db.select().from(schema.customDecorations).where(eq(schema.customDecorations.id, id)).get();

function picture(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 224, g: 70, b: 94, alpha: 0.9 } } }).png().toBuffer();
}

async function movingPicture(): Promise<Buffer> {
  const frames = await Promise.all(['#e0465e', '#5cc491', '#60a5e6'].map((color) => sharp({ create: { width: 96, height: 96, channels: 4, background: color } }).png().toBuffer()));
  return sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: [100, 100, 100] }).toBuffer();
}

const b64 = (bytes: Buffer) => bytes.toString('base64');

/** A design written straight into the database, for what reads many of them. */
function insertDesign(values: { id: string; creatorId: string } & Partial<typeof schema.customDecorations.$inferInsert>): void {
  db.insert(schema.customDecorations).values({
    kind: 'frame', name: `Design ${values.id}`, animated: 0, size: 100, width: 512, height: 512, style: null, shared: 1, createdAt: 1, updatedAt: 1,
    ...values,
  }).run();
}

// ─── Making one ───────────────────────────────────────────────────────────────

describe('making a design', () => {
  it('stores a frame as a square WebP served at a path, private until shared, and counts it in its maker\'s storage', async () => {
    const res = await make('alice', { kind: 'frame', name: '  Ruby   ring ', image: b64(await picture(300, 200)) });
    expect(res.statusCode).toBe(201);
    const design = res.json();
    expect(design).toMatchObject({ kind: 'frame', name: 'Ruby ring', still: null, style: null, motion: null, shared: false, mine: true, wearers: 0 });
    expect(design.creator).toMatchObject({ id: 'alice', username: 'alice' });
    expect(design.image).toMatch(PICTURE_PATH);
    const file = decorationFilePath(design.id, false);
    expect(existsSync(file)).toBe(true);
    const stored = await sharp(file).metadata();
    expect(stored.format).toBe('webp');
    expect(stored.width).toBe(stored.height);
    const row = designRow(design.id)!;
    expect(row.size).toBeGreaterThan(0);
    const { storageUsage } = await import('../utils/accountLimits.js');
    expect(storageUsage('alice').usedBytes).toBe(row.size);
  });

  it('keeps an effect\'s piece small, with the first frame of a moving one and the motion it moves in', async () => {
    const res = await make('alice', { kind: 'effect', name: 'Sparks', image: b64(await movingPicture()), motion: 'twinkle', shared: true });
    expect(res.statusCode).toBe(201);
    const design = res.json();
    expect(design).toMatchObject({ kind: 'effect', motion: 'twinkle', shared: true, style: null });
    expect(design.still).toMatch(PICTURE_PATH);
    expect(design.still).toContain('-still.webp');
    expect(designRow(design.id)?.style).toBe('{"motion":"twinkle"}');
    expect(existsSync(decorationFilePath(design.id, true))).toBe(true);
    const large = await make('alice', { kind: 'effect', name: 'Big', image: b64(await picture(900, 600)), motion: 'fall' });
    const stored = await sharp(decorationFilePath(large.json().id, false)).metadata();
    expect(Math.max(stored.width ?? 0, stored.height ?? 0)).toBeLessThanOrEqual(256);
  });

  it('refuses an effect without a motion it knows, before the picture is read', async () => {
    const image = b64(await picture(64, 64));
    const missing = await make('alice', { kind: 'effect', name: 'Still', image });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: 'decoration_style_invalid' });
    expect((await make('alice', { kind: 'effect', name: 'Spin', image, motion: 'spin' })).statusCode).toBe(400);
    expect(db.select().from(schema.customDecorations).all()).toHaveLength(0);
  });

  it('stores a name style with its colours in lower case, and refuses one that breaks its look\'s rules', async () => {
    const made = await make('alice', { kind: 'name', name: 'Arcade', style: { look: 'retro', colors: ['#AA0000', '#00bb00', '#0000CC'] }, shared: true });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ image: null, still: null, motion: null, style: { look: 'retro', colors: ['#aa0000', '#00bb00', '#0000cc'] } });
    for (const style of [{ look: 'retro', colors: ['#aa0000', '#00bb00'] }, { look: 'sticker', colors: ['red'] }, { look: 'neon', colors: ['#ffffff'] }, undefined]) {
      const res = await make('alice', { kind: 'name', name: 'Bad', ...(style ? { style } : {}) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'decoration_style_invalid' });
    }
  });

  it('refuses a picture that is not PNG, WebP or GIF, base64 that is not canonical, and a picture kind without one', async () => {
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).jpeg().toBuffer();
    for (const image of [b64(jpeg), b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'))]) {
      const res = await make('alice', { kind: 'frame', name: 'Bad', image });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'decoration_image_invalid', details: { max: CUSTOM_DECORATION_LIMITS.MAX_BYTES / (1024 * 1024) } });
    }
    expect((await make('alice', { kind: 'frame', name: 'Bad', image: '!!!!' })).json()).toMatchObject({ code: 'validation_failed' });
    expect((await make('alice', { kind: 'nameplate', name: 'Nothing' })).json()).toMatchObject({ code: 'decoration_image_invalid' });
  });

  it('refuses a name that is empty, too long or hides what it says', async () => {
    const image = b64(await picture(32, 32));
    for (const name of ['   ', 'x'.repeat(CUSTOM_DECORATION_LIMITS.NAME_MAX + 1), 'evil‮txt.exe', 'zero​width']) {
      const res = await make('alice', { kind: 'frame', name, image });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'decoration_name_invalid' });
    }
  });

  it('stops an account at its limit of designs, and not an administrator', async () => {
    for (let index = 0; index < CUSTOM_DECORATION_LIMITS.PER_ACCOUNT; index += 1) {
      insertDesign({ id: String(1000 + index), creatorId: 'alice' });
      insertDesign({ id: String(2000 + index), creatorId: 'carol' });
    }
    const style = { look: 'sticker', colors: ['#ffffff'] };
    const refused = await make('alice', { kind: 'name', name: 'One more', style });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'decoration_limit_reached', details: { max: CUSTOM_DECORATION_LIMITS.PER_ACCOUNT } });
    expect((await make('carol', { kind: 'name', name: 'One more', style })).statusCode).toBe(201);
  });

  it('asks who is making it', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/decorations', payload: { kind: 'name', name: 'x', style: { look: 'sticker', colors: ['#ffffff'] } } });
    expect(res.statusCode).toBe(401);
  });
});

// ─── The gallery and one's own ────────────────────────────────────────────────

describe('the gallery', () => {
  beforeEach(() => {
    insertDesign({ id: '11', creatorId: 'bob', name: 'Ruby ring', createdAt: 1 });
    insertDesign({ id: '12', creatorId: 'bob', name: 'Mint dashes', createdAt: 2 });
    insertDesign({ id: '13', creatorId: 'bob', name: 'Secret', shared: 0, createdAt: 3 });
    insertDesign({ id: '14', creatorId: 'bob', kind: 'effect', name: 'Ruby rain', style: '{"motion":"fall"}', createdAt: 4 });
  });

  it('lists the shared designs of one kind, the most worn first and the newest among equals', async () => {
    expect((await wear('carol', { avatarFrame: 'custom:11' })).statusCode).toBe(200);
    const popular = (await gallery('alice', 'kind=frame&sort=popular')).json();
    expect(popular.total).toBe(2);
    expect(popular.items.map((item: { id: string }) => item.id)).toEqual(['11', '12']);
    expect(popular.items[0]).toMatchObject({ wearers: 1, mine: false, creator: { username: 'bob' } });
    const newest = (await gallery('alice', 'kind=frame&sort=new')).json();
    expect(newest.items.map((item: { id: string }) => item.id)).toEqual(['12', '11']);
    const effects = (await gallery('alice', 'kind=effect')).json();
    expect(effects.items).toEqual([expect.objectContaining({ id: '14', motion: 'fall' })]);
  });

  it('finds designs by part of their name, whatever its case', async () => {
    const found = (await gallery('alice', 'kind=frame&q=RUBY')).json();
    expect(found.items.map((item: { id: string }) => item.id)).toEqual(['11']);
  });

  it('pages through what it holds', async () => {
    for (let index = 0; index < 30; index += 1) insertDesign({ id: String(500 + index), creatorId: 'alice', kind: 'nameplate', createdAt: 10 + index });
    const first = (await gallery('bob', 'kind=nameplate&sort=new')).json();
    expect(first.total).toBe(30);
    expect(first.items).toHaveLength(CUSTOM_DECORATION_LIMITS.PAGE_SIZE);
    const second = (await gallery('bob', `kind=nameplate&sort=new&offset=${CUSTOM_DECORATION_LIMITS.PAGE_SIZE}`)).json();
    expect(second.items).toHaveLength(30 - CUSTOM_DECORATION_LIMITS.PAGE_SIZE);
  });

  it('shows its maker everything they made, shared or not, the newest first', async () => {
    const mine = (await app.inject({ url: '/api/decorations/mine', headers: as('bob') })).json();
    expect(mine.max).toBe(CUSTOM_DECORATION_LIMITS.PER_ACCOUNT);
    expect(mine.items.map((item: { id: string }) => item.id)).toEqual(['14', '13', '12', '11']);
    expect(mine.items.every((item: { mine: boolean }) => item.mine)).toBe(true);
  });
});

// ─── Wearing one ──────────────────────────────────────────────────────────────

describe('wearing a design', () => {
  beforeEach(() => {
    insertDesign({ id: '21', creatorId: 'bob', name: 'Shared frame' });
    insertDesign({ id: '22', creatorId: 'bob', name: 'Private frame', shared: 0 });
    insertDesign({ id: '23', creatorId: 'bob', kind: 'name', name: 'Wave', style: '{"look":"wave","colors":["#5cc491","#60a5e6"]}' });
  });

  it('lets anyone wear a shared design and shows what a client needs to draw it', async () => {
    const res = await wear('alice', { avatarFrame: 'custom:21', nameEffect: 'custom:23' });
    expect(res.statusCode).toBe(200);
    const user = res.json();
    expect(user.avatarFrame).toBeNull();
    expect(user.customDecorations).toMatchObject({
      avatarFrame: { id: '21', kind: 'frame', name: 'Shared frame', image: '/api/decorations/21.webp' },
      nameEffect: { id: '23', kind: 'name', image: null, style: { look: 'wave', colors: ['#5cc491', '#60a5e6'] } },
    });
    expect(userRow('alice')).toMatchObject({ avatarFrame: 'custom:21', nameEffect: 'custom:23' });
  });

  it('lets only its maker wear a private design', async () => {
    const refused = await wear('alice', { avatarFrame: 'custom:22' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: 'profile_decoration_invalid' });
    expect((await wear('bob', { avatarFrame: 'custom:22' })).statusCode).toBe(200);
  });

  it('wears a design only in the field of its kind, and never one that is not there', async () => {
    expect((await wear('alice', { profileEffect: 'custom:21' })).statusCode).toBe(400);
    expect((await wear('alice', { avatarFrame: 'custom:999' })).statusCode).toBe(400);
    expect(userRow('alice')).toMatchObject({ avatarFrame: null, profileEffect: null });
  });

  it('counts a new wearer in the gallery at once', async () => {
    expect((await gallery('carol', 'kind=frame')).json().items[0]).toMatchObject({ id: '21', wearers: 0 });
    await wear('alice', { avatarFrame: 'custom:21' });
    expect((await gallery('carol', 'kind=frame')).json().items[0]).toMatchObject({ id: '21', wearers: 1 });
  });
});

// ─── Changing and taking one away ─────────────────────────────────────────────

describe('changing and removing a design', () => {
  it('lets only its maker rename it or share it', async () => {
    insertDesign({ id: '31', creatorId: 'bob', shared: 0 });
    expect((await app.inject({ method: 'PATCH', url: '/api/decorations/31', headers: as('alice'), payload: { shared: true } })).statusCode).toBe(404);
    const changed = await app.inject({ method: 'PATCH', url: '/api/decorations/31', headers: as('bob'), payload: { name: 'Gold leaf', shared: true } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ name: 'Gold leaf', shared: true });
    expect((await app.inject({ method: 'PATCH', url: '/api/decorations/31', headers: as('bob'), payload: { name: '' } })).json()).toMatchObject({ code: 'decoration_name_invalid' });
  });

  it('deletes a design for its maker, with its pictures, and takes it off everyone who wore it', async () => {
    const design = (await make('bob', { kind: 'effect', name: 'Hearts', image: b64(await movingPicture()), motion: 'rise', shared: true })).json();
    await wear('alice', { profileEffect: `custom:${design.id}` });
    expect((await app.inject({ method: 'DELETE', url: `/api/decorations/${design.id}`, headers: as('alice') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/decorations/${design.id}`, headers: as('bob') })).statusCode).toBe(200);
    expect(designRow(design.id)).toBeUndefined();
    expect(userRow('alice').profileEffect).toBeNull();
    expect(lastProfileSentTo('alice')).toMatchObject({ profileEffect: null, customDecorations: null });
    expect(existsSync(decorationFilePath(design.id, false))).toBe(false);
    expect(existsSync(decorationFilePath(design.id, true))).toBe(false);
    expect((await app.inject({ url: `/api/decorations/${design.id}.webp` })).statusCode).toBe(404);
  });

  it('takes a design off others while its maker keeps it out of the gallery, and gives it back when shared again', async () => {
    insertDesign({ id: '61', creatorId: 'bob', name: 'Moon' });
    await wear('alice', { avatarFrame: 'custom:61' });
    await wear('bob', { avatarFrame: 'custom:61' });
    const share = (shared: boolean) => app.inject({ method: 'PATCH', url: '/api/decorations/61', headers: as('bob'), payload: { shared } });
    const { publicUserOf } = await import('../utils/sanitize.js');

    vi.mocked(connectionManager.sendToUser).mockClear();
    expect((await share(false)).statusCode).toBe(200);
    expect(lastProfileSentTo('alice')).toMatchObject({ customDecorations: null });
    expect(publicUserOf(userRow('bob')).customDecorations).toMatchObject({ avatarFrame: { id: '61' } });
    expect(lastProfileSentTo('bob')).toBeUndefined();

    expect((await share(true)).statusCode).toBe(200);
    expect(lastProfileSentTo('alice')).toMatchObject({ customDecorations: { avatarFrame: { id: '61' } } });
  });

  it('lets an administrator take one away, telling its maker why and writing it in the audit log', async () => {
    insertDesign({ id: '41', creatorId: 'bob', name: 'Bad symbol' });
    await wear('alice', { avatarFrame: 'custom:41' });
    const remove = (user: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/admin/decorations/41/remove', headers: as(user), payload });
    expect((await remove('alice', { reason: 'Not allowed here.', ground: 'terms' })).statusCode).toBe(403);
    expect((await remove('carol', { reason: 'no', ground: 'terms' })).json()).toMatchObject({ code: 'decoration_reason_invalid' });
    expect((await remove('carol', { reason: 'Not allowed here.', ground: 'mood' })).json()).toMatchObject({ code: 'report_ground_required' });
    expect((await remove('carol', { reason: 'Not allowed here.', ground: 'terms' })).statusCode).toBe(200);
    expect(designRow('41')).toBeUndefined();
    expect(userRow('alice').avatarFrame).toBeNull();
    expect(lastProfileSentTo('alice')).toMatchObject({ avatarFrame: null, customDecorations: null });
    expect(db.select().from(schema.userNotices).where(eq(schema.userNotices.userId, 'bob')).all())
      .toEqual([expect.objectContaining({ kind: 'content_removed', ground: 'terms', note: 'Not allowed here.', subject: 'Bad symbol' })]);
    expect(db.select().from(schema.platformAuditLog).all())
      .toEqual([expect.objectContaining({ actorId: 'carol', action: 'decoration_remove', targetId: 'bob', targetLabel: 'Bad symbol' })]);
    expect((await remove('carol', { reason: 'Not allowed here.', ground: 'terms' })).statusCode).toBe(404);
  });
});

// ─── The pictures ─────────────────────────────────────────────────────────────

describe('serving pictures', () => {
  it('serves a picture, and the first frame of a moving one, as WebP that never changes and never runs', async () => {
    const still = (await make('alice', { kind: 'frame', name: 'Still', image: b64(await picture(64, 64)) })).json();
    const moving = (await make('alice', { kind: 'effect', name: 'Moving', image: b64(await movingPicture()), motion: 'float' })).json();
    const served = await app.inject({ url: still.image });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
    expect((await app.inject({ url: moving.still })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/decorations/${still.id}-still.webp` })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/decorations/123.webp' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/decorations/..%2F..%2Fsecret.webp' })).statusCode).toBe(404);
  });

  it('sweeps away the files no design names, leaving young ones to the next hour', async () => {
    const kept = (await make('alice', { kind: 'frame', name: 'Kept', image: b64(await picture(64, 64)) })).json();
    const moving = (await make('alice', { kind: 'effect', name: 'Moving', image: b64(await movingPicture()), motion: 'rise' })).json();
    const dir = path.dirname(decorationFilePath(kept.id, false));
    const strays = ['999.webp', `${kept.id}-still.webp`, `${kept.id}.webp.1234.tmp`, 'notes.txt'];
    for (const name of strays) await writeFile(path.join(dir, name), 'x');
    const { removeUnusedDecorationFiles } = await import('../utils/customDecorations.js');
    expect(removeUnusedDecorationFiles(60 * 60 * 1000)).toBe(0);
    expect(removeUnusedDecorationFiles()).toBe(strays.length);
    expect((await readdir(dir)).sort()).toEqual([`${kept.id}.webp`, `${moving.id}-still.webp`, `${moving.id}.webp`].sort());
  });

  it('answers a missing picture file as missing, not as a fault', async () => {
    const design = (await make('alice', { kind: 'frame', name: 'Lost', image: b64(await picture(64, 64)) })).json();
    await rm(decorationFilePath(design.id, false));
    expect((await app.inject({ url: design.image })).statusCode).toBe(404);
  });
});

// ─── Reports and accounts that go ─────────────────────────────────────────────

describe('reports and deleted accounts', () => {
  const report = { category: 'hate', explanation: 'This frame shows a symbol that is not allowed on this server at all.', targetType: 'decoration', goodFaith: true };

  it('takes a report about a design anyone can see, keeping its name, maker and picture', async () => {
    insertDesign({ id: '51', creatorId: 'bob', name: 'Odd symbol' });
    const { createReport } = await import('../utils/reports.js');
    const created = createReport({ ...report, targetId: '51' }, 'alice');
    expect('id' in created).toBe(true);
    const row = db.select().from(schema.contentReports).all()[0]!;
    expect(JSON.parse(row.snapshot!)).toMatchObject({ authorId: 'bob', authorName: 'bob', content: 'Odd symbol', attachments: ['/api/decorations/51.webp'], place: 'frame' });
  });

  it('does not take a report about a private design nobody else can see', async () => {
    insertDesign({ id: '52', creatorId: 'bob', shared: 0 });
    const { createReport } = await import('../utils/reports.js');
    expect(createReport({ ...report, targetId: '52' }, 'alice')).toMatchObject({ refusal: { status: 404, code: 'report_target_not_found' } });
    await wear('bob', { avatarFrame: 'custom:52' });
    expect('id' in createReport({ ...report, targetId: '52' }, 'alice')).toBe(true);
  });

  it('removes the designs of an account that is deleted, from everyone who wore them', async () => {
    const design = (await make('bob', { kind: 'frame', name: 'Leaving', image: b64(await picture(64, 64)), shared: true })).json();
    await wear('alice', { avatarFrame: `custom:${design.id}` });
    const { tombstoneUser } = await import('../utils/userDeletion.js');
    tombstoneUser('bob', { purgeContent: false });
    expect(designRow(design.id)).toBeUndefined();
    expect(userRow('alice').avatarFrame).toBeNull();
    await vi.waitFor(() => expect(existsSync(decorationFilePath(design.id, false))).toBe(false));
  });
});
