# Space & Membership System

Source files:
- `packages/server/src/routes/spaces.ts` — Space CRUD, invite, join, members, roles, bans, ownership transfer, invite preview
- `packages/server/src/routes/channels.ts` — Channel CRUD, category CRUD, channel layout reordering, channel/category permission overrides
- `packages/server/src/routes/explore.ts` — Discovery listing, public join, join request workflow
- `packages/server/src/routes/spaceReview.ts` — The owner's side of the platform's reviews: asking for a Discovery listing and for verification (see "Discovery approval"); the admins' decisions are in `routes/platformAdmin.ts` (admin.md)
- `packages/server/src/utils/spaceReview.ts` — The review state machine, the history, `reviewsAfterEdit` / `reviewsAfterTransfer` (the re-review an edit or a new owner causes)
- `packages/server/src/utils/discoveryListing.ts` — `LISTED_IN_DISCOVERY_SQL`, the one predicate for "listed in Explore"
- `packages/server/src/utils/reviewNotify.ts` — Who hears of a review step
- `packages/shared/src/platform.ts` — Review statuses, decisions, limits and wire types
- `packages/server/src/routes/spaceModeration.ts` — Automatic message rules, member timeouts, audit log (see "Moderation")
- `packages/server/src/utils/spaceModeration.ts`, `utils/auditLog.ts` — Moderation enforcement and storage, the audit log
- `packages/server/src/utils/spaceWire.ts` — The space, channel and member wire shapes every route and event sends
- `packages/shared/src/moderation.ts` — The pure rules: validating a change of them, checking a message
- `packages/server/src/routes/users.ts` — Space layout (sidebar folders/ordering) persistence via `PUT /api/users/@me/space-layout`
- `packages/web/src/stores/spaceStore.ts` — Client-side space state, multi-instance merge, LWW layout sync
- `packages/web/src/stores/exploreStore.ts` — Explore page state, multi-instance discovery aggregation
- `packages/web/src/stores/directoryStore.ts` - Outer Space: the directory feed, origin dedupe, connect-then-join (see [directory.md](directory.md))
- `packages/web/src/components/chat/ExplorePage.tsx`, `SpaceCard.tsx`, `OuterSpaceSection.tsx` - the Explore page's two sections and the card both use
- `packages/web/src/components/modals/CreateSpace.tsx` — Space creation modal (icon crop, color, visibility)
- `packages/web/src/components/modals/JoinSpace.tsx` — Join-by-code modal with federation connect phases
- `packages/web/src/components/modals/ExploreSpacePreviewCard.tsx` — Compact discoverable-space card rendered inside the Join Space modal
- `packages/web/src/components/modals/InviteModal.tsx` — Invite link generation and copy
- `packages/web/src/components/modals/TransferOwnershipModal.tsx` — Ownership transfer member picker
- `packages/web/src/components/modals/SpaceSettings.tsx` — Space settings: overview, discovery, verification, moderation, members, roles, bans, audit log
- `packages/web/src/components/modals/spaceSettingsPanels/DiscoveryListingSection.tsx`, `VerificationPanel.tsx` — The owner's listing request (in the Discovery tab) and verification request (the Verification tab)
- `packages/web/src/stores/reviewStore.ts` — A review revision per space, so an open panel reloads on `space_review_updated`; the home admins' open-request count
- `packages/web/src/components/JoinPage.tsx` — Public invite landing page with federation redirect
- `packages/web/src/hooks/useDragManager.ts` — Channel/category/voice-user drag-and-drop
- `packages/web/src/hooks/useSpaceJoin.ts` — Shared join/request state machine over exploreStore (used by ExplorePage SpaceCard and the JoinSpace modal preview card)
- `packages/web/src/utils/inviteParser.ts` — Invite code/URL/qualified-code parser
- `packages/web/src/utils/joinErrors.ts`, `utils/inviteJoinRequest.ts` - `JoinRequestRequiredError` and the join refusal checks; `sendInviteJoinRequest`, the join request an invite to a request space leads to
- `packages/web/src/components/modals/spaceSettingsPanels/spaceSettingsTabs.ts` — The settings tabs and who may open each, read by the settings window and the phone's settings button (see "Settings tabs")
- `packages/web/src/components/modals/spaceSettingsPanels/EmojiStickersPanel.tsx` — The Emoji and stickers tab (see "Settings tabs"; the routes in [emoji.md](emoji.md))
- `packages/web/src/components/modals/spaceSettingsPanels/DiscordMovePanel.tsx`, `DiscordExpressionImport.tsx`, `DiscordAnnouncement.tsx`, `packages/web/src/utils/discordAnnouncement.ts` — The Get from Discord tab: the template entry, the emoji and sticker import, the announcement
- `packages/server/src/routes/discordExpressionImport.ts`, `utils/discordApi.ts`, `utils/discordExpressionSessions.ts`, `packages/shared/src/discordExpressionImport.ts` — Bringing a Discord server's emoji and stickers into a space (see "Importing emoji and stickers from Discord")

Cross-references: [database.md](database.md) (table schemas), [permissions.md](permissions.md) (resolution algorithm, override tiers), [websocket.md](websocket.md) (event types), [federation.md](federation.md) (peer relay), [voice.md](voice.md) (voice channel join), [emoji.md](emoji.md) (a space's own emoji and stickers, who may use which)

---

## Space Lifecycle

### Creation

**Endpoint:** `POST /api/spaces` (`spaces.ts:spaceRoutes`). An account may own 25 spaces unless the operator says otherwise (409 `space_limit_reached`, [uploads.md](uploads.md), "Limits per account"); so does the Discord import into a new space.
**Auth:** Required
**Permission:** Any authenticated user

**Request body (`CreateSpaceRequest`):**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| name | string | yes | trimmed, 1-100 chars |
| icon | string | no | Upload filename |
| banner | string | no | Upload filename |
| avatarColor | AvatarColor | no | Must be in `AVATAR_COLORS`; random if omitted |
| visibility | SpaceVisibility | no | `'public'` / `'request'` / `'private'`; defaults to `'private'` |
| description | string | no | trimmed, max 200 chars |

**AVATAR_COLORS:** `['mint', 'sky', 'lavender', 'coral', 'rose', 'teal', 'amber']`

**Atomic transaction creates:**

| Entity | ID | Details |
|--------|----|---------|
| Space | `spaceId` (snowflake) | With `inviteCode` = `crypto.randomBytes(4).toString('hex')` (8 hex chars) |
| Owner membership | `(spaceId, userId)` | Creator auto-joined |
| Category: "text-channels" | `textCategoryId` (snowflake) | position 0 |
| Category: "voice-channels" | `voiceCategoryId` (snowflake) | position 1 |
| Channel: "general" (text) | `channelId` (snowflake) | position 0, in text-channels category |
| Channel: "voice" (voice) | `voiceChannelId` (snowflake) | position 0, in voice-channels category |
| @everyone role | id = `spaceId` | `DEFAULT_EVERYONE_PERMISSIONS`, position 0, color `#b9bbbe` |

**DEFAULT_EVERYONE_PERMISSIONS bits:** VIEW_CHANNEL, SEND_MESSAGES, CREATE_INVITE, CONNECT, SPEAK, ATTACH_FILES, READ_MESSAGE_HISTORY, ADD_REACTIONS, STREAM

**Post-transaction:**
1. `connectionManager.addUserSpace(userId, spaceId)` — registers creator for WS broadcasts
2. Icon/banner attachment records cleaned up (reference now in `spaces` table)
3. Icon/banner resized via `resizeProfileImage(filePath, 'icon'|'banner')`

**Response:** 201, `Space` object

### Read

**List user's spaces:** `GET /api/spaces` — returns all spaces where user is a member. Response: `Space[]`.

**Get space detail:** `GET /api/spaces/:id` — membership required. Returns `SpaceWithChannelsAndMembers`:
- Channels filtered by `VIEW_CHANNEL` permission per-channel (computed per-user)
- Each channel includes `isPrivate` (true if @everyone has VIEW_CHANNEL deny override, `isHiddenFromEveryone`; see permissions.md, "Private channels and categories") and `myPermissions`
- Categories include `isPrivate` flag (same rule)
- Roles carry their display fields for every member and their `permissions` only when the requesting user holds `MANAGE_ROLES`; member rows list their roles with display fields only (permissions.md, "Who receives role and override data")
- `myPermissions` at space level included

### Update

**Endpoint:** `PATCH /api/spaces/:id`
**Permission:** `MANAGE_SPACE`; `ownerTitle` and `ownerGroup` the owner only

**Updatable fields:** name (1-100 chars), icon, banner, avatarColor (validated against AVATAR_COLORS), visibility (public/request/private), description (max 200 chars), directoryListed (boolean), ownerTitle (see "Owner title" below), ownerGroup (see "Ownership and roles" below), defaultNotificationLevel (`'all'`, `'mentions'` or `null`; see "Moderation", "Default notification level"), tag (space-tags.md), look (see "A space's look" below).

Every field is checked before anything is written. A body with `ownerTitle` from anyone but the owner is refused with `403 space_owner_only` as a whole, so a member with `MANAGE_SPACE` cannot rename the space in the same request either.

**Directory listing:** `directoryListed: true` is refused with `400 directory_private_space` when the resulting visibility is `private`, and a listed space switched to `private` has the flag cleared in the same write. A change to the flag, or to name, description, icon, banner, avatarColor or visibility while the space is listed, calls `markDirectoryDirty()` so the directory pinger tells the hub; deleting a listed space does the same. The flag alone serves nothing: the space also needs an approved Discovery listing (see "Discovery approval"). See [directory.md](directory.md) §3.

**Review after an edit** (`reviewsAfterEdit` in `utils/spaceReview.ts`). The new review statuses are written in the same update as the edit, so a change never reaches Explore, or keeps the verified badge, unseen:
- An `approved` listing whose `name`, `description`, `icon` or `banner` changes goes back to `pending`: the space leaves Explore until an instance admin approves it again. `avatarColor`, and a move between `public` and `request`, leave the approval as it is.
- An open Discovery request (`pending`, `changes_requested`) whose space changes those fields keeps its status, and the edit becomes a new version of it: its `requested_at` is the time of the edit, so a decision made on the earlier view is refused with `409 review_status_conflict`.
- A space that was `public` or `request` and becomes `private` has its listing `withdrawn`, an open request included.
- A `verified` space whose `name` changes goes back to `pending` and shows no badge until approved again; an open verification request takes the new name as a new version.
- Any other status (none, `rejected`, `withdrawn`, `revoked`) is left alone.

Each change records a `changed` event in the review history, with the editor as its actor (`recordEditSteps`), and is announced like every review step ("Discovery approval", "Who hears of a step"). Transferring ownership treats a `verified`, `pending` or `needs_info` verification the same way (`reviewsAfterTransfer`): it is reviewed again under the new owner.

**The banner** is set in the space's settings (Overview), cropped to 16:9, and shown where members are: at the head of the space's channel column on the desktop and over its channel list on the phone (`layout/SpaceBannerHeader.tsx`: the column's bar lies over the picture's top on a shade, and the picture scrolls away under it), and across the space's card on Home (`ui/SpaceBand.tsx`), as on its card in Explore. Every one of these goes through the gate for pictures from other servers (`useSpaceBanner`, legal.md "Content from other servers"); without a banner, or one that may not load, nothing is painted in its place. The settings' preview has the column's width and shape.

**Side effects:**
- Old icon/banner files deleted from disk when replaced
- New icon/banner resized via `resizeProfileImage`
- Attachment records cleaned up for newly-set images
- `space_updated` WS event broadcast to all space members

### Delete

**Endpoint:** `DELETE /api/spaces/:id`
**Permission:** Owner only (`isSpaceOwner` check)

**Transaction deletes (in order):**
1. `read_states` for all channels in the space (no FK cascade)
2. All channels (messages cascade via FK)
3. All `space_members`
4. All `space_folder_members` referencing this space
5. The space itself, which takes its review rows (`space_verification_requests`, `space_discovery_requests`, `space_review_events`) with it through their `ON DELETE CASCADE` foreign keys

**Post-transaction:** All attachment files and space icon/banner files deleted from disk, and the pictures of the space's emoji, whose `space_emojis` rows went with the space (`ON DELETE CASCADE`, like `space_stickers`). A sticker's picture is shared by content and stays while a message, a reaction or someone's collection names it; the storage janitor takes the rest. Every member is sent `space_deleted` and then taken out of its audience and its voice (websocket.md), so the space leaves their list at once.

The same `deleteSpaceCompletely` (`utils/spaceDeletion.ts`) is the only way a space goes: an instance admin deleting the owner's account with its spaces, or the space itself from the admin console (`POST /api/admin/spaces/:id/delete`, admin.md, "Removing content").

---

## Invite System

### Invite Code Generation

**Endpoint:** `POST /api/spaces/:id/invite`
**Permission:** `CREATE_INVITE`

**Behavior:** Returns existing `inviteCode` if one exists. Only generates a new one (`crypto.randomBytes(4).toString('hex')`) if the space has no invite code. Invite codes are permanent (no expiration).

**Every visibility has a link.** A `request` space gets its code like any other. The code never admits anyone to it: a join by code answers `join_request_required` and the client turns that into a join request (see "Join by Invite Code" and "Invite links to a space joined by request" below). Up to 1.9.0 this endpoint refused a request space with `403 space_uses_join_requests`, and `POST /api/dm/space-invite` refused a local one with `403 space_requires_approval`; neither is sent any more, and both stay in the code list because an older instance still sends them.

**Response:** `{ inviteCode: string }`

### Invite URL Format

Built by `spaceInviteUrl(instanceOrigin, inviteCode)` in `inviteParser.ts`, the one builder for every surface that hands out a link (`InviteModal`, and the Invite People item of the space context menu in `SpaceSidebar` and `MobileSpacesScreen`):
- **Web:** `{instanceOrigin}/join/{inviteCode}` (e.g., `https://nova.ddns.net/join/a3f1b2c4`). `instanceOrigin` is the space's `_instanceOrigin`, the instance that issued the code; `''` (a space on the page's own instance) becomes `window.location.origin`.
- **Deep link (Electron):** `backspace://join/{inviteCode}` or `backspace://join/{inviteCode}@{host}` for remote instances

### Invite Code Parser (`inviteParser.ts`)

Parses three input formats into `{ code: string; origin?: string }`:

| Format | Example | Parsed |
|--------|---------|--------|
| Bare code | `a3f1b2c4` | `{ code: 'a3f1b2c4' }` |
| Full URL | `https://remote.com/join/a3f1b2c4` | `{ code: 'a3f1b2c4', origin: 'https://remote.com' }` |
| Qualified code | `a3f1b2c4@remote.com` | `{ code: 'a3f1b2c4', origin: 'https://remote.com' }` |

If the parsed origin matches `window.location.origin`, it is treated as a bare code (origin stripped).

### Direct Friend Invitation (in-app)

`POST /api/dm/space-invite` (see [dm-system.md](dm-system.md)) sends a structured invite card to a friend via DM. The card carries a snapshot of the space (name, icon, member count, description) plus the canonical identifiers (`spaceId`, `spaceInstanceOrigin`, `inviteCode`).

The endpoint lives on the **caller's home instance**, not the space's home. The caller's instance fetches the snapshot server-to-server from the space's `GET /api/spaces/invite/:code/preview` endpoint, then inserts a `type='system'` DM message with `event: 'space_invite'` content. Three-way federation (sender on X, recipient on Y, space on Z) is supported without new federation event kinds. A space of any visibility can be invited to; for a `request` space the card leads the recipient to a join request (see "Invite links to a space joined by request").

`InviteModal` sends the request to `getFriendsHomeOrigin()` (`instanceStore.ts`, see [client-federation.md](client-federation.md) §5): the page's instance for a native account, and the connected true home for a federated account signed in to another instance, whose friends are checked there (#391). Each friend is named as that instance knows them (`personRequest(friend, origin, home)`), and the space's origin is translated for it: `''` only when the space is on the receiving instance, else the space's absolute origin (the page's own `window.location.origin` for a space on the page's instance). With no live session on the true home it falls back to the page's instance.

