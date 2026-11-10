import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId, generateSnowflake } from '../utils/snowflake.js';
import {
  PermissionBits,
  DEFAULT_EVERYONE_PERMISSIONS,
  permissionsToString,
} from '@backspace/shared/src/permissions.js';
import { MESSAGE_PAGING_HEADER, MESSAGE_PAGING_AFTER } from '@backspace/shared';

setWorkerId(3);

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

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToChannel: vi.fn(),
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    sendToRoom: vi.fn(),
    sendToAdmins: vi.fn(),
    getUserRoom: () => undefined,
    getRoom: () => undefined,
    getAllRooms: () => new Map(),
    getAllOnlineUserIds: () => [],
  },
}));

vi.mock('../utils/federationOutbox.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationOutbox.js')>('../utils/federationOutbox.js');
  return {
    ...actual,
    isFederationRelayEnabled: () => false,
    queueDmCloseRelay: vi.fn(),
    queueDmRelay: vi.fn(),
    queueOutboxEvent: vi.fn(),
    queueReadStateRelay: vi.fn(),
    sendTypingRelay: vi.fn(),
    appendMutationLog: vi.fn(),
  };
});

vi.mock('../utils/federationAuth.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/federationAuth.js')>();
  return { ...actual, getOurOrigin: () => 'https://local.test' };
});

vi.mock('../utils/embedResolver.js', async (importActual) => {
  const actual = await importActual<typeof import('../utils/embedResolver.js')>();
  return {
    ...actual,
    resolveEmbeds: vi.fn(async () => {}),
    reResolveEmbeds: vi.fn(async () => {}),
  };
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

const NOW = 1_700_000_000_000;
const SPACE = 'space-1';
const GENERAL = 'chan-general';
const SECRET = 'chan-secret';
const DM = 'dm-1';
const OTHER_DM = 'dm-2';

function seedUser(id: string, homeUserId: string | null = null, homeInstance: string | null = null): void {
  testDb.insert(schema.users).values({
    id,
    username: id,
    displayName: null,
    passwordHash: 'x',
    status: 'offline',
    isAdmin: 0,
    isDeleted: 0,
    homeInstance,
    homeUserId,
    createdAt: NOW,
  }).run();
}

function seedSpaceWithChannels(): void {
  testDb.insert(schema.spaces).values({
    id: SPACE,
    name: SPACE,
    ownerId: 'owner',
    inviteCode: 'invite-1',
    visibility: 'private',
    createdAt: NOW,
  }).run();
  testDb.insert(schema.roles).values({
    id: SPACE,
    spaceId: SPACE,
    name: '@everyone',
    permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS),
    createdAt: NOW,
  }).run();
  for (const userId of ['reader', 'remote-author']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId, joinedAt: NOW }).run();
  }
  for (const channelId of [GENERAL, SECRET]) {
    testDb.insert(schema.channels).values({
      id: channelId,
      spaceId: SPACE,
      name: channelId,
      type: 'text',
      position: 0,
      categoryId: null,
      createdAt: NOW,
    }).run();
  }
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET,
    targetType: 'role',
    targetId: SPACE,
    allow: '0',
    deny: permissionsToString(PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY),
  }).run();
}

function seedDm(id: string, memberIds: string[]): void {
  testDb.insert(schema.dmChannels).values({
    id,
    ownerId: null,
    federatedId: null,
    createdAt: NOW,
    metadataUpdatedAt: 0,
  }).run();
  for (const userId of memberIds) {
    testDb.insert(schema.dmMembers).values({ dmChannelId: id, userId, closed: 0 }).run();
  }
}

/** Channel messages with ascending ids; `createdAt` defaults to one per millisecond. */
function seedChannelMessages(channelId: string, count: number, createdAt?: (i: number) => number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = generateSnowflake();
    testDb.insert(schema.messages).values({
      id,
      channelId,
      userId: i % 2 === 0 ? 'reader' : 'remote-author',
      replyToId: null,
      content: `channel message ${i}`,
      createdAt: createdAt ? createdAt(i) : NOW + i,
    }).run();
    ids.push(id);
  }
  return ids;
}

function seedDmMessages(dmChannelId: string, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = generateSnowflake();
    testDb.insert(schema.dmMessages).values({
      id,
      dmChannelId,
      userId: i % 2 === 0 ? 'reader' : 'remote-author',
      replyToId: null,
      content: `dm message ${i}`,
      type: 'user',
      createdAt: NOW + i,
    }).run();
    ids.push(id);
  }
  return ids;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { messageRoutes } = await import('./messages.js');
  const { dmRoutes } = await import('./dm.js');
  await app.register(messageRoutes);
  await app.register(dmRoutes);
  await app.ready();
  return app;
}

