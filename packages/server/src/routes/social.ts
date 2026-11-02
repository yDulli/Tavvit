import { needsVerifiedEmail } from '../email/gate.js';
import { friendRequestableBy, maySendFriendRequest } from '../utils/contactPolicy.js';
import { blockRefusal } from '../utils/blocks.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, or, ne, not, sql, asc, isNull } from 'drizzle-orm';
import { getDb, getRawDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { connectionManager } from '../ws/handler.js';
import { exchangeFriendPresence } from '../ws/presence.js';
import { appendMutationLog, queueOutboxEvent, buildFriendContextId, getFriendEventTargets } from '../utils/federationOutbox.js';
import { recordLocalFriendPairChange } from '../utils/federationSubjectClock.js';
import { getOurOrigin, normalizeOriginForCompare } from '../utils/federationAuth.js';
import { ensurePeered } from '../utils/federationPeering.js';
import { lookupRemoteUser, lookupRemoteUserByHomeId, type LookupResult } from '../utils/federationLookup.js';
import { resolveOriginFromHostname } from '../utils/federationOriginResolve.js';
import { resolveOrCreateReplicatedUser, hydrateReplicatedUserProfile, isOwnDomain } from './federation.js';
import type { FederationRelayEvent, FederationRelayProfileSnapshot } from '@backspace/shared';
import type {
  Friend,
  FriendRequest,
  SendFriendRequest,
  UpdateFriendRequest,
  UserSearchResult,
} from '@backspace/shared';
import { sanitizeUser } from '../utils/sanitize.js';
import { relayHandleOf } from './federation/stubName.js';
import { sendError } from '../utils/httpErrors.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { suspendedNow } from '../utils/suspension.js';

export function buildProfileSnapshot(user: typeof schema.users.$inferSelect): FederationRelayProfileSnapshot {
  if (user.isDeleted) {
    // Never ship the internal '!deleted:<id>' tombstone marker (spec §3.3).
    return { deleted: true };
  }
  // Only meaningful for native users (us). Replicated stubs carry stale status
  // their home owns — emitting it would flap remote UIs on relay receipt.
  const status = !user.homeInstance && user.status
    ? (user.status as 'online' | 'idle' | 'dnd' | 'offline')
    : null;
  return {
    username: relayHandleOf(user),
    displayName: user.displayName ?? null,
    avatar: user.avatar ?? null,
    avatarColor: user.avatarColor ?? null,
    banner: user.banner ?? null,
    bio: user.bio ?? null,
    status,
  };
}

// ─── Finding people ──────────────────────────────────────────────────────────

/** A username query: the characters usernames are made of, at least a whole username's minimum. */
const USER_SEARCH_MIN_LENGTH = 3;
const USER_SEARCH_MAX_LENGTH = 32;
const USER_SEARCH_QUERY = /^[a-z0-9_]{3,32}$/;
/** Results per query. */
const USER_SEARCH_LIMIT = 8;
/** Queries per account and minute, besides the per-address limit. */
const userSearchLimit = createFixedWindowLimit({ max: 20, windowMs: 60 * 1000 });

/** Tests reset the per-account budget between cases. */
export function _resetUserSearchLimit(): void {
  userSearchLimit.reset();
}

// ─── Local friend request helper ─────────────────────────────────────────────

/** A user of this instance named by its username (a typed handle's local part). */
function findLocalUserByUsername(
  db: ReturnType<typeof getDb>,
  localUsername: string,
): typeof schema.users.$inferSelect | undefined {
  // Match the canonical-lowercase form used by auth (auth.ts:32, 211, 256),
  // among live accounts of this instance: a tombstone's or a replicated row's
  // stored name is no handle.
  return db.select().from(schema.users).where(and(
    eq(schema.users.username, localUsername.toLowerCase()),
    eq(schema.users.isDeleted, 0),
    eq(schema.users.accountKind, 'person'),
    isNull(schema.users.homeInstance),
  )).get();
}

/**
 * A native user of this instance named by its federated id: the row's own id,
 * or the `homeUserId` natives carry. The same match `/users/by-home-id` makes
 * for a peer. Replicated rows are excluded: their local id is not an identity
 * homed here.
 */
function findNativeUserByHomeId(
  db: ReturnType<typeof getDb>,
  homeUserId: string,
): typeof schema.users.$inferSelect | undefined {
  return db.select().from(schema.users).where(and(
    eq(schema.users.isDeleted, 0),
    eq(schema.users.accountKind, 'person'),
    isNull(schema.users.homeInstance),
    or(eq(schema.users.id, homeUserId), eq(schema.users.homeUserId, homeUserId)),
  )).get();
}

async function handleLocalFriendRequest(
  db: ReturnType<typeof getDb>,
  request: FastifyRequest,
  reply: FastifyReply,
  targetUser: typeof schema.users.$inferSelect | undefined,
  sender: typeof schema.users.$inferSelect,
  ourOrigin: string,
): Promise<unknown> {
  if (!targetUser) {
    return sendError(reply, 404, 'user_not_found');
  }

  if (targetUser.id === request.userId) {
    return sendError(reply, 400, 'cannot_friend_self');
  }

  // A block closes this in both directions; the person who was blocked is
  // refused without being told why (utils/blocks.ts).
  const blocked = blockRefusal(request.userId, targetUser.id, db);
  if (blocked) {
    return sendError(reply, 403, blocked);
  }

  // Check if already friends
  const existingFriend = db.select().from(schema.friends).where(or(
    and(eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, targetUser.id)),
    and(eq(schema.friends.userId, targetUser.id), eq(schema.friends.friendId, request.userId))
  )).get();

  if (existingFriend) {
    return sendError(reply, 400, 'already_friends');
  }

  // Check for existing pending request
  const existingRequest = db.select().from(schema.friendRequests).where(and(
    or(
      and(eq(schema.friendRequests.fromId, request.userId), eq(schema.friendRequests.toId, targetUser.id)),
      and(eq(schema.friendRequests.fromId, targetUser.id), eq(schema.friendRequests.toId, request.userId))
    ),
    eq(schema.friendRequests.status, 'pending')
  )).get();

  if (existingRequest) {
    return sendError(reply, 400, 'friend_request_pending');
  }

  // The target's own rule (utils/contactPolicy.ts). After the checks above, so
  // someone they already know about hears what they always heard.
  if (!maySendFriendRequest(request.userId, targetUser, db)) {
    return sendError(reply, 403, 'friend_request_not_accepted');
  }

  // Create the request
  const id = generateSnowflake();
  const now = Date.now();
  db.insert(schema.friendRequests).values({
    id,
    fromId: request.userId,
    toId: targetUser.id,
    status: 'pending',
    createdAt: now,
  }).run();

  // Broadcast to the target: they need to know who sent the request (sender profile).
  const receivedPayload: FriendRequest = {
    id,
    fromId: request.userId,
    toId: targetUser.id,
    status: 'pending',
    createdAt: now,
    user: sanitizeUser(sender),
  };

  // Broadcast to the sender's other tabs: they need to know who they added (target profile).
  const sentPayload: FriendRequest = {
    id,
    fromId: request.userId,
    toId: targetUser.id,
    status: 'pending',
    createdAt: now,
    user: sanitizeUser(targetUser),
  };

  connectionManager.sendToUser(targetUser.id, {
    type: 'friend_request_received',
    request: receivedPayload,
  });

  connectionManager.sendToUser(request.userId, {
    type: 'friend_request_sent',
    request: sentPayload,
  });

  // Federation relay: notify the target user's home instance
  const fromIdentity = {
    homeUserId: sender.homeUserId || request.userId,
    homeInstance: sender.homeInstance || ourOrigin,
  };
  const toIdentity = {
    homeUserId: targetUser.homeUserId || targetUser.id,
    homeInstance: targetUser.homeInstance || ourOrigin,
  };

  const targets = getFriendEventTargets(fromIdentity.homeInstance, toIdentity.homeInstance);
  if (targets.length > 0) {
    const contextId = buildFriendContextId(fromIdentity.homeUserId, toIdentity.homeUserId);
    const entityId = `friend_req:${[fromIdentity.homeUserId, toIdentity.homeUserId].sort().join(':')}:${now}`;

    const payload: FederationRelayEvent = {
      eventType: 'friend_request_create',
      contextType: 'friend',
      messageId: entityId,
      encryptionVersion: 0,
      timestamp: now,
      friendship: {
        from: fromIdentity,
        to: toIdentity,
        fromProfile: buildProfileSnapshot(sender),
        toProfile: buildProfileSnapshot(targetUser),
        status: 'pending',
        createdAt: now,
      },
    };

    const payloadStr = JSON.stringify(payload);
    // The pair's clock (federation.md "Subject clocks") moves to this change.
    recordLocalFriendPairChange(fromIdentity, toIdentity, now, db);
    appendMutationLog(entityId, contextId, 'friend_request_create', payloadStr, 'friend');
    queueOutboxEvent(entityId, contextId, 'friend_request_create', payloadStr, targets, 'friend');
  }

  return reply.code(201).send({ success: true, requestId: id });
}

