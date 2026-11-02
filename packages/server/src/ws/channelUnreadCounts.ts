import type { ServerEvent } from '@backspace/shared';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { computePermissions, PermissionBits } from '../utils/permissions.js';
import { userWrittenMessages } from '../db/userWrittenMessages.js';
import { batchInArray } from '../utils/sqlBatch.js';

/**
 * Exact unread message counts for the sidebar badges (websocket.md,
 * "Unread counts").
 *
 * A count is the number of messages in a channel or DM after the user's
 * persisted read cursor, leaving out the user's own. It stops at
 * UNREAD_COUNT_CAP: the badges show anything above 99 as "99+", so a value of
 * UNREAD_COUNT_CAP reads "this many or more". The cap also bounds the work:
 * each count walks at most that many entries of idx_messages_channel_unread
 * (or idx_dm_messages_channel_unread), however long the channel is.
 */
export const UNREAD_COUNT_CAP = 100;

/** A channel's count is shown only to a user who can see it and read its history. */
export function canCountUnread(perms: bigint): boolean {
  if ((perms & PermissionBits.ADMINISTRATOR) !== 0n) return true;
  const needed = PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY;
  return (perms & needed) === needed;
}

function readCursor(userId: string, channelId: string): string {
  const row = getDb().select({ id: schema.readStates.lastReadMessageId })
    .from(schema.readStates)
    .where(and(eq(schema.readStates.userId, userId), eq(schema.readStates.channelId, channelId)))
    .get();
  return row?.id ?? '0';
}

// Message ids are decimal snowflakes stored as TEXT, and their length grows
// over time, so they are compared as numbers. `CAST(... AS INTEGER)` is
// written exactly as in the index definition: SQLite matches an index
// expression only when the type name has the same case.

/**
 * Messages members wrote in space channel `channelId` after `cursor` by anyone
 * but `userId`, up to the cap. A system row (a poke) is not counted.
 */
export function countChannelUnread(userId: string, channelId: string, cursor: string): number {
  const db = getDb();
  const unread = db.select({ one: sql<number>`1`.as('one') }).from(schema.messages).where(and(
    eq(schema.messages.channelId, channelId),
    sql`CAST(${schema.messages.id} AS INTEGER) > CAST(${cursor} AS INTEGER)`,
    ne(schema.messages.userId, userId),
    userWrittenMessages(),
  )).limit(UNREAD_COUNT_CAP).as('unread');
  return db.select({ count: sql<number>`count(*)` }).from(unread).get()?.count ?? 0;
}

/** Messages in DM `dmChannelId` after `cursor` by anyone but `userId`, up to the cap. */
export function countDmUnread(userId: string, dmChannelId: string, cursor: string): number {
  const db = getDb();
  const unread = db.select({ one: sql<number>`1`.as('one') }).from(schema.dmMessages).where(and(
    eq(schema.dmMessages.dmChannelId, dmChannelId),
    sql`CAST(${schema.dmMessages.id} AS INTEGER) > CAST(${cursor} AS INTEGER)`,
    ne(schema.dmMessages.userId, userId),
  )).limit(UNREAD_COUNT_CAP).as('unread');
  return db.select({ count: sql<number>`count(*)` }).from(unread).get()?.count ?? 0;
}

/**
 * The `ready` snapshot. `channelIds` are the space channels the caller
 * already found countable (`canCountUnread` on the permissions it computed),
 * `dmChannelIds` the open DMs in the payload, `cursors` the user's read
 * states. Every listed id gets an entry, zero included, so the client can
 * tell a read channel from one this instance did not count.
 */
export function readyUnreadCounts(
  userId: string,
  channelIds: readonly string[],
  dmChannelIds: readonly string[],
  cursors: ReadonlyMap<string, string>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of channelIds) counts[id] = countChannelUnread(userId, id, cursors.get(id) ?? '0');
  for (const id of dmChannelIds) counts[id] = countDmUnread(userId, id, cursors.get(id) ?? '0');
  return counts;
}

