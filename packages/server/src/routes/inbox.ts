import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, ne, or, sql, like, type SQL } from 'drizzle-orm';
import type { MentionItem, MentionsResponse } from '@backspace/shared';
import { parseMentions } from '@backspace/shared/src/mentions.js';
import { getDb, schema } from '../db/index.js';
import { userWrittenMessages } from '../db/userWrittenMessages.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { computePermissions } from '../utils/permissions.js';
import { canCountUnread } from '../ws/channelUnreadCounts.js';
import { hydrateChannelMessages } from './messages.js';

export const MENTIONS_PAGE_DEFAULT = 25;
export const MENTIONS_PAGE_MAX = 50;
/** Candidate rows read per round. Most candidates are real mentions; a few are text inside code or a role the reader lacks. */
const SCAN_BATCH = 200;
/** Rounds per request, so one request never walks a whole archive of near misses. */
const MAX_ROUNDS = 5;

/**
 * Whether `content` reaches `userId`, holding `roleIds` in the message's space,
 * and how. The server stores a mass mention only from an author allowed to make
 * it (messages.ts, MENTION_EVERYONE), so the text is the truth here. Mentions
 * inside code blocks do not count (`parseMentions`).
 */
export function mentionReach(content: string | null, userId: string, roleIds: ReadonlySet<string>): MentionItem['via'] | null {
  const parsed = parseMentions(content);
  if (parsed.userIds.has(userId)) return 'user';
  for (const roleId of parsed.roleIds) {
    if (roleIds.has(roleId)) return 'role';
  }
  if (parsed.everyone) return 'everyone';
  return null;
}

/**
 * The name each person a page of messages mentions goes by in the message's space:
 * their nickname there, else what `userDisplayName` shows on the client. Only
 * members of that space are named, as they are in its member list. A token can
 * carry any id, and this must not become a way to look up a stranger's name.
 */
function mentionedNamesOf(
  rows: ReadonlyArray<{ content: string | null; channelId: string }>,
  channelSpace: ReadonlyMap<string, string>,
): Map<string, Map<string, string>> {
  const ids = new Set<string>();
  const spaceIds = new Set<string>();
  for (const row of rows) {
    for (const id of parseMentions(row.content).userIds) ids.add(id);
    const spaceId = channelSpace.get(row.channelId);
    if (spaceId) spaceIds.add(spaceId);
  }
  const bySpace = new Map<string, Map<string, string>>();
  if (ids.size === 0 || spaceIds.size === 0) return bySpace;

  for (const member of getDb().select({
    spaceId: schema.spaceMembers.spaceId,
    userId: schema.spaceMembers.userId,
    nickname: schema.spaceMembers.nickname,
    username: schema.users.username,
    displayName: schema.users.displayName,
  }).from(schema.spaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.spaceMembers.userId))
    .where(and(inArray(schema.spaceMembers.spaceId, [...spaceIds]), inArray(schema.spaceMembers.userId, [...ids])))
    .all()) {
    const names = bySpace.get(member.spaceId) ?? new Map<string, string>();
    names.set(member.userId, member.nickname || member.displayName || member.username.split('@')[0]!);
    bySpace.set(member.spaceId, names);
  }
  return bySpace;
}

/**
 * A page of the messages in this instance's space channels that `decide` picks for a reader,
 * newest first: only spaces they are a member of, only channels whose history they may read
 * (the same rule as the unread counts), never their own messages, never system rows.
 */
