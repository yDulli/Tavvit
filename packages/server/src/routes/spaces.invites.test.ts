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

// Invite links, and what a kick or a ban takes with it, through the real routes.

setWorkerId(6);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'owner';
const sendToChannel = vi.hoisted(() => vi.fn());

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
    addUserSpace: vi.fn(),
    removeUserSpace: vi.fn(),
    sendToSpace: vi.fn(),
    sendToUser: vi.fn(),
    sendToChannel,
    getUserRoom: () => undefined,
  },
}));

vi.mock('../utils/fileCleanup.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/fileCleanup.js')>('../utils/fileCleanup.js');
  return { ...actual, deleteAttachmentFiles: vi.fn() };
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
const SPACE = 'space';
const STANDING = 'standing-code';

const as = (userId: string) => { currentUserId = userId; };
const list = () => app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/invites` });
const create = (payload: object = {}) => app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/invites`, payload });
const revoke = (code: string) => app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/invites/${code}` });
const join = (inviteCode: string) => app.inject({ method: 'POST', url: '/api/spaces/join', payload: { inviteCode } });
const preview = (code: string) => app.inject({ method: 'GET', url: `/api/spaces/invite/${code}/preview` });
const isMember = (userId: string) => testDb.select().from(schema.spaceMembers).all().some((m) => m.userId === userId);

beforeEach(async () => {
  sendToChannel.mockClear();
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of ['owner', 'member', 'first', 'second', 'troll']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'owner', inviteCode: STANDING, visibility: 'public', createdAt: 1 }).run();
  for (const userId of ['owner', 'member', 'troll']) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId, joinedAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: 'general', spaceId: SPACE, name: 'general', type: 'text', position: 0, createdAt: 1 }).run();
  as('owner');
  app = Fastify({ logger: false });
  const { spaceRoutes } = await import('./spaces.js');
  await app.register(spaceRoutes);
  await app.ready();
});

describe('invite links', () => {
  it('lists the standing link for a space from before the table, and leaves the code out of what every member is told', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.json().invites).toMatchObject([{ code: STANDING, standing: true, uses: 0, maxUses: null, expiresAt: null }]);
    const { spaceToWire } = await import('../utils/spaceWire.js');
    const row = testDb.select().from(schema.spaces).where(eq(schema.spaces.id, SPACE)).get()!;
    expect(spaceToWire(row).inviteCode).toBeNull();
  });

  it('are listed and revoked only by someone who manages the space', async () => {
    as('member');
    expect((await list()).statusCode).toBe(403);
    expect((await revoke(STANDING)).statusCode).toBe(403);
    as('first');
    expect((await list()).statusCode).toBe(403);
    expect((await create()).statusCode).toBe(403);
  });

  it('take only the offered end dates and limits', async () => {
    expect((await create({ expiresInSeconds: 12345 })).json().code).toBe('invite_options_invalid');
    expect((await create({ maxUses: 7 })).json().code).toBe('invite_options_invalid');
    expect((await create({ maxUses: 'lots' })).statusCode).toBe(400);
    expect((await create({ expiresInSeconds: 3600, maxUses: 5 })).statusCode).toBe(201);
  });

  it('let in as many people as they say, and the count is the server\'s', async () => {
    const created = await create({ maxUses: 1 });
    const code = created.json().invites.find((i: { standing: boolean }) => !i.standing).code as string;
    as('first');
    expect((await join(code)).statusCode).toBe(200);
    expect(isMember('first')).toBe(true);
    as('second');
    const refused = await join(code);
    expect(refused.statusCode).toBe(404);
    expect(refused.json().code).toBe('invite_not_found');
    expect(isMember('second')).toBe(false);
    expect((await preview(code)).statusCode).toBe(404);
  });

  it('do not count someone who was refused', async () => {
    const created = await create({ maxUses: 1 });
    const code = created.json().invites.find((i: { standing: boolean }) => !i.standing).code as string;
    testDb.insert(schema.bans).values({ spaceId: SPACE, userId: 'first', bannedBy: 'owner', createdAt: 1 }).run();
    as('first');
    expect((await join(code)).json().code).toBe('user_banned');
    as('second');
    expect((await join(code)).statusCode).toBe(200);
  });

  it('stop at their end date, in the preview as at the door', async () => {
    const created = await create({ expiresInSeconds: 3600 });
    const code = created.json().invites.find((i: { standing: boolean }) => !i.standing).code as string;
    expect((await preview(code)).statusCode).toBe(200);
    testDb.update(schema.spaceInvites).set({ expiresAt: Date.now() - 1 }).where(eq(schema.spaceInvites.code, code)).run();
    expect((await preview(code)).statusCode).toBe(404);
    as('first');
    expect((await join(code)).statusCode).toBe(404);
    as('owner');
    expect((await list()).json().invites.map((i: { code: string }) => i.code)).toEqual([STANDING]);
  });

  it('stop at once when revoked, the standing one too, and a new standing one replaces it', async () => {
    expect((await revoke(STANDING)).statusCode).toBe(200);
    as('first');
    expect((await join(STANDING)).statusCode).toBe(404);
    expect((await preview(STANDING)).statusCode).toBe(404);
    as('owner');
    const fresh = await app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/invite` });
    expect(fresh.json().inviteCode).not.toBe(STANDING);
    as('first');
    expect((await join(fresh.json().inviteCode)).statusCode).toBe(200);
  });

  it('cannot be revoked through another space', async () => {
    testDb.insert(schema.spaces).values({ id: 'other', name: 'Other', ownerId: 'first', inviteCode: 'other-code', visibility: 'public', createdAt: 1 }).run();
    as('first');
    const res = await app.inject({ method: 'DELETE', url: `/api/spaces/other/invites/${STANDING}` });
    expect(res.statusCode).toBe(404);
    as('second');
    expect((await join(STANDING)).statusCode).toBe(200);
  });

  it('are not unlimited in number', async () => {
    for (let i = 0; i < 49; i++) await create();
    const res = await create();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('invite_limit_reached');
  });

  it('say so in the audit log', async () => {
    await create();
    await revoke(STANDING);
    const actions = testDb.select().from(schema.spaceAuditLog).all().map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['invite_create', 'invite_revoke']));
  });
});

