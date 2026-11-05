import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { POLL_DURATIONS_HOURS, POLL_LIMITS, pollClosed, type CreatePollRequest } from '@backspace/shared/src/polls.js';
import { hasGatedMassMention } from '@backspace/shared/src/mentions.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { mentionableRoleIds } from '../utils/mentionableRoles.js';
import { getChannelSpaceId, hasPermission, PermissionBits } from '../utils/permissions.js';
import { emojiUseRefusal } from '../utils/emojiUse.js';
import { fetchPollsForMessages } from '../utils/polls.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { memberActionRefusal, recordSlowmodePost, spaceMessageRefusal } from '../utils/spaceModeration.js';
import { connectionManager } from '../ws/handler.js';
import { hydrateChannelMessages } from './messages.js';

const HOUR = 3_600_000;

/** The question and answers as stored, or null when they are not a poll. */
function normalizePoll(body: Partial<CreatePollRequest> | undefined): { question: string; options: string[] } | null {
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > POLL_LIMITS.QUESTION_MAX_LENGTH) return null;
  if (!Array.isArray(body?.options)) return null;
  const options = body.options.map((option) => (typeof option === 'string' ? option.trim() : ''));
  if (options.length < POLL_LIMITS.OPTIONS_MIN || options.length > POLL_LIMITS.OPTIONS_MAX) return null;
  if (options.some((option) => !option || option.length > POLL_LIMITS.OPTION_MAX_LENGTH)) return null;
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return null;
  return { question, options };
}

