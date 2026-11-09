# Social & Friends System

Source files:
- `packages/server/src/routes/social.ts` -- Friend requests, friend list, unfriend, finding people by username (`GET /api/social/search`)
- `packages/server/src/utils/blocks.ts` -- `blockRefusal`: a block between two people refuses a friend request in either direction
- `packages/server/src/routes/users.ts` -- User profile CRUD, mutuals endpoint (`GET /users/:id/mutuals`)
- `packages/web/src/stores/socialStore.ts` -- Client-side friend/request state with cross-instance loading and origin tagging, cross-instance username search
- `packages/web/src/components/chat/FriendsPage.tsx` -- Friends page UI: the Online/All/Pending lists, the Add Friend view (username search, `name@instance` handles), the phone's Activity tab
- `packages/web/src/utils/userViewLookup.ts` -- `usernameQueryOf` (what counts as a username query) and `useSearchResultView` (how a search result is drawn)
- `packages/web/src/components/modals/NewDmModal.tsx`, `components/layout/DmSearchBar.tsx` -- The DM pickers, which find people with the same search
- `packages/web/src/components/modals/UserProfileModal.tsx` -- Profile modal with friendship actions and mutual display
- `packages/web/src/utils/mutuals.ts` -- Cross-instance mutual friend/space loading with dedup
- `packages/web/src/utils/identity.ts` -- Federated identity helpers (parseFederatedUsername, userKey, isMine; see `client-federation.md` section 5)
- `packages/web/src/hooks/useWebSocket.ts` -- WS event handlers for social events (friend_request_received, etc.)
- `packages/server/src/routes/federation.ts` -- Inbound friend relay event processors (5 functions)
- `packages/server/src/utils/federationOutbox.ts` -- `buildFriendContextId()`, `getFriendEventTargets()`
- `packages/server/src/utils/federationWorker.ts` -- Initial sync friend backfill for new peers

DB tables: `friends`, `friend_requests`, `users` (homeInstance, homeUserId fields; the `suspended_*` columns the search reads), `user_blocks` (read by the request and search checks).
See `docs/systems/database.md` for full schemas.

---

## 1. Friend Request Lifecycle

### State Machine

```
                    sender creates
  (none) ────────────────────────► pending
                                     │
                   ┌─────────────────┼──────────────────┐
                   │                 │                   │
              recipient          recipient           sender
              accepts            declines            cancels
                   │                 │                   │
                   ▼                 ▼                   ▼
               accepted          declined          (row deleted)
                   │
                   ▼
             friends row
              inserted
```

### REST Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET` | `/api/social/friends` | List all friends | JWT |
| `GET` | `/api/social/requests` | List pending friend requests | JWT |
| `POST` | `/api/social/requests` | Send a friend request | JWT |
| `PATCH` | `/api/social/requests/:id` | Accept or decline | JWT |
| `DELETE` | `/api/social/requests/:id` | Cancel outgoing request | JWT |
| `DELETE` | `/api/social/friends/:id` | Remove a friend | JWT |
| `GET` | `/api/social/search` | Find people by username (Section 3) | JWT, 30/min per address and 20/min per account |

See `docs/systems/api.md` for full endpoint signatures.

---

### Send Friend Request (`POST /api/social/requests`)

**Input:** `SendFriendRequest`: `{ username }` for a typed handle, or `{ homeUserId, homeInstance, username? }` for a user the client already holds. The identity wins when present (both fields required together, else 400 `validation_failed`); the username is sent alongside only so that a server predating the identity fields can still serve the request. See "Addressing the target" below.

**Routing:** a target on another instance goes to the federated flow in Section 6. A local target is found by lowercased username (`bare` or `bare@<own host>`) among the live accounts of this instance only (`findLocalUserByUsername`: not deleted, no `homeInstance`), so the stored name of a tombstone or of a replicated row never resolves as a handle; or, for an identity whose `homeInstance` is this instance, as the native, non-deleted user whose `id` (or native `homeUserId`) is `homeUserId` (`findNativeUserByHomeId`). Then:
1. Not found → 404 `user_not_found`
2. **Self-friendship prevention:** `targetUser.id === request.userId` returns 400 `cannot_friend_self`
3. **Block check:** `blockRefusal(sender, target)` (`utils/blocks.ts`): 403 `blocked_by_you` when the sender blocked the target, 403 `interaction_unavailable` when the target blocked the sender, which does not say that a block is the reason
4. **Already friends check:** Checks `friends` table in both directions (userId/friendId and friendId/userId) → 400 `already_friends`
5. **Duplicate request check:** Checks `friend_requests` for any pending request between the two users in either direction → 400 `friend_request_pending`

**On success:**
1. Generates snowflake ID, inserts into `friend_requests` with `status='pending'`
2. **WS broadcast:** `friend_request_received` sent to target user with full request payload including sender profile, and `friend_request_sent` to the sender's own sessions (multi-tab sync)
3. **Federation relay:** If either user is federated, queues `friend_request_create` event (see Section 6)
4. Returns `201 { success: true, requestId: string }`

### Accept/Decline (`PATCH /api/social/requests/:id`)

**Input:** `{ status: 'accepted' | 'declined' }`

**Authorization:** Only the recipient (`request.toId === userId`) can accept or decline.

**Only an open request is answered.** A request whose status is no longer `pending` (accepted or declined already) answers 404 `friend_request_not_found`, as an unknown id does, so answering twice changes nothing and relays nothing a second time.

**Accept path:**
1. **Transaction:** Inserts the `friends` row (fromId -> userId, toId -> friendId) unless the two are already friends in either direction, AND updates request status to `'accepted'`. No duplicate friendship row is ever written
2. **WS broadcast (after commit):** `friend_request_accepted` sent to the original sender with the accepting user's profile as a `Friend` object
3. **Federation relay:** Queues both `friend_request_update` (status=accepted) AND `friend_add` events

**Decline path:**
1. Updates request status to `'declined'` (no transaction needed, single write)
2. **WS broadcast:** `friend_request_declined` sent to the original sender with `{ requestId, userId }`
3. **Federation relay:** Queues `friend_request_update` (status=declined)

### Cancel (`DELETE /api/social/requests/:id`)

**Authorization:** Only the sender (`request.fromId === userId`) can cancel.

**Validation:** Request must be in `'pending'` status.

**Actions:**
1. **Deletes** the request row (not a status update -- full deletion)
2. **WS broadcast:** `friend_request_cancelled` sent to the recipient
3. **Federation relay:** Queues `friend_request_cancel` event

### Remove Friend (`DELETE /api/social/friends/:id`)

**Path parameter:** `:id` is the friend's user ID (not the friendship row ID).

**Actions:**
1. Verifies friendship exists by checking both directions in `friends` table
2. **Deletes** the friendship row in both directions (single WHERE with OR)
3. **WS broadcast:** `friend_removed` sent to the other user with `{ userId: callerUserId }`
4. **Federation relay:** Queues `friend_remove` event

---

## 2. Friend List & Request List

### GET /api/social/friends

Queries `friends` table where the authenticated user is either `userId` or `friendId`. Extracts the other user's ID from each row, fetches full user records, and returns as `Friend[]` with `addedAt` timestamp from the friendship row's `createdAt`.

