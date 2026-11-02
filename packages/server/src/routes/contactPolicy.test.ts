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

// Who may start something with whom, through the real routes and a real database.

setWorkerId(5);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'alice';

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
    sendToUser: vi.fn(),
    sendToDmMembers: vi.fn(),
    sendToAdmins: vi.fn(),
    getAllOnlineUserIds: () => [],
    getRoom: () => undefined,
    getUserRoom: () => undefined,
    leaveCurrentRoom: vi.fn(() => false),
    destroyRoom: vi.fn(),
    clearVoiceUserStatus: vi.fn(),
  },
}));

vi.mock('../utils/federationOutbox.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationOutbox.js')>('../utils/federationOutbox.js');
  return {
    ...actual,
    isFederationRelayEnabled: () => false,
    queueDmCloseRelay: vi.fn(),
    sendTypingRelay: vi.fn(),
    queueDmRelay: vi.fn(),
    queueGroupMetadataRelay: vi.fn(),
    appendMutationLog: vi.fn(),
    queueOutboxEvent: vi.fn(),
  };
});

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
}

let app: FastifyInstance;

function setRules(id: string, rules: { dmPolicy?: string; friendRequestPolicy?: string }): void {
  testDb.update(schema.users).set(rules).where(eq(schema.users.id, id)).run();
}
function befriend(a: string, b: string): void {
  testDb.insert(schema.friends).values({ userId: a, friendId: b, createdAt: 1 }).run();
}
function shareASpace(...ids: string[]): void {
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: ids[0]!, createdAt: 1 }).run();
  for (const userId of ids) testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId, joinedAt: 1 }).run();
}
const openDm = (userId: string) => app.inject({ method: 'POST', url: '/api/dm', payload: { userId } });
const askFriend = (username: string) => app.inject({ method: 'POST', url: '/api/social/requests', payload: { username } });
const search = (q: string) => app.inject({ method: 'GET', url: `/api/social/search?q=${q}` });

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of ['alice', 'bob', 'carol']) {
    testDb.insert(schema.users).values({ id, username: id, displayName: id, passwordHash: 'x', homeUserId: id, createdAt: Date.now() }).run();
  }
  currentUserId = 'alice';
  app = Fastify({ logger: false });
  const { dmRoutes } = await import('./dm.js');
  const { socialRoutes } = await import('./social.js');
  const { userRoutes } = await import('./users.js');
  await app.register(dmRoutes);
  await app.register(socialRoutes);
  await app.register(userRoutes);
  await app.ready();
});

describe('starting a conversation', () => {
  it('refuses a stranger by default, on a server where anyone can find anyone by name', async () => {
    const res = await openDm('bob');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('dm_not_accepted');
  });

  it('lets a friend and someone in a shared space through by default', async () => {
    befriend('alice', 'bob');
    expect((await openDm('bob')).statusCode).toBe(201);
    shareASpace('alice', 'carol');
    expect((await openDm('carol')).statusCode).toBe(201);
  });

  it('holds to friends only when that is the rule, a shared space no longer counting', async () => {
    setRules('bob', { dmPolicy: 'friends' });
    shareASpace('alice', 'bob');
    expect((await openDm('bob')).statusCode).toBe(403);
    befriend('bob', 'alice');
    expect((await openDm('bob')).statusCode).toBe(201);
  });

  it('refuses even a friend under "nobody", and nobody under "anyone"', async () => {
    setRules('bob', { dmPolicy: 'nobody' });
    befriend('alice', 'bob');
    expect((await openDm('bob')).statusCode).toBe(403);
    setRules('bob', { dmPolicy: 'anyone' });
    expect((await openDm('bob')).statusCode).toBe(201);
  });

  it('leaves a conversation they already have open, whatever the rule says now', async () => {
    setRules('bob', { dmPolicy: 'anyone' });
    expect((await openDm('bob')).statusCode).toBe(201);
    setRules('bob', { dmPolicy: 'nobody' });
    expect((await openDm('bob')).statusCode).toBe(200);
  });

  it('says a block first: it is the one the person can undo', async () => {
    setRules('bob', { dmPolicy: 'nobody' });
    testDb.insert(schema.userBlocks).values({ blockerId: 'alice', blockedId: 'bob', createdAt: 1 }).run();
    expect((await openDm('bob')).json().code).toBe('blocked_by_you');
  });

  it('asks nothing of a person whose account lives on another instance: their home decides', async () => {
    testDb.insert(schema.users).values({ id: 'remote', username: 'remote@other.example', passwordHash: 'x', homeUserId: 'r1', homeInstance: 'other.example', createdAt: 1, dmPolicy: 'nobody' }).run();
    expect((await openDm('remote')).statusCode).not.toBe(403);
  });
});

describe('friend requests', () => {
  it('reach anyone by default', async () => {
    expect((await askFriend('bob')).statusCode).toBe(201);
  });

  it('are refused under "nobody", and only people of a shared space get through under "shared_spaces"', async () => {
    setRules('bob', { friendRequestPolicy: 'nobody' });
    const refused = await askFriend('bob');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('friend_request_not_accepted');

    setRules('bob', { friendRequestPolicy: 'shared_spaces' });
    expect((await askFriend('bob')).statusCode).toBe(403);
    shareASpace('alice', 'bob');
    expect((await askFriend('bob')).statusCode).toBe(201);
  });

  it('tell someone a request is pending rather than what the rule is, once one exists', async () => {
    expect((await askFriend('bob')).statusCode).toBe(201);
    setRules('bob', { friendRequestPolicy: 'nobody' });
    expect((await askFriend('bob')).json().code).toBe('friend_request_pending');
  });
});

describe('searching by name', () => {
  const found = async (q: string) => (await search(q)).json().map((row: { id: string }) => row.id);

  it('offers only people who would take a request from the one searching', async () => {
    expect(await found('bob')).toEqual(['bob']);
    setRules('bob', { friendRequestPolicy: 'nobody' });
    expect(await found('bob')).toEqual([]);
    setRules('bob', { friendRequestPolicy: 'shared_spaces' });
    expect(await found('bob')).toEqual([]);
    shareASpace('alice', 'bob');
    expect(await found('bob')).toEqual(['bob']);
  });
});

describe('the rules themselves', () => {
  it('can be changed by the person, and only to something that exists', async () => {
    const saved = await app.inject({ method: 'PATCH', url: '/api/users/@me', payload: { dmPolicy: 'friends', friendRequestPolicy: 'nobody' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ dmPolicy: 'friends', friendRequestPolicy: 'nobody' });
    const refused = await app.inject({ method: 'PATCH', url: '/api/users/@me', payload: { dmPolicy: 'everyone-but-bob' } });
    expect(refused.statusCode).toBe(400);
  });

  it('are not part of what others are told about someone', async () => {
    const { sanitizeUser } = await import('../utils/sanitize.js');
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, 'bob')).get()!;
    expect(sanitizeUser(row)).not.toHaveProperty('dmPolicy');
    expect(sanitizeUser(row)).not.toHaveProperty('friendRequestPolicy');
  });
});