describe('removing someone', () => {
  const kick = (payload?: object) => app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/members/troll`, ...(payload ? { payload } : {}) });
  const ban = (payload: object = {}) => app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/bans`, payload: { userId: 'troll', ...payload } });
  const auditOf = (action: string) => testDb.select().from(schema.spaceAuditLog).all().filter((row) => row.action === action);
  const post = (id: string, userId: string, createdAt: number) => {
    testDb.insert(schema.messages).values({ id, channelId: 'general', userId, content: 'x', createdAt }).run();
  };
  const messages = () => testDb.select().from(schema.messages).all().map((row) => row.id).sort();

  it('keeps the reason for a kick in the audit log, and works without one', async () => {
    expect((await kick({ reason: '  spam  ' })).statusCode).toBe(200);
    expect(auditOf('member_kick')[0]!.reason).toBe('spam');
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: 'troll', joinedAt: 1 }).run();
    expect((await kick()).statusCode).toBe(200);
    expect(auditOf('member_kick')[1]!.reason).toBeNull();
  });

  it('refuses a reason longer than the limit, and removes nobody', async () => {
    const res = await kick({ reason: 'x'.repeat(513) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('moderation_reason_too_long');
    expect(isMember('troll')).toBe(true);
    expect((await ban({ reason: 'x'.repeat(513) })).statusCode).toBe(400);
    expect(isMember('troll')).toBe(true);
  });

  it('keeps the person\'s messages when a ban does not ask otherwise', async () => {
    post('m1', 'troll', Date.now());
    expect((await ban({ reason: 'spam' })).statusCode).toBe(200);
    expect(messages()).toEqual(['m1']);
    expect(sendToChannel).not.toHaveBeenCalled();
  });

  it('takes their recent messages with it when asked, and nothing older, and nobody else\'s', async () => {
    const now = Date.now();
    post('recent', 'troll', now - 60_000);
    post('old', 'troll', now - 2 * 3600_000);
    post('other', 'member', now - 60_000);
    expect((await ban({ deleteMessagesSeconds: 3600 })).statusCode).toBe(200);
    expect(messages()).toEqual(['old', 'other']);
    expect(sendToChannel).toHaveBeenCalledWith(SPACE, 'general', { type: 'messages_deleted', messageIds: ['recent'], channelId: 'general' });
    const [entry] = auditOf('messages_bulk_delete');
    expect(entry!.targetId).toBe('troll');
    expect(entry!.changes).toContain('"1"');
  });

  it('takes only the offered time spans, and bans nobody on a wrong one', async () => {
    const res = await ban({ deleteMessagesSeconds: 999 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ban_delete_window_invalid');
    expect(isMember('troll')).toBe(true);
  });

  it('takes nothing with a ban the person may not make', async () => {
    post('m1', 'troll', Date.now());
    as('member');
    expect((await ban({ deleteMessagesSeconds: 86400 })).statusCode).toBe(403);
    expect(messages()).toEqual(['m1']);
  });
});
