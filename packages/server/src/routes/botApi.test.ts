import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { BOT_LIMITS, cleanCommand, cleanCommandInput } from '@backspace/shared/src/bots.js';
import { cardsFromDiscordEmbeds, cardsSummary, CARD_LIMITS, cleanCards } from '@backspace/shared/src/cards.js';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// What a program can do with a token beyond writing text: cards, files, reactions, moderation,
// commands that ask for things, and answering them. Each holds to what a person could do.

setWorkerId(35);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let tmpDir: string;

const { sent, connected } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; args: unknown[] }>,
  connected: new Set<string>(),
}));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'uploadDir') return tmpDir ?? target.uploadDir;
        if (prop === 'tusUploadDir') return tmpDir ? path.join(tmpDir, '.tus') : target.tusUploadDir;
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});

vi.mock('../utils/thumbnail.js', () => ({
  generateThumbnail: vi.fn().mockResolvedValue(null),
  isResizableImage: vi.fn().mockReturnValue(false),
  probeImageDimensions: vi.fn().mockResolvedValue(null),
  probeMediaMeta: vi.fn().mockResolvedValue(null),
  generateVideoThumbnail: vi.fn().mockResolvedValue(null),
  resizeProfileImage: vi.fn().mockResolvedValue(true),
  thumbFilename: (name: string) => `${name}_thumb.webp`,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      sent.push({ to: String(name), args });
      if (name === 'isUserConnected') return connected.has(String(args[0]));
      if (name === 'getUserSpaceEntries' || name === 'getAllOnlineUserIds') return [];
      if (name === 'getUserSpaces' || name === 'getRoomParticipants') return new Set();
      return undefined;
    },
  }),
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const CHANNEL = 'channel-1';
const SECRET = 'channel-secret';
const ELSEWHERE_CHANNEL = 'channel-elsewhere';

const USUAL = PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY | PermissionBits.SEND_MESSAGES;
const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });
const botHeaders = (token: string) => ({ authorization: `Bot ${token}` });

let routeModules: Array<(instance: FastifyInstance) => Promise<void>> = [];
let resetCommandLimit: () => void = () => undefined;