interface PageMessage {
  id: string;
  content: string;
  user: { id: string; homeInstance: string | null };
  replyTo: { id: string } | null;
  reactions: { emoji: string }[];
  attachments: { originalName: string }[];
}

async function getPage(
  app: FastifyInstance,
  url: string,
): Promise<{ status: number; ids: string[]; body: PageMessage[] | { code?: string }; paging: string | undefined }> {
  const res = await app.inject({ method: 'GET', url });
  const body = JSON.parse(res.body) as PageMessage[] | { code?: string };
  const header = res.headers[MESSAGE_PAGING_HEADER.toLowerCase()];
  return {
    status: res.statusCode,
    ids: Array.isArray(body) ? body.map(m => m.id) : [],
    body,
    paging: typeof header === 'string' ? header : undefined,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });

  seedUser('owner');
  seedUser('reader');
  // A replicated identity, so hydration is exercised against a federated user row.
  seedUser('remote-author', 'remote-user-1', 'https://remote.test');
  seedUser('outsider');
  seedSpaceWithChannels();
  seedDm(DM, ['reader', 'remote-author']);
  seedDm(OTHER_DM, ['remote-author', 'outsider']);

  currentUserId = 'reader';
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('GET /api/channels/:id/messages with after', () => {
  it('returns the messages immediately after the cursor, oldest first, and marks the page', async () => {
    const ids = seedChannelMessages(GENERAL, 10);

    const page = await getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[2]}&limit=3`);

    expect(page.status).toBe(200);
    expect(page.ids).toEqual([ids[3], ids[4], ids[5]]);
    expect(page.paging).toBe(MESSAGE_PAGING_AFTER);
  });

  it('returns a short page near the end and an empty marked page at the end', async () => {
    const ids = seedChannelMessages(GENERAL, 10);

    const nearEnd = await getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[7]}`);
    expect(nearEnd.ids).toEqual([ids[8], ids[9]]);
    expect(nearEnd.paging).toBe(MESSAGE_PAGING_AFTER);

    const atEnd = await getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[9]}`);
    expect(atEnd.status).toBe(200);
    expect(atEnd.ids).toEqual([]);
    expect(atEnd.paging).toBe(MESSAGE_PAGING_AFTER);
  });

  it('respects the limit and its cap', async () => {
    const ids = seedChannelMessages(GENERAL, 120);

    const one = await getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[0]}&limit=1`);
    expect(one.ids).toEqual([ids[1]]);

    const defaulted = await getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[0]}`);
    expect(defaulted.ids).toEqual(ids.slice(1, 51));

    const capped = await getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[0]}&limit=500`);
    expect(capped.ids).toEqual(ids.slice(1, 101));
  });

  it('walks a run of messages sharing one millisecond without skipping or repeating any', async () => {
    const ids = seedChannelMessages(GENERAL, 7, () => NOW);

    const seen: string[] = [];
    let cursor = ids[0]!;
    for (let guard = 0; guard < 10; guard++) {
      const page = await getPage(app, `/api/channels/${GENERAL}/messages?after=${cursor}&limit=2`);
      if (page.ids.length === 0) break;
      seen.push(...page.ids);
      cursor = page.ids[page.ids.length - 1]!;
    }

    expect(seen).toEqual(ids.slice(1));
  });

  it('hydrates authors, replies, reactions and attachments as the backward page does', async () => {
    const ids = seedChannelMessages(GENERAL, 3);
    const replyId = generateSnowflake();
    testDb.insert(schema.messages).values({
      id: replyId,
      channelId: GENERAL,
      userId: 'remote-author',
      replyToId: ids[0]!,
      content: 'a reply',
      createdAt: NOW + 10,
    }).run();
    testDb.insert(schema.reactions).values({
      id: generateSnowflake(), messageId: replyId, userId: 'reader', emoji: 'wave', createdAt: NOW + 11,
    }).run();
    testDb.insert(schema.attachments).values({
      id: generateSnowflake(),
      messageId: replyId,
      uploaderId: 'remote-author',
      filename: 'stored.png',
      originalName: 'picture.png',
      mimetype: 'image/png',
      size: 10,
      createdAt: NOW + 10,
    }).run();

    const forward = await getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[2]}`);
    const backward = await getPage(app, `/api/channels/${GENERAL}/messages?before=${generateSnowflake()}&limit=1`);

    expect(forward.ids).toEqual([replyId]);
    expect(forward.body).toEqual(backward.body);
    const [message] = forward.body as PageMessage[];
    expect(message!.user.id).toBe('remote-author');
    expect(message!.user.homeInstance).toBe('https://remote.test');
    expect(message!.replyTo?.id).toBe(ids[0]);
    expect(message!.reactions.map(r => r.emoji)).toEqual(['wave']);
    expect(message!.attachments.map(a => a.originalName)).toEqual(['picture.png']);
  });

  it('rejects before and after together', async () => {
    const ids = seedChannelMessages(GENERAL, 3);

    const page = await getPage(app, `/api/channels/${GENERAL}/messages?before=${ids[2]}&after=${ids[0]}`);

    expect(page.status).toBe(400);
    expect((page.body as { code?: string }).code).toBe('paging_cursor_conflict');
    expect(page.paging).toBeUndefined();
  });

  it('refuses a repeated cursor instead of reading it as absent', async () => {
    const ids = seedChannelMessages(GENERAL, 3);

    for (const query of [`after=${ids[0]}&after=${ids[1]}`, `before=${ids[2]}&before=${ids[1]}`]) {
      const page = await getPage(app, `/api/channels/${GENERAL}/messages?${query}`);
      expect(page.status).toBe(400);
      expect((page.body as { code?: string }).code).toBe('validation_failed');
      expect(page.paging).toBeUndefined();
    }
  });

  it('applies the same permission check as a backward page', async () => {
    const ids = seedChannelMessages(SECRET, 3);

    for (const query of [`after=${ids[0]}`, `before=${ids[2]}`, '']) {
      const page = await getPage(app, `/api/channels/${SECRET}/messages?${query}`);
      expect(page.status).toBe(403);
      expect(page.paging).toBeUndefined();
    }

    const missing = await getPage(app, `/api/channels/no-such-channel/messages?after=${ids[0]}`);
    expect(missing.status).toBe(404);
    expect(missing.paging).toBeUndefined();
  });

  it('does not mark backward or newest pages, and reads an empty after as absent', async () => {
    const ids = seedChannelMessages(GENERAL, 6);

    const before = await getPage(app, `/api/channels/${GENERAL}/messages?before=${ids[4]}&limit=2`);
    expect(before.ids).toEqual([ids[2], ids[3]]);
    expect(before.paging).toBeUndefined();

    const newest = await getPage(app, `/api/channels/${GENERAL}/messages?limit=2`);
    expect(newest.ids).toEqual([ids[4], ids[5]]);
    expect(newest.paging).toBeUndefined();

    const emptyAfter = await getPage(app, `/api/channels/${GENERAL}/messages?after=&limit=2`);
    expect(emptyAfter.ids).toEqual([ids[4], ids[5]]);
    expect(emptyAfter.paging).toBeUndefined();
  });
});

describe('GET /api/dm/:id/messages with after', () => {
  it('returns the next page oldest first and marks it', async () => {
    const ids = seedDmMessages(DM, 8);

    const page = await getPage(app, `/api/dm/${DM}/messages?after=${ids[1]}&limit=4`);

    expect(page.status).toBe(200);
    expect(page.ids).toEqual([ids[2], ids[3], ids[4], ids[5]]);
    expect(page.paging).toBe(MESSAGE_PAGING_AFTER);
  });

  it('returns a short page near the end and an empty marked page at the end', async () => {
    const ids = seedDmMessages(DM, 8);

    const nearEnd = await getPage(app, `/api/dm/${DM}/messages?after=${ids[5]}&limit=4`);
    expect(nearEnd.ids).toEqual([ids[6], ids[7]]);

    const atEnd = await getPage(app, `/api/dm/${DM}/messages?after=${ids[7]}`);
    expect(atEnd.status).toBe(200);
    expect(atEnd.ids).toEqual([]);
    expect(atEnd.paging).toBe(MESSAGE_PAGING_AFTER);
  });

  it('hydrates a replicated author and a reply the same way as a backward page', async () => {
    const ids = seedDmMessages(DM, 2);
    const replyId = generateSnowflake();
    testDb.insert(schema.dmMessages).values({
      id: replyId,
      dmChannelId: DM,
      userId: 'remote-author',
      replyToId: ids[0]!,
      content: 'a dm reply',
      type: 'user',
      createdAt: NOW + 10,
    }).run();
    testDb.insert(schema.dmReactions).values({
      id: generateSnowflake(), dmMessageId: replyId, userId: 'reader', emoji: 'ok', createdAt: NOW + 11,
    }).run();

    const forward = await getPage(app, `/api/dm/${DM}/messages?after=${ids[1]}`);
    const backward = await getPage(app, `/api/dm/${DM}/messages?limit=1`);

    expect(forward.ids).toEqual([replyId]);
    expect(forward.body).toEqual(backward.body);
    const [message] = forward.body as PageMessage[];
    expect(message!.user.homeInstance).toBe('https://remote.test');
    expect(message!.replyTo?.id).toBe(ids[0]);
    expect(message!.reactions.map(r => r.emoji)).toEqual(['ok']);
  });

  it('pages a relayed message by its local id, not by the sender\'s createdAt', async () => {
    // A relayed message keeps the sender's createdAt but gets a local id on
    // arrival, so it can carry a later id than a message it predates.
    const [cursor, local] = seedDmMessages(DM, 2);
    const relayedId = generateSnowflake();
    testDb.insert(schema.dmMessages).values({
      id: relayedId,
      dmChannelId: DM,
      userId: 'remote-author',
      replyToId: null,
      content: 'delivered late',
      type: 'user',
      sourceInstance: 'https://remote.test',
      sourceMessageId: 'remote-msg-1',
      createdAt: NOW - 100,
    }).run();

    // The page holds the next ids after the cursor, returned oldest first.
    const both = await getPage(app, `/api/dm/${DM}/messages?after=${cursor}&limit=2`);
    expect(both.ids).toEqual([relayedId, local]);

    // Walking one row at a time, cut at the greatest id of each page, reaches both.
    const seen: string[] = [];
    let next = cursor!;
    for (let guard = 0; guard < 5; guard++) {
      const page = await getPage(app, `/api/dm/${DM}/messages?after=${next}&limit=1`);
      if (page.ids.length === 0) break;
      seen.push(...page.ids);
      next = page.ids.reduce((max, id) => (BigInt(id) > BigInt(max) ? id : max));
    }
    expect(seen).toEqual([local, relayedId]);
  });

  it('rejects before and after together', async () => {
    const ids = seedDmMessages(DM, 3);

    const page = await getPage(app, `/api/dm/${DM}/messages?before=${ids[2]}&after=${ids[0]}`);

    expect(page.status).toBe(400);
    expect((page.body as { code?: string }).code).toBe('paging_cursor_conflict');
  });

  it('refuses a non-member forward page exactly as a backward one', async () => {
    const ids = seedDmMessages(OTHER_DM, 3);

    for (const query of [`after=${ids[0]}`, `before=${ids[2]}`, '']) {
      const page = await getPage(app, `/api/dm/${OTHER_DM}/messages?${query}`);
      expect(page.status).toBe(403);
      expect((page.body as { code?: string }).code).toBe('not_dm_member');
      expect(page.paging).toBeUndefined();
    }
  });

  it('does not mark backward or newest pages', async () => {
    const ids = seedDmMessages(DM, 4);

    const before = await getPage(app, `/api/dm/${DM}/messages?before=${ids[3]}&limit=2`);
    expect(before.ids).toEqual([ids[1], ids[2]]);
    expect(before.paging).toBeUndefined();

    const newest = await getPage(app, `/api/dm/${DM}/messages`);
    expect(newest.ids).toEqual(ids);
    expect(newest.paging).toBeUndefined();
  });
});

// Ids are decimal text, and from 2031-07-22 a new one has 19 digits where today's have 18. Text
// compares character by character, so "9…" (18 digits) is not less than "1…" (19 digits): before
// 1.41.4 a page `before` a new message would have left every older one out, and a page `after` an
// old one every new one.
describe('pages across ids of different lengths', () => {
  const OLD = ['999999999999999997', '999999999999999998', '999999999999999999'];
  const NEW = ['1000000000000000000', '1000000000000000001', '1000000000000000002'];

  function seedAcrossTheChange(): void {
    [...OLD, ...NEW].forEach((id, at) => {
      testDb.insert(schema.messages).values({ id, channelId: GENERAL, userId: 'reader', replyToId: null, content: `message ${at}`, createdAt: NOW + at }).run();
      testDb.insert(schema.dmMessages).values({ id, dmChannelId: DM, userId: 'reader', replyToId: null, content: `message ${at}`, type: 'user', createdAt: NOW + at }).run();
    });
  }

  for (const [what, base] of [['a channel', `/api/channels/${GENERAL}/messages`], ['a conversation', `/api/dm/${DM}/messages`]] as const) {
    it(`reads ${what} backward past the change`, async () => {
      seedAcrossTheChange();
      const page = await getPage(app, `${base}?before=${NEW[0]}`);
      expect(page.ids).toEqual(OLD);
      const two = await getPage(app, `${base}?before=${NEW[1]}&limit=2`);
      expect(two.ids).toEqual([OLD[2], NEW[0]]);
    });

    it(`reads ${what} forward past the change`, async () => {
      seedAcrossTheChange();
      const page = await getPage(app, `${base}?after=${OLD[2]}`);
      expect(page.ids).toEqual(NEW);
      const two = await getPage(app, `${base}?after=${OLD[1]}&limit=2`);
      expect(two.ids).toEqual([OLD[2], NEW[0]]);
    });

    it(`gives ${what}'s newest page in order`, async () => {
      seedAcrossTheChange();
      expect((await getPage(app, base)).ids).toEqual([...OLD, ...NEW]);
    });

    it(`loads the messages around one of ${what} on both sides of the change`, async () => {
      seedAcrossTheChange();
      const { searchRoutes } = await import('./search.js');
      const around = Fastify({ logger: false });
      await around.register(searchRoutes);
      await around.ready();
      const res = await around.inject({ method: 'GET', url: `${base}/around?messageId=${OLD[2]}&limit=4` });
      expect((JSON.parse(res.body) as PageMessage[]).map((message) => message.id)).toEqual([OLD[0], OLD[1], OLD[2], NEW[0], NEW[1]]);
      await around.close();
    });
  }

  it('reads a cursor that is no id as it always compared: past every id', async () => {
    const ids = seedChannelMessages(GENERAL, 4);
    // A client's own id for a message still on its way.
    const before = await getPage(app, `/api/channels/${GENERAL}/messages?before=temp_17&limit=2`);
    expect(before.ids).toEqual([ids[2], ids[3]]);
    const after = await getPage(app, `/api/channels/${GENERAL}/messages?after=temp_17`);
    expect(after.status).toBe(200);
    expect(after.ids).toEqual([]);
    expect(after.paging).toBe(MESSAGE_PAGING_AFTER);
    // Digits no id has (more than a 64-bit number holds) are past every id too.
    const huge = await getPage(app, `/api/channels/${GENERAL}/messages?before=${'9'.repeat(30)}&limit=2`);
    expect(huge.ids).toEqual([ids[2], ids[3]]);
  });
});