// ─── Federated friend request helper ─────────────────────────────────────────

/**
 * A user on another instance, as the request names it. `lookup` asks that
 * instance for its native user: by username for a typed handle, by home id
 * for an identity the client already holds. Everything after the lookup is
 * the same for both.
 */
interface RemoteFriendTarget {
  /** Host (and port, if any) of the target's home instance, lowercased. */
  targetDomain: string;
  /**
   * The target's name on its instance, as far as the request tells it. With
   * `targetDomain` it forms the `name@domain` peering trigger target, which
   * the Connections panel's Retry puts back into the Add Friend input.
   */
  handle: string;
  lookup: (peerOrigin: string) => Promise<LookupResult>;
}

async function handleFederatedFriendRequest(
  db: ReturnType<typeof getDb>,
  reply: FastifyReply,
  target: RemoteFriendTarget,
  sender: typeof schema.users.$inferSelect,
  ourOrigin: string,
): Promise<unknown> {
  const { targetDomain, handle } = target;

  // A friend on another instance needs federation, which is off unless the
  // operator enabled it. Say so plainly rather than as an unreachable peer.
  if (!config.federation.enabled) {
    return sendError(reply, 403, 'federation_disabled');
  }

  // 1. Resolve scheme
  const peerOrigin = resolveOriginFromHostname(targetDomain);
  if (!peerOrigin) {
    return sendError(reply, 400, 'invalid_target_domain', { domain: targetDomain });
  }

  // 1a. Limbo-window guard (federation instance-epoch self-healing §5.3).
  //     If this peer's home instance was reset-detected but the admin has not yet
  //     re-peered, an UNRESOLVED `federation_reset_events` row exists for its origin
  //     (the peer sits in `needs_attention`, its local friendship/stub graph still
  //     bound to the dead incarnation). Without this guard the re-add would surface
  //     a confusing `already_friends` (stale friendship) or `peer_rejected` (the
  //     needs_attention peer) — neither of which tells the user what to do. Return a
  //     clear `peer_reset_pending` instead.
  //
  //     `resolveOriginFromHostname` returns the peer's stored `federation_peers.origin`
  //     verbatim, which is exactly the string `markPeerReset` journals as
  //     `federation_reset_events.origin` (its PRIMARY KEY), so this is an O(1) indexed
  //     point lookup. The common case — no reset in progress — is a single indexed miss
  //     and the normal path proceeds unchanged.
  const pendingReset = db
    .select({ origin: schema.federationResetEvents.origin })
    .from(schema.federationResetEvents)
    .where(and(
      eq(schema.federationResetEvents.origin, peerOrigin),
      isNull(schema.federationResetEvents.resolvedAt),
    ))
    .get();
  if (pendingReset) {
    return sendError(reply, 409, 'peer_reset_pending');
  }

  // 2. ensurePeered — block until 'active', or surface peer status as error
  const peering = await ensurePeered(peerOrigin, {
    kind: 'user_action',
    userId: sender.id,
    reason: 'friend_add',
    target: `${handle}@${targetDomain}`,
  });
  if (peering.status === 'rejected') {
    return sendError(reply, 403, 'peer_rejected', { domain: targetDomain });
  }
  if (peering.status === 'failed') {
    return sendError(reply, 503, 'peer_unreachable', { domain: targetDomain });
  }
  if (peering.status === 'pending') {
    const peerRow = db.select({ status: schema.federationPeers.status })
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.origin, peerOrigin))
      .get();
    if (peerRow?.status === 'awaiting_approval') {
      return sendError(reply, 409, 'peer_pending_approval', { domain: targetDomain });
    }
    return sendError(reply, 409, 'peer_pending', { domain: targetDomain });
  }
  if (peering.status === 'admin_required') {
    return sendError(reply, 409, 'peer_pending_local_admin', { domain: targetDomain });
  }
  // peering.status === 'active' — continue

  // 3. Lookup — a peer's HTTP/transport failure must never surface as a raw 500
  // on a user action. Both lookups map peer HTTP failures (403/5xx, malformed
  // body) to a structured `unreachable`; they throw only when the peer row is
  // missing. This try/catch returns such a throw to the user as a graceful 503
  // rather than an Internal Server Error. (BUG-3, 2026-07-02: a desynced peer
  // returned 403 → unhandled throw → 500.)
  let lookup: LookupResult;
  try {
    lookup = await target.lookup(peerOrigin);
  } catch (err) {
    console.error('[social] federated friend-add lookup failed for %s:', peerOrigin, err);
    return sendError(reply, 503, 'peer_unreachable', { domain: targetDomain });
  }
  if (!lookup.ok) {
    if (lookup.reason === 'not_found') {
      return sendError(reply, 404, 'user_not_found', { domain: targetDomain, handle });
    }
    if (lookup.reason === 'unreachable') {
      return sendError(reply, 503, 'peer_unreachable', { domain: targetDomain });
    }
    if (lookup.reason === 'rate_limited') {
      const headers: Record<string, string> = {};
      if (lookup.retryAfter) headers['Retry-After'] = String(lookup.retryAfter);
      return sendError(reply.headers(headers), 429, 'lookup_rate_limited');
    }
    // Exhaustive — should be unreachable.
    return sendError(reply, 500, 'lookup_failed');
  }

  // 4. Self-friend pre-check
  const senderCanonicalId = sender.homeUserId || sender.id;
  if (
    lookup.homeUserId === senderCanonicalId &&
    normalizeOriginForCompare(peerOrigin) === normalizeOriginForCompare(ourOrigin)
  ) {
    return sendError(reply, 400, 'cannot_friend_self');
  }

  // 5. Resolve / hydrate stub
  const stub = resolveOrCreateReplicatedUser(lookup.homeUserId, targetDomain, db, { username: lookup.username, status: lookup.profile.status });
  if (!stub) {
    // Tombstoned identity — refuse to resurrect.
    return sendError(reply, 404, 'user_not_found', { domain: targetDomain, handle });
  }
  // A block closes this in both directions, as for a local person; the person
  // who was blocked is refused without being told why (utils/blocks.ts).
  const blocked = blockRefusal(sender.id, stub.id, db);
  if (blocked) {
    return sendError(reply, 403, blocked);
  }
  const stubHydrated = await hydrateReplicatedUserProfile(stub, lookup.profile, db);

  // 5a. Direction-aware idempotency
  const existingRequest = db.select().from(schema.friendRequests).where(and(
    or(
      and(eq(schema.friendRequests.fromId, sender.id), eq(schema.friendRequests.toId, stubHydrated.id)),
      and(eq(schema.friendRequests.fromId, stubHydrated.id), eq(schema.friendRequests.toId, sender.id)),
    ),
    eq(schema.friendRequests.status, 'pending'),
  )).get();

  if (existingRequest) {
    if (existingRequest.fromId === sender.id) {
      // Same direction — idempotent return
      return reply.code(200).send({ success: true, requestId: existingRequest.id });
    } else {
      // Opposite direction — incoming request already exists
      return sendError(reply, 409, 'incoming_request_exists', { requestId: existingRequest.id });
    }
  }

  // 5b. Already-friends check
  const existingFriend = db.select().from(schema.friends).where(or(
    and(eq(schema.friends.userId, sender.id), eq(schema.friends.friendId, stubHydrated.id)),
    and(eq(schema.friends.userId, stubHydrated.id), eq(schema.friends.friendId, sender.id)),
  )).get();

  if (existingFriend) {
    return sendError(reply, 409, 'already_friends');
  }

  // 6. Transaction: insert + log + queue outbox
  const now = Date.now();
  const fromIdentity = {
    homeUserId: sender.homeUserId || sender.id,
    homeInstance: ourOrigin,
  };
  const toIdentity = {
    homeUserId: stubHydrated.homeUserId!,
    homeInstance: peerOrigin,
  };
  const contextId = buildFriendContextId(fromIdentity.homeUserId, toIdentity.homeUserId);
  const entityId = `friend_req:${[fromIdentity.homeUserId, toIdentity.homeUserId].sort().join(':')}:${now}`;
  const requestId = generateSnowflake();

  const payload: FederationRelayEvent = {
    eventType: 'friend_request_create',
    contextType: 'friend',
    messageId: entityId,
    encryptionVersion: 0,
    timestamp: now,
    friendship: {
      from: fromIdentity,
      to: toIdentity,
      fromProfile: buildProfileSnapshot(sender),
      toProfile: {
        username: stubHydrated.username,
        displayName: lookup.profile.displayName,
        avatar: lookup.profile.avatar,
        avatarColor: lookup.profile.avatarColor,
        banner: lookup.profile.banner,
        bio: lookup.profile.bio,
        status: lookup.profile.status ?? null,
      },
      status: 'pending',
      createdAt: now,
    },
  };
  const payloadStr = JSON.stringify(payload);

  const rawDb = getRawDb();
  rawDb.transaction(() => {
    // The pair's clock (federation.md "Subject clocks") moves to this change.
    recordLocalFriendPairChange(fromIdentity, toIdentity, now, db);
    db.insert(schema.friendRequests).values({
      id: requestId,
      fromId: sender.id,
      toId: stubHydrated.id,
      status: 'pending',
      createdAt: now,
      relayMessageId: entityId,
    }).run();
    appendMutationLog(entityId, contextId, 'friend_request_create', payloadStr, 'friend');
    queueOutboxEvent(entityId, contextId, 'friend_request_create', payloadStr, [peerOrigin], 'friend');
  })();

  // 7. WS broadcast to sender's other tabs/devices
  const requestSnapshot: FriendRequest = {
    id: requestId,
    fromId: sender.id,
    toId: stubHydrated.id,
    status: 'pending',
    createdAt: now,
    user: sanitizeUser(stubHydrated),
  };
  connectionManager.sendToUser(sender.id, { type: 'friend_request_sent', request: requestSnapshot });

  return reply.code(201).send({ success: true, requestId });
}

