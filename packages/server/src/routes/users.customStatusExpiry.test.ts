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

setWorkerId(26);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const ME = 'me-1';
const FRIEND = 'friend-1';
const auth = () => ({ Authorization: `Bearer ${signJwt({ userId: ME, username: 'me' })}` });
const patch = (payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/api/users/@me', headers: auth(), payload });
const row = () => testDb.select().from(schema.users).where(eq(schema.users.id, ME)).get()!;

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
  // They share a conversation, so the friend sees profile changes.
  testDb.insert(schema.dmChannels).values({ id: 'dm', ownerId: null, createdAt: 1 }).run();
  testDb.insert(schema.dmMembers).values([{ dmChannelId: 'dm', userId: ME }, { dmChannelId: 'dm', userId: FRIEND }]).run();
  const { userRoutes } = await import('./users.js');
  app = Fastify({ logger: false });
  await app.register(userRoutes);
  await app.ready();
});

describe('PATCH /api/users/@me: a status that clears itself', () => {
  it('stores the end as the server\'s now plus the chosen minutes', async () => {
    const before = Date.now();
    const res = await patch({ customStatus: 'in a meeting', customStatusExpiresInMinutes: 30 });
    const after = Date.now();
    expect(res.statusCode).toBe(200);
    const stored = row().customStatusExpiresAt!;
    expect(stored).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(stored).toBeLessThanOrEqual(after + 30 * 60_000);
    expect(res.json().customStatusExpiresAt).toBe(stored);
  });

  it('keeps a status without a duration until it is changed', async () => {
    await patch({ customStatus: 'timed', customStatusExpiresInMinutes: 30 });
    const res = await patch({ customStatus: 'forever' });
    expect(row().customStatusExpiresAt).toBeNull();
    expect(res.json().customStatusExpiresAt).toBeNull();
  });

  it('null as the duration means no end', async () => {
    await patch({ customStatus: 'timed', customStatusExpiresInMinutes: 30 });
    await patch({ customStatus: 'timed', customStatusExpiresInMinutes: null });
    expect(row().customStatusExpiresAt).toBeNull();
  });

  it('clearing the status clears the end with it', async () => {
    await patch({ customStatus: 'timed', customStatusExpiresInMinutes: 30 });
    await patch({ customStatus: '', customStatusExpiresInMinutes: 30 });
    expect(row().customStatus).toBeNull();
    expect(row().customStatusExpiresAt).toBeNull();
  });

  it('a duration alone re-times the status that is already set', async () => {
    await patch({ customStatus: 'brb' });
    await patch({ customStatusExpiresInMinutes: 60 });
    expect(row().customStatus).toBe('brb');
    expect(row().customStatusExpiresAt).not.toBeNull();
  });

  it('a duration alone with no status sets nothing', async () => {
    const res = await patch({ customStatusExpiresInMinutes: 60 });
    expect(res.statusCode).toBe(200);
    expect(row().customStatusExpiresAt).toBeNull();
  });

  it.each([0, -1, 1.5, 10081, '30', {}])('refuses %j as a duration, with a code', async (minutes) => {
    const res = await patch({ customStatus: 'x', customStatusExpiresInMinutes: minutes });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('custom_status_expiry_invalid');
    expect(row().customStatus).toBeNull();
  });

  it('accepts the whole range, one minute to seven days', async () => {
    expect((await patch({ customStatus: 'x', customStatusExpiresInMinutes: 1 })).statusCode).toBe(200);
    expect((await patch({ customStatus: 'x', customStatusExpiresInMinutes: 10080 })).statusCode).toBe(200);
  });

  it('tells the owner when it ends, and everybody else only the status', async () => {
    await patch({ customStatus: 'in a meeting', customStatusExpiresInMinutes: 30 });
    const updates = sent.filter(([, event]) => event.type === 'user_updated');
    const own = updates.find(([to]) => to === ME)![1].user as Record<string, unknown>;
    const friends = updates.find(([to]) => to === FRIEND)![1].user as Record<string, unknown>;
    expect(typeof own.customStatusExpiresAt).toBe('number');
    expect(friends.customStatus).toBe('in a meeting');
    expect('customStatusExpiresAt' in friends).toBe(false);
  });
});
