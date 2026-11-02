import { and, asc, eq, inArray } from 'drizzle-orm';
import { FORUM_LIMITS, isForumTagColor, type ForumPost, type ForumTag } from '@backspace/shared/src/forums.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { sanitizeUser } from './sanitize.js';
import { plainWordsOf, threadInfoOf, threadRowOf, type ThreadRow } from './threads.js';

type TagRow = typeof schema.forumTags.$inferSelect;

function tagOf(row: TagRow): ForumTag {
  return { id: row.id, name: row.name, color: isForumTagColor(row.color) ? row.color : null };
}

/** A forum's tags, in the order they stand. */
export function forumTagsOf(channelId: string): ForumTag[] {
  return getDb().select().from(schema.forumTags)
    .where(eq(schema.forumTags.channelId, channelId))
    .orderBy(asc(schema.forumTags.position))
    .all()
    .map(tagOf);
}

/** The channel as a forum, or null when it is something else. */
export function forumRowOf(channelId: string): typeof schema.channels.$inferSelect | null {
  const row = getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  return row?.type === 'forum' ? row : null;
}

/** The forum a post is in, when this thread is a post of one. */
export function forumPostRowOf(threadId: string): ThreadRow | null {
  const row = threadRowOf(threadId);
  return row && forumRowOf(row.parentChannelId) ? row : null;
}

/**
 * The tags someone asked for on a post, or what is wrong with them. They must be this forum's,
 * and each counts once.
 */
export function checkedPostTags(forumId: string, given: unknown): { tagIds: string[] } | { problem: 'unknown' | 'too_many' } {
  if (given === undefined || given === null) return { tagIds: [] };
  if (!Array.isArray(given) || given.some((id) => typeof id !== 'string')) return { problem: 'unknown' };
  const tagIds = [...new Set(given as string[])];
  if (tagIds.length > FORUM_LIMITS.TAGS_PER_POST) return { problem: 'too_many' };
  if (tagIds.length === 0) return { tagIds };
  const known = getDb().select({ id: schema.forumTags.id }).from(schema.forumTags)
    .where(and(eq(schema.forumTags.channelId, forumId), inArray(schema.forumTags.id, tagIds)))
    .all();
  return known.length === tagIds.length ? { tagIds } : { problem: 'unknown' };
}

interface PostOrder {
  id: string;
  activity: number;
}

const CURSOR = /^(\d+):(\d+)$/;

/**
 * One page of a forum's posts, the latest activity first: when someone last wrote in it, or
 * when it was started. `before` goes on from the last of the page before.
 */
export function forumPostOrder(forumId: string, options: { tagId?: string; before?: string }): { rows: PostOrder[]; nextBefore: string | null } {
  const cursor = options.before ? CURSOR.exec(options.before) : null;
  const params: Array<string | number> = [forumId];
  if (options.tagId) params.push(options.tagId);
  if (cursor) params.push(Number(cursor[1]), Number(cursor[1]), cursor[2]!);
  const limit = FORUM_LIMITS.PAGE_SIZE;
  params.push(limit + 1);
  const rows = getRawDb().prepare(`
    SELECT id, activity FROM (
      SELECT c.id AS id,
             COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id AND m.type = 'user'), c.created_at) AS activity
      FROM channels c
      WHERE c.parent_channel_id = ? AND c.type = 'thread'
      ${options.tagId ? 'AND EXISTS (SELECT 1 FROM forum_post_tags t WHERE t.thread_id = c.id AND t.tag_id = ?)' : ''}
    )
    ${cursor ? 'WHERE activity < ? OR (activity = ? AND CAST(id AS INTEGER) < CAST(? AS INTEGER))' : ''}
    ORDER BY activity DESC, CAST(id AS INTEGER) DESC
    LIMIT ?
  `).all(...params) as PostOrder[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextBefore: rows.length > limit && last ? `${last.activity}:${last.id}` : null };
}

/** What a post shows in its forum's list, as this reader sees it. */
export function forumPostsFor(threadIds: readonly string[], readerId: string): ForumPost[] {
  const db = getDb();
  const posts: ForumPost[] = [];
  for (const id of threadIds) {
    const row = threadRowOf(id);
    if (!row) continue;
    const first = db.select().from(schema.messages)
      .where(and(eq(schema.messages.channelId, id), eq(schema.messages.type, 'user')))
      .orderBy(asc(schema.messages.createdAt))
      .limit(1)
      .get();
    const picture = first
      ? db.select({
        filename: schema.attachments.filename,
        thumbnailFilename: schema.attachments.thumbnailFilename,
        mimetype: schema.attachments.mimetype,
        spoiler: schema.attachments.spoiler,
      }).from(schema.attachments).where(eq(schema.attachments.messageId, first.id)).all()
        .find((attachment) => attachment.mimetype.startsWith('image/') && !attachment.spoiler)
      : undefined;
    const author = row.threadCreatedBy
      ? db.select().from(schema.users).where(eq(schema.users.id, row.threadCreatedBy)).get()
      : undefined;
    const info = threadInfoOf(row, readerId);
    posts.push({
      ...info,
      tagIds: info.tagIds ?? [],
      author: author ? sanitizeUser(author) : null,
      preview: first ? plainWordsOf(first.content)?.slice(0, FORUM_LIMITS.PREVIEW_LENGTH) ?? null : null,
      thumbnail: picture ? picture.thumbnailFilename ?? picture.filename : null,
    });
  }
  return posts;
}