beforeAll(async () => {
  resetCommandLimit = (await import('./bots.js'))._resetCommandLimitForTests;
  routeModules = [
    (await import('./bots.js')).botRoutes,
    (await import('./botFiles.js')).botFileRoutes,
    (await import('./messages.js')).messageRoutes,
    (await import('./spaces.js')).spaceRoutes,
    (await import('./spaceModeration.js')).spaceModerationRoutes,
    (await import('./webhooks.js')).webhookRoutes,
    (await import('./accountStorage.js')).accountStorageRoutes,
  ];
}, 120_000);

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-botapi-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  connected.clear();
  resetCommandLimit();
  testDb.insert(schema.instanceSettings).values({ id: 1, botsEnabled: 1, updatedAt: 1 }).run();
  for (const id of [OWNER, MEMBER, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id.replace('-', '_'), passwordHash: 'x', isAdmin: 0, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: 'space-2', name: 'Other', ownerId: OUTSIDER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: ELSEWHERE_CHANNEL, spaceId: 'space-2', name: 'far', type: 'text', createdAt: 1 }).run();
  for (const id of [OWNER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(0n), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'space-2', spaceId: 'space-2', name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-person', spaceId: SPACE, name: 'Regular', position: 1, permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: MEMBER, roleId: 'role-person' }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();

  app = Fastify();
  for (const routes of routeModules) await app.register(routes);
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  sqlite.close();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A bot of the owner, in the space, with these rights on top of @everyone's none. */
async function botWith(permissions: bigint = USUAL, name = 'Helper') {
  const made = await app.inject({ method: 'POST', url: '/api/bots', headers: headers(OWNER), payload: { name } });
  expect(made.statusCode, made.body).toBe(201);
  const { bot, token } = made.json() as { bot: { id: string }; token: string };
  const added = await app.inject({
    method: 'POST',
    url: `/api/bots/${bot.id}/spaces/${SPACE}`,
    headers: headers(OWNER),
    payload: { permissions: permissionsToString(permissions) },
  });
  expect(added.statusCode, added.body).toBe(200);
  return { id: bot.id, token, auth: botHeaders(token) };
}

const post = (auth: Record<string, string>, payload: Record<string, unknown>, channel = CHANNEL) =>
  app.inject({ method: 'POST', url: `/api/channels/${channel}/messages`, headers: auth, payload });

const sentOf = (to: string) => sent.filter((entry) => entry.to === to);
const eventsOfType = (type: string) => sent.flatMap((entry) => entry.args).filter((arg) => typeof arg === 'object' && arg !== null && (arg as { type?: string }).type === type) as Array<Record<string, unknown>>;

function multipart(filename: string, body: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----tavvit-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const upload = (auth: Record<string, string>, filename = 'report.pdf', bytes = 64) => {
  const form = multipart(filename, Buffer.alloc(bytes, 7));
  return app.inject({ method: 'POST', url: '/api/bots/@me/files', headers: { ...auth, ...form.headers }, payload: form.payload });
};

describe('what a card may hold', () => {
  it('takes the fields it knows and lowers a colour', () => {
    expect(cleanCards([{ title: ' Build ', color: '#34C77B', fields: [{ name: 'Tests', value: '12', inline: true }], footer: 'CI', url: 'https://x.example/1' }])).toEqual({
      cards: [{ title: 'Build', color: '#34c77b', fields: [{ name: 'Tests', value: '12', inline: true }], footer: 'CI', url: 'https://x.example/1' }],
    });
  });

  it('leaves out what it does not know, above all a picture elsewhere', () => {
    expect(cleanCards([{ title: 'A', imageUrl: 'https://tracker.example/pixel.gif', image: { url: 'https://tracker.example/pixel.gif' } }])).toEqual({ cards: [{ title: 'A' }] });
  });

  it('names the first thing wrong', () => {
    const wrong: Array<[unknown, string]> = [
      ['not a list', 'cards'],
      [Array.from({ length: CARD_LIMITS.PER_MESSAGE + 1 }, () => ({ title: 'A' })), 'cards'],
      [[7], 'cards[0]'],
      [[{}], 'cards[0]'],
      [[{ color: '#34c77b' }], 'cards[0]'],
      [[{ title: 'x'.repeat(CARD_LIMITS.TITLE_MAX_LENGTH + 1) }], 'cards[0].title'],
      [[{ title: 'A', text: 'x'.repeat(CARD_LIMITS.TEXT_MAX_LENGTH + 1) }], 'cards[0].text'],
      [[{ title: 'A', color: 'red' }], 'cards[0].color'],
      [[{ title: 'A', url: 'javascript:alert(1)' }], 'cards[0].url'],
      [[{ title: 'A', url: 'data:text/html,x' }], 'cards[0].url'],
      [[{ title: 'A', fields: [{ name: 'only a name' }] }], 'cards[0].fields[0]'],
      [[{ title: 'A', fields: Array.from({ length: CARD_LIMITS.FIELDS_PER_CARD + 1 }, () => ({ name: 'n', value: 'v' })) }], 'cards[0].fields'],
      [[{ title: 'A', imageAttachmentId: 7 }], 'cards[0].imageAttachmentId'],
    ];
    for (const [given, field] of wrong) expect(cleanCards(given), field).toEqual({ field });
  });

  it('holds all the words of a message together to a limit', () => {
    const long = { text: 'x'.repeat(CARD_LIMITS.TEXT_MAX_LENGTH) };
    expect(cleanCards([long, long, long, long])).toEqual({ field: 'cards' });
    expect('cards' in cleanCards([long, long, long])).toBe(true);
  });

  it('is summed up by its title, else its text, else its first field', () => {
    expect(cardsSummary([{ title: 'T', text: 'x' }])).toBe('T');
    expect(cardsSummary([{ text: 'x' }])).toBe('x');
    expect(cardsSummary([{ fields: [{ name: 'F', value: 'v' }] }])).toBe('F');
    expect(cardsSummary([{ imageAttachmentId: 'a' }])).toBeNull();
  });

  it('takes Discord\'s embeds, without their pictures', () => {
    const cards = cardsFromDiscordEmbeds([{
      title: 'Deploy',
      description: 'Went fine',
      url: 'https://ci.example/9',
      color: 3_458_939,
      fields: [{ name: 'Env', value: 'prod', inline: true }],
      footer: { text: 'CI', icon_url: 'https://tracker.example/i.png' },
      image: { url: 'https://tracker.example/p.png' },
      thumbnail: { url: 'https://tracker.example/t.png' },
      author: { name: 'x', icon_url: 'https://tracker.example/a.png' },
    }]);
    expect(cleanCards(cards)).toEqual({
      cards: [{ title: 'Deploy', text: 'Went fine', url: 'https://ci.example/9', color: '#34c77b', fields: [{ name: 'Env', value: 'prod', inline: true }], footer: 'CI' }],
    });
  });
});

describe('a bot sending cards', () => {
  it('needs no text, and leaves a summary for everything that knows only words', async () => {
    const bot = await botWith();
    const res = await post(bot.auth, { cards: [{ title: 'Build passed', text: 'All green', color: '#34c77b' }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ content: 'Build passed', cards: [{ title: 'Build passed', text: 'All green', color: '#34c77b' }] });
    expect(eventsOfType('message_created')[0]).toMatchObject({ message: { cards: [{ title: 'Build passed' }] } });

    const history = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/messages`, headers: bot.auth });
    const messages = (history.json() as { messages?: unknown[] }).messages ?? (history.json() as unknown[]);
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ cards: [expect.objectContaining({ title: 'Build passed' })] })]));
  });

  it('keeps text beside them when it wrote some', async () => {
    const bot = await botWith();
    const res = await post(bot.auth, { content: 'Look', cards: [{ title: 'Build' }] });
    expect(res.json()).toMatchObject({ content: 'Look', cards: [{ title: 'Build' }] });
  });

  it('is not open to a person, whose words must not pass for the instance speaking', async () => {
    const res = await post(headers(MEMBER), { content: 'Hi', cards: [{ title: 'Official notice' }] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'cards_not_allowed' });
  });

  it('refuses what is wrong, naming it', async () => {
    const bot = await botWith();
    const res = await post(bot.auth, { cards: [{ title: 'A', url: 'javascript:alert(1)' }] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'cards_invalid', details: { field: 'cards[0].url' } });
  });

  it('alerts nobody from a card, whatever it says', async () => {
    const bot = await botWith();
    const res = await post(bot.auth, { cards: [{ title: 'Hey @everyone', text: `and <@${MEMBER}>`, fields: [{ name: '@here', value: 'x' }] }] });
    expect(res.statusCode, res.body).toBe(201);
    const message = res.json() as { mentionEveryone?: boolean; content: string; cards: Array<{ title: string; text: string; fields: Array<{ name: string }> }> };
    expect(message.mentionEveryone ?? false).toBe(false);
    for (const words of [message.content, message.cards[0]?.title, message.cards[0]?.text, message.cards[0]?.fields[0]?.name]) {
      expect(words).not.toMatch(/@everyone|@here|<@user/);
    }
  });

  it('meets the space\'s automatic rules with everything in it', async () => {
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, blockedWords: JSON.stringify(['forbidden']), updatedAt: 1 }).run();
    const bot = await botWith();
    const res = await post(bot.auth, { cards: [{ title: 'Fine', fields: [{ name: 'Note', value: 'a forbidden word' }] }] });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toMatch(/^automod/);
  });

  it('shows a picture only from the message\'s own files', async () => {
    const bot = await botWith(USUAL | PermissionBits.ATTACH_FILES);
    expect((await post(bot.auth, { cards: [{ title: 'A', imageAttachmentId: 'someone-elses' }] })).json()).toMatchObject({ code: 'cards_invalid', details: { field: 'imageAttachmentId' } });

    const file = (await upload(bot.auth, 'chart.png')).json() as { id: string };
    const res = await post(bot.auth, { attachments: [file.id], cards: [{ title: 'A', imageAttachmentId: file.id }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ cards: [{ imageAttachmentId: file.id }], attachments: [{ id: file.id }] });
  });

  it('can change them, or take them away', async () => {
    const bot = await botWith();
    const message = (await post(bot.auth, { cards: [{ title: 'First' }] })).json() as { id: string };

    const changed = await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: bot.auth, payload: { cards: [{ title: 'Second' }] } });
    expect(changed.json()).toMatchObject({ content: 'Second', cards: [{ title: 'Second' }] });

    const words = await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: bot.auth, payload: { content: 'Only words', cards: null } });
    expect(words.statusCode, words.body).toBe(200);
    expect(words.json().content).toBe('Only words');
    expect(words.json().cards).toBeUndefined();

    const nothing = await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: bot.auth, payload: { cards: null } });
    expect(nothing.statusCode).toBe(200);
    expect(nothing.json().content).toBe('Only words');
  });

  it('keeps words it wrote itself when the cards change', async () => {
    const bot = await botWith();
    const message = (await post(bot.auth, { content: 'My words', cards: [{ title: 'First' }] })).json() as { id: string };
    const changed = await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: bot.auth, payload: { cards: [{ title: 'Second' }] } });
    expect(changed.json()).toMatchObject({ content: 'My words', cards: [{ title: 'Second' }] });
  });

  it('cannot end up with nothing to show', async () => {
    const bot = await botWith();
    const message = (await post(bot.auth, { cards: [{ title: 'Only a card' }] })).json() as { id: string };
    const res = await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: bot.auth, payload: { cards: null } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'content_required' });
  });

  it('keeps cards through an edit of the words alone', async () => {
    const bot = await botWith();
    const message = (await post(bot.auth, { cards: [{ title: 'Card' }] })).json() as { id: string };
    const edited = await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: bot.auth, payload: { content: 'New words' } });
    expect(edited.json()).toMatchObject({ content: 'New words', cards: [{ title: 'Card' }] });
  });

  it('leaves a person\'s own edit as it was', async () => {
    const message = (await post(headers(MEMBER), { content: 'Mine' })).json() as { id: string };
    const withCards = await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: headers(MEMBER), payload: { content: 'x', cards: [{ title: 'Y' }] } });
    expect(withCards.statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: headers(MEMBER), payload: { content: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: headers(MEMBER), payload: { content: 'Edited' } })).json().content).toBe('Edited');
  });
});

describe('a webhook sending cards', () => {
  async function webhookAddress(): Promise<string> {
    const made = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/webhooks`, headers: headers(OWNER), payload: { name: 'CI' } });
    expect(made.statusCode, made.body).toBe(201);
    const { webhook, token } = made.json() as { webhook: { id: string }; token: string };
    return `/api/webhooks/${webhook.id}/${token}`;
  }
  const stored = () => testDb.select().from(schema.messages).all();

  it('posts them without any text', async () => {
    const res = await app.inject({ method: 'POST', url: await webhookAddress(), payload: { cards: [{ title: 'Deployed' }] } });
    expect(res.statusCode, res.body).toBe(201);
    expect(stored()[0]?.content).toBe('Deployed');
    expect(JSON.parse(stored()[0]?.cards ?? '[]')).toEqual([{ title: 'Deployed' }]);
  });

  it('takes Discord\'s form from a program that sends nothing else', async () => {
    const res = await app.inject({ method: 'POST', url: await webhookAddress(), payload: { content: 'New alert', embeds: [{ title: 'CPU high', color: 16711680, image: { url: 'https://tracker.example/p.png' } }] } });
    expect(res.statusCode, res.body).toBe(201);
    expect(stored()[0]?.content).toBe('New alert');
    expect(JSON.parse(stored()[0]?.cards ?? '[]')).toEqual([{ title: 'CPU high', color: '#ff0000' }]);
  });

  it('alerts nobody and holds no picture, having nothing to attach', async () => {
    const address = await webhookAddress();
    await app.inject({ method: 'POST', url: address, payload: { cards: [{ title: '@everyone look' }] } });
    expect(stored()[0]?.content).not.toMatch(/@everyone/);
    const picture = await app.inject({ method: 'POST', url: address, payload: { cards: [{ title: 'A', imageAttachmentId: 'x' }] } });
    expect(picture.json()).toMatchObject({ code: 'cards_invalid' });
  });

  it('still needs something to say', async () => {
    expect((await app.inject({ method: 'POST', url: await webhookAddress(), payload: {} })).statusCode).toBe(400);
  });
});

describe('a reaction by request', () => {
  const put = (auth: Record<string, string>, messageId: string, emoji: string) =>
    app.inject({ method: 'PUT', url: `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, headers: auth });

  it('goes on and comes off, and the channel hears of it', async () => {
    const bot = await botWith(USUAL | PermissionBits.ADD_REACTIONS);
    const message = (await post(headers(MEMBER), { content: 'Hi' })).json() as { id: string };
    expect((await put(bot.auth, message.id, '👍')).statusCode).toBe(200);
    expect(eventsOfType('reaction_added')[0]).toMatchObject({ messageId: message.id, reaction: { emoji: '👍', userId: bot.id } });

    // Twice is once.
    await put(bot.auth, message.id, '👍');
    expect(eventsOfType('reaction_added')).toHaveLength(1);

    const off = await app.inject({ method: 'DELETE', url: `/api/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, headers: bot.auth });
    expect(off.statusCode).toBe(200);
    expect(eventsOfType('reaction_removed')).toHaveLength(1);
  });

  it('needs the right, and to see the channel', async () => {
    const without = await botWith(USUAL, 'No reactions');
    const message = (await post(headers(MEMBER), { content: 'Hi' })).json() as { id: string };
    expect((await put(without.auth, message.id, '👍')).json()).toMatchObject({ code: 'missing_permission' });

    testDb.insert(schema.messages).values({ id: 'hidden', channelId: SECRET, userId: OWNER, content: 'Secret', createdAt: 1 }).run();
    const blind = await botWith(PermissionBits.ADD_REACTIONS, 'Blind');
    expect((await put(blind.auth, 'hidden', '👍')).statusCode).toBe(403);
  });

  it('knows no message outside its spaces, or an emoji that is an essay', async () => {
    const bot = await botWith(USUAL | PermissionBits.ADD_REACTIONS);
    testDb.insert(schema.messages).values({ id: 'far', channelId: ELSEWHERE_CHANNEL, userId: OUTSIDER, content: 'Far', createdAt: 1 }).run();
    expect((await put(bot.auth, 'far', '👍')).statusCode).toBe(404);
    expect((await put(bot.auth, 'nothing', '👍')).statusCode).toBe(404);
    const message = (await post(headers(MEMBER), { content: 'Hi' })).json() as { id: string };
    expect((await put(bot.auth, message.id, 'x'.repeat(200))).statusCode).toBeGreaterThanOrEqual(400);
    expect(testDb.select().from(schema.reactions).all()).toEqual([]);
  });
});

describe('moderation by a bot', () => {
  const kick = (auth: Record<string, string>, who = MEMBER) => app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/members/${who}`, headers: auth, payload: { reason: 'Spam' } });
  const ban = (auth: Record<string, string>, who = MEMBER) => app.inject({ method: 'POST', url: `/api/spaces/${SPACE}/bans`, headers: auth, payload: { userId: who, reason: 'Spam' } });

  it('needs the right like anyone', async () => {
    const bot = await botWith();
    expect((await kick(bot.auth)).statusCode).toBe(403);
    expect((await ban(bot.auth)).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/spaces/${SPACE}/members/${MEMBER}/timeout`, headers: bot.auth, payload: { durationSeconds: 60 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/bans`, headers: bot.auth })).statusCode).toBe(403);
  });

  /** The bot's role placed above the members', as whoever runs the space would. */
  const above = (botId: string) => {
    const role = testDb.select().from(schema.roles).where(eq(schema.roles.botId, botId)).get();
    testDb.update(schema.roles).set({ position: 50 }).where(eq(schema.roles.id, role?.id ?? '')).run();
  };

  it('removes a member, and the space\'s log names the bot', async () => {
    const bot = await botWith(USUAL | PermissionBits.KICK_MEMBERS);
    above(bot.id);
    const res = await kick(bot.auth);
    expect(res.statusCode, res.body).toBe(200);
    expect(testDb.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, MEMBER)).all()).toEqual([]);
    const logged = testDb.select().from(schema.spaceAuditLog).all().filter((row) => row.action === 'member_kick');
    expect(logged[0]?.actorId).toBe(bot.id);
  });

  it('bans, sees who is banned, and lifts it', async () => {
    const bot = await botWith(USUAL | PermissionBits.BAN_MEMBERS);
    above(bot.id);
    expect((await ban(bot.auth)).statusCode).toBeLessThan(300);
    const list = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/bans`, headers: bot.auth });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).toContain(MEMBER);
    expect((await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/bans/${MEMBER}`, headers: bot.auth })).statusCode).toBeLessThan(300);
  });

  it('times out and ends it', async () => {
    const bot = await botWith(USUAL | PermissionBits.MODERATE_MEMBERS);
    above(bot.id);
    const on = await app.inject({ method: 'PUT', url: `/api/spaces/${SPACE}/members/${MEMBER}/timeout`, headers: bot.auth, payload: { durationSeconds: 60 } });
    expect(on.statusCode, on.body).toBeLessThan(300);
    expect(testDb.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, MEMBER)).get()?.timedOutUntil).not.toBeNull();
    expect((await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/members/${MEMBER}/timeout`, headers: bot.auth })).statusCode).toBeLessThan(300);
  });

  it('stops at the order of roles and at the owner', async () => {
    const bot = await botWith(USUAL | PermissionBits.KICK_MEMBERS | PermissionBits.BAN_MEMBERS);
    testDb.update(schema.roles).set({ position: 90 }).where(eq(schema.roles.id, 'role-person')).run();
    expect((await kick(bot.auth)).statusCode).toBe(403);
    expect((await kick(bot.auth, OWNER)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await ban(bot.auth, OWNER)).statusCode).toBeGreaterThanOrEqual(400);
    expect(testDb.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, SPACE)).all().map((row) => row.userId)).toEqual(expect.arrayContaining([OWNER, MEMBER]));
  });
});

