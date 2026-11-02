import { getDb, schema } from '../../db/index.js';
import { blockRefusal } from '../../utils/blocks.js';
import { DEFAULT_DM_POLICY, DEFAULT_FRIEND_REQUEST_POLICY } from '@backspace/shared';
import { areFriends, isDmPolicy, isFriendRequestPolicy, maySendFriendRequest, mayStartConversation } from '../../utils/contactPolicy.js';
import { groupDmLimitReached } from '../../utils/groupDmLimits.js';

/**
 * What a person of this instance decides, which no peer decides for them (docs/systems/federation.md,
 * "What a peer cannot decide for someone here"): a relayed group, conversation, call or friend
 * request reaches them only where this instance's own routes would let it. A block made here holds
 * for anyone who made it here, as the local routes check it for every target; the rest of the rules
 * (friendship, who may write or ask) are the home's to keep for a person homed elsewhere, as the
 * local rules say (utils/contactPolicy.ts). A refusal answers `recipient_refuses`
 * (utils/federationRejections.ts), which the sender does not retry.
 */

type Db = ReturnType<typeof getDb>;
type UserRow = typeof schema.users.$inferSelect;

/** Why such a refusal was made, for the log; the wire carries only `recipient_refuses`. */
export type LocalRefusal = 'blocked' | 'not_a_friend' | 'group_limit' | 'policy';

function homedHere(user: Pick<UserRow, 'homeInstance'>): boolean {
  return user.homeInstance === null;
}

/** Whether `a` and `b` share a 1-on-1: a group made from it takes its two people without a friendship (POST /api/dm/group). */
function shareOneOnOne(a: string, b: string, db: Db): boolean {
  return db.$client.prepare(
    `SELECT 1 FROM dm_members mine
     JOIN dm_members theirs ON theirs.dm_channel_id = mine.dm_channel_id
     JOIN dm_channels c ON c.id = mine.dm_channel_id
     WHERE mine.user_id = ? AND theirs.user_id = ? AND c.owner_id IS NULL AND c.deleted_at IS NULL
     LIMIT 1`,
  ).get(a, b) !== undefined;
}

/**
 * Why `adderId` may not put `user` of this instance into a group: as POST /api/dm/group and
 * /members would refuse it. A member adds only a friend (POST /api/dm/:id/members); the one
 * exception is a group its owner makes from a 1-on-1, which takes the other person of it without
 * one (POST /api/dm/group). Only the owner's own adds may be that (`byOwner`).
 */
export function relayedGroupAddRefusal(adderId: string, user: UserRow, byOwner: boolean, db: Db = getDb()): LocalRefusal | null {
  if (user.id === adderId) return null;
  if (blockRefusal(adderId, user.id, db)) return 'blocked';
  if (!homedHere(user)) return null;
  if (!areFriends(adderId, user.id, db) && !(byOwner && shareOneOnOne(adderId, user.id, db))) return 'not_a_friend';
  if (groupDmLimitReached(user.id)) return 'group_limit';
  return null;
}

/**
 * Why `fromId` may not write to `user` of this instance in a 1-on-1: a block either way, and, for a
 * conversation this instance does not hold yet, the person's rule on who may start one.
 */
export function relayedConversationRefusal(fromId: string, user: UserRow, startsOne: boolean, db: Db = getDb()): LocalRefusal | null {
  if (user.id === fromId) return null;
  if (blockRefusal(fromId, user.id, db)) return 'blocked';
  if (!homedHere(user)) return null;
  if (startsOne && !mayStartConversation(fromId, user, db)) return 'policy';
  return null;
}

/**
 * The same for an author this instance has no row for yet: there is nothing to block, no friend
 * and no space shared, and no conversation held, so only someone who takes messages from anyone
 * gets one.
 */
export function relayedConversationRefusalFromStranger(user: UserRow): LocalRefusal | null {
  if (!homedHere(user)) return null;
  const policy = isDmPolicy(user.dmPolicy) ? user.dmPolicy : DEFAULT_DM_POLICY;
  return policy === 'anyone' ? null : 'policy';
}

/** Why `fromId` may not send `user` of this instance a friend request: a block either way, or their rule on who may. */
export function relayedFriendRequestRefusal(fromId: string, user: UserRow, db: Db = getDb()): LocalRefusal | null {
  if (user.id === fromId) return null;
  if (blockRefusal(fromId, user.id, db)) return 'blocked';
  if (!homedHere(user)) return null;
  if (!maySendFriendRequest(fromId, user, db)) return 'policy';
  return null;
}

/**
 * The same for a sender this instance has no row for yet: there is nothing to block and no space
 * shared, so only a rule that takes requests from anyone lets it through.
 */
export function relayedFriendRequestRefusalFromStranger(user: UserRow): LocalRefusal | null {
  if (!homedHere(user)) return null;
  const policy = isFriendRequestPolicy(user.friendRequestPolicy) ? user.friendRequestPolicy : DEFAULT_FRIEND_REQUEST_POLICY;
  return policy === 'anyone' ? null : 'policy';
}

/** Whether two accounts are friends or one already asked the other: a relayed request for them changes nothing. */
export function alreadyConnected(a: string, b: string, db: Db = getDb()): boolean {
  if (areFriends(a, b, db)) return true;
  return db.$client.prepare(
    `SELECT 1 FROM friend_requests WHERE status = 'pending'
     AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) LIMIT 1`,
  ).get(a, b, b, a) !== undefined;
}

/** Why `callerId` may not ring `user` of this instance: a block either way. Who may call is who is in the conversation. */
export function relayedCallRefusal(callerId: string, user: UserRow, db: Db = getDb()): LocalRefusal | null {
  if (user.id === callerId) return null;
  return blockRefusal(callerId, user.id, db) ? 'blocked' : null;
}
