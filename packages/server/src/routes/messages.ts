import { cardImageIds, cardsSummary, cardWords, cleanCards, parseStoredCards, type MessageCard } from '@backspace/shared/src/cards.js';
import type { ErrorDetails } from '@backspace/shared/src/errors.js';
import { addSpaceReaction, REACTION_EMOJI_MAX_LENGTH, removeSpaceReaction } from '../utils/reactions.js';
import { withoutMentions } from '../utils/neutralMentions.js';
import { parseWaveform } from '@backspace/shared/src/voiceMessages.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { hasPermission, getChannelSpaceId, PermissionBits } from '../utils/permissions.js';
import { connectionManager } from '../ws/handler.js';
import {
  MAX_BULK_DELETE_MESSAGES,
  MAX_MESSAGE_LENGTH,
  type CreateMessageRequest,
  type UpdateMessageRequest,
  type PaginatedQuery,
  type MessageWithUser,
  type Reaction,
  type Embed,
} from '@backspace/shared';
import { sanitizeUser } from '../utils/sanitize.js';
import { userWrittenMessages } from '../db/userWrittenMessages.js';
import { addsGatedMassMention, hasGatedMassMention, massMentionFields } from '@backspace/shared/src/mentions.js';
import { spoilerAttachmentIds } from '@backspace/shared/src/spoilers.js';
import { mentionableRoleIds } from '../utils/mentionableRoles.js';
import { deleteAttachmentFiles } from '../utils/fileCleanup.js';
import { sendError } from '../utils/httpErrors.js';
import { parseHistoryPage, selectHistoryPage, markHistoryPageHonoured } from '../utils/messagePaging.js';
import { fetchEmbedsForMessages, resolveEmbeds, reResolveEmbeds, embedRowToEmbed } from '../utils/embedResolver.js';
import { recordSlowmodePost, spaceMessageRefusal } from '../utils/spaceModeration.js';
import { mayPostSticker } from '../utils/remoteMedia.js';
import { recordMessageDeleteAudit, recordMessagesBulkDeleteAudit } from '../utils/auditLog.js';
import { fetchPollsForMessages, isPollMessage } from '../utils/polls.js';
import type { PollInfo } from '@backspace/shared/src/polls.js';
import type { ThreadSummary } from '@backspace/shared/src/threads.js';
import { threadSummariesForMessages } from '../utils/threads.js';

/**
 * Fetch reactions for a set of message IDs.
 * Returns a map from messageId to Reaction[].
 */
export function fetchReactionsForMessages(messageIds: string[]): Map<string, Reaction[]> {
  if (messageIds.length === 0) return new Map();
  const db = getDb();
  const reactionRows = db.select()
    .from(schema.reactions)
    .where(inArray(schema.reactions.messageId, messageIds))
    .all();

  // Batch fetch users for reactions
  const reactionUserIds = [...new Set(reactionRows.map(r => r.userId))];
  const reactionUsers = reactionUserIds.length > 0
    ? db.select().from(schema.users).where(inArray(schema.users.id, reactionUserIds)).all()
    : [];
  const reactionUserMap = new Map(reactionUsers.map(u => [u.id, u]));

  const map = new Map<string, Reaction[]>();
  for (const r of reactionRows) {
    const user = reactionUserMap.get(r.userId);
    const reaction: Reaction = {
      id: r.id,
      messageId: r.messageId,
      userId: r.userId,
      emoji: r.emoji,
      createdAt: r.createdAt,
      user: user ? sanitizeUser(user) : undefined,
    };
    if (!map.has(r.messageId)) {
      map.set(r.messageId, []);
    }
    map.get(r.messageId)!.push(reaction);
  }
  return map;
}