describe('a file from a bot', () => {
  it('becomes an attachment to name in a message', async () => {
    const bot = await botWith(USUAL | PermissionBits.ATTACH_FILES);
    const res = await upload(bot.auth, 'report.pdf', 128);
    expect(res.statusCode, res.body).toBe(201);
    const file = res.json() as { id: string; filename: string; size: number; mimetype: string; originalName: string };
    expect(file).toMatchObject({ size: 128, mimetype: 'application/pdf', originalName: 'report.pdf' });
    expect(fs.existsSync(path.join(tmpDir, file.filename))).toBe(true);
    expect(fs.readdirSync(path.join(tmpDir, '.tus'))).toEqual([]);

    const message = await post(bot.auth, { content: 'Report', attachments: [file.id] });
    expect(message.statusCode, message.body).toBe(201);
    expect(message.json()).toMatchObject({ attachments: [{ id: file.id }] });
  });

  it('cannot be attached without the right, or by someone else', async () => {
    const bot = await botWith();
    const file = (await upload(bot.auth)).json() as { id: string };
    expect((await post(bot.auth, { attachments: [file.id] })).statusCode).toBe(403);
    expect((await post(headers(OWNER), { content: 'x', attachments: [file.id] })).json()).toMatchObject({ code: 'attachment_not_owned' });
  });

  it('counts on the owner\'s storage, so that bots do not multiply it', async () => {
    testDb.update(schema.instanceSettings).set({ storagePerAccountBytes: 1000 }).run();
    const bot = await botWith();
    expect((await upload(bot.auth, 'a.bin', 600)).statusCode).toBe(201);
    const figures = (await app.inject({ method: 'GET', url: '/api/users/@me/storage', headers: headers(OWNER) })).json();
    expect(figures).toEqual({ usedBytes: 600, limitBytes: 1000 });

    const refused = await upload(bot.auth, 'b.bin', 600);
    expect(refused.statusCode).toBe(413);
    expect(refused.json()).toMatchObject({ code: 'storage_limit_reached' });
    expect(fs.readdirSync(path.join(tmpDir, '.tus'))).toEqual([]);

    // A second bot of the same owner shares it.
    const second = await botWith(USUAL, 'Second');
    expect((await upload(second.auth, 'c.bin', 600)).statusCode).toBe(413);
  });

  it('stops at the instance\'s size for one file', async () => {
    testDb.update(schema.instanceSettings).set({ maxUploadSizeBytes: 100 }).run();
    const bot = await botWith();
    const res = await upload(bot.auth, 'big.bin', 500);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'upload_too_large' });
    expect(fs.readdirSync(path.join(tmpDir, '.tus'))).toEqual([]);
    expect(testDb.select().from(schema.attachments).all()).toEqual([]);
  });

  it('has to be there, and comes only from a bot', async () => {
    const bot = await botWith();
    const none = await app.inject({ method: 'POST', url: '/api/bots/@me/files', headers: { ...bot.auth, 'content-type': 'application/json' }, payload: {} });
    expect(none.statusCode).toBe(400);
    expect((await upload(bot.auth, 'empty.bin', 0)).statusCode).toBe(400);
    expect((await upload(headers(MEMBER))).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/bots/@me/files' })).statusCode).toBe(401);
  });
});

