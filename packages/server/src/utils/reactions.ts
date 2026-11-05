import { and, eq, sql } from 'drizzle-orm';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { getChannelSpaceId, hasPermission, isMember, PermissionBits } from './permissions.js';
import { sanitizeUser } from './sanitize.js';
import { generateSnowflake } from './snowflake.js';
import { memberActionRefusal } from './spaceModeration.js';
import { mayPostSticker } from './remoteMedia.js';
import { reactionEmojiRefusal, spaceReactionExists } from './emojiUse.js';

type MessageRow = typeof schema.messages.$inferSelect;

/** Long enough for any emoji, a custom one's name and a sticker's token, and no way to store an essay. */
export const REACTION_EMOJI_MAX_LENGTH = 128;

/** The most different reactions one message carries: more than anyone reads, and no wall of them. */
export const REACTIONS_PER_MESSAGE_MAX = 20;

/**
 * Whether `emoji` would be one different reaction too many on a message. One already there may
 * always be added to: the limit is on kinds, so that one account cannot hang thousands of strings
 * on a message for everyone to load.
 */
export function reactionLimitReached(kind: 'space' | 'dm', messageId: string, emoji: string): boolean {
  const db = getDb();
  if (kind === 'space') {
    const present = db.select({ id: schema.reactions.id }).from(schema.reactions)
      .where(and(eq(schema.reactions.messageId, messageId), eq(schema.reactions.emoji, emoji))).get();
    if (present) return false;
    const kinds = db.select({ n: sql<number>`COUNT(DISTINCT ${schema.reactions.emoji})` }).from(schema.reactions)
      .where(eq(schema.reactions.messageId, messageId)).get();
    return (kinds?.n ?? 0) >= REACTIONS_PER_MESSAGE_MAX;
  }
  const present = db.select({ id: schema.dmReactions.id }).from(schema.dmReactions)
    .where(and(eq(schema.dmReactions.dmMessageId, messageId), eq(schema.dmReactions.emoji, emoji))).get();
  if (present) return false;
  const kinds = db.select({ n: sql<number>`COUNT(DISTINCT ${schema.dmReactions.emoji})` }).from(schema.dmReactions)
    .where(eq(schema.dmReactions.dmMessageId, messageId)).get();
  return (kinds?.n ?? 0) >= REACTIONS_PER_MESSAGE_MAX;
}

export interface ReactionRefusal {
  status: number;
  code: ErrorCode;
  details?: ErrorDetails;
}

/**
 * A reaction to a message of a space, from the socket or a bot's request: one set of rules for
 * both. Null when it stands, which includes when it already did: a repeat changes and announces
 * nothing. Someone who cannot see the channel cannot react in it either.
 */
export function addSpaceReaction(message: MessageRow, userId: string, emoji: string): ReactionRefusal | null {
  const spaceId = getChannelSpaceId(message.channelId);
  if (!spaceId || !isMember(spaceId, userId)) return { status: 404, code: 'message_not_found' };
  if (!hasPermission(userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.ADD_REACTIONS, message.channelId)) {
    return { status: 403, code: 'missing_permission', details: { permission: 'ADD_REACTIONS' } };
  }
  // A timed-out member adds no reactions (removing their own stays possible).
  const held = memberActionRefusal(spaceId, userId);
  if (held) return held;
  // Everyone who sees the message fetches a sticker reaction by themselves (utils/remoteMedia.ts).
  if (!mayPostSticker(emoji, userId)) return { status: 400, code: 'sticker_elsewhere' };
  // A custom emoji must exist here, and a space's emoji be the reactor's to use (utils/emojiUse.ts).
  const emojiRefusal = reactionEmojiRefusal(emoji, userId, spaceId, spaceReactionExists(message.id, emoji));
  if (emojiRefusal) return emojiRefusal;
  if (reactionLimitReached('space', message.id, emoji)) {
    return { status: 400, code: 'reaction_limit_reached', details: { max: REACTIONS_PER_MESSAGE_MAX } };
  }

  const db = getDb();
  const reactionId = generateSnowflake();
  const now = Date.now();
  // The unique index on (message_id, user_id, emoji) keeps one reaction per
  // user and emoji. A repeat inserts nothing and announces nothing.
  const inserted = db.insert(schema.reactions).values({
    id: reactionId,
    messageId: message.id,
    userId,
    emoji,
    createdAt: now,
  }).onConflictDoNothing().run();
  if (inserted.changes === 0) return null;

  // Include user object so remote clients can use isSelf() for identity resolution
  const reactionUser = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  const userObj = reactionUser ? sanitizeUser(reactionUser) : undefined;

  connectionManager.sendToChannel(spaceId, message.channelId, {
    type: 'reaction_added',
    messageId: message.id,
    reaction: { id: reactionId, messageId: message.id, userId, emoji, createdAt: now, user: userObj },
  });
  return null;
}

/** Taking one's own reaction back from a message of a space. */
export function removeSpaceReaction(message: MessageRow, userId: string, emoji: string): ReactionRefusal | null {
  const spaceId = getChannelSpaceId(message.channelId);
  if (!spaceId || !isMember(spaceId, userId)) return { status: 404, code: 'message_not_found' };

  const result = getDb().delete(schema.reactions)
    .where(and(
      eq(schema.reactions.messageId, message.id),
      eq(schema.reactions.userId, userId),
      eq(schema.reactions.emoji, emoji),
    ))
    .run();

  if (result.changes > 0) {
    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'reaction_removed',
      messageId: message.id,
      userId,
      emoji,
    });
  }
  return null;
}