// ─── Request body ─────────────────────────────────────────────────────────────

/** Longest `homeUserId` accepted. Ids are snowflakes or UUIDs. */
const MAX_HOME_USER_ID_LENGTH = 128;

type ParsedSendFriendRequest =
  | { kind: 'identity'; homeUserId: string; homeInstance: string; username: string | null }
  | { kind: 'username'; username: string }
  | { kind: 'invalid'; code: 'username_required' | 'validation_failed' };

/**
 * Read the target of `POST /api/social/requests` (`SendFriendRequest`). An
 * identity (`homeUserId` + `homeInstance`, both required together) takes
 * precedence over `username`: a client that sends one also sends the username
 * so that a server predating the identity fields can still serve it.
 * `homeInstance` is returned normalized (no scheme, lowercased).
 */
function parseSendFriendRequest(body: unknown): ParsedSendFriendRequest {
  const fields: Partial<Record<keyof SendFriendRequest, unknown>> =
    body !== null && typeof body === 'object' ? body : {};
  const username = typeof fields.username === 'string' && fields.username.trim()
    ? fields.username.trim()
    : null;

  if (fields.homeUserId != null || fields.homeInstance != null) {
    const homeUserId = typeof fields.homeUserId === 'string' ? fields.homeUserId.trim() : '';
    const homeInstance = typeof fields.homeInstance === 'string'
      ? normalizeOriginForCompare(fields.homeInstance)
      : null;
    if (!homeUserId || homeUserId.length > MAX_HOME_USER_ID_LENGTH || !homeInstance) {
      return { kind: 'invalid', code: 'validation_failed' };
    }
    return { kind: 'identity', homeUserId, homeInstance, username };
  }

  if (!username) return { kind: 'invalid', code: 'username_required' };
  return { kind: 'username', username };
}

