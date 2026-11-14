import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

// A block closes direct contact in both directions: friend requests, new
// conversations, messages in the shared 1-on-1, groups. These tests drive the
// real routes and the shared message check against a real database.

setWorkerId(3);

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
    buildFriendContextId: () => 'ctx',
    getFriendEventTargets: () => [],
  };
});

vi.mock('../utils/federationAuth.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/federationAuth.js')>();
  return { ...actual, getOurOrigin: () => 'https://local.test' };
});

vi.mock('../utils/fileCleanup.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/fileCleanup.js')>('../utils/fileCleanup.js');
  return { ...actual, deleteUploadFile: vi.fn(), deleteAttachmentByFilename: vi.fn(), deleteAttachmentFiles: vi.fn() };
});

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

function seedUser(id: string): void {
  testDb.insert(schema.users).values({
    id, username: id, displayName: id, passwordHash: 'x', homeUserId: id,
    homeInstance: null, createdAt: Date.now(), dmPolicy: 'anyone',
  }).run();
}

function seedOneOnOne(id: string, a: string, b: string): void {
  testDb.insert(schema.dmChannels).values({ id, ownerId: null, createdAt: Date.now() }).run();
  testDb.insert(schema.dmMembers).values([{ dmChannelId: id, userId: a }, { dmChannelId: id, userId: b }]).run();
}

function block(blocker: string, blocked: string): void {
  testDb.insert(schema.userBlocks).values({ blockerId: blocker, blockedId: blocked, createdAt: Date.now() }).run();
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { dmRoutes } = await import('./dm.js');
  const { socialRoutes } = await import('./social.js');
  await app.register(dmRoutes);
  await app.register(socialRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of ['alice', 'bob', 'carol']) seedUser(id);
  currentUserId = 'alice';
  app = await buildApp();
});

describe('friend requests', () => {
  const ask = (username: string) => app.inject({ method: 'POST', url: '/api/social/requests', payload: { username } });

  it('go through when nothing is blocked', async () => {
    expect((await ask('bob')).statusCode).toBe(201);
  });

  it('are refused, with a plain reason, to someone you blocked', async () => {
    block('alice', 'bob');
    const res = await ask('bob');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('blocked_by_you');
    expect(testDb.select().from(schema.friendRequests).all()).toEqual([]);
  });

  it('are refused, without saying why, to someone who blocked you', async () => {
    block('bob', 'alice');
    const res = await ask('bob');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('interaction_unavailable');
    // Nothing in the answer, the code included, says a block is why.
    expect(JSON.stringify(res.json()).toLowerCase()).not.toContain('block');
  });

  it('are unaffected for a third person', async () => {
    block('alice', 'bob');
    expect((await ask('carol')).statusCode).toBe(201);
  });
});

