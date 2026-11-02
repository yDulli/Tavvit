import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { POLL_LIMITS, pollClosed, type PollInfo } from '@backspace/shared/src/polls.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Asking, answering and ending: what each may do, and that one reader's answers stay theirs.

setWorkerId(25);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ to: string; args: unknown[] }> }));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      sent.push({ to: String(name), args });
    },
  }),
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const OWNER = 'user-owner';
const ASKER = 'user-asker';
const VOTER = 'user-voter';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const READONLY = 'channel-readonly';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { pollRoutes } = await import('./polls.js');
const { messageRoutes } = await import('./messages.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  for (const id of [OWNER, ASKER, VOTER, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  for (const id of [CHANNEL, READONLY]) {
    testDb.insert(schema.channels).values({ id, spaceId: SPACE, name: id, type: 'text', createdAt: 1 }).run();
  }
  for (const id of [OWNER, ASKER, VOTER]) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  }
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), position: 0, createdAt: 1 }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: READONLY, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.SEND_MESSAGES),
  }).run();
  app = Fastify();
  await app.register(pollRoutes);
  await app.register(messageRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const ask = (userId: string, payload: Record<string, unknown>, channelId = CHANNEL) => app.inject({
  method: 'POST', url: `/api/channels/${channelId}/polls`, headers: headers(userId), payload,
});
const vote = (messageId: string, userId: string, optionIds: unknown) => app.inject({
  method: 'PUT', url: `/api/messages/${messageId}/poll/votes`, headers: headers(userId), payload: { optionIds },
});

async function askedPoll(extra: Record<string, unknown> = {}): Promise<{ id: string; options: PollInfo['options'] }> {
  const res = await ask(ASKER, { question: 'Pizza or pasta?', options: ['Pizza', 'Pasta', 'Both'], ...extra });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  return { id: body.id, options: body.poll.options };
}

describe('asking', () => {
  it('is a message whose content is the question, for those who may write', async () => {
    const res = await ask(ASKER, { question: '  Pizza or pasta? ', options: [' Pizza ', 'Pasta'], durationHours: 24 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.content).toBe('Pizza or pasta?');
    expect(body.poll.options.map((o: { label: string }) => o.label)).toEqual(['Pizza', 'Pasta']);
    expect(body.poll.endsAt).toBeGreaterThan(Date.now());
    expect(body.poll.voters).toBe(0);
    expect(sent.some((entry) => entry.to === 'sendToChannel')).toBe(true);

    expect((await ask(OUTSIDER, { question: 'Hm?', options: ['a', 'b'] })).statusCode).toBe(403);
    expect((await ask(ASKER, { question: 'Hm?', options: ['a', 'b'] }, READONLY)).statusCode).toBe(403);
  });

  it('refuses what is not a poll', async () => {
    const refused = async (payload: Record<string, unknown>) => (await ask(ASKER, payload)).json().code;
    expect(await refused({ question: '', options: ['a', 'b'] })).toBe('validation_failed');
    expect(await refused({ question: 'x'.repeat(POLL_LIMITS.QUESTION_MAX_LENGTH + 1), options: ['a', 'b'] })).toBe('validation_failed');
    expect(await refused({ question: 'Hm?', options: ['only one'] })).toBe('validation_failed');
    expect(await refused({ question: 'Hm?', options: Array.from({ length: POLL_LIMITS.OPTIONS_MAX + 1 }, (_, i) => `o${i}`) })).toBe('validation_failed');
    expect(await refused({ question: 'Hm?', options: ['same', 'SAME'] })).toBe('validation_failed');
    expect(await refused({ question: 'Hm?', options: ['a', ''] })).toBe('validation_failed');
    expect(await refused({ question: 'Hm?', options: ['a', 'b'], durationHours: 2 })).toBe('validation_failed');
  });

  it('holds a mass mention in the question to the right to send one', async () => {
    expect((await ask(ASKER, { question: '@everyone pizza?', options: ['a', 'b'] })).json()).toMatchObject({
      code: 'missing_permission', details: { permission: 'MENTION_EVERYONE' },
    });
  });

  it('lets the space\'s word filter read the answers too', async () => {
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, blockedWords: '["forbidden"]', updatedAt: 1 }).run();
    expect((await ask(ASKER, { question: 'Fine question', options: ['fine', 'forbidden'] })).statusCode).toBe(403);
  });

  it('does not change under the votes already cast', async () => {
    const { id } = await askedPoll();
    const edit = await app.inject({ method: 'PATCH', url: `/api/messages/${id}`, headers: headers(ASKER), payload: { content: 'Something else?' } });
    expect(edit.json().code).toBe('poll_not_editable');
  });
});

