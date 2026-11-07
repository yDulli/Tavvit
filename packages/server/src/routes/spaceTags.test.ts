import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { PermissionBits } from '../utils/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';

// Space tags (docs/systems/space-tags.md) through the real routes and a real database: the space
// sets one, members wear it, it follows the space's changes and goes when they leave.

setWorkerId(7);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let currentUserId = 'owner';
const sent = vi.hoisted(() => [] as Array<{ to: string; event: { type: string; user?: { spaceTag?: unknown } } }>);

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; } }));
vi.mock('../ws/handler.js', () => {
  // Every method the routes reach is a stand-in; what goes to a person is kept to look at.
  const methods = new Map<string | symbol, unknown>();
  const sendToUser = (to: string, event: { type: string; user?: { spaceTag?: unknown } }) => { sent.push({ to, event }); };
  return {
    connectionManager: new Proxy({}, {
      get: (_target, key) => {
        if (key === 'sendToUser') return sendToUser;
        if (key === 'getAllOnlineUserIds') return () => [];
        if (!methods.has(key)) methods.set(key, vi.fn());
        return methods.get(key);
      },
    }),
  };
});
vi.mock('../utils/federationOutbox.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationOutbox.js')>('../utils/federationOutbox.js');
  return { ...actual, isFederationRelayEnabled: () => false, appendMutationLog: vi.fn(), queueOutboxEvent: vi.fn() };
});

beforeEach(async () => {
  sent.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of fs.readdirSync(path.resolve(__dirname, '../../drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.resolve(__dirname, '../../drizzle', file), 'utf8'));
  }
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  for (const id of ['owner', 'member', 'outsider']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', homeUserId: id, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: '100', name: 'Night Shift', ownerId: 'owner', visibility: 'public', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: '200', name: 'Quiet', ownerId: 'owner', createdAt: 1 }).run();
  for (const userId of ['owner', 'member']) testDb.insert(schema.spaceMembers).values({ spaceId: '100', userId, joinedAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: '200', userId: 'owner', joinedAt: 1 }).run();
  app = Fastify({ logger: false });
  await app.register((await import('./spaces.js')).spaceRoutes);
  await app.register((await import('./users.js')).userRoutes);
  await app.register((await import('./explore.js')).exploreRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const setTag = (tag: unknown, space = '100') => app.inject({ method: 'PATCH', url: `/api/spaces/${space}`, payload: { tag } });
const wear = (spaceTag: unknown) => app.inject({ method: 'PATCH', url: '/api/users/@me', payload: { spaceTag } });
const wornBy = (id: string) => testDb.select({ spaceTag: schema.users.spaceTag }).from(schema.users).where(eq(schema.users.id, id)).get()?.spaceTag ?? null;
const NSFT = { text: 'NSFT', glyph: 'moon', color: 'lavender' };

describe('a space sets its tag', () => {
  it('stores and sends it with the space', async () => {
    const res = await setTag(NSFT);
    expect(res.statusCode).toBe(200);
    expect(res.json().tag).toEqual(NSFT);
  });

  it('refuses what breaks the rules, and a word reserved for the platform', async () => {
    expect((await setTag({ ...NSFT, text: 'NIGHTS' })).json()).toMatchObject({ code: 'space_tag_invalid', details: { min: 2, max: 4, reason: 'length' } });
    expect((await setTag({ ...NSFT, glyph: 'unicorn' })).json()).toMatchObject({ code: 'space_tag_invalid', details: { reason: 'glyph' } });
    expect((await setTag({ ...NSFT, text: 'Mod' })).json().code).toBe('space_tag_reserved');
  });

  it('needs MANAGE_SPACE', async () => {
    currentUserId = 'member';
    const res = await setTag(NSFT);
    expect(res.statusCode).toBe(403);
    testDb.insert(schema.roles).values({ id: 'r1', spaceId: '100', name: 'Manager', permissions: PermissionBits.MANAGE_SPACE.toString(), position: 1, createdAt: 1 }).run();
    testDb.insert(schema.memberRoles).values({ spaceId: '100', userId: 'member', roleId: 'r1' }).run();
    expect((await setTag(NSFT)).statusCode).toBe(200);
  });
});

describe('a member wears it', () => {
  it('only a member, and only a tag the space has', async () => {
    currentUserId = 'member';
    expect((await wear('100')).json().code).toBe('space_tag_unavailable');
    currentUserId = 'owner';
    await setTag(NSFT);
    currentUserId = 'outsider';
    expect((await wear('100')).json().code).toBe('space_tag_unavailable');
    currentUserId = 'member';
    const res = await wear('100');
    expect(res.statusCode).toBe(200);
    expect(res.json().spaceTag).toEqual({ ...NSFT, spaceId: '100' });
    expect(sent.some((entry) => entry.event.type === 'user_updated' && entry.to === 'member')).toBe(true);
    expect((await wear(null)).json().spaceTag).toBeNull();
  });

  it('follows the space changing its tag, and taking it away', async () => {
    await setTag(NSFT);
    currentUserId = 'member';
    await wear('100');
    sent.length = 0;
    currentUserId = 'owner';
    await setTag({ text: 'NS', glyph: 'star', color: 'amber' });
    expect(JSON.parse(wornBy('member')!)).toEqual({ spaceId: '100', text: 'NS', glyph: 'star', color: 'amber' });
    expect(sent.find((entry) => entry.to === 'member')?.event.user?.spaceTag).toMatchObject({ text: 'NS' });
    await setTag(null);
    expect(wornBy('member')).toBeNull();
  });

  it('goes when the member leaves', async () => {
    await setTag(NSFT);
    currentUserId = 'member';
    await wear('100');
    const { releaseSpaceTag } = await import('../utils/spaceTags.js');
    testDb.delete(schema.spaceMembers).where(eq(schema.spaceMembers.userId, 'member')).run();
    expect(releaseSpaceTag('member', '200')).toBe(false);
    expect(releaseSpaceTag('member', '100')).toBe(true);
    expect(wornBy('member')).toBeNull();
  });
});

describe('a click on a tag', () => {
  it('shows the space and its tag, and nothing for a space without one', async () => {
    currentUserId = 'outsider';
    expect((await app.inject({ method: 'GET', url: '/api/spaces/100/tag' })).statusCode).toBe(404);
    currentUserId = 'owner';
    await setTag(NSFT);
    currentUserId = 'outsider';
    const res = await app.inject({ method: 'GET', url: '/api/spaces/100/tag' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tag: NSFT, space: { id: '100', name: 'Night Shift', memberCount: 2, joined: false, visibility: 'public' } });
  });
});
