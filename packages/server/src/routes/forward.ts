import { withoutMentions } from '../utils/neutralMentions.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { MAX_MESSAGE_LENGTH, type ForwardMessageRequest } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { reserveUpload, releaseUpload, uploadRefusal } from '../utils/accountLimits.js';
import { copyAttachments, DiskFullError, isOnThisDisk, type AttachmentRow, type CopiedAttachment } from '../utils/attachmentCopies.js';
import { authenticate } from '../utils/auth.js';
import { dmPostRefusal } from '../utils/dmMessageRules.js';
import { resolveEmbeds } from '../utils/embedResolver.js';
import { queueDmRelay } from '../utils/federationOutbox.js';
import { sendError } from '../utils/httpErrors.js';
import { getChannelSpaceId, hasPermission, isDmMember, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { recordSlowmodePost, spaceMessageRefusal } from '../utils/spaceModeration.js';
import { connectionManager } from '../ws/handler.js';
import { broadcastDmMessage, getDmMessageWithUser } from './dm.js';
import { hydrateChannelMessages } from './messages.js';

/**
 * Forwarding a message (docs/systems/api.md, "Forwarding"): a new message of the person
 * forwarding it, in a place they may write, with a copy of its words and files and the
 * `forwarded` mark. It names neither the place it came from nor who wrote it, so it stays
 * as it is when the original goes. Its files are new names for the same files on this disk,
 * hard links where the disk makes them, because deleting a message deletes its files' names.
 * They count on the forwarder's storage as an upload would, and are refused as one would be:
 * otherwise forwarding one file over and over filled the disk, beyond any limit. Both ends are
 * on this instance: a channel on another one is that instance's to write.
 */

type ForwardTarget =
  | { kind: 'channel'; spaceId: string; channelId: string }
  | { kind: 'dm'; dmId: string };

/** Where it lands, once its words and files are known. */
async function forwardInto(
  request: FastifyRequest<{ Body: ForwardMessageRequest }>,
  reply: FastifyReply,
  sourceContent: string | null,
  sourceAttachments: readonly AttachmentRow[],
): Promise<FastifyReply> {
  const { channelId, dmChannelId } = request.body ?? {};
  if ((typeof channelId === 'string') === (typeof dmChannelId === 'string')) {
    return sendError(reply, 400, 'validation_failed', { field: 'target' });
  }

  const content = sourceContent ? withoutMentions(sourceContent) : null;
  if (content && content.length > MAX_MESSAGE_LENGTH) {
    return sendError(reply, 400, 'content_too_long', { max: MAX_MESSAGE_LENGTH });
  }
  const now = Date.now();
  const userId = request.userId;

  let target: ForwardTarget;
  if (typeof channelId === 'string') {
    const spaceId = getChannelSpaceId(channelId);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, channelId)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'SEND_MESSAGES' });
    }
    if (sourceAttachments.length > 0 && !hasPermission(userId, spaceId, PermissionBits.ATTACH_FILES, channelId)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'ATTACH_FILES' });
    }
    const refusal = spaceMessageRefusal({ spaceId, channelId, userId, content, kind: 'create', now });
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
    target = { kind: 'channel', spaceId, channelId };
  } else {
    const dmId = dmChannelId as string;
    const refusal = dmPostRefusal(dmId, userId);
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
    target = { kind: 'dm', dmId };
  }

  // Checked and held as an upload is, until the copies are in the table and count there.
  const bytes = sourceAttachments.filter(isOnThisDisk).reduce((sum, row) => sum + row.size, 0);
  const storageRefusal = bytes > 0 ? uploadRefusal(userId, bytes) : null;
  if (storageRefusal) return sendError(reply, storageRefusal === 'disk_full' ? 507 : 413, storageRefusal);
  const reservation = `forward-${generateSnowflake()}`;
  reserveUpload(reservation, userId, bytes);
  try {
    let copies: CopiedAttachment[];
    try {
      copies = await copyAttachments(sourceAttachments, { share: true });
    } catch (err) {
      if (err instanceof DiskFullError) return sendError(reply, 507, 'disk_full');
      throw err;
    }
    if (!content && copies.length === 0) return sendError(reply, 400, 'attachment_invalid');
    return target.kind === 'channel'
      ? landInChannel(reply, target, userId, content, copies, now)
      : landInDm(reply, target.dmId, userId, content, copies, now);
  } finally {
    releaseUpload(reservation);
  }
}