The invite is relayed like every DM message (`queueDmRelay`), to each instance that hosts a participant: the recipient's home when they are homed elsewhere, and the sender's home when the sender is a federated account acting on this instance, which is where the sender reads the conversation. Up to 1.8.0 the route relayed only when the recipient was homed elsewhere, so an invite sent through a federated account reached the recipient but never the sender's own copy of the conversation.

The friend-picker surface in `InviteModal` uses the same per-space invite code as the link-share footer — there is exactly one invite code per space at any time, and revocation (when implemented) invalidates all outstanding cards atomically.

### Invite Preview

**A link pasted elsewhere** shows the space too. `GET /join/:code` answers the page with the preview's name, description, member count and icon in its `<title>`, description and Open Graph tags (`renderInviteHtml` in `utils/webDocument.ts`), so a chat app that fetches the link can show them. The strings are English, as the page's own metadata is: a service fetching a link states no language. Three rules:

- It says what the endpoint below already says to anyone with the code, no more. Only a code on this instance is looked up; a code of another instance is never fetched.
- It is a route and not part of the `onRequest` hook of the other documents, so it counts against the rate limit as the endpoint does. An invite code is 32 bits.
- `X-Robots-Tag: noindex` keeps it out of search engines, in a header and not in `robots.txt`: a service that honours that file would not fetch the preview either. The same header goes on a code that is not known, with the plain page.

The icon appears only when it is an upload on this instance; a space icon at another address leaves the product's picture.

**Endpoint:** `GET /api/spaces/invite/:code/preview` (no auth required)

**Response (`InvitePreview`):**

```typescript
{
  spaceId: string;
  spaceName: string;
  description: string | null;
  icon: string | null;
  avatarColor: AvatarColor | null;
  memberCount: number;     // live count from space_members
  instanceName: string;    // from instance_settings
  visibility?: SpaceVisibility; // read on every call; absent from an instance up to 1.9.0
  movedFromDiscord?: boolean;   // spaces.discord_imported_at is set; absent from an instance before 1.34.0
}
```

Built by `getLocalInvitePreview` (`utils/spaceInviteSnapshot.ts`). `getLocalInviteSnapshot`, which the DM invite route stores in the card, is the same read without `visibility` and `movedFromDiscord`. What `movedFromDiscord` is for: "Telling the Discord server".

### Join by Invite Code

Two endpoints serve the same purpose:

| Endpoint | Use case |
|----------|----------|
| `POST /api/spaces/:id/join` | Join when spaceId is known (body: `{ inviteCode }`) |
| `POST /api/spaces/join` | Join by code only, spaceId looked up from `inviteCode` |

Both run the same check after the code matches (`inviteJoinRefusal` in `spaces.ts`), against the space's visibility at the time of the call, so a link follows the space when its visibility changes:

| Case | Answer |
|------|--------|
| Banned | `403 user_banned` |
| Already a member | `409 already_member` |
| `request` space, a request of theirs is pending | `409 join_request_pending` (the answer `request-join` gives) |
| `request` space, otherwise (a declined request included) | `403 join_request_required`, `details: { spaceId }` |
| `private` or `public` space | joins (side effects below) |

**A code never admits anyone to a `request` space.** Entry is `POST /api/spaces/:id/request-join` and a manager's approval; `details.spaceId` is the id to send that request to, so a client holding only a code can do it. An instance up to 1.9.0 sends `join_request_required` without `details`; the client then reads the id from the invite preview. `private` spaces are joined by code (an invite is their only entry path); `public` spaces by code or via `POST /api/spaces/:id/public-join`. Combined with the permission membership gate (a non-member cannot obtain `CREATE_INVITE`, see [permissions.md](permissions.md)), a non-member cannot mint a code for a request space, and a code to one leads only to a request.

**Side effects:**
1. Insert `space_members` row
2. `connectionManager.addUserSpace` for WS broadcasts — also pushes a scoped `space_voice_state` snapshot to the joining user so voice-channel occupants appear without a reload (see `docs/systems/websocket.md` → "Mid-session space join")
3. `member_joined` WS event broadcast to space
4. Response: `Space` object

### Join Page (`JoinPage.tsx`)

Public route at `/join/:inviteCode`. Handles six phases:

| Phase | Trigger | UI |
|-------|---------|-----|
| `preview` | Initial load | Space preview card + join button (auth) or login/register links (unauth); for a request space, the request notice, an optional note and "Ask to join as {name}" |
| `connect` | `NotConnectedError` on join or request attempt | Password prompt for federation connect ("Connect & Ask to Join" for a request) |
| `fallback` | `RemoteLoginRequiredError` on connect | Username + password for an account on the remote, under the `FallbackNotice` its `reason` selects |
| `other-instance` | User clicks "I use another instance" | Domain input for federation redirect |
| `already-member` | Join or request returns `already_member` | Green checkmark + auto-redirect (2s timer) |
| `request-sent` | Request sent, or one was already pending | "Request sent to {space}" or "Your request to join {space} is waiting", and Back to Backspace |

**The page's action** is `join` or `request`, read from the preview's `visibility` on load. `request` sends `sendInviteJoinRequest(preview.spaceId, origin, note)` to the space's instance, after the connect step when that instance is remote. It changes when the server says otherwise: a join answered with `join_request_required` (an instance without `visibility` in its preview, or a space switched to `request` after the page loaded) switches to `request` for the user to send; a join answered with `join_request_pending` shows the waiting request; a request answered with `space_not_requestable` (the space left `request`) joins by the code instead. Banned is shown as the refusal text, as on every join path. While the action is `request` the heading above the space name is `auth:join.invitedToRequest` ("You've been invited to ask to join") in every phase, signed out included, so the page never promises entry.

**From Discord.** With `?from=discord` in the address and `movedFromDiscord: true` in the preview, the page shows a welcome for people following their community from Discord (`auth:join.fromDiscord`). See "Telling the Discord server".

**Federation redirect flow (other-instance):**
1. User enters their home domain (e.g., `my-instance.com`)
2. Constructs qualified invite: `{code}@{currentHost}`
3. Redirects to `https://{domain}/join/{qualifiedCode}`
4. Their home instance's JoinPage receives the qualified code, parses origin, and handles federation connect

**Preview fetching:** For remote invites, creates a temporary API client via `createApiClient(origin, () => null)` to fetch the preview without authentication.

### Invite links to a space joined by request

Every surface that takes a code reaches the join request flow the same way, so none of them ends at the refusal:

- `spaceStore.joinByCode` turns a `join_request_required` refusal into `JoinRequestRequiredError` (`utils/joinErrors.ts`), an `HttpError` with that code plus `spaceId` and `origin` (`''` for the page's instance). The id comes from `details.spaceId`, else from the invite preview; when neither names it the original refusal is thrown. `connectedJoinOrigin(origin)` is the shared origin check: `''` for the page's own instance, the origin when it holds a connected session, else `NotConnectedError`.
- `exploreStore.requestJoinSpace(spaceId, origin, message?)` sends `POST /api/spaces/:id/request-join` to that origin and records the request in `myRequests` tagged with it. `sendInviteJoinRequest` (`utils/inviteJoinRequest.ts`) wraps it and reports `join_request_pending` as `'pending'` instead of throwing. The request route's rate limit (5 per minute) and the manager's approval apply unchanged.
- The space on another instance is reached as for a join: the request goes to the space's instance through the user's connected session there, so the request, the ban check and the membership check all use the user's row on that instance.
- Surfaces: the Join Page (above); the Join Space dialog, which moves to a `request` step (note, Send Request) and then to `request-sent`; and a DM invite card (`SpaceInviteCard`), which shows "Ask to join" when the live preview says `request` or the join was refused with `join_request_required`, then "Request sent" or "Request pending".
- Inviters: Invite Friends (`InviteModal`) shows the friend list and the link for a request space, with an intro that says people who open it ask to join; the space menu's Invite People (`SpaceSidebar`, `MobileSpacesScreen`) copies the link and confirms with "Invite link copied. People who open it can ask to join."

### Join Space Modal (`JoinSpaceModal`)

Opened from the space sidebar "Join a Space" action. The `input` phase is
**discovery-first**: on open it triggers `exploreStore.fetchSpaces()` +
`fetchMyRequests()` (same multi-instance discovery data as the Explore page)
and renders up to 6 unjoined listed spaces (an approved listing, public or
request; see "Discovery approval") as compact `ExploreSpacePreviewCard`s. A "Browse all in Explore" action routes to the full
Explore page — `navigate('/explore')` on desktop, `pushMobileScreen('explore')`
on mobile (`uiStore.isMobile`). Joining a public preview card closes the modal
and navigates into the space.

States: loading (skeletons), empty / all-joined (notice), discovery disabled by
admin (`discoveryEnabled=false` → notice, invite path becomes primary), fetch
error (quiet degrade — invite path unaffected).

Below a divider, the secondary **"Have an invite code?"** section keeps the
invite-code/link flow: `parseInviteInput` → `joinByCode(code, origin?)`, with the
unchanged federation phases:
- `connect` — password prompt for federation
- `fallback` — different-password login for remote instance

The join/request behavior of both the compact preview card and the Explore
page's `SpaceCard` is provided by the shared `useSpaceJoin` hook, so the two
surfaces cannot drift.

The direct sidebar "Explore Spaces" button remains the 1-click path to the full
Explore page; the modal's discovery preview is an additional, in-context entry
point, not a replacement.

---

## Discovery System

### Space Visibility

Visibility decides how people join, and nothing else. Being listed in Explore is a separate step: the space's owner asks for a listing and an instance admin approves it ("Discovery approval" below). Nothing an owner, or a member with `MANAGE_SPACE`, sets alone lists a space.

| Value | Explore listing | Join mechanism |
|-------|----------------|----------------|
| `private` | Never listed; going private withdraws a listing | Invite code only |
| `request` | Listed once its listing is approved | Submit join request, requires approval (an invite link leads to the same request) |
| `public` | Listed once its listing is approved | Instant join, no invite needed |

The join routes read visibility only: `public-join` and `request-join` do not ask whether the space is listed, so a public space can be joined by anyone who has its id, listed or not.

A listed space (approved, `public` or `request`) that is switched on for "List in the global Tavvit directory" (`spaces.directoryListed`, set by whoever may run `PATCH /api/spaces/:id`) is additionally served on `GET /api/directory/spaces` while the instance admin allows it (`instance_settings.directoryEnabled`, which itself requires discovery on), and from there appears in Outer Space on other instances. The switch may be on before the listing is approved; it then serves nothing until the approval. It lives in the space settings Discovery panel, in an "Outer Space" block that is drawn only where it can do something (`showOuterSpace`): for the administrator of the instance the space lives on (`settingsStore.isAdmin` and an empty `_instanceOrigin`, because admin rights are per instance and the client holds that flag only for home, and because the write goes to home), while the instance's settings document is still unknown or failed to load (the Retry is in the block), and wherever the instance has a `DIRECTORY_ENDPOINT` and allows global listing. On an instance without a hub, or one whose administrator does not allow listing, nobody else sees the block, an owner included: a locked switch under a fact about how the instance is run is a notice members are not shown. Where the block is drawn, the switch is disabled with the first reason that applies, read from the settings document of the instance the space lives on (`streamingLimits` for a home space; a remote space asks its own instance's `GET /api/settings/streaming` on mount, and a load whose origin changed under it writes nothing): the instance has no `DIRECTORY_ENDPOINT` (`directoryConfigured: false`), so a listing would reach no hub and the administrator's own switch cannot change that; then the administrator's listing opt-in is off (`directoryEnabled: false`), "Global listing is not allowed on this instance.", with "Turn it on" beside it; then the space is private. The endpoint is asked first because it is the fact the administrator cannot fix from the settings the second reason points at, and the first two reasons are only ever read by that administrator. "Turn it on" confirms first and then writes the whole global rung (`discoveryEnabled` and `directoryEnabled` together, the pair the server requires). A fourth state is not a reason: while the document is unknown the switch is disabled and says nothing, and a load that came back empty says so with a Retry (see below). The switch is followed by a one-sentence disclosure of what listing makes public. The notice that space discovery is off on the instance ("An approved listing appears in Explore once it is turned back on.") is likewise shown only to that administrator. See [directory.md](directory.md) §10.

The panel fetches that settings document itself when the store has none, and says so when the fetch comes back empty. `streamingLimits` is filled once per session by the WS `ready` handler and by nothing else a member can reach, so a `ready` whose fetch failed used to leave the switch disabled with no reason and no way to ask again: the round that stopped the panel guessing (`?? true` / `?? false` asserted "discovery on, not listed" from a document nobody had read) made the silence permanent. Unknown now says it is unknown, in the treatment the Streaming panel uses for its own failed load: the line from `common:states.loadSettingsFailed` under the switch and a `common:actions.retry` button that runs the load again, the remote client's `GET /settings/streaming` for a remote space and `fetchStreamingLimits` for a home one. A remote fetch that fails while home holds a document is not reported: that is the fallback doing its job.

### Discovery approval

Whether a space is in Explore is one predicate, `LISTED_IN_DISCOVERY_SQL` (`utils/discoveryListing.ts`): `s.visibility IN ('public', 'request') AND s.discovery_status = 'approved'`. The Explore endpoint below, the directory document ([directory.md](directory.md) §3, §4) and the admin overview and space list (admin.md) read it; nothing else lists a space.

`spaces.discovery_status` is null until the owner first asks, then one of `DISCOVERY_STATUSES` (`packages/shared/src/platform.ts`):

| Status | Meaning | Listed |
|---|---|---|
| `pending` | Waiting for an admin | no |
| `changes_requested` | An admin asked for changes, with a note the owner reads | no |
| `approved` | An admin approved it | yes, while `public` or `request` |
| `rejected` | An admin refused it, with a note | no |
| `withdrawn` | The owner or an admin took it back, or the space went private | no |

The request is one row per space in `space_discovery_requests`: the category the owner chose, who asked and when, the decision with its note, and `approved_snapshot`, the name, description, icon, banner and category an approval saw. Every step, the owner's, an admin's and the instance's own, is a row in `space_review_events` (process, action, the status it left, the actor, the note), the history the owner and the admins both read.

Only an instance admin (`users.is_admin` on the instance that hosts the space) decides, through `POST /api/admin/spaces/:id/discovery/:decision` (admin.md, "Discovery approval"); no space role, owner group or permission bit can. The decisions (`DISCOVERY_DECISIONS`): `approve` (`pending` or `changes_requested` → `approved`; refused with `409 discovery_requires_listable_visibility` for a private space), `reject` (→ `rejected`, note required), `request_changes` (`pending` → `changes_requested`, note required), `withdraw` (`approved`, `pending` or `changes_requested` → `withdrawn`, note required). A decision on a status it does not apply to, or on a request the owner sent again after the admin's client read it (`requestedAt`), is refused with `409 review_status_conflict`.

Each instance reviews the spaces it hosts. The owner of a space on another instance asks that instance, through their session there, and its admins decide; Inner Space shows each instance's own approved spaces.

**Migration 0041** (`0041_orbit_platform_admin.sql`) moved every space that was `public` or `request` before approvals existed into review: `discovery_status = 'pending'`, a request with category `other` in the owner's name, and a `migrated` event. Visibility and the directory switch were kept. Such a space is hidden until an admin approves it, and its owner can name the category by sending the request again. The migration also set `instance_settings.directory_dirty`, so the pinger tells the hub that the served document shrank ([directory.md](directory.md) §3).

### Verification

