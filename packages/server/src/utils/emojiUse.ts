import { and, eq, inArray } from 'drizzle-orm';
import { emojiIdOfReaction, emojiIdsIn, splitCustomEmoji } from '@backspace/shared/src/customEmoji.js';
import type { ErrorCode } from '@backspace/shared/src/errors.js';
import { getDb, schema } from '../db/index.js';
import { isMember } from './permissions.js';

/**
 * Who may use which custom emoji (docs/systems/emoji.md, "Who may use which").
 *
 * The instance's own library is for everyone on the instance. A space's emoji is for everyone who
 * writes in that space's channels, and for the space's members anywhere on this instance: in other
 * spaces' channels and in direct messages. A token names an emoji of the instance the text belongs
 * to (the channel's host; for a direct message, the writer's home), so this instance can only judge
 * what is written here by its own accounts; a direct message relayed from another instance, or
 * written here by an account whose home is elsewhere, names that home's emoji and is not checked.
 *
 * In text, an id this instance does not know stays as written: readers see `:name:`, as they do for
 * an emoji removed later. As a reaction it is refused, since a reaction has no text to fall back on.
 * What a message already carries stays allowed when it is edited, and adding oneself to a reaction
 * someone else already gave is always allowed.
 */

export interface EmojiUseRefusal {
  status: 400 | 403;
  code: Extract<ErrorCode, 'emoji_unavailable' | 'emoji_not_found'>;
}

const UNAVAILABLE: EmojiUseRefusal = { status: 403, code: 'emoji_unavailable' };
const NOT_FOUND: EmojiUseRefusal = { status: 400, code: 'emoji_not_found' };

/** SQLite takes this many bound values in one statement and more; a message holds far fewer ids. */
const IDS_PER_QUERY = 500;

/** The space each of `ids` belongs to, for those that are a space's emoji. */
function spacesOfEmoji(ids: readonly string[]): Map<string, string> {
  const spaces = new Map<string, string>();
  const db = getDb();
  for (let start = 0; start < ids.length; start += IDS_PER_QUERY) {
    const rows = db.select({ id: schema.spaceEmojis.id, spaceId: schema.spaceEmojis.spaceId })
      .from(schema.spaceEmojis).where(inArray(schema.spaceEmojis.id, ids.slice(start, start + IDS_PER_QUERY))).all();
    for (const row of rows) spaces.set(row.id, row.spaceId);
  }
  return spaces;
}

/** Whether `userId` may use a space's emoji in `spaceId` (null: outside any space): in its own space, or as its member. */
function mayUseSpaceEmoji(emojiSpaceId: string, userId: string, spaceId: string | null, memberships: Map<string, boolean>): boolean {
  if (emojiSpaceId === spaceId) return true;
  let member = memberships.get(emojiSpaceId);
  if (member === undefined) {
    member = isMember(emojiSpaceId, userId);
    memberships.set(emojiSpaceId, member);
  }
  return member;
}

/** Whether the account lives here: only then do its direct messages name this instance's emoji. */
export function namesEmojiOfThisInstance(userId: string): boolean {
  const row = getDb().select({ homeInstance: schema.users.homeInstance }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return !!row && !row.homeInstance;
}

/**
 * Why `userId` may not write `content` in `spaceId` (null: a direct message of this instance), or
 * null when they may. `previous` is the text an edit replaces: emoji it already carried are not
 * asked about again (the writer may have left their space since).
 */
export function emojiUseRefusal(content: string | null | undefined, userId: string, spaceId: string | null, previous?: string | null): EmojiUseRefusal | null {
  const before = new Set(emojiIdsIn(previous));
  const ids = emojiIdsIn(content).filter((id) => !before.has(id));
  if (ids.length === 0) return null;
  const spaces = spacesOfEmoji(ids);
  const memberships = new Map<string, boolean>();
  for (const emojiSpaceId of spaces.values()) {
    if (!mayUseSpaceEmoji(emojiSpaceId, userId, spaceId, memberships)) return UNAVAILABLE;
  }
  return null;
}

/**
 * Why `userId` may not react with `emoji` on a message in `spaceId` (null: a direct message of this
 * instance), or null when they may. Native emoji and stickers are not this rule's to judge.
 * `alreadyOnMessage` says someone already gave this reaction: joining it is always allowed.
 */
export function reactionEmojiRefusal(emoji: string, userId: string, spaceId: string | null, alreadyOnMessage: boolean): EmojiUseRefusal | null {
  const id = emojiIdOfReaction(emoji);
  if (id === null || alreadyOnMessage) return null;
  const db = getDb();
  if (db.select({ id: schema.customEmojis.id }).from(schema.customEmojis).where(eq(schema.customEmojis.id, id)).get()) return null;
  const row = db.select({ spaceId: schema.spaceEmojis.spaceId }).from(schema.spaceEmojis).where(eq(schema.spaceEmojis.id, id)).get();
  if (!row) return NOT_FOUND;
  return mayUseSpaceEmoji(row.spaceId, userId, spaceId, new Map()) ? null : UNAVAILABLE;
}

/** Whether someone already reacted with `emoji` to the space message `messageId`. */
export function spaceReactionExists(messageId: string, emoji: string): boolean {
  return getDb().select({ id: schema.reactions.id }).from(schema.reactions)
    .where(and(eq(schema.reactions.messageId, messageId), eq(schema.reactions.emoji, emoji))).get() !== undefined;
}

/** Whether someone already reacted with `emoji` to the direct message `messageId`. */
export function dmReactionExists(messageId: string, emoji: string): boolean {
  return getDb().select({ id: schema.dmReactions.id }).from(schema.dmReactions)
    .where(and(eq(schema.dmReactions.dmMessageId, messageId), eq(schema.dmReactions.emoji, emoji))).get() !== undefined;
}

/**
 * `content` as a forward may carry it to `spaceId` (null: a direct message): every space emoji the
 * forwarder may not use there becomes the `:name:` its text names. A forward copies what someone
 * else wrote, so it is not refused for their emoji; it only cannot hand them on. For a forwarder
 * whose home is elsewhere, in a direct message every emoji becomes text: readers would look for
 * it on that home.
 */
export function forwardableEmojiText(content: string, userId: string, spaceId: string | null): string {
  const parts = splitCustomEmoji(content);
  const ids = [...new Set(parts.flatMap((part) => (part.kind === 'emoji' ? [part.id] : [])))];
  if (ids.length === 0) return content;
  if (spaceId === null && !namesEmojiOfThisInstance(userId)) {
    return parts.map((part) => (part.kind === 'emoji' ? `:${part.name}:` : part.text)).join('');
  }
  const spaces = spacesOfEmoji(ids);
  const memberships = new Map<string, boolean>();
  return parts.map((part) => {
    if (part.kind === 'text') return part.text;
    const emojiSpaceId = spaces.get(part.id);
    return emojiSpaceId === undefined || mayUseSpaceEmoji(emojiSpaceId, userId, spaceId, memberships) ? part.token : `:${part.name}:`;
  }).join('');
}