function landInChannel(
  reply: FastifyReply,
  target: { spaceId: string; channelId: string },
  userId: string,
  content: string | null,
  copies: readonly CopiedAttachment[],
  now: number,
): FastifyReply {
  const { spaceId, channelId } = target;
  const db = getDb();
  const messageId = generateSnowflake();
  db.transaction((tx) => {
    tx.insert(schema.messages).values({ id: messageId, channelId, userId, content, forwarded: true, createdAt: now }).run();
    for (const copy of copies) {
      tx.insert(schema.attachments).values({ ...copy, id: generateSnowflake(), messageId, uploaderId: userId, createdAt: now }).run();
    }
    recordSlowmodePost(tx, channelId, userId, now);
  });

  const row = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  const [message] = row ? hydrateChannelMessages(channelId, [row]) : [];
  if (!message) return sendError(reply, 500, 'internal_error');
  connectionManager.sendToChannel(spaceId, channelId, { type: 'message_created', message });
  setImmediate(() => {
    resolveEmbeds(messageId, content, channelId, false, spaceId).catch(() => {});
  });
  return reply.code(201).send(message);
}

function landInDm(
  reply: FastifyReply,
  dmId: string,
  userId: string,
  content: string | null,
  copies: readonly CopiedAttachment[],
  now: number,
): FastifyReply {
  const messageId = generateSnowflake();
  getDb().transaction((tx) => {
    tx.insert(schema.dmMessages).values({ id: messageId, dmChannelId: dmId, userId, content, forwarded: true, createdAt: now }).run();
    for (const copy of copies) {
      tx.insert(schema.attachments).values({ ...copy, id: generateSnowflake(), dmMessageId: messageId, uploaderId: userId, createdAt: now }).run();
    }
  });

  const message = getDmMessageWithUser(messageId);
  if (!message) return sendError(reply, 500, 'message_create_failed');
  broadcastDmMessage(dmId, message);
  queueDmRelay(message, dmId, 'create');
  setImmediate(() => {
    resolveEmbeds(messageId, content, dmId, true, null).catch(() => {});
  });
  return reply.code(201).send(message);
}

export async function forwardRoutes(app: FastifyInstance): Promise<void> {
  const limits = { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  // POST /api/messages/:id/forward - Forward a channel message
  app.post<{ Params: { id: string }; Body: ForwardMessageRequest }>('/api/messages/:id/forward', limits, async (request, reply) => {
    const db = getDb();
    const source = db.select().from(schema.messages).where(eq(schema.messages.id, request.params.id)).get();
    if (!source) return sendError(reply, 404, 'message_not_found');
    const spaceId = getChannelSpaceId(source.channelId);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, source.channelId)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }
    if (source.type === 'system') return sendError(reply, 403, 'system_message_immutable');
    const attachments = db.select().from(schema.attachments).where(eq(schema.attachments.messageId, source.id)).all();
    return forwardInto(request, reply, source.content, attachments);
  });

  // POST /api/dm/messages/:id/forward - Forward a conversation's message
  app.post<{ Params: { id: string }; Body: ForwardMessageRequest }>('/api/dm/messages/:id/forward', limits, async (request, reply) => {
    const db = getDb();
    const source = db.select().from(schema.dmMessages).where(eq(schema.dmMessages.id, request.params.id)).get();
    if (!source) return sendError(reply, 404, 'message_not_found');
    if (!isDmMember(source.dmChannelId, request.userId)) return sendError(reply, 403, 'not_dm_member');
    if (source.type === 'system') return sendError(reply, 403, 'system_message_immutable');
    const attachments = db.select().from(schema.attachments).where(eq(schema.attachments.dmMessageId, source.id)).all();
    return forwardInto(request, reply, source.content, attachments);
  });
}