export function readerMessagesPage(
  userId: string,
  before: string | undefined,
  limit: number,
  textMatch: SQL | undefined,
  decide: (content: string | null, roleIds: ReadonlySet<string>) => MentionItem['via'] | null,
): MentionsResponse {
  const db = getDb();
  const memberships = db.select({ spaceId: schema.spaceMembers.spaceId })
    .from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, userId)).all();
  if (memberships.length === 0) {
    return { mentions: [], nextBefore: null };
  }
  const spaceIds = memberships.map((row) => row.spaceId);

  const rolesBySpace = new Map<string, Set<string>>();
  for (const row of db.select({ spaceId: schema.memberRoles.spaceId, roleId: schema.memberRoles.roleId })
    .from(schema.memberRoles).where(eq(schema.memberRoles.userId, userId)).all()) {
    const set = rolesBySpace.get(row.spaceId) ?? new Set<string>();
    set.add(row.roleId);
    rolesBySpace.set(row.spaceId, set);
  }

  const channelSpace = new Map<string, string>();
  for (const row of db.select({ id: schema.channels.id, spaceId: schema.channels.spaceId })
    .from(schema.channels).where(inArray(schema.channels.spaceId, spaceIds)).all()) {
    channelSpace.set(row.id, row.spaceId);
  }
  if (channelSpace.size === 0) {
    return { mentions: [], nextBefore: null };
  }

  const readable = new Map<string, boolean>();
  const canRead = (channelId: string, spaceId: string): boolean => {
    let allowed = readable.get(channelId);
    if (allowed === undefined) {
      allowed = canCountUnread(computePermissions(userId, spaceId, channelId));
      readable.set(channelId, allowed);
    }
    return allowed;
  };

  const found: Array<{ row: typeof schema.messages.$inferSelect; via: MentionItem['via'] }> = [];
  let cursor = before;
  let exhausted = false;
  for (let round = 0; round < MAX_ROUNDS && found.length <= limit && !exhausted; round++) {
    const rows = db.select().from(schema.messages).where(and(
      inArray(schema.messages.channelId, [...channelSpace.keys()]),
      ne(schema.messages.userId, userId),
      userWrittenMessages(),
      textMatch,
      cursor === undefined ? undefined : sql`CAST(${schema.messages.id} AS INTEGER) < CAST(${cursor} AS INTEGER)`,
    )).orderBy(desc(sql`CAST(${schema.messages.id} AS INTEGER)`)).limit(SCAN_BATCH).all();

    if (rows.length < SCAN_BATCH) exhausted = true;
    for (const row of rows) {
      const spaceId = channelSpace.get(row.channelId);
      if (!spaceId || !canRead(row.channelId, spaceId)) continue;
      const via = decide(row.content, rolesBySpace.get(spaceId) ?? new Set());
      if (via) found.push({ row, via });
      if (found.length > limit) break;
    }
    const last = rows[rows.length - 1];
    if (last) cursor = last.id;
  }

  const page = found.slice(0, limit);
  // Hydrate per channel (author, attachments, embeds, reactions), then restore newest-first order.
  const byChannel = new Map<string, Array<typeof schema.messages.$inferSelect>>();
  for (const { row } of page) {
    const list = byChannel.get(row.channelId) ?? [];
    list.push(row);
    byChannel.set(row.channelId, list);
  }
  const hydrated = new Map<string, MentionItem['message']>();
  for (const [channelId, rows] of byChannel) {
    for (const message of hydrateChannelMessages(channelId, rows)) hydrated.set(message.id, message);
  }
  const namesBySpace = mentionedNamesOf(page.map(({ row }) => row), channelSpace);
  const mentions: MentionItem[] = [];
  for (const { row, via } of page) {
    const message = hydrated.get(row.id);
    if (!message) continue;
    const spaceId = channelSpace.get(row.channelId)!;
    const names = namesBySpace.get(spaceId);
    const mentionedNames: Record<string, string> = {};
    for (const id of parseMentions(row.content).userIds) {
      const name = names?.get(id);
      if (name) mentionedNames[id] = name;
    }
    mentions.push({ spaceId, channelId: row.channelId, message, via, mentionedNames });
  }

  // The next page starts after the last item when this request saw more
  // than a page, after the last scanned row when it stopped scanning early,
  // and nowhere when the archive ended.
  const lastItem = page[page.length - 1];
  const nextBefore = found.length > limit && lastItem ? lastItem.row.id : exhausted ? null : cursor ?? null;
  return { mentions, nextBefore };
}

/**
 * The inbox's mentions: messages in this instance's space channels that
 * mention the signed-in user, newest first. Only spaces the user is a member
 * of, only channels whose history they may read (the same rule as the unread
 * counts), never their own messages, never system rows. The request is the
 * user's row on this instance, so a federated member asks the space's own
 * instance and gets that instance's answer (client-federation.md).
 */
export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { before?: string; limit?: string } }>(
    '/api/users/@me/mentions',
    // Each page reads through the histories of every space the person is in.
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = request.userId!;
      const { before } = request.query;
      if (before !== undefined && !/^\d{1,20}$/.test(before)) {
        return sendError(reply, 400, 'validation_failed');
      }
      const requested = request.query.limit === undefined ? MENTIONS_PAGE_DEFAULT : Number(request.query.limit);
      if (!Number.isInteger(requested) || requested < 1) return sendError(reply, 400, 'validation_failed');
      const limit = Math.min(requested, MENTIONS_PAGE_MAX);

      // A cheap text prefilter; mentionReach decides. Role tokens are matched
      // generically because the roles differ per space.
      const textMatch = or(
        like(schema.messages.content, `%<@${userId}>%`),
        like(schema.messages.content, '%<@&%'),
        like(schema.messages.content, '%@everyone%'),
        like(schema.messages.content, '%@here%'),
      );
      const page = readerMessagesPage(userId, before, limit, textMatch, (content, roleIds) => mentionReach(content, userId, roleIds));
      return reply.code(200).send(page);
    },
  );
}