/**
 * Batch-fetch the reply targets for a set of channel messages, confined to one channel.
 *
 * A reply target only ever names a message in the same channel, so the lookup is
 * scoped to `channelId`. That scoping is what keeps hydration from surfacing a
 * message from a channel the reader may not have access to, including for rows
 * written before the create-time check existed.
 *
 * The scope has to be the channel rather than the reader's permissions: one
 * hydrated message is fanned out by `sendToChannel` to an audience whose members
 * hold different permissions, so there is no single reader to resolve against.
 * Confining the target to the message's own channel puts the reply preview under
 * exactly the VIEW_CHANNEL gate that already guards the message carrying it.
 *
 * Returns a map from reply-target id to its hydration. Embeds and reactions are
 * left empty because reply previews do not render them.
 */
export function fetchReplyToMessages(
  channelId: string,
  messages: (typeof schema.messages.$inferSelect)[],
): Map<string, MessageWithUser> {
  const replyToIds = messages
    .map(m => m.replyToId)
    .filter((id): id is string => id !== null && id !== undefined);

  if (replyToIds.length === 0) return new Map();

  const db = getDb();
  const uniqueReplyIds = [...new Set(replyToIds)];
  const replyMessages = db.select()
    .from(schema.messages)
    .where(and(
      inArray(schema.messages.id, uniqueReplyIds),
      eq(schema.messages.channelId, channelId),
    ))
    .all();

  // Fetch users for reply messages
  const replyUserIds = [...new Set(replyMessages.map(m => m.userId))];
  const replyUsers = replyUserIds.length > 0
    ? db.select().from(schema.users).where(inArray(schema.users.id, replyUserIds)).all()
    : [];
  const replyUserMap = new Map(replyUsers.map(u => [u.id, u]));

  // Fetch attachments for reply messages
  const replyMsgIds = replyMessages.map(m => m.id);
  const replyAttachments = replyMsgIds.length > 0
    ? db.select().from(schema.attachments).where(inArray(schema.attachments.messageId, replyMsgIds)).all()
    : [];
  const replyAttMap = new Map<string, (typeof schema.attachments.$inferSelect)[]>();
  for (const att of replyAttachments) {
    const mid = att.messageId ?? '';
    if (!replyAttMap.has(mid)) replyAttMap.set(mid, []);
    replyAttMap.get(mid)!.push(att);
  }

  const map = new Map<string, MessageWithUser>();
  for (const rm of replyMessages) {
    const user = replyUserMap.get(rm.userId);
    if (!user) continue;
    const atts = replyAttMap.get(rm.id) ?? [];
    map.set(rm.id, {
      id: rm.id,
      channelId: rm.channelId,
      userId: rm.userId,
      replyToId: rm.replyToId,
      content: rm.content,
      type: rm.type,
      editedAt: rm.editedAt,
      createdAt: rm.createdAt,
      user: sanitizeUser(user),
      attachments: atts.map(a => ({
        id: a.id,
        messageId: a.messageId ?? rm.id,
        filename: a.filename,
        originalName: a.originalName,
        mimetype: a.mimetype,
        size: a.size,
        thumbnailFilename: a.thumbnailFilename ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        duration: a.duration ?? null,
        playable: a.playable ?? null,
        spoiler: a.spoiler,
        voiceWaveform: parseWaveform(a.voiceWaveform),
        createdAt: a.createdAt,
      })),
      embeds: [],
      reactions: [],
      replyTo: null,
    });
  }
  return map;
}

/**
 * True when `replyToId` names an existing message a member wrote inside
 * `channelId` (a system row such as a poke takes no replies).
 *
 * Used by both channel message-create paths (REST and WebSocket) so a reply can
 * only ever point at the channel it is posted into. Author permissions are not
 * enough on their own: an author who may read a restricted channel would
 * otherwise be able to pull one of its messages into a channel with a wider
 * audience.
 */
export function isReplyTargetInChannel(channelId: string, replyToId: string): boolean {
  const db = getDb();
  const target = db.select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.id, replyToId),
      eq(schema.messages.channelId, channelId),
      userWrittenMessages(),
    ))
    .get();
  return target !== undefined;
}