/**
 * Count for one space channel. `perms` are the user's permissions in it when
 * the caller has them (a channel fan-out computes them to pick the
 * audience); otherwise they are computed here. A channel the user may not
 * read counts zero, so a badge clears when access is lost.
 */
function spaceChannelCount(userId: string, channelId: string, perms: bigint | undefined): number | null {
  let resolved = perms;
  if (resolved === undefined) {
    const channel = getDb().select({ spaceId: schema.channels.spaceId })
      .from(schema.channels).where(eq(schema.channels.id, channelId)).get();
    if (!channel) return null;
    resolved = computePermissions(userId, channel.spaceId, channelId);
  }
  if (!canCountUnread(resolved)) return 0;
  return countChannelUnread(userId, channelId, readCursor(userId, channelId));
}

/** Count for one DM, only while the user is an open member of a live conversation. */
function dmCount(userId: string, dmChannelId: string): number | null {
  const membership = getDb().select({ id: schema.dmMembers.dmChannelId })
    .from(schema.dmMembers)
    .innerJoin(schema.dmChannels, eq(schema.dmChannels.id, schema.dmMembers.dmChannelId))
    .where(and(
      eq(schema.dmMembers.dmChannelId, dmChannelId),
      eq(schema.dmMembers.userId, userId),
      eq(schema.dmMembers.closed, 0),
      isNull(schema.dmChannels.deletedAt),
    ))
    .get();
  if (!membership) return null;
  return countDmUnread(userId, dmChannelId, readCursor(userId, dmChannelId));
}

/**
 * As many of a channel's newest messages as answer nearly everyone's count at once: it takes more
 * than the cap only for someone who wrote many of them themselves, and that one is asked for alone.
 */
const NEWEST_READ_AT_ONCE = UNREAD_COUNT_CAP * 2;

const asNumber = (id: string): bigint => (/^\d+$/.test(id) ? BigInt(id) : 0n);

/**
 * `countChannelUnread` for everyone in `userIds`, from one read of the channel's newest messages.
 * The same answers (`channelUnreadCounts.test.ts` compares them), without a query for each person
 * who is online whenever someone writes.
 */
export function channelUnreadCountsFor(channelId: string, userIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (userIds.length === 0) return counts;
  const db = getDb();

  // Newest first, as the index holds them.
  const newest = db.select({ id: schema.messages.id, userId: schema.messages.userId }).from(schema.messages)
    .where(and(eq(schema.messages.channelId, channelId), userWrittenMessages()))
    .orderBy(desc(sql`CAST(${schema.messages.id} AS INTEGER)`))
    .limit(NEWEST_READ_AT_ONCE)
    .all();
  const ids = newest.map((row) => asNumber(row.id));
  const placesOf = new Map<string, number[]>();
  newest.forEach((row, place) => {
    const places = placesOf.get(row.userId);
    if (places) places.push(place);
    else placesOf.set(row.userId, [place]);
  });

  const cursors = new Map(batchInArray([...userIds], (chunk) => db.select({ userId: schema.readStates.userId, id: schema.readStates.lastReadMessageId })
    .from(schema.readStates)
    .where(and(eq(schema.readStates.channelId, channelId), inArray(schema.readStates.userId, chunk))).all())
    .map((row) => [row.userId, row.id]));

  /** How many of the list come before the first entry `isPast` says yes to. */
  const placeOf = (length: number, isPast: (place: number) => boolean): number => {
    let low = 0;
    let high = length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (isPast(middle)) high = middle;
      else low = middle + 1;
    }
    return low;
  };

  for (const userId of userIds) {
    const cursorText = cursors.get(userId) ?? '0';
    const cursor = asNumber(cursorText);
    const newer = placeOf(ids.length, (place) => (ids[place] as bigint) <= cursor);
    const own = placesOf.get(userId);
    const ownNewer = own ? placeOf(own.length, (place) => (own[place] as number) >= newer) : 0;
    const counted = newer - ownNewer;
    // All that was read is newer than their cursor, and they wrote so much of it that it may go on.
    if (newer === NEWEST_READ_AT_ONCE && counted < UNREAD_COUNT_CAP) counts.set(userId, countChannelUnread(userId, channelId, cursorText));
    else counts.set(userId, Math.min(counted, UNREAD_COUNT_CAP));
  }
  return counts;
}

