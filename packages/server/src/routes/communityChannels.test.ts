import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { FOLLOW_LIMITS } from '@backspace/shared/src/channelFollows.js';
import { FORUM_LIMITS } from '@backspace/shared/src/forums.js';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString, stringToPermissions } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Forums, announcement channels and own invite addresses. A forum's post is a thread, so what a
// thread does is tested with threads; here is what is new: who may do what, what a forum refuses,
// what a follow carries and where it stops, and that an address is one more way in, never a new one.

setWorkerId(31);
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
      if (name === 'getUserSpaceEntries' || name === 'getAllOnlineUserIds') return [];
      return name === 'getRoomParticipants' ? new Set() : undefined;
    },
  }),
}));

vi.mock('../utils/embedResolver.js', async (original) => ({
  ...(await original<typeof import('../utils/embedResolver.js')>()),
  resolveEmbeds: async () => {},
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
const ADMIN = 'user-admin';
const MOD = 'user-mod';
const MEMBER = 'user-member';
const OTHER = 'user-other';
const OUTSIDER = 'user-outsider';
const SPACE = '1000';
const SPACE_B = '2000';
const FORUM = '3000';
const GENERAL = '3001';
const NEWS = '3002';
const SECRET_FORUM = '3003';
const TARGET = '4000';
const TARGET_VOICE = '4001';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

/** A space's automatic rules: this word is refused there. */
function blockWord(spaceId: string, word: string): void {
  testDb.insert(schema.spaceModerationSettings).values({ spaceId, blockedWords: JSON.stringify([word]), updatedAt: 1 }).run();
}

const { forumRoutes } = await import('./forums.js');
const { channelFollowRoutes, copyToFollowers } = await import('./channelFollows.js');
const { channelRoutes } = await import('./channels.js');
const { messageRoutes } = await import('./messages.js');
const { pollRoutes } = await import('./polls.js');
const { spaceRoutes } = await import('./spaces.js');
const { threadRoutes } = await import('./threads.js');
const { webhookRoutes } = await import('./webhooks.js');
const { platformAdminRoutes } = await import('./platformAdmin.js');
const { removeUnusedWebhookAccounts } = await import('../utils/webhookAccounts.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  for (const id of [OWNER, ADMIN, MOD, MEMBER, OTHER, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id.replace('-', '_'), passwordHash: 'x', isAdmin: id === ADMIN ? 1 : 0, createdAt: 1 }).run();
  }
  for (const [id, name] of [[SPACE, 'Night Shift'], [SPACE_B, 'Field Notes']] as const) {
    testDb.insert(schema.spaces).values({ id, name, ownerId: OWNER, createdAt: 1 }).run();
    testDb.insert(schema.roles).values({ id, spaceId: id, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
    testDb.insert(schema.spaceMembers).values({ spaceId: id, userId: OWNER, joinedAt: 1 }).run();
  }
  for (const id of [MOD, MEMBER, OTHER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  for (const id of [MOD, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE_B, userId: id, joinedAt: 1 }).run();
  const modBits = PermissionBits.MANAGE_CHANNELS | PermissionBits.MANAGE_MESSAGES | PermissionBits.MANAGE_WEBHOOKS | PermissionBits.MANAGE_SPACE;
  for (const spaceId of [SPACE, SPACE_B]) {
    const roleId = `role-${spaceId}`;
    testDb.insert(schema.roles).values({ id: roleId, spaceId, name: 'Mod', position: 1, permissions: permissionsToString(modBits), createdAt: 1 }).run();
    testDb.insert(schema.memberRoles).values({ spaceId, userId: MOD, roleId }).run();
  }
  const channels: Array<[string, string, string, string]> = [
    [FORUM, SPACE, 'help', 'forum'],
    [GENERAL, SPACE, 'general', 'text'],
    [NEWS, SPACE, 'news', 'announcement'],
    [SECRET_FORUM, SPACE, 'staff', 'forum'],
    [TARGET, SPACE_B, 'updates', 'text'],
    [TARGET_VOICE, SPACE_B, 'lounge', 'voice'],
  ];
  for (const [id, spaceId, name, type] of channels) testDb.insert(schema.channels).values({ id, spaceId, name, type, createdAt: 1 }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET_FORUM, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  app = Fastify();
  for (const routes of [forumRoutes, channelFollowRoutes, channelRoutes, messageRoutes, pollRoutes, spaceRoutes, threadRoutes, webhookRoutes, platformAdminRoutes]) {
    await app.register(routes);
  }
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.restoreAllMocks();
});

const post = (userId: string, payload: Record<string, unknown>, forum = FORUM) => app.inject({
  method: 'POST', url: `/api/channels/${forum}/posts`, headers: headers(userId), payload,
});

const list = (userId: string, query = '', forum = FORUM) => app.inject({
  method: 'GET', url: `/api/channels/${forum}/posts${query}`, headers: headers(userId),
});

const putTags = (userId: string, tags: unknown, forum = FORUM) => app.inject({
  method: 'PUT', url: `/api/channels/${forum}/forum-tags`, headers: headers(userId), payload: { tags },
});

const sentOfType = (type: string): Array<Record<string, unknown>> => sent
  .flatMap(({ args }) => args)
  .filter((arg): arg is Record<string, unknown> => typeof arg === 'object' && arg !== null && (arg as { type?: unknown }).type === type);

describe('a forum', () => {
  it('holds posts, not messages', async () => {
    const message = await app.inject({ method: 'POST', url: `/api/channels/${FORUM}/messages`, headers: headers(MEMBER), payload: { content: 'hello' } });
    expect(message.statusCode).toBe(400);
    expect(message.json().code).toBe('forum_takes_posts');
    const poll = await app.inject({
      method: 'POST', url: `/api/channels/${FORUM}/polls`, headers: headers(MEMBER), payload: { question: 'Which?', options: ['a', 'b'] },
    });
    expect(poll.json().code).toBe('forum_takes_posts');
    const webhook = await app.inject({ method: 'POST', url: `/api/channels/${FORUM}/webhooks`, headers: headers(OWNER), payload: { name: 'x' } });
    expect(webhook.json().code).toBe('webhook_not_allowed');
  });

  it('takes a post as a thread with no message outside it, with its first message inside', async () => {
    const res = await post(MEMBER, { title: '  Why is the raid on Saturday?  ', content: 'I work Saturdays.' });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.name).toBe('Why is the raid on Saturday?');
    expect(created.parentChannelId).toBe(FORUM);
    expect(created.starterMessageId).toBeNull();
    expect(created.following).toBe(true);
    expect(created.preview).toBe('I work Saturdays.');
    expect(created.author.id).toBe(MEMBER);
    const row = testDb.select().from(schema.channels).where(eq(schema.channels.id, created.id)).get();
    expect(row?.type).toBe('thread');
    expect(row?.threadCreatedBy).toBe(MEMBER);
    const messages = testDb.select().from(schema.messages).where(eq(schema.messages.channelId, created.id)).all();
    expect(messages.map((message) => message.content)).toEqual(['I work Saturdays.']);
    expect(testDb.select().from(schema.messages).where(eq(schema.messages.channelId, FORUM)).all()).toHaveLength(0);
    expect(testDb.select().from(schema.spaceAuditLog).all().map((entry) => entry.action)).toEqual(['thread_create']);
    // Told of the thread before its first message, or the message would have nowhere to go.
    const order = sent.flatMap(({ args }) => args).flatMap((arg) => (typeof arg === 'object' && arg !== null && 'type' in arg ? [(arg as { type: string }).type] : []));
    expect(order.indexOf('thread_followed')).toBeLessThan(order.indexOf('message_created'));
  });

  it('asks a post for a title and something to say', async () => {
    expect((await post(MEMBER, { title: '', content: 'x' })).json().code).toBe('forum_post_title_invalid');
    expect((await post(MEMBER, { title: 'x'.repeat(101), content: 'x' })).json().code).toBe('forum_post_title_invalid');
    expect((await post(MEMBER, { title: 'x' })).json().code).toBe('message_empty');
    expect((await post(MEMBER, { title: 'x', content: 'y'.repeat(5000) })).json().code).toBe('content_too_long');
  });

  it('is only for those who may see it, write and start threads', async () => {
    expect((await post(OUTSIDER, { title: 't', content: 'c' })).statusCode).toBe(403);
    expect((await post(MEMBER, { title: 't', content: 'c' }, SECRET_FORUM)).statusCode).toBe(403);
    expect((await list(OUTSIDER)).statusCode).toBe(403);
    expect((await list(MEMBER, '', SECRET_FORUM)).statusCode).toBe(403);
    testDb.insert(schema.channelOverrides).values({
      channelId: FORUM, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.CREATE_THREADS),
    }).run();
    expect((await post(MEMBER, { title: 't', content: 'c' })).statusCode).toBe(403);
    // Starting one is closed, reading stays open.
    expect((await list(MEMBER)).statusCode).toBe(200);
  });

  it('is what those two routes need', async () => {
    expect((await post(MEMBER, { title: 't', content: 'c' }, GENERAL)).json().code).toBe('forum_required');
    expect((await list(MEMBER, '', GENERAL)).json().code).toBe('forum_required');
  });

  it('lets the space\'s rules read the title too', async () => {
    blockWord(SPACE, 'rude');
    const res = await post(MEMBER, { title: 'A rude title', content: 'fine words' });
    expect(res.json().code).toBe('automod_blocked_word');
    expect(testDb.select().from(schema.channels).where(eq(schema.channels.parentChannelId, FORUM)).all()).toHaveLength(0);
  });

  it('counts posts for its slow mode', async () => {
    testDb.update(schema.channels).set({ slowmodeSeconds: 60 }).where(eq(schema.channels.id, FORUM)).run();
    expect((await post(MEMBER, { title: 'one', content: 'c' })).statusCode).toBe(201);
    const second = await post(MEMBER, { title: 'two', content: 'c' });
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe('slowmode_active');
  });

  it('lists its posts by latest activity, the newest word bringing one to the top', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = (await post(MEMBER, { title: 'first', content: 'c' })).json();
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const second = (await post(MEMBER, { title: 'second', content: 'c' })).json();
    vi.restoreAllMocks();
    expect((await list(MEMBER)).json().posts.map((p: { id: string }) => p.id)).toEqual([second.id, first.id]);
    await app.inject({ method: 'POST', url: `/api/channels/${first.id}/messages`, headers: headers(OTHER), payload: { content: 'an answer' } });
    const again = (await list(MEMBER)).json().posts;
    expect(again.map((p: { id: string }) => p.id)).toEqual([first.id, second.id]);
    expect(again[0].messageCount).toBe(2);
    // The list shows the post's own words, not the latest answer.
    expect(again[0].preview).toBe('c');
  });

  it('goes through all of them a page at a time', async () => {
    const total = FORUM_LIMITS.PAGE_SIZE + 5;
    for (let i = 0; i < total; i += 1) {
      testDb.insert(schema.channels).values({
        id: String(5000 + i), spaceId: SPACE, name: `post ${i}`, type: 'thread', parentChannelId: FORUM, threadCreatedBy: MEMBER, createdAt: 1000 + i,
      }).run();
    }
    const page = (await list(MEMBER)).json();
    expect(page.posts).toHaveLength(FORUM_LIMITS.PAGE_SIZE);
    expect(page.posts[0].name).toBe(`post ${total - 1}`);
    const rest = (await list(MEMBER, `?before=${encodeURIComponent(page.nextBefore)}`)).json();
    expect(rest.posts).toHaveLength(5);
    expect(rest.nextBefore).toBeNull();
    expect(rest.posts[4].name).toBe('post 0');
  });

  it('keeps what a spoiler hides out of its list, and a spoiler picture too', async () => {
    const created = (await post(MEMBER, { title: 't', content: 'Open ||the ending|| closed' })).json();
    expect(created.preview).not.toContain('ending');
    testDb.insert(schema.attachments).values({
      id: 'att-1', filename: 'a.png', thumbnailFilename: 'a_thumb.webp', originalName: 'a.png', mimetype: 'image/png', size: 1, uploaderId: MEMBER, createdAt: 1, spoiler: true,
    }).run();
    const withPicture = (await post(MEMBER, { title: 't2', content: 'c', attachments: ['att-1'], spoilerAttachments: ['att-1'] })).json();
    expect(withPicture.thumbnail).toBeNull();
  });
});

describe('tags', () => {
  it('can be read by who can see the forum', async () => {
    await putTags(MOD, [{ name: 'bug', color: 'rose' }]);
    const read = (userId: string, forum = FORUM) => app.inject({ method: 'GET', url: `/api/channels/${forum}/forum-tags`, headers: headers(userId) });
    const seen = await read(MEMBER);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().tags).toMatchObject([{ name: 'bug', color: 'rose' }]);
    expect((await read(MEMBER, SECRET_FORUM)).statusCode).toBe(403);
    expect((await read(MEMBER, GENERAL)).json().code).toBe('forum_required');
  });

  it('are for who may manage the channel, within the limits, each name once', async () => {
    expect((await putTags(MEMBER, [{ name: 'bug' }])).statusCode).toBe(403);
    expect((await putTags(MOD, [{ name: 'bug', color: 'rose' }, { name: 'idea' }])).statusCode).toBe(200);
    const many = Array.from({ length: FORUM_LIMITS.TAGS_PER_FORUM + 1 }, (_, i) => ({ name: `t${i}` }));
    expect((await putTags(MOD, many)).json().code).toBe('forum_tag_limit_reached');
    expect((await putTags(MOD, [{ name: 'Bug' }, { name: 'bug' }])).json().code).toBe('forum_tag_duplicate');
    expect((await putTags(MOD, [{ name: 'x'.repeat(FORUM_LIMITS.TAG_NAME_MAX_LENGTH + 1) }])).json().code).toBe('forum_tag_name_length');
    expect((await putTags(MOD, [{ name: 'ok', color: 'neon' }])).statusCode).toBe(400);
    expect((await putTags(MOD, [{ id: 'not-here', name: 'ok' }])).json().code).toBe('forum_tag_unknown');
    expect((await putTags(MOD, [{ name: 'x' }], GENERAL)).json().code).toBe('forum_required');
    expect(sentOfType('forum_tags_updated')).toHaveLength(1);
    expect(testDb.select().from(schema.spaceAuditLog).all().map((entry) => entry.action)).toEqual(['forum_tags_update']);
  });

  it('sort a post, filter the list, and leave it when they go', async () => {
    const { tags } = (await putTags(MOD, [{ name: 'bug' }, { name: 'idea' }])).json();
    const [bug, idea] = tags as Array<{ id: string }>;
    const tagged = (await post(MEMBER, { title: 'a', content: 'c', tagIds: [bug!.id] })).json();
    expect(tagged.tagIds).toEqual([bug!.id]);
    const plain = (await post(MEMBER, { title: 'b', content: 'c' })).json();
    expect(plain.tagIds).toEqual([]);
    const filtered = (await list(MEMBER, `?tag=${bug!.id}`)).json();
    expect(filtered.posts.map((p: { id: string }) => p.id)).toEqual([tagged.id]);
    expect(filtered.tags.map((t: { name: string }) => t.name)).toEqual(['bug', 'idea']);

    // Renaming keeps a tag on its posts; leaving one out takes it off them.
    await putTags(MOD, [{ id: bug!.id, name: 'defect' }]);
    expect((await list(MEMBER)).json().posts.find((p: { id: string }) => p.id === tagged.id).tagIds).toEqual([bug!.id]);
    await putTags(MOD, []);
    expect((await list(MEMBER)).json().posts.find((p: { id: string }) => p.id === tagged.id).tagIds).toEqual([]);
    expect(idea).toBeDefined();
  });

  it('must be the forum\'s own, and not too many', async () => {
    const { tags } = (await putTags(MOD, Array.from({ length: FORUM_LIMITS.TAGS_PER_POST + 1 }, (_, i) => ({ name: `t${i}` })))).json();
    const ids = (tags as Array<{ id: string }>).map((tag) => tag.id);
    expect((await post(MEMBER, { title: 't', content: 'c', tagIds: ids })).json().code).toBe('forum_post_tag_limit');
    expect((await post(MEMBER, { title: 't', content: 'c', tagIds: ['other'] })).json().code).toBe('forum_tag_unknown');
  });

  it('on a post can be changed by who started it, or someone who may manage messages', async () => {
    const { tags } = (await putTags(MOD, [{ name: 'bug' }])).json();
    const tagId = (tags as Array<{ id: string }>)[0]!.id;
    const created = (await post(MEMBER, { title: 't', content: 'c' })).json();
    const tagPost = (userId: string, id = created.id) => app.inject({ method: 'PUT', url: `/api/threads/${id}/tags`, headers: headers(userId), payload: { tagIds: [tagId] } });
    expect((await tagPost(OTHER)).statusCode).toBe(403);
    expect((await tagPost(MEMBER)).statusCode).toBe(200);
    expect(sentOfType('thread_updated').at(-1)).toMatchObject({ thread: { tagIds: [tagId] } });
    expect((await tagPost(MOD)).statusCode).toBe(200);
    expect((await tagPost(MEMBER, GENERAL)).statusCode).toBe(404);
  });
});

describe('where a channel can be made', () => {
  const makeChannel = (type: string) => app.inject({
    method: 'POST', url: `/api/spaces/${SPACE}/channels`, headers: headers(OWNER), payload: { name: `new-${type}`, type },
  });

  it('takes the new kinds, and no made-up ones', async () => {
    expect((await makeChannel('forum')).json().type).toBe('forum');
    expect((await makeChannel('thread')).json().code).toBe('channel_type_invalid');
    expect((await makeChannel('stage')).json().code).toBe('channel_type_invalid');
  });

  it('lists a forum among the channels, and its posts not', async () => {
    await post(MEMBER, { title: 't', content: 'c' });
    const res = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/channels`, headers: headers(MEMBER) });
    const types = (res.json() as Array<{ id: string; type: string }>).map((channel) => channel.type);
    expect(types).toContain('forum');
    expect(types).not.toContain('thread');
  });

  it('closes an announcement channel to everyone but those given the right', async () => {
    const made = (await makeChannel('announcement')).json();
    const write = (userId: string) => app.inject({ method: 'POST', url: `/api/channels/${made.id}/messages`, headers: headers(userId), payload: { content: 'x' } });
    expect((await write(MEMBER)).statusCode).toBe(403);
    expect((await write(OWNER)).statusCode).toBe(201);
    const row = testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, made.id)).get();
    expect(row?.targetId).toBe(SPACE);
    expect(stringToPermissions(row!.deny) & PermissionBits.SEND_MESSAGES).toBe(PermissionBits.SEND_MESSAGES);
    // It is an ordinary override, so a role is given the right in the ordinary way.
    testDb.insert(schema.channelOverrides).values({
      channelId: made.id, targetType: 'member', targetId: MEMBER, allow: permissionsToString(PermissionBits.SEND_MESSAGES), deny: '0',
    }).run();
    expect((await write(MEMBER)).statusCode).toBe(201);
  });

  it('turns a text channel into an announcement channel and back, and nothing else', async () => {
    const patch = (id: string, type: string) => app.inject({ method: 'PATCH', url: `/api/channels/${id}`, headers: headers(OWNER), payload: { type } });
    expect((await patch(GENERAL, 'announcement')).json().type).toBe('announcement');
    const closed = testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, GENERAL)).get();
    expect(stringToPermissions(closed!.deny) & PermissionBits.SEND_MESSAGES).not.toBe(0n);
    await follow(OWNER, GENERAL);
    expect((await patch(GENERAL, 'text')).json().type).toBe('text');
    expect(testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, GENERAL)).all()).toHaveLength(0);
    expect(testDb.select().from(schema.channelFollows).all()).toHaveLength(0);
    expect((await patch(FORUM, 'text')).json().code).toBe('channel_type_change_invalid');
    expect((await patch(GENERAL, 'forum')).json().code).toBe('channel_type_change_invalid');
    expect((await patch(GENERAL, 'voice')).json().code).toBe('channel_type_change_invalid');
  });

  it('lets a thread and a webhook into an announcement channel', async () => {
    const webhook = await app.inject({ method: 'POST', url: `/api/channels/${NEWS}/webhooks`, headers: headers(OWNER), payload: { name: 'Builds' } });
    expect(webhook.statusCode).toBe(201);
    const said = (await app.inject({ method: 'POST', url: `/api/channels/${NEWS}/messages`, headers: headers(OWNER), payload: { content: 'news' } })).json();
    const thread = await app.inject({ method: 'POST', url: `/api/messages/${said.id}/thread`, headers: headers(OWNER), payload: {} });
    expect(thread.statusCode).toBe(201);
  });
});

function follow(userId: string, source = NEWS, target = TARGET) {
  return app.inject({ method: 'POST', url: `/api/channels/${source}/follows`, headers: headers(userId), payload: { targetChannelId: target } });
}

const copiesIn = (channelId = TARGET) => testDb.select().from(schema.messages).where(eq(schema.messages.channelId, channelId)).all();

async function postNews(content: string): Promise<import('@backspace/shared').MessageWithUser> {
  const res = await app.inject({ method: 'POST', url: `/api/channels/${NEWS}/messages`, headers: headers(OWNER), payload: { content } });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('following', () => {
  it('takes the right to manage webhooks where the posts arrive', async () => {
    expect((await follow(MEMBER)).statusCode).toBe(403);
    expect((await follow(OUTSIDER)).statusCode).toBe(403);
    const res = await follow(MOD);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sourceChannelName: 'news', sourceSpaceName: 'Night Shift', targetChannelName: 'updates', targetSpaceName: 'Field Notes' });
    // Both spaces see it in their audit log.
    const audit = testDb.select().from(schema.spaceAuditLog).all();
    expect(audit.map((entry) => [entry.spaceId, entry.action]).sort()).toEqual([[SPACE, 'channel_follow_create'], [SPACE_B, 'channel_follow_create']].sort());
  });

  it('takes an announcement channel every member can see, and a text channel of another space', async () => {
    expect((await follow(OWNER, GENERAL)).json().code).toBe('announcement_channel_required');
    expect((await follow(OWNER, NEWS, TARGET_VOICE)).json().code).toBe('follow_target_invalid');
    expect((await follow(OWNER, NEWS, GENERAL)).json().code).toBe('follow_target_invalid');
    expect((await follow(OWNER, NEWS, 'nowhere')).json().code).toBe('follow_target_invalid');
    testDb.insert(schema.channelOverrides).values({
      channelId: NEWS, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
    }).run();
    expect((await follow(OWNER)).json().code).toBe('follow_source_private');
  });

  it('counts each pair once, and stops at the limits', async () => {
    expect((await follow(OWNER)).statusCode).toBe(201);
    expect((await follow(OWNER)).statusCode).toBe(409);
    for (let i = 0; i < FOLLOW_LIMITS.PER_SOURCE_MAX; i += 1) {
      const id = String(6000 + i);
      testDb.insert(schema.channels).values({ id, spaceId: SPACE_B, name: `t${i}`, type: 'text', createdAt: 1 }).run();
      const made = await follow(OWNER, NEWS, id);
      if (i < FOLLOW_LIMITS.PER_SOURCE_MAX - 1) expect(made.statusCode).toBe(201);
      else expect(made.json().code).toBe('follow_limit_reached');
    }
  });

  it('offers only where the person may have them arrive', async () => {
    const targets = (userId: string) => app.inject({ method: 'GET', url: `/api/channels/${NEWS}/follow-targets`, headers: headers(userId) });
    expect((await targets(MEMBER)).json().spaces).toEqual([]);
    const spaces = (await targets(MOD)).json().spaces;
    expect(spaces).toEqual([{ id: SPACE_B, name: 'Field Notes', channels: [{ id: TARGET, name: 'updates' }] }]);
    expect((await targets(OUTSIDER)).statusCode).toBe(403);
  });

  it('shows and ends from either side, for those who may manage it', async () => {
    const id = (await follow(MOD)).json().id;
    const read = (userId: string, channel: string) => app.inject({ method: 'GET', url: `/api/channels/${channel}/follows`, headers: headers(userId) });
    expect((await read(MEMBER, NEWS)).statusCode).toBe(403);
    expect((await read(MOD, NEWS)).json().followers.map((f: { id: string }) => f.id)).toEqual([id]);
    expect((await read(MOD, TARGET)).json().following.map((f: { id: string }) => f.id)).toEqual([id]);
    const end = (userId: string) => app.inject({ method: 'DELETE', url: `/api/channel-follows/${id}`, headers: headers(userId) });
    expect((await end(MEMBER)).statusCode).toBe(403);
    expect((await end(OWNER)).statusCode).toBe(200);
    expect((await end(OWNER)).json().code).toBe('follow_not_found');
  });

  it('copies a post to where it arrives, pinging nobody', async () => {
    await follow(OWNER);
    const message = await postNews('Patch day <@user-member> and @everyone');
    await copyToFollowers(SPACE, message);
    const [copy] = copiesIn();
    expect(copy?.forwarded).toBe(true);
    expect(copy?.content).not.toContain('<@user-member>');
    expect(copy?.content).toContain('@​everyone');
    const author = testDb.select().from(schema.users).where(eq(schema.users.id, copy!.userId)).get();
    expect(author?.accountKind).toBe('follow');
    expect(author?.displayName).toBe('Night Shift · #news');
    expect(sentOfType('message_created').at(-1)).toMatchObject({ message: { channelId: TARGET, user: { accountKind: 'follow' } } });
  });

  it('carries a new name of the space along', async () => {
    await follow(OWNER);
    testDb.update(schema.spaces).set({ name: 'Day Shift' }).where(eq(schema.spaces.id, SPACE)).run();
    await copyToFollowers(SPACE, await postNews('news'));
    const author = testDb.select().from(schema.users).where(eq(schema.users.id, copiesIn()[0]!.userId)).get();
    expect(author?.displayName).toBe('Day Shift · #news');
  });

  it('passes on nothing from a channel that closed, and what the target\'s rules refuse', async () => {
    await follow(OWNER);
    blockWord(SPACE_B, 'raid');
    await copyToFollowers(SPACE, await postNews('The raid is on'));
    expect(copiesIn()).toHaveLength(0);
    testDb.delete(schema.spaceModerationSettings).where(eq(schema.spaceModerationSettings.spaceId, SPACE_B)).run();
    testDb.insert(schema.channelOverrides).values({
      channelId: NEWS, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
    }).run();
    await copyToFollowers(SPACE, await postNews('For staff only'));
    expect(copiesIn()).toHaveLength(0);
  });

  it('passes on neither a poll nor what was passed on already, so follows make no chain', async () => {
    await follow(OWNER);
    const poll = await app.inject({
      method: 'POST', url: `/api/channels/${NEWS}/polls`, headers: headers(OWNER), payload: { question: 'Which?', options: ['a', 'b'] },
    });
    expect(poll.statusCode).toBe(201);
    await copyToFollowers(SPACE, poll.json());
    expect(copiesIn()).toHaveLength(0);

    await copyToFollowers(SPACE, await postNews('news'));
    expect(copiesIn()).toHaveLength(1);
    const copyAuthor = copiesIn()[0]!.userId;
    const asFollow = { ...(await postNews('again')), user: { id: copyAuthor, accountKind: 'follow' } } as unknown as Parameters<typeof copyToFollowers>[1];
    await copyToFollowers(SPACE, asFollow);
    expect(copiesIn()).toHaveLength(1);
  });

  it('leaves a post alone in a text channel, even with a follow from before', async () => {
    await follow(OWNER);
    testDb.update(schema.channels).set({ type: 'text' }).where(eq(schema.channels.id, NEWS)).run();
    await copyToFollowers(SPACE, await postNews('plain'));
    expect(copiesIn()).toHaveLength(0);
  });

  it('removes its account with it, unless messages still name it', async () => {
    const quiet = (await follow(OWNER)).json().id;
    const quietRow = testDb.select().from(schema.channelFollows).where(eq(schema.channelFollows.id, quiet)).get();
    await app.inject({ method: 'DELETE', url: `/api/channel-follows/${quiet}`, headers: headers(OWNER) });
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, quietRow!.accountId)).get()).toBeUndefined();

    const used = (await follow(OWNER)).json().id;
    const usedRow = testDb.select().from(schema.channelFollows).where(eq(schema.channelFollows.id, used)).get();
    await copyToFollowers(SPACE, await postNews('kept'));
    await app.inject({ method: 'DELETE', url: `/api/channel-follows/${used}`, headers: headers(OWNER) });
    removeUnusedWebhookAccounts();
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, usedRow!.accountId)).get()).toBeDefined();
    expect(copiesIn()).toHaveLength(1);
  });
});

describe('a space\'s own address', () => {
  const setCode = (userId: string, code: unknown, spaceId = SPACE) => app.inject({
    method: 'PUT', url: `/api/spaces/${spaceId}/vanity`, headers: headers(userId), payload: { code },
  });
  const preview = (code: string) => app.inject({ method: 'GET', url: `/api/spaces/invite/${code}/preview` });
  const join = (userId: string, code: string) => app.inject({ method: 'POST', url: '/api/spaces/join', headers: headers(userId), payload: { inviteCode: code } });

  it('is for who may manage the space', async () => {
    expect((await setCode(MEMBER, 'night-shift')).statusCode).toBe(403);
    expect((await setCode(OUTSIDER, 'night-shift')).statusCode).toBe(403);
    const res = await setCode(MOD, 'night-shift');
    expect(res.statusCode).toBe(200);
    expect(res.json().vanityCode).toBe('night-shift');
    expect(testDb.select().from(schema.spaceAuditLog).all().map((entry) => entry.action)).toEqual(['vanity_update']);
    expect(sentOfType('space_updated').at(-1)).toMatchObject({ space: { vanityCode: 'night-shift' } });
  });

  it('has a shape, and is stored in small letters', async () => {
    for (const bad of ['ab', 'x'.repeat(33), 'with space', '-edge', 'edge-', 'ümlaut', 'a/b', '']) {
      expect((await setCode(OWNER, bad)).json().code).toBe('vanity_code_invalid');
    }
    expect((await setCode(OWNER, 7)).statusCode).toBe(400);
    expect((await setCode(OWNER, '  Night-Shift ')).json().vanityCode).toBe('night-shift');
  });

  it('cannot pass for the operator or for what someone else has', async () => {
    for (const reserved of ['admin', 'tavvit', 'SUPPORT', 'official']) {
      expect((await setCode(OWNER, reserved)).json().code).toBe('vanity_code_reserved');
    }
    expect((await setCode(OWNER, 'night-shift')).statusCode).toBe(200);
    expect((await setCode(OWNER, 'night-shift', SPACE_B)).json().code).toBe('vanity_code_taken');
    testDb.insert(schema.spaceInvites).values({ code: 'abc12345', spaceId: SPACE_B, createdBy: OWNER, createdAt: 1 }).run();
    expect((await setCode(OWNER, 'abc12345')).json().code).toBe('vanity_code_taken');
    testDb.update(schema.spaces).set({ inviteCode: 'standing' }).where(eq(schema.spaces.id, SPACE_B)).run();
    expect((await setCode(OWNER, 'standing')).json().code).toBe('vanity_code_taken');
  });

  it('lets people in like any link, however it is typed', async () => {
    await setCode(OWNER, 'night-shift');
    expect((await preview('night-shift')).json().spaceName).toBe('Night Shift');
    expect((await preview('Night-Shift')).statusCode).toBe(200);
    expect((await join(OUTSIDER, 'NIGHT-shift')).statusCode).toBe(200);
    const member = testDb.select().from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, SPACE), eq(schema.spaceMembers.userId, OUTSIDER))).get();
    expect(member).toBeDefined();
    expect((await join(OUTSIDER, 'night-shift')).statusCode).toBe(409);
  });

  it('follows the space\'s visibility like any link, and does not let a banned person in', async () => {
    await setCode(OWNER, 'night-shift');
    testDb.update(schema.spaces).set({ visibility: 'request' }).where(eq(schema.spaces.id, SPACE)).run();
    expect((await join(OUTSIDER, 'night-shift')).json().code).toBe('join_request_required');
    testDb.update(schema.spaces).set({ visibility: 'private' }).where(eq(schema.spaces.id, SPACE)).run();
    testDb.insert(schema.bans).values({ spaceId: SPACE, userId: OUTSIDER, bannedBy: OWNER, createdAt: 1 }).run();
    expect((await join(OUTSIDER, 'night-shift')).json().code).toBe('user_banned');
  });

  it('counts as an invite for a space that refuses them', async () => {
    await setCode(OWNER, 'night-shift');
    testDb.insert(schema.spaceModerationSettings).values({ spaceId: SPACE, blockInvites: 1, updatedAt: 1 }).run();
    const say = (content: string) => app.inject({ method: 'POST', url: `/api/channels/${GENERAL}/messages`, headers: headers(MEMBER), payload: { content } });
    expect((await say('come to https://tavvit.com/join/Night-Shift')).json().code).toBe('automod_invite_blocked');
    expect((await say('see https://example.com/join/team')).statusCode).toBe(201);
  });

  it('stands apart from the space\'s links, and goes its own way', async () => {
    await setCode(OWNER, 'night-shift');
    const invites = (await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/invites`, headers: headers(OWNER) })).json().invites;
    expect(invites.map((invite: { code: string }) => invite.code)).not.toContain('night-shift');
    const revoke = await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE}/invites/night-shift`, headers: headers(OWNER) });
    expect(revoke.statusCode).toBe(404);
    expect((await preview('night-shift')).statusCode).toBe(200);
  });

  it('frees the old one when it changes, and goes with null', async () => {
    await setCode(OWNER, 'night-shift');
    await setCode(OWNER, 'day-shift');
    expect((await preview('night-shift')).statusCode).toBe(404);
    expect((await preview('day-shift')).statusCode).toBe(200);
    expect((await setCode(OWNER, 'night-shift', SPACE_B)).statusCode).toBe(200);
    expect((await setCode(OWNER, null)).json().vanityCode).toBeNull();
    expect((await preview('day-shift')).statusCode).toBe(404);
  });

  it('can be taken away by an administrator of the instance, and by nobody else, for good', async () => {
    const revoke = (userId: string, spaceId = SPACE) => app.inject({
      method: 'POST', url: `/api/admin/spaces/${spaceId}/vanity/revoke`, headers: headers(userId), payload: { reason: 'Passes for a bank.' },
    });
    await setCode(OWNER, 'night-shift');
    expect((await revoke(OWNER)).statusCode).toBe(403);
    expect((await revoke(MOD)).statusCode).toBe(403);
    expect((await revoke(ADMIN)).statusCode).toBe(200);
    expect((await preview('night-shift')).statusCode).toBe(404);
    expect((await revoke(ADMIN)).json().code).toBe('vanity_code_not_found');
    // Not by the space again, and not by another one either.
    expect((await setCode(OWNER, 'night-shift')).json().code).toBe('vanity_code_reserved');
    expect((await setCode(OWNER, 'night-shift', SPACE_B)).json().code).toBe('vanity_code_reserved');
    const audit = testDb.select().from(schema.platformAuditLog).all();
    expect(audit.map((entry) => [entry.action, entry.actorId, entry.reason])).toEqual([['space_vanity_revoke', ADMIN, 'Passes for a bank.']]);
    const notices = testDb.select().from(schema.userNotices).where(eq(schema.userNotices.userId, OWNER)).all();
    expect(notices.map((notice) => [notice.kind, notice.subject, notice.note])).toEqual([['address_withdrawn', '/join/night-shift', 'Passes for a bank.']]);
  });
});