/**
 * The mass mention stamps of a stored channel message (`massMentionFields`).
 * A system message is written by this instance and records names people
 * chose (a poke records its target's name), so its text is never a mention:
 * a member whose nickname is `@everyone` must not reach every member by
 * being poked. Only messages members wrote carry the stamps.
 */
export function storedMassMentionFields(message: { type: 'user' | 'system'; content: string | null }): { mentionEveryone: boolean; mentionRoleIds: string[] } {
  if (message.type === 'system') return { mentionEveryone: false, mentionRoleIds: [] };
  return massMentionFields(message.content);
}

function cardsField(stored: string | null): { cards?: MessageCard[] } {
  const cards = parseStoredCards(stored);
  return cards ? { cards } : {};
}

/** The cards a bot asked for, or what it did wrong. A person's words stay words: a card must not pass for the instance speaking. */
function cardsFromBot(
  userId: string,
  given: unknown,
  attachmentIds: readonly string[],
): { cards: MessageCard[] } | { status: number; code: 'cards_not_allowed' | 'cards_invalid'; details?: ErrorDetails } {
  const author = getDb().select({ accountKind: schema.users.accountKind }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (author?.accountKind !== 'bot') return { status: 403, code: 'cards_not_allowed' };
  const cleaned = cleanCards(given, withoutMentions);
  if ('field' in cleaned) return { status: 400, code: 'cards_invalid', details: { field: cleaned.field } };
  for (const id of cardImageIds(cleaned.cards)) {
    if (!attachmentIds.includes(id)) return { status: 400, code: 'cards_invalid', details: { field: 'imageAttachmentId' } };
  }
  return cleaned;
}

/** Why these uploads cannot go on a message of this person's, or null when they can. */
export function attachmentRefusal(attachmentIds: readonly string[], userId: string): 'attachment_invalid' | 'attachment_not_owned' | null {
  const db = getDb();
  for (const attId of attachmentIds) {
    const att = db.select().from(schema.attachments).where(eq(schema.attachments.id, attId)).get();
    if (!att || att.messageId || att.dmMessageId) return 'attachment_invalid';
    // Skip ownership check for legacy uploads (null uploaderId)
    if (att.uploaderId && att.uploaderId !== userId) return 'attachment_not_owned';
  }
  return null;
}

export interface NewChannelMessage {
  channelId: string;
  spaceId: string;
  userId: string;
  text: string | null;
  cards?: readonly MessageCard[];
  attachmentIds?: readonly string[];
  spoilerAttachments?: readonly string[];
  replyToId?: string;
  now: number;
}

/**
 * Stores a message whose author may write it, tells the channel, and looks for link previews.
 * Null when its author is gone. Whoever calls this has made the checks.
 */
export function postChannelMessage(input: NewChannelMessage): MessageWithUser | null {
  const { channelId, spaceId, userId, text, cards = [], attachmentIds = [], spoilerAttachments, replyToId, now } = input;
  const db = getDb();
  const messageId = generateSnowflake();

  // Insert message and link attachments atomically
  db.transaction((tx) => {
    tx.insert(schema.messages).values({
      id: messageId,
      channelId,
      userId,
      replyToId: replyToId || null,
      content: text,
      cards: cards.length > 0 ? JSON.stringify(cards) : null,
      createdAt: now,
    }).run();

    if (attachmentIds.length > 0) {
      const spoilers = spoilerAttachmentIds(spoilerAttachments, [...attachmentIds]);
      for (const attId of attachmentIds) {
        tx.update(schema.attachments)
          .set({ messageId, spoiler: spoilers.has(attId) })
          .where(eq(schema.attachments.id, attId))
          .run();
      }
    }

    recordSlowmodePost(tx, channelId, userId, now);
  });

  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  const message = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!user || !message) return null;

  const attachmentRows = db.select()
    .from(schema.attachments)
    .where(eq(schema.attachments.messageId, messageId))
    .all();

  // Hydrate the reply-to message if present. Reply targets are confined to
  // the message's own channel.
  let replyTo: MessageWithUser | null = null;
  if (message.replyToId) {
    const replyToMap = fetchReplyToMessages(message.channelId, [message]);
    replyTo = replyToMap.get(message.replyToId) ?? null;
  }

  const messageWithUser = buildMessageWithUser(message, user, attachmentRows, [], replyTo);

  // Broadcast via WebSocket
  connectionManager.sendToChannel(spaceId, channelId, {
    type: 'message_created',
    message: messageWithUser,
  });

  // Resolve embeds asynchronously after responding
  setImmediate(() => {
    resolveEmbeds(messageId, text, channelId, false, spaceId).catch(() => {});
  });

  return messageWithUser;
}