describe('answering', () => {
  it('counts people, and keeps one answer for a single-choice poll', async () => {
    const { id, options } = await askedPoll();
    const first = await vote(id, VOTER, [options[0]!.id]);
    expect(first.statusCode).toBe(200);
    expect(first.json().myVotes).toEqual([options[0]!.id]);

    const changed = await vote(id, VOTER, [options[1]!.id]);
    expect(changed.json().myVotes).toEqual([options[1]!.id]);
    expect(changed.json().voters).toBe(1);
    expect(changed.json().options.map((o: { votes: number }) => o.votes)).toEqual([0, 1, 0]);

    expect((await vote(id, VOTER, [options[0]!.id, options[1]!.id])).json().code).toBe('validation_failed');
    const back = await vote(id, VOTER, []);
    expect(back.json().voters).toBe(0);
  });

  it('takes several on a multiple-choice poll, and still counts one person', async () => {
    const { id, options } = await askedPoll({ multiple: true });
    const res = await vote(id, VOTER, [options[0]!.id, options[2]!.id]);
    expect(res.json().voters).toBe(1);
    expect(res.json().options.map((o: { votes: number }) => o.votes)).toEqual([1, 0, 1]);
  });

  it('tells the channel the count and only the voter their own answers', async () => {
    const { id, options } = await askedPoll();
    sent.length = 0;
    await vote(id, VOTER, [options[0]!.id]);
    const toChannel = sent.find((entry) => entry.to === 'sendToChannel');
    const toVoter = sent.find((entry) => entry.to === 'sendToUser');
    const channelEvent = toChannel?.args[2] as { type: string; poll: PollInfo };
    const voterEvent = toVoter?.args[1] as { type: string; poll: PollInfo };
    expect(channelEvent.type).toBe('poll_updated');
    expect(channelEvent.poll.myVotes).toBeUndefined();
    expect(toVoter?.args[0]).toBe(VOTER);
    expect(voterEvent.poll.myVotes).toEqual([options[0]!.id]);
  });

  it('shows a reader their own answers in the history, and nobody else\'s', async () => {
    const { id, options } = await askedPoll();
    await vote(id, VOTER, [options[1]!.id]);
    const history = async (userId: string) => {
      const res = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/messages`, headers: headers(userId) });
      return (res.json() as Array<{ id: string; poll?: PollInfo }>).find((m) => m.id === id)?.poll;
    };
    expect((await history(VOTER))?.myVotes).toEqual([options[1]!.id]);
    expect((await history(ASKER))?.myVotes).toEqual([]);
    expect((await history(ASKER))?.voters).toBe(1);
  });

  it('refuses an outsider, an answer from another poll, and a timed out member', async () => {
    const { id, options } = await askedPoll();
    const other = await askedPoll({ question: 'Tea or coffee?', options: ['Tea', 'Coffee'] });
    expect((await vote(id, OUTSIDER, [options[0]!.id])).statusCode).toBe(403);
    expect((await vote(id, VOTER, [other.options[0]!.id])).json().code).toBe('validation_failed');
    expect((await vote(id, VOTER, 'nope')).json().code).toBe('validation_failed');
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 }).where(eq(schema.spaceMembers.userId, VOTER)).run();
    expect((await vote(id, VOTER, [options[0]!.id])).json().code).toBe('member_timed_out');
  });

  it('is open in a channel closed to writing, like a reaction', async () => {
    testDb.insert(schema.messages).values({ id: 'ro-poll', channelId: READONLY, userId: OWNER, content: 'Read only?', createdAt: 1 }).run();
    testDb.insert(schema.polls).values({ messageId: 'ro-poll', createdAt: 1 }).run();
    testDb.insert(schema.pollOptions).values({ id: 'ro-a', messageId: 'ro-poll', position: 0, label: 'Yes' }).run();
    expect((await vote('ro-poll', VOTER, ['ro-a'])).statusCode).toBe(200);
  });
});

describe('ending', () => {
  const end = (id: string, userId: string) => app.inject({ method: 'POST', url: `/api/messages/${id}/poll/end`, headers: headers(userId) });

  it('is for its author or someone who may manage messages, and stops the voting', async () => {
    const { id, options } = await askedPoll();
    expect((await end(id, VOTER)).json()).toMatchObject({ code: 'missing_permission' });
    const ended = await end(id, ASKER);
    expect(ended.statusCode).toBe(200);
    expect(ended.json().endedAt).toBeGreaterThan(0);
    const late = await vote(id, VOTER, [options[0]!.id]);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('poll_ended');
  });

  it('happens by itself when the time is up', async () => {
    const { id, options } = await askedPoll({ durationHours: 1 });
    testDb.update(schema.polls).set({ endsAt: Date.now() - 1 }).where(eq(schema.polls.messageId, id)).run();
    expect((await vote(id, VOTER, [options[0]!.id])).json().code).toBe('poll_ended');
    expect(pollClosed({ endsAt: 10, endedAt: null }, 11)).toBe(true);
    expect(pollClosed({ endsAt: null, endedAt: null }, 11)).toBe(false);
  });
});

describe('who chose what', () => {
  const voters = (id: string, optionId: string, userId: string) => app.inject({
    method: 'GET', url: `/api/messages/${id}/poll/voters?optionId=${optionId}`, headers: headers(userId),
  });

  it('is open to the channel and closed to everyone else, with no account details', async () => {
    const { id, options } = await askedPoll();
    await vote(id, VOTER, [options[0]!.id]);
    const res = await voters(id, options[0]!.id, ASKER);
    expect(res.json().voters.map((u: { id: string }) => u.id)).toEqual([VOTER]);
    expect(res.body).not.toContain('passwordHash');
    expect((await voters(id, options[0]!.id, OUTSIDER)).statusCode).toBe(403);
  });
});