describe('what a command may ask for', () => {
  it('is checked when it is registered', () => {
    expect(cleanCommand({ name: 'roll', description: 'Roll', options: [{ name: 'sides', description: 'How many', type: 'number', required: true }] })).toEqual({
      name: 'roll',
      description: 'Roll',
      options: [{ name: 'sides', description: 'How many', type: 'number', required: true }],
    });
    const wrong = [
      { name: 'r', description: 'x', options: 'lots' },
      { name: 'r', description: 'x', options: [{ name: 'BAD NAME', description: 'y', type: 'text' }] },
      { name: 'r', description: 'x', options: [{ name: 'a', description: '', type: 'text' }] },
      { name: 'r', description: 'x', options: [{ name: 'a', description: 'y', type: 'file' }] },
      { name: 'r', description: 'x', options: [{ name: 'a', description: 'y', type: 'number', choices: ['1'] }] },
      { name: 'r', description: 'x', options: [{ name: 'a', description: 'y', type: 'text', choices: [] }] },
      { name: 'r', description: 'x', options: [{ name: 'a', description: 'y', type: 'text' }, { name: 'a', description: 'z', type: 'text' }] },
      { name: 'r', description: 'x', options: Array.from({ length: BOT_LIMITS.OPTIONS_PER_COMMAND + 1 }, (_, at) => ({ name: `o${at}`, description: 'y', type: 'text' })) },
    ];
    for (const command of wrong) expect(cleanCommand(command), JSON.stringify(command).slice(0, 80)).toBeNull();
  });

  it('is checked against what someone filled in', () => {
    const options = [
      { name: 'count', description: 'd', type: 'number' as const, required: true },
      { name: 'loud', description: 'd', type: 'boolean' as const },
      { name: 'colour', description: 'd', type: 'text' as const, choices: ['red', 'blue'] },
    ];
    expect(cleanCommandInput(options, { count: 2, loud: true, colour: 'red', other: 'ignored' })).toEqual({ values: { count: 2, loud: true, colour: 'red' } });
    expect(cleanCommandInput(options, {})).toEqual({ option: 'count' });
    expect(cleanCommandInput(options, { count: '2' })).toEqual({ option: 'count' });
    expect(cleanCommandInput(options, { count: 2, loud: 'yes' })).toEqual({ option: 'loud' });
    expect(cleanCommandInput(options, { count: 2, colour: 'green' })).toEqual({ option: 'colour' });
    expect(cleanCommandInput(options, 'nonsense')).toEqual({ option: 'count' });
  });

  async function botWithCommand() {
    const bot = await botWith();
    connected.add(bot.id);
    const set = await app.inject({
      method: 'PUT',
      url: '/api/bots/@me/commands',
      headers: bot.auth,
      payload: {
        commands: [{
          name: 'poke',
          description: 'Poke someone',
          options: [
            { name: 'who', description: 'Who', type: 'person', required: true },
            { name: 'where', description: 'Where', type: 'channel' },
            { name: 'as', description: 'As', type: 'role' },
            { name: 'times', description: 'Times', type: 'number' },
          ],
        }, { name: 'ping', description: 'Ping' }],
      },
    });
    expect(set.statusCode, set.body).toBe(200);
    return bot;
  }
  const invoke = (botId: string, name: string, payload: Record<string, unknown>, userId = MEMBER) => app.inject({
    method: 'POST', url: `/api/channels/${CHANNEL}/commands/${botId}/${name}`, headers: headers(userId), payload,
  });

  it('shows in the channel with what it asks for', async () => {
    await botWithCommand();
    const list = await app.inject({ method: 'GET', url: `/api/channels/${CHANNEL}/commands`, headers: headers(MEMBER) });
    const poke = (list.json() as { commands: Array<{ name: string; options?: unknown[] }> }).commands.find((command) => command.name === 'poke');
    expect(poke?.options).toHaveLength(4);
  });

  it('reaches the bot filled in, with an id to answer under', async () => {
    const bot = await botWithCommand();
    const res = await invoke(bot.id, 'poke', { options: { who: OWNER, where: CHANNEL, as: 'role-person', times: 2 } });
    expect(res.statusCode, res.body).toBe(200);
    const event = eventsOfType('command_invoked')[0];
    expect(event).toMatchObject({ name: 'poke', options: { who: OWNER, where: CHANNEL, as: 'role-person', times: 2 }, channelId: CHANNEL, spaceId: SPACE });
    expect(typeof event?.interactionId).toBe('string');
  });

  it('refuses what is missing or not there, before the bot hears of it', async () => {
    const bot = await botWithCommand();
    const refused = [
      {},
      { who: OUTSIDER },
      { who: 'nobody' },
      { who: OWNER, where: ELSEWHERE_CHANNEL },
      { who: OWNER, where: 'nothing' },
      { who: OWNER, as: 'role-elsewhere' },
      { who: OWNER, times: 'many' },
    ];
    for (const options of refused) {
      const res = await invoke(bot.id, 'poke', { options });
      expect(res.statusCode, JSON.stringify(options)).toBe(400);
      expect(res.json()).toMatchObject({ code: 'command_option_invalid' });
    }
    expect(eventsOfType('command_invoked')).toEqual([]);
  });

  it('does not offer a channel the person cannot see', async () => {
    const bot = await botWithCommand();
    expect((await invoke(bot.id, 'poke', { options: { who: OWNER, where: SECRET } })).statusCode).toBe(400);
  });

  it('asks nothing of a command with no options', async () => {
    const bot = await botWithCommand();
    expect((await invoke(bot.id, 'ping', { args: 'anything' })).statusCode).toBe(200);
    expect(eventsOfType('command_invoked')[0]).toMatchObject({ args: 'anything', options: {} });
  });
});