### GET /api/social/requests

Queries `friend_requests` with `status='pending'` where the authenticated user is either `fromId` or `toId`. Enriches each request with the **other** user's profile (the user who is NOT the requester). Returns as `FriendRequest[]`.

---

## 3. Finding people

There is no list of people to browse. A person is found by their username, or added by a handle typed whole (`name` or `name@instance`, Sections 1 and 6). The Discover People suggestions, `GET /api/social/discover` and the per-account `discoverable` setting no longer exist: the Privacy panel has no discovery switch, `PATCH /api/users/@me` ignores the field, `User` no longer carries it, and migration `0042_orbit_drop_discoverable` dropped `users.discoverable`. A peer's lookup of an exact handle (`POST /api/federation/users/lookup`, Section 6 step 5) never read that setting.

### GET /api/social/search

**Query:** `q`, trimmed, one leading `@` dropped, lowercased. It must then be 3 to 32 characters of `a-z`, `0-9` and `_`, the characters a username is made of, else 400 `user_search_query_invalid` with `details: { min: 3, max: 32 }`. A `name@instance` handle is not a query: it fails this check and is sent as a friend request instead (Section 11).

**Limits:** the route's own `@fastify/rate-limit` config, 30 per minute per client address (api.md, "Rate limiting"), and on top of it 20 per minute per account (`createFixedWindowLimit`, in memory, counted once the query is valid). Either answers 429 `rate_limited`. `DISABLE_RATE_LIMITS` turns both off.

**Match:** usernames that start with the query (`username LIKE '<q>%'`, with `_` escaped so it matches only itself). The exact username comes first, then the others in username order, at most 8. No paging and no `total`, and display names are not searched: enough to find someone whose name one knows, never a way to list everyone.

**Who never comes back:**
- the caller;
- deleted accounts (`is_deleted = 1`);
- accounts suspended now (`suspendedNow`, `utils/suspension.ts`; a time-limited suspension whose end has passed hides no one);
- replicated rows (`homeInstance` set). Their stored name is this instance's label for a person of another instance, not a username here; that person is found by asking their own instance (Section 8, "Cross-Instance Search");
- anyone in a block with the caller, in either direction (`user_blocks`): the blocked person does not find the blocker, and the blocker does not find the person they blocked.

**Response:** `UserSearchResult[]` (Section 13): `id`, `username`, `displayName`, `avatar`, `avatarColor`, `homeInstance`, `homeUserId`. Only what a result row shows and what a friend request or a DM needs to address the person: no status, bio, banner, mutual counts or relationship. The client works out where the viewer stands from its own lists (Section 11, "Search result rows").

**Callers.** The Add Friend view through `socialStore.searchUsers`, which asks the page's instance and every connected instance (Section 8), and the two DM pickers, `NewDmModal` and `DmSearchBar`, which ask the page's own instance. All of them send a query only when it passes the server's rule, checked on the client by `usernameQueryOf` (`utils/userViewLookup.ts`) or the Add Friend view's `addQueryOf`, so a short or malformed query never leaves the client. The pickers draw a result through `useSearchResultView`: the cached view of the same person when the client holds one (for their status and current picture), else the result's own fields. A result is narrower than a user, so it is read against the `userViews` cache and never written into it.

---

## 4. Mutuals

### GET /api/users/:id/mutuals

**Query params:** `homeUserId` (optional, for federation fallback)

**Target resolution:** Tries path param `:id` first. If no user found and `homeUserId` query param is provided, falls back to matching `users.homeUserId = homeUserId` OR `users.id = homeUserId`. This handles cases where the caller has a remote user's home ID but not their local replicated stub ID.

**Mutual friends:** Fetches all friend rows for both the caller and the target (both directions), extracts friend IDs into Sets, computes intersection. Fetches full `User` records for the mutual friend IDs.

**Mutual spaces:** Fetches all `space_members` rows for both the caller and the target, computes intersection of space IDs. Fetches `{ id, name, icon, avatarColor }` for mutual spaces.

**Response:** `{ mutualFriends: User[], mutualSpaces: { id, name, icon, avatarColor }[] }`

---

## Who may reach someone

Two rules a person sets in Settings → Privacy (`utils/contactPolicy.ts`). On a public instance anyone can find anyone by name, and without these only a block would stop a stranger, after the first message.

- **Who may start a conversation** (`users.dm_policy`, default friends and people in a shared space). `POST /api/dm` refuses with `dm_not_accepted`. A conversation the two already have stays open whatever the rule says now, calls in it too; to end one, a person blocks. Group DMs and space invites were friends-only already.
- **Only people are friends.** An account that is not a person (a bot, a webhook, a channel follow) takes no friend request and no conversation, whatever its policy columns say (`maySendFriendRequest`, `mayStartConversation`). A request naming one here by its username or id answers `400 friend_request_not_person` instead of `404 user_not_found` (`namesNonPerson` in `routes/social.ts`): since 1.41.2 a bot can carry a username of its own that people see in member lists.
- **Who may send a friend request** (`users.friend_request_policy`, default anyone). Refused with `friend_request_not_accepted`, after the checks that answer someone who already knows (`already_friends`, `friend_request_pending`). Name search (`GET /api/social/search`) leaves out whoever would refuse the one searching, so `nobody` also takes someone out of search.

A block is checked first and says more. Nobody has a way around a rule, an administrator included.

**Across instances.** The account's own instance decides, so a replicated row never refuses. A DM or friend request relayed in from another instance is not checked against these rules yet, as it is not against blocks; federation is off by default.

---

## 5. WebSocket Events

All social WS events are documented in `docs/systems/websocket.md`. Summary:

### Server -> Client

| Event | Payload | Recipient | When |
|-------|---------|-----------|------|
| `friend_request_received` | `{ request: FriendRequest }` | Target user | Request created |
| `friend_request_accepted` | `{ friend: Friend, requestId }` | Original sender | Request accepted |
| `friend_request_declined` | `{ requestId, userId }` | Original sender | Request declined |
| `friend_request_cancelled` | `{ requestId, userId }` | Target user | Sender cancelled |
| `friend_removed` | `{ userId }` | Other user | Unfriended |

### user_updated Broadcast (profile changes)

When profile fields change on `PATCH /api/users/@me`, a `user_updated` event is broadcast to a **deduplicated** set of targets:
1. All online users who share a space with the updated user
2. All co-members of any DM channel the user is in
3. All friends of the user (from `friends` table, both directions)
4. The user themselves (for multi-tab sync)

This ensures friends always see real-time profile updates (avatar, display name, bio, status, etc.).

---

## 6. Federation: Friend Relay

**What a peer cannot decide for someone here** (1.32.8): a relayed friend request reaches a person of this instance only as `POST /social/requests` would let it, not across a block either way and not past their `friendRequestPolicy` (`relayedFriendRequestRefusal`, `routes/federation/localConsent.ts`); a relayed 1-on-1 that would start a conversation the same with their `dmPolicy`, and never across a block. Both answer `recipient_refuses`.

### Overview