`spaces.verification_status` is null until requested, then one of `pending`, `needs_info`, `verified`, `rejected` or `revoked`. Only `verified` gives the space the `verified` badge: `spaceBadgesOf` (`utils/badges.ts`) adds it to the badges an admin granted (`spaces.badges`), and every `Space` on the wire carries the result in `badges`. The request is one row in `space_verification_requests`: the space's name and description when it was sent, the category, a website, up to 5 profile addresses, the reason and the proof. The decisions (`VERIFICATION_DECISIONS`, admin.md, "Verification"): `approve` (`pending` or `needs_info` → `verified`), `reject` (→ `rejected`, note required), `request_info` (`pending` → `needs_info`, note required), `revoke` (`verified` → `revoked`, note required). Verification does not list a space, and a listing does not verify it.

### Owner routes (`routes/spaceReview.ts`)

Only the space's owner, by `spaces.owner_id` on the instance that hosts the space, may ask (`403 space_owner_only` for anyone else; no role, owner group or permission bit stands in for owning). An unknown space is `404 space_not_found`. Every route answers `SpaceReviewState` (`packages/shared/src/platform.ts`): both statuses, both requests and both histories, oldest first.

| Method | Path | Who | Does |
|---|---|---|---|
| `GET` | `/api/spaces/:id/review` | Owner, or an instance admin | Read both reviews |
| `PUT` | `/api/spaces/:id/discovery` | Owner | Ask for a listing, or ask again |
| `DELETE` | `/api/spaces/:id/discovery` | Owner | Withdraw a request, or take a listing off Explore |
| `PUT` | `/api/spaces/:id/verification` | Owner | Ask for verification, or ask again |
| `DELETE` | `/api/spaces/:id/verification` | Owner | Withdraw an open verification request |

- **`PUT /discovery`**, body `{ category }`, one of `SPACE_CATEGORIES` (`400 review_category_invalid`). Refused with `409 discovery_requires_listable_visibility` for a private space and `409 discovery_requires_description` for a space without a description. Accepted from any status, an approved listing included, which then goes back to review: the status becomes `pending`, the request row is replaced (category, requester, time; the decision cleared) and a `submit` event recorded. The listing shows the space's name, description, pictures and member count; the request adds the category.
- **`DELETE /discovery`** from `pending`, `changes_requested` or `approved` (else `409 review_status_conflict`): the status becomes `withdrawn`, event `withdraw`.
- **`PUT /verification`**, body `VerificationRequestBody`: `category`; an optional `website` and up to 5 `profiles` (`400 review_too_many_profiles`), each an `http` or `https` address without credentials of at most 200 characters (`400 review_url_invalid`), stored and never fetched; `reason`, 20 to 1000 characters (`400 review_reason_invalid`); `proof`, 10 to 1000 (`400 review_proof_invalid`). Refused with `409 review_already_verified` while the space is verified. The status becomes `pending` from anything else, a rejection, a revocation or a withdrawal included, and the request row is replaced with the space's current name and description.
- **`DELETE /verification`** from `pending` or `needs_info` (else `409 review_status_conflict`): the status goes back to null, event `withdraw`.
- **Rate limit:** 10 requests per account per hour for the two `PUT` routes together (`createFixedWindowLimit`), `429 rate_limited`, counted only once the request is otherwise valid. The `DELETE` routes are not counted.

### Who hears of a step

`announceReviewStep` (`utils/reviewNotify.ts`) runs after every step: the owner's requests and withdrawals, an admin's decisions, and the edits under "Review after an edit".
- `space_review_updated` `{ spaceId, spaceName, process, action, status, note }` to the owner's sessions
- `review_queue_count` `{ verificationOpen, discoveryOpen }` to the instance's admins, who also get it in their `ready` payload as `reviewQueueCount`
- for a verification step, `space_updated` to the space, so the `verified` badge appears or goes at once
- for a Discovery step of a space with `directory_listed = 1`, `markDirectoryDirty()` ([directory.md](directory.md) §3)

An admin's badge grant that changes a space's badges (`PUT /api/admin/spaces/:id/badges`) also sends `space_updated` to the space.

### The owner's tabs (web)

Space Settings has a Discovery tab for anyone with `MANAGE_SPACE` and a Verification tab for the owner only (`useIsSpaceOwner`: the space's `ownerId` against the user's row id on the instance that hosts it). Both panels read and write through `getApiForOrigin(space._instanceOrigin)`, so a remote space's requests go to its own instance, and reload when `space_review_updated` arrives for the space: the handler bumps `reviewStore.noteUpdate(spaceId)` and shows a toast naming the space and its new status.