// A page of history is read off an index in its order and stopped at its end. Before 1.41.4
// every page read all of the channel's messages and sorted them (docs/systems/operations.md).
describe('how a page of history is read', () => {
  function plansOf(run: () => Promise<unknown>, table: string): Promise<string[]> {
    const sources: string[] = [];
    const prepare = sqlite.prepare.bind(sqlite);
    vi.spyOn(sqlite, 'prepare').mockImplementation((source: string) => {
      sources.push(source);
      return prepare(source);
    });
    return run().then(() => {
      vi.mocked(sqlite.prepare).mockRestore();
      return sources
        .filter((source) => new RegExp(`from "${table}"`, 'i').test(source) && /order by/i.test(source))
        .map((source) => {
          const params = Array.from({ length: (source.match(/\?/g) ?? []).length }, () => '1');
          return (sqlite.prepare(`EXPLAIN QUERY PLAN ${source}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join('\n');
        });
    });
  }

  it('takes the newest page and a page before a message from the history index, without sorting', async () => {
    const ids = seedChannelMessages(GENERAL, 60);
    for (const query of ['', `?before=${ids[40]}`]) {
      const plans = await plansOf(() => getPage(app, `/api/channels/${GENERAL}/messages${query}`), 'messages');
      expect(plans).toHaveLength(1);
      expect(plans[0]).toContain('idx_messages_channel_created (channel_id=?)');
      expect(plans[0]).not.toContain('TEMP B-TREE');
    }
  });

  it('takes a page after a message from the index of ids as numbers, without sorting', async () => {
    const ids = seedChannelMessages(GENERAL, 60);
    const plans = await plansOf(() => getPage(app, `/api/channels/${GENERAL}/messages?after=${ids[10]}`), 'messages');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toContain('idx_messages_channel_unread (channel_id=? AND <expr>>?)');
    expect(plans[0]).not.toContain('TEMP B-TREE');
  });

  it('does the same for a conversation', async () => {
    const ids = seedDmMessages(DM, 60);
    const newest = await plansOf(() => getPage(app, `/api/dm/${DM}/messages`), 'dm_messages');
    expect(newest[0]).toContain('idx_dm_messages_channel_created (dm_channel_id=?)');
    expect(newest[0]).not.toContain('TEMP B-TREE');
    const after = await plansOf(() => getPage(app, `/api/dm/${DM}/messages?after=${ids[10]}`), 'dm_messages');
    expect(after[0]).toContain('idx_dm_messages_channel_unread (dm_channel_id=? AND <expr>>?)');
    expect(after[0]).not.toContain('TEMP B-TREE');
  });
});
