import type { FastifyInstance } from 'fastify';
import { and, eq, notInArray } from 'drizzle-orm';
import { MAX_MESSAGE_LENGTH } from '@backspace/shared';
import { hasGatedMassMention } from '@backspace/shared/src/mentions.js';
import {
  FORUM_LIMITS,
  isForumTagColor,
  type CreateForumPostRequest,
  type ForumPostsResponse,
  type UpdateForumTagsRequest,
} from '@backspace/shared/src/forums.js';
import { THREAD_LIMITS } from '@backspace/shared/src/threads.js';
import { getDb, schema } from '../db/index.js';
import { auditChange, recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { checkedPostTags, forumPostOrder, forumPostRowOf, forumPostsFor, forumTagsOf } from '../utils/forums.js';
import { sendError } from '../utils/httpErrors.js';
import { mayPostSticker } from '../utils/remoteMedia.js';
import { mentionableRoleIds } from '../utils/mentionableRoles.js';
import { hasPermission, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { memberActionRefusal, recordSlowmodePost, spaceMessageRefusal } from '../utils/spaceModeration.js';
import { followThread, threadInfoOf, threadRowOf, threadSummaryOf, type ThreadRow } from '../utils/threads.js';
import { connectionManager } from '../ws/handler.js';
import { attachmentRefusal, postChannelMessage } from './messages.js';

const READ = PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY;
const POST = PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES | PermissionBits.CREATE_THREADS;

export async function forumRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/channels/:id/posts?tag=&before= - A forum's tags and a page of its posts, the latest activity first
  app.get<{ Params: { id: string }; Querystring: { tag?: string; before?: string } }>('/api/channels/:id/posts', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;
    const channel = getDb().select({ spaceId: schema.channels.spaceId, type: schema.channels.type })
      .from(schema.channels).where(eq(schema.channels.id, id)).get();
    if (!channel) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, channel.spaceId, READ, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }
    if (channel.type !== 'forum') return sendError(reply, 400, 'forum_required');
    const { tag, before } = request.query;
    const order = forumPostOrder(id, { ...(tag ? { tagId: tag } : {}), ...(before ? { before } : {}) });
    const response: ForumPostsResponse = {
      tags: forumTagsOf(id),
      posts: forumPostsFor(order.rows.map((row) => row.id), request.userId),
      nextBefore: order.nextBefore,
    };
    return reply.code(200).send(response);
  });

  // POST /api/channels/:id/posts - Start a post: a thread whose first message is the post itself
  app.post<{ Params: { id: string }; Body: CreateForumPostRequest }>('/api/channels/:id/posts', {
    preHandler: authenticate,
    config: { botAllowed: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId } = request;
    const db = getDb();
    const channel = db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
    if (!channel) return sendError(reply, 404, 'channel_not_found');
    const { spaceId } = channel;
    if (!hasPermission(userId, spaceId, POST, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'SEND_MESSAGES and CREATE_THREADS' });
    }
    if (channel.type !== 'forum') return sendError(reply, 400, 'forum_required');

    const body = request.body ?? ({} as CreateForumPostRequest);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > THREAD_LIMITS.NAME_MAX_LENGTH) return sendError(reply, 400, 'forum_post_title_invalid');

    const attachmentIds = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachmentIds.length > 0 && !hasPermission(userId, spaceId, PermissionBits.ATTACH_FILES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'ATTACH_FILES' });
    }
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content && attachmentIds.length === 0) return sendError(reply, 400, 'message_empty');
    if (content.length > MAX_MESSAGE_LENGTH) return sendError(reply, 400, 'content_too_long', { max: MAX_MESSAGE_LENGTH });
    if (!mayPostSticker(content, userId)) return sendError(reply, 400, 'sticker_elsewhere');
    if (hasGatedMassMention(content, mentionableRoleIds(spaceId)) && !hasPermission(userId, spaceId, PermissionBits.MENTION_EVERYONE, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MENTION_EVERYONE' });
    }

    const tags = checkedPostTags(id, body.tagIds);
    if ('problem' in tags) {
      return tags.problem === 'too_many'
        ? sendError(reply, 400, 'forum_post_tag_limit', { max: FORUM_LIMITS.TAGS_PER_POST })
        : sendError(reply, 400, 'forum_tag_unknown');
    }

    // The title is read out in the list too, so the space's rules read it with the words.
    const now = Date.now();
    const refusal = spaceMessageRefusal({ spaceId, channelId: id, userId, content: content ? `${title}\n${content}` : title, kind: 'post', now });
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
    const badFile = attachmentRefusal(attachmentIds, userId);
    if (badFile) return sendError(reply, 400, badFile);

    const threadId = generateSnowflake();
    db.transaction((tx) => {
      tx.insert(schema.channels).values({
        id: threadId,
        spaceId,
        name: title,
        type: 'thread',
        position: 0,
        slowmodeSeconds: channel.slowmodeSeconds,
        parentChannelId: id,
        threadCreatedBy: userId,
        createdAt: now,
      }).run();
      for (const tagId of tags.tagIds) tx.insert(schema.forumPostTags).values({ threadId, tagId }).run();
      // A forum's slow mode counts posts, not what is said in them.
      recordSlowmodePost(tx, id, userId, now);
    });
    followThread(threadId, userId, now);
    const row = threadRowOf(threadId);
    if (!row) return sendError(reply, 500, 'internal_error');
    recordAudit({ spaceId, actorId: userId, action: 'thread_create', targetType: 'channel', targetId: threadId, targetLabel: title });

    // The client learns of the thread before its first message, or the message would have nowhere to go.
    connectionManager.sendToUser(userId, { type: 'thread_followed', thread: threadInfoOf(row, userId) });
    const message = postChannelMessage({
      channelId: threadId,
      spaceId,
      userId,
      text: content || null,
      attachmentIds,
      ...(body.spoilerAttachments ? { spoilerAttachments: body.spoilerAttachments } : {}),
      now,
    });
    if (!message) return sendError(reply, 500, 'internal_error');
    const [post] = forumPostsFor([threadId], userId);
    return reply.code(201).send(post);
  });

  // GET /api/channels/:id/forum-tags - A forum's tags
  app.get<{ Params: { id: string } }>('/api/channels/:id/forum-tags', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const channel = getDb().select({ spaceId: schema.channels.spaceId, type: schema.channels.type })
      .from(schema.channels).where(eq(schema.channels.id, id)).get();
    if (!channel) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, channel.spaceId, PermissionBits.VIEW_CHANNEL, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL' });
    }
    if (channel.type !== 'forum') return sendError(reply, 400, 'forum_required');
    return reply.code(200).send({ tags: forumTagsOf(id) });
  });

  // PUT /api/channels/:id/forum-tags - All of a forum's tags at once
  app.put<{ Params: { id: string }; Body: UpdateForumTagsRequest }>('/api/channels/:id/forum-tags', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const channel = getDb().select({ spaceId: schema.channels.spaceId, type: schema.channels.type, name: schema.channels.name })
      .from(schema.channels).where(eq(schema.channels.id, id)).get();
    if (!channel) return sendError(reply, 404, 'channel_not_found');
    const { spaceId } = channel;
    if (!hasPermission(request.userId, spaceId, PermissionBits.MANAGE_CHANNELS, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_CHANNELS' });
    }
    if (channel.type !== 'forum') return sendError(reply, 400, 'forum_required');

    const given = request.body?.tags;
    if (!Array.isArray(given)) return sendError(reply, 400, 'validation_failed', { field: 'tags' });
    if (given.length > FORUM_LIMITS.TAGS_PER_FORUM) {
      return sendError(reply, 400, 'forum_tag_limit_reached', { max: FORUM_LIMITS.TAGS_PER_FORUM });
    }
    const seen = new Set<string>();
    const cleaned: Array<{ id: string | null; name: string; color: string | null }> = [];
    for (const tag of given) {
      const name = typeof tag?.name === 'string' ? tag.name.trim() : '';
      if (!name || name.length > FORUM_LIMITS.TAG_NAME_MAX_LENGTH) {
        return sendError(reply, 400, 'forum_tag_name_length', { max: FORUM_LIMITS.TAG_NAME_MAX_LENGTH });
      }
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) return sendError(reply, 400, 'forum_tag_duplicate');
      seen.add(key);
      if (tag.color !== undefined && tag.color !== null && !isForumTagColor(tag.color)) {
        return sendError(reply, 400, 'validation_failed', { field: 'color' });
      }
      cleaned.push({ id: typeof tag.id === 'string' ? tag.id : null, name, color: tag.color ?? null });
    }

    const db = getDb();
    const before = forumTagsOf(id);
    const beforeIds = new Set(before.map((tag) => tag.id));
    if (cleaned.some((tag) => tag.id !== null && !beforeIds.has(tag.id))) return sendError(reply, 400, 'forum_tag_unknown');

    const now = Date.now();
    db.transaction((tx) => {
      const keptIds = cleaned.flatMap((tag) => (tag.id ? [tag.id] : []));
      tx.delete(schema.forumTags).where(keptIds.length > 0
        ? and(eq(schema.forumTags.channelId, id), notInArray(schema.forumTags.id, keptIds))
        : eq(schema.forumTags.channelId, id)).run();
      cleaned.forEach((tag, position) => {
        if (tag.id) {
          tx.update(schema.forumTags).set({ name: tag.name, color: tag.color, position }).where(eq(schema.forumTags.id, tag.id)).run();
        } else {
          tx.insert(schema.forumTags).values({ id: generateSnowflake(), channelId: id, name: tag.name, color: tag.color, position, createdAt: now }).run();
        }
      });
    });
    const tags = forumTagsOf(id);
    recordAudit({
      spaceId,
      actorId: request.userId,
      action: 'forum_tags_update',
      targetType: 'channel',
      targetId: id,
      targetLabel: channel.name,
      changes: [auditChange('tags', before.map((tag) => tag.name).join(', '), tags.map((tag) => tag.name).join(', '))],
    });
    connectionManager.sendToChannel(spaceId, id, { type: 'forum_tags_updated', channelId: id, tags });
    return reply.code(200).send({ tags });
  });

  /** May this person change a post's tags: who started it, or someone who may manage the channel's messages. */
  const mayTag = (row: ThreadRow, userId: string): boolean => row.threadCreatedBy === userId
    || hasPermission(userId, row.spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_MESSAGES, row.id);

  // PUT /api/threads/:id/tags - The tags of a post
  app.put<{ Params: { id: string }; Body: { tagIds?: unknown } }>('/api/threads/:id/tags', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const row = forumPostRowOf(request.params.id);
    if (!row) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, row.spaceId, READ, row.id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }
    if (!mayTag(row, request.userId)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_MESSAGES' });
    const held = memberActionRefusal(row.spaceId, request.userId);
    if (held) return sendError(reply, held.status, held.code, held.details);
    const tags = checkedPostTags(row.parentChannelId, request.body?.tagIds);
    if ('problem' in tags) {
      return tags.problem === 'too_many'
        ? sendError(reply, 400, 'forum_post_tag_limit', { max: FORUM_LIMITS.TAGS_PER_POST })
        : sendError(reply, 400, 'forum_tag_unknown');
    }
    const db = getDb();
    db.transaction((tx) => {
      tx.delete(schema.forumPostTags).where(eq(schema.forumPostTags.threadId, row.id)).run();
      for (const tagId of tags.tagIds) tx.insert(schema.forumPostTags).values({ threadId: row.id, tagId }).run();
    });
    connectionManager.sendToChannel(row.spaceId, row.parentChannelId, {
      type: 'thread_updated', parentChannelId: row.parentChannelId, starterMessageId: null, thread: threadSummaryOf(row),
    });
    return reply.code(200).send({ tagIds: tags.tagIds });
  });
}