Cross-instance friend operations use 5 relay event types with `contextType: 'friend'`. The federation relay mechanism (outbox, delivery, HMAC signing) is documented in `docs/systems/federation.md`. This section covers the **application logic** specific to friend events.

### Event Types

| eventType | Trigger | Authority | Relay Direction |
|-----------|---------|-----------|-----------------|
| `friend_request_create` | POST /api/social/requests | Sender's home instance | Sender -> Recipient's instance |
| `friend_request_update` | PATCH /api/social/requests/:id | Recipient's home instance | Recipient -> Sender's instance |
| `friend_request_cancel` | DELETE /api/social/requests/:id | Sender's home instance | Sender -> Recipient's instance |
| `friend_add` | PATCH /api/social/requests/:id (accepted) | Recipient's home instance | Recipient -> Sender's instance |
| `friend_remove` | DELETE /api/social/friends/:id | Either side's instance | Remover -> Other's instance |

### Relay Payload Structure

All friend events use the `friendship` field of `FederationRelayEvent`:

```typescript
interface FederationFriendshipPayload {
  from: { homeUserId: string; homeInstance: string };  // Request sender
  to: { homeUserId: string; homeInstance: string };    // Request recipient
  fromProfile?: FederationRelayProfileSnapshot;        // Sender's profile data
  toProfile?: FederationRelayProfileSnapshot;          // Recipient's profile data
  status?: 'pending' | 'accepted' | 'declined';       // Request status (omitted for add/remove/cancel)
  createdAt: number;                                    // Epoch ms
}
```

Profile snapshots (`FederationRelayProfileSnapshot`) carry `{ username, displayName, avatar, avatarColor, banner, bio }` for hydrating replicated user stubs on the receiving instance.

### Identity Resolution for Relay

When building a relay event, each user's identity is resolved as:

```typescript
const identity = {
  homeUserId: user.homeUserId || user.id,      // Canonical ID (local users have homeUserId=null)
  homeInstance: user.homeInstance || getOurOrigin(), // Full URL for local users
};
```

### Target Peer Selection (`federationOutbox.ts:getFriendEventTargets`)

```typescript
function getFriendEventTargets(fromHomeInstance, toHomeInstance): string[] {
  const ourOrigin = getOurOrigin();
  const targets = new Set<string>();
  if (fromHomeInstance && fromHomeInstance !== ourOrigin) targets.add(fromHomeInstance);
  if (toHomeInstance && toHomeInstance !== ourOrigin) targets.add(toHomeInstance);
  return Array.from(targets);
}
```

Returns empty array if both users are local (no relay needed). Returns one or two peer origins if one or both users are federated.

### Context ID for Friend Events (`federationOutbox.ts:buildFriendContextId`)

```typescript
function buildFriendContextId(homeUserIdA: string, homeUserIdB: string): string {
  const sorted = [homeUserIdA, homeUserIdB].sort();
  return `friend:${sorted[0]}:${sorted[1]}`;
}
```

Deterministic and direction-independent. Used for outbox coalescing and mutation log grouping.

### Entity ID Format

Friend events use two entity ID patterns:
- **Requests:** `friend_req:{sorted_homeUserIds}:{timestamp}` -- e.g., `friend_req:abc:xyz:1711619400000`
- **Friendships:** `friend:{sorted_homeUserIds}:{timestamp}` -- e.g., `friend:abc:xyz:1711619400000`

The sorted join ensures the same pair always produces the same prefix regardless of direction.

---

### End-to-End Relay Flow: Friend Request Create