describe('new conversations', () => {
  const open = (userId: string) => app.inject({ method: 'POST', url: '/api/dm', payload: { userId } });

  it('open normally when nothing is blocked', async () => {
    expect([200, 201]).toContain((await open('bob')).statusCode);
  });

  it('are refused towards someone you blocked', async () => {
    block('alice', 'bob');
    const res = await open('bob');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('blocked_by_you');
  });

  it('are refused towards someone who blocked you, neutrally', async () => {
    block('bob', 'alice');
    const res = await open('bob');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('interaction_unavailable');
  });

  it('do not create a conversation when refused', async () => {
    block('bob', 'alice');
    await open('bob');
    expect(testDb.select().from(schema.dmChannels).all()).toEqual([]);
  });

  it('a group cannot be made with someone on either side of a block', async () => {
    block('bob', 'alice');
    const res = await app.inject({ method: 'POST', url: '/api/dm/group', payload: { users: [{ id: 'bob' }, { id: 'carol' }] } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('interaction_unavailable');
    expect(testDb.select().from(schema.dmChannels).all()).toEqual([]);
  });
});

describe('messages in an existing 1-on-1', () => {
  const send = (dmId: string, content = 'hello') =>
    app.inject({ method: 'POST', url: `/api/dm/${dmId}/messages`, payload: { content } });

  beforeEach(() => {
    seedOneOnOne('dm-ab', 'alice', 'bob');
  });

  it('are sent normally when nothing is blocked', async () => {
    expect((await send('dm-ab')).statusCode).toBe(201);
  });

  it('stop in both directions while a block exists', async () => {
    block('bob', 'alice');
    const fromBlocked = await send('dm-ab');
    expect(fromBlocked.statusCode).toBe(403);
    expect(fromBlocked.json().code).toBe('interaction_unavailable');

    currentUserId = 'bob';
    const fromBlocker = await send('dm-ab');
    expect(fromBlocker.statusCode).toBe(403);
    expect(fromBlocker.json().code).toBe('blocked_by_you');
    expect(testDb.select().from(schema.dmMessages).all()).toEqual([]);
  });

  it('leave history readable', async () => {
    await send('dm-ab', 'before');
    block('bob', 'alice');
    const history = await app.inject({ method: 'GET', url: '/api/dm/dm-ab/messages' });
    expect(history.statusCode).toBe(200);
    expect(JSON.stringify(history.json())).toContain('before');
  });

  it('resume once the block is lifted', async () => {
    block('bob', 'alice');
    expect((await send('dm-ab')).statusCode).toBe(403);
    testDb.delete(schema.userBlocks).run();
    expect((await send('dm-ab')).statusCode).toBe(201);
  });

  // An edit is new words: it reached the other person at once, with its links looked up again,
  // though the block had closed the conversation to new messages (security audit, 2026-11-14).
  it('cannot be edited or pinned while a block exists, by either of the two', async () => {
    const sent = (await send('dm-ab', 'before')).json() as { id: string };
    block('bob', 'alice');
    const edit = await app.inject({ method: 'PATCH', url: `/api/dm/messages/${sent.id}`, payload: { content: 'now with https://example.com/a-link' } });
    expect(edit.statusCode).toBe(403);
    expect(edit.json().code).toBe('interaction_unavailable');
    expect(testDb.select().from(schema.dmMessages).all()[0]?.content).toBe('before');
    // The rule the pin routes ask (routes/pins.ts), for the one blocked and for the one who blocked.
    const { checkDmMessagePin } = await import('../utils/dmMessageRules.js');
    expect(checkDmMessagePin(sent.id, 'alice')).toMatchObject({ ok: false, refusal: { status: 403, code: 'interaction_unavailable' } });
    expect(checkDmMessagePin(sent.id, 'bob')).toMatchObject({ ok: false, refusal: { status: 403, code: 'blocked_by_you' } });

    testDb.delete(schema.userBlocks).run();
    expect(checkDmMessagePin(sent.id, 'alice').ok).toBe(true);
    expect((await app.inject({ method: 'PATCH', url: `/api/dm/messages/${sent.id}`, payload: { content: 'after' } })).statusCode).toBe(200);
  });

  // Every id is looked up and written in turn: a list of tens of thousands, or one id repeated, held the server.
  it('carry no more files than a message has room for, each once', async () => {
    const many = Array.from({ length: 51 }, (_unused, at) => `file-${at}`);
    const tooMany = await app.inject({ method: 'POST', url: '/api/dm/dm-ab/messages', payload: { content: 'x', attachments: many } });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().code).toBe('attachment_invalid');
    const twice = await app.inject({ method: 'POST', url: '/api/dm/dm-ab/messages', payload: { content: 'x', attachments: ['file-1', 'file-1'] } });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().code).toBe('attachment_invalid');
    expect(testDb.select().from(schema.dmMessages).all()).toEqual([]);
  });

  it('are not stopped in a group the two share', async () => {
    testDb.insert(schema.dmChannels).values({ id: 'grp', ownerId: 'alice', createdAt: Date.now() }).run();
    testDb.insert(schema.dmMembers).values([
      { dmChannelId: 'grp', userId: 'alice' }, { dmChannelId: 'grp', userId: 'bob' }, { dmChannelId: 'grp', userId: 'carol' },
    ]).run();
    block('bob', 'alice');
    expect((await send('grp')).statusCode).toBe(201);
  });
});
