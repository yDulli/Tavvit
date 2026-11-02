import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { MessageWithUser } from '@backspace/shared';
import { emojiTokensToText } from '@backspace/shared/src/customEmoji.js';
import { parseMentions, splitMentions } from '@backspace/shared/src/mentions.js';
import { withoutSpoilers } from '@backspace/shared/src/spoilers.js';
import { THREAD_LIMITS, type ThreadInfo, type ThreadSummary } from '@backspace/shared/src/threads.js';
import { getDb, schema } from '../db/index.js';
import { computePermissions, PermissionBits, permissionsToString } from './permissions.js';

export type ThreadRow = typeof schema.channels.$inferSelect & { parentChannelId: string };

/** The thread with this channel id, or null when it is an ordinary channel. */
export function threadRowOf(channelId: string): ThreadRow | null {
  const row = getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  return row?.type === 'thread' && row.parentChannelId ? (row as ThreadRow) : null;
}

function activityOf(threadIds: readonly string[]): Map<string, { count: number; last: number | null }> {
  if (threadIds.length === 0) return new Map();
  const rows = getDb().select({
    channelId: schema.messages.channelId,
    count: sql<number>`count(*)`,
    last: sql<number | null>`max(${schema.messages.createdAt})`,
  }).from(schema.messages)
    .where(and(inArray(schema.messages.channelId, [...threadIds]), eq(schema.messages.type, 'user')))
    .groupBy(schema.messages.channelId)
    .all();
  return new Map(rows.map((row) => [row.channelId, { count: row.count, last: row.last }]));
}

/** What the messages among these that started a thread show of it, by message. */
export function threadSummariesForMessages(messageIds: readonly string[]): Map<string, ThreadSummary> {
  const result = new Map<string, ThreadSummary>();
  if (messageIds.length === 0) return result;
  const rows = getDb().select({
    id: schema.channels.id,
    name: schema.channels.name,
    starter: schema.channels.threadStarterMessageId,
  }).from(schema.channels)
    .where(inArray(schema.channels.threadStarterMessageId, [...messageIds]))
    .all();
  const activity = activityOf(rows.map((row) => row.id));
  for (const row of rows) {
    if (!row.starter) continue;
    const seen = activity.get(row.id);
    result.set(row.starter, { id: row.id, name: row.name, messageCount: seen?.count ?? 0, lastMessageAt: seen?.last ?? null });
  }
  return result;
}

export function threadSummaryOf(row: ThreadRow): ThreadSummary {
  const seen = activityOf([row.id]).get(row.id);
  return {
    id: row.id,
    name: row.name,
    messageCount: seen?.count ?? 0,
    lastMessageAt: seen?.last ?? null,
    // Only a thread with no message it grew from can be a forum's post, so one that has one asks nothing more.
    ...(row.threadStarterMessageId === null ? { tagIds: tagIdsOfPost(row.id) } : {}),
  };
}

function tagIdsOfPost(threadId: string): string[] {
  return getDb().select({ tagId: schema.forumPostTags.tagId }).from(schema.forumPostTags)
    .where(eq(schema.forumPostTags.threadId, threadId))
    .all()
    .map((row) => row.tagId);
}

export function isFollowing(threadId: string, userId: string): boolean {
  return getDb().select({ userId: schema.threadMembers.userId }).from(schema.threadMembers)
    .where(and(eq(schema.threadMembers.threadId, threadId), eq(schema.threadMembers.userId, userId)))
    .get() !== undefined;
}

/** The thread as a reader sees it. */
export function threadInfoOf(row: ThreadRow, readerId: string): ThreadInfo {
  return {
    ...threadSummaryOf(row),
    spaceId: row.spaceId,
    parentChannelId: row.parentChannelId,
    starterMessageId: row.threadStarterMessageId,
    createdBy: row.threadCreatedBy,
    createdAt: row.createdAt,
    following: isFollowing(row.id, readerId),
    lastMessageId: getDb().select({ id: schema.messages.id }).from(schema.messages)
      .where(and(eq(schema.messages.channelId, row.id), eq(schema.messages.type, 'user')))
      .orderBy(desc(sql`CAST(${schema.messages.id} AS INTEGER)`))
      .limit(1)
      .get()?.id ?? null,
    myPermissions: permissionsToString(computePermissions(readerId, row.spaceId, row.id)),
  };
}

/** Whether a follow was added: false when they followed it already. */
export function followThread(threadId: string, userId: string, now: number = Date.now()): boolean {
  return getDb().insert(schema.threadMembers)
    .values({ threadId, userId, joinedAt: now })
    .onConflictDoNothing()
    .run().changes > 0;
}

export function threadFollowers(threadId: string): string[] {
  return getDb().select({ userId: schema.threadMembers.userId }).from(schema.threadMembers)
    .where(eq(schema.threadMembers.threadId, threadId))
    .all()
    .map((row) => row.userId);
}

/**
 * Who starts following because of this message: its author, and anyone it names who can see
 * the thread. Mass mentions do not make followers: that would be the whole space.
 */
export function followersFromMessage(thread: ThreadRow, message: MessageWithUser, now: number = Date.now()): string[] {
  if (message.type === 'system') return [];
  const named = [...parseMentions(message.content).userIds].filter((userId) => {
    const permissions = computePermissions(userId, thread.spaceId, thread.id);
    return (permissions & (PermissionBits.VIEW_CHANNEL | PermissionBits.ADMINISTRATOR)) !== 0n;
  });
  return [...new Set([message.userId, ...named])].filter((userId) => followThread(thread.id, userId, now));
}

const MARKS = /[*_~`#>|]/g;

/** A message as plain words: no marks, nobody named, nothing a spoiler hides. */
function plainTextOf(content: string): string {
  const plain = splitMentions(withoutSpoilers(content))
    .map((part) => (part.kind === 'text' ? part.text : ''))
    .join('');
  return emojiTokensToText(plain).replace(MARKS, '');
}

/** A name for a thread from the message it grew from: its first line as plain words. */
export function defaultThreadName(content: string | null): string | null {
  if (!content) return null;
  const firstLine = plainTextOf(content).split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!firstLine || /^sticker:/.test(firstLine)) return null;
  return firstLine.slice(0, THREAD_LIMITS.NAME_MAX_LENGTH);
}

/** What a list can show of a message: all its words on one line, or null when it has none. */
export function plainWordsOf(content: string | null): string | null {
  if (!content) return null;
  const words = plainTextOf(content).replace(/\s+/g, ' ').trim();
  return !words || /^sticker:/.test(words) ? null : words;
}
