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

setWorkerId(1);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Module-level mutable state. Each describe's beforeEach reassigns
// `sqlite`/`testDb`/`app`; the `getDb: () => testDb` getter in the mock
// closes over the current binding, so reassignment is observed. Adding
// a top-level `it` (outside any describe) or switching to `.concurrent`
// would break this pattern — keep new tests inside a describe block
// that owns its own beforeEach reset.
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

const CALLER_ID = 'caller-user-id';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = CALLER_ID;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToAdmins: vi.fn(),
    sendToDmMembers: vi.fn(),
    getAllOnlineUserIds: () => [],
  },
}));

vi.mock('../utils/federationOutbox.js', () => ({
  appendMutationLog: vi.fn(),
  queueOutboxEvent: vi.fn(),
  buildFriendContextId: () => 'ctx',
  getFriendEventTargets: () => [],
}));

vi.mock('../utils/federationAuth.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/federationAuth.js')>();
  return { ...actual, getOurOrigin: () => 'https://local.test' };
});

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const statements = sqlText.split(/-->\s*statement-breakpoint/);
    for (const stmt of statements) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

interface UserSeed {
  id: string;
  username: string;
  displayName?: string | null;
  isDeleted?: 0 | 1;
  homeInstance?: string | null;
  homeUserId?: string | null;
  suspendedAt?: number | null;
  suspendedUntil?: number | null;
}

function seedUser(u: UserSeed): void {
  testDb.insert(schema.users).values({
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? null,
    passwordHash: 'x',
    status: 'offline',
    isAdmin: 0,
    isDeleted: u.isDeleted ?? 0,
    homeInstance: u.homeInstance ?? null,
    homeUserId: u.homeUserId ?? null,
    suspendedAt: u.suspendedAt ?? null,
    suspendedUntil: u.suspendedUntil ?? null,
    suspensionReason: u.suspendedAt ? 'test' : null,
    createdAt: Date.now(),
  }).run();
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { socialRoutes, _resetUserSearchLimit } = await import('./social.js');
  _resetUserSearchLimit();
  await app.register(socialRoutes);
  await app.ready();
  return app;
}

