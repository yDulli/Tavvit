# Database Schema Reference

Source of truth: `packages/server/src/db/schema.ts` (Drizzle ORM)
Migrations: drizzle-kit generates SQL from `schema.ts` (`pnpm db:generate` from `packages/server/`). On startup, `initDatabase()` runs `drizzle.migrate()` against `packages/server/drizzle/`, then `ensureDefaults()` (settings row, Snowflake worker ID, instance epoch, `installedAt` backfill), `backfillOneOnOneDmMembership()` and `backfillOneOnOneKeys()` (every 1-on-1 `dm_channels` row gets the key of its two members; see dm-system.md "Federated ID Algorithm"). Migration history was squashed to a single baseline on 2026-04-24 (backlog #31 Phase 2). Databases created before the squash keep the tables the old hand-written statements made, which differ from what the baseline creates (inline `UNIQUE` constraints instead of named unique indexes, text primary keys without `NOT NULL`, extra columns), so a migration must not assume an index or column only the baseline creates. `packages/server/test/fixtures/pre-squash-schema.sql` holds that shape, and `src/db/preSquashUpgrade.test.ts` boots it, a squashed install and an empty database through `initDatabase()` and checks the outbox ends identical on all three, and that the reaction tables end with their unique indexes and without repeated rows.
Engine: SQLite via `better-sqlite3`
IDs: Snowflake text, permissions: bigint decimal strings

---

## Core Tables

### users
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | Snowflake |
| username | text UNIQUE NOT NULL | | Login name |
| displayName | text | | |
| passwordHash | text NOT NULL | | bcrypt; `'!federation-replicated'` for stubs |
| avatar | text | | Upload filename |
| status | text | `'offline'` | Live presence: online/idle/dnd/offline. On a row that owns its choice, the user's `chosenStatus` while they have a connection and `'offline'` without one (written at socket auth, by a status change while connected, by `finalizeDisconnect` and by the boot reset). On a replicated row, the home instance's S2S projection, plus this instance's own connect/disconnect writes. See activity-presence.md "DB Persistence" |
| chosenStatus | text NOT NULL | `'online'` | The status the user picked: online/idle/dnd, never offline. Written by `PATCH /api/users/@me` and the WS `presence_update` client event (`ws/presence.ts:applyChosenStatus`); read at socket auth (`utils/presenceStatus.ts:statusOnConnect`) and published as `status`, so idle and dnd survive disconnects, restarts and the boot reset. Meaningful only on rows that own their choice, native or detached (`ownsChosenStatus` in `@backspace/shared`: `home_instance IS NULL OR federation_home_orphaned = 1`); a replicated row's copy is never written or read. Migration `0019_chosen_status`, which also copies `status` into it, under the same rule, for accounts that are idle or dnd at upgrade time |
| customStatus | text | | |
| customStatusExpiresAt | integer | | When the custom status clears itself (epoch ms), or NULL to keep it until changed. Set by `PATCH /api/users/@me` from `customStatusExpiresInMinutes` (1 to 10080, counted from the save). `utils/customStatusExpiry.ts` clears it every minute and tells the owner and the profile audience (`user_updated`). Sent only to the owner. Migration `0033_orbit_status_expiry_and_blocks` |
| isAdmin | integer | 0 | Only `tavvit-admin` and other administrators set it |
| homeInstance | text | | Federation origin URL (null = local) |
| homeUserId | text | | Canonical ID on home instance |
| replicatedInstances | text | `'[]'` | JSON array of instance URLs |
| banner | text | | Upload filename |
| accentColor | text | | Hex color |
| avatarColor | text | | Hex color |
| bio | text | | |
| pronouns | text | | Shown after the username on the profile card; stored as `normalizePronouns` returns it. Migration `0040_orbit_roles_profiles` |
| profileLinks | text | | JSON list of up to 5 `{ url, label }` (`normalizeProfileLinks`); NULL for none. Read back with `parseStoredProfileLinks`, which drops anything unreadable. Migration 0040 |
| profileLayout | text | | `centered` or `compact`; NULL is the standard layout. Migration 0040. See auth.md, "Profile fields" |
| avatarFrame | text | | The frame round the picture, a name in `AVATAR_FRAMES` (packages/shared/src/decorations.ts); NULL for none. Migration `0073_tavvit_profile_decorations`. See decorations.md |
| profileEffect | text | | The effect over the banner, a name in `PROFILE_EFFECTS`; NULL for none. Migration 0073 |
| nameplate | text | | The nameplate behind the name in lists, a name in `NAMEPLATES`; NULL for none. Migration 0073 |
| nameFont | text | | The name's typeface, a name in `NAME_FONTS` other than `classic`; NULL for the interface's own. Migration 0073 |
| spaceTag | text | | The space tag the person wears: JSON `{ spaceId, text, glyph, color }`, a copy of a space's tag of this instance, kept in step with it (utils/spaceTags.ts); NULL for none. Migration `0074_tavvit_space_tags_voice_overlays`. See space-tags.md |
| nameEffect | text | | The light inside the name's letters, a name in `NAME_EFFECTS`; NULL for none. Migration 0073. Only `PATCH /api/users/@me` writes these five, each checked against its list (`decorationUpdateOf`); read back through `decorationsOf`, which shows a name it does not know as none; cleared by `tombstoneUser`. Since 1.38.0 `avatarFrame`, `profileEffect`, `nameplate` and `nameEffect` may also hold `custom:<id>`, a design someone made (`custom_decorations` below), which every `User` carries drawn out in `customDecorations` |
| badges | text | | JSON array of the badges an instance admin granted the person (`GrantedUserBadgeId`, the registry in `packages/shared/src/badges.ts`), in the registry's order, each once; NULL for none. Written only by `PUT /api/admin/users/:id/badges`. Read through `grantedUserBadgesOf` (`utils/badges.ts`), which drops anything the registry does not know as a granted user badge, so a hand-edited row cannot hand out `staff`; staff is not stored but derived from `isAdmin` (`userBadgesOf`). Migration `0041_orbit_platform_admin` |
| suspendedAt | integer | | When an instance admin suspended the account (epoch ms); NULL when no suspension is recorded. The account is suspended while this is set and `suspendedUntil` is NULL or later than now (`activeSuspension`, `utils/suspension.ts`; `suspendedNow` is the same condition in SQL): it cannot sign in, call an authenticated route or hold a socket (auth.md, "Suspensions"). Migration 0041 |
| suspendedUntil | integer | | When the suspension ends by itself (epoch ms); NULL until an admin lifts it. Nothing runs when it passes: every check compares it with the clock, and the three columns stay set until `/unsuspend` clears them |
| suspensionReason | text | | The admin's reason, 3-500 characters; the account's owner reads it when the sign-in refuses them. Set with the other two by `POST /api/admin/users/:id/suspend`, cleared with them by `POST /api/admin/users/:id/unsuspend`; the history is in `platform_audit_log`. Migration 0041 |
| isDeleted | integer | 0 | Soft-delete flag |
| profileUpdatedAt | integer | | Epoch ms |
| passwordChangedAt | integer | | Token revocation: tokens before this rejected |
| showActivity | integer NOT NULL | 1 | Rich presence visibility |
| federationRegistryUpdatedAt | integer | 0 | LWW timestamp for federation registry sync |
| federationHealPending | integer | 0 | Instance-epoch self-healing: set when a replicated identity is flagged for re-heal after a peer reset |
| federationHomeOrphaned | integer | 0 | Instance-epoch self-healing: **1 = DETACHED / sovereign local account** (its home instance was reset/lost), not "frozen." **Set** to 1 by `quarantineOrphanedAccounts` on every real account from a reset home incarnation (flag-only detach — no rename, no login block). **Read** by: the login flow (self-heal path permanently disabled for detached rows; local-password login still works — `auth.md` §4), `users.ts` (unlocks local profile edit + local change-password), the S2S binding guards (`findFederatedUser` tier-2, `profile_update`, identity-delete all exclude detached rows — `federation.md`), and the `GET /api/federation/reset-events` admin surface. Cleared by `tombstoneUser` (deletion) and by re-attach. Detach spec §3/§4. Since #310 a detached row is homed here: `home_instance`/`home_user_id` are NULL and its former identity is in the two columns below |
| detachedHomeInstance | text | | The home instance a detached account was federated from (`federation.md`, "Detached accounts are homed here"). Detaching (`rehomeDetachedAccount`) moves `home_instance` here and clears it, so the account presents itself to peers as one of this instance's users. Read by `resolveRelayActor` (a reference to the former identity resolves to the row), `resolveOrCreateReplicatedUser`'s deleted-identity check, the sync page's friend relevance, re-attach (the home it re-attaches to), the reset-cleanup listing (`detachedHomeInstanceMatch`) and the self-view (`User.detachedHomeInstance`). Cleared by re-attach; kept on a tombstone. Migration `0025_detached_identity` |
| detachedHomeUserId | text | | The account's id on its former home, moved from `home_user_id` with `detachedHomeInstance`. Same readers. |
| createdAt | integer NOT NULL | | Epoch ms |

**Index:** `idx_users_home_user_id` on `(home_user_id)` (migration `0020_users_home_user_id_index`). Every federated identity lookup (`resolveRelayActor`, `resolveLocalUser`, the relay's participant, author and mention resolution) filters on `home_user_id` first. It is a single-column index on purpose: a home user id matches about one row, and most pair lookups compare `home_instance` normalized (scheme stripped, lowercased) or in code, where a `(home_user_id, home_instance)` composite's second column cannot be used.

**Index:** `idx_users_detached_home_user_id` on `(detached_home_user_id)` (migration `0025_detached_identity`). `resolveRelayActor` matches a detached account's former identity in the same query as `home_user_id`.

**Dropped:** `discoverable` (integer, default 1, "visible in the user directory") was removed by migration `0042_orbit_drop_discoverable` (`ALTER TABLE users DROP COLUMN discoverable`), with the Discover People list that read it. People are found by their exact username or its start only (`GET /api/social/search`, api.md "Social"), and there is no flag to opt out of that.

#### Detached identity (0025)
Adds `detached_home_instance`, `detached_home_user_id` and their index. The data rewrite for accounts detached before it is not in the SQL: it needs this instance's origin (group DM owner identity) and the 1-on-1 key re-derivation, so `initDatabase` runs `rehomeDetachedAccountsOnBoot` after the migrations (idempotent; a pre-change snapshot is taken only when a row qualifies).

### spaces
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| name | text NOT NULL | | |
| icon | text | | Upload filename |
| banner | text | | Upload filename |
| avatarColor | text | | Hex color |
| ownerId | text NOT NULL | | FK → users.id |
| ownerTitle | text | | The owner title: the heading over the owner's group in the member list, set by the owner alone (migration `0030_space_owner_title`). Null shows the translated default ("Owner"). Stored as `normalizeOwnerTitle` returns it. Cleared when ownership is transferred. See [spaces.md](spaces.md), "Owner title". |
| inviteCode | text UNIQUE | | |
| visibility | text | `'private'` | public/request/private. Public or request alone no longer lists a space in Discovery: that takes `discoveryStatus = 'approved'` as well |
| description | text | | |
| directoryListed | integer NOT NULL | 0 | The owner asked for this space to be listed in the space directory. Refused on a private space (`400 directory_private_space`) and cleared in the same write when a listed space goes private. Served on `GET /api/directory/spaces` only while the space is listed in Discovery (`discoveryStatus = 'approved'`, public or request) and `instance_settings.directoryEnabled` and `discoveryEnabled` are both 1. See [directory.md](directory.md). |
| badges | text | | JSON array of the badges an instance admin granted the space (`GrantedSpaceBadgeId`), in the registry's order, each once; NULL for none. Written only by `PUT /api/admin/spaces/:id/badges`, read through `grantedSpaceBadgesOf`. `verified` is not stored here: it is derived from `verificationStatus` (`spaceBadgesOf`). Migration `0041_orbit_platform_admin` |
| tag | text | | The tag its members can wear: JSON `{ text, glyph, color }` (shared/src/spaceTags.ts), NULL for none. Set with `PATCH /api/spaces/:id` (MANAGE_SPACE). Migration `0074_tavvit_space_tags_voice_overlays`. See space-tags.md |
| verificationStatus | text | | The platform's verification of the space: NULL while never requested (and after the owner withdrew a request), else `pending`, `needs_info`, `verified`, `rejected` or `revoked` (`VERIFICATION_STATUSES`, `packages/shared/src/platform.ts`). Only `verified` gives the space the verified badge. The one status field: the request is in `space_verification_requests`, every step in `space_review_events`. Written by `utils/spaceReview.ts`, and by `PATCH /api/spaces/:id` and `PATCH /api/spaces/:id/transfer-ownership`, which set `pending` when a verified space is renamed or changes owner (`reviewsAfterEdit`, `reviewsAfterTransfer`). Migration 0041 |
| discoveryStatus | text | | An instance admin's approval of the space's Discovery listing: NULL while never submitted, else `pending`, `changes_requested`, `approved`, `rejected` or `withdrawn` (`DISCOVERY_STATUSES`). A space is listed (Explore, the directory document, the admin overview) only while this is `approved` and `visibility` is public or request (`LISTED_IN_DISCOVERY_SQL`, `utils/discoveryListing.ts`); nothing the owner sets alone lists it. Written by `utils/spaceReview.ts`, and by `PATCH /api/spaces/:id` in the same update as an edit: `pending` when an approved space's name, description, icon or banner changes, `withdrawn` when an approved or open one is made private (`reviewsAfterEdit`); an open request's `requested_at` moves to the time of such an edit. Migration 0041, which set `pending` on every public or request space (see "Platform administration (0041)") |
| defaultNotificationLevel | text | | The notification level members start with until they choose their own: `all` or `mentions`; NULL keeps the built-in default (`mentions`). Set with `PATCH /api/spaces/:id`, read by the clients only. Migration `0039_orbit_space_moderation`. See [spaces.md](spaces.md), "Moderation" |
| ownerGroup | integer NOT NULL | 0 | 1 lists the owner in a group of their own at the top of the member list, 0 under their own roles with a crown. Set by the owner alone. Migration `0040_orbit_roles_profiles`, which sets 1 on every space whose `ownerTitle` was set. See [spaces.md](spaces.md), "Ownership and roles" |
| createdAt | integer NOT NULL | | |

### space_members
PK: (spaceId, userId)
| Column | Type | Notes |
|--------|------|-------|
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| nickname | text | Per-space display name |
| avatar | text | The member's picture for this space (upload filename on this instance); NULL shows the account's. Migration 0040. See [spaces.md](spaces.md), "Space profiles" |
| banner | text | The member's banner for this space; NULL shows the account's. Migration 0040 |
| bio | text | The member's about text for this space, at most 190 characters; NULL shows the account's. Migration 0040 |
| joinedAt | integer NOT NULL | Also the start of the membership age the space's minimum (`minMemberAgeMinutes`) is measured from |
| timedOutUntil | integer | While in the future (epoch ms, the server's clock) the member is timed out; NULL or a past time otherwise. Set and cleared by `PUT`/`DELETE /api/spaces/:id/members/:uid/timeout`, cleared for the new owner by an ownership transfer, put back from `space_departed_timeouts` when a member who left timed out joins again. Migration `0039_orbit_space_moderation` |

### channel_categories
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| name | text NOT NULL | | |
| position | integer | 0 | |
| createdAt | integer NOT NULL | | |

### channels
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| name | text NOT NULL | | |
| type | text NOT NULL | | text/voice |
| topic | text | | |
| position | integer | 0 | |
| categoryId | text | | Soft FK → channel_categories |
| slowmodeSeconds | integer NOT NULL | 0 | Slow mode: seconds a member waits between two messages here, one of `SLOWMODE_SECONDS`; 0 is off. Migration `0039_orbit_space_moderation`; see `channel_slowmode_posts` |
| icon | text | | Its own icon in place of its type's: `glyph:<id>` or one emoji (`normalizeChannelIcon`); null for the type's. Migration `0068_tavvit_channel_icons`; see [spaces.md](spaces.md), "Channel icons" |
| createdAt | integer NOT NULL | | |

### channel_slowmode_posts
PK: (channelId, userId). Migration `0039_orbit_space_moderation`.
| Column | Type | Notes |
|--------|------|-------|
| channelId | text NOT NULL | FK → channels.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| postedAt | integer NOT NULL | When the member last posted here while slow mode was on (epoch ms) |

Written in the transaction that stores each accepted message while the channel's `slowmodeSeconds` is above 0 (`recordSlowmodePost` in `utils/spaceModeration.ts`), read by the slow mode check, and emptied for a channel whose slow mode is switched off. A table rather than an index on `messages (channel_id, user_id, created_at)`: the wait survives the member deleting their message and a restart, and the messages table carries no extra index on every write. See [spaces.md](spaces.md), "Moderation", "Slow mode".

### messages
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| channelId | text NOT NULL | FK → channels.id CASCADE |
| userId | text NOT NULL | FK → users.id |
| replyToId | text | FK → messages.id SET NULL |
| content | text | For a system row, JSON (`channelSystemEvents.ts`) |
| type | text NOT NULL, default `'user'` | `user` (a member wrote it) or `system` (the instance wrote it; a poke is the only one so far, websocket.md "Channel pokes"). Migration `0029_persistent_channel_pokes` |
| editedAt | integer | |
| createdAt | integer NOT NULL | |

A system row's `userId` is the member who acted (the poker). `userWrittenMessages()` in `db/userWrittenMessages.ts` is the one condition for "a message a member wrote": the unread counts, the last message id in `ready`, channel search and the reply target check all take it, so a system row is never unread, never found by a search and never replied to.

Indexes: `idx_messages_channel_id` (channelId); `idx_messages_user_id` (userId); `idx_messages_channel_unread` (channelId, `CAST(id AS INTEGER)`, userId, type), created by migration `0027_unread_count_indexes` and given `type` by `0029_persistent_channel_pokes`. The last one serves the unread counts (websocket.md, "Unread counts"): the messages members wrote in a channel after a read cursor, compared as numbers, without reading the table. SQLite uses an expression index only when the query spells the expression the same way, type name case included, so the count writes `CAST(... AS INTEGER)`; the index names the column unqualified because SQLite refuses a qualified one there.

### attachments
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| messageId | text | | FK → messages.id CASCADE |
| dmMessageId | text | | FK → dm_messages.id CASCADE |
| uploaderId | text | | User who uploaded |
| filename | text NOT NULL | | Stored filename |
| originalName | text NOT NULL | | User-facing name |
| mimetype | text NOT NULL | | |
| size | integer NOT NULL | | Bytes |
| thumbnailFilename | text | | Generated thumbnail |
| width | integer | | Image/video pixel width |
| height | integer | | Image/video pixel height |
| duration | real | | Audio/video seconds |
| playable | integer (boolean) | NULL | Video web-playability tri-state: 1 = browser-decodable, 0 = known-undecodable (e.g. HEVC .mov), NULL = unknown/non-video. See uploads.md §3. |
| sourceUrl | text | | Remote URL (federation) |
| federationStatus | text | | local/remote/remote_partial |
| federationMeta | text | | JSON rejection info |
| createdAt | integer NOT NULL | | |
CHECK: exactly one of messageId/dmMessageId is set

### sticker_assets and personal_stickers

Migration `0031_personal_stickers` adds only these two tables; message and reaction columns are unchanged (a sticker is a token in `content` or `emoji`, see [uploads.md](uploads.md#14-personal-stickers)).

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| sticker_assets | id | text PK NOT NULL | SHA-256 of the encoded WebP bytes |
| sticker_assets | created_at | integer NOT NULL | Epoch ms of the latest upload of these bytes; set before the file is written, and the start of the cleanup's 24-hour grace period |
| personal_stickers | user_id | text NOT NULL | FK → users.id, ON DELETE CASCADE |
| personal_stickers | sticker_id | text NOT NULL | FK → sticker_assets.id |
| personal_stickers | name | text NOT NULL | User’s collection label |
| personal_stickers | created_at | integer NOT NULL | Epoch ms |

The composite primary key (user_id, sticker_id) makes collection idempotent; one user holds at most 200 rows (`MAX_PERSONAL_STICKERS`, checked by the routes). Removing an entry or deleting its user removes only the association. An asset stays while any collection entry, space sticker (`space_stickers`, migration 0071), message or reaction on this instance names it; after that, and once past its grace period, the storage cleanup deletes the row and its file (`cleanupUnusedStickerAssets`). Files live under `UPLOAD_DIR/stickers`, outside the attachment phases and the storage stats.

### custom_emojis

The instance's emoji library (migration `0036_orbit_custom_emoji`). The picture is `UPLOAD_DIR/emoji/<id>.webp`, outside the attachment phases and the storage stats; deleting the row deletes the file, and a file no emoji names is swept ([uploads.md](uploads.md#unused-emoji-files)). A space's own emoji are in `space_emojis` (migration 0071), with ids from the same generator, so an id names one emoji of either kind.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK NOT NULL | | Snowflake |
| name | text UNIQUE NOT NULL | | `[a-z0-9_]`, 2 to 32 characters (`normalizeEmojiName`). Unique in the library (`custom_emojis_name_unique`); a space's emoji may have the same name |
| animated | integer NOT NULL | 0 | 1 when the stored WebP has more than one frame |
| size | integer NOT NULL | | Bytes of the stored WebP, at most 256 KiB. Counted on nobody's storage |
| created_by | text | | FK → users.id SET NULL. Whoever added it may rename or remove it, as may the administrators. Since 1.34.0 `tombstoneUser` clears it too: a tombstone keeps the `users` row, so the foreign key's action never fires |
| created_at | integer NOT NULL | | Epoch ms |

Index: `idx_custom_emojis_created_by` (created_by). A person who is not an administrator adds at most 50 (`CUSTOM_EMOJI_LIMITS.MAX_PER_USER`), and the library holds at most 500 (`MAX_TOTAL`), both checked by the route. Who may add at all is `instance_settings.emoji_policy`.

### embeds
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| messageId | text | FK → messages.id CASCADE |
| dmMessageId | text | FK → dm_messages.id CASCADE |
| url | text NOT NULL | |
| embedType | text NOT NULL | generic/video/image/audio/rich/post |
| provider | text | youtube/vimeo/spotify/bluesky/null |
| title | text | |
| description | text | |
| image | text | Thumbnail/og:image URL |
| embedUrl | text | iframe-safe URL |
| width | integer | |
| height | integer | |
| color | text | |
| data | text | JSON of a `post` embed's card: a `BlueskyPost` (packages/shared/src/bluesky.ts), read back through `blueskyPostOf`; null for every other kind (migration 0076, additive) |
| createdAt | integer NOT NULL | |
CHECK: exactly one of messageId/dmMessageId is set

### reactions
PK: id
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| messageId | text NOT NULL | FK → messages.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| emoji | text NOT NULL | |
| createdAt | integer NOT NULL | |

Indexes: `idx_reactions_message_id` (messageId); `idx_reactions_message_user_emoji` UNIQUE (messageId, userId, emoji), one reaction per user and emoji on a message. Writers insert with `ON CONFLICT DO NOTHING` and treat no row written as "already reacted" (`reaction_add` in `ws/events.ts`). See "Reaction uniqueness (0024)" below.

---

## DM Tables

### dm_channels
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| ownerId | text | | NULL for 1-on-1, set for group |
| federatedId | text | | Conversation key, UNIQUE (`idx_dm_federated`). Every 1-on-1 holds its pair key from insert (and from the startup backfill); a group holds a minted UUID once a member is homed elsewhere, NULL before |
| ownerHomeUserId | text | | Owner's canonical home ID |
| ownerHomeInstance | text | | Owner's home instance URL |
| deletedAt | integer | | Soft-delete (GC after 24h if no local members) |
| createdAt | integer NOT NULL | | |
| name | text | | Group DM custom name. NULL = use comma-joined member fallback. Owner-only writes. |
| icon | text | | Group DM custom icon. NULL = use AvatarStack fallback. Owner instance stores bare filename; receivers store bare filename on download success or absolute URL on fallback. |
| metadataUpdatedAt | integer NOT NULL | 0 | Server-side version vector for `group_metadata_update` federation dedup. Captured at the moment of the owner-instance DB write; default 0 means "any rename wins". |

### dm_members
PK: (dmChannelId, userId)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| dmChannelId | text NOT NULL | | FK → dm_channels.id CASCADE |
| userId | text NOT NULL | | FK → users.id CASCADE |
| closed | integer | 0 | Soft-close flag |
| closedChangedAt | integer NOT NULL | 0 | When `closed` took its value: insertion or local change (local clock), or a relayed close/reopen's timestamp. Last-writer-wins against relayed close/reopen; written only by `utils/dmMemberClosed.ts` (dm-system.md "Closed state is last-writer-wins"). Rows present at migration 0022 were stamped with the migration time |

### dm_messages
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| dmChannelId | text NOT NULL | | FK → dm_channels.id CASCADE |
| userId | text NOT NULL | | FK → users.id |
| replyToId | text | | FK → dm_messages.id SET NULL |
| content | text | | |
| type | text NOT NULL | `'user'` | user/system |
| editedAt | integer | | |
| sourceInstance | text | | Federation source origin |
| sourceMessageId | text | | Original ID on source instance |
| encryptionVersion | integer | 0 | |
| createdAt | integer NOT NULL | | |

Indexes: `idx_dm_messages_dm_channel_id` (dmChannelId); `idx_dm_messages_user_id` (userId); `idx_dm_messages_source_unique` UNIQUE (sourceInstance, sourceMessageId) where sourceInstance is set; `idx_dm_messages_channel_unread` (dmChannelId, `CAST(id AS INTEGER)`, userId), migration `0027_unread_count_indexes`, as `idx_messages_channel_unread` above.

### dm_reactions
PK: id
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| dmMessageId | text NOT NULL | FK → dm_messages.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| emoji | text NOT NULL | |
| createdAt | integer NOT NULL | |

Indexes: `idx_dm_reactions_dm_message_id` (dmMessageId); `idx_dm_reactions_message_user_emoji` UNIQUE (dmMessageId, userId, emoji). Both writers, the local `reaction_add` and the relayed one (`processReactionAddEvent`, live delivery and the catch-up pull alike), insert with `ON CONFLICT DO NOTHING`; a relayed add that writes nothing is accepted as already held.

#### Reaction uniqueness (0024)
The squashed baseline (0000) created both reaction tables without a unique key; only pre-squash installs had one, as an inline `UNIQUE(message_id, user_id, emoji)` / `UNIQUE(dm_message_id, user_id, emoji)` from the old hand-written statements. On installs created after the squash the same user's reaction could be stored several times (#393). Migration `0024_reaction_unique` first deletes the repeats, keeping per key the row with the lowest `created_at` and, of equally early rows, the lowest `rowid` (any one of equal rows would do; the rowid only makes the choice definite), then creates the two named unique indexes. On a pre-squash install there are no repeats, and the named index is created beside the inline constraint (`sqlite_autoindex_*`), which stays.

---

## Social Tables

### friends
PK: (userId, friendId)
| Column | Type | Notes |
|--------|------|-------|
| userId | text NOT NULL | FK → users.id CASCADE |
| friendId | text NOT NULL | FK → users.id CASCADE |
| createdAt | integer NOT NULL | |

### user_blocks
PK: (blockerId, blockedId). Migration `0033_orbit_status_expiry_and_blocks`. See `utils/blocks.ts` for what a block does.
| Column | Type | Notes |
|--------|------|-------|
| blockerId | text NOT NULL | FK → users.id CASCADE; the person who blocked |
| blockedId | text NOT NULL | FK → users.id CASCADE; index `idx_user_blocks_blocked_id` |
| createdAt | integer NOT NULL | |

### friend_requests
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| fromId | text NOT NULL | | FK → users.id CASCADE |
| toId | text NOT NULL | | FK → users.id CASCADE |
| status | text | `'pending'` | pending/accepted/declined |
| createdAt | integer NOT NULL | | |

---

## Badge Tables (removed)

Migration `0034_orbit_badges` added `badges` and `user_badges`; migration `0038_orbit_drop_badges` dropped both. Badges came back with migration `0041_orbit_platform_admin`, without tables: the registry is code (`packages/shared/src/badges.ts`), and a badge is either derived from server state (`staff` from `users.is_admin`, `verified` from `spaces.verification_status`, a member's `administrator` or `moderator` from their role bits in the space, worked out when the member is sent) or granted by an instance admin and stored as a JSON array in `users.badges` or `spaces.badges`. Nothing a space's roles or a client send can set one.

## RBAC Tables

### roles
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| name | text NOT NULL | | |
| color | text | `'#b9bbbe'` | Hex |
| position | integer | 0 | Hierarchy rank: @everyone 0, other roles distinct from 1 up, higher is more senior (permissions.md, "Role hierarchy") |
| permissions | text | | Bigint decimal string |
| description | text | | What the role is for, at most 200 characters. Migration `0040_orbit_roles_profiles` |
| colorSecondary | text | | Hex; with it, names in the role's colours are a gradient from `color` to it. Migration 0040 |
| icon | text | | An emoji (or a short sequence of them) shown with the role. Migration 0040 |
| hoist | integer NOT NULL | 1 | Members whose top shown role this is get their own member list group. Migration 0040 |
| mentionable | integer NOT NULL | 0 | Anyone may mention the role without MENTION_EVERYONE. Migration 0040. See permissions.md, "Role display" |
| createdAt | integer NOT NULL | | |

Migration `0040_orbit_roles_profiles` only adds columns (to `roles`, `spaces`, `space_members` and `users`) and sets `spaces.owner_group`; no existing value changes.

### member_roles
PK: (spaceId, userId, roleId)
All columns FK CASCADE to their respective tables.

### channel_overrides
PK: (channelId, targetType, targetId)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| channelId | text NOT NULL | | FK → channels.id CASCADE |
| targetType | text NOT NULL | | role/member |
| targetId | text NOT NULL | | Role ID or user ID |
| allow | text NOT NULL | `'0'` | Bigint decimal string |
| deny | text NOT NULL | `'0'` | Bigint decimal string |

### category_overrides
PK: (categoryId, targetType, targetId)
Same structure as channel_overrides, with categoryId FK → channel_categories.id CASCADE.

Neither override table nor `roles` stores an edit version. The version a
concurrent-edit check compares (`overrideVersion`, `rolePermissionsVersion`)
is derived from `allow`/`deny` and `permissions` themselves, so it needs no
column and no migration (permissions.md, "Concurrent edits").

---

## State Tables

### read_states
PK: (userId, channelId)
| Column | Type | Notes |
|--------|------|-------|
| userId | text NOT NULL | FK → users.id CASCADE |
| channelId | text NOT NULL | Channel or DM channel ID |
| lastReadMessageId | text NOT NULL | |
| updatedAt | integer NOT NULL | |

### notification_settings
A user's notification setting for a space (`channelId` NULL) or for one channel of it (migration `0026_notification_settings`). Stored on the instance that hosts the space and keyed by the user's row **on this instance**: for a federated member that is their account here, never a home id. Read and written only through `routes/notificationSettings.ts` (api.md, "Notification settings"); what the values do is in sounds.md ("Notification settings").

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| userId | text NOT NULL | | FK → users.id CASCADE |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE. Set on channel rows too, so a space's rows go with it |
| channelId | text | | FK → channels.id CASCADE. NULL = the space-wide row |
| level | text | | `all` / `mentions` / `nothing`; NULL = not chosen (a channel inherits its space, a space uses `mentions`) |
| muted | integer NOT NULL | 0 | 1 = muted |
| mutedUntil | integer | | Epoch ms (server clock) a timed mute ends; NULL with `muted = 1` = until lifted. An ended mute is read as none and dropped at the next write |
| suppressEveryone | integer NOT NULL | 0 | 1 = `@everyone` and `@here` do not alert on `mentions` (space rows only; migration `0028_mass_mention_preferences`) |
| suppressRoles | integer NOT NULL | 0 | 1 = role mentions do not alert on `mentions` (space rows only; migration `0028_mass_mention_preferences`) |
| updatedAt | integer NOT NULL | | Server write time, strictly increasing per row; clients merge last-write-wins on it |

**Indexes:** `idx_notification_settings_space_row` UNIQUE `(user_id, space_id) WHERE channel_id IS NULL` and `idx_notification_settings_channel_row` UNIQUE `(user_id, channel_id) WHERE channel_id IS NOT NULL`: one space row and one row per channel, per user. Two partial indexes because a plain unique index never treats two NULL `channel_id`s as equal. No primary key: the rowid is the row's identity.

A row with nothing chosen (level NULL, not muted and neither suppress flag set) is deleted rather than stored. The suppress flags are written only on the space row: the channel route refuses them, so a channel row always holds 0. Rows are kept when the user leaves the space or loses sight of the channel (the list route filters them out), so they apply again on rejoin.

### space_folders
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| userId | text NOT NULL | | FK → users.id CASCADE |
| name | text | | |
| color | text | | |
| position | integer | 0 | |
| createdAt | integer NOT NULL | | |

### space_folder_members
PK: (folderId, spaceId)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| folderId | text NOT NULL | | FK → space_folders.id CASCADE |
| spaceId | text NOT NULL | | May be federated (no local FK) |
| position | integer | 0 | |

### user_space_layout
PK: userId
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| userId | text PK | | FK → users.id CASCADE |
| layout | text NOT NULL | `'[]'` | JSON array of {t:'s',id} | {t:'f',id} |
| updatedAt | integer NOT NULL | | |

---

## Moderation Tables

### bans
PK: (spaceId, userId)
| Column | Type | Notes |
|--------|------|-------|
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| reason | text | |
| bannedBy | text | FK → users.id |
| createdAt | integer NOT NULL | |

### join_requests
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| userId | text NOT NULL | | FK → users.id CASCADE |
| message | text | | |
| status | text NOT NULL | `'pending'` | pending/accepted/declined |
| decidedBy | text | | FK → users.id |
| createdAt | integer NOT NULL | | |
| decidedAt | integer | | |

### voice_restrictions
PK: (spaceId, userId, restrictionType)
| Column | Type | Notes |
|--------|------|-------|
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| restrictionType | text NOT NULL | mute/deafen |
| moderatorId | text | FK → users.id |
| createdAt | integer NOT NULL | |

#### Space moderation (0039)
Migration `0039_orbit_space_moderation` adds the four tables below, `spaces.default_notification_level`, `channels.slowmode_seconds` and `space_members.timed_out_until` (with `channel_slowmode_posts` above). It only adds: every new column is nullable or has a default, so existing rows, raw inserts and fixtures that name only the older columns keep working. What the rows mean is in [spaces.md](spaces.md), "Moderation".

### space_moderation_settings
A space's automatic message rules (`SpaceModerationSettings`). A space without a row has the defaults. Written only by `PATCH /api/spaces/:id/moderation` (`writeModerationSettings`), as `normalizeModerationSettings` returns the change.
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| spaceId | text PK | | FK → spaces.id CASCADE |
| blockedWords | text NOT NULL | `'[]'` | JSON array of the stored entries (trimmed, deduplicated without case, at most 100 of at most 48 characters) |
| blockLinks | integer NOT NULL | 0 | 1 = refuse web links |
| blockInvites | integer NOT NULL | 0 | 1 = refuse space invite links |
| maxMentions | integer NOT NULL | 0 | Most user and role mentions in one message; 0 = no limit |
| minAccountAgeMinutes | integer NOT NULL | 0 | 0 = off |
| minMemberAgeMinutes | integer NOT NULL | 0 | 0 = off |
| updatedAt | integer NOT NULL | | Epoch ms of the last change; the API sends `updatedAt: null` for a space without a row |

### space_audit_log
One row per recorded change, written only through `recordAudit` (`utils/auditLog.ts`), which never fails the request that made the change.
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Snowflake (`generateSnowflake`, as messages), so ids sort by time and page the log |
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| actorId | text NOT NULL | The acting user's row id here. No foreign key: an entry outlives its actor |
| action | text NOT NULL | One of `AUDIT_LOG_ACTIONS` |
| targetType | text | `AuditLogTargetType`: space, channel, category, role, member, message, invite, join_request |
| targetId | text | The target's id |
| targetLabel | text | The target's name when the entry was written |
| changes | text | JSON `AuditLogChange[]`, NULL when the entry records no field |
| reason | text | A ban's or a timeout's reason |
| createdAt | integer NOT NULL | Epoch ms |

**Indexes:** `idx_space_audit_log_space_page` on `(space_id, CAST(id AS INTEGER))`, the order `GET /api/spaces/:id/audit-log` pages in (newest first; ids compared as numbers, written exactly so in the query as for `idx_messages_channel_unread`); `idx_space_audit_log_space_created` on `(space_id, created_at)` for the retention sweep. **Retention:** 180 days, swept per space from `recordAudit` at most once an hour.

### space_departed_timeouts
PK: (spaceId, userId). The running timeout of a member who left or was kicked, so that joining again does not lift it.
| Column | Type | Notes |
|--------|------|-------|
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| timedOutUntil | integer NOT NULL | When the timeout ends (epoch ms) |

Written by `holdDepartingTimeout` just before the member row is deleted (which also drops the space's holds that have ended), read and deleted by `restoreHeldTimeout` on every join path, which puts a hold still running back on the new `space_members` row. A ban writes none, and deletes any hold the user left behind (`dropHeldTimeout` in `utils/spaceModeration.ts`).

---

## Platform Administration Tables

What the instance's administrators decide over accounts and spaces, apart from anything a space's roles allow (admin.md, "Platform administration"; api.md, "Platform administration"). A space's two reviews, Verification and Discovery approval, each keep one status column on `spaces` (`verification_status`, `discovery_status`), one request row per space, and a shared history; the platform audit log records the admins' actions. `utils/spaceReview.ts` is the only writer of the review tables, and the routes that call it decide who may act (the owner by `spaces.owner_id`, an admin by `users.is_admin`).

#### Platform administration (0041)
Migration `0041_orbit_platform_admin` creates the four tables below and adds `users.badges`, `users.suspended_at`, `users.suspended_until`, `users.suspension_reason`, `spaces.badges`, `spaces.verification_status` and `spaces.discovery_status`, all nullable and without defaults, so existing rows and raw inserts that name only the older columns keep working.

Its data step moves every space that was listed before approvals existed into review, rather than keeping it listed or dropping it. Every space whose `visibility` is `public` or `request`, whatever `instance_settings.discovery_enabled` and its own `directory_listed` say, gets `discovery_status = 'pending'`, a `space_discovery_requests` row (category `other`, requested by its owner at the migration's time in whole seconds, no decision) and a `space_review_events` row with the id `migrated:<spaceId>`, process `discovery`, action `migrated`, status `pending` and the owner as actor. Its visibility and `directory_listed` are kept; it is hidden from Explore and the directory document until an admin approves it, and the owner can name its category by sending the request again. Last, the migration sets `instance_settings.directory_dirty = 1`, so the pinger's boot ping tells the hub, where one is configured, that the served document shrank.

Migration `0042_orbit_drop_discoverable` drops `users.discoverable` (see "users").

### space_verification_requests
A space's verification request, one row per space: the owner's `PUT /api/spaces/:id/verification` inserts it or, sent again, replaces every field and clears the decision (`submitVerification`, an upsert on `space_id`). The status is `spaces.verification_status`; the steps are in `space_review_events`.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| spaceId | text PK | | FK → spaces.id CASCADE |
| name | text NOT NULL | | The space's name when the request was sent |
| description | text | | The space's description when the request was sent |
| category | text NOT NULL | | One of `SPACE_CATEGORIES` (`packages/shared/src/platform.ts`); an unknown stored value reads as `other` |
| website | text | | An `http`/`https` address without credentials, at most 200 characters once normalised; never fetched |
| profiles | text NOT NULL | `'[]'` | JSON array of up to 5 public profile addresses under the same rule, each once |
| reason | text NOT NULL | | Why the space should be verified, 20-1000 characters |
| proof | text NOT NULL | | How the requester shows they run the community (a public post, a page, a contact the reviewer can check), 10-1000 characters |
| requestedBy | text NOT NULL | | The owner's row id. No foreign key |
| requestedAt | integer NOT NULL | | Epoch ms. An admin's decision may name it (`requestedAt` in the body) to be refused once the request was sent again |
| decidedBy | text | | The deciding admin's row id; NULL until decided and after a resubmission |
| decidedAt | integer | | |
| decisionNote | text | | The admin's note, which the owner reads |

### space_discovery_requests
A space's Discovery request, one row per space: the owner's `PUT /api/spaces/:id/discovery` inserts it or, sent again, replaces the category and the requester and clears the decision (`submitDiscovery`). The status is `spaces.discovery_status`.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| spaceId | text PK | | FK → spaces.id CASCADE |
| category | text NOT NULL | | One of `SPACE_CATEGORIES`; `other` on the rows migration 0041 wrote. Explore carries it as `ExploreSpace.category` |
| requestedBy | text NOT NULL | | The owner's row id. No foreign key |
| requestedAt | integer NOT NULL | | Epoch ms |
| decidedBy | text | | The deciding admin's row id |
| decidedAt | integer | | |
| decisionNote | text | | The admin's note |
| approvedSnapshot | text | | JSON `{ name, description, icon, banner, category }` as an admin approved the listing: written by every Discovery `approve`, kept by the other decisions and by a resubmission, NULL until the first approval. Nothing reads it back: the re-review after an edit compares the edit with the row it changes (`reviewsAfterEdit`) |

### space_review_events
The history of both reviews: every request, withdrawal, decision and automatic change of a space's verification or Discovery status, which the owner and the admins both read (`reviewStateOf`, oldest first by `created_at`, then `id`). Rows are only inserted.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | Snowflake (`generateSnowflake`); `migrated:<spaceId>` on the rows migration 0041 wrote |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| process | text NOT NULL | | `verification` / `discovery` |
| action | text NOT NULL | | One of `REVIEW_ACTIONS`: `submit`, `withdraw` (the owner's); `approve`, `reject`, `request_info`, `request_changes`, `revoke`, `admin_withdraw` (an admin's); `changed` (an edit moved the Discovery status); `migrated` (0041). A row with an action this version does not know is left out when read |
| status | text | | The status the step left; NULL when it left none (a withdrawn verification request) |
| actorId | text NOT NULL | | Who took the step: the owner, the admin, the member whose edit moved the status, the owner for a migrated row. No foreign key |
| note | text | | The admin's note; NULL for every other step |
| createdAt | integer NOT NULL | | Epoch ms |

**Index:** `idx_space_review_events_space` on `(space_id, process, created_at)`.

### announcements

What the operator says to everyone signed in, while it runs ([admin.md](admin.md), "The console").

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PK | Snowflake |
| tone | text | NOT NULL | `info` or `warning` |
| body | text | NOT NULL | 3 to 500 characters, shown as plain text |
| createdBy | text | NOT NULL | The admin; kept as an id, no foreign key |
| createdAt | integer | NOT NULL | |
| endsAt | integer | | When it ends by itself; null runs until ended |
| endedAt | integer | | When an admin ended it |

**Indexes:** `idx_announcements_live` on `(endedAt, endsAt)`.

### admin_notes

What the admins keep for each other about an account. Deleted with the account in `tombstoneUser`, and in its data export (`reports-and-notices.json`).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PK | Snowflake |
| userId | text | NOT NULL, FK users ON DELETE CASCADE | The account it is about |
| authorId | text | NOT NULL | The admin who wrote it; no foreign key |
| body | text | NOT NULL | Up to 1000 characters |
| createdAt | integer | NOT NULL | |

**Indexes:** `idx_admin_notes_user` on `userId`.

### signup_rules

Who may not sign up. Asked at sign-up and when an address is set; it touches no account that exists.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| kind | text | PK with value | `email_domain` or `username` |
| value | text | PK with kind | In lower case |
| note | text | | |
| createdBy | text | NOT NULL | The admin; no foreign key |
| createdAt | integer | NOT NULL | |

### starter_spaces

The public spaces a new account of this instance starts in, at most 5.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| spaceId | text | PK, FK spaces ON DELETE CASCADE | |
| addedBy | text | NOT NULL | The admin; no foreign key |
| addedAt | integer | NOT NULL | Their order |

### platform_audit_log
What the instance's administrators did to accounts, spaces and the instance, written only through `recordPlatformAudit` (`utils/platformAudit.ts`), which never fails the request: the action is already taken, so a failed insert is logged and the request goes on. No foreign keys: an entry outlives its actor and its target.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | Snowflake, so ids sort by time and page the log |
| actorId | text NOT NULL | | The acting admin's row id |
| action | text NOT NULL | | One of `PLATFORM_AUDIT_ACTIONS` (`packages/shared/src/platform.ts`): suspensions, role changes, password resets, deletions, badges, review decisions, settings saves, invite changes, storage cleanups |
| targetType | text NOT NULL | | `user`, `space` or `instance` (settings, invites, storage); a row of another type is left out when read |
| targetId | text NOT NULL | | The user's or space's id; for `instance` the invite's id, `settings` or `storage` |
| targetLabel | text | | The target's name when the entry was written (username, space name, invite name) |
| reason | text | | The suspension reason, the review note, the optional note of a badge change or an unsuspension |
| details | text | | JSON object of what the action set (`PlatformAuditValue`s: a status, an end time, the badges added and removed, the changed setting names); NULL when empty |
| createdAt | integer NOT NULL | | Epoch ms |

**Indexes:** `idx_platform_audit_log_page` on `(CAST(id AS INTEGER))`, the order `GET /api/admin/audit` pages in (newest first; `before` compared as a number, written exactly so in the query as for `idx_messages_channel_unread`); `idx_platform_audit_log_target` on `(target_type, target_id)` for the entries of one account or space. **Retention:** none, unlike `space_audit_log`; these are the records an admin team answers for, and there are few of them.

---

## Registration Invites

### invite_links
Admin-managed registration invite tokens. Status (`active` / `expired` / `exhausted` / `revoked`) is **derived** at read time from `revokedAt` + `expiresAt` + `usedCount`/`maxUses`; there is no stored status column. See `packages/server/src/utils/inviteService.ts` (`inviteStatus()`).

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | Snowflake |
| token | text UNIQUE NOT NULL | | 22-char base64url (`crypto.randomBytes(16).toString('base64url')`). Rotated on revoked → reinstate. UNIQUE constraint provides the lookup index. |
| name | text NOT NULL | | Admin-facing label, 1-64 chars trimmed. |
| createdBy | text NOT NULL | | FK → users.id (no CASCADE — admin tombstone keeps the row resolvable). |
| createdAt | integer NOT NULL | | Epoch ms |
| maxUses | integer | | NULL = unlimited; positive integer otherwise. |
| usedCount | integer NOT NULL | 0 | Incremented atomically inside the redemption transaction. |
| expiresAt | integer | | Epoch ms; NULL = never expires. |
| revokedAt | integer | | Epoch ms; NULL = not revoked. Set by revoke endpoint, cleared by reinstate. |

**Index:** `idx_invite_links_created_at` on `(createdAt)`.

### invite_redemptions
One row per successful invite-token consumption. Surrogate ID supports future per-redemption metadata without schema churn.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Snowflake |
| inviteId | text NOT NULL | FK → invite_links.id ON DELETE CASCADE — hard-deleting an invite drops its redemption history with it. |
| userId | text | FK → users.id ON DELETE SET NULL — defensive against future hard-delete paths; tombstone (soft-delete) keeps the row populated. |
| registrantUsername | text NOT NULL | Snapshot of username at the registration moment. Preserves forensic value when the user is later renamed or tombstoned (`!deleted:{uid}`). | When the account is deleted it becomes `Deleted User`.
| redeemedAt | integer NOT NULL | Epoch ms |

**Indexes:** `idx_invite_redemptions_invite_id` on `(inviteId)`, `idx_invite_redemptions_user_id` on `(userId)`.

The user INSERT, `usedCount` increment, and redemption row INSERT all run in a single SQLite transaction (`inviteService.redeemInvite()`), which re-derives status under the transaction to close the TOCTOU window between `/check-invite` and `/register`.

---

## Instance Settings (singleton, id=1)

Migration `0037_orbit_drop_upstream_reporting` dropped the five `telemetry_*` columns and `support_card_enabled` here, and `users.last_active_day` / `users.last_client`: they served only the upstream project's opt-in usage report and its fundraising card, which Tavvit does not have.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | integer PK | 1 | |
| instanceName | text | `'Backspace'` | |
| workerId | integer | | Snowflake worker ID |
| instanceId | text | | Persistent instance epoch (incarnation UUID). Minted once per DB by `ensureDefaults` and guaranteed non-null after boot. Discriminator that lets peers detect this instance was factory-reset (new DB → new epoch on same origin). See [federation.md → Instance-Epoch Self-Healing]. |
| discoveryEnabled | integer NOT NULL | 1 | |
| maxBitrateKbps | integer NOT NULL | 20000 | |
| minBitrateKbps | integer NOT NULL | 500 | |
| bitrateStepKbps | integer NOT NULL | 500 | |
| allowedResolutions | text NOT NULL | `'540,720,1080'` | CSV |
| allowedFramerates | text NOT NULL | `'30,45,60'` | CSV |
| maxResolution | integer NOT NULL | 1080 | |
| maxFramerate | integer NOT NULL | 60 | |
| registrationOpen | integer | | Local-anonymous-signup gate. null = use env (`config.registrationOpen`); 0/1 = explicit admin override. |
| federatedRegistrationOpen | integer NOT NULL | 1 | Independent gate for federated identity replication via Connections (`POST /api/auth/register` with `homeInstance` set). Existing federated accounts always log in regardless of this value. |
| gifApiKey | text | | Klipy API key |
| bitrateMatrixOverrides | text | | JSON sparse overrides |
| allowCustomBitrate | integer NOT NULL | 1 | |
| maxUploadSizeBytes | integer | | null = use env |
| federationRelayEnabled | integer NOT NULL | 1 | |
| federationRelayTtlDays | integer NOT NULL | 30 | |
| autoAcceptPeering | integer NOT NULL | 1 | When 0, `peer/accept` rejects unsolicited requests with 403 |
| directoryEnabled | integer NOT NULL | 0 | The admin allows spaces on this instance to be listed in the space directory. Never 1 while `discoveryEnabled` is 0: both settings PATCH routes clear it in the same write that turns discovery off, and `directoryEnabled: true` with discovery off is refused (`400 directory_requires_discovery`). |
| directoryDirty | integer NOT NULL | 0 | A directory ping is owed. Set by `markDirectoryDirty()` on every change to the served document except member counts; cleared by a ping the hub accepted, and only if nothing changed while it was in flight. Survives restarts and the toggle being off. |
| directoryLastPingAt | integer | | Epoch ms of the last directory ping the hub accepted, null before the first. |
| directoryLastError | text | | JSON `DirectoryPingError` (`{ at, status, reason? }`) of the last failed directory ping, null after a success. Also the per-day guard for the daily slot: the pinger will not retry a failing hub by the slot on a day that already recorded an error. See [directory.md](directory.md). |
| directoryBrowseEnabled | integer NOT NULL | 1 | The admin allows people on this instance to see spaces from other instances in Explore ("Outer Space"). The incoming half of the directory, independent of `directoryEnabled`, which is the outgoing half. `GET /api/directory` answers `404 directory_disabled` while it is 0, and `instance/info` reports `directoryAvailable: false`. Default 1, which is what every instance did before the column existed. `DIRECTORY_ENDPOINT` sits above it: with no endpoint there is nothing to browse whatever it says. Nowhere in the served document, so changing it never marks `directoryDirty`. See [directory.md](directory.md). |
| installedAt | integer | | First-boot timestamp (epoch ms). Backfilled by `ensureDefaults` from the oldest local non-deleted account, or `Date.now()` on a fresh DB, so it is non-null after boot and never overwritten. |
| ledgerStartedAt | integer | | When this instance began recording applied relay events in `federation_applied_events` (epoch ms): set by migration 0022 on an existing instance, null on one that ran it before its first boot. The pull reads no friend event older than it (federation.md "Pull sync", "Cursor") |
| updatedAt | integer NOT NULL | | |

---

## Federation Tables

### federation_peers
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| origin | text NOT NULL UNIQUE | | `https://domain.tld` |
| instanceName | text | | |
| hmacSecret | text NOT NULL | | 256-bit hex |
| status | text NOT NULL | `'active'` | active/pending/awaiting_approval/unreachable/revoked/rejected/needs_attention. Written only by `utils/federationPeerState.ts`; states and transitions in [federation.md → Peer state](federation.md#peer-state). |
| initiatedBy | text NOT NULL | `'auto'` | Provenance: who caused this row to exist. `'admin'` = `POST /peer/initiate`, an approval, or an inbound deny that inserted the row; `'auto'` = local traffic with no admin decision (the outbox placeholder, `ensurePeered` auto-peering); `'remote'` = created by an inbound `/peer/accept`. Only `'admin'` counts as admin authorization at the two peering gates. Rows predating migration `0012_absurd_shiver_man` read as `'auto'` (fail closed). See [federation.md → Peer-row provenance](federation.md#peer-row-provenance). |
| lastSeenAt | integer | | |
| lastFailureAt | integer | | |
| consecutiveFailures | integer NOT NULL | 0 | >=10 → unreachable (network/5xx failures). Counter — never null. |
| consecutiveAuthFailures | integer NOT NULL | 0 | >=5 → needs_attention. Tracked separately from `consecutiveFailures` (network) because auth (401/403) and network failures have different resolution paths. |
| lastProbeAt | integer | | Epoch ms when the last paced attempt started: a reachability probe for an `unreachable` row, a handshake for a `pending` one. `NULL` = next attempt immediately due (set on entry into `pending`, `unreachable` and `active`). |
| probeAttempts | integer NOT NULL | 0 | Failed paced attempts since the pacing began; after n failures the wait is `RECOVERY_BACKOFF_MS[n - 1]`. Reset to 0 on entry into `pending`, `unreachable` and `active`. Counter, never null. Migration `0006_spicy_scourge`. |
| lastSyncedAt | integer | 0 | |
| remoteMaxUploadSize | integer | | Bytes, from peer |
| createdAt | integer NOT NULL | | |
| approvalToken | text | | Single-use 64-hex-char token stored when this row is in `awaiting_approval` (received from remote's 202 response). Verified against the inbound `/peer/accept` `approvalToken` field before promoting to `active`. Cleared (`NULL`) on promotion. See [federation.md → Approval Token Verification](federation.md#approval-token-verification). |
| peerInstanceId | text | | Instance-epoch self-healing: the peer's persistent instance epoch (UUID) as last confirmed. `NULL` until first observed. Compared against `observedPeerInstanceId` to detect a factory-reset peer on the same origin. |
| observedPeerInstanceId | text | | Instance-epoch self-healing: the instance epoch most recently reported by the peer. A mismatch with `peerInstanceId` signals the peer was reset. |
| statusReason | text | | Why the row is in its status: for `needs_attention` one of `auth_failures`, `peer_reset_detected`, `repeer_incomplete`; for `rejected` one of `denied_by_local_admin`, `denied_by_remote`, `revoked_by_remote`, `expired_on_remote`, `stale_peering_on_remote`. `NULL` for every other status, and for `rejected` rows from before the column was renamed (which keep their old behaviour). Renamed from `needs_attention_reason` by migration `0023_peer_status_reason`, which also clears the value on every row that is not `needs_attention` (before it, a row our admin denied or revoked out of `needs_attention` kept its old reason, which would now read as the remote's refusal) and sets `auth_failures` on `needs_attention` rows without a reason (the auth-failure threshold was the only path that wrote none). |

### federation_reset_events
Instance-epoch self-healing ledger. One row per origin recording a detected federated-peer reset (same origin, new instance epoch). Upserted when a live epoch change is observed; `resolvedAt` is stamped once stale replicated identities from the dead epoch are healed.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| origin | text PK | | Peer origin URL whose epoch changed |
| deadEpoch | text NOT NULL | | The instance epoch that was replaced (now stale) |
| newEpoch | text | | The peer's new instance epoch, once known |
| detectedAt | integer NOT NULL | | Epoch ms the reset was detected |
| resolvedAt | integer | | Epoch ms healing completed; `NULL` while in progress |
| stubCount | integer NOT NULL | 0 | Count of replicated identity stubs affected by the reset |
| orphanedAccountCount | integer NOT NULL | 0 | Count of accounts that could not be re-linked to the new epoch |
| acknowledgedAt | integer | | Epoch ms the admin dismissed this reset event from the banner (`POST /api/federation/reset-events/acknowledge`, idempotent); `NULL` while unacknowledged. Purely informational — detach spec §4.6 |

### federation_attach_proofs
One-time proof tokens for **detached-account re-attach** (re-attach spec §3.1). Minted on the owner's re-created **native** account on the reset home instance via `POST /api/auth/attach-proof` (bound to the peer domain the account is detached on), then redeemed exactly once by that peer over signed S2S via `POST /api/federation/verify-attach-proof` to re-bind the detached row to the new home identity. Tokens are single-use (`used_at` set atomically on redemption), short-lived (60s TTL), and peer-domain-bound (verified against the authenticated peer's domain, not the token bearer). Expired rows are janitored opportunistically on each mint, so the table needs no background worker.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| token | text PK | | Random 256-bit token (`randomBytes(32).toString('hex')`, 64 hex chars) handed to the target peer |
| homeUserId | text NOT NULL | | The native home account's `users.id` this proof asserts control of |
| targetDomain | text NOT NULL | | Normalized peer domain (lowercase, no scheme/trailing slash) allowed to redeem — checked against the authenticated caller peer, not the request body |
| createdAt | integer NOT NULL | | Epoch ms the token was minted |
| expiresAt | integer NOT NULL | | Epoch ms; `createdAt + 60_000`. Redemption requires `expires_at > now` |
| usedAt | integer | | Epoch ms the token was redeemed; `NULL` while unused. Set atomically via `UPDATE ... WHERE used_at IS NULL ... RETURNING` so a token can never be redeemed twice, even under concurrent verification |

### peer_approval_requests
Queue of peering requests pending admin review when `autoAcceptPeering` is `false`. Holds **both directions**: inbound rows (remote asked to peer with us) and outbound rows (a local user-initiated `ensurePeered` call gated on this side; see [federation.md → Outbound Peering Gate](federation.md#outbound-peering-gate)). UNIQUE on `(origin, direction)` so the same origin may have at most one row per direction simultaneously. Rows expire after 30 days via janitor cleanup.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | Snowflake |
| origin | text NOT NULL | | Requesting / target instance's origin URL. UNIQUE per `direction` (composite UNIQUE `(origin, direction)`). |
| direction | text NOT NULL | `'inbound'` | `'inbound'` (remote → us) or `'outbound'` (us → remote, gate-created on user_action). Migration backfills existing rows to `'inbound'`. |
| instanceName | text | | Instance name (sent by requester for inbound; null for outbound until populated by future enrichment). |
| hmacSecret | text | | Requester's HMAC secret for inbound (used to sign the `/peer/denied` notification). **Nullable** — outbound rows have `hmac_secret = NULL` and the `/approve` handler generates fresh HMAC at the moment it sends `/peer/accept`. CHECK enforced (see below). |
| requestedAt | integer NOT NULL | | Epoch ms |
| expiresAt | integer NOT NULL | | Epoch ms; requestedAt + 30 days |
| approvalToken | text | | Single-use 64-hex-char token issued by the receiver in the 202 response when an inbound row is created. Forwarded by `/approve` in its outbound `/peer/accept` so the remote initiator can verify mutual admin approval. Deleted along with this row when `/approve` runs. Inbound-only meaning preserved (outbound rows always have `approval_token = NULL`). See [federation.md → Approval Token Verification](federation.md#approval-token-verification). |

**CHECK constraint** (direction-specific shape):

```sql
CHECK (
  (direction = 'inbound' AND hmac_secret IS NOT NULL)
  OR (direction = 'outbound')
)
```

> **drizzle-kit limitation:** drizzle-kit does NOT represent SQLite CHECK constraints in its snapshot/diff. The constraint is created by the original baseline migration (or, for the post-baseline ALTER, hand-written SQL) and is preserved in `schema.ts` as a comment so a future table recreate (drizzle generates a recreate when UNIQUE/PK changes again) re-adds the CHECK by hand. If you regenerate a migration that recreates this table, audit the generated SQL and re-add the CHECK clause manually before applying.

### peer_approval_subscribers
Per-user "I want this peering relationship" subscriber rows attached to outbound `peer_approval_requests`. Logically outbound-only (inbound rows have no subscribers). Existence = waiting; deletion = resolved (resolution recorded in `peer_approval_notifications` at deletion time, except for the canceller path). One subscriber may have multiple rows on the same parent if they triggered the gate from different actions/targets.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Snowflake |
| requestId | text NOT NULL | FK → peer_approval_requests.id CASCADE — parent deletion (admin approve→active fanout, admin deny, last-subscriber cancel, expiry) automatically clears subscriber rows. |
| userId | text NOT NULL | FK → users.id CASCADE |
| triggerReason | text NOT NULL | `'friend_add'` \| `'space_join'` \| `'direct_message'` \| `'instance_connect'` (`PeeringTriggerReason` enum in `packages/shared/src/types.ts`). Rows written by `/peer/ensure` before `instance_connect` existed said `friend_add` with an origin URL as target; migration `0018_peering_reason_instance_connect` relabels them (see [peer_approval_notifications](#peer_approval_notifications)). |
| triggerTarget | text NOT NULL | Action target — for `friend_add` this is `username@instance`; for `space_join` an invite code or space ID; for `direct_message` a recipient handle; for `instance_connect` the remote instance's origin. Never stores message bodies, attachments, or user content. |
| createdAt | integer NOT NULL | Epoch ms |

**UNIQUE:** `(request_id, user_id, trigger_reason, trigger_target)` — same user retriggering the gate with the same reason+target updates rather than duplicates.
**Index:** `idx_peer_approval_subscribers_user_id` on `(user_id)` — supports the user-facing pending list query.

### peer_approval_notifications
Terminal-state notifications for peering events (approved / denied / expired). Scoped to peering — NOT a generalized in-app notification system. When a generalized system is built later, this table either migrates into it or stays as a peering-specific artifact (decision deferred to that spec).

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Snowflake |
| userId | text NOT NULL | FK → users.id CASCADE |
| kind | text NOT NULL | `'approved'` \| `'denied'` \| `'expired'`. |
| peerOrigin | text NOT NULL | Origin URL the notification refers to. |
| triggerReason | text NOT NULL | Mirrors the originating subscriber row's `trigger_reason`. |
| triggerTarget | text NOT NULL | Mirrors the originating subscriber row's `trigger_target`. |
| createdAt | integer NOT NULL | Epoch ms |
| readAt | integer | Nullable. NULL = unread; epoch ms once dismissed/marked read. |

**Index:** `idx_peer_approval_notifications_user_id` on `(user_id)` — supports the user-facing list and unread-filter queries.

Inserted by `onPeerActivated` (`'approved'`), the outbound `/deny` handler (`'denied'`), and the storage janitor outbound expiry pass (`'expired'`). Read rows older than 30 days are auto-cleaned by the janitor; unread rows are never auto-cleaned.

**Migration `0018_peering_reason_instance_connect` (data only).** Before `instance_connect` existed, `POST /api/federation/peer/ensure` stored every call as `trigger_reason = 'friend_add'` with the remote's `URL.origin` as `trigger_target`, although only connection flows called it. The migration relabels those rows in both `peer_approval_subscribers` and `peer_approval_notifications` to `'instance_connect'`, keeping the target, which is already the shape the current code writes. It matches a `friend_add` row only when the target starts with `http://` or `https://` and contains no `@`; a genuine friend-add target is `name@domain` with a `[a-z0-9_]` username, so it never matches. On subscribers it first deletes a legacy row whose `instance_connect` twin (same request, user and target) already exists, which would otherwise break the unique key. It is idempotent. Unread notifications are never auto-cleaned, which is why this is a migration and not left to expiry: an unmigrated approved row keeps offering to retry a friend request prefilled with a URL.

### federation_outbox
Index `idx_outbox_queue` on (peerId, queueKey, createdAt); `idx_outbox_retry` on (nextRetryAt). Several rows may share (peerId, entityId): see federation.md "Outbox queues" for what a queue is and how events are folded into it.
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| peerId | text NOT NULL | | FK → federation_peers.id CASCADE |
| contextId | text NOT NULL | | DM channel / friend context |
| entityId | text NOT NULL | | The id the peer knows the event by (relay `messageId`) |
| queueKey | text | | The entity's queue (`outboxQueueKey`). Null only on rows from before migration 0021 until the boot backfill |
| contextType | text NOT NULL | `'dm'` | dm/friend/profile |
| eventType | text NOT NULL | | create/update/delete/reaction_add/etc |
| payload | text NOT NULL | | JSON event data |
| encryptionVersion | integer | 0 | |
| attempts | integer | 0 | |
| nextRetryAt | integer NOT NULL | | |
| expiresAt | integer NOT NULL | | TTL-based |
| createdAt | integer NOT NULL | | Queue order, and the relayed event's `timestamp` |
| offeredAt | integer | | When some path first possibly handed the row to the peer (worker POST or `/sync` pull). Null: the peer cannot have it. Never cleared |

### federation_file_queue
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| peerOrigin | text NOT NULL | | |
| dmMessageId | text NOT NULL | | |
| sourceUrl | text NOT NULL | | Remote download URL |
| targetFilename | text | | Local stored filename |
| originalName | text NOT NULL | | |
| mimetype | text NOT NULL | | |
| size | integer NOT NULL | | |
| status | text NOT NULL | `'pending'` | pending/completed/rejected/failed |
| rejectionReason | text | | |
| attempts | integer | 0 | Max 10 |
| nextRetryAt | integer NOT NULL | | |
| expiresAt | integer NOT NULL | | |
| createdAt | integer NOT NULL | | |

### federation_mutation_log
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| entityId | text NOT NULL | | |
| contextId | text NOT NULL | | |
| contextType | text NOT NULL | `'dm'` | dm/friend/profile |
| mutationType | text NOT NULL | | the relay event type (federation.md "Mutation log coverage") |
| mutatedAt | integer NOT NULL | | With `id`, the `(mutated_at, id)` order `/sync` pages in |
| payload | text | | JSON |
Retention: 90 days (cleaned by federation janitor)

### federation_sync_cursors
Pull-sync position per peer and context (federation.md "Pull sync"). Migration 0022 created all three for every peer with `last_synced_at > 0`, at that time.
PK: (peerId, contextType)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| peerId | text NOT NULL | | FK → federation_peers.id CASCADE |
| contextType | text NOT NULL | | dm/friend/profile |
| cursorTs | integer NOT NULL | 0 | `mutated_at` of the last log row consumed, in the PEER's clock |
| cursorId | text | | That row's id; null against a server that does not return `checkpointId` |
| peerEpoch | text | | The peer's instance id the cursor was taken against; a different one restarts the cursor at 0 |
| lastPulledAt | integer | | Local time of the last completed pass |

### federation_sync_retry
Pulled events kept for a later retry: refused for a reason that can pass (federation.md "Pull sync", "Outcomes"), or held behind one of the same subject.
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | snowflake; tiebreak for order |
| peerId | text NOT NULL | | FK → federation_peers.id CASCADE |
| contextType | text NOT NULL | | dm/friend/profile |
| subjectKey | text NOT NULL | | The subject the event changes (`syncSubjectKey`): a message, a group member, a friend pair, ... |
| eventType | text NOT NULL | | |
| messageId | text NOT NULL | | The event's `messageId` |
| eventTs | integer NOT NULL | | The event's `timestamp` (peer clock); replay order |
| eventHash | text NOT NULL | | sha256 of the event's canonical JSON (keys sorted): one row per distinct event |
| eventJson | text NOT NULL | | The whole event, replayed locally |
| lastReason | text NOT NULL | | Last refusal, or `held_behind_earlier_event` |
| attempts | integer NOT NULL | 1 | |
| firstFailedAt | integer NOT NULL | | Dropped 7 days after this |
| nextRetryAt | integer NOT NULL | | When the subject's first row is next tried |
Indexes: `idx_sync_retry_event` UNIQUE (peerId, eventHash); `idx_sync_retry_subject` (peerId, subjectKey); `idx_sync_retry_order` (peerId, eventTs)

### federation_applied_events
Ledger of relay events applied here, for events a processor cannot recognize as applied from state alone (federation.md "Receiver guarantees").
PK: (sourceOrigin, eventKey)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| sourceOrigin | text NOT NULL | | `normalizeOriginForCompare` of the origin the event is attributed to |
| eventKey | text NOT NULL | | `dm_delete:<messageId>` (a delete's tombstone) or `<eventType>:<messageId>` |
| appliedAt | integer NOT NULL | | Local time |
Index: `idx_applied_events_applied_at`. Retention: 100 days (janitor `sweepAppliedEvents`)

### federation_subject_clocks
The last applied change per federated subject: a group member or a friend pair. Relayed member and friend events apply last-writer-wins against it on the live relay and the pull; local changes record it too (federation.md "Subject clocks"). Read and written only through `utils/federationSubjectClock.ts`. Migration 0022 creates it empty.
PK: subjectKey
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| subjectKey | text NOT NULL | | JSON array: `["member", <federatedId>, <homeUserId>, <home domain>]` or `["friend", <homeUserId>, <home domain>, <homeUserId>, <home domain>]` (the two sides sorted) |
| changedAt | integer NOT NULL | | Timestamp of the last change: the relayed event's `timestamp`, or local time for a change made here. Never moves back |
| recordedAt | integer NOT NULL | | Local time of the last write, for the sweep |
Index: `idx_subject_clocks_recorded_at`. Retention: 400 days after the last write (janitor `sweepSubjectClocks`)

### user_federation_registry
Persistent registry of all instances a user has federated with. Tracks full lifecycle.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| user_id | TEXT | NOT NULL, FK→users(id) CASCADE | Owner |
| origin | TEXT | NOT NULL | Instance origin URL (e.g., `https://domain.com`) |
| label | TEXT | NOT NULL DEFAULT '' | Instance display name |
| username | TEXT | NOT NULL DEFAULT '' | Federated username on remote |
| remote_user_id | TEXT | NOT NULL DEFAULT '' | Snowflake ID on remote |
| status | TEXT | NOT NULL DEFAULT 'connected' | connected/disconnected/unreachable/auth_expired |
| added_at | INTEGER | NOT NULL | Epoch ms — when first federated |
| last_connected_at | INTEGER | | Epoch ms — last successful connection |
| disconnected_at | INTEGER | | Epoch ms — when user disconnected |
| error_message | TEXT | | Last error message |

**PK:** `(user_id, origin)`

### user_federation_credentials
Per-remote credential this user's client presents when registering or logging in as itself on **another** instance. Added 2026-09-02 (migration `0011_loose_boomer`) to replace the previous scheme, where the client reused the account's home password verbatim on every remote it connected to.

**Home-instance-only state.** The row is written and read exclusively by the account's own home instance, is never federated, and never leaves the home server except to that account's authenticated client (`POST /api/users/@me/federation-credential`). The endpoint 409s for a replicated federated account precisely so that exactly one secret exists per (user, remote) no matter which instance the user browses from — a second issuer would hand the same remote account a divergent secret and lock the user out of it from every other device. Detached accounts (`federation_home_orphaned = 1`) are sovereign and DO issue their own.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| user_id | TEXT | NOT NULL, FK→users(id) CASCADE | Owner |
| origin | TEXT | NOT NULL | Remote origin, canonical `https://host[:port]` lowercased |
| secret | TEXT | NOT NULL | 32-byte CSPRNG, base64url. No relation to the account password or to any other remote's secret |
| created_at | INTEGER | NOT NULL | Epoch ms |
| provisioned_at | INTEGER | | Epoch ms, set-once. NULL = the remote account may still carry a credential this instance did not issue (a connection predating this table), so the client rotates it the next time it holds a live session there |

**PK:** `(user_id, origin)`

**Lifecycle:** created get-or-create with `onConflictDoNothing` + re-read (first-writer-wins — a racing write never replaces a stored secret). Deleted by `tombstoneUser` (explicitly: a tombstone keeps the `users` row, so the CASCADE never fires and live credentials would otherwise outlive the account) and by `POST /api/users/@me/federation-identity/delete` in `soft`/`full` mode. **Not** deleted in `leave` mode — the remote account survives and keeps authenticating with the secret.

**Migration note:** `0011` is a bare `CREATE TABLE`. It reads and rewrites nothing, so it is forward-safe on a populated database and idempotent on re-run. Restoring a **pre-**`0011` backup into a **post-**`0011` deployment works — `migrate()` re-applies `0011` on boot — but any credential rows written after the snapshot are lost, and the client will mint fresh secrets for those origins. Recovery is automatic while a remote token is still valid (`provisioned_at` comes back NULL, so `ensureRemoteCredential` rotates the remote onto the new secret); otherwise the user re-authenticates through the per-instance login form once. See `deployment.md`.

## Bots (migration 0062)

| Table or column | Notes |
|-----------------|-------|
| `bots` | `id` (= `users.id`, cascades), `owner_id` (cascades; `tombstoneUser` retires an owner's bots), `description`, `token_hash` (SHA-256), `created_at`, `last_used_at`. |
| `bot_commands` | `bot_id` (cascades), `name`, `description`. PK `(bot_id, name)`. |
| `instance_settings.bots_enabled` | 0 by default: the operator turns bots on. |
| `roles.bot_id` | The role made for a bot when it came into a space; it gets the same one back after a kick. |

## Voice messages, saved messages, keywords, soundboard (migrations 0059 to 0061)

| Table or column | Notes |
|-----------------|-------|
| `attachments.voice_waveform` | Bar heights as `12,40,7`, for a voice message. Null for any other file. |
| `saved_messages` | `id`, `user_id`, `message_id`, `dm_message_id`, `remind_at`, `reminder_sent_at`, `created_at`. All foreign keys cascade. Unique per person and message. [saved.md](saved.md). |
| `notification_keywords` | `user_id`, `word`, `created_at`. PK `(user_id, word)`. |
| `space_sounds` | `id`, `space_id` (cascades), `name`, `mimetype`, `size`, `duration`, `created_by` (no foreign key, cleared by `tombstoneUser`), `created_at`. 0061 also gives every existing @everyone role USE_SOUNDBOARD (bit 27). [sounds.md](sounds.md). |

## Threads, events, welcome and webhooks (migrations 0056 to 0058)

### channels: threads (0056)

| Column | Notes |
|--------|-------|
| `parent_channel_id` | A thread's channel, `type = 'thread'`. Cascades with the parent. |
| `thread_starter_message_id` | Set null when that message is deleted. |
| `thread_created_by` | Cleared by `tombstoneUser`. |

`thread_members` (`thread_id`, `user_id`, `joined_at`) is who follows a thread. 0056 also gives every existing @everyone role CREATE_THREADS (bit 17).

### space_events, space_event_rsvps (0057)

| Table | Notes |
|-------|-------|
| `space_events` | `id`, `space_id`, `title`, `description`, `location`, `channel_id` (set null), `starts_at`, `ends_at`, `created_by` (no foreign key, cleared by `tombstoneUser`), `reminder_sent_at`, `created_at`. |
| `space_event_rsvps` | `event_id`, `user_id`, `created_at`. PK `(event_id, user_id)`. |

### spaces, space_members: welcome and rules (0057)

| Column | Notes |
|--------|-------|
| `spaces.welcome_text`, `rules_text` | Shown as markdown. |
| `spaces.rules_required_since` | Null while agreeing is optional. Only members who joined after this moment are held to it. |
| `spaces.welcome_channel_ids` | JSON array of channel ids. |
| `space_members.rules_accepted_at` | Null until they agreed. Leaving removes the row, so someone who comes back agrees again. |

### users.account_kind, webhooks (0058)

| Column or table | Notes |
|-----------------|-------|
| `users.account_kind` | `person` (default), `webhook`, later `bot`. A new query that lists people has to filter on it: [webhooks.md](webhooks.md). |
| `webhooks` | `id`, `space_id`, `channel_id`, `user_id` (its account), `name`, `token_hash` (SHA-256), `created_by` (no foreign key, cleared by `tombstoneUser`), `created_at`, `last_used_at`. All three foreign keys cascade. |

## Pins, spoilers, forwards, polls, push (migrations 0050 to 0055)

`messages` gets `pinned_at`, `pinned_by` (a partial index on the channel and `pinned_at`) and `forwarded`. `dm_messages` gets the same and `pin_changed_at`, the last change either way, so a relayed older state does not replace a newer one. `attachments` gets `spoiler`, set when the message is sent. `instance_settings` gets `signup_challenge` (`off`, `normal`, `high`): the column's default is `off`, the migration set the row that existed to `normal`, and `ensureDefaults` writes a new row with `normal`.

### polls, poll_options, poll_votes

| Column | Notes |
|--------|-------|
| `polls.message_id` | PK, the message that asks; its content is the question. Cascades with the message. |
| `polls.multiple`, `ends_at`, `ended_at`, `created_at` | Null `ends_at` runs until someone ends it. |
| `poll_options.id`, `message_id`, `position`, `label` | Cascades with the message. |
| `poll_votes.option_id`, `message_id`, `user_id`, `created_at` | PK `(option_id, user_id)`. `tombstoneUser` removes a deleted account's. |

### push_keys, push_subscriptions

`push_keys` is one row: this instance's signing key, apart from the settings so no settings route can hand it out.

| `push_subscriptions` | Notes |
|--------|-------|
| `id` | Snowflake |
| `user_id` | Cascades; `tombstoneUser` removes them too |
| `session_id` | Cascades, so ending the session ends the device's pushes; null for a token from before sessions |
| `endpoint` | UNIQUE. One browser is one row, for whoever signed in there last |
| `p256dh`, `auth` | What the message is encrypted for |
| `show_text`, `direct_messages`, `locale` | The device's own choices, which the server follows while the app is closed |
| `failures`, `last_success_at`, `created_at` | 20 failures in a row remove it |

## Two factors and security activity (migration 0048)

`users.two_factor_enabled_at`: since when signing in takes a second factor (auth.md). `tombstoneUser` clears it and all of the below.

**`two_factor_secrets`**: `user_id` (PK, FK), `secret_enc` (`v1.<iv>.<tag>.<ciphertext>`, AES-256-GCM under `TOTP_ENCRYPTION_KEY`, the account's id as associated data), `confirmed_at` (null while being set up), `last_used_step`, `failed_attempts`, `locked_until`, `created_at`.

**`two_factor_recovery_codes`**: `code_hash` (PK, HMAC-SHA-256 under a key derived from the same), `user_id`, `used_at`, `created_at`.

**`mfa_tickets`**: the sign-in's first step passed, the second due. `ticket_hash` (PK), `user_id`, `device_id`, `attempts`, `created_at`, `expires_at` (5 minutes).

**`security_events`**: what happened, for the owner to read. `id`, `user_id`, `kind` (`SecurityEventKind`), `client_label`, `address_hint`, `count`, `created_at`. 90 days, 200 per account.

**`known_devices`**: `user_id` + `device_hash` (PK), `first_seen_at`, `last_seen_at`. A hash of a random id the browser keeps, with the account's id. 20 per account; gone after 180 days unseen.

---

## Mail (migration 0047)

`users` gains `email`, `email_verified_at`, `pending_email`, `locale`; a partial unique index keeps confirmed addresses unique and nothing else. `instance_settings.email_required_since`: since when new accounts need one, null while nobody does (email.md, "The gate"). `tombstoneUser` clears all of it.

**`email_tokens`**: a link in a mail, only its hash. `token_hash` (PK, SHA-256), `user_id` (FK, cascade, and scrubbed by `tombstoneUser`), `purpose` (`verify` | `reset`), `address`, `created_at`, `expires_at`. One per account and purpose. Swept hourly.

**`email_outbox`**: mail waiting, and a week's memory of what went. `id`, `kind`, `priority`, `user_id`, `to_address`, `to_hash`, `locale`, `params`, `link_nonce`, `status` (`queued` | `sent` | `failed` | `expired`), `attempts`, `next_attempt_at`, `expires_at`, `provider_id`, `last_error`, `created_at`, `sent_at`. Never a body. `to_address`, `link_nonce` and `params` go when a row is done.

**`email_usage_daily`**: `day` (PK, UTC), `accepted`, `failed`, `bounced`, `complained`, `provider_day`, `provider_month`. No personal data.

**`email_suppressions`**: `address_hash` (PK), `reason` (`bounce` | `complaint`), `created_at`. Bounces lapse after 30 days.

---

## Sessions (migration 0046)

**`sessions`**: one signed-in device (auth.md, "Tokens and sessions"). `id` (text PK, 128 random bits, the token's `sid`), `user_id` (FK, cascade, and scrubbed by `tombstoneUser`), `created_at`, `last_active_at`, `expires_at`, `client_label` ("Chrome · Windows", null when unknown), `address_hint` (the address cut short). Indexes on `user_id` and `expires_at`. `users.password_hash` now holds an Argon2id PHC string, or until the next login a bcrypt one.

---

## Contact rules, invite links and data exports (migrations 0044, 0045)

**Columns:**
- `users.dm_policy` (text, default `friends_and_spaces`): who may start a conversation with this person. `nobody`, `friends`, `friends_and_spaces` or `anyone`.
- `users.friend_request_policy` (text, default `anyone`): who may send them a friend request and find them by name. `nobody`, `shared_spaces` or `anyone`.
- `instance_settings.emoji_policy` (text, default `admins`): who may add to the emoji library. `admins` or `everyone`.
- `instance_settings.storage_per_account_bytes` (integer, default 5 GB) and `instance_settings.spaces_per_account` (integer, default 25): what one account may keep and own; 0 means no limit (migration `0063_tavvit_account_limits`, [uploads.md](uploads.md), "Limits per account").
- `users.storage_limit_bytes` (integer, null): an account's own limit, set by an admin; 0 means none, null the instance's. `idx_attachments_uploader` makes the sum of an account's files cheap.
- `messages.cards` (text, null): JSON, what a bot or a webhook showed besides text ([bots.md](bots.md), "Cards"). `bot_commands.options` (text, null): JSON, what a command asks for (migration `0064_tavvit_bot_api`).

The two on `users` go out only on a person's own row (`sanitizeUser(row, true)`). On a replicated row they mean nothing: the account's own instance decides (social.md, "Who may reach someone").

**`space_invites`**: one row per link into a space (spaces.md, "Invite links").

| Column | Type | Notes |
|--------|------|-------|
| code | text PK | 48 random bits, base64url |
| space_id | text FK, cascade | |
| created_by | text FK, set null | |
| created_at | integer NOT NULL | |
| expires_at | integer | When it stops working; null for never |
| max_uses | integer | How many people it may let in; null for no limit |
| uses | integer NOT NULL, default 0 | Counted in one statement with the limit check |

Migration 0044 copies each `spaces.invite_code` in. That column still names the standing link, the one the Invite dialog hands out. A revoked link has no row.

**`data_exports`**: a person's copy of their data (legal.md, "Data export"). `id`, `user_id` (FK, cascade), `status` (`pending`, `ready`, `failed`), `created_at`, `expires_at`, `size_bytes`. The file is `<id>.zip` in `config.exportDir`.

---

## Legal tables (migration 0043)

Full description: [legal.md](legal.md).

**`legal_documents`:** one published version of a document, never edited. `id`, `kind` (`terms`, `privacy`), `version` (unique per kind), `texts` (JSON, language to Markdown), `published_at`, `effective_at`, `changes`, `published_by`.

**`content_reports`:** `id`, `status` (`open`, `closed`), `category`, `explanation`, `target_type`, `target_id`, `target_url`, `snapshot` (JSON `ReportSnapshot`), `reporter_user_id`, `reporter_name`, `reporter_email`, `created_at`, `decision`, `ground`, `decision_note`, `decided_by`, `decided_at`. Decided ones are deleted after a year.

**`user_notices`:** `id`, `user_id`, `kind`, `ground`, `note`, `subject`, `until`, `decision`, `created_at`, `read_at`. Read ones are deleted after a year; all go with the account.

**Columns:** `instance_settings.legal_operator` (JSON `LegalOperator`), `users.terms_version`, `users.terms_accepted_at`.

Migration 0043 also renames an instance still called by the old default (`Orbit`) to `Tavvit`. `platform_audit_log` rows are deleted after two years.

## operator_alerts

What the operator has to hear about (`utils/operatorAlerts.ts`, operations.md). A row stays after it clears, to keep the day's mail counted.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| cause | text | | PK: `disk_high`, `backup_failed`, `backup_old`, `offsite_failed`, `restart_loop` |
| active | integer | 1 | Whether it holds now |
| detail | text | | The figure or the error that goes with it |
| since | integer | | When it began this time |
| last_mailed_at | integer | | When the administrators were last told |

`instance_settings.recent_starts` (text) holds when the server started lately, as JSON, the last 20, to tell a restart loop from an update. `announcements.on_status_page` (integer, default 0): also on the public status page.

## Community channels (migration 0066)

See [forums.md](forums.md) and [spaces.md](spaces.md), "Own invite address". `channels.type` also takes `announcement` and `forum`.

| Table or column | Notes |
|-----------------|-------|
| `forum_tags` | `id`, `channel_id` (cascades with the forum), `name`, `color` (may be null), `position`, `created_at`. At most 20 per forum, checked in the route. Names are unique in a forum without regard to case. |
| `forum_post_tags` | `thread_id`, `tag_id`, both cascade. Primary key the pair. At most 5 per post, checked in the route. |
| `channel_follows` | `id`, `source_channel_id` and `target_channel_id` (cascade), `account_id` (its account, `users.account_kind = 'follow'`), `created_by` (no foreign key, cleared by `tombstoneUser`), `created_at`. The pair is unique. |
| `blocked_vanity_codes` | `code` (primary key), `created_at`. Names an administrator took away, which nobody can take again. |
| `spaces.vanity_code` | Null or a unique name in small letters. Also a row of `space_invites`. |
| `users.account_kind` | Also `follow`, with the same rules as `webhook`. |

## Changing a username (migration 0067)

See [auth.md](auth.md), "Changing a username".

| Table or column | Notes |
|-----------------|-------|
| `users.username_changed_at` | When this account last changed its name. Null if it never did. |
| `retired_usernames` | `username` (primary key), `user_id` (cascades), `until`. Names given up, out of reach until `until`. Deleted by `tombstoneUser`, listed in the personal export (`security.json`). |

## Channel icons (migration 0068)

See [spaces.md](spaces.md), "Channel icons".

| Table or column | Notes |
|-----------------|-------|
| `channels.icon` | Null, `glyph:<id>` or one emoji. Only adds a nullable column, so every existing channel keeps its type's icon. |

## Throwaway addresses (migration 0069)

See [email.md](email.md), "Throwaway addresses".

| Table or column | Notes |
|-----------------|-------|
| `instance_settings.block_throwaway_email` | integer NOT NULL, default 1. While 1, an address at a domain of the built-in list (`email/throwawayDomains.txt`) is refused at sign-up and when an address changes. |

## Bounded lists of other instances (migration 0070)

See [client-federation.md](client-federation.md) and [api.md](api.md), `PATCH /api/users/@me`.

| Table or column | Notes |
|-----------------|-------|
| `users.replicated_instances` | A data step only: a list the route could never have written (not JSON, not a list, more than 20 entries, longer than 32 KiB) becomes `[]`. A list the app wrote stays. From 1.32.8 the route keeps a name and an origin per entry, each origin once, and the list goes only to the account itself (`sanitizeUser` with `isSelf`), never into what others see of it. |

## Space emoji and stickers (migration 0071)

See [emoji.md](emoji.md) and [uploads.md](uploads.md#space-emoji-and-stickers-1340). Migration `0071_tavvit_space_expressions` only adds two tables and a nullable column, so every existing space starts with no emoji and no stickers, and with `discord_imported_at` null even where a template import ran before. It gives MANAGE_EMOJIS (bit 29) to no role, and the bit is in no default: the owner, instance admins and holders of ADMINISTRATOR have it.

Both tables' rows go with their space (CASCADE). The emoji files go with them (`deleteSpaceCompletely`); the stickers' assets stay for the storage cleanup, which keeps them while anything names them. `created_by` is what an account's storage sums (`storageUsedByAccount`), what the data export reads and what `tombstoneUser` clears; the `created_by` indexes are for those. The limits per space, 200 emoji and 60 stickers (`SPACE_EXPRESSION_LIMITS`), are checked in code (`utils/spaceExpressions.ts`), not by the schema.

### space_emojis

A space's own emoji. Its picture is `UPLOAD_DIR/emoji/<id>.webp`, as for `custom_emojis`.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK NOT NULL | Snowflake from the generator `custom_emojis` uses, so the token `<:name:id>`, the reaction `emoji:<id>` and `GET /api/emojis/<id>.webp` serve both kinds |
| space_id | text NOT NULL | FK → spaces.id CASCADE |
| name | text NOT NULL | `[a-z0-9_]`, 2 to 32 characters (`normalizeEmojiName`) |
| animated | integer NOT NULL, default 0 | 1 when the stored WebP has more than one frame |
| size | integer NOT NULL | Bytes of the stored WebP; counts on `created_by`'s storage |
| discord_id | text | The Discord emoji an import brought; null for one added by hand. Not in what clients receive of the emoji (`SpaceEmoji`) |
| created_by | text | Who added it, by hand or by an import. No foreign key: `tombstoneUser` clears it, and the emoji stays with the space |
| created_at | integer NOT NULL | Epoch ms |

Indexes: `space_emojis_space_name_unique` UNIQUE (space_id, name); `space_emojis_space_discord_unique` UNIQUE (space_id, discord_id) WHERE discord_id IS NOT NULL, so a second import brings nothing twice, even side by side; `idx_space_emojis_created_by` (created_by).

### space_stickers

A space's own sticker: a named entry over a content-addressed asset (`sticker_assets`), sent with the same token as a personal sticker.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK NOT NULL | Snowflake: the entry's own id, which renaming and removing name |
| space_id | text NOT NULL | FK → spaces.id CASCADE |
| sticker_id | text NOT NULL | FK → sticker_assets.id, no delete action. The asset may be shared with collections, messages and other spaces, so removing the entry leaves it to the storage cleanup, which counts this column as a reference (`getReferencedStickerIds`); without that, the cleanup would remove the file and then fail on the row |
| name | text NOT NULL | At most 100 characters, one visible line, stored trimmed (`normalizeStickerName`). The index compares exactly; the routes also refuse a name that differs only in case (`409 space_sticker_name_taken`) |
| description | text | What a screen reader says in place of the picture: at most 200 characters, one visible line (`normalizeStickerDescription`); null for none |
| animated | integer NOT NULL, default 0 | 1 when the stored WebP has more than one frame |
| size | integer NOT NULL | Bytes of the stored WebP; counts on `created_by`'s storage for each entry, also when the asset is shared |
| discord_id | text | The Discord sticker an import brought; null for one added by hand. Not in what clients receive of the sticker (`SpaceSticker`) |
| created_by | text | As for `space_emojis` |
| created_at | integer NOT NULL | Epoch ms; the space lists its stickers in this order |

Indexes: `space_stickers_space_name_unique` UNIQUE (space_id, name); `space_stickers_space_discord_unique` UNIQUE (space_id, discord_id) WHERE discord_id IS NOT NULL; `idx_space_stickers_sticker` (sticker_id), for the foreign key's check when the cleanup deletes asset rows; `idx_space_stickers_created_by` (created_by).

### spaces: brought over from Discord

| Column | Notes |
|--------|-------|
| `spaces.discord_imported_at` | integer, null. When something was last brought over from Discord: set by a template import, into a new space or an existing one, and by an emoji and sticker import that brought anything. Read only into the invite preview (`movedFromDiscord`, `utils/spaceInviteSnapshot.ts`), so the welcome for people coming from Discord never claims a move that did not happen. Null while nothing was. |

### linked_accounts (0072)

Accounts elsewhere a person proved are theirs by signing in there (linked-accounts.md). No token is stored.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK NOT NULL | Snowflake |
| user_id | text NOT NULL | FK → users.id CASCADE. Account deletion deletes the rows by hand, as the tombstone keeps the user's row |
| provider | text NOT NULL | `LinkedAccountProvider`: `twitch` |
| provider_user_id | text NOT NULL | The account's id at the service (Twitch: digits), what the live check asks by and what stays across a rename |
| login | text NOT NULL | Its handle there (Twitch: the login, lower case), as the service last named it; a live answer brings a renamed one |
| display_name | text NOT NULL | How the service writes its name, at most 64 characters |
| show_on_profile | integer NOT NULL, default 1 | The profile shows it (`users.profile_linked_accounts`) |
| show_live | integer NOT NULL, default 1 | Its owner is shown live while they stream there (activity-presence.md, "Live on Twitch") |
| created_at | integer NOT NULL | When it was linked; a different account at the same service is a new date |
| updated_at | integer NOT NULL | |

Indexes: `linked_accounts_user_provider_unique` UNIQUE (user_id, provider): one per service per person; `linked_accounts_provider_account_unique` UNIQUE (provider, provider_user_id): one person per account elsewhere on this instance.

| Column | Notes |
|--------|-------|
| `users.profile_linked_accounts` | text, null. What the profile shows of the person's linked accounts: the rows with `show_on_profile`, as a JSON list of `{ provider, login, name }`, written whenever they change (`writeProfileLinkedAccounts`). In `PUBLIC_USER_COLUMNS`, read into `User.linkedAccounts` by the shared rules. Cleared by the tombstone |

## custom_decorations

Frames, effects, nameplates and name styles people make (decorations.md, "Made by people"). Migration `0075_tavvit_custom_decorations`, additive. A profile wears one by its reference, `custom:<id>`, in the column of its kind on `users` (`avatar_frame`, `profile_effect`, `nameplate`, `name_effect`; never `name_font`); `PATCH /api/users/@me` takes one only when it exists, is of that kind, and is shared or the person's own.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | Snowflake |
| kind | text | NOT NULL | `frame`, `effect`, `nameplate` or `name` |
| name | text | NOT NULL | 1 to 32 characters, one line, no hidden characters (`normalizeDecorationName`) |
| creator_id | text | FK → users, cascade | Who made it. Account deletion removes their designs by hand first (`removeDecorationsOfUser`), as the tombstone keeps the user's row, and takes them off everyone who wore them |
| animated | integer | NOT NULL, default 0 | 1 when the picture moves; its still first frame is then kept beside it |
| size | integer | NOT NULL, default 0 | Bytes of its pictures, counted in its maker's storage (`storageUsedByAccount`) |
| width, height | integer | | The stored picture's size; NULL for a name style |
| style | text | | JSON: a name style's `{ look, colors }`, an effect's `{ motion }`; NULL for a frame or a nameplate |
| shared | integer | NOT NULL, default 0 | 1 when it is in the gallery and others may wear it |
| created_at, updated_at | integer | NOT NULL | Epoch ms |

Indexes: `custom_decorations_creator_idx` (creator_id); `custom_decorations_gallery_idx` (kind, shared, created_at). The pictures are files, `UPLOAD_DIR/decorations/<id>.webp` and `<id>-still.webp`, removed with the row.

## voice_overlays

Links that show a voice channel in a stream (voice-overlay.md). Migration `0074_tavvit_space_tags_voice_overlays`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | Snowflake |
| channelId | text | FK → channels, cascade | The voice channel |
| spaceId | text | FK → spaces, cascade | Its space |
| userId | text | FK → users, cascade | Who made it; one link per person and channel (unique `channel_id, user_id`) |
| tokenHash | text | unique | SHA-256 of the secret, hex; the secret itself is never stored |
| createdAt | integer | | Epoch ms |
| lastUsedAt | integer | | When the overlay page last asked, to the minute; NULL before it did |