describe('answering a command', () => {
  async function asked() {
    const bot = await botWith();
    connected.add(bot.id);
    await app.inject({ method: 'PUT', url: '/api/bots/@me/commands', headers: bot.auth, payload: { commands: [{ name: 'ping', description: 'Ping' }] } });
    const res = await app.inject({ method: 'POST', url: `/api/channels/${CHANNEL}/commands/${bot.id}/ping`, headers: headers(MEMBER), payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    const interactionId = String(eventsOfType('command_invoked').at(-1)?.interactionId);
    return { bot, interactionId };
  }
  const answer = (auth: Record<string, string>, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/interactions/${id}/reply`, headers: auth, payload });

  it('in the channel is an ordinary message of the bot', async () => {
    const { bot, interactionId } = await asked();
    const res = await answer(bot.auth, interactionId, { content: 'Pong', cards: [{ title: 'Card' }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ userId: bot.id, channelId: CHANNEL, content: 'Pong', cards: [{ title: 'Card' }] });
    expect(eventsOfType('message_created')).toHaveLength(1);
  });

  it('for the person alone reaches their sockets and nothing else, and is kept nowhere', async () => {
    const { bot, interactionId } = await asked();
    const before = testDb.select().from(schema.messages).all().length;
    const res = await answer(bot.auth, interactionId, { content: 'Only you <@user-owner> @everyone', cards: [{ title: 'Secret' }], ephemeral: true });
    expect(res.statusCode, res.body).toBe(200);

    const reply = eventsOfType('command_reply');
    expect(reply).toHaveLength(1);
    expect(reply[0]).toMatchObject({ channelId: CHANNEL, botId: bot.id, botName: 'Helper', cards: [{ title: 'Secret' }] });
    expect(String(reply[0]?.content)).not.toMatch(/@everyone|<@user/);
    const toWhom = sentOf('sendToUser').filter((entry) => (entry.args[1] as { type?: string }).type === 'command_reply');
    expect(toWhom.map((entry) => entry.args[0])).toEqual([MEMBER]);
    expect(sentOf('sendToChannel').filter((entry) => (entry.args[2] as { type?: string }).type === 'command_reply')).toEqual([]);
    expect(testDb.select().from(schema.messages).all()).toHaveLength(before);
  });

  it('is only for the bot that was asked', async () => {
    const { interactionId } = await asked();
    const other = await botWith(USUAL, 'Other');
    const res = await answer(other.auth, interactionId, { content: 'Me too' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'interaction_not_found' });
    expect((await answer(headers(MEMBER), interactionId, { content: 'As a person' })).statusCode).toBe(404);
  });

  it('ends after a while', async () => {
    const { bot, interactionId } = await asked();
    const later = Date.now() + BOT_LIMITS.INTERACTION_TTL_MS + 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    expect((await answer(bot.auth, interactionId, { content: 'Too late' })).statusCode).toBe(404);
  });

  it('has an end, so that one command cannot become a stream', async () => {
    const { bot, interactionId } = await asked();
    for (let at = 0; at < BOT_LIMITS.REPLIES_PER_INTERACTION; at += 1) {
      expect((await answer(bot.auth, interactionId, { content: `n${at}`, ephemeral: true })).statusCode).toBe(200);
    }
    expect((await answer(bot.auth, interactionId, { content: 'One more', ephemeral: true })).statusCode).toBe(429);
  });

  it('has to say something, and meets the same rules', async () => {
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, blockedWords: JSON.stringify(['forbidden']), updatedAt: 1 }).run();
    const { bot, interactionId } = await asked();
    expect((await answer(bot.auth, interactionId, {})).statusCode).toBe(400);
    expect((await answer(bot.auth, interactionId, { content: 'forbidden' })).json().code).toMatch(/^automod/);
    expect((await answer(bot.auth, interactionId, { content: 'forbidden', ephemeral: true })).json().code).toMatch(/^automod/);
    expect((await answer(bot.auth, interactionId, { cards: [{ title: 'A', imageAttachmentId: 'x' }] })).json()).toMatchObject({ code: 'cards_invalid' });
  });

  it('stops with the bot\'s right to write there', async () => {
    const { bot, interactionId } = await asked();
    const role = testDb.select().from(schema.roles).where(eq(schema.roles.botId, bot.id)).get();
    testDb.update(schema.roles).set({ permissions: permissionsToString(PermissionBits.VIEW_CHANNEL) }).where(eq(schema.roles.id, role?.id ?? '')).run();
    expect((await answer(bot.auth, interactionId, { content: 'Hello', ephemeral: true })).statusCode).toBe(403);
  });
});

describe('a bot\'s limit', () => {
  it('shows on every answer, and says how long to wait', async () => {
    vi.stubEnv('DISABLE_RATE_LIMITS', '');
    const bot = await botWith();
    const first = await app.inject({ method: 'GET', url: '/api/bots/@me', headers: bot.auth });
    expect(first.headers['x-ratelimit-limit']).toBe(String(BOT_LIMITS.REQUESTS_PER_MINUTE));
    expect(Number(first.headers['x-ratelimit-remaining'])).toBe(BOT_LIMITS.REQUESTS_PER_MINUTE - 1);
    expect(Number(first.headers['x-ratelimit-reset'])).toBeGreaterThan(0);

    let last = first;
    for (let at = 0; at < BOT_LIMITS.REQUESTS_PER_MINUTE; at += 1) {
      last = await app.inject({ method: 'GET', url: '/api/bots/@me', headers: bot.auth });
    }
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    expect(last.headers['x-ratelimit-remaining']).toBe('0');
    vi.unstubAllEnvs();
  });
});

describe('the developer portal', () => {
  const detail = (id: string, userId = OWNER) => app.inject({ method: 'GET', url: `/api/bots/${id}`, headers: headers(userId) });

  it('shows the owner a bot\'s commands and spaces, and nobody else', async () => {
    const bot = await botWith();
    await app.inject({ method: 'PUT', url: '/api/bots/@me/commands', headers: bot.auth, payload: { commands: [{ name: 'ping', description: 'Ping', options: [{ name: 'a', description: 'b', type: 'text' }] }] } });
    const res = await detail(bot.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: bot.id,
      name: 'Helper',
      avatar: null,
      commands: [{ name: 'ping', options: [{ name: 'a' }] }],
      spaces: [{ id: SPACE, name: 'Space' }],
    });
    expect(JSON.stringify(res.json())).not.toContain(bot.token);
    expect((await detail(bot.id, MEMBER)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/bots/${bot.id}`, headers: bot.auth })).statusCode).toBe(403);
  });

  const update = (id: string, avatar: unknown, userId = OWNER) => app.inject({
    method: 'PATCH', url: `/api/bots/${id}`, headers: headers(userId), payload: { name: 'Helper', description: null, avatar },
  });
  const ownUpload = (id: string, filename: string, uploaderId = OWNER) => {
    fs.writeFileSync(path.join(tmpDir, filename), 'picture');
    testDb.insert(schema.attachments).values({ id, filename, originalName: 'a.webp', mimetype: 'image/webp', size: 7, uploaderId, createdAt: 1 }).run();
  };

  it('takes the owner\'s own upload as its picture, and it no longer counts as a file', async () => {
    const bot = await botWith();
    ownUpload('pic', 'pic.webp');
    const res = await update(bot.id, 'pic.webp');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().avatar).toBe('pic.webp');
    expect(testDb.select().from(schema.attachments).where(eq(schema.attachments.id, 'pic')).all()).toEqual([]);
    expect((await detail(bot.id)).json().avatar).toBe('pic.webp');
  });

  it('removes the file it replaced, and can go without', async () => {
    const bot = await botWith();
    ownUpload('one', 'one.webp');
    ownUpload('two', 'two.webp');
    await update(bot.id, 'one.webp');
    await update(bot.id, 'two.webp');
    expect(fs.existsSync(path.join(tmpDir, 'one.webp'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'two.webp'))).toBe(true);
    expect((await update(bot.id, null)).json().avatar).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'two.webp'))).toBe(false);
  });

  it('keeps the picture when an update does not name one', async () => {
    const bot = await botWith();
    ownUpload('pic', 'pic.webp');
    await update(bot.id, 'pic.webp');
    const res = await app.inject({ method: 'PATCH', url: `/api/bots/${bot.id}`, headers: headers(OWNER), payload: { name: 'Renamed', description: null } });
    expect(res.json()).toMatchObject({ name: 'Renamed', avatar: 'pic.webp' });
  });

  it('refuses a picture from elsewhere or from someone else', async () => {
    const bot = await botWith();
    expect((await update(bot.id, 'https://tracker.example/me.png')).json()).toMatchObject({ code: 'avatar_url_invalid' });
    ownUpload('theirs', 'theirs.webp', MEMBER);
    expect((await update(bot.id, 'theirs.webp')).json()).toMatchObject({ code: 'avatar_url_invalid' });
    expect((await update(bot.id, '../../etc/passwd')).statusCode).toBe(400);
    expect((await update(bot.id, 'theirs.webp', MEMBER)).statusCode).toBe(404);
  });
});