**Outbound (sender's home instance -- `social.ts:POST /api/social/requests`):**

As of 2026-04-25, the sender's home server owns the entire federated friend-add flow. The client names the target and never routes it; all parsing, peering, remote lookup, and queueing happen server-side in this strict order.

#### Addressing the target

A request names its target by **identity** (`homeUserId` + `homeInstance`) or by **username**:

- **Identity** is what the web client sends for every user it already holds: the profile modal's Add Friend and the search result rows on the Friends page (`friendRequestTarget` in `packages/web/src/utils/friendRequestTarget.ts`). A replicated row carries its home identity; a user native to the remote instance it was loaded from is that instance's user by its id there. A user native to the home instance is sent by username, which is their handle.
- **Username** is for a handle the user typed (Add Friend input, and the Connections panel's Retry prefill).

A user object's `username` is not a reliable name for the person: for a replicated stub it is only this instance's label, and a stub minted without a name hint is called `<homeUserId>@<domain>`. Sending that label made the peer's by-name lookup answer 404 `user_not_found`, so a removed federated friend could not be re-added from their profile (issue #339). The identity resolves whatever the stub is called.

The client sends `username` alongside the identity (`name@host` for a federated target). A server that predates the identity fields has no body schema on the route, ignores the unknown fields and serves the username as before.

#### Steps

1. **Parse target.** An identity whose `homeInstance` normalizes to this server's own host (port included) or to one of its bare domain names (`isOwnDomain`), or a `username` with no `@` or whose domain after `@` normalizes to this server's own host, goes to the local-only path. Otherwise the target domain is the identity's `homeInstance` or the typed domain.
1a. **Federation off → 403 `federation_disabled`.** A person on another instance needs federation, which is off unless the operator enabled it (`FEDERATION_ENABLED`, `config.federation.enabled`). The request says so plainly instead of reporting an unreachable peer.
2. **resolveOriginFromHostname(targetDomain)** — resolves the target peer's full origin URL. Prefers a stored `federation_peers` row matching the typed host; for a host without a port, then the one `active` peer row on that hostname (an identity's `homeInstance` is a bare hostname while the peer's origin may carry a port; a dead row from a former ported setup does not count); falls back to mirroring `getOurOrigin()`'s scheme. Returns null → 400 `invalid_target_domain`.
2a. **Limbo-window guard → 409 `peer_reset_pending`.** O(1) point lookup on the `federation_reset_events` origin PRIMARY KEY: if an **unresolved** row exists for `peerOrigin` (`origin = peerOrigin AND resolved_at IS NULL`), the peer was reset-detected (wipe-and-reinstall) but the admin has not yet re-peered — the local friendship/stub graph is still bound to the dead incarnation. Return 409 `peer_reset_pending` instead of the confusing `already_friends` (stale friendship) or `peer_rejected` (the `needs_attention` peer would otherwise trip `ensurePeered`). `peerOrigin` is the exact string `markPeerReset` journals (the peer's `federation_peers.origin`), so the match is a single indexed lookup; no reset in progress → one indexed miss → the normal path proceeds unchanged. See `docs/systems/federation.md` (instance-epoch self-healing) and the design spec §5.3. The equivalent guard runs on federated DM-create (`POST /api/dm`, `dm.ts`).
3. **Authority defense.** If the calling user's `homeInstance` is set and does not normalize to this server's own host (checked via `normalizeOriginForCompare`), return 403 `not_authoritative_for_sender`. Prevents replicated/federated users from queueing relay events the home server isn't authoritative for. Runs before peering to fail fast.
4. **ensurePeered(peerOrigin)** — blocks on the result. Status → HTTP mapping:
   - `'active'` → continue
   - `'pending'` (handshake in flight) → 409 `peer_pending`
   - `'pending'` + peer row `awaiting_approval` (re-queried after the call) → 409 `peer_pending_approval`
   - `'rejected'` → 403 `peer_rejected`
   - `'failed'` → 503 `peer_unreachable`
   - `'admin_required'` (gate fired locally) → 409 `peer_pending_local_admin` — your own admin must approve before we reach out
5. **Lookup.** For a username, **lookupRemoteUser(peerOrigin, baseName)** POSTs HMAC-signed `{ username }` to `peerOrigin/api/federation/users/lookup`. For an identity, **lookupRemoteUserByHomeId(peerOrigin, homeUserId)** POSTs `{ homeUserId }` to `peerOrigin/api/federation/users/by-home-id`. Both peer endpoints share the S2S auth preamble and the 60/min per-peer lookup rate limit, and answer only for a live native user. Result mapping:
   - `not_found` → 404 `user_not_found`
   - `unreachable` (any peer failure other than 429, for both lookups), or a thrown lookup (only a missing peer row) → 503 `peer_unreachable`
   - `rate_limited` → 429 `lookup_rate_limited` (with `Retry-After` header)

   The peering trigger target recorded in step 4 is `name@domain`. For an identity it is the local part of the `username` sent alongside when that username is on the same domain, else the `homeUserId`.
6. **Self-friend pre-check.** If the looked-up `(homeUserId, peerOrigin)` matches the sender's canonical identity (using `normalizeOriginForCompare` for host comparison) → 400 `cannot_friend_self`.
7. **resolveOrCreateReplicatedUser + hydrateReplicatedUserProfile** — creates or refreshes the local stub for the remote user. Tombstoned identities (resolveOrCreateReplicatedUser returns null) → 404 `user_not_found`.
7a. **Block check**, between the resolve and the hydrate: `blockRefusal(sender, stub)` → 403 `blocked_by_you` or `interaction_unavailable`, as for a local target. Blocks are held against this instance's rows (`user_blocks`), and for a person of another instance that row is the stub, so the check waits for it. Nothing is written to `friend_requests` or queued. The check is the sender's home's: the receiving instance's `processFriendRequestCreateEvent` does not read `user_blocks`.
8. **Direction-aware idempotency:**
   - Same-direction pending request exists → 200 with existing `requestId` (idempotent).
   - Opposite-direction pending request exists → 409 `incoming_request_exists` with existing `requestId` for client deep-link.
   - Already friends → 409 `already_friends`.
9. **db.transaction(...)** (synchronous): inserts the `friend_requests` row with `relayMessageId = entityId`, calls `appendMutationLog`, calls `queueOutboxEvent` targeting `[peerOrigin]`.
10. **WS broadcast** `friend_request_sent` to the sender's other tabs/devices (multi-tab sync).
11. Returns `201 { success: true, requestId }`.

The wire format of the queued event is identical to the pre-2026-04-25 flow; only the queueing instance has changed. The receiver's `processFriendRequestCreateEvent` is unchanged. Both peers' authority checks (`from.homeInstance === sourceInstance`) continue to pass because the sender's instance is now both source and queueing instance.

> **Schema note:** The `friend_requests` table gained a `relayMessageId TEXT` column (added 2026-04-25, drizzle migration `0001_complex_screwball.sql`). It is `NULL` for local-only requests; for federated ones it carries the `entityId` of the originating relay event so the rollback hook can locate the row by message ID.

**Delivery (federation worker -- `federationWorker.ts:processOutboxTick`):**
1. Worker polls outbox every 10 seconds
2. Groups pending entries by peer, builds batch `FederationRelayRequest`
3. Signs with HMAC, POSTs to `{peerOrigin}/api/federation/relay`
4. On success: deletes outbox entries. On failure: exponential backoff retry.

**Inbound (receiving instance -- `federation.ts:processFriendRequestCreateEvent`):**
1. **Validate:** `event.friendship` must exist, `from.homeInstance === sourceInstance` (authority check).
2. **Self-target guard (defense-in-depth):** if `from.homeUserId === to.homeUserId` and `normalizeOriginForCompare(from.homeInstance) === normalizeOriginForCompare(to.homeInstance)`, reject with `self_target_invalid`. Runs before any side effects (no stub creation). The sender's local `cannot_friend_self` check should catch this, but the receiver must not trust upstream validation.
3. **Resolve sender:** `resolveOrCreateReplicatedUser(from.homeUserId, from.homeInstance)` -- creates stub if needed.
4. **Hydrate sender profile:** `hydrateReplicatedUserProfile(fromUser, event.friendship.fromProfile)` -- updates stub fields.
5. **Resolve recipient:** `resolveRelayActor(to)` -- the local user that IS the `to` pair (`homeUserId` + `homeInstance`); anything else, including a row that only shares the `homeUserId`, rejects `recipient_not_found`.
6. **Idempotency checks:**
   - **Already friends (either direction):** accept as no-op.
   - **Pending request in EITHER direction:** accept as no-op. Forward (from→to) covers redelivery; reverse (to→from) covers the cross-fire race where alice@A and bob@B click "add friend" near-simultaneously and each sender's local both-direction check passes before either event reaches the wire. Mirrors the sender-side `incoming_request_exists` both-direction check (step 8 above) to keep the receiver and sender contracts symmetric.
7. **Create request:** Insert `friend_requests` row with local IDs.
8. **WS broadcast:** `friend_request_received` sent to local recipient with sender's sanitized profile.
9. Push `event.messageId` to accepted array.

> **Race outcome.** Under the cross-fire scenario both instances converge on a single pending row (whichever event materialized first). The redundant outbound on the other side becomes harmless dead state — the local user already sees the pending request via existing UI. Auto-promotion to mutual friendship when both directions exist is not implemented; it is a product/design conversation, not a correctness fix.

### Failure Handling: Async Rollback

When the outbox worker receives a relay response from the remote instance, it classifies each rejected entry. `classifyRejection` (`utils/federationRejections.ts`) decides what each reason means; the list is in [federation.md "Rejection reasons"](federation.md#rejection-reasons). A `refused` reason (among them `recipient_not_found` and `invalid_target`, which a `friend_add` answering no pending request gets) deletes the outbox entry with no retry and runs the rollback below; a `retry` reason (for example `attribution_unproven`, see [federation.md §3](federation.md#3-identity-resolution)) keeps the request pending while the outbox retries it on backoff.

For `refused` rejections, the worker invokes the registered permanent-failure callback via `invokePermanentFailureCallback(eventType, messageId, reason)` from `utils/federationRollback.ts`. For `friend_request_create`, this is **`rollbackFriendRequestCreate`**:

1. Looks up the `friend_requests` row by `relayMessageId` (the stored `entityId`).
2. Deletes the row.
3. Emits WS `friend_request_relay_failed` to the sender's connections, with a client-facing reason: receiver `recipient_not_found` → `user_not_found`; everything else → `peer_rejected`.

The client handler in `useWebSocket.ts` removes the row from `socialStore` and shows a warning toast.

**5xx responses, network errors, and retry exhaustion are NOT terminal** — the outbox retries with exponential backoff. The sender sees indefinite "pending" under sustained connectivity loss, matching DM relay's behavior under the same conditions.

**Ghost-row risk.** Rollback callbacks are best-effort: the registry catches and logs callback errors but does not re-throw. A failed rollback (e.g., DB write fails mid-rollback) leaves a ghost `friend_requests` row with no corresponding in-flight relay. Acceptable vs. retry-forever blocking the outbox, but worth knowing when debugging stuck pending requests.

### End-to-End Relay Flow: Friend Request Update (Accept/Decline)

**Outbound (`social.ts:PATCH /api/social/requests/:id`):**
1. Local request status updated (+ friendship row if accepted and the pair is not friends already). Only a pending request is answered (Section 1), so a request is relayed as answered once
2. Queues `friend_request_update` with `status: 'accepted' | 'declined'`
3. If accepted, also queues `friend_add` event (two separate outbox entries)

**Inbound (`federation.ts:processFriendRequestUpdateEvent`):**
1. **Authority:** `to.homeInstance === sourceInstance` -- the recipient's instance sends the update
2. **Resolve sender:** `resolveRelayActor(from)`, by `homeUserId` + `homeInstance` -- the user that IS that identity here (they sent the original request from this instance), never a row that only shares the `homeUserId`. Not found (or a `mismatch`) -> reject `sender_not_found`
3. **Resolve recipient:** `resolveRelayActor(to)`, by pair; nothing is created. Not found -> accept without effect (no pending request can exist for a user this instance does not hold)
4. **Find pending request:** Matches `fromId = fromUser.id`, `toId = toUser.id`, `status = 'pending'`
5. If no pending request found -> accept idempotently (friend_add may have arrived first, or the request was cancelled); nothing changes
6. Update request status. If `accepted`, insert the `friends` row in the same transaction (unless one exists): the acceptance answers the local sender's pending request, so the friendship forms here whether `friend_request_update` or `friend_add` arrives first
7. **WS broadcast:** `friend_request_accepted` (with Friend payload) or `friend_request_declined` sent to local sender

### End-to-End Relay Flow: Friend Request Cancel

**Outbound (`social.ts:DELETE /api/social/requests/:id`):**
1. Local request deleted
2. Queues `friend_request_cancel`

**Inbound (`federation.ts:processFriendRequestCancelEvent`):**
1. **Authority:** `from.homeInstance === sourceInstance` -- the sender cancels their own request
2. **Resolve both users:** `resolveRelayActor()` for both, by `homeUserId` + `homeInstance` -- if either doesn't exist, accept idempotently
3. Find and **delete** the pending request row
4. **WS broadcast:** `friend_request_cancelled` to local recipient

### End-to-End Relay Flow: Friend Add

**Outbound:** Queued alongside `friend_request_update` (accepted) from `social.ts:PATCH`.

**Inbound (`federation.ts:processFriendAddEvent`):**

**Rule:** a `friend_add` is the acceptor's answer to a request, so it forms a friendship only for a pair this instance holds a pending request for, from `from` (the requester) to `to` (the acceptor). The requester's home writes that row when the request is made, in the same transaction that queues `friend_request_create` (Section 6, step 9), so it exists before any answer can arrive, including when the peer was unreachable and the create waited in the outbox. The recipient's `PATCH` queues `friend_request_update` before `friend_add`, and the outbox delivers in that order; the update then forms the friendship (see above) and the `friend_add` is the idempotent case. When the `friend_add` arrives first it finds the pending row and forms it. A request in the other direction (`to` -> `from`), an answered request after the friendship was removed, or no request at all never satisfies the rule.

1. **Authority:** `to.homeInstance === sourceInstance` -- the accepting side creates the friendship
2. **Resolve both users:** `resolveRelayActor()` for both, by `homeUserId` + `homeInstance`. Nothing is created: a pair with a pending request already exists here
3. **Idempotency:** If friendship row already exists, accept as no-op
4. **Pending request:** a `friend_requests` row `fromId = fromUser.id`, `toId = toUser.id`, `status = 'pending'` must exist, else reject `invalid_target` (terminal; nothing changes, no stub is created)
5. Hydrate both profiles from the snapshots
6. **One transaction:** insert the `friends` row and set any pending request between the pair (either direction) to `'accepted'`
7. **Determine local user:** `from` is local when its home domain is one of ours (`isOwnDomain`, which a bare domain and a full origin both match), else `to`
8. **WS broadcast:** `friend_request_accepted` sent to local user with remote user's profile and the answered request's id as `requestId`

### End-to-End Relay Flow: Friend Remove

**Outbound (`social.ts:DELETE /api/social/friends/:id`):**
1. Local friendship deleted
2. Queues `friend_remove`

**Inbound (`federation.ts:processFriendRemoveEvent`):**
1. **Authority:** Either `from.homeInstance === sourceInstance` OR `to.homeInstance === sourceInstance` (either side can unfriend)
2. **Resolve both users:** `resolveRelayActor()` for both, by `homeUserId` + `homeInstance` -- if either doesn't exist, accept idempotently
3. Delete friendship row in both directions
4. **Determine who was removed:** the side whose home domain is ours (`isOwnDomain`) is the local user and gets `friend_removed`; the other side is the one who removed

---

## 7. Pull Sync of Friend Events

Friend events are pulled from each active peer's mutation log like DM and profile events: on every activation and periodically, with a cursor in the peer's clock and refusals kept for retry. The mechanism is in [federation.md "Pull sync"](federation.md#pull-sync); the `friend` context is its second pass, and its ordering unit is the friend pair.

### Applied-event ledger

A friend processor acts on whatever request or friendship the pair has now, so it cannot tell a second delivery of an event from a new one: a replayed `friend_request_create` would recreate a request the recipient declined, a replayed `friend_request_update` or `friend_request_cancel` would answer a newer request, and a replayed `friend_remove` would end a friendship formed again after it. `processRelayEvents` therefore applies the five friend event types through the ledger `federation_applied_events`, on the live relay and the pull alike:

- before dispatch, an event whose key `<eventType>:<messageId>` is recorded for its signing peer is answered `duplicate` and not applied;
- an event the processor accepts is recorded;
- a refused event is not recorded, so a retry can still apply it.

The key works because each friend event's `messageId` is its entity id (`friend_req:<pair>:<ms>`, `friend:<pair>:<ms>`, see "Entity ID Format"), unique per event and the same on the live relay and in the log. Ledger rows live 100 days, longer than the 90-day log a pull reads.

**Order.** The ledger only stops a second delivery of one event. The order between different events of a pair (a request delivered after its cancel, a `friend_add` after the removal that followed it) is the pair's clock: an event older than the pair's last change here is accepted and changes nothing, on both paths, and the friend routes move the clock for changes made here. The rule is in [federation.md "Subject clocks"](federation.md#subject-clocks-member-and-friend-events-are-last-writer-wins).

**Before the upgrade.** The ledger only knows events applied since migration 0022, whose time is `instance_settings.ledger_started_at`. The pull never reads a peer's friend events from before it, for any peer, including one peered again after the upgrade (federation.md "Pull sync", "Cursor"), so friend history from before it is never re-applied. The cost, accepted: a friend event lost before the upgrade is not healed by the pull.

**Rolled-back requests.** When the outbox rolls back a `friend_request_create` (a `refused` answer, "Failure Handling" above), `invokePermanentFailureCallback` also deletes that event's mutation-log row, so `/sync` stops serving a request the sender no longer has.

At startup, `startupBootstrapSync()` scans for `status = 'active' AND lastSyncedAt = 0` peers and calls `onPeerActivated(peerId, 'startup_bootstrap')` for each. The sync endpoint (`POST /api/federation/sync`) serves friend events one of whose sides is homed at the requester, from the `federation_mutation_log` table, which retains entries for 90 days, so friend relationships established within the last 90 days are backfilled when a new peer connection is created.

---

## 8. Client-Side: socialStore

Source: `packages/web/src/stores/socialStore.ts`

### Origin Tagging

Every friend and request row is tagged with `_instanceOrigin: string` (empty string = home instance, full URL = remote instance), the instance that issued it. A row is named by its id together with that origin, never by its id alone: row ids are local to an instance, and two instances can each have a different user with the same id.

```typescript
type FriendRow = Friend & { _instanceOrigin: string };
type FriendRequestRow = FriendRequest & { _instanceOrigin: string };
type ListEntry<R> = R & { _rows?: readonly R[] };
type TaggedFriend = ListEntry<FriendRow>;
type TaggedFriendRequest = ListEntry<FriendRequestRow>;
type TaggedSearchResult = UserSearchResult & { _instanceOrigin: string };
```

### One entry per person

`friends` and `requests` hold one entry per person: the friend, or a request's other party (`request.user`). Two rows are the same person when their `userKey` (each with its own origin, `client-federation.md` section 5) is equal, so a person listed by two instances (their home's row and a replicated row of them) is one entry, and two users native to different instances are two entries whatever their ids (#353). A request without a `user` is only ever itself.

An entry's own fields are the row it is shown by: the row from the person's home (`isIssuedByHome`) when an instance listed one, else the first row listed. Its ids and `_instanceOrigin` therefore line up with the search result rows and the profile modal, and mutations go to that row's instance. When more than one instance listed the person, `_rows` holds every instance's row (the shown one included), so an event from any of those instances finds the entry; a person only one instance listed has no `_rows`.

All list changes go through the same helpers in `socialStore.ts`: `mergeRows` (group rows by person, pick the shown row), `withRow` (add a row, or replace the row the same instance issued with the same id), `withoutPeople` (drop the people any of whose rows match), `withoutRows` (drop only the matching rows; a person whose rows all go is dropped, otherwise the entry is shown by a row that is left) and `withEachRow` (apply an update to every row).

Removals are of two kinds:

- **A relationship ends** (`friend_removed`, a request cancelled, declined, accepted or its relay failed, and the user's own remove, accept, decline and cancel): the event or action names one row by id and origin, and the person's whole entry goes. The friendship or request is one relationship however many instances list it, for one identity; the relay clears the other instances' rows, and their own events then find nothing. A detached connection (`federationHomeOrphaned`, before re-attach) is a second identity, and a friendship it holds merges with the home's friendship with the same person (as it did before entries kept `_rows`): a `friend_removed` from the detached instance drops the entry until the next reload, although the home friendship remains.
- **A user row is deleted** (`user_updated` with `isDeleted`): only the rows the deletion reaches go (`updateIsAbout`, `client-federation.md` section 5). A deleted copy drops that instance's row and the person stays, shown by another instance's row.
- **A connection is disconnected or removed** (`instanceStore.disconnectInstance`, `forceRemoveEntry`): `removeInstanceRows(origin)` drops every row that instance issued, next to `removeInstanceSpaces(origin)`. A person another instance also lists stays, shown by that instance's row, so actions on them go to an instance the client still holds. A socket that drops (`setInstanceStatus`) keeps the rows: the instance is still held and its HTTP client still answers.

Crossed requests are one entry. When the user sends Bob a request from home while Bob sends one from orbit, each instance keeps its own pending row, so home lists an outgoing row and orbit an incoming one. They are one entry, shown by the row from Bob's home (the incoming one), and an accept drops both. This is intended: it is one relationship either way.

Removals that match nothing return the same arrays (and the same state), so subscribers do not re-render for, say, the second `friend_removed` that follows a relay.

Other modules never read `_rows`. They look rows up through the store's exports: `friendRowAt(friends, id, origin)` (any instance's friend row, used by `presenceSubject.ts` for a server that sends only its row id), `friendEntryOf(friends, row, origin)` (the friend entry of a person), and `pendingRequestWith(requests, row, origin)` (the pending request row with a person, the one `origin` holds when it holds one, else the entry's shown row; used by the Add Friend search result rows).

### Cross-Instance Friend Loading (`loadFriends`)

1. Waits for `waitForAutoConnect()`, the one helper exported from `stores/instanceStore.ts` that resolves once `_autoConnectDone` is set (at once when it already is; otherwise it subscribes, re-checks the flag after subscribing to close the race, and unsubscribes on the flip), so the fan-out never runs before the remote connections are up, which would miss their rows. `loadRequests`, `exploreStore.fetchSpaces`/`fetchMyRequests` and `utils/mutuals.ts` use the same helper. Then gets connected instances from `instanceStore`
2. Fires `Promise.allSettled()` with:
   - Home instance: `api.social.friends()`
   - Each connected remote instance: `inst.api.social.friends()`
3. **Asset normalization:** For remote-origin friends, calls `normalizeUserAssets(friend, origin)` to resolve relative avatar/banner URLs to absolute remote URLs, and upserts every row into the `userViews` cache
4. **One entry per person** (`mergeRows`, see "One entry per person" above), stored as `friends`. The home-view check is `isIssuedByHome`, which for a row without `homeInstance` is always true; `homeUserId` alone is not a native indicator, since the server backfills native users' `homeUserId` to their own id (`federation.ts:backfillHomeUserId`).

### Cross-Instance Request Loading (`loadRequests`)

Same `Promise.allSettled()` fan-out pattern as `loadFriends`, and one entry per other party (`mergeRows`). A cross-instance request exists as two rows, one on each instance, and both sides return it; the entry is shown by the row from the other party's home, which has their own ids and the matching `_instanceOrigin`. Matching those is what lets an Add Friend search result row turn to "Request sent" after sending. Normalizes assets for remote request user profiles.

### Sending Friend Requests

`sendFriendRequest(target: SendFriendRequest)` posts to the user's home (`getFriendsHomeOrigin()` in `instanceStore.ts`), the only instance that accepts a request from them: any other instance refuses a federated account with `not_authoritative_for_sender`. That is the page's instance (`''`) for a native or detached account, and the home's connected origin otherwise (the same rule as group DM creation and space invites, #391).

`target` is written as the page's instance reads it: a typed handle is `{ username }` (trimmed), and a user the client holds is named by `friendRequestTarget(user, origin)` (`utils/friendRequestTarget.ts`). `addressedTo(target, home)` readdresses it for the home: a bare username names a user on the page's instance, so it gets the page's host (`bob` becomes `bob@<page host>`, which is what the Add Friend box shows for it); an identity, or a username that names its host, is sent as it is. All lookup and peering happen server-side. A failure is an `HttpError` with a server error code, which the caller shows through `describeError`.

After success, reloads requests via `loadRequests()`.

### Cross-Instance Search (`searchUsers`)

`searchUsers(query)` takes a username query the caller has already checked (the Add Friend view's `addQueryOf`, Section 11).

1. Fires parallel `GET /api/social/search` requests (Section 3) to the page's instance and every connected instance (`Promise.allSettled`) and normalizes remote assets. Each instance answers with its own accounts only, so a person homed on a connected instance is found there. An instance that refuses or fails (a 429, an unreachable host) adds no rows, and the call never rejects: with no answer at all it resolves to an empty list.
2. **One result per person** (`userKey`), grouped by the same helpers as the friends and requests lists (`groupByPerson`, `shownRow`): a person two instances return (their home's row and a replicated row of them) is one result, shown by their home's row (`isIssuedByHome`) when one was returned, else by the first. Two users native to different instances are two results whatever their ids (#353). Results are `TaggedSearchResult` rows without `_rows`: events do not change them. They are not written into the `userViews` cache, because a result carries no status or profile text and must never replace the fuller view the cache holds.

The Add Friend view matches each result to the lists by person, not by the shown row: `friendEntryOf` for "already a friend", and `pendingRequestWith` for a pending request. A row with a request is shown by that request's row of the person (its user and origin), because the request id is valid only on the instance that holds it.

### Instance API Resolution (`apiAt`)

```typescript
function apiAt(origin: string): BackspaceApiClient {
  if (!origin) return api;  // The page's own instance
  const instance = useInstanceStore.getState().instances.find(i => i.origin === origin);
  if (!instance) throw new SocialInstanceNotConnectedError(origin);
  return instance.api;
}
```

Used by `sendFriendRequest`, `updateFriendRequest`, `cancelFriendRequest` and `removeFriend`. It is strict: an origin the client holds no entry for (a connection removed from Connections) throws `SocialInstanceNotConnectedError`, whose message is `social:instanceNotConnected` with the host, and nothing is sent. It never falls back to the page's instance, which would receive another instance's row ids and fail, or act on whichever of its own rows has the same id. The shared `getApiForOrigin` in `crossStoreResolvers.ts` keeps its fallback because other surfaces rely on it (asset URLs, for one); `apiAt` is local to `socialStore`. The callers show the error like any other failed social action (`describeError` in a toast, or the search result row's error line).

- `updateFriendRequest(id, origin, status, other?)` and `cancelFriendRequest(id, origin, other?)` take the request's id and the origin of the instance that holds it (a request entry's `_instanceOrigin`, or a search result row's for its `requestId`), call that instance, and drop the person's request entry. `other` is the other party as `origin` issued them; a search result row passes its person, so the entry is found by `userKey` whichever of the person's rows the list holds. Every request action on a row goes through the store; none calls the API directly.
- `removeFriend(row, origin)` takes any row of the person and its origin (a friend entry, or a group DM member row with the DM copy's origin), finds the friend entry by `userKey`, calls the instance the entry is shown by with that row's id, and drops the entry. It does nothing when the person is not a friend.

### WS Event Handlers

From `useWebSocket.ts`, social events are dispatched to store methods:

| WS Event | Store Method | Effect |
|----------|-------------|--------|
| `friend_request_received` | `addIncomingRequest(request, origin)` | Adds the row (`withRow`): a new entry, or another instance's row of a listed person |
| `friend_request_sent` | `addOutboundRequest(request, origin)` | Same as `friend_request_received` (multi-tab sync) |
| `friend_request_accepted` | `addFriendFromAccepted(friend, requestId, origin)` | Adds the friend row (`withRow`); drops the request entry holding row `requestId` + `origin` and any request entry for the same person |
| `friend_removed` | `removeFriendLocally(userId, origin)` | Drops the friend entry holding row `userId` + `origin` |
| `friend_request_cancelled` | `removeRequestById(requestId, origin, userId)` | Drops the request entry holding a row from `origin` with id `requestId` or other party `userId` (that instance's row id) |
| `friend_request_declined` | `removeRequestById(requestId, origin, userId)` | Same as `friend_request_cancelled` |
| `friend_request_relay_failed` | `removeRequestById(requestId, origin)` | Drops the request entry holding row `requestId` + `origin` |

The Add Friend search result rows work out their state from these two lists at render time (Section 11), so nothing else needs updating.

### Live Updates

| WS Event | Store Method | Effect |
|----------|-------------|--------|
| `presence_update` | `updateFriendPresence(subject, origin, status)` | Updates `status` on every row of the friend whose `userKey` matches the subject's (with its delivering origin), so the delivery from any instance reaches the friend it is about and no other. Server broadcasts to friends + DM co-members + space co-members (`collectProfileBroadcastTargetIds`). For federated friends, status is projected by the home instance via S2S `presence_update` relay (see `federation.md` §10, Presence Sync) and broadcast to the same recipient set on the receiving instance. |
| `user_updated` | `updateFriendProfile(user, origin)` | Updates displayName, avatar, banner, accentColor, avatarColor, bio, customStatus, status (`profileFieldsOf`) on the friend rows the event is about, every row of each entry (`userUpdateReach`, `identity.ts`): the issuing instance's row with that id, and other instances' rows of the same person when the event is their home's row. Never a friend on another instance who only has the same id. With `isDeleted`, `removeDeletedUser(user, origin)` drops the friend rows and pending requests it is about by the same rule (client-federation.md §5) |

---

## 9. Client-Side: Mutuals

Source: `packages/web/src/utils/mutuals.ts`

### `loadFederatedMutuals(targetUserId, targetHomeUserId?)`

Follows the same `Promise.allSettled()` fan-out pattern:

1. Computes `canonicalHomeId = targetHomeUserId ?? targetUserId`
2. Fires `api.users.getMutuals(targetUserId, canonicalHomeId)` to home + all connected instances
3. **Friend dedup:** By person (`userKey(friend, origin)`), so the same friend listed by several instances appears once, and two users native to different instances with the same id stay two
4. **Space dedup:** By `${space.id}:${origin}` (spaces on different instances are distinct entities)
5. **Asset normalization:** Remote-origin friend avatars and space icons are resolved to absolute URLs

### Types

```typescript
type TaggedMutualFriend = User & { _instanceOrigin: string };
interface MutualSpace {
  id: string;
  name: string;
  icon: string | null;
  avatarColor: string | null;
  _instanceOrigin: string;
}
```

---

## 10. Client-Side: Identity Utilities

Source: `packages/web/src/utils/identity.ts`

### `parseFederatedUsername(username)`

Splits `"erin@nova.ddns.net"` into `{ baseName: "erin", domain: "nova.ddns.net" }`. Uses `indexOf('@')` (first occurrence). Returns `{ baseName: username, domain: null }` for non-federated usernames.

### Matching people

Whether two rows are the same person (`userKey`) and whether a row is the signed-in user (`isMine`) are described in `client-federation.md` section 5. `UserProfileModal:getFriendshipStatus()` matches friends and requests to the viewed user by `userKey` of each row with its own origin.

---

## 11. FriendsPage UI

Source: `packages/web/src/components/chat/FriendsPage.tsx`

### Views

| View | Content | Key Behavior |
|-----|---------|--------------|
| Online | Online friends only | Filters by `status !== 'offline'` |
| All | Complete friend list | No filter |
| Pending | Incoming + outgoing requests | Split into sections; incoming shows badge count in tab (and on the mobile nav). A request is incoming when its other party (`user`) is its sender (`isIncomingRequest`, `isOutgoingRequest` in `socialStore.ts`): its ids are the holding instance's, so `fromId` is never compared with the session row's id |
| Add Friend | Find people by username, or add a `name@instance` handle | See below |
| Activity | Online friends: on voice first, then those sharing an activity, then the rest (`useFriendBuckets`) | Phone only; a row opens the friend's profile |

On the desktop the header holds the Online, All and Pending tabs and an "Add Friend" button that opens the Add Friend view; the phone has a tab bar of all five. `?view=add` and `?view=pending` open the page on that view, and the parameter is dropped once read.

### Add Friend view: what the field holds

Nobody is listed before a search. `addQueryOf` reads the field (trimmed, one leading `@` dropped) and the view shows one of these:

| Field | Shown |
|---|---|
| Empty | An `.empty-state`: type a username to find someone; nobody is listed until one searches, and people are found only by the name they chose |
| A handle `name@host` (an `@` with text on both sides) | The direct-add row, "Send friend request to name@host" with Send Request. A handle on another host is offered only while this instance federates (`useFederationEnabled`); otherwise the view says that people on other instances cannot be added while it does not. A handle on the page's own host (`window.location.host`) needs no federation |
| Fewer than 3 letters, digits or underscores | "Type at least 3 characters of a username." |
| Any other character, or more than 32 | "Usernames are made of letters, digits and underscores." |
| A valid username (3 to 32 of `a-z0-9_`) | A search through `socialStore.searchUsers`, debounced 300 ms; only the newest answer is shown. A spinner while a search runs with no rows to show, then the result rows under a "People" label, or "No users match your search." |

The direct-add row sends `sendFriendRequest({ username: handle })`; all routing, peering and remote lookup happen server-side on `POST /api/social/requests` (Section 6 outbound flow), which lowercases the lookup input, so mixed-case handles resolve too. Success shows a toast and clears the field. A bare name is never sent as a request from here: it is searched, and the request is sent from its result row. A search that every instance refuses (past the per-account limit, say) reads as no results, because `searchUsers` resolves to an empty list rather than failing.

**Error handling:** a refused request surfaces through `describeError` (`i18n/errors`), which turns the server's error code (`user_not_found`, `peer_pending`, `peer_rejected`, `incoming_request_exists`, `blocked_by_you`, `federation_disabled`, ...) into a sentence: as a toast for the direct-add row, and on the row itself for a result row's action.

### Search result rows

Each result (`TaggedSearchResult`) becomes a `SearchRow` at render time, checked against the current `friends` and `requests` arrays in `socialStore`:
- The viewer's own rows are dropped (a precomputed `Set<string>` of `${id}:${origin}` for the current user across all connected instances)
- A friend (`friendEntryOf`) -> `relationship: 'friends'`
- A pending request with the person (`pendingRequestWith`) -> `'outbound_pending'` or `'inbound_pending'` with its `requestId`; the row is then shown by that request's row of the person when another instance holds the request (Section 8)
- Otherwise -> `relationship: 'none'`

`SearchResultRow` shows the avatar, the display name, `@username` and, for a result from another instance, that instance's host; a state line ("Already friends", "Request sent", "Wants to be your friend"); and the action for the relationship:
- `none`: "Send Request", `sendFriendRequest(friendRequestTarget(row, origin))`
- `outbound_pending`: "Cancel Request"
- `inbound_pending`: "Accept" / "Decline"
- `friends`: "Message", which opens the DM (`openDirectMessage`)

The avatar and the name open the profile modal. An action that fails shows its error on the row in place of the state line. Nothing on the row changes itself after an action: the store's lists follow every answer and the row's state follows them.

---

## 12. UserProfileModal

Source: `packages/web/src/components/modals/UserProfileModal.tsx`

### Friendship Status Resolution

Uses `getFriendshipStatus()`, matching by person (`userKey`, client-federation.md section 5), never by id or username:

```typescript
function getFriendshipStatus(viewedUser, origin, self, friends, requests): FriendshipStatus
  → { state: 'self' }              // isMine(viewedUser, origin, self)
  | { state: 'friends', friend }   // userKey(friend, friend._instanceOrigin) === userKey(viewedUser, origin)
  | { state: 'outbound_pending', request }  // request.user is the viewed person, user.id === toId
  | { state: 'inbound_pending', request }   // request.user is the viewed person, user.id === fromId
  | { state: 'none' }
```

On the user's own profile the action bar (Send Message, friend actions) is not shown.

### Tabs

| Tab | Content |
|-----|---------|
| About | Bio (`ui/ProfileBio.tsx`, shared with the profile card: GFM Markdown limited to p, strong, em, del, a, br, so a bare URL is a link as in chat, and `:shortcode:` emoji as described in `utils/emojiShortcodes.ts`), Member Since date |
| Mutual Friends | Grid of mutual friends (from `loadFederatedMutuals`), clickable to navigate to their profile |
| Mutual Spaces | List of mutual spaces with icons, clickable to navigate to space |

### Action Buttons

Displayed in footer based on friendship state:
- Every state except `self`: "Send Message" (opens/creates DM)
- `none`: "Add Friend"
- `outbound_pending`: "Cancel Request"
- `inbound_pending`: "Accept" + "Ignore" (decline)
- `friends`: "Remove Friend"

All actions route through `socialStore` methods, which handle instance routing via origin tags.

### Federation Support

- User profile is loaded via `getApiForOrigin(origin)` to fetch from the correct instance
- Banner/avatar URLs resolved through the correct API client for remote users
- Mutuals loaded via `loadFederatedMutuals()` with cross-instance fan-out
- Add Friend sends `sendFriendRequest(friendRequestTarget(user, origin))`, the user's identity when the client holds one (Section 6, "Addressing the target"); all routing is server-side; errors surface as toasts via `describeError`

---

## 13. Data Types

### Friend (shared)

```typescript
interface Friend {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: string | null;
  avatarColor: AvatarColor | null;
  bio: string | null;
  status: UserStatus;
  customStatus: string | null;
  createdAt: number;
  addedAt: number;          // From friends.createdAt
  homeUserId: string | null;
  homeInstance: string | null;
}
```

### FriendRequest (shared)

```typescript
interface FriendRequest {
  id: string;
  fromId: string;
  toId: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  user?: User;  // The OTHER party (sender for incoming, recipient for outgoing)
}
```

### UserSearchResult (shared)

`GET /api/social/search` (Section 3): only what an add-friend row shows and what a request or a DM needs to address the person; nothing about their status, their profile text or their other accounts.

```typescript
interface UserSearchResult {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  avatarColor: AvatarColor | null;
  homeInstance: string | null;
  homeUserId: string | null;
}
```

`DiscoverUser` is gone with the discover endpoint.
