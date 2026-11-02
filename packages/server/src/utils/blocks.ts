/**
 * Blocking: one person shutting another out of direct contact.
 *
 * A block is made by one person (the blocker) and is never announced to the
 * other. While it exists, direct contact between the two is closed in BOTH
 * directions on this server: neither can send the other a friend request, start
 * a 1-on-1 conversation, message the other in the one they already share, or
 * call. Making the block also ends a friendship and withdraws friend requests
 * between them.
 *
 * What a block cannot do, because it would take the room away from other people:
 * remove someone from a space or a group conversation they share with the
 * blocker. There the clients hide the blocked person's messages instead.
 *
 * The two people hear different words when a block stops them. The blocker is
 * told they have blocked the person (`blocked_by_you`), so the way out is plain.
 * The blocked person gets a neutral refusal (`interaction_unavailable`) that does not
 * say whether a block is why.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { BlockedUser } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { sanitizeUser } from './sanitize.js';

type Db = ReturnType<typeof getDb>;

export type BlockRefusal = 'blocked_by_you' | 'interaction_unavailable';

/** Whether `blockerId` has blocked `blockedId`. */
export function hasBlocked(blockerId: string, blockedId: string, db: Db = getDb()): boolean {
  return db.select({ blockerId: schema.userBlocks.blockerId })
    .from(schema.userBlocks)
    .where(and(eq(schema.userBlocks.blockerId, blockerId), eq(schema.userBlocks.blockedId, blockedId)))
    .get() !== undefined;
}

/**
 * Why `actorId` may not deal directly with `otherId`, or null when nothing
 * stands between them. The actor's own block wins: it is the one they can undo.
 */
export function blockRefusal(actorId: string, otherId: string, db: Db = getDb()): BlockRefusal | null {
  if (hasBlocked(actorId, otherId, db)) return 'blocked_by_you';
  if (hasBlocked(otherId, actorId, db)) return 'interaction_unavailable';
  return null;
}

/**
 * The refusal that applies to `actorId` acting in conversation `dmChannelId`,
 * or null. Only a 1-on-1 can be closed this way; a group has other people in it.
 */
export function oneOnOneBlockRefusal(dmChannelId: string, actorId: string, db: Db = getDb()): BlockRefusal | null {
  const channel = db.select({ ownerId: schema.dmChannels.ownerId })
    .from(schema.dmChannels).where(eq(schema.dmChannels.id, dmChannelId)).get();
  if (!channel || channel.ownerId !== null) return null;
  const others = db.select({ userId: schema.dmMembers.userId })
    .from(schema.dmMembers)
    .where(and(eq(schema.dmMembers.dmChannelId, dmChannelId), sql`${schema.dmMembers.userId} != ${actorId}`))
    .all();
  for (const other of others) {
    const refusal = blockRefusal(actorId, other.userId, db);
    if (refusal) return refusal;
  }
  return null;
}

/** The ids `blockerId` has blocked. */
export function listBlockedIds(blockerId: string, db: Db = getDb()): string[] {
  return db.select({ blockedId: schema.userBlocks.blockedId })
    .from(schema.userBlocks)
    .where(eq(schema.userBlocks.blockerId, blockerId))
    .all()
    .map((row) => row.blockedId);
}

/** The people `blockerId` has blocked, most recent first. */
export function listBlocks(blockerId: string, db: Db = getDb()): BlockedUser[] {
  const rows = db.select().from(schema.userBlocks)
    .where(eq(schema.userBlocks.blockerId, blockerId))
    .all();
  if (rows.length === 0) return [];
  const users = db.select().from(schema.users)
    .where(inArray(schema.users.id, rows.map((row) => row.blockedId)))
    .all();
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows
    .filter((row) => byId.has(row.blockedId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((row) => ({ user: sanitizeUser(byId.get(row.blockedId)!), blockedAt: row.createdAt }));
}

/** What making a block ended, so the caller can tell the clients. */
export interface BlockResult {
  /** The block is new (it did not exist before). */
  created: boolean;
  /** A friendship between the two was removed. */
  removedFriendship: boolean;
  /** Pending friend requests between the two that were withdrawn. */
  removedRequests: Array<{ id: string; fromId: string; toId: string }>;
}

/**
 * Blocks `blockedId` for `blockerId`. Idempotent. Ends the friendship and
 * withdraws pending friend requests in either direction, in one transaction.
 */
export function addBlock(blockerId: string, blockedId: string, db: Db = getDb()): BlockResult {
  return db.transaction((tx) => {
    const existing = tx.select({ blockerId: schema.userBlocks.blockerId })
      .from(schema.userBlocks)
      .where(and(eq(schema.userBlocks.blockerId, blockerId), eq(schema.userBlocks.blockedId, blockedId)))
      .get();
    if (!existing) {
      tx.insert(schema.userBlocks).values({ blockerId, blockedId, createdAt: Date.now() }).run();
    }

    const pair = or(
      and(eq(schema.friends.userId, blockerId), eq(schema.friends.friendId, blockedId)),
      and(eq(schema.friends.userId, blockedId), eq(schema.friends.friendId, blockerId)),
    );
    const friendship = tx.select({ userId: schema.friends.userId }).from(schema.friends).where(pair).all();
    if (friendship.length > 0) tx.delete(schema.friends).where(pair).run();

    const requestPair = and(
      eq(schema.friendRequests.status, 'pending'),
      or(
        and(eq(schema.friendRequests.fromId, blockerId), eq(schema.friendRequests.toId, blockedId)),
        and(eq(schema.friendRequests.fromId, blockedId), eq(schema.friendRequests.toId, blockerId)),
      ),
    );
    const requests = tx.select({
      id: schema.friendRequests.id,
      fromId: schema.friendRequests.fromId,
      toId: schema.friendRequests.toId,
    }).from(schema.friendRequests).where(requestPair).all();
    if (requests.length > 0) tx.delete(schema.friendRequests).where(requestPair).run();

    return { created: !existing, removedFriendship: friendship.length > 0, removedRequests: requests };
  });
}

/** Lifts the block. Idempotent; true when there was one. */
export function removeBlock(blockerId: string, blockedId: string, db: Db = getDb()): boolean {
  const had = hasBlocked(blockerId, blockedId, db);
  if (had) {
    db.delete(schema.userBlocks)
      .where(and(eq(schema.userBlocks.blockerId, blockerId), eq(schema.userBlocks.blockedId, blockedId)))
      .run();
  }
  return had;
}