/**
 * The name to record for an identity-addressed remote target before the peer
 * has answered: the local part of the username sent alongside, when that
 * username is on the same instance, else the home id.
 */
function handleForIdentity(target: { homeUserId: string; homeInstance: string; username: string | null }): string {
  const typed = target.username?.toLowerCase() ?? '';
  const atIndex = typed.lastIndexOf('@');
  if (atIndex > 0 && normalizeOriginForCompare(typed.slice(atIndex + 1)) === target.homeInstance) {
    return typed.slice(0, atIndex);
  }
  return target.homeUserId;
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/social/friends - List all friends
  app.get('/api/social/friends', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();

    // Get all friends where current user is either userId or friendId
    const friendRows = db.select()
      .from(schema.friends)
      .where(or(
        eq(schema.friends.userId, request.userId),
        eq(schema.friends.friendId, request.userId)
      ))
      .all();

    if (friendRows.length === 0) {
      return reply.code(200).send([]);
    }

    // Get the IDs of the actual friends (not the current user)
    const friendIds = friendRows.map(f => f.userId === request.userId ? f.friendId : f.userId);

    const friendUsers = db.select()
      .from(schema.users)
      .where(or(...friendIds.map(id => eq(schema.users.id, id))))
      .all();

    const friends: Friend[] = friendUsers.map(u => {
      const relationship = friendRows.find(f => f.userId === u.id || f.friendId === u.id);
      return {
        ...sanitizeUser(u),
        addedAt: relationship?.createdAt ?? Date.now(),
      };
    });

    return reply.code(200).send(friends);
  });

  // GET /api/social/requests - List pending friend requests
  app.get('/api/social/requests', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();

    const requests = db.select()
      .from(schema.friendRequests)
      .where(and(
        or(
          eq(schema.friendRequests.fromId, request.userId),
          eq(schema.friendRequests.toId, request.userId)
        ),
        eq(schema.friendRequests.status, 'pending')
      ))
      .all();

    if (requests.length === 0) {
      return reply.code(200).send([]);
    }

    // Enhance with user data
    const userIds = requests.map(r => r.fromId === request.userId ? r.toId : r.fromId);
    const users = db.select()
      .from(schema.users)
      .where(or(...userIds.map(id => eq(schema.users.id, id))))
      .all();

    const userMap = new Map(users.map(u => [u.id, u]));

    const result: FriendRequest[] = requests.map(r => {
      const otherId = r.fromId === request.userId ? r.toId : r.fromId;
      const otherUser = userMap.get(otherId);
      return {
        id: r.id,
        fromId: r.fromId,
        toId: r.toId,
        status: (r.status ?? 'pending') as any,
        createdAt: r.createdAt,
        user: otherUser ? sanitizeUser(otherUser) : undefined,
      };
    });

    return reply.code(200).send(result);
  });

  // POST /api/social/requests - Send a friend request (local or federated)
  app.post<{ Body: SendFriendRequest }>('/api/social/requests', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();

    const target = parseSendFriendRequest(request.body);
    if (target.kind === 'invalid') return sendError(reply, 400, target.code);

    const sender = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!sender) return sendError(reply, 401, 'unauthorized');
    if (needsVerifiedEmail(sender)) return sendError(reply, 403, 'email_verification_required');

    const ourOrigin = getOurOrigin();
    const ourHost = normalizeOriginForCompare(ourOrigin);

    // Authority defense — only native users may originate friend_request_create
    // outbox events from this instance (spec §5.6). Done before any branching.
    const senderHomeNorm = normalizeOriginForCompare(sender.homeInstance);
    if (senderHomeNorm && senderHomeNorm !== ourHost) {
      return sendError(reply, 403, 'not_authoritative_for_sender');
    }

    if (target.kind === 'identity') {
      const { homeUserId, homeInstance } = target;
      // Our host exactly (port included), or one of our own bare domain names.
      // A host with a port only matches the first: example.com:8443 is not
      // example.com.
      const isOwnInstance = homeInstance === ourHost || isOwnDomain(homeInstance);
      if (isOwnInstance) {
        return handleLocalFriendRequest(db, request, reply, findNativeUserByHomeId(db, homeUserId), sender, ourOrigin);
      }
      return handleFederatedFriendRequest(db, reply, {
        targetDomain: homeInstance,
        handle: handleForIdentity(target),
        lookup: (peerOrigin) => lookupRemoteUserByHomeId(peerOrigin, homeUserId),
      }, sender, ourOrigin);
    }

    const raw = target.username;
    const atIndex = raw.lastIndexOf('@');
    const isFederated =
      atIndex > 0 &&
      atIndex < raw.length - 1 &&
      normalizeOriginForCompare(raw.slice(atIndex + 1)) !== ourHost;

    if (!isFederated) {
      const localUsername = atIndex > 0 ? raw.slice(0, atIndex) : raw;
      return handleLocalFriendRequest(db, request, reply, findLocalUserByUsername(db, localUsername), sender, ourOrigin);
    }
    const baseName = raw.slice(0, atIndex).toLowerCase();
    return handleFederatedFriendRequest(db, reply, {
      targetDomain: raw.slice(atIndex + 1).toLowerCase(),
      handle: baseName,
      lookup: (peerOrigin) => lookupRemoteUser(peerOrigin, baseName),
    }, sender, ourOrigin);
  });

  // PATCH /api/social/requests/:id - Accept/Decline a friend request
  app.patch<{ Params: { id: string }; Body: UpdateFriendRequest }>('/api/social/requests/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body;
    const db = getDb();

    if (!['accepted', 'declined'].includes(status)) {
      return sendError(reply, 400, 'validation_failed');
    }

    const friendRequest = db.select().from(schema.friendRequests).where(eq(schema.friendRequests.id, id)).get();
    if (!friendRequest) {
      return sendError(reply, 404, 'friend_request_not_found');
    }

    if (friendRequest.toId !== request.userId) {
      return sendError(reply, 403, 'friend_request_not_recipient');
    }
    // A request is answered once: an accepted or declined one is no longer open.
    if (friendRequest.status !== 'pending') {
      return sendError(reply, 404, 'friend_request_not_found');
    }

    if (status === 'accepted') {
      // Insert friend and update request status atomically
      const now = Date.now();
      db.transaction((tx) => {
        const alreadyFriends = tx.select({ userId: schema.friends.userId }).from(schema.friends).where(or(
          and(eq(schema.friends.userId, friendRequest.fromId), eq(schema.friends.friendId, friendRequest.toId)),
          and(eq(schema.friends.userId, friendRequest.toId), eq(schema.friends.friendId, friendRequest.fromId)),
        )).get();
        if (!alreadyFriends) {
          tx.insert(schema.friends).values({
            userId: friendRequest.fromId,
            friendId: friendRequest.toId,
            createdAt: now,
          }).run();
        }

        tx.update(schema.friendRequests)
          .set({ status })
          .where(eq(schema.friendRequests.id, id))
          .run();
      });

      // WS broadcast AFTER transaction commits
      const acceptingUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
      if (acceptingUser) {
        const friend: Friend = {
          ...sanitizeUser(acceptingUser),
          addedAt: now,
        };
        connectionManager.sendToUser(friendRequest.fromId, {
          type: 'friend_request_accepted',
          friend,
          requestId: id,
        });
      }
      // Each side sees the other's current status and activity now, not at
      // their next change (#340).
      exchangeFriendPresence(friendRequest.fromId, friendRequest.toId);
    } else {
      // For declined, just update the status (single write, no transaction needed)
      db.update(schema.friendRequests)
        .set({ status })
        .where(eq(schema.friendRequests.id, id))
        .run();

      // Broadcast to the original sender so their UI updates in real-time
      connectionManager.sendToUser(friendRequest.fromId, {
        type: 'friend_request_declined',
        requestId: id,
        userId: request.userId,
      });
    }

    // Federation relay: notify the other user's home instance
    const domainOrigin = getOurOrigin();

    const fromUser = db.select().from(schema.users).where(eq(schema.users.id, friendRequest.fromId)).get();
    const toUser = db.select().from(schema.users).where(eq(schema.users.id, friendRequest.toId)).get();

    if (fromUser && toUser) {
      const fromIdentity = {
        homeUserId: fromUser.homeUserId || fromUser.id,
        homeInstance: fromUser.homeInstance || domainOrigin,
      };
      const toIdentity = {
        homeUserId: toUser.homeUserId || toUser.id,
        homeInstance: toUser.homeInstance || domainOrigin,
      };

      const targets = getFriendEventTargets(fromIdentity.homeInstance, toIdentity.homeInstance);
      if (targets.length > 0) {
        const contextId = buildFriendContextId(fromIdentity.homeUserId, toIdentity.homeUserId);
        const now2 = Date.now();
        // The pair's clock (federation.md "Subject clocks") moves to this
        // answer; its friend_request_update and friend_add share the timestamp.
        recordLocalFriendPairChange(fromIdentity, toIdentity, now2, db);

        // Relay request status update
        const updateEntityId = `friend_req:${[fromIdentity.homeUserId, toIdentity.homeUserId].sort().join(':')}:${now2}`;
        const updatePayload: FederationRelayEvent = {
          eventType: 'friend_request_update',
          contextType: 'friend',
          messageId: updateEntityId,
          encryptionVersion: 0,
          timestamp: now2,
          friendship: {
            from: fromIdentity,
            to: toIdentity,
            fromProfile: buildProfileSnapshot(fromUser),
            toProfile: buildProfileSnapshot(toUser),
            status: status as 'accepted' | 'declined',
            createdAt: friendRequest.createdAt,
          },
        };
        const updateStr = JSON.stringify(updatePayload);
        appendMutationLog(updateEntityId, contextId, 'friend_request_update', updateStr, 'friend');
        queueOutboxEvent(updateEntityId, contextId, 'friend_request_update', updateStr, targets, 'friend');

        // If accepted, also relay friend_add
        if (status === 'accepted') {
          const addEntityId = `friend:${[fromIdentity.homeUserId, toIdentity.homeUserId].sort().join(':')}:${now2}`;
          const addPayload: FederationRelayEvent = {
            eventType: 'friend_add',
            contextType: 'friend',
            messageId: addEntityId,
            encryptionVersion: 0,
            timestamp: now2,
            friendship: {
              from: fromIdentity,
              to: toIdentity,
              fromProfile: buildProfileSnapshot(fromUser),
              toProfile: buildProfileSnapshot(toUser),
              createdAt: now2,
            },
          };
          const addStr = JSON.stringify(addPayload);
          appendMutationLog(addEntityId, contextId, 'friend_add', addStr, 'friend');
          queueOutboxEvent(addEntityId, contextId, 'friend_add', addStr, targets, 'friend');
        }
      }
    }

    return reply.code(200).send({ success: true });
  });

  // DELETE /api/social/requests/:id - Cancel an outgoing friend request
  app.delete<{ Params: { id: string } }>('/api/social/requests/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const friendRequest = db.select().from(schema.friendRequests).where(eq(schema.friendRequests.id, id)).get();
    if (!friendRequest) {
      return sendError(reply, 404, 'friend_request_not_found');
    }

    // Only the sender can cancel an outgoing request
    if (friendRequest.fromId !== request.userId) {
      return sendError(reply, 403, 'friend_request_not_sender');
    }

    if (friendRequest.status !== 'pending') {
      return sendError(reply, 400, 'friend_request_not_pending');
    }

    db.delete(schema.friendRequests)
      .where(eq(schema.friendRequests.id, id))
      .run();

    // Broadcast to the recipient so their UI updates in real-time
    connectionManager.sendToUser(friendRequest.toId, {
      type: 'friend_request_cancelled',
      requestId: id,
      userId: request.userId,
    });

    // Federation relay: notify the recipient's home instance
    const domainOrigin = getOurOrigin();
    const callerUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    const recipientUser = db.select().from(schema.users).where(eq(schema.users.id, friendRequest.toId)).get();

    if (callerUser && recipientUser) {
      const fromIdentity = {
        homeUserId: callerUser.homeUserId || callerUser.id,
        homeInstance: callerUser.homeInstance || domainOrigin,
      };
      const toIdentity = {
        homeUserId: recipientUser.homeUserId || recipientUser.id,
        homeInstance: recipientUser.homeInstance || domainOrigin,
      };

      const targets = getFriendEventTargets(fromIdentity.homeInstance, toIdentity.homeInstance);
      if (targets.length > 0) {
        const contextId = buildFriendContextId(fromIdentity.homeUserId, toIdentity.homeUserId);
        const now = Date.now();
        const entityId = `friend_req:${[fromIdentity.homeUserId, toIdentity.homeUserId].sort().join(':')}:${now}`;

        const payload: FederationRelayEvent = {
          eventType: 'friend_request_cancel',
          contextType: 'friend',
          messageId: entityId,
          encryptionVersion: 0,
          timestamp: now,
          friendship: {
            from: fromIdentity,
            to: toIdentity,
            createdAt: friendRequest.createdAt,
          },
        };
        const payloadStr = JSON.stringify(payload);
        // The pair's clock (federation.md "Subject clocks") moves to this change.
        recordLocalFriendPairChange(fromIdentity, toIdentity, now, db);
        appendMutationLog(entityId, contextId, 'friend_request_cancel', payloadStr, 'friend');
        queueOutboxEvent(entityId, contextId, 'friend_request_cancel', payloadStr, targets, 'friend');
      }
    }

    return reply.code(200).send({ success: true });
  });

  // DELETE /api/social/friends/:id - Remove a friend
  app.delete<{ Params: { id: string } }>('/api/social/friends/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    // Check friendship exists before deleting
    const existing = db.select().from(schema.friends).where(or(
      and(eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, id)),
      and(eq(schema.friends.userId, id), eq(schema.friends.friendId, request.userId))
    )).get();

    if (!existing) {
      return sendError(reply, 404, 'not_friends');
    }

    db.delete(schema.friends).where(or(
      and(eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, id)),
      and(eq(schema.friends.userId, id), eq(schema.friends.friendId, request.userId))
    )).run();

    // Broadcast friend_removed to the other user so their friends list updates
    connectionManager.sendToUser(id, {
      type: 'friend_removed',
      userId: request.userId,
    });

    // Federation relay: notify the other user's home instance
    const domainOrigin = getOurOrigin();
    const callerUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    const otherUser = db.select().from(schema.users).where(eq(schema.users.id, id)).get();

    if (callerUser && otherUser) {
      const callerIdentity = {
        homeUserId: callerUser.homeUserId || callerUser.id,
        homeInstance: callerUser.homeInstance || domainOrigin,
      };
      const otherIdentity = {
        homeUserId: otherUser.homeUserId || otherUser.id,
        homeInstance: otherUser.homeInstance || domainOrigin,
      };

      const targets = getFriendEventTargets(callerIdentity.homeInstance, otherIdentity.homeInstance);
      if (targets.length > 0) {
        const contextId = buildFriendContextId(callerIdentity.homeUserId, otherIdentity.homeUserId);
        const now = Date.now();
        const entityId = `friend:${[callerIdentity.homeUserId, otherIdentity.homeUserId].sort().join(':')}:${now}`;

        const payload: FederationRelayEvent = {
          eventType: 'friend_remove',
          contextType: 'friend',
          messageId: entityId,
          encryptionVersion: 0,
          timestamp: now,
          friendship: {
            from: callerIdentity,
            to: otherIdentity,
            createdAt: now,
          },
        };
        const payloadStr = JSON.stringify(payload);
        // The pair's clock (federation.md "Subject clocks") moves to this change.
        recordLocalFriendPairChange(callerIdentity, otherIdentity, now, db);
        appendMutationLog(entityId, contextId, 'friend_remove', payloadStr, 'friend');
        queueOutboxEvent(entityId, contextId, 'friend_remove', payloadStr, targets, 'friend');
      }
    }

    return reply.code(200).send({ success: true });
  });

  // GET /api/social/search?q=... - Find people by username (docs/systems/
  // social.md, "Finding people"). Usernames of this instance only: the exact
  // name first, then names that start with the query, at most
  // USER_SEARCH_LIMIT. Enough to add someone whose name one knows, never a
  // way to list everyone: no paging, no display names, a per-account budget
  // on top of the per-address one. Nobody deleted, suspended or in a block
  // with the caller comes back, and a result carries only what a row, a
  // request or a DM needs.
  app.get<{ Querystring: { q?: unknown } }>('/api/social/search', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const raw = request.query.q;
    const q = (typeof raw === 'string' ? raw : '').trim().replace(/^@/, '').toLowerCase();
    if (!USER_SEARCH_QUERY.test(q)) {
      return sendError(reply, 400, 'user_search_query_invalid', { min: USER_SEARCH_MIN_LENGTH, max: USER_SEARCH_MAX_LENGTH });
    }
    if (!userSearchLimit.consume(request.userId)) {
      return sendError(reply, 429, 'rate_limited');
    }

    const db = getDb();
    const me = request.userId;
    // `_` is the one LIKE wildcard a username can hold; it is matched literally.
    const prefix = `${q.replace(/_/g, '\\_')}%`;
    const rows = db.select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      avatarColor: schema.users.avatarColor,
      homeInstance: schema.users.homeInstance,
      homeUserId: schema.users.homeUserId,
    })
      .from(schema.users)
      .where(and(
        eq(schema.users.isDeleted, 0),
        eq(schema.users.accountKind, 'person'),
        ne(schema.users.id, me),
        // Replicated rows are people of other instances; their stored names
        // are not usernames here.
        sql`(${schema.users.homeInstance} IS NULL OR ${schema.users.homeInstance} = '')`,
        not(suspendedNow(Date.now())),
        friendRequestableBy(me),
        sql`${schema.users.username} LIKE ${prefix} ESCAPE '\\'`,
        sql`NOT EXISTS (SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${me} AND b.blocked_id = ${schema.users.id})
             OR (b.blocker_id = ${schema.users.id} AND b.blocked_id = ${me}))`,
      ))
      .orderBy(sql`CASE WHEN ${schema.users.username} = ${q} THEN 0 ELSE 1 END`, asc(schema.users.username))
      .limit(USER_SEARCH_LIMIT)
      .all();

    const results: UserSearchResult[] = rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatar: row.avatar,
      avatarColor: (row.avatarColor as UserSearchResult['avatarColor']) ?? null,
      homeInstance: row.homeInstance,
      homeUserId: row.homeUserId,
    }));
    return reply.code(200).send(results);
  });
}