- **Discovery tab** (`DiscoveryPanel`): the listing section first (`DiscoveryListingSection`), then visibility (whose hint says that being listed is requested separately and approved by the administrators), the Outer Space block described under "Space Visibility", the description and, for a request space, the pending join requests. For the owner the listing section shows the status with its explanation and the admins' note, when the request was sent, a preview of the Explore card (`ListingPreview`, with the chosen category and the space's badges), what the reviewers look for (public or open to requests, a description, an icon recommended, a name and description that say honestly what it is about, the instance's rules), the category picker, "Request a listing" (or "Send again"), "Withdraw request" (or "Take off Explore" once approved) behind a confirmation, and the history. Sending is enabled only for a public or request space with a description, as the server requires. Anyone else with the tab reads that the owner asks for a listing and the administrators approve it.
- **Verification tab** (`VerificationPanel`): the status with its explanation and the admins' note, "Withdraw request" while it is open, the request form whenever the space is not verified (`canRequestVerification`), seeded from the last request and checked against the same limits as the server, and the history.

### Explore Endpoint

**Endpoint:** `GET /api/spaces/explore` (`explore.ts:exploreRoutes`)
**Auth:** Required
**Query params:** `q` (search), `limit` (1-100, default 50), `offset` (default 0)

**Instance-level gate:** Checks `instance_settings.discoveryEnabled`. If false, returns `{ spaces: [], total: 0, discoveryEnabled: false }`.

**Query:** Raw SQL with LEFT JOINs on `space_members` for the member count and on `space_discovery_requests` for the category. Filters to `LISTED_IN_DISCOVERY_SQL`: public or request, and an approved listing ("Discovery approval"). A space's visibility alone lists nothing. Search matches `name` or `description` (LIKE, case-insensitive). Ordered by `member_count DESC, created_at DESC`.

**Response (`ExploreSpace[]`):**

```typescript
{
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  avatarColor: AvatarColor | null;
  description: string | null;
  visibility: 'public' | 'request';
  memberCount: number;
  createdAt: number;
  joined: boolean;         // true if requesting user is already a member
  badges: SpaceBadgeId[];  // spaceBadgesOf: 'verified' while verified, plus those an admin granted
  category: SpaceCategory | null; // the category the listing's request names
}
```

`badges` and `category` are optional on the `ExploreSpace` type, since a host that predates them sends neither. Also returns `total` (filtered count), `totalAll` (all listed spaces, joined ones included), `discoveryEnabled`.

### Explore Page Sections

One page, one search box, two sections in fixed order. **Inner Space** is the list described here (the unjoined grid, then the collapsible joined group), from `exploreStore.fetchSpaces()`. **Outer Space**, below it, is the space directory: entries from `directoryStore` read through `GET /api/directory`, minus every origin the session is connected to, paginated 50 at a time, rendered only on an instance that browses a directory. The search box drives both through one 300 ms debounce. Both sections render `SpaceCard`, which shows the space's badges beside its name (`BadgeList`, from `badges`; a directory entry carries none); an Outer card's action opens the connect-then-join dialog instead of joining directly. The home view's channel sidebar also has an "Explore" entry that routes to `/explore`. Full description in [directory.md](directory.md) §9.

### Multi-Instance Discovery (`exploreStore.ts`)

`fetchSpaces()` queries home + all connected remote instances in parallel:
1. Takes a sequence number, so a reply for an older query cannot land on a newer one (see below)
2. Waits for `instanceStore._autoConnectDone` to avoid querying with incomplete instance list
3. Asks home + every connected instance in parallel, each call settling into a result tagged with its origin, so a client that did not answer is named rather than counted
4. Deduplicates by `spaceId:origin` key
5. Normalizes remote asset URLs via `resolveAssetUrl`
6. Merges into `TaggedExploreSpace[]` with `_instanceOrigin`, and records `resultsQuery`

**One fan-out at a time wins.** `fetchSpaces` captures a module-level
`fetchSeq` on entry and drops its own result if the counter moved while it
ran, the same guard `directoryStore` runs on Outer Space. A fan-out lasts as
long as its slowest instance, and one search box drives both stores through
one debounce, so without it the Inner list could settle on the previous
query's answer while Outer showed the current one. A superseded run also
leaves `isLoading` alone: the run that superseded it is still going, and its
spinner is not the old one's to take down. `fetchMyRequests` has the same
guard on a counter of its own, for the same reason: it was one call to home
before multi-instance discovery and is now a fan-out too, and the page calls
the two together. `reset()` bumps both counters, so a fan-out still in flight
when the session ends is orphaned rather than landing in the next one: this
store and `directoryStore` are both cleared on sign-out, on account deletion
and when another account signs in, through `authStore.resetUserStores`
([auth.md](auth.md#resetuserstores)).

**`resultsQuery` is the query the spaces on screen answer**, recorded when a
fan-out lands rather than when it is asked for. The empty copy reads it, not
`searchQuery`: the box is live and the fetch is debounced, so deciding from
the box made the copy flip between "no matches" and "nothing yet" about a
list that had not moved.

**A failure is a state, not a sentence.** `error` is
`ExploreFetchFailure | null`: `{ kind: 'none_answered' }` when every client in
the fan-out rejected, and `{ kind: 'failed', cause }` when the fan-out could
not be run at all. The words belong to the surface, so `ExplorePage` renders
the first from `spaces:explore.inner.noneAnswered` and the second through
`describeError(cause)`; the store keeping English text was English on screen
for every reader of the other three languages. `JoinSpace` reads the same
field as a boolean and has copy of its own.

**One instance short is also reported.** `error` covers the fan-out nobody
answered; `unansweredOrigins` covers the rest. It is the list of origins
whose client did not answer the fan-out that produced the current `spaces`
(`''` for home, as `_instanceOrigin` encodes it), written by the same `set`
that publishes the list, cleared when a fetch starts and on `reset()`, and
dropped by a superseded fan-out along with everything else it would have
written. `ExplorePage` renders it above the Inner grid as
`spaces:explore.inner.unreachable`, naming the hosts. The two are exclusive:
the `none_answered` branch publishes no list, so it leaves this empty and the
page never shows both. Before this, one instance of several rejecting was
dropped on the floor and the page showed the survivors' spaces in silence.
`fetchMyRequests` still reports nothing when a client does not answer: it
keeps the rows it has and says nothing about the rest.

### Public Join

**Endpoint:** `POST /api/spaces/:id/public-join`
**Validation:** Space must have `visibility === 'public'`, not banned, not already member. Whether the space is listed is not checked (see "Space Visibility").

**Side effects:** Same as invite join (insert member, WS broadcast, add to connectionManager).
**Response:** Full `SpaceWithChannelsAndMembers` (not just `Space`), so the client can immediately populate the store without a follow-up `GET /api/spaces/:id`. Its roles are shaped for the new member as `GET /api/spaces/:id` shapes them (permissions.md, "Who receives role and override data").

### Join Request Workflow

**Submit request:** `POST /api/spaces/:id/request-join`
- Space must have `visibility === 'request'`
- Rate limited: 5 per minute
- Message: optional, max 500 chars
- Checks for existing pending request (409 if exists)
- Creates `join_requests` row with status `'pending'`
- Sends `join_request_received` WS event to all space managers (owner + `MANAGE_SPACE` holders)

**List requests:** `GET /api/spaces/:id/join-requests?status=pending`
- Permission: owner or `MANAGE_SPACE`
- Status filter: `pending` (default), `accepted`, `declined`
- Returns `{ requests: JoinRequest[] }` with populated user data

**Decide request:** `PATCH /api/spaces/:id/join-requests/:requestId`
- Permission: owner or `MANAGE_SPACE`
- Body: `{ action: 'accept' | 'decline' }`
- Must be pending (400 if already decided)

Accept flow (atomic transaction):
1. Insert `space_members` row
2. Update request status to `'accepted'`, set `decidedBy` and `decidedAt`
3. `connectionManager.addUserSpace`
4. Broadcast `member_joined` to space
5. Build full `SpaceWithChannelsAndMembers` for accepted user, roles shaped for them as in `GET /api/spaces/:id`
6. Send `join_request_accepted` WS event to requesting user (includes full space data)

Decline flow:
1. Update request status to `'declined'`
2. Send `join_request_declined` WS event to requesting user

**User's own requests:** `GET /api/users/@me/join-requests?status=<optional>`
- Returns all requests for the current user, optionally filtered by status
- Client side, `exploreStore.fetchMyRequests()` asks the home instance and every connected instance (`Promise.allSettled`) and tags each request with `_instanceOrigin` (`''` for home); `useSpaceJoin.isPending` matches on `(origin, spaceId)`, since space ids are local to their instance

### Space Managers Resolution (`explore.ts:getSpaceManagers`)

Used to target `join_request_received` events. Iterates all space members and returns IDs where:
- `userId === space.ownerId`, OR
- `hasPermission(userId, spaceId, PermissionBits.MANAGE_SPACE)` returns true

---

## Welcome and rules

What a space says to someone new: a few words, its rules, and up to five channels to start in (`shared/src/welcome.ts`, `routes/welcome.ts`, `WelcomePanel`, `SpaceWelcomeGate`). Whoever may manage the space sets them under the settings tab "Welcome and rules".

**Rules can be made a condition.** With "Members must agree" on, `spaces.rules_required_since` holds the moment it came on. A member who joined after that moment, has not agreed (`space_members.rules_accepted_at`) and cannot manage the space can read, but `memberActionRefusal` refuses everything else with `rules_not_accepted`: writing, reacting, voting, pinning, threads, pokes and voice ([permissions.md](permissions.md)). A timeout is named first, because it says when it ends.

- Those already there are not asked: rules that arrive later lock nobody out.
- Saving again does not move the moment. Turning it off frees everyone, and turning it on again asks only those who join after that.
- Someone who leaves and comes back agrees again, since the row is new.
- The owner and anyone with MANAGE_SPACE are never held to it.
- The server is what holds people to it. The client only says so: `SpaceWelcomeGate` opens the welcome on a space's first visit and at each visit while an answer is owed (until put off for the session), and the composer shows the way to the rules in place of the input. A refused action that arrives first opens it too.

A reader sees only the channels they can see. Whether they have seen the welcome is kept in the browser (`tavvit:welcome-seen:…`), so a new device shows it once more. Changing it is in the audit log (`welcome_update`), and `space_welcome_changed` tells the space to fetch it again.

## Membership

### Join

Three join paths:
1. **Invite code**: `POST /api/spaces/:id/join` or `POST /api/spaces/join` (`private` and `public` spaces; a code to a `request` space leads to path 3)
2. **Public join** — `POST /api/spaces/:id/public-join` (visibility=public)
3. **Request accept** — `PATCH /api/spaces/:id/join-requests/:requestId` with `action: 'accept'`

All paths: insert `space_members`, register in `connectionManager`, broadcast `member_joined`.

### Leave / Kick

**Endpoint:** `DELETE /api/spaces/:id/members/:uid`

| Scenario | Condition | Permission |
|----------|-----------|------------|
| Self-leave | `uid === request.userId` | Any member (unless owner) |
| Kick | `uid !== request.userId` | `KICK_MEMBERS` |

**Owner restriction:** Owner cannot leave. Must transfer ownership or delete the space.
**Owner protection:** Cannot kick the owner.

**Role hierarchy:** kicking someone else needs a higher top role than theirs (`403 role_hierarchy`, permissions.md).

**Cleanup on removal:**
1. Keep a running timeout in `space_departed_timeouts`, so joining again does not lift it (see "Moderation", "Timeouts")
2. Delete `space_members` row
3. Delete `voice_restrictions` for the member in this space
4. Delete `read_states` for the member in all space channels
5. Broadcast `member_left` WS event

A kick (not a leave) is recorded in the audit log as `member_kick`.

### Ban

**Endpoint:** `POST /api/spaces/:id/bans`
**Permission:** `BAN_MEMBERS`
**Body:** `{ userId: string, reason?: string }`

**Protections:** Cannot ban owner, cannot ban self, 409 if already banned, `403 role_hierarchy` unless the actor outranks the target.

**Atomic transaction:**
1. Insert `bans` row (with `reason`, `bannedBy`, `createdAt`)
2. Delete `space_members`
3. Delete `member_roles`
4. Delete `read_states` for all space channels
5. Delete `voice_restrictions`

**WS events:**
- `member_left` to space (so other members update their list)
- `member_banned` to the banned user (with `reason`)

**List bans:** `GET /api/spaces/:id/bans` — requires `BAN_MEMBERS`. Returns ban records with both banned user and moderator user objects.

**Unban:** `DELETE /api/spaces/:id/bans/:uid` — requires `BAN_MEMBERS`. 404 if no ban found.

### Ownership Transfer

**Endpoint:** `PATCH /api/spaces/:id/transfer-ownership`
**Permission:** Owner only
**Body:** `{ newOwnerId: string }`
**Validation:** New owner must be a member, cannot transfer to self.

Updates `spaces.ownerId` and clears `spaces.ownerTitle` in the same write (the title was the former owner's), and in the same transaction the new owner's `space_members.timed_out_until` (the owner is never timed out), records `ownership_transfer` in the audit log, broadcasts `space_updated` WS event, then `space_access_changed` to the space with the former and the new owner as the members whose own permissions changed (each also gets a `space_voice_state`; websocket.md). Their clients refetch the detail, so the new owner gets the role bits and the former owner loses them unless a role still grants `MANAGE_ROLES` (permissions.md, "Who receives role and override data"). Voice permissions are re-checked.

**Client (`TransferOwnershipModal`):** Member picker with search, two-step confirm. Shows warning "You will become a regular member." Uses toast notification on success.

### Member Role Management and Nicknames

**Set roles (replace) and nickname:** `PATCH /api/spaces/:id/members/:uid`
- Body: `{ roleIds?: string[]; nickname?: string | null }`, at least one of them
- Every field is checked before anything is written; both are written in one transaction
- `roleIds` needs `MANAGE_ROLES` and follows the rules below
- `nickname` is the member's name in this space (`space_members.nickname`), separate from the account name and from their nickname in any other space. Anyone may set their own; another member's needs `MANAGE_SPACE`, never the owner's, and a higher rank (`403 role_hierarchy`). `normalizeMemberNickname` decides the stored form: null or blank clears it, otherwise trimmed, at most 32 UTF-16 code units, no control characters, line or paragraph separators or bidirectional controls, at least one visible character (`400 member_nickname_invalid`)
- Followed by `member_updated` to the space (websocket.md)

Rules for `roleIds`:
- Cannot change own roles, except the owner (see "Ownership and roles" below)
- Cannot modify owner's roles (unless you are the owner)
- @everyone role (id=spaceId) cannot be assigned
- Role hierarchy: the member must rank below the actor, and every role added or removed must sit below the actor's top role (`403 role_hierarchy`, permissions.md)
- Atomically deletes all existing `member_roles` then inserts new ones
- Answers the member with their roles (display fields only)
- Followed by `space_access_changed` to the space, and a `space_voice_state` to the member (websocket.md); their client refetches the space's detail, which carries role bits only once they hold `MANAGE_ROLES`
- Triggers `checkVoicePermissions(spaceId)` to enforce voice changes

**Add single role:** `POST /api/spaces/:id/members/:uid/roles` — body `{ roleId }`, requires `MANAGE_ROLES`

**Remove single role:** `DELETE /api/spaces/:id/members/:uid/roles/:roleId` — requires `MANAGE_ROLES`

Both single-role routes apply the same checks as the replace route (not own roles unless the owner's, not the owner's, member of the space, role of this space other than @everyone, role hierarchy) and are followed by `space_access_changed` in the same way.

**Where a nickname shows.** `spaceMemberName` in `web/src/utils/identity.ts` names a member inside a space: the nickname from the space's roster row, else the display name. The member lists (desktop and phone), a space message's author and reply line, mentions, the mention picker (which also matches on it), the typing line and the poke row (both people; websocket.md, "Channel pokes") use it. DMs, friends and the profile's name and username show the account; the profile card adds a "Nickname in this space" line above the name.

**Owner title.** The owner may replace the owner group's heading in the member list ("Owner") with a title of their own (`spaces.ownerTitle`), visible to every member. It is a heading, not a name: the owner's row under it, their messages, mentions, the typing line and the profile card name them by `spaceMemberName` like anyone else, and the settings Members panel keeps its "Owner" marker. `ownerGroupTitle` in `web/src/utils/memberGroups.ts` reads it for every surface that shows the heading, and `OwnerTitleHeading` renders it on the desktop member list and the phone members screen; a custom title keeps its own capitalization, the default stays uppercase like the other group headings. The heading shows only while the owner is online, because offline members are listed together under Offline. The owner gets a pencil beside it (a 44px tap target on the phone) that opens a dialog laid out like the nickname dialog: Save, Cancel, and Reset while a title is set. The dialog checks the value with `normalizeOwnerTitle` before sending, writes through `spaceStore.updateSpace` to the space's own instance, and changes the heading only from that instance's answer; other members get it through `space_updated`. Server rules: `PATCH /api/spaces/:id` above and api.md. Version mix: a client up to 1.10.0 ignores the field and shows "Owner"; on a space hosted by an instance up to 1.10.0 the field is absent, the heading stays "Owner" and the pencil is not offered (`hostKeepsOwnerTitle`), because that instance would answer 200 and drop the title. No federation event carries the title; each instance serves it for the spaces it hosts.

**Member list right-click menu** (`layout/memberMenu/`, desktop member list). A right click, the menu key or Shift+F10 on a member row opens it; a left click, Enter or Space opens the profile. Items: View profile; Send message and the friend action that fits (add, cancel, accept or decline, remove), both through the origin-aware helpers (`openDirectMessage`, `friendRequestTarget`); Change space nickname; Edit space profile on one's own row (see "Space profiles" below); a Roles submenu of checkboxes; Kick and Ban, each after a confirmation. Which items show follows permissions.md, "Client gating". Writes go to the space's own instance (`getApiForOrigin(space._instanceOrigin)`) with the member's id there. A role checkbox changes only after the server accepts the write, and is disabled while one is in flight. The menu closes when the space changes. On a space hosted by a 1.9.x instance the nickname item is offered but the instance refuses the request, and the dialog shows its reason.

### Ownership and roles

Owning a space is `spaces.owner_id` and nothing else. The owner holds every bit wherever the space's permissions are resolved (permissions.md, "Step 1: Owner/Admin Check"), so no role, override or role edit can lock them out, and no role makes anyone an owner: a role named "Owner" is a role like any other, and `owner_id` changes only through the ownership transfer above. The owner's crown (member list, profile card, settings Members panel) is derived from `owner_id`, never from a role.

- **The owner's own roles.** The owner may give themselves roles and take them away (`PATCH /api/spaces/:id/members/:uid`, the single-role routes, the member menu's Roles submenu, the role editor's member list), to show a role's colour and icon like anyone else. Their rights stay the owner's whatever the roles say. Everyone else still cannot change their own roles (`403 cannot_change_own_roles`) or the owner's (`403 space_owner_only`). `viewerCanEditMemberRoles` (web/src/utils/roleHierarchy.ts) offers the owner their own row.
- **Owner group (`spaces.owner_group`).** On (1), the member list keeps its owner group at the top under the owner title. Off (0), the owner is listed under their own highest hoisted role like any member, with a crown after their name titled with the owner title (or "Owner"). Only the owner switches it: Space Settings, Overview, Ownership, which sends `PATCH /api/spaces/:id { ownerGroup: boolean }` (`403 space_owner_only` for anyone else, `400 validation_failed` for another type). Migration 0040 turns it on for spaces whose owner had named the owner group and leaves it off for the rest. `ownerHasOwnGroup` (web/src/utils/memberGroups.ts) reads a missing value, from a host that predates the field, as on.

### Space profiles

A member may set a picture, a banner and an about text for one space (`space_members.avatar`, `banner`, `bio`). In that space they stand in for the account's: in the member lists, on the author of the member's messages and reply lines, and on the profile card and full profile opened from the space. A field left empty shows the account's. Nothing of it is read in another space, a DM or the friends list.

**Endpoint:** `PATCH /api/spaces/:id/members/@me/profile`, for the member themselves (`404 not_space_member` for anyone without a membership). Body `{ avatar?, banner?, bio? }`; an absent field is left as it is, `null` (or `''`) shows the account's again.
- An image must be a file the member uploaded to this instance that no message holds (an `attachments` row with their `uploader_id` and neither `message_id` nor `dm_message_id`), or the image the field already shows; anything else, another site's address included, is `400 avatar_url_invalid` / `banner_url_invalid`. A new image becomes the member row's: its attachment row is removed and the file is fitted like an account picture (`resizeProfileImage`). A replaced file is deleted once no account, space profile or space shows it.
- `bio` is trimmed and at most 190 characters (`400 bio_too_long`, `details.max`).
- An empty body is `400 no_fields_to_update`. The answer is the member with their roles, and `member_updated` goes to the space (websocket.md).

**Client.** "Edit space profile" in the member menu on one's own row, in the channel list's context menu and on one's own profile card opens `SpaceProfileModal`: the banner, the picture (cropped like the account's and uploaded to the space's own instance, `transferStore.startUpload({ origin })`) and the about text, each with a "Use account ..." action that clears it. The modal edits the space whose member list is loaded. `useSpaceProfile` (web/src/hooks/useProfileMember.ts) resolves the stored file names against the space's instance for the profile surfaces; the member lists and messages resolve `member.avatar` the same way (`resolveAssetUrl`). `applySpaceMemberUpdate` copies the three fields from a member row that carries them.

**Pictures.** The files are the member row's: the storage janitor counts them like account pictures (uploads.md, "Profile pictures"), a replaced one is deleted once nothing else shows it, and leaving the space ends the space profile with the membership.

**Federation.** A space profile lives on the instance that hosts the space, like the membership: a member from another instance sets it there with their replicated id. No relay event carries it.

---

## Invite links

Every link is a row of `space_invites` (`utils/spaceInvites.ts`). `spaces.invite_code` names the **standing** one, which the Invite dialog hands out (`POST /spaces/:id/invite`). The Invites tab of a space's settings lists them all, with how much each was used, and makes new ones with an end date or a limit.

- **Reading a code goes through `usableInvite`:** the preview, both join routes and a space invite sent in a DM. A link that expired, ran out or was revoked answers exactly like one that never existed.
- **A place on a limited link is taken in one statement** (`consumeInvite`), so the last place goes to one person. Someone refused (banned, already a member, a request space) does not use one up.
- **Revoking deletes the row**, and for the standing link clears `spaces.invite_code` too. The next `POST /spaces/:id/invite` makes a new one. People who came in with the link stay.
- **A space from before the table, or one made by a path that only sets the column** (the Discord import, a new space), gets its row the first time the code is read.
- **Who may do what:** CREATE_INVITE makes a link. MANAGE_SPACE lists and revokes. A space holds at most 50 live links.
- **The code is not on the wire.** `spaceToWire` sends `inviteCode: null`, because it goes to every member and a link is for those who may hand it out.

## Own invite address

`spaces.vanity_code`: a link in words, `/join/night-shift`, in place of a random code. `PUT /api/spaces/:id/vanity` with `{ code }` takes MANAGE_SPACE, and `null` gives it up. The Invites tab shows it above the links, and the Invite dialog hands it out instead of the standing link once there is one.

- **The shape** is in `shared/src/vanityInvites.ts`: 3 to 32 small letters, digits or hyphens, with a letter or digit at each end. It is stored in small letters, and `usableInvite` tries small letters as well, so a capital typed in a link still works.
- **Names nobody may take:** `RESERVED_VANITY_CODES`, which would pass for the operator, the product or a part of the site, and `blocked_vanity_codes`, the ones an administrator took away.
- **It is a row of `space_invites`** with no expiry and no limit, so preview, both join routes, the visibility of the space, bans and `inviteCardFor` work as for any link. `listInvites` leaves it out of the list and `revokeInvite` refuses it, since it has its own place. `spaces.invite_code` is untouched: it is another link. A name already held by a link is `vanity_code_taken`.
- **It is on the wire** (`spaceToWire`, `Space.vanityCode`), unlike the standing code: it is public, as an address in words is meant to be.
- **Changing it** frees the old name at once. **An administrator can take it away** (`POST /api/admin/spaces/:id/vanity/revoke`, [admin.md](admin.md)): the owner gets a notice with the reason, and the name stays blocked for good.
- **Both ends are in an audit log:** `vanity_update` in the space's, `space_vanity_revoke` in the platform's.
- **The invite rule of a space** (`shared/src/moderation.ts`) counts `/join/<name>` as an invite when that name is an address on this instance (`isOwnAddress`), its own too. An address on another instance cannot be told from a page of that name: there, only `/join/` plus exactly 8 characters counts.

## Removing someone

The dialog (`MemberRemovalDialog`) asks for an optional reason, kept in the audit log and, for a ban, in the Bans tab. The person is not told. A ban can also take their recent messages with it, from the last hour, day or week: at most 5000, newest first, with their attachments, announced per channel as `messages_deleted` and recorded as `messages_bulk_delete`. It needs BAN_MEMBERS, not MANAGE_MESSAGES: it is part of the ban.

Since 1.32.7 a removed member (left, kicked, banned), and every member of a deleted space, is taken out of the space's socket audience at once (`removeUserSpace`) and out of its voice, LiveKit included; their own picture and banner for the space are deleted (`releaseMemberPictures`).

## Settings tabs

What a person sees follows what they may do, and a tab they may not use is not shown. One function decides it for every surface, `allowedSpaceSettingsTabs` in `spaceSettingsPanels/spaceSettingsTabs.ts`: each tab with the bit its routes check, read from the viewer's space-wide permissions on the instance that hosts the space (`spacePermissions`). The same module holds the order of the navigation (`SPACE_SETTINGS_NAV`).

| Tab | Shown to |
|---|---|
| Your settings | everyone: notifications, their profile here, and Leave (not for the owner) |
| Overview, Welcome and rules, Access, Invites, Discovery, Moderation | MANAGE_SPACE |
| Emoji and stickers | MANAGE_EMOJIS |
| Soundboard | MANAGE_SOUNDS |
| Get from Discord | MANAGE_ROLES with MANAGE_CHANNELS (the template), or MANAGE_EMOJIS (the emoji and stickers) |
| Verification | the owner |
| Members | MANAGE_ROLES, KICK_MEMBERS or BAN_MEMBERS |
| Roles | MANAGE_ROLES |
| Bans | BAN_MEMBERS |
| Audit log | VIEW_AUDIT_LOG |

Access holds the visibility and, with its count beside the tab, the join requests. The server checks every one of these again; the tabs only spare people what they cannot use. The panels load on demand from `lazySettingsPanels.tsx`, the Soundboard and Welcome panels too since 1.34.0.

**The way in.** On the desktop the space's name at the head of its channel column opens the settings for everyone. On the phone the settings button in the space's bar (`MobileSpaceBar` in `layout/MobileSpacesScreen.tsx`) shows when `mayManageSpaceSettings` holds: some tab beyond Your settings is open to the viewer. Before 1.34.0 it needed MANAGE_SPACE, so a member who may manage only the emoji, the clips or the roles had no way in on the phone.

**Emoji and stickers** (`EmojiStickersPanel`; routes and limits in [emoji.md](emoji.md)) lists the space's emoji and its stickers, each list with its count against the limit the space's instance answers (`max`). Several pictures can be picked at once. They are added one after another, each under a free name made from its file name (`name_2` for an emoji, `name (2)` for a sticker, `freeExpressionName`), and a run stops at the first refusal that would refuse the next file the same way (the rate limit, storage, the space full, the right gone), listing what was not added and why. Names are changed in place. So is a sticker's description, what a screen reader says for it, which may be left empty. Removing asks first. A search field appears once there are 24 or more. While the space has no emoji and no stickers, the tab offers "Get from Discord" to whoever may open that tab. Every request goes to the space's own instance (`getApiForOrigin`).

**Get from Discord** (`DiscordMovePanel`) holds the move from a Discord server in one place, each part shown to whoever holds what its routes check:
- "Channels, roles and permissions" opens the template import ("Importing a Discord template"), with MANAGE_ROLES and MANAGE_CHANNELS. Before 1.34.0 this entry was in Overview.
- "Emoji and stickers" is the import with a bot of one's own ("Importing emoji and stickers from Discord"), with MANAGE_EMOJIS.
- "Tell your Discord server" is the announcement ("Telling the Discord server"), when the space has its own invite address or the viewer holds CREATE_INVITE.
- A last line says that messages and members stay on Discord.

---

## Role Management

### Create Role

**Endpoint:** `POST /api/spaces/:id/roles`
**Permission:** `MANAGE_ROLES`
**Body:** `{ name: string, color?, colorSecondary?, description?, icon?, hoist?, mentionable?, permissions? }`

- Name defaults to `'new role'` if empty
- Duplicate name check (case-insensitive, raw SQL COLLATE NOCASE)
- Permissions default to `DEFAULT_EVERYONE_PERMISSIONS` limited to the bits the actor holds; given permissions must all be held (`403 cannot_grant_unowned_permissions`, permissions.md "Held-bits rule")
- Created at the bottom: position 1, the other roles move up one (`normalizeRolePositions`); refused with `403 role_hierarchy` unless the actor ranks above 1
- Color defaults to `'#b9bbbe'`
- After creation: `space_access_changed` to the space, checks voice permissions
- Answers the role, with `permissions` (the actor holds `MANAGE_ROLES`)

**Display fields** (create and update; permissions.md, "Role display"), checked by `parseRoleDisplayFields` (server/src/utils/roleFields.ts):
- `colorSecondary`: a `#rrggbb` hex or null; with it, names in the role's colours are a gradient from `color` to it (`400 role_color_invalid`)
- `description`: at most `ROLE_LIMITS.MAX_DESCRIPTION_LENGTH` (200) characters, null or blank clears it (`400 role_description_too_long`)
- `icon`: one emoji, a flag or a short sequence of them, at most 16 UTF-16 code units, no letters or spaces; null or blank clears it (`400 role_icon_invalid`)
- `hoist` (default true): members whose top shown role this is get their own group in the member list
- `mentionable` (default false): anyone may mention the role, without MENTION_EVERYONE (permissions.md, "Mass mentions")
- `hoist` and `mentionable` are booleans (`400 validation_failed`) and are refused on @everyone. Every changed field is recorded in the audit log's `role_update` entry.

### Update Role

**Endpoint:** `PATCH /api/spaces/:id/roles/:roleId`
**Permission:** `MANAGE_ROLES`
**Body:** `{ name?, color?, colorSecondary?, description?, icon?, hoist?, mentionable?, position?, permissions? }` (the display fields as under Create Role)

- Name: trimmed, non-empty, duplicate check (case-insensitive, excludes self)
- Permissions: a non-negative integer string (`400 permissions_invalid`); only bits the actor holds may be switched (`403 cannot_grant_unowned_permissions` on, `403 cannot_change_unowned_permissions` off; permissions.md "Held-bits rule")
- `404 role_not_in_space` for a role of another space; `403 role_hierarchy` for a role at or above the actor's top role
- Position: an integer from 1 (not for @everyone, `400 validation_failed`) below the actor's top role; the role moves there and the others are renumbered so positions stay distinct
- Client: the role list in Space Settings > Roles sends `{ position }` alone to reorder (drag handle, arrow keys, up and down buttons; permissions.md, "Setting the order")
- After update: `space_access_changed` to the space, checks voice permissions
- Answers the role, with `permissions` only while the actor still holds `MANAGE_ROLES` after the change

### Delete Role

**Endpoint:** `DELETE /api/spaces/:id/roles/:roleId`
**Permission:** `MANAGE_ROLES`

- Cannot delete @everyone role (roleId === spaceId)
- `404 role_not_in_space` for a role of another space; `403 role_hierarchy` for a role at or above the actor's top role; `403 cannot_change_unowned_permissions` for a role carrying a bit the actor does not hold (permissions.md "Held-bits rule")
- Deletes channel and category overrides referencing this role, then renumbers the remaining roles
- After delete: `space_access_changed` to the space, checks voice permissions

---

## Channel Management

### Channel Types

| Type | Semantics |
|------|-----------|
| `text` | Message-based channel with read states, embeds, reactions |
| `voice` | Voice/video channel (LiveKit integration, see voice.md) |
| `announcement` | Holds what a text channel holds; other spaces of the instance can follow it (forums.md) |
| `forum` | Posts, each a thread, with tags (forums.md) |
| `thread` | A thread of a text, announcement or forum channel; no listing names it (threads.md) |

### Create Channel

**Endpoint:** `POST /api/spaces/:id/channels`
**Permission:** `MANAGE_CHANNELS`

| Field | Validation |
|-------|------------|
| name | Required, a string; stored as `normalizeChannelName(name)` from `@backspace/shared` (trimmed, lowercased, each whitespace run → one hyphen), 1-100 chars |
| type | Required, `'text'` or `'voice'` |
| topic | Optional, a string; stored as `normalizeChannelTopic(topic)` from `@backspace/shared` (line endings unified to `\n`, trimmed, blank → `null`), at most `CHANNEL_TOPIC_MAX_LENGTH` (1024) UTF-16 code units after normalization. A non-string answers `400 channel_topic_invalid`; a longer topic answers `400 channel_topic_length` with `{ max }` and is never cut |
| categoryId | Optional, validated against space's categories |

Position: `max(existing positions) + 1`.

**Response (201):** the created channel including the creator's computed `myPermissions` and `isPrivate: false` — same shape as the `channel_created` event payload — so the creating client can render it immediately without waiting for the broadcast to round-trip.

**Broadcast:** `channel_created` sent per-user (only to users with VIEW_CHANNEL on the new channel). Each user's event includes their computed `myPermissions`.

**Client reconciliation:** both the create response and the `channel_created` event are applied through the `upsertChannel` store action (see client-federation.md, "Channel index and lookup maps").

### Update Channel

**Endpoint:** `PATCH /api/channels/:id`
**Permission:** `MANAGE_CHANNELS` (checked with channel-level override context)
**Body:** `{ name?, topic?, position?, categoryId?, slowmodeSeconds?, icon? }`

- Name: same normalization as create; a non-string answers `channel_name_required`
- Topic: same normalization and limit as create (`checkChannelTopic` in `utils/channelTopic.ts` serves both routes); `null` or a value that trims to nothing clears it
- Position: non-negative number
- categoryId: `null` to unassign, or valid category ID in same space
- slowmodeSeconds: one of `SLOWMODE_SECONDS` (0 switches slow mode off), else `400 slowmode_invalid`; see "Moderation", "Slow mode"
- icon: see "Channel icons" below

**Broadcast behavior:**
- If `categoryId` changed: calls `broadcastOverrideChange` (per-user VIEW_CHANNEL recheck, may send `channel_deleted` to users who lost access, and `space_voice_state` to viewers of a voice channel; see "Channel/Category Permission Overrides" below), and `checkVoicePermissions` for a voice channel
- Otherwise: simple `channel_updated` broadcast to channel viewers

**Client:** the Overview tab of channel settings renames through the `updateChannel` store action, which sends the request to the space's own instance and applies the returned row, so the editor shows the stored (normalized) name at once. The editor is the shared `InlineNameEditor` (`components/ui/`): Save or Enter commits, Cancel or Escape abandons, blur does nothing, and Escape never reaches the settings modal's own close handler. It compares edits with `normalizeChannelName` and sends nothing when the stored name would not change. The control shows when the user holds `MANAGE_CHANNELS` on that channel (see "Client gating" in permissions.md).

The same Overview edits a text channel's topic with `ChannelTopicEditor` (`components/modals/`), also through `updateChannel`. The field always holds the stored topic; Save and Discard Changes appear only while `normalizeChannelTopic(draft)` differs from it, Ctrl/Cmd+Enter saves, and Escape with unsaved changes discards them without closing the modal. Its counter measures the normalized draft against `CHANNEL_TOPIC_MAX_LENGTH`, so it agrees with the server; a topic stored before the limit existed is shown whole and can be saved once it is short enough. Without `MANAGE_CHANNELS` the topic is read-only text. Voice channels get no topic field, as in the create dialog.

**Channel header topic:** `ChannelHeaderTopic` (`components/layout/`) shows the topic on one line with an ellipsis. The full text is always reachable: the native tooltip shows it on hover, and the line is a button that opens it in a `Modal` (titled `#name`, line breaks kept), which also covers keyboard and touch.

### Channel icons

A channel can have an icon of its own in place of its type's, so a space can give its channels a feel of their own. `channels.icon` (migration `0068_tavvit_channel_icons`), null for the type's icon.

- **What it can be:** one of the icons roles have (`glyph:<id>`, `ROLE_GLYPH_GROUPS` in `shared/src/roleGlyphs.ts`) or one standard emoji. `normalizeChannelIcon` (`shared/src/channelIcons.ts`) applies a role icon's rule (`isRoleIcon`: no letters, no spaces, nothing hidden, at most `ROLE_LIMITS.MAX_ICON_LENGTH` units) and then asks for one character as a reader sees it (`Intl.Segmenter`, graphemes): a flag, a skin tone or a family is one, two emoji side by side are refused, since a row has room for one. A space's own emoji are refused too: they are pictures of one instance.
- **Who:** `PATCH /api/channels/:id` with `icon`, so `MANAGE_CHANNELS` with the channel's overrides. Null or a blank string goes back to the type's icon; anything else answers `400 channel_icon_invalid`. The route refuses threads, and it is not open to bots. The change is part of the `channel_update` entry of the audit log (`auditedChannelFields`), which names an icon of the set by its name.
- **On the wire:** every channel the server sends has `icon` (`channelToWire`), null without one. A channel lives on its space's instance and every member's client asks that instance (`getApiForOrigin`), so there is nothing to relay.
- **Where it shows:** `ChannelIcon` (`components/ui/`) everywhere a channel stands with an icon: the sidebar's rows (`VoiceChannel` for voice), the channel header and a voice channel's, the welcome at the top of a channel, the phone's channel list, the quick switcher and the forward dialog (`SwitcherItem.channel`), the inbox and Home (`spaceChannelIndex` keeps `icon`), the events page, the voice "Move to" menu and picture-in-picture. A voice channel the user cannot join keeps its lock. An icon of the set takes the colour of the text and dims with a quiet row; an emoji keeps its colours, is never swapped for a drawing of the set (a role's is), and sits in a box of the icon's size, so the names beside it line up. `#name` written in text (a mention, the composer's placeholder) stays a hash: that is how a channel's name is written, not its icon.
- **Choosing it:** `ChannelIconPicker` (`components/modals/`) in the Overview of channel settings, for whoever holds `MANAGE_CHANNELS` there, never for a thread: the icons first, then the emoji (the emoji picker without a space's emoji or stickers), and "Use the type icon". Each choice is saved at once through `updateChannel`.

### Delete Channel

**Endpoint:** `DELETE /api/channels/:id`
**Permission:** `MANAGE_CHANNELS` (checked with channel-level override context)

**Cleanup sequence:**
1. Disconnect all voice participants (if voice channel)
2. Collect viewer IDs before deletion (for targeted broadcast)
3. Collect attachment filenames before cascade
4. Delete `read_states` (no FK)
5. Delete `messages` (attachments cascade)
6. Delete `channels` row
7. Delete attachment files from disk
8. Broadcast `channel_deleted` only to users who could see the channel

### Category Management

**Create:** `POST /api/spaces/:id/categories` — permission: `MANAGE_CHANNELS`, name 1-100 chars, auto-position. Broadcasts `category_created`.

**Update:** `PATCH /api/categories/:id` — permission: `MANAGE_CHANNELS`, updatable: name (a string, stored as `normalizeCategoryName(name)`, which trims and keeps case and spacing, 1-100 chars; a non-string answers `category_name_required`), position. Broadcasts `category_updated` (includes `isPrivate` flag). The category settings Overview renames through the `updateCategory` store action with the same `InlineNameEditor` as channels.

**Delete:** `DELETE /api/categories/:id` — permission: `MANAGE_CHANNELS`. Transaction nulls `categoryId` on child channels, then deletes category. Broadcasts `category_deleted` then `channel_layout_updated` (per-user filtered). The child channels lose the category's overrides, so they count as moved for `broadcastChannelLayout` (below), and `checkVoicePermissions` runs when one of them is a voice channel.

### Channel Layout Reorder

**Endpoint:** `PATCH /api/spaces/:id/channel-layout`
**Permission:** `MANAGE_CHANNELS`

**Body:**
```typescript
{
  channels: Array<{ id: string; position: number; categoryId: string | null }>;
  categories: Array<{ id: string; position: number }>;
}
```

**Validation:**
- All channel IDs must belong to the space
- All category IDs must belong to the space
- All positions must be non-negative numbers
- Channel categoryId references must point to valid space categories

Applied atomically in a transaction. Broadcasts via `broadcastChannelLayout(spaceId, movedChannelIds)` which sends `channel_layout_updated` per-user (each user sees only channels they have VIEW_CHANNEL on). A channel whose `categoryId` changed takes the overrides of its new category, so who can see it may change: a member who can see a moved voice channel is then also sent `space_voice_state` (`pushSpaceVoiceState`), since the layout carries no voice presence, and `checkVoicePermissions` runs when a voice channel moved. A layout that only reorders sends neither.

### Channel/Category Permission Overrides

OUT OF SCOPE for this document. See [permissions.md](permissions.md) for the three-tier override system (category overrides, channel overrides, member overrides) and the `computePermissions` algorithm.

Override endpoints documented here for API completeness:

| Endpoint | Permission | Notes |
|----------|------------|-------|
| `GET /api/channels/:id/overrides` | `MANAGE_ROLES` | List channel overrides |
| `PUT /api/channels/:id/overrides` | `MANAGE_ROLES` | Upsert (delete+insert in tx). Role hierarchy on the target, held-bits rule against the stored row. |
| `DELETE /api/channels/:id/overrides/:targetType/:targetId` | `MANAGE_ROLES` | Remove override; refused for a target at or above the actor, or when it sets a bit the actor does not hold |
| `GET /api/categories/:id/overrides` | `MANAGE_ROLES` | List category overrides |
| `PUT /api/categories/:id/overrides` | `MANAGE_ROLES` | Upsert; role hierarchy on the target, held-bits rule against the stored row |
| `DELETE /api/categories/:id/overrides/:targetType/:targetId` | `MANAGE_ROLES` | Remove override; refused for a target at or above the actor, or when it sets a bit the actor does not hold |

All override mutations call `broadcastOverrideChange` (channel) or `broadcastCategoryOverrideChange` (category, every channel in it). Both go through `broadcastChannelVisibility(spaceId, channelIds)`, which re-evaluates VIEW_CHANNEL per-user and sends `channel_updated` (can see it, with `isPrivate` and their `myPermissions`) or `channel_deleted` (cannot). A member who can see a voice channel among them is then sent `space_voice_state` once (`ConnectionManager.pushSpaceVoiceState`), as after a role change: `channel_updated` carries no voice presence, so a voice channel an override just showed them would otherwise appear empty until the space is loaded again. Voice permission enforcement via `checkVoicePermissions` runs after every override change.

### Drag-and-Drop (`useDragManager.ts`)

Client-side hook managing three drag types:

| Type | Draggable | Drop target | Permission |
|------|-----------|-------------|------------|
| `channel` | Channel items | Before/after channels or categories | `MANAGE_CHANNELS` (`canManage`) |
| `category` | Category headers | Before/after channels or categories | `MANAGE_CHANNELS` (`canManage`) |
| `voiceUser` | Voice participant | Different voice channel | `MOVE_MEMBERS` (`canMoveMembers`) |

**Drop position normalization:** "before B" is normalized to "after A" (the preceding item in `orderedItems`) to prevent double drop-indicator rendering.

**Auto-scroll:** When dragging near top/bottom edges (40px), scrolls the sidebar container proportionally to edge distance.

**Self-drop guard:** Dropping on the same item is a no-op.

## Importing a Discord template

A Discord server template (a `discord.new/CODE` or `discord.com/template/CODE` link) holds a server's structure: its roles with their permissions, colours and order, its categories and channels with their order, topics, slow mode and permission overwrites. Tavvit can start a new space from one or add one to a space someone manages. A template is not a backup: messages, members, bots, webhooks, emoji, stickers, the server icon, events, threads and integrations are never in it, and the import says so before anything is written. The server's emoji and stickers can follow with a bot of one's own (next section).

**Where it starts.** Create Space, "Import from Discord", for a new space; Space Settings, "Get from Discord", "Import template" for an existing one (shown with `MANAGE_ROLES` and `MANAGE_CHANNELS`; in Overview before 1.34.0, see "Settings tabs"). Both open `DiscordImportModal` (web): the template as a link, a code or a `.json` file, a preview of exactly what will be made, the import, and a report.

**Fetching.** The server alone fetches a template, and only from one address: `https://discord.com/api/v10/guilds/templates/{code}` (`utils/discordTemplateFetch.ts`), Discord's public template endpoint, which needs no account. The code is checked first (`parseDiscordTemplateCode`: letters, digits, `_` and `-`, 2 to 64 characters; `400 discord_template_code_invalid`), so the request cannot reach another host or path. Redirects are refused, the request times out after 10 seconds, the body is read up to 2 MB, and answers are cached for five minutes (50 codes). No token, cookie or credential is ever sent. A template Discord does not know is `404 discord_template_not_found`; Discord's rate limit is `429 discord_rate_limited` (`details.retryAfterSeconds`); anything else is `502 discord_unreachable`. Instead of a code the client may send the template itself (`template`, the JSON of that endpoint, for example saved by hand), read by the same validator.

**Validation** (`readDiscordTemplate`, packages/shared/src/discordImport.ts). Every field the import uses is checked for its type, and a channel may name each role or member once in its overwrites, as Discord stores them; a template that is not one is `400 discord_template_invalid` (`details.field`). At most 250 roles, 500 channels and 100 overwrites per channel (`413 discord_template_too_many_roles`, `_too_many_channels`, `_too_many_overwrites`, each with `details.max`); a template answer over 2 MB is `413 discord_template_too_large` (`details.max` in MB). The routes accept a body of that size plus room for the request around it. Names are cut to Tavvit's lengths, never through the middle of a character.

**The plan** (`planDiscordImport`, shared, so the preview and the import are the same computation):
- **Roles** keep Discord's order and come in below the space's existing roles. A role whose name the space already has is reused as it is, never changed, and each existing role is taken over by one template role at most: a second role of one name becomes "Name (2)", or takes over the "Name (2)" an earlier import made, so importing the same template again adds nothing and never collides. Names and icons follow the role routes' rules (`normalizeRoleName`, `isRoleIcon`, packages/shared/src/roleDisplay.ts): hidden characters are dropped from a name, an icon that is not an emoji is dropped (noted), a role with a picture icon loses it, and a role named "@everyone" that is not the template's own becomes "@everyone (2)". On a new space the template's @everyone permissions replace the defaults; on an existing space @everyone keeps its own. A reused role and a kept @everyone are not written, so nothing of them is reported as withheld.
- **Permissions** go through one table, `DISCORD_PERMISSIONS`: each Discord bit maps to the Tavvit bit with the same meaning (MANAGE_GUILD to MANAGE_SPACE, MODERATE_MEMBERS to MODERATE_MEMBERS, MOVE_MEMBERS to MOVE_MEMBERS and DISCONNECT_MEMBERS, and so on) or is reported as not supported, by name, on the role or overwrite that had it. Two Discord bits count only together (`DISCORD_COMBINED_PERMISSIONS`): since Discord split them, Manage Expressions (30) edits and deletes everyone's emoji, stickers and sounds and Create Expressions (43) adds them, while `MANAGE_EMOJIS` and `MANAGE_SOUNDS` do both. A role or overwrite with both gets both Tavvit bits; one with only one of them gets neither, rather than more than it had on Discord, and that bit is reported as not supported. Create Public Threads (35) gives `CREATE_THREADS` and Use Soundboard (42) `USE_SOUNDBOARD` (before 1.34.0 these four were all reported as not supported). Importing into an existing space, someone who is not the owner (and not an administrator there) cannot hand out bits they do not hold: those bits are dropped and listed as withheld, the held-bits rule applied before the write rather than refused after it (permissions.md, "Held-bits rule"). Bits left out of an override are named per channel or category (note `override_withheld`).
- **The role hierarchy** applies as on the role and override routes (permissions.md, "Role hierarchy"). Creating roles takes a role above position 1, so an importer whose top role is the lowest is refused (`403 role_hierarchy`, preview and import) when the plan would create one; the owner and instance admins are exempt, ADMINISTRATOR is not. An override is written only on a role below the importer's top role (or @everyone, or a role the import creates, which always sit below); the others are left out and named per channel or category (note `override_hierarchy`).
- **Categories** whose name the space has are reused, each existing one by one template category at most (decorative names repeat); others are created in Discord's order.
- **Channels**: text (0) and voice (2) come over as they are; announcement (5) and forum (15) come over as themselves ([forums.md](forums.md)), media (16) becomes a text channel and stage (13) a voice channel, each noted; any other type is left out and noted. A channel the space already has of the same kind under the same name in the same category is skipped, which makes a second import of the same template add nothing. Every channel name, text or voice, takes the form every Tavvit channel has (`normalizeChannelName`, as `POST /api/channels` stores it; a text channel's change is noted), topics are cut to Tavvit's length, slow mode is rounded down to an Tavvit step (off below the shortest), and age restriction has no Tavvit equivalent (noted).
- **Overwrites**: role overwrites are mapped like role permissions. Discord channels in a category may be synced with it or carry their own overwrites; Tavvit layers the category's overrides under the channel's. A category's overwrites are therefore written on the category only when every channel in it carries exactly the same set; otherwise each channel carries its own and the category none, which keeps every channel's effective permissions. Overwrites for single members cannot come over (members are not in a template) and are noted.

**Endpoints** (routes/discordImport.ts; api.md): `POST /api/import/discord/preview` answers the template's summary, the plan, the notes and the list of what a template never holds, and changes nothing. The summary carries `sourceGuildId`, the id of the Discord server the template was made from (Discord's `source_guild_id`, null when the template has none), which is the server id the emoji and sticker import asks for. `POST /api/import/discord/apply` computes the plan again from the source and from the space as it is after the wait for Discord, then writes it in one transaction with nothing awaited in between: for a new space the space (private, an invite code, the caller as owner), the membership, @everyone and the plan; for an existing one the plan alone, after moving the existing roles up to make room. Either way the same transaction sets `spaces.discord_imported_at` ("Telling the Discord server"). A failure leaves nothing behind. Both take at most 10 starts a minute per user (`429 rate_limited`). An existing space needs the owner or `MANAGE_ROLES` and `MANAGE_CHANNELS` (`403 import_target_forbidden`), records `template_import` in the audit log with the counts, and sends `space_access_changed` to every member so clients load the new roles and channels. A new space answers `201 { space, plan }` and is added to the caller's sessions.

**The report.** After the import the modal shows the counts (roles, categories, channels, overrides, skipped), every role whose permissions were reduced and why, and what to do next: invite the members, check the roles that lost permissions, set up bots and integrations again.

## Importing emoji and stickers from Discord

A template holds no emoji or stickers, and Discord lists a server's emoji and stickers only to an account on that server. So the person brings a bot of their own: they create an application on Discord, add its bot to their server with no permissions, and give the bot's token and the server's id. The instance asks Discord for the server's two lists with that token, once, and forgets it; then it brings the pictures over from Discord's content servers, without the token, in batches the client asks for one after another. Messages and members never come. Code: `routes/discordExpressionImport.ts` (the routes and the batches), `utils/discordApi.ts` (every request to Discord), `utils/discordExpressionSessions.ts` (the listings in memory), `packages/shared/src/discordExpressionImport.ts` (pure: reading Discord's answers, the plan, the picture addresses); the client is `spaceSettingsPanels/DiscordExpressionImport.tsx`. None of the routes is open to bots.

**Where it starts.** Space Settings, "Get from Discord", "Emoji and stickers", shown with `MANAGE_EMOJIS` ("Settings tabs"). The form lists the steps on Discord's side (create an application; under Bot, Reset Token and copy it; add the bot through OAuth2, URL Generator, with "bot" and no permissions; turn on Developer Mode and copy the server id), takes the server id and the token, and says where the token goes (the host of the space's instance) and that it is used for two requests and not stored. It adds to the space whose settings are open; no new space starts from it.

**Who may.** Every step asks `expressionManagerRefusal` (`utils/spaceExpressions.ts`): `MANAGE_EMOJIS` in the space (`403 missing_permission`, `details.permission: 'MANAGE_EMOJIS'`), then `memberActionRefusal` (a timeout, an address not yet confirmed, rules not yet agreed to). It is asked at the look-up, again once Discord has answered, before every batch, before every picture, and once more with nothing awaited right before each row goes in, so someone banned, timed out or demoted while an import runs adds nothing more.

**The look-up.** `POST /api/import/discord/expressions/preview` `{ spaceId, guildId, token }`, checked in this order:

| Check | Refusal |
|---|---|
| The right (above) | `403 missing_permission`, or the refusal that holds the member back |
| The server id, trimmed, is 17 to 20 digits (`DISCORD_SNOWFLAKE`) | `400 discord_server_id_invalid` |
| The token has the form Discord issues (`parseBotToken`: three dot-separated parts of letters, digits, `-` and `_`; a pasted `Bot ` in front is forgiven). Checked before anything is sent, so no header check can quote it back | `400 discord_bot_token_invalid` |
| No import of the account's is running | `409 discord_import_running` |
| The session store has room (below) | `429 rate_limited` |
| At most 5 look-ups per account in 10 minutes, counted only here, once the request could reach Discord, so a typo costs nothing | `429 rate_limited` |

Then two requests to Discord's API: `GET https://discord.com/api/v10/guilds/{id}/emojis` and, only once that one succeeded, `GET https://discord.com/api/v10/guilds/{id}/stickers` (Discord counts refused requests per address, and the instance's address is shared by everyone who imports). Each carries `Authorization: Bot <token>` and the User-Agent Discord asks of bots, `DiscordBot (https://github.com/yDulli/Tavvit, <version>)`, refuses redirects (`redirect: 'error'`: a redirect would carry the token to an address the code did not choose), goes through the dispatcher that reaches public addresses only (`publicOnlyDispatcher`, `utils/ssrf.ts`), times out after 10 seconds and reads at most 1 MB. Nothing is retried by itself. Discord's answer becomes:

| Discord answers | Tavvit answers |
|---|---|
| 401, or JSON code 40001 | `400 discord_bot_token_invalid`, never a 401: the web client takes any 401 as the end of its own session |
| 403 or 404, or code 50001 or 10004 | `400 discord_bot_not_in_server` |
| 429 | `429 discord_rate_limited`, `details.retryAfterSeconds` (Discord's own wait, rounded up; 5 when it names none) |
| No answer, another error, more than 1 MB, or a list that is not one | `502 discord_unreachable` |

At most 1000 emoji and 200 stickers are read; a longer list is taken as malformed. Kept: an emoji's id, name, whether it is animated, whether it belongs to an integration (`managed`) and whether only some roles could use it; a sticker's id, name and format, for the server's own stickers only (type 2; Discord's standard stickers are left out). Dropped as they are read: who uploaded it (`user`), the role list, a sticker's tags and its description. Once Discord has answered, the route asks the right and the running check again, since the look-up took a moment, and keeps the listing as a session (below).

The answer (`DiscordExpressionPreview`) is `{ importId, expiresAt, items, room, limits }`: each item `{ key, kind, discordId, sourceName, name, animated, format?, action, skip, notes }`, where `key` is `emoji:<id>` or `sticker:<id>`; `room` is what the space has left, `limits` the space's limits (200 emoji, 60 stickers).