export function buildMessageWithUser(
  message: typeof schema.messages.$inferSelect,
  user: typeof schema.users.$inferSelect,
  attachmentRows: (typeof schema.attachments.$inferSelect)[],
  reactions: Reaction[] = [],
  replyTo: MessageWithUser | null = null,
  embedRows: (typeof schema.embeds.$inferSelect)[] = [],
  extras: { poll?: PollInfo; thread?: ThreadSummary } = {},
): MessageWithUser {
  return {
    id: message.id,
    channelId: message.channelId,
    userId: message.userId,
    replyToId: message.replyToId,
    content: message.content,
    type: message.type,
    editedAt: message.editedAt,
    pinnedAt: message.pinnedAt,
    pinnedBy: message.pinnedBy,
    ...(message.forwarded ? { forwarded: true } : {}),
    ...cardsField(message.cards),
    createdAt: message.createdAt,
    ...storedMassMentionFields(message),
    user: sanitizeUser(user),
    attachments: attachmentRows.map(a => ({
      id: a.id,
      messageId: a.messageId ?? message.id,
      filename: a.filename,
      originalName: a.originalName,
      mimetype: a.mimetype,
      size: a.size,
      thumbnailFilename: a.thumbnailFilename ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      duration: a.duration ?? null,
      playable: a.playable ?? null,
      spoiler: a.spoiler,
      voiceWaveform: parseWaveform(a.voiceWaveform),
      federationStatus: a.federationStatus ?? null,
      federationMeta: a.federationMeta ?? null,
      createdAt: a.createdAt,
    })),
    embeds: embedRows.map(e => embedRowToEmbed(e)),
    reactions,
    replyTo,
    ...(extras.poll ? { poll: extras.poll } : {}),
    ...(extras.thread ? { thread: extras.thread } : {}),
  };
}

/**
 * Hydrate channel message rows into the wire shape, keeping their order.
 *
 * One batch each for authors, attachments, reactions, embeds and reply
 * targets (confined to `channelId`, see fetchReplyToMessages). A row whose
 * author row is missing is dropped. Every read path that returns channel
 * messages goes through here: history, messages-around and search. `readerId`
 * adds that reader's own answers to a poll; what goes to a whole channel has none.
 */
