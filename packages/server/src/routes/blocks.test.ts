import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(2);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'alice';
const sent: Array<[string, Record<string, unknown>]> = [];

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (userId: string, event: Record<string, unknown>) => { sent.push([userId, event]); },
    sendToDmMembers: vi.fn(),
    sendToAdmins: vi.fn(),
    getAllOnlineUserIds: () => [],
  },
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

function seedUser(id: string, extra: Partial<typeof schema.users.$inferInsert> = {}): void {
  testDb.insert(schema.users).values({
    id, username: id, displayName: id, passwordHash: 'x', createdAt: 1, ...extra,
  }).run();
}

function befriend(a: string, b: string): void {
  testDb.insert(schema.friends).values([
    { userId: a, friendId: b, createdAt: 1 },
    { userId: b, friendId: a, createdAt: 1 },
  ]).run();
}

const eventsTo = (userId: string, type: string) =>
  sent.filter(([to, event]) => to === userId && event.type === type).map(([, event]) => event);

beforeEach(async () => {
  sent.length = 0;
  currentUserId = 'alice';
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  seedUser('alice');
  seedUser('bob');
  seedUser('carol');
});

async function buildApp(): Promise<FastifyInstance> {
  const { blockRoutes } = await import('./blocks.js');
  const app = Fastify();
  await app.register(blockRoutes);
  return app;
}

describe('PUT /api/users/@me/blocks/:userId', () => {
  it('blocks someone and lists them', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.id).toBe('bob');
    expect(typeof res.json().blockedAt).toBe('number');

    const list = await app.inject({ method: 'GET', url: '/api/users/@me/blocks' });
    expect(list.json().blocks.map((b: { user: { id: string } }) => b.user.id)).toEqual(['bob']);
  });

  it('is idempotent: blocking twice answers 200 the second time and keeps one row', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    const again = await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    expect(again.statusCode).toBe(200);
    expect(testDb.select().from(schema.userBlocks).all()).toHaveLength(1);
  });

  it('refuses to block yourself, with a code', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/alice' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('cannot_block_self');
  });

  it('says user_not_found for nobody and for a deleted account', async () => {
    seedUser('gone', { isDeleted: 1 });
    const app = await buildApp();
    expect((await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/nobody' })).statusCode).toBe(404);
    const deleted = await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/gone' });
    expect(deleted.statusCode).toBe(404);
    expect(deleted.json().code).toBe('user_not_found');
  });

  it('ends a friendship, for both people, and tells both of their lists', async () => {
    befriend('alice', 'bob');
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    expect(testDb.select().from(schema.friends).all()).toEqual([]);
    expect(eventsTo('bob', 'friend_removed')).toEqual([{ type: 'friend_removed', userId: 'alice' }]);
    expect(eventsTo('alice', 'friend_removed')).toEqual([{ type: 'friend_removed', userId: 'bob' }]);
  });

  it('withdraws a request the blocker sent as cancelled, and one they received as declined', async () => {
    testDb.insert(schema.friendRequests).values([
      { id: 'sent', fromId: 'alice', toId: 'bob', status: 'pending', createdAt: 1 },
      { id: 'received', fromId: 'bob', toId: 'alice', status: 'pending', createdAt: 2 },
    ]).run();
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    expect(testDb.select().from(schema.friendRequests).all()).toEqual([]);
    expect(eventsTo('bob', 'friend_request_cancelled')).toEqual([{ type: 'friend_request_cancelled', requestId: 'sent', userId: 'alice' }]);
    expect(eventsTo('bob', 'friend_request_declined')).toEqual([{ type: 'friend_request_declined', requestId: 'received', userId: 'alice' }]);
  });

  it('never tells the blocked person they were blocked', async () => {
    befriend('alice', 'bob');
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    expect(eventsTo('bob', 'blocks_updated')).toEqual([]);
    expect(sent.every(([to, event]) => to !== 'bob' || ['friend_removed', 'friend_request_cancelled', 'friend_request_declined'].includes(String(event.type)))).toBe(true);
  });

  it("syncs the blocker's own sessions with the list", async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    expect(eventsTo('alice', 'blocks_updated')).toEqual([{ type: 'blocks_updated', blockedUserIds: ['bob'] }]);
  });

  it('leaves other people alone', async () => {
    befriend('alice', 'carol');
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    expect(testDb.select().from(schema.friends).all()).toHaveLength(2);
  });
});

describe('DELETE /api/users/@me/blocks/:userId', () => {
  it('lifts a block, and does not bring the friendship back', async () => {
    befriend('alice', 'bob');
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/bob' });
    sent.length = 0;

    const res = await app.inject({ method: 'DELETE', url: '/api/users/@me/blocks/bob' });
    expect(res.statusCode).toBe(200);
    expect(testDb.select().from(schema.userBlocks).all()).toEqual([]);
    expect(testDb.select().from(schema.friends).all()).toEqual([]);
    expect(eventsTo('alice', 'blocks_updated')).toEqual([{ type: 'blocks_updated', blockedUserIds: [] }]);
  });

  it('is idempotent and silent when there was no block', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/users/@me/blocks/bob' });
    expect(res.statusCode).toBe(200);
    expect(sent).toEqual([]);
  });

  it('only ever touches the caller\'s own blocks', async () => {
    const app = await buildApp();
    currentUserId = 'bob';
    await app.inject({ method: 'PUT', url: '/api/users/@me/blocks/carol' });
    currentUserId = 'alice';
    await app.inject({ method: 'DELETE', url: '/api/users/@me/blocks/carol' });
    expect(testDb.select().from(schema.userBlocks).all()).toHaveLength(1);
  });
});

describe('GET /api/users/@me/blocks', () => {
  it('lists only my blocks, newest first', async () => {
    const app = await buildApp();
    testDb.insert(schema.userBlocks).values([
      { blockerId: 'alice', blockedId: 'bob', createdAt: 100 },
      { blockerId: 'alice', blockedId: 'carol', createdAt: 200 },
      { blockerId: 'bob', blockedId: 'alice', createdAt: 300 },
    ]).run();
    const res = await app.inject({ method: 'GET', url: '/api/users/@me/blocks' });
    expect(res.json().blocks.map((b: { user: { id: string } }) => b.user.id)).toEqual(['carol', 'bob']);
  });

  it('is empty for someone who blocked nobody', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/users/@me/blocks' })).json()).toEqual({ blocks: [] });
  });
});
