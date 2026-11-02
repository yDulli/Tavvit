import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { config } from '../config.js';

// Tavvit's promise: with FEDERATION_ENABLED off, this server never talks to
// another instance and never lets a request make it. The suite runs with the
// switch on (test/setup-env.ts), so every case here turns it off, and each one
// checks the thing that would have left the server (a fetch, a handshake, a
// worker) rather than only the status code.

setWorkerId(7);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CALLER_ID = 'caller-id';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
const federation = config.federation as { enabled: boolean };
const fetchSpy = vi.fn<typeof fetch>();

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/auth.js')>();
  return { ...actual, authenticate: async (req: { userId?: string }) => { req.userId = CALLER_ID; } };
});
vi.mock('../ws/handler.js', () => ({
  connectionManager: { sendToUser: vi.fn(), sendToAdmins: vi.fn(), sendToDmMembers: vi.fn(), getAllOnlineUserIds: () => [] },
}));
vi.mock('../utils/federationAuth.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/federationAuth.js')>();
  return { ...actual, getOurOrigin: () => 'https://home.test' };
});

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

beforeEach(async () => {
  federation.enabled = false;
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  // An instance that would otherwise accept federated sign-ups: the DB flags say yes,
  // so only the master switch can be what refuses them.
  sqlite.prepare(
    'INSERT INTO instance_settings (id, federated_registration_open, registration_open, updated_at) VALUES (1, 1, 1, 1)',
  ).run();
  testDb.insert(schema.users).values({
    id: CALLER_ID, username: 'caller', passwordHash: 'x', createdAt: Date.now(),
  }).run();

  const { authRoutes } = await import('./auth.js');
  const { socialRoutes } = await import('./social.js');
  app = Fastify({ logger: false });
  await app.register(authRoutes);
  await app.register(socialRoutes);
  await app.ready();
});

afterEach(async () => {
  federation.enabled = true;
  vi.unstubAllGlobals();
  await app.close();
});

describe('federated registration', () => {
  it('is refused with federation_disabled even though the instance flag says it is open', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'kim@peer.test', password: 'long enough password', homeInstance: 'peer.test', homeUserId: 'h1' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('federation_disabled');
    expect(testDb.select().from(schema.users).all().map((u) => u.username)).toEqual(['caller']);
  });

  it('does not affect an ordinary local registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'dana', password: 'long enough password' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('sign-in for an account that names a home instance', () => {
  it('never sends the typed password to that host', async () => {
    const { hashPassword } = await import('../utils/auth.js');
    testDb.insert(schema.users).values({
      id: 'fed-1', username: 'kim@peer.test', passwordHash: await hashPassword('the real one'),
      homeInstance: 'peer.test', homeUserId: 'h1', createdAt: Date.now(),
    }).run();
    // Wrong password: with federation on, the self-heal path would POST it to peer.test.
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'kim@peer.test', password: 'a guess' },
    });
    expect(res.statusCode).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does still try the home instance when federation is on (the upstream behaviour)', async () => {
    federation.enabled = true;
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));
    const { hashPassword } = await import('../utils/auth.js');
    testDb.insert(schema.users).values({
      id: 'fed-2', username: 'lee@peer.test', passwordHash: await hashPassword('the real one'),
      homeInstance: 'peer.test', homeUserId: 'h2', createdAt: Date.now(),
    }).run();
    await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'lee@peer.test', password: 'a guess' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://peer.test/api/auth/login');
  });
});

describe('adding a friend on another instance', () => {
  it('is refused with federation_disabled and starts no peering', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/social/requests', payload: { username: 'alice@peer.test' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('federation_disabled');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(testDb.select().from(schema.federationPeers).all()).toHaveLength(0);
  });

  it('still adds a local friend by plain username', async () => {
    testDb.insert(schema.users).values({ id: 'friend-1', username: 'alice', passwordHash: 'x', createdAt: Date.now() }).run();
    const res = await app.inject({
      method: 'POST', url: '/api/social/requests', payload: { username: 'alice' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('peering and background work', () => {
  it('ensurePeered answers "failed" without creating a peer row or sending anything', async () => {
    const { ensurePeered } = await import('../utils/federationPeering.js');
    const result = await ensurePeered('https://peer.test', { kind: 'system' });
    expect(result.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(testDb.select().from(schema.federationPeers).all()).toHaveLength(0);
  });

  it('starts only the storage janitor, not the outbox, health-check or sync workers', async () => {
    vi.useFakeTimers();
    try {
      const { startFederationWorkers, stopFederationWorkers } = await import('../utils/federationWorker.js');
      // Other modules may already hold timers; what matters is what starting the workers adds.
      const before = vi.getTimerCount();
      startFederationWorkers();
      // One new timer: the janitor (it also expires abandoned uploads, which every instance needs).
      // With federation on the same call schedules the outbox, file queue, health check, recovery,
      // peer sync and call sentinel as well.
      expect(vi.getTimerCount() - before).toBe(1);
      stopFederationWorkers();
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