export function hydrateChannelMessages(
  channelId: string,
  messageRows: (typeof schema.messages.$inferSelect)[],
  readerId?: string,
): MessageWithUser[] {
  if (messageRows.length === 0) return [];
  const db = getDb();

  const userIds = [...new Set(messageRows.map(m => m.userId))];
  const users = db.select().from(schema.users).where(inArray(schema.users.id, userIds)).all();
  const userMap = new Map(users.map(u => [u.id, u]));

  const messageIds = messageRows.map(m => m.id);
  const allAttachments = db.select()
    .from(schema.attachments)
    .where(inArray(schema.attachments.messageId, messageIds))
    .all();
  const attachmentMap = new Map<string, (typeof schema.attachments.$inferSelect)[]>();
  for (const att of allAttachments) {
    const mid = att.messageId ?? '';
    if (!attachmentMap.has(mid)) attachmentMap.set(mid, []);
    attachmentMap.get(mid)!.push(att);
  }

  const reactionsMap = fetchReactionsForMessages(messageIds);
  const embedMap = fetchEmbedsForMessages(messageIds);
  const replyToMap = fetchReplyToMessages(channelId, messageRows);
  const pollMap = fetchPollsForMessages(messageIds, readerId);
  const threadMap = threadSummariesForMessages(messageIds);

  return messageRows
    .map(m => {
      const user = userMap.get(m.userId);
      if (!user) return null;
      const reactions = reactionsMap.get(m.id) ?? [];
      const replyTo = m.replyToId ? (replyToMap.get(m.replyToId) ?? null) : null;
      return buildMessageWithUser(m, user, attachmentMap.get(m.id) ?? [], reactions, replyTo, embedMap.get(m.id) ?? [], { poll: pollMap.get(m.id), thread: threadMap.get(m.id) });
    })
    .filter((m): m is MessageWithUser => m !== null);
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/channels/:id/messages - Get messages with cursor pagination
  // (before or after; see docs/systems/api.md, "Message history paging")
  app.get<{ Params: { id: string }; Querystring: PaginatedQuery }>('/api/channels/:id/messages', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;

    const parsed = parseHistoryPage(request.query);
    if (!parsed.ok) {
      return sendError(reply, 400, parsed.code);
    }
    const { page } = parsed;

    const spaceId = getChannelSpaceId(id);
    if (!spaceId) {
      return sendError(reply, 404, 'channel_not_found');
    }

    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }

    const db = getDb();
    const messageRows = selectHistoryPage(page, schema.messages, (cursor, orderBy, limit) =>
      db.select()
        .from(schema.messages)
        .where(and(eq(schema.messages.channelId, id), cursor))
        .orderBy(...orderBy)
        .limit(limit)
        .all(),
    );

    markHistoryPageHonoured(reply, page);
    return reply.code(200).send(hydrateChannelMessages(id, messageRows, request.userId));
  });

  // POST /api/channels/:id/messages - Create a message
  app.post<{ Params: { id: string }; Body: CreateMessageRequest }>('/api/channels/:id/messages', {
    preHandler: authenticate,
    config: {
      botAllowed: true,
      rateLimit: {
        max: 5,
        timeWindow: '5 seconds',
        // Per client address, like every limit in this app. A route limit runs
        // on `onRequest` too, before `authenticate`, so there is no user on the
        // request to key on. See docs/systems/api.md, "Rate limiting".
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { content, attachments: attachmentIds, replyToId, spoilerAttachments, cards: givenCards } = request.body;

    const spaceId = getChannelSpaceId(id);
    if (!spaceId) {
      return sendError(reply, 404, 'channel_not_found');
    }

    // Seeing a channel is a condition of writing in it: an override can hide one without
    // taking SEND_MESSAGES away, and nobody should post into a room they cannot see.
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'SEND_MESSAGES' });
    }

    if (attachmentIds && attachmentIds.length > 0 &&
        !hasPermission(request.userId, spaceId, PermissionBits.ATTACH_FILES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'ATTACH_FILES' });
    }

    let cards: MessageCard[] = [];
    if (givenCards !== undefined) {
      const asked = cardsFromBot(request.userId, givenCards, attachmentIds ?? []);
      if (!('cards' in asked)) return sendError(reply, asked.status, asked.code, asked.details);
      cards = asked.cards;
    }

    const hasContent = content && typeof content === 'string' && content.trim().length > 0;
    const hasAttachments = attachmentIds && attachmentIds.length > 0;

    if (!hasContent && !hasAttachments && cards.length === 0) {
      return sendError(reply, 400, 'message_empty');
    }

    if (content && content.length > MAX_MESSAGE_LENGTH) {
      return sendError(reply, 400, 'content_too_long', { max: MAX_MESSAGE_LENGTH });
    }

    // Every reader's client fetches a sticker by itself, so it only comes from where the sender's do (utils/remoteMedia.ts).
    if (!mayPostSticker(content, request.userId)) return sendError(reply, 400, 'sticker_elsewhere');

    // @everyone, @here and role mentions alert many people; only MENTION_EVERYONE
    // may send them, except a role the space opened to mentions (permissions.md,
    // "Mass mentions").
    if (hasGatedMassMention(content, mentionableRoleIds(spaceId)) && !hasPermission(request.userId, spaceId, PermissionBits.MENTION_EVERYONE, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MENTION_EVERYONE' });
    }

    // A reply may only target a message in the channel it is posted into.
    if (replyToId && !isReplyTargetInChannel(id, replyToId)) {
      return sendError(reply, 400, 'reply_target_invalid');
    }

    // The space's moderation: a timeout, the minimum ages, slow mode and the
    // automatic rules (utils/spaceModeration.ts), as the WebSocket path runs them.
    const now = Date.now();
    const text = content?.trim() || cardsSummary(cards);
    const refusal = spaceMessageRefusal({
      spaceId, channelId: id, userId: request.userId, content: cards.length > 0 ? cardWords(cards) + (text ? `\n${text}` : '') : text, kind: 'create', now,
    });
    if (refusal) {
      return sendError(reply, refusal.status, refusal.code, refusal.details);
    }

    const badFile = attachmentRefusal(attachmentIds ?? [], request.userId);
    if (badFile) {
      return sendError(reply, 400, badFile);
    }

    const messageWithUser = postChannelMessage({
      channelId: id,
      spaceId,
      userId: request.userId,
      text,
      cards,
      ...(attachmentIds ? { attachmentIds } : {}),
      ...(spoilerAttachments ? { spoilerAttachments } : {}),
      ...(replyToId ? { replyToId } : {}),
      now,
    });
    if (!messageWithUser) {
      return sendError(reply, 500, 'internal_error');
    }

    return reply.code(201).send(messageWithUser);
  });

  // POST /api/channels/:id/messages/bulk-delete - A moderator's clean-up of many messages
  app.post<{ Params: { id: string }; Body: { messageIds?: unknown } }>('/api/channels/:id/messages/bulk-delete', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) {
      return sendError(reply, 404, 'channel_not_found');
    }
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_MESSAGES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_MESSAGES' });
    }

    const asked = request.body?.messageIds;
    const messageIds = Array.isArray(asked) ? [...new Set(asked.filter((value): value is string => typeof value === 'string'))] : [];
    if (messageIds.length === 0 || messageIds.length > MAX_BULK_DELETE_MESSAGES) {
      return sendError(reply, 400, 'validation_failed', { field: 'messageIds' });
    }

    // Only this channel's: the permission above says nothing about any other.
    const db = getDb();
    const inChannel = db.select({ id: schema.messages.id })
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, id), inArray(schema.messages.id, messageIds)))
      .all()
      .map((row) => row.id);
    if (inChannel.length === 0) {
      return reply.code(200).send({ deleted: 0 });
    }

    const attachmentRows = db.select({ filename: schema.attachments.filename })
      .from(schema.attachments)
      .where(inArray(schema.attachments.messageId, inChannel))
      .all();
    db.transaction((tx) => {
      tx.delete(schema.attachments).where(inArray(schema.attachments.messageId, inChannel)).run();
      tx.delete(schema.messages).where(inArray(schema.messages.id, inChannel)).run();
    });
    deleteAttachmentFiles(attachmentRows);

    recordMessagesBulkDeleteAudit(spaceId, request.userId, id, inChannel.length);

    connectionManager.sendToChannel(spaceId, id, { type: 'messages_deleted', messageIds: inChannel, channelId: id });
    return reply.code(200).send({ deleted: inChannel.length });
  });

  // PATCH /api/messages/:id - Edit a message (author only)
  app.patch<{ Params: { id: string }; Body: UpdateMessageRequest }>('/api/messages/:id', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;
    const { content: givenContent, cards: givenCards } = request.body;
    const givenText = typeof givenContent === 'string' ? givenContent.trim() : '';

    if (givenCards === undefined && givenText.length === 0) {
      return sendError(reply, 400, 'content_required');
    }

    if (typeof givenContent === 'string' && givenContent.length > MAX_MESSAGE_LENGTH) {
      return sendError(reply, 400, 'content_too_long', { max: MAX_MESSAGE_LENGTH });
    }
    if (typeof givenContent === 'string' && !mayPostSticker(givenContent.trim(), request.userId)) {
      return sendError(reply, 400, 'sticker_elsewhere');
    }

    const db = getDb();
    const message = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    if (!message) {
      return sendError(reply, 404, 'message_not_found');
    }

    // A system row (a poke) is written by this instance, so nobody edits it,
    // its author included; the DM routes refuse theirs with the same code.
    if (message.type === 'system') {
      return sendError(reply, 403, 'system_message_immutable');
    }
    if (message.userId !== request.userId) {
      return sendError(reply, 403, 'message_edit_not_author');
    }
    // Its question does not change under the votes already cast.
    if (isPollMessage(id)) {
      return sendError(reply, 403, 'poll_not_editable');
    }

    // Null takes a bot's cards away; without the field they stay as they are.
    const earlierCards = parseStoredCards(message.cards) ?? [];
    let cards = earlierCards;
    if (givenCards !== undefined) {
      const attached = db.select({ id: schema.attachments.id }).from(schema.attachments).where(eq(schema.attachments.messageId, id)).all();
      const asked = cardsFromBot(request.userId, givenCards ?? [], attached.map((row) => row.id));
      if (!('cards' in asked)) return sendError(reply, asked.status, asked.code, asked.details);
      cards = asked.cards;
    }
    // Words it wrote itself stay until it changes them; what only stood for its cards goes with them.
    const ownWords = message.content !== cardsSummary(earlierCards) ? message.content : null;
    const content = givenText || ownWords || cardsSummary(cards) || '';
    if (content.length === 0) {
      return sendError(reply, 400, 'content_required');
    }

    // An edit that adds a mass mention needs the same permission as sending
    // one. Keeping the ones the message already has does not.
    const mentionSpaceId = getChannelSpaceId(message.channelId);
    if (addsGatedMassMention(message.content, content, mentionableRoleIds(mentionSpaceId)) && (!mentionSpaceId || !hasPermission(request.userId, mentionSpaceId, PermissionBits.MENTION_EVERYONE, message.channelId))) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MENTION_EVERYONE' });
    }

    // The space's moderation for an edit: a timeout, the minimum ages and the
    // automatic rules, which the edited text must pass as a whole.
    const now = Date.now();
    if (mentionSpaceId) {
      const refusal = spaceMessageRefusal({
        spaceId: mentionSpaceId, channelId: message.channelId, userId: request.userId, content: cards.length > 0 ? `${cardWords(cards)}\n${content}` : content, kind: 'edit', now,
      });
      if (refusal) {
        return sendError(reply, refusal.status, refusal.code, refusal.details);
      }
    }

    db.update(schema.messages)
      .set({ content, editedAt: now, ...(givenCards !== undefined ? { cards: cards.length > 0 ? JSON.stringify(cards) : null } : {}) })
      .where(eq(schema.messages.id, id))
      .run();

    const updatedMessage = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    if (!updatedMessage) {
      return sendError(reply, 500, 'internal_error');
    }

    const user = db.select().from(schema.users).where(eq(schema.users.id, message.userId)).get();
    if (!user) {
      return sendError(reply, 500, 'internal_error');
    }

    const attachmentRows = db.select()
      .from(schema.attachments)
      .where(eq(schema.attachments.messageId, id))
      .all();

    // Delete old embeds synchronously so the broadcast reflects the edit
    db.delete(schema.embeds).where(eq(schema.embeds.messageId, id)).run();

    // Hydrate reactions and reply-to (embeds are empty after deletion)
    const reactionsMap = fetchReactionsForMessages([id]);
    const reactions = reactionsMap.get(id) ?? [];
    let replyTo: MessageWithUser | null = null;
    if (updatedMessage.replyToId) {
      const replyToMap = fetchReplyToMessages(updatedMessage.channelId, [updatedMessage]);
      replyTo = replyToMap.get(updatedMessage.replyToId) ?? null;
    }

    const messageWithUser = buildMessageWithUser(updatedMessage, user, attachmentRows, reactions, replyTo, []);

    // Broadcast edit (with empty embeds — new ones arrive via embeds_resolved).
    // The audience is the channel, not the space: the payload carries the full
    // message, so it goes to the same VIEW_CHANNEL holders that received the
    // original message_created. Matches the WebSocket message_edit handler.
    const spaceId = getChannelSpaceId(message.channelId);
    if (spaceId) {
      connectionManager.sendToChannel(spaceId, message.channelId, {
        type: 'message_updated',
        message: messageWithUser,
      });

      // Resolve new embeds asynchronously (old ones already deleted above)
      setImmediate(() => {
        resolveEmbeds(id, content, message.channelId, false, spaceId).catch(() => {});
      });
    }

    return reply.code(200).send(messageWithUser);
  });

  // PUT and DELETE /api/messages/:id/reactions/:emoji - A reaction, for those who have no socket to
  // send one on. Space messages only: a bot has no conversations, and a person's client uses the socket.
  const reactionRoute = (
    change: typeof addSpaceReaction,
    success: number,
  ) => async (request: FastifyRequest<{ Params: { id: string; emoji: string } }>, reply: FastifyReply) => {
    const { id, emoji } = request.params;
    if (emoji.length === 0 || emoji.length > REACTION_EMOJI_MAX_LENGTH) return sendError(reply, 400, 'validation_failed', { field: 'emoji' });
    const message = getDb().select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    if (!message) return sendError(reply, 404, 'message_not_found');
    const refusal = change(message, request.userId, emoji);
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
    return reply.code(success).send({ success: true });
  };
  app.put<{ Params: { id: string; emoji: string } }>('/api/messages/:id/reactions/:emoji', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, reactionRoute(addSpaceReaction, 200));
  app.delete<{ Params: { id: string; emoji: string } }>('/api/messages/:id/reactions/:emoji', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, reactionRoute(removeSpaceReaction, 200));

  // DELETE /api/messages/:id - Delete a message (author or admin)
  app.delete<{ Params: { id: string } }>('/api/messages/:id', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const message = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    if (!message) {
      return sendError(reply, 404, 'message_not_found');
    }

    const spaceId = getChannelSpaceId(message.channelId);
    if (!spaceId) {
      return sendError(reply, 404, 'channel_not_found');
    }

    const isAuthor = message.userId === request.userId;
    // With sight of the channel: nothing is implied by VIEW_CHANNEL (permissions.md), and a
    // moderator kept out of a private channel does not delete in it by message id.
    const canManageMessages = hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_MESSAGES, message.channelId);

    if (!isAuthor && !canManageMessages) {
      return sendError(reply, 403, 'message_delete_forbidden');
    }

    // Collect attachment filenames before deleting
    const attachmentRows = db.select({ filename: schema.attachments.filename })
      .from(schema.attachments)
      .where(eq(schema.attachments.messageId, id))
      .all();

    // Delete attachments and message atomically
    db.transaction((tx) => {
      tx.delete(schema.attachments).where(eq(schema.attachments.messageId, id)).run();
      tx.delete(schema.messages).where(eq(schema.messages.id, id)).run();
    });

    // Clean up files from disk after transaction commits
    deleteAttachmentFiles(attachmentRows);

    // A moderator removing someone else's message is in the audit log.
    if (!isAuthor) recordMessageDeleteAudit(spaceId, request.userId, message);

    // Broadcast deletion to the channel's audience. A member without
    // VIEW_CHANNEL never saw the message and must not learn that it existed.
    // Matches the WebSocket message_delete handler.
    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'message_deleted',
      messageId: id,
      channelId: message.channelId,
    });

    return reply.code(200).send({ success: true });
  });
}