export async function pollRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/channels/:id/polls - Ask a channel something
  app.post<{ Params: { id: string }; Body: CreatePollRequest }>('/api/channels/:id/polls', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'SEND_MESSAGES' });
    }

    const poll = normalizePoll(request.body);
    if (!poll) return sendError(reply, 400, 'validation_failed', { field: 'poll' });
    const durationHours = request.body.durationHours ?? null;
    if (durationHours !== null && !(POLL_DURATIONS_HOURS as readonly number[]).includes(durationHours)) {
      return sendError(reply, 400, 'validation_failed', { field: 'durationHours' });
    }

    if (hasGatedMassMention(poll.question, mentionableRoleIds(spaceId)) && !hasPermission(request.userId, spaceId, PermissionBits.MENTION_EVERYONE, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MENTION_EVERYONE' });
    }
    // The question is drawn as a message is, emoji included; the answers are plain text.
    const emojiRefusal = emojiUseRefusal(poll.question, request.userId, spaceId);
    if (emojiRefusal) return sendError(reply, emojiRefusal.status, emojiRefusal.code);
    const now = Date.now();
    // The answers are words in the channel too, so the space's rules read them as well.
    const refusal = spaceMessageRefusal({
      spaceId, channelId: id, userId: request.userId, content: [poll.question, ...poll.options].join('\n'), kind: 'create', now,
    });
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);

    const db = getDb();
    const messageId = generateSnowflake();
    db.transaction((tx) => {
      tx.insert(schema.messages).values({ id: messageId, channelId: id, userId: request.userId, content: poll.question, createdAt: now }).run();
      tx.insert(schema.polls).values({
        messageId,
        multiple: request.body.multiple === true,
        endsAt: durationHours === null ? null : now + durationHours * HOUR,
        createdAt: now,
      }).run();
      poll.options.forEach((label, position) => {
        tx.insert(schema.pollOptions).values({ id: generateSnowflake(), messageId, position, label }).run();
      });
      recordSlowmodePost(tx, id, request.userId, now);
    });

    const row = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
    const [message] = row ? hydrateChannelMessages(id, [row]) : [];
    if (!message) return sendError(reply, 500, 'internal_error');
    connectionManager.sendToChannel(spaceId, id, { type: 'message_created', message });
    return reply.code(201).send(message);
  });

  /** The poll a person may read or vote on, or why not. */
  const pollOf = (messageId: string, userId: string) => {
    const db = getDb();
    const message = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
    if (!message) return { ok: false, status: 404, code: 'message_not_found' } as const;
    const poll = db.select().from(schema.polls).where(eq(schema.polls.messageId, messageId)).get();
    if (!poll) return { ok: false, status: 404, code: 'message_not_found' } as const;
    const spaceId = getChannelSpaceId(message.channelId);
    if (!spaceId) return { ok: false, status: 404, code: 'channel_not_found' } as const;
    if (!hasPermission(userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, message.channelId)) {
      return { ok: false, status: 403, code: 'missing_permission', details: { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' } } as const;
    }
    return { ok: true, message, poll, spaceId } as const;
  };

  // PUT /api/messages/:id/poll/votes - A person's answers, all of them: an empty list takes a vote back
  app.put<{ Params: { id: string }; Body: { optionIds?: unknown } }>('/api/messages/:id/poll/votes', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const found = pollOf(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const { message, poll, spaceId } = found;

    // Voting is reacting: what a channel closed to writing can still take.
    if (!hasPermission(request.userId, spaceId, PermissionBits.ADD_REACTIONS, message.channelId)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'ADD_REACTIONS' });
    }
    const timeout = memberActionRefusal(spaceId, request.userId);
    if (timeout) return sendError(reply, timeout.status, timeout.code, timeout.details);
    const now = Date.now();
    if (pollClosed(poll, now)) return sendError(reply, 409, 'poll_ended');

    const asked = request.body?.optionIds;
    if (!Array.isArray(asked) || asked.some((id) => typeof id !== 'string')) {
      return sendError(reply, 400, 'validation_failed', { field: 'optionIds' });
    }
    const optionIds = [...new Set(asked as string[])];
    if (!poll.multiple && optionIds.length > 1) return sendError(reply, 400, 'validation_failed', { field: 'optionIds' });

    const db = getDb();
    const known = optionIds.length === 0 ? [] : db.select({ id: schema.pollOptions.id }).from(schema.pollOptions)
      .where(and(eq(schema.pollOptions.messageId, message.id), inArray(schema.pollOptions.id, optionIds)))
      .all();
    if (known.length !== optionIds.length) return sendError(reply, 400, 'validation_failed', { field: 'optionIds' });

    db.transaction((tx) => {
      tx.delete(schema.pollVotes)
        .where(and(eq(schema.pollVotes.messageId, message.id), eq(schema.pollVotes.userId, request.userId)))
        .run();
      for (const optionId of optionIds) {
        tx.insert(schema.pollVotes).values({ optionId, messageId: message.id, userId: request.userId, createdAt: now }).run();
      }
    });

    const forChannel = fetchPollsForMessages([message.id]).get(message.id);
    const forVoter = fetchPollsForMessages([message.id], request.userId).get(message.id);
    if (!forChannel || !forVoter) return sendError(reply, 500, 'internal_error');
    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'poll_updated', channelId: message.channelId, messageId: message.id, poll: forChannel,
    });
    connectionManager.sendToUser(request.userId, {
      type: 'poll_updated', channelId: message.channelId, messageId: message.id, poll: forVoter,
    });
    return reply.code(200).send(forVoter);
  });

  // POST /api/messages/:id/poll/end - End it early: its author, or someone who may manage the channel's messages
  app.post<{ Params: { id: string } }>('/api/messages/:id/poll/end', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const found = pollOf(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const { message, poll, spaceId } = found;
    if (message.userId !== request.userId && !hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_MESSAGES, message.channelId)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_MESSAGES' });
    }

    const db = getDb();
    if (!pollClosed(poll, Date.now())) {
      db.update(schema.polls).set({ endedAt: Date.now() }).where(eq(schema.polls.messageId, message.id)).run();
    }
    const forChannel = fetchPollsForMessages([message.id]).get(message.id);
    if (!forChannel) return sendError(reply, 500, 'internal_error');
    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'poll_updated', channelId: message.channelId, messageId: message.id, poll: forChannel,
    });
    return reply.code(200).send(forChannel);
  });

  // GET /api/messages/:id/poll/voters?optionId= - Who chose an answer
  app.get<{ Params: { id: string }; Querystring: { optionId?: string } }>('/api/messages/:id/poll/voters', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const found = pollOf(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const { optionId } = request.query;
    if (typeof optionId !== 'string') return sendError(reply, 400, 'validation_failed', { field: 'optionId' });

    const db = getDb();
    const rows = db.select().from(schema.pollVotes)
      .innerJoin(schema.users, eq(schema.users.id, schema.pollVotes.userId))
      .where(and(eq(schema.pollVotes.messageId, found.message.id), eq(schema.pollVotes.optionId, optionId)))
      .orderBy(asc(schema.pollVotes.createdAt))
      .limit(POLL_LIMITS.VOTERS_MAX)
      .all();
    return reply.code(200).send({ voters: rows.map((row) => sanitizeUser(row.users)) });
  });
}
