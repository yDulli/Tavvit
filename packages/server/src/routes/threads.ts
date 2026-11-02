import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { THREAD_LIMITS, threadArchived, type ThreadOpened } from '@backspace/shared/src/threads.js';
import { getDb, schema } from '../db/index.js';
import { auditChange, recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { deleteAttachmentFiles } from '../utils/fileCleanup.js';
import { sendError } from '../utils/httpErrors.js';
import { getChannelSpaceId, hasPermission, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { memberActionRefusal, spaceMessageRefusal } from '../utils/spaceModeration.js';
import {
  defaultThreadName,
  followThread,
  threadInfoOf,
  threadRowOf,
  threadSummaryOf,
  type ThreadRow,
} from '../utils/threads.js';
import { connectionManager } from '../ws/handler.js';
import { hydrateChannelMessages } from './messages.js';

const FALLBACK_NAME = 'Thread';

/** A name as given, or null when it is not one. */
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= THREAD_LIMITS.NAME_MAX_LENGTH ? name : null;
}

export async function threadRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/messages/:id/thread - Start a thread from a message, or open the one it has
  app.post<{ Params: { id: string }; Body: { name?: unknown } | undefined }>('/api/messages/:id/thread', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const db = getDb();
    const starter = db.select().from(schema.messages).where(eq(schema.messages.id, request.params.id)).get();
    if (!starter) return sendError(reply, 404, 'message_not_found');
    if (starter.type === 'system') return sendError(reply, 403, 'system_message_immutable');
    const parent = db.select().from(schema.channels).where(eq(schema.channels.id, starter.channelId)).get();
    if (!parent) return sendError(reply, 404, 'channel_not_found');
    const { spaceId } = parent;
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, parent.id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }

    const existing = db.select().from(schema.channels).where(eq(schema.channels.threadStarterMessageId, starter.id)).get();
    if (existing?.parentChannelId) return reply.code(200).send(threadInfoOf(existing as ThreadRow, request.userId));

    // A thread grows from a text or an announcement channel: not from a voice channel's chat, not from another thread.
    if (parent.type !== 'text' && parent.type !== 'announcement') return sendError(reply, 400, 'thread_not_allowed');
    if (!hasPermission(request.userId, spaceId, PermissionBits.CREATE_THREADS, parent.id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'CREATE_THREADS' });
    }
    const now = Date.now();
    const timeout = memberActionRefusal(spaceId, request.userId, now);
    if (timeout) return sendError(reply, timeout.status, timeout.code, timeout.details);

    const asked = request.body?.name;
    const name = asked === undefined || asked === '' ? (defaultThreadName(starter.content) ?? FALLBACK_NAME) : cleanName(asked);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    if (asked) {
      const refusal = spaceMessageRefusal({ spaceId, channelId: parent.id, userId: request.userId, content: name, kind: 'edit', now });
      if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
    }

    const id = generateSnowflake();
    db.insert(schema.channels).values({
      id,
      spaceId,
      name,
      type: 'thread',
      position: 0,
      slowmodeSeconds: parent.slowmodeSeconds,
      parentChannelId: parent.id,
      threadStarterMessageId: starter.id,
      threadCreatedBy: request.userId,
      createdAt: now,
    }).run();
    followThread(id, request.userId, now);

    const row = threadRowOf(id);
    if (!row) return sendError(reply, 500, 'internal_error');
    recordAudit({ spaceId, actorId: request.userId, action: 'thread_create', targetType: 'channel', targetId: id, targetLabel: name });
    connectionManager.sendToChannel(spaceId, parent.id, {
      type: 'thread_updated', parentChannelId: parent.id, starterMessageId: starter.id, thread: threadSummaryOf(row),
    });
    const info = threadInfoOf(row, request.userId);
    connectionManager.sendToUser(request.userId, { type: 'thread_followed', thread: info });
    return reply.code(201).send(info);
  });

  // GET /api/channels/:id/threads?archived=1 - A channel's threads, the latest activity first
  app.get<{ Params: { id: string }; Querystring: { archived?: string } }>('/api/channels/:id/threads', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }
    const wantArchived = request.query.archived === '1';
    const now = Date.now();
    const rows = getDb().select().from(schema.channels)
      .where(and(eq(schema.channels.parentChannelId, id), eq(schema.channels.type, 'thread'), isNotNull(schema.channels.parentChannelId)))
      .all() as ThreadRow[];
    const threads = rows
      .map((row) => threadInfoOf(row, request.userId))
      .filter((thread) => threadArchived(thread, now) === wantArchived)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))
      .slice(0, THREAD_LIMITS.LIST_MAX);
    return reply.code(200).send({ threads });
  });

  /** The thread a person may read, or why not. */
  const readable = (threadId: string, userId: string) => {
    const row = threadRowOf(threadId);
    if (!row) return { ok: false, status: 404, code: 'channel_not_found' } as const;
    if (!hasPermission(userId, row.spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, row.id)) {
      return { ok: false, status: 403, code: 'missing_permission', details: { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' } } as const;
    }
    return { ok: true, row } as const;
  };

  // GET /api/threads/:id - A thread and the message it grew from
  app.get<{ Params: { id: string } }>('/api/threads/:id', { preHandler: authenticate }, async (request, reply) => {
    const found = readable(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const { row } = found;
    const starterRow = row.threadStarterMessageId
      ? getDb().select().from(schema.messages).where(eq(schema.messages.id, row.threadStarterMessageId)).get()
      : undefined;
    const [starter] = starterRow ? hydrateChannelMessages(row.parentChannelId, [starterRow], request.userId) : [];
    const response: ThreadOpened = { thread: threadInfoOf(row, request.userId), starter: starter ?? null };
    return reply.code(200).send(response);
  });

  // PUT /api/threads/:id/follow - Hear about it
  app.put<{ Params: { id: string } }>('/api/threads/:id/follow', { preHandler: authenticate }, async (request, reply) => {
    const found = readable(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    followThread(found.row.id, request.userId);
    const info = threadInfoOf(found.row, request.userId);
    connectionManager.sendToUser(request.userId, { type: 'thread_followed', thread: info });
    return reply.code(200).send(info);
  });

  // DELETE /api/threads/:id/follow - Stop hearing about it
  app.delete<{ Params: { id: string } }>('/api/threads/:id/follow', { preHandler: authenticate }, async (request, reply) => {
    const row = threadRowOf(request.params.id);
    if (!row) return sendError(reply, 404, 'channel_not_found');
    getDb().delete(schema.threadMembers)
      .where(and(eq(schema.threadMembers.threadId, row.id), eq(schema.threadMembers.userId, request.userId)))
      .run();
    connectionManager.sendToUser(request.userId, { type: 'thread_unfollowed', threadId: row.id });
    return reply.code(200).send(threadInfoOf(row, request.userId));
  });

  /** May this person rename or delete it: who started it, or someone who may manage the channel's messages. */
  const canManage = (row: ThreadRow, userId: string): boolean => row.threadCreatedBy === userId
    || hasPermission(userId, row.spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_MESSAGES, row.id);

  // PATCH /api/threads/:id - Rename it
  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>('/api/threads/:id', { preHandler: authenticate }, async (request, reply) => {
    const found = readable(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const { row } = found;
    if (!canManage(row, request.userId)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_MESSAGES' });
    const name = cleanName(request.body?.name);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    const refusal = spaceMessageRefusal({ spaceId: row.spaceId, channelId: row.id, userId: request.userId, content: name, kind: 'edit' });
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);

    getDb().update(schema.channels).set({ name }).where(eq(schema.channels.id, row.id)).run();
    const updated = threadRowOf(row.id);
    if (!updated) return sendError(reply, 500, 'internal_error');
    recordAudit({
      spaceId: row.spaceId,
      actorId: request.userId,
      action: 'thread_update',
      targetType: 'channel',
      targetId: row.id,
      targetLabel: name,
      changes: [auditChange('name', row.name, name)],
    });
    connectionManager.sendToChannel(row.spaceId, row.parentChannelId, {
      type: 'thread_updated', parentChannelId: row.parentChannelId, starterMessageId: row.threadStarterMessageId, thread: threadSummaryOf(updated),
    });
    return reply.code(200).send(threadInfoOf(updated, request.userId));
  });

  // DELETE /api/threads/:id - Delete it and everything said in it
  app.delete<{ Params: { id: string } }>('/api/threads/:id', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const found = readable(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const { row } = found;
    if (!canManage(row, request.userId)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_MESSAGES' });

    const db = getDb();
    const messageIds = db.select({ id: schema.messages.id }).from(schema.messages)
      .where(eq(schema.messages.channelId, row.id)).all().map((message) => message.id);
    const files = messageIds.length > 0
      ? db.select({ filename: schema.attachments.filename }).from(schema.attachments)
        .where(inArray(schema.attachments.messageId, messageIds)).all()
      : [];
    db.transaction((tx) => {
      tx.delete(schema.readStates).where(eq(schema.readStates.channelId, row.id)).run();
      tx.delete(schema.messages).where(eq(schema.messages.channelId, row.id)).run();
      tx.delete(schema.channels).where(eq(schema.channels.id, row.id)).run();
    });
    deleteAttachmentFiles(files);
    recordAudit({ spaceId: row.spaceId, actorId: request.userId, action: 'thread_delete', targetType: 'channel', targetId: row.id, targetLabel: row.name });
    connectionManager.sendToChannel(row.spaceId, row.parentChannelId, {
      type: 'thread_deleted', threadId: row.id, parentChannelId: row.parentChannelId, starterMessageId: row.threadStarterMessageId,
    });
    return reply.code(200).send({ success: true });
  });
}
