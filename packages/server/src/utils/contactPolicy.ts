/**
 * Who may reach someone directly: the two rules a person sets in Settings → Privacy.
 *
 * On a public instance a stranger can find anyone by username, so without these only a
 * block stops them, and only after the first message. The rules say who may start
 * something. What already exists stays: a conversation someone has is theirs to end
 * with a block, and a block is checked first, because it says more.
 *
 * Only the instance that owns an account decides for it. A replicated row is another
 * instance's person and its rule columns mean nothing here, so it does not refuse.
 * An admin has no way around a rule: there is no special case for anyone.
 */
import { and, eq, or, sql } from 'drizzle-orm';
import {
  DEFAULT_DM_POLICY,
  DEFAULT_FRIEND_REQUEST_POLICY,
  DM_POLICIES,
  FRIEND_REQUEST_POLICIES,
  type DmPolicy,
  type FriendRequestPolicy,
} from '@backspace/shared';
import { getDb, schema } from '../db/index.js';

type Db = ReturnType<typeof getDb>;
type TargetRow = Pick<typeof schema.users.$inferSelect, 'id' | 'homeInstance' | 'dmPolicy' | 'friendRequestPolicy'>;

export function isDmPolicy(value: unknown): value is DmPolicy {
  return typeof value === 'string' && (DM_POLICIES as readonly string[]).includes(value);
}

export function isFriendRequestPolicy(value: unknown): value is FriendRequestPolicy {
  return typeof value === 'string' && (FRIEND_REQUEST_POLICIES as readonly string[]).includes(value);
}

export function areFriends(a: string, b: string, db: Db = getDb()): boolean {
  return db.select({ userId: schema.friends.userId }).from(schema.friends).where(or(
    and(eq(schema.friends.userId, a), eq(schema.friends.friendId, b)),
    and(eq(schema.friends.userId, b), eq(schema.friends.friendId, a)),
  )).get() !== undefined;
}

export function shareSpace(a: string, b: string, db: Db = getDb()): boolean {
  return db.$client.prepare(
    `SELECT 1 FROM space_members mine
     JOIN space_members theirs ON theirs.space_id = mine.space_id
     WHERE mine.user_id = ? AND theirs.user_id = ? LIMIT 1`,
  ).get(a, b) !== undefined;
}

/** Whether `actorId` may start a conversation with `target`. */
export function mayStartConversation(actorId: string, target: TargetRow, db: Db = getDb()): boolean {
  if (target.homeInstance) return true;
  const policy = isDmPolicy(target.dmPolicy) ? target.dmPolicy : DEFAULT_DM_POLICY;
  switch (policy) {
    case 'anyone': return true;
    case 'nobody': return false;
    case 'friends': return areFriends(actorId, target.id, db);
    case 'friends_and_spaces': return areFriends(actorId, target.id, db) || shareSpace(actorId, target.id, db);
  }
}

/** Whether `actorId` may send `target` a friend request. */
export function maySendFriendRequest(actorId: string, target: TargetRow, db: Db = getDb()): boolean {
  if (target.homeInstance) return true;
  const policy = isFriendRequestPolicy(target.friendRequestPolicy) ? target.friendRequestPolicy : DEFAULT_FRIEND_REQUEST_POLICY;
  switch (policy) {
    case 'anyone': return true;
    case 'nobody': return false;
    case 'shared_spaces': return shareSpace(actorId, target.id, db);
  }
}

/**
 * The same rule as a condition on `users`, for searching by name: someone who takes
 * no friend request from the person searching is not offered to them.
 */
export function friendRequestableBy(actorId: string) {
  return sql`(${schema.users.friendRequestPolicy} = 'anyone'
    OR (${schema.users.friendRequestPolicy} = 'shared_spaces' AND EXISTS (
      SELECT 1 FROM space_members mine
      JOIN space_members theirs ON theirs.space_id = mine.space_id
      WHERE mine.user_id = ${actorId} AND theirs.user_id = ${schema.users.id})))`;
}