describe('GET /api/social/search — finding people by username', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    testDb = drizzle(sqlite, { schema });
    applyMigrations(sqlite);
    // The caller themselves must exist so self-exclusion is meaningful.
    seedUser({ id: CALLER_ID, username: 'caller' });
    app = await buildApp();
  });

  async function search(q: string) {
    const res = await app.inject({ method: 'GET', url: `/api/social/search?q=${encodeURIComponent(q)}` });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as Array<{ id: string; username: string }>;
  }

  it('finds accounts by the start of their username, the exact name first', async () => {
    seedUser({ id: 'u1', username: 'alice', displayName: 'Alice' });
    seedUser({ id: 'u2', username: 'alicia' });
    seedUser({ id: 'u3', username: 'ali' });
    seedUser({ id: 'u4', username: 'malice' });
    const out = await search('ali');
    expect(out.map(u => u.id)).toEqual(['u3', 'u1', 'u2']);
  });

  it('answers with what a row needs and nothing about the person', async () => {
    seedUser({ id: 'u1', username: 'alice', displayName: 'Alice' });
    const [row] = await search('@Alice');
    expect(row).toEqual({
      id: 'u1', username: 'alice', displayName: 'Alice', avatar: null, avatarColor: null, homeInstance: null, homeUserId: null,
    });
  });

  it('refuses a query that cannot be a username', async () => {
    for (const q of ['al', 'a b c', 'ali%']) {
      const res = await app.inject({ method: 'GET', url: `/api/social/search?q=${encodeURIComponent(q)}` });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).code).toBe('user_search_query_invalid');
    }
  });

  it('takes an underscore literally', async () => {
    seedUser({ id: 'u1', username: 'a_bc' });
    seedUser({ id: 'u2', username: 'axbc' });
    const out = await search('a_b');
    expect(out.map(u => u.id)).toEqual(['u1']);
  });

  it('does not match display names', async () => {
    seedUser({ id: 'u1', username: 'a1b2c3', displayName: 'Wonderland' });
    expect(await search('wonder')).toEqual([]);
  });

  it('hides tombstoned users (isDeleted=1)', async () => {
    seedUser({ id: 'u1', username: 'alice', displayName: 'Alice', isDeleted: 1 });
    const out = await search('ali');
    expect(out.map(u => u.id)).not.toContain('u1');
  });

  it('hides replicated federated stubs (homeInstance set)', async () => {
    // Stub username matches the production form: <homeUserId>@<domain>.
    seedUser({
      id: 'stub1',
      username: 'remote-id@nova.ddns.net',
      displayName: null,
      homeInstance: 'nova.ddns.net',
      homeUserId: 'remote-id',
    });
    const out = await search('remote');
    expect(out.map(u => u.id)).not.toContain('stub1');
  });

  it('hides a suspended account, and finds it again once the suspension ended', async () => {
    seedUser({ id: 'u1', username: 'alice', suspendedAt: Date.now() - 1000, suspendedUntil: null });
    seedUser({ id: 'u2', username: 'alicia', suspendedAt: Date.now() - 2000, suspendedUntil: Date.now() - 1000 });
    const out = await search('ali');
    expect(out.map(u => u.id)).toEqual(['u2']);
  });

  it('hides people in a block with the caller, in either direction', async () => {
    seedUser({ id: 'u1', username: 'alice' });
    seedUser({ id: 'u2', username: 'alicia' });
    seedUser({ id: 'u3', username: 'alina' });
    testDb.insert(schema.userBlocks).values([
      { blockerId: CALLER_ID, blockedId: 'u1', createdAt: Date.now() },
      { blockerId: 'u2', blockedId: CALLER_ID, createdAt: Date.now() },
    ]).run();
    const out = await search('ali');
    expect(out.map(u => u.id)).toEqual(['u3']);
  });

  it('excludes the caller from results', async () => {
    // Caller is seeded in beforeEach with username 'caller'.
    const out = await search('call');
    expect(out.map(u => u.id)).not.toContain(CALLER_ID);
  });

  it('answers at most eight names: the exact one, then the rest in name order', async () => {
    for (let i = 0; i < 10; i += 1) seedUser({ id: `p${i}`, username: `pilot${i}` });
    seedUser({ id: 'exact', username: 'pilot' });
    const out = await search('pilot');
    expect(out.map(u => u.username)).toEqual(['pilot', 'pilot0', 'pilot1', 'pilot2', 'pilot3', 'pilot4', 'pilot5', 'pilot6']);
  });

  it('reads the query trimmed and lowercased, without one leading @, up to a whole username', async () => {
    seedUser({ id: 'u1', username: 'alice' });
    expect((await search('  @ALICE  ')).map(u => u.id)).toEqual(['u1']);
    expect(await search('a'.repeat(32))).toEqual([]);
  });

  it('names the bounds when it refuses a query: too short, too long, missing, or a second @', async () => {
    for (const url of [
      '/api/social/search?q=al',
      `/api/social/search?q=${'a'.repeat(33)}`,
      '/api/social/search',
      `/api/social/search?q=${encodeURIComponent('@@ali')}`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({
        code: 'user_search_query_invalid',
        statusCode: 400,
        details: { min: 3, max: 32 },
      });
    }
  });

  it('lets one account search 20 times a minute, then answers 429 rate_limited', async () => {
    // The budget is per account, on top of the per-address limiter; a shell
    // that switched limits off must not switch this case off with them.
    vi.stubEnv('DISABLE_RATE_LIMITS', '');
    try {
      for (let i = 0; i < 20; i += 1) {
        expect((await app.inject({ method: 'GET', url: '/api/social/search?q=alice' })).statusCode).toBe(200);
      }
      const refused = await app.inject({ method: 'GET', url: '/api/social/search?q=alice' });
      expect(refused.statusCode).toBe(429);
      expect(JSON.parse(refused.body).code).toBe('rate_limited');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('POST /api/social/requests — case-insensitive username lookup', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    testDb = drizzle(sqlite, { schema });
    applyMigrations(sqlite);
    seedUser({ id: CALLER_ID, username: 'caller' });
    // Target stored canonically lowercase, as registration would write it.
    seedUser({ id: 'target-id', username: 'bob' });
    app = await buildApp();
  });

  async function sendRequest(username: string) {
    return app.inject({
      method: 'POST',
      url: '/api/social/requests',
      payload: { username },
    });
  }

  it('finds the target when the caller types the exact stored handle', async () => {
    const res = await sendRequest('bob');
    expect(res.statusCode).toBe(201);
    const inserted = testDb.select().from(schema.friendRequests)
      .where(eq(schema.friendRequests.toId, 'target-id')).get();
    expect(inserted).toBeTruthy();
  });

  it('finds the target when the caller types a mixed-case handle', async () => {
    const res = await sendRequest('Bob');
    expect(res.statusCode).toBe(201);
    const inserted = testDb.select().from(schema.friendRequests)
      .where(eq(schema.friendRequests.toId, 'target-id')).get();
    expect(inserted).toBeTruthy();
  });

  it('finds the target when the caller types an all-uppercase handle', async () => {
    const res = await sendRequest('BOB');
    expect(res.statusCode).toBe(201);
  });

  it('trims surrounding whitespace before lookup', async () => {
    const res = await sendRequest('  bob  ');
    expect(res.statusCode).toBe(201);
  });

  it('returns 404 when the handle does not exist', async () => {
    const res = await sendRequest('nobody');
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('User not found');
  });

  it('broadcasts friend_request_sent to the sender on local request creation', async () => {
    seedUser({ id: 'u1', username: 'alice' });
    const { connectionManager } = await import('../ws/handler.js');
    const sendToUser = connectionManager.sendToUser as unknown as ReturnType<typeof vi.fn>;
    sendToUser.mockClear();

    const res = await app.inject({
      method: 'POST',
      url: '/api/social/requests',
      payload: { username: 'alice' },
    });
    expect(res.statusCode).toBe(201);

    const sent = sendToUser.mock.calls.find(c => c[1]?.type === 'friend_request_sent');
    expect(sent).toBeDefined();
    expect(sent![0]).toBe(CALLER_ID);
    // The 'user' field on the sent payload must be the TARGET (alice),
    // not the sender — symmetric with how the federated branch builds it.
    expect(sent![1].request.user.id).toBe('u1');
    expect(sent![1].request.user.username).toBe('alice');
  });
});

describe('social routes — error codes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    testDb = drizzle(sqlite, { schema });
    applyMigrations(sqlite);
    seedUser({ id: CALLER_ID, username: 'caller' });
    seedUser({ id: 'u-bob', username: 'bob' });
    app = await buildApp();
  });

  async function sendRequest(username: string) {
    return app.inject({ method: 'POST', url: '/api/social/requests', payload: { username } });
  }

  it('sends user_not_found with the legacy text for an unknown handle', async () => {
    const res = await sendRequest('nobody');
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('user_not_found');
    expect(body.error).toBe('User not found');
  });

  it('sends cannot_friend_self when the caller names themselves', async () => {
    const res = await sendRequest('caller');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('cannot_friend_self');
  });

  it('sends friend_request_pending when a request between the two users already exists', async () => {
    expect((await sendRequest('bob')).statusCode).toBe(201);
    const res = await sendRequest('bob');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('friend_request_pending');
  });

  it('sends validation_failed for an unknown status on PATCH', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/social/requests/x', payload: { status: 'maybe' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('validation_failed');
  });

  it('sends friend_request_not_found for a missing request on PATCH and DELETE', async () => {
    const patched = await app.inject({ method: 'PATCH', url: '/api/social/requests/missing', payload: { status: 'accepted' } });
    expect(patched.statusCode).toBe(404);
    expect(JSON.parse(patched.body).code).toBe('friend_request_not_found');
    const deleted = await app.inject({ method: 'DELETE', url: '/api/social/requests/missing' });
    expect(deleted.statusCode).toBe(404);
    expect(JSON.parse(deleted.body).code).toBe('friend_request_not_found');
  });

  it('answers a request once: deciding one already accepted or declined is friend_request_not_found', async () => {
    testDb.insert(schema.friendRequests).values([
      { id: 'req-declined', fromId: 'u-bob', toId: CALLER_ID, status: 'declined', createdAt: Date.now() },
      { id: 'req-accepted', fromId: 'u-bob', toId: CALLER_ID, status: 'accepted', createdAt: Date.now() },
    ]).run();
    for (const [id, status] of [['req-declined', 'accepted'], ['req-accepted', 'declined']] as const) {
      const res = await app.inject({ method: 'PATCH', url: `/api/social/requests/${id}`, payload: { status } });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).code).toBe('friend_request_not_found');
    }
    expect(testDb.select().from(schema.friends).all()).toEqual([]);
    const stored = testDb.select().from(schema.friendRequests).all();
    expect(Object.fromEntries(stored.map(r => [r.id, r.status]))).toEqual({ 'req-declined': 'declined', 'req-accepted': 'accepted' });
  });

  it('sends friend_request_not_recipient when someone else tries to decide a request', async () => {
    seedUser({ id: 'u-carol', username: 'carol' });
    testDb.insert(schema.friendRequests).values({
      id: 'req-1', fromId: 'u-bob', toId: 'u-carol', status: 'pending', createdAt: Date.now(),
    }).run();
    const res = await app.inject({ method: 'PATCH', url: '/api/social/requests/req-1', payload: { status: 'accepted' } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('friend_request_not_recipient');
  });

  it('sends friend_request_not_sender and friend_request_not_pending on cancel', async () => {
    seedUser({ id: 'u-carol', username: 'carol' });
    testDb.insert(schema.friendRequests).values({
      id: 'req-1', fromId: 'u-bob', toId: 'u-carol', status: 'pending', createdAt: Date.now(),
    }).run();
    const notSender = await app.inject({ method: 'DELETE', url: '/api/social/requests/req-1' });
    expect(notSender.statusCode).toBe(403);
    expect(JSON.parse(notSender.body).code).toBe('friend_request_not_sender');

    testDb.insert(schema.friendRequests).values({
      id: 'req-2', fromId: CALLER_ID, toId: 'u-bob', status: 'declined', createdAt: Date.now(),
    }).run();
    const notPending = await app.inject({ method: 'DELETE', url: '/api/social/requests/req-2' });
    expect(notPending.statusCode).toBe(400);
    expect(JSON.parse(notPending.body).code).toBe('friend_request_not_pending');
  });

  it('sends not_friends when removing a user who is not a friend', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/social/friends/u-bob' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('not_friends');
  });
});
