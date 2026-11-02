import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { MAX_PINS_PER_CHANNEL, type MessagePinState } from '@backspace/shared';
import { channelSystemContent } from '@backspace/shared/src/channelSystemEvents.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { getDb, schema } from '../db/index.js';
import { recordMessagePinAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { checkDmMessagePin } from '../utils/dmMessageRules.js';
import {
  appendMutationLog,
  dmMessageFederationRef,
  getGroupDmTargetOrigins,
  queueOutboxEvent,
} from '../utils/federationOutbox.js';
import { getOurOrigin } from '../utils/federationAuth.js';
import { sendError } from '../utils/httpErrors.js';
import { getChannelSpaceId, hasPermission, isDmMember, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { memberActionRefusal } from '../utils/spaceModeration.js';
import { connectionManager } from '../ws/handler.js';
import { hydrateDmMessages } from './dm.js';
import { hydrateChannelMessages } from './messages.js';

/**
 * Pinning a message (docs/systems/api.md, "Pins"): the same marker on a space channel's
 * messages and a conversation's. In a space it takes PIN_MESSAGES or MANAGE_MESSAGES, in a
 * conversation any member may. A channel's pin leaves a passive line in the timeline; a
 * conversation's does not, because that line would have to name a message by an id each
 * instance holds differently.
 */

const channelPinCount = (channelId: string): number =>
  getDb().select({ count: sql<number>`count(*)` }).from(schema.messages)
    .where(and(eq(schema.messages.channelId, channelId), isNotNull(schema.messages.pinnedAt)))
    .get()?.count ?? 0;

const dmPinCount = (dmChannelId: string): number =>
  getDb().select({ count: sql<number>`count(*)` }).from(schema.dmMessages)
    .where(and(eq(schema.dmMessages.dmChannelId, dmChannelId), isNotNull(schema.dmMessages.pinnedAt)))
    .get()?.count ?? 0;

type ChannelPinTarget =
  | { ok: true; message: typeof schema.messages.$inferSelect; spaceId: string }
  | { ok: false; status: number; code: ErrorCode; details?: ErrorDetails };

/** The relay of a conversation's pin: the marker's state, in coordinates every instance shares. */
function relayDmPin(message: typeof schema.dmMessages.$inferSelect, userId: string, pinned: boolean, at: number): void {
  const actor = getDb().select({ homeUserId: schema.users.homeUserId, homeInstance: schema.users.homeInstance })
    .from(schema.users).where(eq(schema.users.id, userId)).get();
  const identity = {
    userId,
    homeUserId: actor?.homeUserId || userId,
    homeInstance: actor?.homeInstance || getOurOrigin(),
    pinned,
    at,
  };
  appendMutationLog(message.id, message.dmChannelId, 'pin_set', JSON.stringify(identity));
  const target = dmMessageFederationRef(message);
  queueOutboxEvent(generateSnowflake(), message.dmChannelId, 'pin_set', JSON.stringify({
    pin: { messageId: target.messageId, messageHomeInstance: target.messageHomeInstance, ...identity },
  }), getGroupDmTargetOrigins(message.dmChannelId));
}

export async function pinRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/channels/:id/pins - A channel's pinned messages, the latest pin first
  app.get<{ Params: { id: string } }>('/api/channels/:id/pins', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }
    const rows = getDb().select().from(schema.messages)
      .where(and(eq(schema.messages.channelId, id), isNotNull(schema.messages.pinnedAt)))
      .orderBy(desc(schema.messages.pinnedAt))
      .all();
    return reply.code(200).send(hydrateChannelMessages(id, rows, request.userId));
  });

  /** The channel message this person may change the pin of, or why not. */
  const channelPinTarget = (messageId: string, userId: string): ChannelPinTarget => {
    const message = getDb().select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
    if (!message) return { ok: false, status: 404, code: 'message_not_found' };
    const spaceId = getChannelSpaceId(message.channelId);
    if (!spaceId) return { ok: false, status: 404, code: 'channel_not_found' };
    const { channelId } = message;
    const allowed = hasPermission(userId, spaceId, PermissionBits.VIEW_CHANNEL, channelId)
      && (hasPermission(userId, spaceId, PermissionBits.PIN_MESSAGES, channelId)
        || hasPermission(userId, spaceId, PermissionBits.MANAGE_MESSAGES, channelId));
    if (!allowed) return { ok: false, status: 403, code: 'missing_permission', details: { permission: 'PIN_MESSAGES' } };
    if (message.type === 'system') return { ok: false, status: 403, code: 'system_message_immutable' };
    const timeout = memberActionRefusal(spaceId, userId);
    if (timeout) return { ok: false, ...timeout };
    return { ok: true, message, spaceId };
  };

  // PUT /api/messages/:id/pin - Pin a channel message
  app.put<{ Params: { id: string } }>('/api/messages/:id/pin', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const target = channelPinTarget(request.params.id, request.userId);
    if (!target.ok) return sendError(reply, target.status, target.code, target.details);
    const { message, spaceId } = target;

    if (message.pinnedAt !== null) {
      const state: MessagePinState = { pinnedAt: message.pinnedAt, pinnedBy: message.pinnedBy };
      return reply.code(200).send(state);
    }
    if (channelPinCount(message.channelId) >= MAX_PINS_PER_CHANNEL) {
      return sendError(reply, 400, 'pin_limit_reached', { max: MAX_PINS_PER_CHANNEL });
    }

    const now = Date.now();
    const lineId = generateSnowflake();
    const db = getDb();
    db.transaction((tx) => {
      tx.update(schema.messages)
        .set({ pinnedAt: now, pinnedBy: request.userId })
        .where(eq(schema.messages.id, message.id))
        .run();
      tx.insert(schema.messages).values({
        id: lineId,
        channelId: message.channelId,
        userId: request.userId,
        type: 'system',
        content: channelSystemContent({ event: 'message_pinned', messageId: message.id }),
        createdAt: now,
      }).run();
    });

    recordMessagePinAudit(spaceId, request.userId, message, true);

    const state: MessagePinState = { pinnedAt: now, pinnedBy: request.userId };
    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'message_pin_changed',
      channelId: message.channelId,
      messageId: message.id,
      ...state,
    });
    const lineRow = db.select().from(schema.messages).where(eq(schema.messages.id, lineId)).get();
    const [line] = lineRow ? hydrateChannelMessages(message.channelId, [lineRow]) : [];
    if (line) connectionManager.sendToChannel(spaceId, message.channelId, { type: 'message_created', message: line });

    return reply.code(200).send(state);
  });

  // DELETE /api/messages/:id/pin - Unpin a channel message
  app.delete<{ Params: { id: string } }>('/api/messages/:id/pin', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const target = channelPinTarget(request.params.id, request.userId);
    if (!target.ok) return sendError(reply, target.status, target.code, target.details);
    const { message, spaceId } = target;
    const state: MessagePinState = { pinnedAt: null, pinnedBy: null };
    if (message.pinnedAt === null) return reply.code(200).send(state);

    getDb().update(schema.messages)
      .set(state)
      .where(eq(schema.messages.id, message.id))
      .run();

    recordMessagePinAudit(spaceId, request.userId, message, false);

    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'message_pin_changed',
      channelId: message.channelId,
      messageId: message.id,
      ...state,
    });
    return reply.code(200).send(state);
  });

  // GET /api/dm/:id/pins - A conversation's pinned messages, the latest pin first
  app.get<{ Params: { id: string } }>('/api/dm/:id/pins', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    if (!isDmMember(id, request.userId)) return sendError(reply, 403, 'not_dm_member');
    const rows = getDb().select().from(schema.dmMessages)
      .where(and(eq(schema.dmMessages.dmChannelId, id), isNotNull(schema.dmMessages.pinnedAt)))
      .orderBy(desc(schema.dmMessages.pinnedAt))
      .all();
    return reply.code(200).send(hydrateDmMessages(id, rows));
  });

  // PUT /api/dm/messages/:id/pin - Pin a conversation's message
  app.put<{ Params: { id: string } }>('/api/dm/messages/:id/pin', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const check = checkDmMessagePin(request.params.id, request.userId);
    if (!check.ok) return sendError(reply, check.refusal.status, check.refusal.code, check.refusal.details);
    const message = check.value;

    if (message.pinnedAt !== null) {
      const state: MessagePinState = { pinnedAt: message.pinnedAt, pinnedBy: message.pinnedBy };
      return reply.code(200).send(state);
    }
    if (dmPinCount(message.dmChannelId) >= MAX_PINS_PER_CHANNEL) {
      return sendError(reply, 400, 'pin_limit_reached', { max: MAX_PINS_PER_CHANNEL });
    }

    const now = Date.now();
    const state: MessagePinState = { pinnedAt: now, pinnedBy: request.userId };
    getDb().update(schema.dmMessages)
      .set({ ...state, pinChangedAt: now })
      .where(eq(schema.dmMessages.id, message.id))
      .run();

    connectionManager.sendToDmMembers(message.dmChannelId, {
      type: 'message_pin_changed',
      channelId: message.dmChannelId,
      messageId: message.id,
      ...state,
    });
    relayDmPin(message, request.userId, true, now);
    return reply.code(200).send(state);
  });

  // DELETE /api/dm/messages/:id/pin - Unpin a conversation's message
  app.delete<{ Params: { id: string } }>('/api/dm/messages/:id/pin', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const check = checkDmMessagePin(request.params.id, request.userId);
    if (!check.ok) return sendError(reply, check.refusal.status, check.refusal.code, check.refusal.details);
    const message = check.value;
    const state: MessagePinState = { pinnedAt: null, pinnedBy: null };
    if (message.pinnedAt === null) return reply.code(200).send(state);

    const now = Date.now();
    getDb().update(schema.dmMessages)
      .set({ ...state, pinChangedAt: now })
      .where(eq(schema.dmMessages.id, message.id))
      .run();

    connectionManager.sendToDmMembers(message.dmChannelId, {
      type: 'message_pin_changed',
      channelId: message.dmChannelId,
      messageId: message.id,
      ...state,
    });
    relayDmPin(message, request.userId, false, now);
    return reply.code(200).send(state);
  });
}