/** The space channel an event in it moves the count of, or null when it moves none. */
function countedChannelOf(event: ServerEvent): string | null {
  switch (event.type) {
    case 'message_created':
      return event.message.channelId;
    case 'message_deleted':
      return event.channelId;
    case 'channel_updated':
      return event.channel.id;
    default:
      return null;
  }
}

/**
 * `unreadCountFollowUp` for everyone a channel's event goes to, as text ready to send: who is in
 * `permsOf`, with their rights in that channel. People with the same count share one string.
 */
export function unreadFollowUpsFor(event: ServerEvent, permsOf: ReadonlyMap<string, bigint>): Map<string, string> {
  const followUps = new Map<string, string>();
  const channelId = countedChannelOf(event);
  if (!channelId) return followUps;
  const readers = [...permsOf].filter(([, perms]) => canCountUnread(perms)).map(([userId]) => userId);
  const counts = channelUnreadCountsFor(channelId, readers);
  const textFor = new Map<number, string>();
  for (const userId of permsOf.keys()) {
    // A channel someone may not read counts zero, so a badge clears when access is lost.
    const count = counts.get(userId) ?? 0;
    let text = textFor.get(count);
    if (text === undefined) {
      text = JSON.stringify(countEvent(channelId, count));
      textFor.set(count, text);
    }
    followUps.set(userId, text);
  }
  return followUps;
}

function isSpaceChannel(channelId: string): boolean {
  return getDb().select({ id: schema.channels.id })
    .from(schema.channels).where(eq(schema.channels.id, channelId)).get() !== undefined;
}

function countEvent(channelId: string, count: number | null): ServerEvent | null {
  return count === null ? null : { type: 'channel_unread_count', counts: { [channelId]: count } };
}

/**
 * The `channel_unread_count` that follows `event` on the same socket, or
 * null when the event does not change what the user has unread.
 *
 * Only events that move a count are followed: a new or deleted message, a
 * read cursor moved by the user (here or, for a DM, relayed from a peer as
 * `channel_ack`), a channel whose visibility was recomputed, and a DM that
 * opened for the user. A new channel has nothing to count, and a deleted or
 * closed one leaves the sidebar with its row.
 */
export function unreadCountFollowUp(userId: string, event: ServerEvent, channelPerms?: bigint): ServerEvent | null {
  switch (event.type) {
    case 'message_created':
      return countEvent(event.message.channelId, spaceChannelCount(userId, event.message.channelId, channelPerms));
    case 'message_deleted':
      return countEvent(event.channelId, spaceChannelCount(userId, event.channelId, channelPerms));
    case 'channel_updated':
      return countEvent(event.channel.id, spaceChannelCount(userId, event.channel.id, channelPerms));
    case 'dm_message_created':
      return countEvent(event.message.dmChannelId, dmCount(userId, event.message.dmChannelId));
    case 'dm_message_deleted':
      return countEvent(event.dmChannelId, dmCount(userId, event.dmChannelId));
    case 'dm_channel_created':
      return countEvent(event.dmChannel.id, dmCount(userId, event.dmChannel.id));
    case 'channel_ack':
    case 'mark_unread':
      return countEvent(event.channelId, isSpaceChannel(event.channelId)
        ? spaceChannelCount(userId, event.channelId, undefined)
        : dmCount(userId, event.channelId));
    default:
      return null;
  }
}
