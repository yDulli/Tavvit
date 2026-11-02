import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { signJwt } from '../utils/auth.js';
import { storedReplicatedInstances, MAX_REPLICATED_INSTANCES } from '../utils/replicatedInstances.js';

// The other instances an account names: kept as a name and an origin, bounded, and shown to
// nobody but the account itself.

setWorkerId(28);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, '../../drizzle');
const CLEANUP = '0070_tavvit_replicated_instances_bound.sql';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
const sent: Array<[string, Record<string, unknown>]> = [];

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (userId: string, event: Record<string, unknown>) => { sent.push([userId, event]); },
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    setUserShowActivity: vi.fn(),
    clearUserActivities: vi.fn(),
    getUserStatus: vi.fn(() => 'online'),
    forceDisconnectUser: vi.fn(),
  },
}));

function runMigration(db: Database.Database, file: string): void {
  for (const stmt of fs.readFileSync(path.join(MIGRATIONS, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
    const clean = stmt.trim();
    if (clean) db.exec(clean);
  }
}

function applyMigrations(db: Database.Database, until?: string): void {
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    if (until !== undefined && f >= until) break;
    runMigration(db, f);
  }
}

const ME = 'me-1';
const FRIEND = 'friend-1';
const auth = () => ({ Authorization: `Bearer ${signJwt({ userId: ME, username: 'me' })}` });
const patch = (payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/api/users/@me', headers: auth(), payload });
const stored = () => testDb.select().from(schema.users).where(eq(schema.users.id, ME)).get()!.replicatedInstances;

beforeEach(async () => {
  sent.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.users).values([
    { id: ME, username: 'me', passwordHash: 'x', createdAt: 1 },
    { id: FRIEND, username: 'friend', passwordHash: 'x', createdAt: 1 },
  ]).run();
  testDb.insert(schema.dmChannels).values({ id: 'dm', ownerId: null, createdAt: 1 }).run();
  testDb.insert(schema.dmMembers).values([{ dmChannelId: 'dm', userId: ME }, { dmChannelId: 'dm', userId: FRIEND }]).run();
  const { userRoutes } = await import('./users.js');
  app = Fastify({ logger: false });
  await app.register(userRoutes);
  await app.ready();
});

describe('PATCH /api/users/@me: the other instances an account names', () => {
  it('keeps a name and an origin per entry, the origin in its one form, each origin once', async () => {
    const res = await patch({
      replicatedInstances: [
        { origin: 'https://Other.Example/', username: ' mara ', note: 'x'.repeat(40_000), nested: { deep: [1, 2, 3] } },
        { origin: 'https://other.example', username: 'mara' },
        { domain: 'legacy.example', username: 'mara' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(stored()!)).toEqual([
      { origin: 'https://other.example', username: 'mara' },
      { origin: 'https://legacy.example', username: 'mara' },
    ]);
  });

  it('refuses an origin that is no usable address, and more entries than the cap', async () => {
    const bad = await patch({ replicatedInstances: [{ origin: 'https://exa mple.org', username: 'mara' }] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'validation_failed', details: { field: 'replicatedInstances.origin' } });

    const many = Array.from({ length: MAX_REPLICATED_INSTANCES + 1 }, (_, i) => ({ origin: `https://i${i}.example`, username: 'mara' }));
    expect((await patch({ replicatedInstances: many })).statusCode).toBe(400);
    expect(stored()).toBe('[]');
  });

  it('goes to the account itself and to nobody else', async () => {
    // A profile change goes out to the people who see the account; the list rides along only to itself.
    const res = await patch({ displayName: 'Mara', replicatedInstances: [{ origin: 'https://other.example', username: 'mara' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().replicatedInstances).toEqual([{ origin: 'https://other.example', username: 'mara' }]);

    const toFriend = sent.filter(([to, event]) => to === FRIEND && event.type === 'user_updated');
    const toMe = sent.filter(([to, event]) => to === ME && event.type === 'user_updated');
    expect(toFriend.length).toBeGreaterThan(0);
    for (const [, event] of toFriend) expect(event.user).not.toHaveProperty('replicatedInstances');
    expect(toMe.length).toBeGreaterThan(0);
    for (const [, event] of toMe) expect((event.user as { replicatedInstances?: unknown }).replicatedInstances).toEqual([{ origin: 'https://other.example', username: 'mara' }]);
  });
});

describe('a stored list read back', () => {
  it('never comes out larger than the cap or with an entry it cannot use', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ origin: `https://i${i}.example`, username: 'mara' }));
    expect(storedReplicatedInstances(JSON.stringify(many))).toHaveLength(MAX_REPLICATED_INSTANCES);
    expect(storedReplicatedInstances(JSON.stringify([null, 7, 'x', { origin: 'ftp://a.example', username: 'm' }, { origin: 'https://a.example' }]))).toEqual([]);
    expect(storedReplicatedInstances('{"origin":"https://a.example"}')).toEqual([]);
    expect(storedReplicatedInstances('not json')).toEqual([]);
  });
});

describe(`migration ${CLEANUP}`, () => {
  it('empties a list the route could never have stored and leaves one it wrote', () => {
    const db = new Database(':memory:');
    applyMigrations(db, CLEANUP);
    const insert = db.prepare('INSERT INTO users (id, username, password_hash, created_at, replicated_instances) VALUES (?, ?, ?, 1, ?)');
    const kept = JSON.stringify([{ origin: 'https://other.example', username: 'mara' }]);
    insert.run('kept', 'kept', 'x', kept);
    insert.run('huge', 'huge', 'x', JSON.stringify([{ origin: 'https://other.example', username: 'mara', junk: 'x'.repeat(40_000) }]));
    insert.run('many', 'many', 'x', JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ origin: `https://i${i}.example`, username: 'm' }))));
    insert.run('broken', 'broken', 'x', '{not json');
    insert.run('object', 'object', 'x', '{"origin":"https://other.example"}');
    runMigration(db, CLEANUP);
    const listOf = (id: string) => (db.prepare('SELECT replicated_instances AS v FROM users WHERE id = ?').get(id) as { v: string }).v;
    expect(listOf('kept')).toBe(kept);
    for (const id of ['huge', 'many', 'broken', 'object']) expect(listOf(id), id).toBe('[]');
  });
});