**The plan** (`planDiscordExpressionImport`, shared, so the preview and every batch are the same computation) goes through Discord's lists in their order, emoji first:
- **Names.** An emoji's name is made valid (lower case, every character outside `[a-z0-9_]` an underscore, cut to 32, padded to 2 with underscores), a sticker's as `normalizeStickerName` stores it. Then it is made free in the space and among what the same import brings, compared without regard to case: `name_2`, `name_3`… for an emoji, `name (2)`… for a sticker (`freeExpressionName`).
- **Skips**, decided in this order: `not_selected` (not picked; first, so a report names only what was picked), then `lottie` (a vector sticker, which cannot be decoded) and `managed` (an emoji of an integration, not the server's own picture), then `already_here` (an earlier import brought that Discord id: `space_emojis.discord_id`, `space_stickers.discord_id`), then `no_room`. Room is taken in Discord's order, so what does not fit is the end of the list.
- **Notes:** `renamed`, `still_picture` (an animated PNG sticker comes over as a still picture), `role_restriction_dropped` (only some roles could use it on Discord; here every member can).

**Sessions** (`utils/discordExpressionSessions.ts`). A look-up's listing is kept in memory, at most 500 at a time, with the pick, what is settled and the results; the session type has no field for the token. A new look-up replaces the account's other sessions, and when the store is full the oldest that is not running makes way. A running one is never ended or pushed out, and a store full of running imports answers a look-up `429 rate_limited`. An open session ends 30 minutes after it was last used (`expiresAt`). An import that is over keeps its outcome 5 minutes more, so an answer that never arrived can be asked for again. A restart forgets every session, and the import is looked up again.

**Batches.** `POST /api/import/discord/expressions/apply` `{ importId, selection?, after? }` carries no token. The first call that arrives fixes the pick: keys of the listing (`400 validation_failed`, `details.field: 'selection'`, for one that is not), or everything when none is sent. An import that is not the caller's, never was, or is gone answers `404 discord_import_expired`; one whose batch is running, `409 discord_import_running`. A batch brings at most 8 pictures, starts none after 12 seconds and lets no fetch run past 20 seconds (the client waits 30 seconds for an answer). Before every picture it plans again against the space as it is, so a picture that failed frees its room for the next, and asks again whether the importer may add. A picture is fetched only from `https://cdn.discordapp.com` or `https://media.discordapp.net` (`discordAssetUrl`, `fetchDiscordAsset`): no token, no redirect, 8 seconds, only a `200` with an `image/*` type, at most the source size of its kind (3 MB for an emoji, 5 MB for a sticker). It is then added as an upload is (`addSpaceEmoji`, `addSpaceSticker`, emoji.md): re-encoded, its size held on the importer's storage, room, name and right checked once more with nothing awaited before the insert, and the Discord id stored on the row. The import does not count against the upload routes' limits (30 pictures a minute, 100 stickers a day); its pace is the batch and the picture queue, where an account has one job at a time. The route takes 60 calls a minute from one address.

Each entry settles as one outcome: `imported`, `already_here`, `no_room`, `lottie`, `managed`, `download_failed` (the picture could not be had) or `image_refused` (it could not be read as a picture). An entry without room settles as `no_room` only once nothing else is left to bring. A name someone took while the picture was on its way is planned again. A refusal that says the importer cannot go on now (the right, a timeout, an unconfirmed address, the rules, or `rate_limited`: the account's picture work is busy or the queue is full) ends the batch with the entry unsettled, and the next call says why. `storage_limit_reached` or `disk_full` stops the import. The answer (`DiscordExpressionApplyResult`) is `{ done, total, finished, stopped, results }`, `results` being everything settled after the client's cursor `after`: what this call settled, and what an earlier answer carried that never arrived. A space deleted under a batch ends the import with `404 space_not_found`.

When a batch brought anything, the space is told (`sendToSpace`: `space_emojis_changed` when emoji came, `space_stickers_changed` when stickers came) and `spaces.discord_imported_at` is set ("Telling the Discord server").

**Stopping.** `DELETE /api/import/discord/expressions/:importId` ends the import and answers `{ success: true }`; a batch that is running finishes the picture it is on and then ends it. What came over stays.

**The audit entry.** `discord_expressions_import`, once per import and only when anything came over: when the import is over (through, stopped, ended by the person), or when its open session ends without that (it ran out, or a new look-up replaced it). The target is the space; the changes are `emoji` and `stickers`, how many came over. The single pictures are not recorded as `emoji_create` or `sticker_create`.

**The token** is used for the two list requests and nothing else: a local of the look-up request, never stored, logged, echoed in an error or put in an event, and no failure carries Discord's own message either. `routes/discordExpressionImport.test.ts` runs every path with a sentinel token and searches the answers, the log lines, every database column, the socket events and the console for it. In the browser it lives in the component's state only and is cleared once Discord has answered or refused; it never goes into a store, the address bar, a toast or an error text. The field is a text field masked with CSS (`-webkit-text-security: disc`) where the browser supports that, because browsers take a password field in a form that goes away after a request for a sign-in and offer to save the token as the site's password. Where masking is not supported it stays a password field, so the token is never shown on a shared screen. It is marked to be left alone by the browser (`autocomplete="off"`) and by 1Password, LastPass, Bitwarden and Proton Pass (each one's ignore attribute). The privacy draft names the requests to Discord and what is kept of their answers (legal.md).

**The client.** After the look-up the preview lists the emoji and stickers with the room left, each with its note or the reason it stays behind. What fits is ticked, and an entry without room can be ticked in place of another; a line says when more are ticked than fit. The pictures are on Discord's servers, and the browser loads them only after "Show pictures" (with no referrer). "Import" runs the batches one after another, sending the pick until an answer arrives and, as `after`, the count of results it holds. A timeout or `409 discord_import_running` means a slow batch is still running: the client waits 3 seconds and asks again, at most 6 times in a row. A batch that settled nothing (the picture queue was busy) is followed by a 3-second pause. The import ends when the server says it is finished or stopped, and the panel shows what came over, what stayed behind and why, and that the bot can now be removed from the server and its token reset. Stop sends the `DELETE`, and so does leaving the page; what came over stays.

### Telling the Discord server

**The announcement** (`DiscordAnnouncement`, `utils/discordAnnouncement.ts`), in the Get from Discord tab, is a text to post on the Discord server, with Copy text and Copy link. Its link is the space's own invite address when it has one ("Own invite address"), else its standing invite (`POST /api/spaces/:id/invite`, `CREATE_INVITE`, which the server checks), on the space's instance, with `?from=discord`. The text is in a language picked in the box, any language of the app, whose catalog is loaded before the text is made (`i18n.loadLanguages`); otherwise i18next would answer in English under another language's name. In order it says: a bold headline that the space has moved to the instance, by the instance's name; that the channels and roles are set up there, and the emoji once the space has any; that making an account takes about a minute, only while the instance's registration is open; "Join us with this link:", or for a request space "Ask to join with this link, and we will let you in:"; the link on a line of its own, so Discord shows its preview; and that everything written stays on Discord. Names are escaped for Discord (`escapeDiscordText`): its markdown characters get a backslash, and `@everyone`, `@here` and `<@`, `<#`, `<:`, `</`, `<a:`, `<t:` are broken with a zero-width space, since Discord finds mentions in the raw text, where a backslash would not stop a ping. The link is left as it is. The whole stays far below the 2000 characters Discord takes in a message (a test holds it there). While the instance's registration is closed the box says that people cannot sign up with this link alone.

**The welcome.** `spaces.discord_imported_at` (migration 0071) holds when something last came over from Discord: a template import sets it in the transaction that writes the plan, for a new space and an existing one, and so does an emoji and sticker batch that brought anything. Nothing clears it. The invite preview carries it as `movedFromDiscord` ("Invite Preview"; absent from an instance before 1.34.0). A link with `?from=discord` opens the Join Page with a welcome for people following their community from Discord (`auth:join.fromDiscord`), shown only when the preview says `movedFromDiscord: true`: anyone can add the parameter to a link, and the page claims nothing the space's instance does not confirm. The parameter is read by the page alone; no request carries it, and nothing stores or counts it.

---

## Moderation

Server settings → Moderation and Audit log, slow mode per channel, member
timeouts and the space's default notification level. All of it is stored and
enforced by the instance that hosts the space: `utils/spaceModeration.ts`
(enforcement, the rules' storage, timeouts, slow mode), `utils/auditLog.ts`
(the log) and `routes/spaceModeration.ts` (the endpoints; api.md,
"Moderation"). The wire shapes are in `packages/shared/src/types.ts`
("Space Moderation"); the pure rules, which a client may run too, in
`packages/shared/src/moderation.ts`. Tables: database.md, "Moderation Tables".

### Permissions

| Bit | Name | Allows |
|-----|------|--------|
| 8 | `MODERATE_MEMBERS` | Time a member out, and end a timeout early. Subject to the role hierarchy, like kick and ban |
| 9 | `VIEW_AUDIT_LOG` | Read the audit log |

Reading and changing the automatic rules (`GET`/`PATCH /spaces/:id/moderation`)
needs `MANAGE_SPACE`, as does the default notification level (a field of
`PATCH /spaces/:id`); slow mode is a channel field (`PATCH /channels/:id`,
`MANAGE_CHANNELS`). Neither new bit is in `DEFAULT_EVERYONE_PERMISSIONS`.

### Enforcement order

Every message written to a space channel goes through `spaceMessageRefusal`:
`POST /channels/:id/messages` and `PATCH /messages/:id` over REST, and
`message_create` and `message_edit` over the WebSocket, after their existing
checks (permissions, length, mass mentions, reply target). The first rule that
applies refuses, and nothing is stored or broadcast:

| # | Rule | Refusal |
|---|------|---------|
| 1 | The author is timed out | `403 member_timed_out`, `details.until` (epoch ms, the server's clock) |
| 2 | The account is younger than `minAccountAgeMinutes` | `403 account_too_new` |
| 2 | The membership is younger than `minMemberAgeMinutes` | `403 membership_too_new` |
| 3 | Slow mode: the author posted in the channel less than `slowmodeSeconds` ago (new messages only, not edits) | `429 slowmode_active`, `details.retryAfterSeconds` (rounded up) |
| 4 | A blocked word, then an invite, then a link, then too many mentions | `403 automod_blocked_word`, `automod_invite_blocked`, `automod_link_blocked`, `automod_too_many_mentions` (`details.max`) |

REST answers with `sendError`; the WebSocket handlers send an `error` event
with the same code and details to the user's sessions, as they refuse a mass
mention without `MENTION_EVERYONE` (websocket.md, "error"). DMs never go
through any of it. An edit is checked as a whole: the edited text must pass
the rules a new message would.

### Exemptions

| Rule | Exempt |
|------|--------|
| Timeout | Nobody. The owner cannot be timed out (the routes refuse it, and ownership transfer clears the new owner's timeout) |
| Minimum ages, automatic rules | The owner, instance admins, `ADMINISTRATOR`, `MANAGE_MESSAGES` in the channel, `MANAGE_SPACE` |
| Slow mode | The owner, instance admins, `ADMINISTRATOR`, `MANAGE_MESSAGES` or `MANAGE_CHANNELS` in the channel |

### Automatic rules

Stored per space in `space_moderation_settings`; a space without a row has the
defaults (`DEFAULT_MODERATION_SETTINGS`: nothing blocked, no limits,
`updatedAt` null). `PATCH /spaces/:id/moderation` validates a change with
`normalizeModerationSettings` and stores the result; a change that leaves the
rules as they were writes nothing.

- **Blocked words** (`blockedWords`, at most `MAX_BLOCKED_WORDS` entries of at
  most `MAX_BLOCKED_WORD_LENGTH` characters). An entry is stored trimmed, with
  whitespace runs made one space; entries that differ only in case are kept
  once; an empty entry is dropped; one with a control or bidirectional
  character is refused. It matches without regard to case and only as a whole
  word: `bad` matches "bad" and "Bad!" but not "badge". A leading or trailing
  `*` lets that side sit inside a longer word (`bad*` matches "badge", `*bad*`
  anything containing it). A phrase matches with any whitespace between its
  words. Letters, combining marks, digits and connectors such as `_` continue a
  word. Content and entries are compared after Unicode compatibility folding
  (NFKC, so fullwidth "ｂａｄ" is "bad") with format characters such as
  zero-width spaces removed. The patterns are literal text with fixed
  lookarounds, compiled into one expression per check (`compileBlockedWords`),
  so a check is linear in the content.
- **Links** (`blockLinks`): an `http://` or `https://` address, or a host
  written with `www.` and a name after it. A bare name with a dot ("e.g.",
  "file.txt", "example.com") is not a link. A GIF from the picker is sent as
  its URL and is a link.
- **Invites** (`blockInvites`): a link to `/join/<code>` on any host, with or
  without its scheme (the code may be qualified as `<code>%40host`); the desktop
  deep link `tavvit://join/<code>` (and the upstream `backspace://`); a
  qualified code `<code>@host`. A code is eight hex digits, as this codebase
  issues them, so a `/join/` path of another site is not an invite. Space invite
  cards are system messages the instance writes in DMs, never text a member
  types, so no rule needs them.
- **Mentions** (`maxMentions`, 0 = no limit, at most `MAX_MENTIONS_CAP`):
  distinct `<@user>` and `<@&role>` tokens outside code (`countMentions`, read
  with the shared mention parser). `@everyone` and `@here` are not counted;
  `MENTION_EVERYONE` governs them.
- A sticker message (the whole content is a sticker token) carries no text: only
  the mention limit applies to it. A message with attachments only is not
  checked against the text rules.

### Minimum ages

`minAccountAgeMinutes` and `minMemberAgeMinutes` (0 = off, at most
`MAX_AGE_MINUTES`, 30 days). The account's age counts from its row on the
hosting instance (`users.created_at`). For a member whose home is another
instance that is when this instance first saw them (the replicated row was
created), not when the account was made at home, so an old account from
another instance counts as new here at first. The membership's age counts from
`space_members.joined_at`, which leaving and joining again resets.

### Slow mode

`channels.slowmode_seconds`, one of `SLOWMODE_SECONDS` (0 = off), set with
`PATCH /channels/:id`. The time a member last posted in a slow mode channel is
kept in `channel_slowmode_posts` (one row per channel and member), written in
the same transaction as each accepted message while the channel has slow mode
on (`recordSlowmodePost`), and read by the check. A table was chosen over an
index on `messages (channel_id, user_id, created_at)`: the wait then survives
the member deleting their message, a restart keeps it, and the messages table
carries no extra index for every write in every channel. Switching slow mode
off drops the channel's rows. The wait uses the interval in force at the time
of the check, so lowering it shortens a running wait. Edits are not slowed.

### Timeouts

`PUT /spaces/:id/members/:uid/timeout { durationSeconds, reason? }` sets
`space_members.timed_out_until` to the server's time plus `durationSeconds`
(a whole number from `MIN_TIMEOUT_SECONDS`, one minute, to
`MAX_TIMEOUT_SECONDS`, 28 days; the interface offers
`TIMEOUT_DURATIONS_SECONDS`), replacing a running timeout.
`DELETE /spaces/:id/members/:uid/timeout` ends one early. Both need
`MODERATE_MEMBERS` and refuse, as kick and ban do, oneself
(`400 cannot_target_self`), the owner (`400 cannot_target_owner`), a non-member
(`404 member_not_found`) and anyone the actor does not outrank
(`403 role_hierarchy`, `canActOnMemberInSpace`; the owner and instance admins
outrank everyone else, and an instance admin may be a target). Both answer
`{ member }` and send `member_updated` to the space.

While a timeout runs the member cannot write or edit messages, poke
(`channel_poke`), add reactions (`reaction_add`; removing their own stays
possible), get a voice token for the space's channels (`POST /livekit/token`) or
join voice (`voice_join`, refused with the coded `error` and a
`voice_disconnected` with reason `rejected`); each refusal is
`member_timed_out` with `until`. A member who is in one of the space's voice
channels when timed out is disconnected the way `voice_disconnect` does it
(`disconnectMemberFromSpaceVoice`): out of the room, the space sees the leave,
their sessions get `voice_disconnected`. Their LiveKit token is not revoked at
the LiveKit server, as with `voice_disconnect`.

Every member payload carries `timedOutUntil` while the timeout runs and `null`
otherwise (`memberToWire`). No event marks its end; clients compare it with the
clock. Leaving or being kicked does not lift it: the running timeout is kept in
`space_departed_timeouts` and put back on the new member row by every join path
(invite code, public join, an accepted join request), so `member_joined`
carries it again. A ban drops it, since the banned cannot join.

### Audit log

`recordAudit` writes one `space_audit_log` row per change, with the actor (the
caller's row id here), the target and the target's name at that time
(`targetLabel`, so a deleted channel or role still reads), the changed fields
(`AuditLogChange[]`) and a reason. It never fails the request: an error is
logged and the request goes on. Values that name something (a category, a role,
a member, the owner) are recorded by name; permission values are decimal
strings, durations seconds.

| Action | Recorded by | Target | Changes |
|--------|-------------|--------|---------|
| `space_update` | `PATCH /spaces/:id` | space | each changed field of name, icon, banner, avatarColor, visibility, description, directoryListed, ownerTitle, ownerGroup, defaultNotificationLevel, tag and look (both as the stored JSON, shown as the tag's mark and as a strip of the colours with their values; since 1.41.0) |
| `moderation_update` | `PATCH /spaces/:id/moderation` | space | `blocked_word_added` / `blocked_word_removed` per word, and blockLinks, blockInvites, maxMentions, minAccountAgeMinutes, minMemberAgeMinutes |
| `invite_regenerate` | `POST /spaces/:id/invite` when the space had no code and one is generated | invite (the code) | `inviteCode` |
| `channel_create` | `POST /spaces/:id/channels` | channel | name, type, topic, category |
| `channel_update` | `PATCH /channels/:id`; `PATCH /spaces/:id/channel-layout` for each channel moved to another category | channel | name, topic, slowmodeSeconds, category; a position change alone is not recorded |
| `channel_delete` | `DELETE /channels/:id` | channel | name, type |
| `category_create`, `category_update`, `category_delete` | `POST /spaces/:id/categories`, `PATCH /categories/:id` (a rename; a move alone is not recorded), `DELETE /categories/:id` | category | name |
| `override_update`, `override_delete` | `PUT`/`DELETE /channels/:id/overrides…`, `PUT`/`DELETE /categories/:id/overrides…` | channel or category | `target` (the role's or member's name), `allow`, `deny` before and after |
| `role_create`, `role_delete` | `POST`/`DELETE /spaces/:id/roles…` | role | name, color, permissions |
| `role_update` | `PATCH /spaces/:id/roles/:rid` that changes name, color or permissions | role | the changed fields, and `position` when it moved too |
| `role_reorder` | `PATCH /spaces/:id/roles/:rid` that only moves the role | role | `position` |
| `member_roles_update` | `PATCH /spaces/:id/members/:uid` with `roleIds`, `POST`/`DELETE /spaces/:id/members/:uid/roles…` | member | `role_added` / `role_removed` with the role's name |
| `member_kick`, `member_unban` | `DELETE /spaces/:id/members/:uid` (not a leave), `DELETE /spaces/:id/bans/:uid` | member | — |
| `member_ban` | `POST /spaces/:id/bans` | member | — (the reason as `reason`) |
| `member_timeout` | `PUT /spaces/:id/members/:uid/timeout` | member | `durationSeconds` (the reason as `reason`) |
| `member_timeout_remove` | `DELETE /spaces/:id/members/:uid/timeout` while a timeout runs | member | — |
| `message_delete` | `DELETE /messages/:id` and WS `message_delete` by someone other than the author | message (label: the author's name) | `channel` (its name) |
| `join_request_approve`, `join_request_decline` | `PATCH /spaces/:id/join-requests/:rid` | join request (label: the requester's name) | — |
| `ownership_transfer` | `PATCH /spaces/:id/transfer-ownership` | member (the new owner) | `owner`, former to new |
| `emoji_create`, `emoji_update`, `emoji_delete` | `POST /spaces/:id/emojis`, `PATCH /space-emojis/:id` that changes the name, `DELETE /space-emojis/:id` | space (id: the emoji's; label: its name) | `name` (update) |
| `sticker_create`, `sticker_update`, `sticker_delete` | `POST /spaces/:id/stickers`, `PATCH /space-stickers/:id` that changes the name or the description, `DELETE /space-stickers/:id` | space (id: the sticker's; label: its name) | `name`, `description` (update) |
| `discord_expressions_import` | `POST /import/discord/expressions/apply`, once per import that brought anything ("Importing emoji and stickers from Discord") | space | `emoji` and `stickers`: how many came over |

Not recorded: a member leaving, a nickname change, voice moderation (mute,
deafen, move, disconnect), a pure reorder of channels or categories, and
deleting the space (its log goes with it). There is no operation that replaces
an existing invite code, so `invite_regenerate` is only ever the first code of
a space left without one. The emoji and stickers the Discord import brings are
counted in its `discord_expressions_import` entry, not recorded one by one.

Entries older than 180 days are deleted from inside `recordAudit`, at most once
an hour per space (an in-memory throttle, so a restart sweeps again with the
next entry). `GET /spaces/:id/audit-log` (`VIEW_AUDIT_LOG`) pages newest first
by id (snowflakes, compared as numbers on `idx_space_audit_log_space_page`),
filtered by `action` and `actorId`, and answers the users the page names
(actors and member targets) beside the entries, with `nextBefore` for the next
older page (api.md, "Moderation").

### Default notification level

`spaces.default_notification_level`: `'all'`, `'mentions'` or null (the
built-in `DEFAULT_NOTIFICATION_LEVEL`), set with `PATCH /spaces/:id`
(`MANAGE_SPACE`; anything else is `400 notification_level_invalid`) and carried
on every space payload as `defaultNotificationLevel`. `'nothing'` is left out on
purpose: going silent is each member's own choice. The server only stores and
serves it: clients resolve a channel's level with
`resolveChannelNotificationPolicy(spaceSetting, channelSetting, now, spaceDefault)`,
where it sits between the member's own space choice and the built-in default
(`levelSource: 'spaceDefault'`).

### Federation

A space lives on one instance and all of this is that instance's: the rules,
the timeouts, the slow mode times and the log are rows there, and nothing is
relayed to peers. A member whose home is another instance posts, reacts, joins
voice and is timed out through their replicated row on the hosting instance, so
every id in a request, a refusal and an audit entry is a row id there. A client
sends the moderation requests to the space's own origin
(`getApiForOrigin(space._instanceOrigin)`), like every other space write.

### Web client

- **Server settings** (`SpaceSettings.tsx`): the tab **Moderation**
  (`ModerationPanel`, needs `MANAGE_SPACE`) edits the message filter (blocked
  words with `*` wildcards, links, invites, mentions per message) and who may
  post (minimum account and membership age), saved through the unsaved-changes
  action bar. The tab **Audit log** (`AuditLogPanel`, needs `VIEW_AUDIT_LOG`)
  pages through the log newest first, filtered by action and actor, with each
  entry's changes expandable. Overview has the space's default notification
  level. Both new panels load on demand from `lazySettingsPanels.tsx`.
- **Channel settings**: a slow mode select for text channels (`MANAGE_CHANNELS`).
- **Member menu**: "Time out…" opens `memberMenu/TimeoutDialog.tsx` (a length
  from `TIMEOUT_DURATIONS_SECONDS` and an optional reason) for a member the
  viewer outranks and may moderate; a timed-out member offers "Remove timeout"
  instead. Member lists, desktop and phone, show an hourglass
  (`MemberTimeoutIndicator`) with the end of the timeout as its title.
- **Composer**: in a slow-mode channel a member who is not exempt sees the
  interval, and after a send a countdown (`stores/slowmodeStore.ts`, started
  after an accepted send or from a `slowmode_active` `retryAfterSeconds`,
  clamped to the channel's current interval) holds the next one. A member who
  is timed out, read from their own row in the space's loaded roster, sees a
  notice with the end time instead of the input, and the input comes back by
  itself when the timeout ends. Other refusals reach the sender through the
  usual failed-send path, with the localized error.

---

## Space Layout (Sidebar Ordering & Folders)

### Data Model

**Layout items (`SpaceLayoutItem`):**
```typescript
type SpaceLayoutItem =
  | { t: 's'; id: string }   // space reference
  | { t: 'f'; id: string };  // folder reference
```

**Folders (`SpaceFolder`):**
```typescript
interface SpaceFolder {
  id: string;
  userId: string;
  name: string | null;
  color: string | null;
  position: number;
  spaceIds: string[];   // ordered list of spaces in the folder
}
```

### Server Persistence

**Tables (see database.md):** `user_space_layout`, `space_folders`, `space_folder_members`

**Endpoint:** `PUT /api/users/@me/space-layout` (`users.ts`)

**Request body:**
```typescript
{
  items: SpaceLayoutItem[];
  folders: Record<string, {
    name: string | null;
    color: string | null;
    spaceIds: string[];
  }>;
  updatedAt?: number;   // LWW timestamp
}
```

**Server-generated folder IDs:** Clients use `new:*` prefixed keys for new folders. The server maps each `new:*` key to a `generateSnowflake()` ID. The response returns resolved IDs so the client can update references.

**Remote folder adoption:** If a folder ID does not match an existing folder and does not start with `new:`, the server creates it with the provided ID (handles folders created on another instance being pushed to this one).

**Transaction:**
1. For each folder in request: create new / update existing / adopt remote
2. Clear and re-insert `space_folder_members` with ordered positions
3. Delete folders not in request (with their members)
4. Replace `new:*` keys in items array with resolved IDs
5. Upsert `user_space_layout` row (JSON string of items)

**WS broadcast:** `space_layout_updated` sent to the user's other connections (multi-tab sync).

**Response:** `{ items, folders, updatedAt }`

### LWW Conflict Resolution

**Server-side guard** (`users.ts`): If the request includes `updatedAt` and it is older than the stored `updatedAt`, the write is rejected and the current layout is returned without modification.

**Client-side algorithm** (`spaceStore.ts:populateFromReady`):

```
On receiving ready payload from any instance:
  incomingTs = payload.layoutUpdatedAt ?? 0
  currentTs = store._layoutUpdatedAt

  if incomingTs >= currentTs:
    Accept incoming layout (overwrite local)
    _layoutUpdatedAt = incomingTs
  else:
    Keep local layout
    Push local layout to the stale instance via pushLayoutToOrigin()
```

**`pushLayoutToOrigin(origin, layout, folders, updatedAt)`:** Calls `targetApi.spaceLayout.update()` on the specific instance that had the stale layout. This ensures all instances converge to the newest layout.

### Multi-Instance Layout Push

**`updateSpaceLayout(items, folders)`** in spaceStore:
1. Optimistically applies the layout with `Date.now()` timestamp
2. Collects all targets: home API + all connected remote instance APIs
3. `Promise.allSettled` pushes to all targets in parallel
4. Uses the first successful response to resolve `new:*` folder IDs
5. Updates store with resolved layout

---

## WS Ready Payload

The space layout and folder data are delivered in the WS `ready` event (`handler.ts:buildReadyPayload`):

```typescript
{
  spaces: SpaceWithChannelsAndMembers[];
  folders: SpaceFolder[];
  spaceLayout: SpaceLayoutItem[] | null;
  layoutUpdatedAt: number | null;
  dmChannels: DmChannel[];
  // ... other fields
}
```

`populateFromReady` merges incoming data by origin:
- Replaces all spaces from the incoming origin, keeps spaces from other origins
- Replaces this origin's entries in the space-channel index and `channelPermissions` (client-federation.md, "Channel index and lookup maps"), and adds this origin's categories to `categoryOriginMap` (entries of categories it no longer lists stay)
- DM channels: removes existing DMs from this origin, appends incoming, deduplicates 1-on-1 DMs by canonical member pair (prefers home-origin copy)
- Applies LWW layout merge as described above

---

## WS Events Summary

| Event | Direction | Trigger |
|-------|-----------|---------|
| `space_updated` | S→C (space) | Space metadata changed, or its badges did (a verification step, an admin's badge grant) |
| `space_review_updated` | S→C (user) | Sent to the owner when one of the space's reviews moved ("Who hears of a step") |
| `member_joined` | S→C (space) | New member via any join path |
| `member_updated` | S→C (space) | A member's nickname or role set changed (`PATCH /members/:uid`), or a timeout was set or ended early (`PUT`/`DELETE /members/:uid/timeout`) |
| `member_left` | S→C (space) | Member left, kicked, or banned |
| `member_banned` | S→C (user) | Sent to the banned user with reason |
| `join_request_received` | S→C (user) | Sent to space managers when request submitted |
| `join_request_accepted` | S→C (user) | Sent to requester with full space data |
| `join_request_declined` | S→C (user) | Sent to requester |
| `channel_created` | S→C (per-user) | New channel, per-user VIEW_CHANNEL filter |
| `channel_updated` | S→C (per-user/channel) | Channel or override changed |
| `channel_deleted` | S→C (per-user) | Channel deleted or user lost VIEW_CHANNEL |
| `category_created` | S→C (space) | New category |
| `category_updated` | S→C (space) | Category name/position/privacy changed |
| `category_deleted` | S→C (space) | Category removed |
| `channel_layout_updated` | S→C (per-user) | Batch reorder, per-user channel filtering |
| `space_layout_updated` | S→C (user) | Sidebar layout changed (multi-tab sync) |
| `space_emojis_changed` | S→C (space) | A space emoji was added, renamed or removed, or the Discord import brought some; clients load the space's list again ([emoji.md](emoji.md)) |
| `space_stickers_changed` | S→C (space) | The same for the space's stickers |

---

## Federation Considerations

### Instance Origin Tagging

Every space in the client store has `_instanceOrigin: string`:
- `''` (empty) = home instance
- `'https://remote.com'` = remote federated instance

All store actions resolve the correct API client via `getApiForOrigin(origin)` before making HTTP requests. The resolver is registered by `instanceStore` on import (breaks circular dependency).

### User ID Resolution

`getMyUserIdForOrigin(origin)`, the user's row id on the instance at `origin`, is defined in client-federation.md section 5. Used for self-leave (`leaveSpace` calls `removeMember` with the correct user ID for the instance).

### Remote Invite Join Flow

```
1. User enters invite URL pointing to remote instance
2. parseInviteInput extracts code + origin
3. joinByCode(code, origin) called
4. If not connected → NotConnectedError thrown
5. JoinSpaceModal/JoinPage enters 'connect' phase
6. User provides password → connectToRemote(origin, password)
7. If only the account's own credentials can get in → RemoteLoginRequiredError → 'fallback' phase (reasons: client-federation.md, connect flow step 7)
8. On success: joinByCode retried, space added to store with _instanceOrigin
```

### Asset URL Normalization

Remote space icons, banners, and member avatars are resolved via `resolveAssetUrl(path, origin)` when:
- `populateFromReady` processes spaces from a remote origin
- `loadSpaceDetail` loads a remote space
- `joinByCode` returns a remote space
- `exploreStore.fetchSpaces` processes remote explore results

### Client Load State (`useSpaceStore`)

Two distinct flags track per-space load progress:

- `loadingSpaceId: string | null` — set when a plain `loadSpaceDetail` starts (a `quiet` one never sets it) and cleared when the newest load of that space lands or fails. Drives the channel-list and member-list skeletons (gated through `useDelayedLoading`).

Only the newest `loadSpaceDetail` of a space applies its response; an older one landing later changes nothing and resolves to what the newest resolves to. A detail lands in `channels`/`categories`/`members`/`roles` only when its space is still the open one (`currentSpaceId`; every caller opens the space before loading it); otherwise only that space's channel index entries and permission entries are updated. websocket.md (`space_access_changed`) says why loads of one space overlap.
- `loadedSpaceIds: Set<string>` — populated only on successful `loadSpaceDetail` completion. Used to differentiate "load not yet attempted" from "loaded with empty result." Required by mobile UI to gate the empty-state mascot — without it, the mascot flashes during the pre-skeleton load window because `state.channels` is overwritten on each `loadSpaceDetail` and a fresh space switch leaves `spaceChannels` momentarily filtered to `[]`.

`loadedSpaceIds` lifecycle:
- Added when a `loadSpaceDetail` response lands in the open space (the same `set()` that replaces `channels`/`categories`/`members`).
- Pruned per-space on `deleteSpace`, `leaveSpace`, `removeSpace`, `removeInstanceSpaces`.
- Wiped entirely on `reset` (logout).
- Ephemeral — not persisted.

## Starter spaces

A new account of this instance starts in the public spaces an administrator chose in the console, through the same step as joining one (`addPublicMember` in `utils/spaceJoin.ts`, which `POST /api/spaces/:id/public-join` also uses). See [admin.md](admin.md), "The console".

## Space tag

A space can have a tag its members wear beside their name (Space settings → Tag, MANAGE_SPACE; wearing it in Your settings). Everything about it is in [space-tags.md](space-tags.md).

## A space's look

A space can choose its colours (1.41.0): a surface and, if it likes, an accent, which members see while they are in the space. It is never the shape (corners, typeface, message style, density) and never anything that helps reading: those stay each member's own (design-system.md, "Looks and the theme studio").

**What it is.** `SpaceLook { hue, strength, depth, accent }` (`packages/shared/src/looks.ts`): `hue` an integer 0–359, `strength` an integer 0–100, `depth` −3 to 4 in half steps (`SURFACE_RANGES`, the ranges of a person's own theme), `accent` `null` (each member keeps their own) or a `#rrggbb` that `accentColorProblem` accepts (white button text stays readable), stored in lower case. `spaceLookOf` is the one rule; the server checks a request by it, and `parseStoredSpaceLook` reads the column back by it, so a value that does not hold is no look.

**Stored** in `spaces.look` as JSON, NULL for none (migration `0077_tavvit_space_looks`, additive). **Set** with `PATCH /api/spaces/:id` `{ look: SpaceLook | null }` by anyone with MANAGE_SPACE; anything else is `400 space_look_invalid` and nothing in the body is written. **Sent** on every `Space` the server builds (`spaceToWire`: the ready payload, space responses, `space_updated`, which reaches the members at once). A change is recorded in the audit log (`space_update`, field `look`).

**Space settings → Look** (`spaceSettingsPanels/SpaceLookPanel.tsx`, MANAGE_SPACE) shows the colours chosen, with Remove, and offers the chooser's own looks: the one they wear now and each one they kept (`spaceLookOfLook` takes their colours). A click sets them; the theme studio is a click away for making a new one.

**Shown** by `AppearanceController` while the space is the current one (`withSpaceLook`): its surfaces, and its accent when it chose one, in place of the member's and the instance's. The member can turn this off for every space (Settings → Appearance → Spaces in their own colours, `spaceLooks`, on by default, kept in this browser); in the theme studio a space's colours never show. The client reads every space's look through `spaceLookOf` again (`toTaggedSpace`), so a space from another instance shows only colours that hold here. A host that predates looks sends no `look`, which reads as none.
