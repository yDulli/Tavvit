import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MentionsResponse } from '@backspace/shared';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';

setWorkerId(7);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'reader';

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

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const GENERAL = 'general';
const SECRET = 'secret';
const ELSEWHERE = 'elsewhere';
const ROLE = 'role-crew';
const now = 1_700_000_000_000;
let nextId = 100_000;

function post(channelId: string, userId: string, content: string, type: 'user' | 'system' = 'user'): string {
  const id = String(nextId++);
  testDb.insert(schema.messages).values({ id, channelId, userId, content, type, createdAt: now + nextId }).run();
  return id;
}

let app: FastifyInstance;

beforeEach(async () => {
  currentUserId = 'reader';
  nextId = 100_000;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });

  for (const id of ['reader', 'author', 'stranger']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: now }).run();
  }
  testDb.insert(schema.spaces).values([
    { id: SPACE, name: 'Space', ownerId: 'author', inviteCode: 'c1', visibility: 'private', createdAt: now },
    { id: OTHER_SPACE, name: 'Other', ownerId: 'stranger', inviteCode: 'c2', visibility: 'private', createdAt: now },
  ]).run();
  testDb.insert(schema.spaceMembers).values([
    { spaceId: SPACE, userId: 'reader', joinedAt: now },
    { spaceId: SPACE, userId: 'author', joinedAt: now },
    { spaceId: OTHER_SPACE, userId: 'stranger', joinedAt: now },
  ]).run();
  const readable = permissionsToString(PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY | PermissionBits.SEND_MESSAGES);
  testDb.insert(schema.roles).values([
    { id: SPACE, spaceId: SPACE, name: '@everyone', position: 0, permissions: readable, createdAt: now },
    { id: ROLE, spaceId: SPACE, name: 'crew', position: 1, permissions: '0', createdAt: now },
    { id: OTHER_SPACE, spaceId: OTHER_SPACE, name: '@everyone', position: 0, permissions: readable, createdAt: now },
  ]).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: 'reader', roleId: ROLE }).run();
  testDb.insert(schema.channels).values([
    { id: GENERAL, spaceId: SPACE, name: 'general', type: 'text', position: 0, createdAt: now },
    { id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', position: 1, createdAt: now },
    { id: ELSEWHERE, spaceId: OTHER_SPACE, name: 'elsewhere', type: 'text', position: 0, createdAt: now },
  ]).run();
  // The reader cannot see #secret.
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();

  const { inboxRoutes } = await import('./inbox.js');
  app = Fastify();
  await app.register(inboxRoutes);
});

async function mentions(query = ''): Promise<MentionsResponse> {
  const res = await app.inject({ method: 'GET', url: `/api/users/@me/mentions${query}` });
  expect(res.statusCode).toBe(200);
  return res.json<MentionsResponse>();
}

describe('GET /api/users/@me/mentions', () => {
  it('finds direct, role and everyone mentions, newest first, with how each reaches the reader', async () => {
    const direct = post(GENERAL, 'author', 'hey <@reader> look');
    const viaRole = post(GENERAL, 'author', '<@&role-crew> meeting at 9');
    const everyone = post(GENERAL, 'author', '@everyone hello');
    post(GENERAL, 'author', 'nothing for you here');
    const res = await mentions();
    expect(res.mentions.map((m) => [m.message.id, m.via, m.channelId, m.spaceId])).toEqual([
      [everyone, 'everyone', GENERAL, SPACE],
      [viaRole, 'role', GENERAL, SPACE],
      [direct, 'user', GENERAL, SPACE],
    ]);
    expect(res.mentions[0]!.message.user.id).toBe('author');
    expect(res.nextBefore).toBeNull();
  });

  it('names the people a message mentions, by what the space calls them', async () => {
    testDb.update(schema.spaceMembers).set({ nickname: 'Boss' }).where(eq(schema.spaceMembers.userId, 'author')).run();
    post(GENERAL, 'author', '<@reader> ask <@author>, not <@stranger> or <@nobody-here>');
    const [item] = (await mentions()).mentions;
    expect(item!.mentionedNames!['author']).toBe('Boss');
    expect(item!.mentionedNames!['reader']).toBeTruthy();
    // A token can carry any id: only the space's own people are named.
    expect(item!.mentionedNames!['stranger']).toBeUndefined();
    expect(item!.mentionedNames!['nobody-here']).toBeUndefined();
  });

  it('leaves out what the reader may not see or did not get: hidden channels, other spaces, their own words, code, system rows, roles they lack', async () => {
    post(SECRET, 'author', '<@reader> in a channel you cannot read');
    post(ELSEWHERE, 'stranger', '<@reader> in a space you are not in');
    post(GENERAL, 'reader', 'note to self <@reader>');
    post(GENERAL, 'author', 'quoting `<@reader>` in code');
    post(GENERAL, 'author', '<@reader> poked', 'system');
    post(GENERAL, 'author', '<@&someone-else-role> not yours');
    expect((await mentions()).mentions).toEqual([]);
  });

  it('pages with nextBefore', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => post(GENERAL, 'author', `<@reader> number ${i}`));
    const first = await mentions('?limit=2');
    expect(first.mentions.map((m) => m.message.id)).toEqual([ids[4], ids[3]]);
    expect(first.nextBefore).toBe(ids[3]);
    const second = await mentions(`?limit=2&before=${first.nextBefore}`);
    expect(second.mentions.map((m) => m.message.id)).toEqual([ids[2], ids[1]]);
    const third = await mentions(`?limit=2&before=${second.nextBefore}`);
    expect(third.mentions.map((m) => m.message.id)).toEqual([ids[0]]);
    expect(third.nextBefore).toBeNull();
  });

  it('answers an empty inbox for someone in no space, and refuses a malformed query', async () => {
    currentUserId = 'stranger';
    testDb.delete(schema.spaceMembers).run();
    expect(await mentions()).toEqual({ mentions: [], nextBefore: null });
    expect((await app.inject({ method: 'GET', url: '/api/users/@me/mentions?before=abc' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me/mentions?limit=0' })).statusCode).toBe(400);
  });
});
