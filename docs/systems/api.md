# REST API Reference

Base: `/api`. Auth via `Authorization: Bearer <jwt>`. All responses JSON.
Source files: `packages/server/src/routes/*.ts`

---

## The admin console

Everything here but `GET /announcements` is behind `requireAdmin`. What each does: [admin.md](admin.md), "The console".

```
GET    /admin/dashboard                                     → AdminDashboard (admin)
GET    /admin/system                                        → AdminSystemInfo (admin)
POST   /admin/system/backup                                 → 201 { name } | 429 backup_too_soon (admin; 5 per 15 min)
GET    /announcements                                       → AnnouncementsResponse (what runs; anyone signed in)
GET    /admin/announcements                                 → AnnouncementsResponse (the last 50; admin)
POST   /admin/announcements        { body, tone, durationHours? } → 201 Announcement | 409 announcement_limit (admin)
POST   /admin/announcements/:id/end                         → Announcement (admin)
GET    /admin/search?q=                                     → AdminSearchResponse (admin; 120 per min)
GET    /admin/users.csv                                     → text/csv (admin; 10 per 15 min)
GET    /admin/audit.csv                                     → text/csv (admin; 10 per 15 min)
PUT    /admin/users/:id/storage-limit { limitGb | null }    → { success } | 400 account_limit_out_of_range, user_already_deleted | 404 (admin). 0: no limit; null: the instance's
GET    /admin/users/:id/sessions                            → { sessions: SessionInfo[] } (admin)
DELETE /admin/users/:id/sessions/:sessionId                 → { sessions } | 400 cannot_target_self (admin)
POST   /admin/users/:id/sessions/end-all                    → { sessions: [] } | 400 cannot_target_self (admin)
GET    /admin/users/:id/security                            → { events: SecurityEventInfo[] } (admin)
GET    /admin/users/:id/notes                               → AdminNotesResponse (admin)
POST   /admin/users/:id/notes      { body }                 → 201 AdminNotesResponse (admin)
DELETE /admin/users/:id/notes/:noteId                       → AdminNotesResponse (admin)
POST   /admin/users/:id/warn       { note, ground }         → { success } | 400 cannot_target_self (admin)
GET    /admin/signup-rules                                  → SignupRulesResponse (admin)
POST   /admin/signup-rules         { kind, value?, note?, usual? } → 201 SignupRulesResponse | 400 signup_rule_invalid | 409 signup_rule_limit (admin)
DELETE /admin/signup-rules/:kind/:value                     → SignupRulesResponse (admin)
GET    /admin/starter-spaces                                → StarterSpacesResponse (admin)
PUT    /admin/starter-spaces       { spaceIds }             → StarterSpacesResponse | 400 starter_spaces_limit, space_not_public | 404 space_not_found (admin)
```

`POST /auth/register` and `PUT /users/@me/email` answer `400 email_domain_blocked` for an address the sign-up rules refuse, and `POST /auth/register` answers `400 username_reserved` for a reserved name, as `GET /auth/check-username` does. `POST /auth/register` limits `displayName` to 32 characters (`400 display_name_too_long`).

`DELETE /admin/users/:id` takes `{ reason, password, twoFactorCode? }` for an account of this instance, the acting admin's own; `400 cannot_delete_admin` for an administrator. `DELETE /users/@me` answers `400 last_admin_cannot_leave` for the last administrator who can act. `GET /admin/spaces` takes `visibility=public`.

---

## Rate limiting

**1.32.8 adds:** `POST /api/dm/group` 10 in 10 minutes, `DELETE /api/events/:id/rsvp` 30 a minute (as the PUT), `PUT /api/users/@me/space-layout` 60 a minute. `PUT /api/users/@me/space-layout` takes at most 500 items, 50 folders, 200 spaces in a folder, ids of 128 characters, names of 100, and a colour as the sidebar sets one (`#rrggbb` or `rgb(var(--accent-…))`), else `400 validation_failed`. `POST /api/bots/@me/files` holds its room before a byte is written. New codes: `409 group_dm_limit_reached` `{ max }`, `409 group_dm_member_limit_reached` `{ name, max }`, `400 profile_image_invalid` from every picture field whose image cannot be written anew. A display name or status with a control character or bidirectional override is `400 validation_failed`. Every route that asks for the current password answers `429 login_throttled` while the account's password checks are all in use. `PATCH /api/spaces/:id/members/@me/profile`, one's own nickname through `PATCH /api/spaces/:id/members/:userId`, `POST /api/spaces/:id/invites`, `POST /api/spaces/:id/invite` when it makes a new standing link, `POST /api/spaces/:id/events`, `PATCH /api/events/:id`, `POST /api/spaces/:id/sounds` and `PATCH /api/sounds/:id` are member actions (`member_timed_out`, `email_verification_required`, `rules_not_accepted`). A clip's or a bot's name with a control character or bidirectional override is `400 validation_failed`. `replicatedInstances` in `PATCH /api/users/@me` keeps a name and an origin per entry and goes back only to the account itself. The RSVP routes answer members only, and tell the space only of a change.

The page's own files (`/assets/`, `/fonts/`, `/icons/`, `/sounds/`) are not counted: a first visit asks for about 40 of them, and they are served from disk.

Every request passes a limit: the global **200 per minute** registered in
`packages/server/src/index.ts`, or the route's own where it declares one. A
route with `config.rateLimit` **replaces** the global limit for itself rather
than sitting under it, so a route that allows 100 per minute allows 100 per
minute even though the global number is smaller. Read the per-route numbers
below as the whole budget for that route, not as a second gate. **The key is
the client address and nothing else.** The limiter runs on Fastify's `onRequest` hook while `authenticate` is
a route `preHandler`, so no user is attached to the request yet when the key is
taken. Nothing in the HTTP limiter is per account.

The per-account budgets are hand-written, counted inside the route after auth
and on top of the per-address limit, never instead of it: the two upload
limits in `routes/files.ts` (30 upload creates and 1000 PATCHes per minute per
user), which run inside the tus handler; sticker uploads in
`routes/stickers.ts` (30 per minute); custom emoji uploads in
`routes/emojis.ts` (10 per minute, `CUSTOM_EMOJI_LIMITS.UPLOADS_PER_MINUTE`);
a space's emoji and stickers in `routes/spaceExpressions.ts` (30 pictures per
minute for both together, and 100 stickers a day, `SPACE_EXPRESSION_LIMITS`;
the Discord import counts towards neither); Discord look-ups,
`POST /import/discord/expressions/preview` (5 in 10 minutes); people search,
`GET /social/search` (20 per minute); and review requests,
`PUT /spaces/:id/verification` and `PUT /spaces/:id/discovery` (10 per hour,
one budget for both). All but the two tus limits are `createFixedWindowLimit` counters
(`utils/fixedWindowLimit.ts`), keyed by `request.userId` and held in memory,
so a restart forgets them; search, review requests and Discord look-ups count a request only
once it passed its own checks. Over one of these counters the answer is
`429 rate_limited` in the shared body, without `retryAfter` or a
`Retry-After` header. Picture work people send has a bound of its own that is
no counter (`runMediaJob`, `utils/thumbnail.ts`): an account has at most one
picture (an emoji of the library or of a space, a personal or a space's
sticker, a picture of the Discord import) being encoded or waiting for its
turn, and while 24 jobs wait no new one is taken; such an upload is refused at
once with the same `429 rate_limited`. One more budget is per account but runs before any
auth: the sign-in throttle (`utils/loginThrottle.ts`), keyed by the typed
username (trimmed, lowercased), refuses every sign-in for a name that
collected 10 failed attempts in 15 minutes, correct password or not, until the
oldest failure leaves the window (`429 login_throttled`, `details.minutes`,
with `retryAfter` and `Retry-After`); a successful sign-in clears it.

The address comes from Fastify's `trustProxy`, which is a **count of trusted
hops**: the `TRUSTED_PROXY_HOPS` environment variable, default 1, read in
`config.ts` and documented there and in `.env.example`. At 1 the key is the
address the nearest proxy appended, and entries a client writes into
`X-Forwarded-For` are ignored. A deployment with a CDN in front of its own
proxy, or with no proxy at all, sets a different number; see
[web-security.md](web-security.md) section 9 and
[deployment.md](deployment.md), "Server proxy-awareness".

What an operator should take from that: **everyone sharing one public address
shares one budget.** A school, an office behind a corporate proxy, a VPN exit
or a household on CGNAT counts as a single client, and a busy client there can
spend the minute's 200 for everybody at that address. The countermeasure is not
in the app: give such a deployment its own address, or raise the limit.

Routes may tighten the limit for themselves with `config.rateLimit`; those
overrides sit with their routes (`routes/auth.ts`, `routes/directory.ts`,
`routes/explore.ts`, `routes/messages.ts`, `routes/dm.ts`, `routes/gif.ts`,
`routes/users.ts`, `routes/social.ts`), and they are keyed the same way, per
address, for the same reason. The WebSocket `dm_message_create` event applies
the DM create route's limit to the socket's address in a counter of its own
(websocket.md, "DM Messages"). `DISABLE_RATE_LIMITS=1` or `=true`
switches the plugin's limits off, and with them the `createFixedWindowLimit`
budgets and the sign-in throttle above (the two tus upload limits stay), but
only where `NODE_ENV` is not `production` (`utils/rateLimitSwitch.ts`); it
exists for test harnesses that share the loopback address and is never set in
production.

Over the limit: `429` with the shared error body (`{ error, code:
'rate_limited', statusCode: 429 }`, see [localization.md](localization.md))
plus `retryAfter` in whole seconds, and the plugin's own `Retry-After` header.

---

## Body size before authentication

A request makes the server read more than 64 KiB of body (`ANONYMOUS_BODY_LIMIT`, `utils/bodyGuard.ts`) only once it has shown who sent it, in an `onRequest` hook that runs before Fastify reads the body: on a federation route, headers that name a known peer that is not revoked (`peerNamedByHeaders`, the signature over the body still follows the reading); on any other route, the credential `authenticate` checks, which the route checks again. Without a credential the answer is 413 for a stated length past the limit and 411 for a body without one. A route whose own `bodyLimit` is 64 KiB or less is not concerned, nor is any request that states a length within the limit. No public route needs more: the largest public body, a report, is 64 KiB.

Limits added in 1.32.7: both message search routes 30 a minute and a query of at most 200 characters (`validation_failed`, field `q`); keyword matches and mentions 30 a minute; past 20 different reactions on one message `reaction_limit_reached` (`details.max`). `PATCH /api/users/@me` no longer takes `homeUserId`: a replica's home id comes only from what its home proves (docs/systems/federation.md, section 18).

## Auth (`routes/auth.ts`) — public, rate-limited
```
POST /auth/register         { username, password, displayName?, avatarColor?, homeInstance?, homeUserId?, inviteToken?, email?, locale? } → { token, user }
GET  /auth/check-username    ?username= → { available, reason? }
GET  /auth/check-invite      ?token=    → CheckInviteResponse
POST /auth/login             { username, password, deviceId? } → { token, user }; `username` may also be a confirmed address on an instance that sends mail
POST /auth/password/forgot    { email, locale? }    → { success }, the same whoever the address belongs to; 503 email_not_configured | email_unavailable (email.md)
POST /auth/password/reset     { token, password }   → { success }; ends every session, signs nobody in; 410 email_token_invalid
POST /auth/email/verify       { token }             → { success, address }; 410 email_token_invalid, 409 email_address_in_use
POST /auth/login/2fa          { ticket, code }      → { token, user }; 401 mfa_code_invalid | mfa_ticket_invalid, 429 mfa_locked. `code` is from an app, or a recovery code. A login with 2FA on answers 401 mfa_required with { ticket } first (auth.md)
GET  /auth/security                                 → SecurityOverview: the 2FA state, the last password change, how many sessions, recent events
POST /auth/2fa/setup          { password }          → { secret, otpauthUrl }; not in force yet. 503 two_factor_unavailable, 409 two_factor_already_enabled
POST /auth/2fa/enable         { code }              → { recoveryCodes }, shown only now; other sessions end
POST /auth/2fa/disable        { password, code }    → { success }
POST /auth/2fa/recovery-codes { password, code }    → { recoveryCodes }; the old ones stop working
POST /auth/sessions/end-all                         → { success }; every session, this one too
POST /auth/logout                                   → { success }; the token stops working, its sockets close
GET  /auth/sessions                                 → { sessions: SessionInfo[] }, this account's, on this instance
DELETE /auth/sessions/:id                           → { sessions }; 404 for anyone else's
POST /auth/sessions/end-others                      → { sessions }
POST /auth/attach-proof      (JWT, rate-limited 5/15min)  { targetDomain } → { token }   (AttachProofResponse)
GET  /users/@me/email                               → AccountEmailStatus (email.md)
PUT  /users/@me/email         { address, password, locale?, twoFactorCode? } → AccountEmailStatus; 403 current_password_incorrect, 400 email_invalid | email_undeliverable, 429 rate_limited
POST /users/@me/email/resend                        → AccountEmailStatus; 409 email_nothing_to_confirm | email_undeliverable, 429 rate_limited
DELETE /users/@me/email/pending                     → AccountEmailStatus
DELETE /users/@me/email       { password, twoFactorCode? } → AccountEmailStatus
PUT  /users/@me/locale        { locale }            → { locale }; the language mail is written in
GET  /admin/email/status                            → AdminEmailStatus (admin)
POST /admin/email/test        { to }                → 202 { queued } (admin)
POST /email/webhooks/resend                         → Svix-signed; only with EMAIL_TRANSPORT=resend and a secret
```

**`POST /auth/attach-proof`** — JWT-authenticated. Mints a one-time 256-bit token (`randomBytes(32).toString('hex')`) for the logged-in **native** user, stored in `federation_attach_proofs` bound to `{ homeUserId, targetDomain, expiresAt = now+60s }`; expired rows are janitored on each mint (the delete targets `expires_at < now`; a used-but-unexpired row lingers until it expires). The token is handed to the peer named by `targetDomain`, which redeems it via `POST /federation/verify-attach-proof` to re-attach the caller's detached account there. See `federation.md` "S2S Detached-Account Re-Attach Proof" and re-attach spec §3.1.

**`POST /auth/login`** — request/response shape unchanged, but two internal controls from instance-epoch self-healing gate the flow: (1) an account with `federationHomeOrphaned = 1` (home instance factory-reset) is **detached** — a sovereign local account whose local password hash is the sole authority; it logs in normally with that local password (the detach pivot removed the old pre-verification freeze), and the flag's only login effect is to permanently disable self-heal (step 7); (2) for non-detached federated accounts, the password self-heal runs an **epoch guard** — it re-hashes the stale local password only if the home instance's authenticated epoch (`fetchPeerEpoch`) matches the trusted baseline, failing closed when the epoch differs or can't be determined. A detached account can be re-bound to the owner's new home identity via `POST /users/@me/reattach` (re-attach spec §3.2), which clears the flag and re-enables normal federated semantics. No wire-shape change. See `auth.md` §4.

**Suspended accounts (`account_suspended`).** While an instance admin's suspension of the account stands (Platform administration below; `auth.md` §13), `POST /auth/login` answers `403 account_suspended` with `details: { reason, until? }` (`until` in epoch ms, absent for a suspension until lifted) and signs no token, but only once the password proved right (against the local hash or through a federated self-heal): a wrong password or an unknown name answers `401 invalid_credentials` as for any account, so the reason reaches the account's owner and nobody who merely knows the name. Every authenticated route answers `401 account_suspended` with the same `details` (`verifyJwtAndUser` behind `authenticate`); the tus upload routes answer the 401 with the message only, and the WebSocket refuses the socket (websocket.md, "Refused sockets"). A token issued before the suspension is not revoked: it is accepted again once the suspension is lifted or its end has passed.

**`POST /auth/register` gating** — branches on whether `homeInstance` is set:
- **Federated path** (`homeInstance` set): gated solely by `instance_settings.federatedRegistrationOpen`. `inviteToken` is ignored entirely (not validated, not consumed). 403 `Federated registration is closed on this instance` when closed. The endpoint is **create-only**: it always INSERTs a new row and returns `201`, and never binds the submitted credentials to an existing row — a relay-created stub (`passwordHash = '!federation-replicated'`) is never claimed here, whatever `homeUserId`/`homeInstance` the caller supplies. Stub merges happen only via the proof-gated `POST /users/@me/reattach`. Login is never blocked by this gate.
- **Local path** (no `homeInstance`):
  - When `registrationOpen` is true: `inviteToken` is silently ignored (no row touched, no `usedCount` increment).
  - When `registrationOpen` is false: `inviteToken` is required. The token is pre-validated, then the user INSERT + `usedCount` increment + `invite_redemptions` row INSERT all run in a single transaction (`inviteService.redeemInvite`). 403 `Registration is closed. An invite is required.` (no token) or `Invalid or expired invite` (token rejected at any stage, including a concurrent-redemption race re-check inside the transaction).

**`GET /auth/check-invite`** — public, rate-limited 30/min/IP. Always returns 200; the body discriminates:

```typescript
type CheckInviteResponse =
  | { valid: true; name: string }            // active token; name surfaces for UX
  | { valid: false; reason: 'expired' | 'exhausted' | 'invalid' };
```

`revoked`, malformed (non-22-char-base64url), and not-in-DB tokens all collapse to `'invalid'` (enumeration shield). `name` is returned **only** in the valid case.

## Users (`routes/users.ts`) — auth required
```
GET    /users/@me                                        → { user }
PATCH  /users/@me             { displayName?, avatar?, banner?, accentColor?, accentColorSecondary?,
                                avatarColor?, bio?, pronouns?, profileLinks?, profileLayout?,
                                avatarFrame?, profileEffect?, nameplate?, nameFont?, nameEffect?, spaceTag?,
                                customStatus?, customStatusExpiresInMinutes?, status?,
                                replicatedInstances?, homeUserId?,
                                profileUpdatedAt?, showActivity? } → { user }
POST   /users/@me/verify-password  { password }          → { valid }
POST   /users/@me/change-password  { currentPassword?, newPassword } → { token }
GET    /users/@me/storage                                → StorageUsage { usedBytes, limitBytes | null }; a person's own files and their bots'
GET    /users/@me/data-export                            → DataExportStatus
POST   /users/@me/data-export     { password }           → 202 DataExportStatus; 403 current_password_incorrect, 429 data_export_too_soon { hours }
GET    /users/@me/data-export/download                   → the ZIP, to its owner alone; 404 data_export_not_ready
GET    /users/@me/mentions    ?before&limit              → { mentions: MentionItem[], nextBefore }  (inbox.ts; `MentionItem.mentionedNames` names the people the text mentions, as that space shows them, because the client holds no member list for most spaces)
DELETE /users/@me             { password, username }      → { success }
PUT    /users/@me/space-layout { items, folders, updatedAt? } → { items, folders, updatedAt }
GET    /users/@me/federation-registry                    → { registry: FederationRegistryEntry[], updatedAt: number }
PUT    /users/@me/federation-registry { registry, updatedAt } → { ok: true, updatedAt } (409 if not newer)
POST   /users/@me/federation-credential { origin, markProvisioned?, password?, twoFactorCode? } → { origin, secret?, provisioned }
GET    /users/:id                                        → { user }
GET    /users/:id/mutuals     ?homeUserId=               → { mutualFriends[], mutualSpaces[] }
```

**No discovery flag:** `discoverable` is gone with the Discover People list (migration `0042_orbit_drop_discoverable`); the route no longer reads it, so it is ignored next to other fields, and a body carrying nothing else answers `400 no_fields_to_update`. People are found by username only (`GET /social/search`, below).

**Badges:** every `User` carries `badges` (`UserBadgeId[]`, in the order of the registry in `packages/shared/src/badges.ts`): `staff` for an instance admin (`users.is_admin`), then the badges an instance admin granted (`users.badges`, read through `grantedUserBadgesOf`, which drops anything the registry does not know as a granted user badge). A tombstone carries `[]`. Nothing on this route sets them; the only writer is `PUT /admin/users/:id/badges` (Platform administration below). Hosts that predate badges omit the field.

**Status:** `status` is the user's chosen status: `online`, `idle` or `dnd`; anything else, including `offline`, is 400 `status_invalid`. It is stored in `users.chosen_status` and published as live presence (local `presence_update` and S2S relay) while the user is connected; see activity-presence.md "DB Persistence". A body with only `status` is a valid update.

**Profile card fields:** `pronouns` (a string, trimmed, at most 40 characters, no control or bidirectional characters; blank or null clears it; `400 pronouns_too_long` with `details.max`), `profileLinks` (a list of at most 5 `{ url, label? }`, each `url` a plain `http`/`https` address without credentials of at most 200 characters and each `label` at most 32 characters; null or an empty list clears them; the same address twice is kept once; anything else is `400 profile_links_invalid` with `details.max`) and `profileLayout` (`'standard'`, `'centered'` or `'compact'`, or null for standard; `400 profile_layout_invalid`). Every `User` carries `pronouns`, `profileLinks` (a list, empty when none) and `profileLayout`. The rules are `normalizePronouns` / `normalizeProfileLinks` in packages/shared/src/profileFields.ts, which the editor and the profile card read too (auth.md, "Profile fields"). Like `accentColorSecondary`, these three are not relayed to federation peers.

**Space tag:** `spaceTag` is the id of a space of this instance whose tag to wear, or null for none; the space must have a tag and the caller must be its member, else `400 space_tag_unavailable`. Every `User` carries `spaceTag` (`{ spaceId, text, glyph, color }` or null). See space-tags.md.

**Decorations:** `avatarFrame`, `profileEffect`, `nameplate`, `nameFont` and `nameEffect` each take the name of one of the designs in packages/shared/src/decorations.ts, or null to clear it; `nameFont: 'classic'` is stored as none. Anything else is `400 profile_decoration_invalid` with `details.field`, and nothing of the update is stored (`decorationUpdateOf`). Every `User` carries the five fields, null for none, so that an update merged over an older copy clears one. A change is announced as `user_updated`. Not relayed to federation peers (decorations.md).

**Pictures:** `avatar` and `banner` name a file on this instance only when it is the caller's own upload that no message holds, or the picture already shown (`400 avatar_url_invalid` / `banner_url_invalid` otherwise); a replaced picture is deleted only once nothing else shows it (uploads.md, "Profile pictures"). The same rule holds for `icon` and `banner` on `POST /spaces` and `PATCH /spaces/:id` (`400 icon_url_invalid` / `banner_url_invalid`). An address (`http(s)://…`) is only taken for an upload of this instance (`/api/uploads/<name>`, nothing added): everyone who sees the picture fetches it by themselves, so it never points at another server (legal.md, "Content from other servers"). A group DM's `icon` (`PATCH /api/dm/:id`) may also be an upload at the home of the member who sets it. An address stored before 1.32.4 that points anywhere else is answered as `null`.

**Stickers:** a message or a reaction whose content is a sticker token (`sticker:<address>`) is refused with `400 sticker_elsewhere` (on the socket, an `error` with that code) unless the sticker's file is on this instance or on the instance its author lives on (`utils/remoteMedia.ts`).

**Write protection:** If the authenticated user is a replicated user (`homeInstance` is set **and** `federationHomeOrphaned !== 1`), the following fields are rejected with 403: `displayName`, `avatar`, `banner`, `accentColor`, `avatarColor`, `bio`. These fields are managed by the home instance via S2S relay. **Exception — detached accounts** (`federationHomeOrphaned === 1`): a federated account whose home instance was reset/lost is a sovereign local account with no home managing its profile, so it edits these durable fields locally like a native user (detach design §4.4). Detached edits are NOT relayed (the S2S profile-relay path stays gated on `!homeInstance`).

**Self-view flag:** `GET /users/@me`, the login response, and the WS `ready` payload all sanitize the row with `isSelf=true` and include `federationHomeOrphaned: boolean` (detach design §4.7) and `detachedHomeInstance: string | null` (the home a detached account was federated from; a detached account is homed on this instance, so `homeInstance` is null — `federation.md`, "Detached accounts are homed here") — self-view only; it is never exposed to other users and never on the deleted/tombstone branch.

**`POST /users/@me/federation-credential`:** get-or-create the per-remote credential this account's client presents when registering or logging in as itself on another instance. Scoped to `request.userId`; the secret is never derived from and never equal to the account password. See `auth.md` §5b and `client-federation.md` §1.

- The `secret` is in the answer only when the request carries the account's current `password` (and `twoFactorCode` while 2FA is on): `403 current_password_incorrect`, `403 mfa_code_required` / `mfa_code_invalid`, `429 login_throttled`. Without a password the answer is `{ origin, provisioned }` and no row is made; `markProvisioned: true` then marks an existing row only. `password` that is not a string → **400**. Rate limit 60/min.

- `origin` is canonicalized to `https://host[:port]` (lowercased, no path), so `orbit.example`, `orbit.example/`, and `https://Tavvit.example` all address one row. Unparseable or non-http(s) values → **400**; our own origin → **400** (a credential is only ever for a remote).
- **409** when the caller is a replicated federated account (`homeInstance` set and `federationHomeOrphaned !== 1`) — credentials are issued by the account's own home instance so exactly one secret exists per (user, remote). Detached accounts follow the LOCAL rule and DO get credentials.
- Creation is `onConflictDoNothing` + re-read, i.e. **first-writer-wins**: a racing second call returns the stored secret rather than replacing it and locking the loser out of the remote account.
- `markProvisioned: true` latches `provisionedAt` (set-once, never rotates the secret). `provisioned: false` means the remote account may still carry a credential this instance did not issue, and the client will rotate it the next time it holds a live session there.
- Rows are deleted by `tombstoneUser` and by `POST /users/@me/federation-identity/delete` in `soft`/`full` mode (not `leave` — the remote account survives and keeps using the secret).

## Spaces (`routes/spaces.ts`) — auth required
```
GET    /spaces                                                                 → { spaces[] }
POST   /spaces                { name, icon?, description? }                    → { space }
GET    /spaces/:id                                                             → { space, channels[], members[], roles[] }
PATCH  /spaces/:id            { name?, icon?, banner?, description?, visibility?, avatarColor?, directoryListed?, ownerTitle?, ownerGroup?, defaultNotificationLevel? } → { space }   [MANAGE_SPACE; ownerTitle, ownerGroup: owner]
DELETE /spaces/:id                                                             → { success }  [owner]
POST   /spaces/:id/invite                                                      → { inviteCode }  [CREATE_INVITE]
POST   /spaces/:id/join       { inviteCode }                                   → { space }
POST   /spaces/join           { inviteCode }                                   → { space }
GET    /spaces/invite/:code/preview                                            → InvitePreview (no auth); 404 for a link that was revoked, ran out or expired
GET    /spaces/:id/invites                                                     → { invites: SpaceInviteLink[] }  [MANAGE_SPACE]
POST   /spaces/:id/invites    { expiresInSeconds, maxUses }                    → 201 { invites }  [CREATE_INVITE]; only the values in INVITE_EXPIRY_SECONDS and INVITE_MAX_USES, or null
DELETE /spaces/:id/invites/:code                                               → { invites }  [MANAGE_SPACE]
PATCH  /spaces/:id/transfer-ownership  { newOwnerId }                          → { space }  [owner]
```
`POST /spaces/:id/invite` answers every visibility, `request` included (up to 1.9.0 it refused a request space with `403 space_uses_join_requests`). The two join routes never admit anyone to a `request` space: after the code matches they answer `403 user_banned`, `409 already_member`, then, for a request space, `409 join_request_pending` when the caller's request is waiting and otherwise `403 join_request_required` with `details: { spaceId }`, the id for `POST /spaces/:id/request-join`. They read the space's visibility on each call, so a code follows the space when its visibility changes. `InvitePreview` carries `visibility` (absent from an instance up to 1.9.0). See [spaces.md](spaces.md), "Join by Invite Code".
`InvitePreview.movedFromDiscord` (absent from an instance before 1.34.0) is true once something came over from Discord into the space: a template imported into it, or an emoji and sticker import that brought anything (`spaces.discord_imported_at`; Import below). The join page shows its welcome for people coming from Discord only for a link with `?from=discord` whose preview says so; the parameter is read by the page alone, and no request carries it (spaces.md, "Telling the Discord server").
`directoryListed` must be a boolean (`400 field_not_boolean`), is refused with `400 directory_private_space` when the resulting visibility is `private`, and is cleared in the same write when a listed space is switched to `private`. `Space.directoryListed` is carried on every space response and in the WebSocket ready payload. A change to the flag, to a served field (`name`, `description`, `icon`, `banner`, `avatarColor`, `visibility`) of a listed space, or a `DELETE` of a listed space marks the directory dirty so the pinger tells the hub. See [directory.md](directory.md).
The PATCH also moves the space's Discovery review (Reviews below): a space whose listing is `approved` goes back to `pending`, hidden until an admin approves again, when the write changes its `name`, `description`, `icon` or `banner`; a public or request space made private while its listing is `approved` or its request open (`pending`, `changes_requested`) goes to `withdrawn`. An open request (`pending`, `changes_requested`) whose space changes those fields keeps its status and takes the edit as a new version (`requested_at` = the time of the edit), so an admin decision on the earlier view answers `409 review_status_conflict`; a `verified` space whose `name` changes goes back to `pending` without its badge. The statuses are written in the same update as the edit (`reviewsAfterEdit`, `utils/spaceReview.ts`), so no edit is listed or vouched for unseen, and each step is recorded as `changed` with the editor as actor and announced like any review step (`space_review_updated` to the owner, `review_queue_count` to the admins; websocket.md, "Platform administration"). A member with `MANAGE_SPACE` who is not the owner moves it the same way.
Every `Space` the server sends (space responses, the ready payload, `space_updated`) carries `badges` (`SpaceBadgeId[]`): `verified` while `verification_status` is `verified`, then the badges an instance admin granted (`spaces.badges`). Every `MemberWithUser` of the space detail, the member list and `member_updated` carries `badges` (`MemberBadgeId[]`), worked out by the hosting server from the member's roles, whose bits members cannot see (`memberStaffBadges`, `utils/spaceWire.ts`): `administrator` when a role other than @everyone carries ADMINISTRATOR, else `moderator` when one carries KICK_MEMBERS, BAN_MEMBERS, MODERATE_MEMBERS or MANAGE_MESSAGES, else none. Owning the space is not among them: the client reads that from `Space.ownerId`. A member who just joined carries `[]`. Hosts that predate badges omit both fields.
`ownerTitle` (a string, or `null` to reset) is accepted from the space's owner only: anyone else who sends it gets `403 space_owner_only` and nothing in the body is written, whatever role they hold. The owner is compared by the caller's row on this instance (`request.userId === spaces.owner_id`), so a federated owner sets it through their replicated row here. The value goes through `normalizeOwnerTitle` (`packages/shared/src/constants.ts`): `null` resets; a string is trimmed and refused with `400 space_owner_title_invalid` (`details: { max }`) when it trims to nothing, is longer than `MAX_OWNER_TITLE_LENGTH` (32 UTF-16 code units), holds a control character, a line or paragraph separator or a bidirectional control, or has no visible character. A blank string does not reset, unlike a nickname. `Space.ownerTitle` is carried on every space response and in the ready payload, `null` when unset. `PATCH /spaces/:id/transfer-ownership` clears it. Instances up to 1.10.0 omit the field and ignore it in a PATCH (`200`, nothing written).
`ownerGroup` (a boolean, else `400 validation_failed`) is the owner's alone like `ownerTitle` (`403 space_owner_only` for anyone else, nothing written): true lists the owner in a group of their own at the top of the member list, false under their own roles with a crown (spaces.md, "Ownership and roles"). `Space.ownerGroup` is carried on every space response and in the ready payload.
`defaultNotificationLevel` is `'all'`, `'mentions'` or `null` (the built-in default), else `400 notification_level_invalid`; it is the level members start with until they choose their own, and is carried on every space response and in the ready payload as `Space.defaultNotificationLevel` (spaces.md, "Moderation", "Default notification level"). `PATCH /spaces/:id/transfer-ownership` also ends a timeout the new owner was under. Every change these routes make is recorded in the space's audit log (spaces.md, "Moderation", "Audit log").

### Members
```
GET    /spaces/:id/members                               → { members[] }
PATCH  /spaces/:id/members/:uid  { roleIds?, nickname? } → { member }  [roleIds: MANAGE_ROLES; nickname: self, or MANAGE_SPACE]
PATCH  /spaces/:id/members/@me/profile  { avatar?, banner?, bio? } → { member }  [self]
DELETE /spaces/:id/members/:uid  { reason? }             → { success }  [KICK_MEMBERS|self]; the reason goes to the audit log, at most 512 characters
```
`PATCH /members/:uid` takes `roleIds`, `nickname` or both; a body with neither, or one that is not an object, answers `400 validation_failed`. Every field is checked before anything is written, and both are written in one transaction, so a refused field leaves the other unchanged too. `nickname` is the member's name in this space (`space_members.nickname`); the account name is not touched. Anyone may set their own. Setting another member's needs `MANAGE_SPACE` (`403 missing_permission`), never reaches the owner (`403 space_owner_only`) and needs a higher rank (`403 role_hierarchy`). The value goes through `normalizeMemberNickname` (`packages/shared/src/constants.ts`): `null` or a string that trims to nothing clears it; otherwise it is trimmed and refused with `400 member_nickname_invalid` (`details: { max }`) when longer than `MAX_MEMBER_NICKNAME_LENGTH` (32 UTF-16 code units), when it holds a control character, a line or paragraph separator or a bidirectional control, or when it has no visible character. The answer is followed by `member_updated` to the space (websocket.md); a role change is also followed by `space_access_changed`. Instances up to 1.9.x read only `roleIds` and refuse a nickname-only body (`role_ids_invalid`, `cannot_change_own_roles` or `missing_permission`). The owner may change their own `roleIds`; anyone else gets `403 cannot_change_own_roles` (spaces.md, "Ownership and roles").

`PATCH /members/@me/profile` sets the caller's own space profile (spaces.md, "Space profiles"): `avatar` and `banner` name a file the caller uploaded to this instance that no message holds, or the current one (`400 avatar_url_invalid` / `banner_url_invalid` otherwise), `bio` at most 190 characters (`400 bio_too_long`); null or `''` clears a field. `404 not_space_member` without a membership, `400 no_fields_to_update` for an empty body. Followed by `member_updated`. `MemberWithUser` carries `avatar`, `banner` and `bio`, null when unset.

### Bans
```
GET    /spaces/:id/bans                                  → { bans[] }  [BAN_MEMBERS]
POST   /spaces/:id/bans       { userId, reason?, deleteMessagesSeconds? }  → { success }  [BAN_MEMBERS]; 0, 3600, 86400 or 604800, see spaces.md, "Removing someone"
DELETE /spaces/:id/bans/:uid                             → { success }  [BAN_MEMBERS]
```

### Moderation (`routes/spaceModeration.ts`)
```
GET    /spaces/:id/moderation                                      → SpaceModerationSettings  [MANAGE_SPACE]
PATCH  /spaces/:id/moderation        UpdateSpaceModerationRequest  → SpaceModerationSettings  [MANAGE_SPACE]
PUT    /spaces/:id/members/:uid/timeout  { durationSeconds, reason? } → MemberResponse { member }  [MODERATE_MEMBERS + hierarchy]
DELETE /spaces/:id/members/:uid/timeout                            → MemberResponse { member }  [MODERATE_MEMBERS + hierarchy]
GET    /spaces/:id/audit-log  ?before=&limit=&action=&actorId=     → AuditLogResponse { entries, users, nextBefore }  [VIEW_AUDIT_LOG]
```
All five answer `404 space_not_found` for an unknown space and `403 missing_permission` (`details.permission`) without the bit. What the rules, timeouts and entries do is in [spaces.md](spaces.md), "Moderation".

`GET /moderation` answers the space's rules, the defaults with `updatedAt: null` for a space that never changed them. `PATCH /moderation` takes any of `blockedWords` (a list of strings), `blockLinks`, `blockInvites` (booleans), `maxMentions` (a whole number 0 to `MAX_MENTIONS_CAP`), `minAccountAgeMinutes`, `minMemberAgeMinutes` (0 to `MAX_AGE_MINUTES`); a field left out keeps its value and unknown fields are ignored. A body that is not an object answers `400 validation_failed`, one with none of the fields `400 no_fields_to_update`, and the first field that is not valid `400 moderation_settings_invalid` with `details.field` (its name; for `blockedWords` also a list over `MAX_BLOCKED_WORDS` entries, an entry over `MAX_BLOCKED_WORD_LENGTH` characters, or one holding a control or bidirectional character), with nothing written. The answer is the rules as stored (`normalizeModerationSettings`: entries trimmed, deduplicated without case, empty ones dropped) with the new `updatedAt`; a change that leaves them as they were writes nothing and answers them unchanged.

`PUT /members/:uid/timeout` takes `durationSeconds`, a whole number from `MIN_TIMEOUT_SECONDS` (60) to `MAX_TIMEOUT_SECONDS` (2,419,200, 28 days), else `400 timeout_duration_invalid`, and `reason`, a string or null trimmed to at most `MAX_REASON_LENGTH` (512) characters, else `400 timeout_reason_too_long` (`details.max`; a reason of another type is `400 validation_failed`). The end is the server's time plus the duration and replaces a running timeout. Both timeout routes refuse oneself (`400 cannot_target_self`), the owner (`400 cannot_target_owner`), a non-member (`404 member_not_found`) and a member the caller does not outrank (`403 role_hierarchy`), in that order after the permission check, and answer the member with `timedOutUntil` (null when none runs), followed by `member_updated` to the space. A timeout also disconnects the member from the space's voice. `DELETE` on a member who is not timed out changes nothing and answers the member.

`GET /audit-log` answers at most `limit` entries (default `AUDIT_LOG_PAGE_SIZE` 50, clamped to 1-`AUDIT_LOG_MAX_PAGE_SIZE` 100), newest first, older than the entry id `before` when given, of one `action` (one of `AUDIT_LOG_ACTIONS`) and one `actorId` when given; `users` holds the public user objects of the page's actors and member targets, and `nextBefore` the id to send as `before` for the next older page, null at the end. A `before` that is not a decimal id, a `limit` that is not a whole number, an unknown `action` or a repeated parameter answers `400 validation_failed`.

### Roles
```
POST   /spaces/:id/roles              { name, color?, colorSecondary?, description?, icon?, hoist?, mentionable?, permissions? }  → { role }  [MANAGE_ROLES]
PATCH  /spaces/:id/roles/:rid         { name?, color?, colorSecondary?, description?, icon?, hoist?, mentionable?, position?, above?, below?, permissions?, permissionsVersion? }  → { role }  [MANAGE_ROLES]
DELETE /spaces/:id/roles/:rid                                                     → { success }  [MANAGE_ROLES]
POST   /spaces/:id/members/:uid/roles { roleId }                                 → { success }  [MANAGE_ROLES]
DELETE /spaces/:id/members/:uid/roles/:rid                                        → { success }  [MANAGE_ROLES]
```
Kick, ban, the member role routes and the role routes also enforce the role hierarchy, answering `403 role_hierarchy` (permissions.md, "Role hierarchy"). `POST` and `PATCH /roles` also apply the held-bits rule (permissions.md, "Held-bits rule"): switching on a bit the actor does not hold answers `403 cannot_grant_unowned_permissions`, switching one off `403 cannot_change_unowned_permissions`; `DELETE /roles/:rid` of a role carrying a bit the actor does not hold answers `403 cannot_change_unowned_permissions`, and giving a member such a role (`PATCH /members/:uid`, `POST /members/:uid/roles`) `403 cannot_grant_unowned_permissions`; a `permissions` value that is not a canonical non-negative decimal string answers `400 permissions_invalid` (permissions.md, "Stored form"). `PATCH /roles/:rid` with `permissions` also takes `permissionsVersion`, the `rolePermissionsVersion` of the permissions the editor loaded: when the role's stored permissions have another version by then, the whole request answers `409 role_permissions_conflict` and nothing changes; a `permissionsVersion` that is not a non-empty string answers `400 validation_failed`. Without it (clients from before the check, 1.9.x and older) the write is not compared, and without `permissions` it is ignored (permissions.md, "Concurrent edits"). Editing a role below the actor is allowed whoever holds it, members ranked above the actor included (permissions.md, "Lower roles held by senior members"). `PATCH /members/:uid` takes `roleIds`, the member's whole role set: a list of distinct role id strings, else `400 role_ids_invalid`. Every write in this section is followed by `space_access_changed` to the space's connected members (websocket.md). `PATCH /roles/:rid` answers `404 role_not_in_space` for a role of another space. `PATCH /roles/:rid { position }` moves the role to that position (1 = just above @everyone) and renumbers the others; `{ above: roleId }` or `{ below: roleId }` instead moves it directly next to that role of the space and the request's `position` is then ignored (permissions.md, "Setting the order"): naming both, the role itself, @everyone with `below`, or a non-string answers `400 validation_failed`, a role of another space `400 role_not_in_space`. A new role is created at 1. The single-role routes refuse a role of another space with `400 role_not_in_space`.

A role in any answer carries `permissions` only for a viewer who holds `MANAGE_ROLES` in the space: `GET /spaces/:id` lists every role with its display fields for every member and with its bits for managers, member rows (`GET /spaces/:id/members`, `PATCH /members/:uid`, `members[]` of the detail) list roles with display fields only, and the `POST`/`PATCH /roles` answers are shaped for what the actor holds after the change (permissions.md, "Who receives role and override data").

`DELETE /spaces/:id/roles/:rid` answers `404 role_not_in_space` for a role id that is not in the space, and otherwise deletes the role together with every channel and category override that names it (overrides carry no foreign key to the role).

The display fields (`colorSecondary`, `description`, `icon`, `hoist`, `mentionable`) are checked as spaces.md, "Create Role" lists them: `400 role_name_required`, `role_name_too_long`, `role_name_invalid` (a control, bidirectional or zero-width character; the joiners and variation selectors of emoji are allowed), `role_color_invalid`, `role_description_too_long`, `role_icon_invalid` or `validation_failed`, with nothing written; `hoist` and `mentionable` are refused on @everyone. Every `Role` carries them; `hoist` is true and `mentionable` false for a role that never set them.

### Reviews (`routes/spaceReview.ts`)
```
GET    /spaces/:id/review                                  → SpaceReviewState  [owner, or instance admin]
PUT    /spaces/:id/verification  VerificationRequestBody   → SpaceReviewState  [owner]
DELETE /spaces/:id/verification                            → SpaceReviewState  [owner]
PUT    /spaces/:id/discovery     { category }              → SpaceReviewState  [owner]
DELETE /spaces/:id/discovery                               → SpaceReviewState  [owner]
```
The owner's side of the platform's two reviews of a space, Verification and Discovery approval; an instance admin decides them (Platform administration below; admin.md, "Platform administration"). "Owner" is `spaces.owner_id` compared with the caller's row on this instance (`request.userId`), as for `ownerTitle`: no role, the owner group or a permission bit stands in for owning the space, and anyone else gets `403 space_owner_only`. `GET` also answers an instance admin (`users.is_admin`). All five answer `404 space_not_found` for an unknown space. The types are in `packages/shared/src/platform.ts`.

`SpaceReviewState` is `{ spaceId, verification: { status, request, history }, discovery: { status, request, history } }`: each process's status (`VerificationStatus` / `DiscoveryStatus`, null while never asked), its request as last sent with the decision on it (`VerificationRequestView`, `DiscoveryRequestView`, null without), and every step of it oldest first (`ReviewEvent`: `action`, the `status` it left, `actor`, the admin's `note`, `createdAt`).

`PUT /verification` asks for verification, or asks again with new content from any status but `verified` (`409 review_already_verified`, checked before the body). The body is `{ category, website?, profiles?, reason, proof }`: `category` one of `SPACE_CATEGORIES` (`400 review_category_invalid`); `website` and each of `profiles` an `http`/`https` address without credentials or whitespace, at most `REVIEW_LIMITS.URL_MAX_LENGTH` (200) characters once normalised, never fetched (`400 review_url_invalid`, `details.max`; a `profiles` that is not a list answers the same), a blank entry skipped and a repeat kept once, at most 5 profiles (`400 review_too_many_profiles`, `details.max`); `reason` 20-1000 and `proof` 10-1000 characters once trimmed, without control characters other than tab and line feed (`400 review_reason_invalid` / `review_proof_invalid`, `details: { min, max }`). The request stores the space's name and description of the moment, replaces an earlier request with its decision, and sets the status `pending`. `DELETE /verification` takes back a request that is `pending` or `needs_info` (else `409 review_status_conflict`); the status returns to null.

`PUT /discovery` asks for a listing, or asks again: the space must be public or request (`409 discovery_requires_listable_visibility`) and have a description (`409 discovery_requires_description`), and `category` is checked as above. It sets `pending` from any status, `approved` included, so a listed space that asks again leaves Discovery until an admin approves it again. The listing shows the space's name, description, pictures and member count; the request adds the category. `DELETE /discovery` takes back a request or a listing that is `pending`, `changes_requested` or `approved` (else `409 review_status_conflict`) and leaves `withdrawn`.

The two `PUT`s share a budget of 10 per hour per account (`429 rate_limited`), counted only once a request passed the checks above; the `DELETE`s have only the global limit. Every step is announced (`announceReviewStep`, `utils/reviewNotify.ts`): `space_review_updated` to the owner and `review_queue_count` to the instance's admins, then `space_updated` to the space after a verification step (the verified badge) and, after a Discovery step of a space opted in to the directory, a dirty directory (websocket.md, "Platform administration").

**Listed in Discovery.** Only an admin's approval lists a space: `LISTED_IN_DISCOVERY_SQL` (`utils/discoveryListing.ts`), `visibility IN ('public', 'request') AND discovery_status = 'approved'`, is the one predicate `GET /spaces/explore`, the directory document (`GET /directory/spaces`) and the admin overview read. A visibility of public or request lists nothing by itself, and `directoryListed` only adds the directory on top of an approved listing.

## Import (`routes/discordImport.ts`) — auth required
```
POST   /import/discord/preview  { code? | template?, spaceId? }                         → DiscordImportPreview
POST   /import/discord/apply    { code? | template?, target: { kind: 'new', name? } | { kind: 'existing', spaceId } }  → DiscordImportResult { space, plan }  [existing: owner, or MANAGE_ROLES + MANAGE_CHANNELS]
```
A Discord server template as a new space or added to one (spaces.md, "Importing a Discord template"). The source is `code` (a template code, fetched from `https://discord.com/api/v10/guilds/templates/{code}` and nowhere else) or `template` (that endpoint's JSON). `preview` changes nothing; `apply` writes the plan in one transaction and answers `201` for a new space, `200` for an existing one. Errors: `400 validation_failed`, `400 discord_template_code_invalid`, `400 discord_template_invalid` (`details.field`), `413 discord_template_too_many_roles` / `_too_many_channels` / `_too_many_overwrites` (`details.max`), `413 discord_template_too_large` (`details.max` in MB), `403 role_hierarchy` (the importer's top role is the lowest and the template would create roles), `404 discord_template_not_found`, `429 discord_rate_limited` (`details.retryAfterSeconds`), `502 discord_unreachable`, `404 space_not_found`, `403 import_target_forbidden`, and `429 rate_limited` past 10 starts a minute per user. The plan's types (`DiscordImportPlan`, its role, category, channel and note entries) are in packages/shared/src/discordImport.ts.

Since 1.34.0 the preview's `template` carries `sourceGuildId`, the Discord server the template was made from (null when the template does not name one), which the Get from Discord tab hands to the emoji and sticker import below. An `apply` sets `spaces.discord_imported_at` on the space it writes (`InvitePreview.movedFromDiscord`, Spaces above). A role's Discord bits 30 (Manage Expressions) and 43 (Create Expressions) give MANAGE_EMOJIS and MANAGE_SOUNDS only together (`DISCORD_COMBINED_PERMISSIONS`), and one of them alone is listed as unsupported; 35 (Create Public Threads) gives CREATE_THREADS and 42 (Use Soundboard) USE_SOUNDBOARD.

### Emoji and stickers from Discord (`routes/discordExpressionImport.ts`)
```
POST   /import/discord/expressions/preview    { spaceId, guildId, token }        → DiscordExpressionPreview  [MANAGE_EMOJIS]
POST   /import/discord/expressions/apply      { importId, selection?, after? }   → DiscordExpressionApplyResult  [MANAGE_EMOJIS]
DELETE /import/discord/expressions/:importId                                      → { success }
```
A Discord server's emoji and stickers brought into a space (spaces.md, "Importing emoji and stickers from Discord"); the types are in packages/shared/src/discordExpressionImport.ts. Closed to bots. Both POSTs take what the space emoji routes take, MANAGE_EMOJIS and nothing holding the caller's actions in the space (`expressionManagerRefusal`; "Custom emoji and space stickers" below).

`preview` checks, in this order: the right; `guildId`, 17 to 20 digits once trimmed (`400 discord_server_id_invalid`); `token`, a bot token in the form Discord issues them, three dot-separated parts, with a pasted `Bot ` in front forgiven (`400 discord_bot_token_invalid`); no import of the account's own with a batch running (`409 discord_import_running`); room in the in-memory session store (`429 rate_limited`); 5 look-ups per account in 10 minutes, counted only once the request could reach Discord (`429 rate_limited`). Then it makes two requests, `GET https://discord.com/api/v10/guilds/{id}/emojis` and, only after that one succeeded, `/stickers`, each with `Authorization: Bot <token>`, redirects refused, the public-only dispatcher, 10 seconds and 1 MB, and `User-Agent: DiscordBot (https://github.com/yDulli/Tavvit, <version>)`. Discord's answers become `400 discord_bot_token_invalid` (401, or Discord's code 40001; never passed on as a 401, which the web client takes as the end of its own session), `400 discord_bot_not_in_server` (403, 404, codes 50001 and 10004), `429 discord_rate_limited` (`details.retryAfterSeconds`), and `502 discord_unreachable` for anything else, an unreadable or oversized list included. The right and a running import are checked again once Discord has answered. The token is used for those two requests only: it is never stored, logged, echoed in an error or put in an event, and the session the look-up opens has no field for it. Of the two lists only each emoji's id, name, animated flag, `managed` flag and whether roles restricted it, and each sticker's id, name and format, are kept, and only the server's own stickers (type 2); who uploaded them, the role lists, tags and descriptions are dropped as they are read.

The answer is `{ importId, expiresAt, items, room, limits }`: `expiresAt` is when the import ends unless it is used again, `room` what the space can still take (`{ emoji, stickers }`), `limits` its limits. Each item is `{ key, kind, discordId, sourceName, name, animated, format?, action, skip, notes }`, emoji first, each kind in Discord's order. `key` is `emoji:<discordId>` or `sticker:<discordId>`, what a selection names; `name` is the name it gets here, made valid (an emoji's lower case, `a-z`, `0-9` and `_`) and free in the space (`name_2`, `name (2)`); `action` is `import` or `skip`, and `skip` null or one of `not_selected` (decided first), `lottie` (a vector sticker, which cannot be decoded), `managed` (an integration's emoji), `already_here` (an earlier import brought that Discord id) and `no_room` (room is taken in Discord's order). `notes` holds any of `renamed`, `still_picture` (an APNG sticker comes over as a still picture) and `role_restriction_dropped` (only some roles could use it on Discord; here every member can).

`apply` runs one batch, without the token. The first call that arrives fixes the selection: `selection`, keys of the preview, or everything when it is absent (`400 validation_failed`, `details.field: 'selection'`, for a key the listing does not hold). A batch brings at most 8 pictures, starts none after 12 seconds and lets no fetch run past 20; before every picture it plans again against the space and asks again whether the importer may still add, and the add asks once more right before the row is inserted. A picture comes only from `https://cdn.discordapp.com` or `https://media.discordapp.net`, with no token, no redirect, 8 seconds, an `image/*` answer and at most an upload's size (3 MB an emoji, 5 MB a sticker), and then goes through the same add as an upload ("Custom emoji and space stickers" below). The answer is `{ done, total, finished, stopped, results }`: `done` of the `total` picked are settled, `stopped` is `storage_limit_reached` or `disk_full` when the importer's storage or the disk ended the import (else null), and `results` holds what was settled after the cursor `after`, the number of results the client already has, each `{ key, kind, discordId, name, outcome }` with `outcome` one of `imported`, `already_here`, `no_room`, `lottie`, `managed`, `download_failed` and `image_refused`. `409 discord_import_running` while a batch of the import runs; `404 discord_import_expired` for an import that is unknown, another account's or forgotten; `404 space_not_found` when the space went away during the batch; `403 missing_permission` or a member action refusal once the importer may no longer add (a batch that meets one ends there, and the next call answers it). An import that is over keeps its outcome for 5 minutes, so a call whose answer was lost can ask again and gets everything after its cursor; an open import ends 30 minutes after it was last used; a running one is never ended or pushed out. A restart forgets every import. 60 calls a minute per address.

`DELETE` stops an import of the caller's and answers `{ success: true }` whatever it names; a batch that is running finishes its picture and then ends the import. What came over stays. The web client asks `apply` again until `finished`, also after a request that timed out or a `409` (3 seconds apart, at most 6 times in a row), pauses 3 seconds after a batch that settled nothing, and stops the import when its page is left.

A batch that brought anything sends `space_emojis_changed` or `space_stickers_changed` (or both) to the space (websocket.md) and sets `spaces.discord_imported_at`. The space's audit log gets one `discord_expressions_import` entry per import that brought anything (target the space, `changes` `[{ key: 'emoji', to: n }, { key: 'stickers', to: m }]`), written when the import is over or its open session ends.

## Channels (`routes/channels.ts`) — auth required
```
GET    /spaces/:id/channels                              → { channels[] }  [VIEW_CHANNEL]
POST   /spaces/:id/channels   { name, type?, topic?, categoryId? } → { channel }  [MANAGE_CHANNELS]
PATCH  /channels/:id          { name?, type?, topic?, categoryId?, slowmodeSeconds?, icon? } → { channel }  [MANAGE_CHANNELS]
DELETE /channels/:id                                     → { success }  [MANAGE_CHANNELS]
PATCH  /spaces/:id/channels/reorder  { order }           → reordered  [MANAGE_CHANNELS]
```

`topic` is a string of at most `CHANNEL_TOPIC_MAX_LENGTH` (1024) characters after `normalizeChannelTopic`; on PATCH, `null` or a blank string clears it. A non-string answers `400 channel_topic_invalid`, a longer topic `400 channel_topic_length` with `{ max }` (spaces.md, "Create Channel").

`slowmodeSeconds` on PATCH is one of `SLOWMODE_SECONDS` (0 switches slow mode off), else `400 slowmode_invalid`. Every channel the server sends carries `slowmodeSeconds` (0 when off). See spaces.md, "Moderation", "Slow mode".

`icon` on PATCH is `glyph:<id>` of the role icon set or one standard emoji (`normalizeChannelIcon`); null or a blank string goes back to the type's icon, anything else answers `400 channel_icon_invalid`. Every channel the server sends carries `icon` (null without one). See spaces.md, "Channel icons".

### Channel Overrides
```
GET    /channels/:id/overrides                                   → { channelId, targetType, targetId, allow, deny, version }[]  [MANAGE_ROLES]
PUT    /channels/:id/overrides  { targetType, targetId, allow, deny, version? } → { success, version }  [MANAGE_ROLES]
DELETE /channels/:id/overrides/:targetType/:targetId  ?version=   → { success }  [MANAGE_ROLES]
```
All three check `MANAGE_ROLES` space-wide (permissions.md, "Client gating"). `PUT` and `DELETE` (here and on categories) also follow the role hierarchy (permissions.md, "Role hierarchy"): an override on a role at or above the actor's top role, or on another member ranked at or above the actor, answers `403 role_hierarchy`; a `PUT` naming a role that is not in the space answers `400 role_not_in_space`. `PUT` and `DELETE` (here and on categories) also apply the held-bits rule against the stored override (permissions.md, "Held-bits rule"): a newly allowed unheld bit answers `403 cannot_grant_unowned_permissions`, a newly denied one `403 cannot_deny_unowned_permissions`, and clearing one, or deleting an override that sets one, `403 cannot_change_unowned_permissions`. `DELETE` removes the override row, so the target falls back to its space-wide permissions in that channel; the category routes below do the same for a category. A `PUT` or `DELETE` is followed by `channel_updated` (with the recipient's new `myPermissions`) or `channel_deleted` for each connected member of the space, and a category write also sends `category_updated`. `allow` and `deny` are canonical non-negative decimal strings, else `400 override_bits_invalid`; one left out sets no bits (permissions.md, "Stored form"). The editor stages removals and sends them on Save.

Concurrent edits (here and on categories; permissions.md, "Concurrent edits"): each listed row carries `version` (`overrideVersion` in `packages/shared/src/permissions.ts`, derived from its allow and deny), and a `PUT` answers the `version` of the row it wrote. A `PUT` with `version` (the version of the row the editor loaded, `"none"` when it loaded no row for that target) answers `409 overrides_conflict` and writes nothing when the stored row has another version, including when a row was created meanwhile. A `DELETE` with `?version=` answers the same when the row still exists with another version; a row already gone answers `200`. A `version` that is not a non-empty string answers `400 validation_failed`. Without `version` (clients from before the check, 1.9.x and older) the write is not compared, as before. The check runs after the hierarchy check and before the held-bits rule.

### Categories
```
POST   /spaces/:id/categories        { name }              → { category }  [MANAGE_CHANNELS]
PATCH  /categories/:id               { name?, position? }  → { category }  [MANAGE_CHANNELS]
DELETE /categories/:id                                      → { success }  [MANAGE_CHANNELS]
GET    /categories/:id/overrides                            → { categoryId, targetType, targetId, allow, deny, version }[]  [MANAGE_ROLES]
PUT    /categories/:id/overrides     { targetType, targetId, allow, deny, version? } → { success, version }  [MANAGE_ROLES]
DELETE /categories/:id/overrides/:tt/:tid  ?version=        → { success }  [MANAGE_ROLES]
```

## Messages (`routes/messages.ts`) — auth required
```
GET    /channels/:id/messages  ?before=|after=&limit=50 (1-100) → MessageWithUser[]  [VIEW_CHANNEL+READ_MESSAGE_HISTORY]
POST   /channels/:id/messages  { content, attachments?, replyToId? } → { message }  [SEND_MESSAGES, +ATTACH_FILES, +MENTION_EVERYONE]
PATCH  /messages/:id           { content }                → { message }  [author, +MENTION_EVERYONE]
DELETE /messages/:id                                      → { success }  [author|MANAGE_MESSAGES]
```
`replyToId` on POST must name a message in the same channel, otherwise `400 Invalid reply target` and nothing is inserted. See permissions.md, "Reply-target confinement".

After the permission, content, mass mention and reply checks below, the space's moderation can refuse a POST or PATCH (spaces.md, "Moderation", "Enforcement order"), first match first: `403 member_timed_out` (`details.until`, epoch ms), `403 account_too_new`, `403 membership_too_new`, on POST only `429 slowmode_active` (`details.retryAfterSeconds`), then `403 automod_blocked_word`, `403 automod_invite_blocked`, `403 automod_link_blocked`, `403 automod_too_many_mentions` (`details.max`). An edit is checked as a whole. The owner, ADMINISTRATOR and members with MANAGE_MESSAGES or MANAGE_SPACE are exempt from the ages and the automatic rules, members with MANAGE_MESSAGES or MANAGE_CHANNELS from slow mode; nobody from a timeout. A DELETE by someone other than the author is recorded in the audit log (`message_delete`).

Content with `@everyone`, `@here` or a role token (`<@&roleId>`) outside code needs MENTION_EVERYONE on the channel: without it POST answers `403 missing_permission` (`details.permission` = `MENTION_EVERYONE`) and nothing is stored. PATCH refuses the same way only when the edit adds a mass mention the stored message did not have. Every channel message the server returns or broadcasts carries `mentionEveryone: boolean` and `mentionRoleIds: string[]`, read from its content; a system message carries `false` and `[]` whatever its content holds. See permissions.md, "Mass mentions".

Before the mass mention check, content that uses a space's custom emoji the writer may not use is refused with `403 emoji_unavailable`: on POST, and on PATCH when the edit adds such an emoji the stored text did not carry. An emoji id this instance does not know is not refused; it stays text, which readers see as `:name:` ("Custom emoji and space stickers", "Using a space's emoji", below).

`PUT` and `DELETE /messages/:id/reactions/:emoji` add and take back the caller's reaction to a space message, for callers that do not use the socket (bots may call them), under the rules of the socket's `reaction_add` and `reaction_remove` (`utils/reactions.ts`; websocket.md, "Reactions"). `PUT` answers `400 validation_failed` (`details.field: 'emoji'`) for an empty value or one over 128 characters, `404 message_not_found` also when the caller is no member of the message's space, `403 missing_permission` without VIEW_CHANNEL and ADD_REACTIONS, the member action refusals (`member_timed_out`, `email_verification_required`, `rules_not_accepted`) and `400 sticker_elsewhere`; then, since 1.34.0, a custom emoji `emoji:<id>` must be one this instance holds, of its library or of a space (`400 emoji_not_found`), and a space's emoji one the reactor may use (`403 emoji_unavailable`), except that joining a reaction someone already gave on the message is always allowed; last, `400 reaction_limit_reached` (`details.max`, 20 different reactions). Both answer `{ success: true }`, also when the reaction was already there or already gone.

Every channel message also carries `type`: `user`, or `system` for a row the instance wrote (a poke; websocket.md, "Channel pokes"). History and messages-around return system rows in place; a 1.10.0 or older server sends no `type` and has no channel system rows. A system row is never created over REST. PATCH on one answers `403 system_message_immutable`, its author included, before the author check. A POST whose `replyToId` names a system row is `400 reply_target_invalid`. Channel search (below) leaves system rows out of its results and its count.

### Message history paging

`GET /channels/:id/messages` and `GET /dm/:id/messages` share one implementation (`utils/messagePaging.ts`) and one contract. Both answer a bare array, oldest first: ordered by `createdAt`, the id breaking ties. Permission checks and hydration (authors, attachments, reactions, embeds, reply targets) do not depend on the direction.

| Query | Page |
|-------|------|
| neither cursor | the `limit` newest messages |
| `before=<id>` | the `limit` messages with id less than `<id>` and the newest `createdAt` |
| `after=<id>` | the `limit` messages with the smallest ids greater than `<id>`: the next ids after it |
| both | `400 paging_cursor_conflict`, nothing selected |

- `limit` defaults to 50 and is clamped to 1-100. An empty cursor (`after=`) counts as absent. A repeated cursor (`after=a&after=b`) is `400 validation_failed`.
- Cursors compare snowflake ids; the cursor message need not exist (a deleted message is a valid cursor).
- **Next forward cursor:** the greatest id in the page, not the last element. A relayed DM message keeps its sender's `createdAt` but gets a local id on arrival, so it can sort earlier in the page than its id says. Cutting at the greatest id never skips or repeats a row.
- **End of history:** a forward page shorter than `limit` reached the newest message at the time of the request; an empty forward page means nothing is newer than the cursor.
- **Signal:** a response that honoured `after` carries `X-Backspace-Paging: after` (`MESSAGE_PAGING_HEADER` / `MESSAGE_PAGING_AFTER` in `@backspace/shared`), the empty page included. Backward, newest and error responses never carry it. A server that predates forward paging ignores `after` and answers with the newest page and no header, so a client that sent `after` and finds no header must treat the body as the newest page, not as the page after its cursor. The header is in the CORS `exposedHeaders`, so a browser on another instance can read it (web-security.md, section 6).

## DMs (`routes/dm.ts`) — auth required
```
GET    /dm                                                          → DmChannel[] (open DMs, same shape as the ready payload, newest activity first)
POST   /dm                     { userId } | { homeUserId, homeInstance } → DmChannel (200 existing 1-on-1, 201 new)
POST   /dm/group               { users: [{ id, homeUserId?, homeInstance? }], fromDmChannelId? } → 201 DmChannel [2-9 users + caller; each a friend, or a member of the 1-on-1 `fromDmChannelId`]
PATCH  /dm/:id                 { name?, icon? }                     → { id, name, icon, metadataUpdatedAt } [owner; group only]
DELETE /dm/:id                                                      → { success } [member] (soft-close)
POST   /dm/:id/members         { userId } | { homeUserId, homeInstance } → DmChannel [any member; group only; target must be a friend; max 10]
DELETE /dm/:id/members                                              → { success } (leave) [group only]
DELETE /dm/:id/members/:targetUserId  ?homeInstance=                → { success } [owner kick; cannot self-kick; group only; segment is homeUserId when ?homeInstance is set]
POST   /dm/:id/transfer        { newOwnerId? | (homeUserId+homeInstance) } → { success } [owner; group only; resolved member must be in channel; not self]
POST   /dm/space-invite        { target: { userId } | { homeUserId, homeInstance }, spaceId, spaceInstanceOrigin, inviteCode } → SpaceInviteResponse { dmChannelId, messageId, message } [target must be a friend; 400 invite_invalid when the snapshot would not make a well-formed invite (dm-system.md, "System messages"); a space of any visibility, `request` included (refused up to 1.9.0 with 403 space_requires_approval)]
GET    /dm/:id/messages        ?before=|after=&limit=50 (1-100)     → DmMessageWithUser[] [member]
POST   /dm/:id/messages        { content?, attachments?, replyToId? } → 201 DmMessageWithUser [member; content or attachments required]
PATCH  /dm/messages/:id        { content }                          → DmMessageWithUser [member and author; 403 not_dm_member after leaving the group; 403 system_message_immutable for a system message]
DELETE /dm/messages/:id                                             → { success } [member and author; 403 not_dm_member after leaving the group]
```

**Naming a remote user (federated identity in a DM route).** `POST /dm`, `POST /dm/group`, `POST /dm/:id/members`, `DELETE /dm/:id/members/:targetUserId?homeInstance=`, `POST /dm/:id/transfer` and `POST /dm/space-invite` accept a remote user as the pair `homeUserId` + `homeInstance` and resolve it through `resolveRemoteIdentityForClient` (`utils/federationClientIdentity.ts`). The body never carries a username: the name comes from the identity's home. A known row with its real name is used as is, whatever the state of its home. A new row is created only when the `homeUserId` is a snowflake (decimal digits). For an unknown identity, or a known row that still carries a placeholder name (`<homeUserId>@<domain>`, or a display name; see federation.md "Stub Username Backfill"), whose domain is an active peer, the server asks the home over the signed `POST /api/federation/users/by-home-id` and creates or renames the row as `<username>@<domain>` with the reported profile hydrated, so the first DM already shows the person's name; when the home answers that there is no such user, nothing is created. The route waits at most 2 s for the home (`CLIENT_HOME_LOOKUP_TIMEOUT_MS`); `POST /dm/group` asks the homes of all its members at once. When the home cannot be asked or does not answer (no active peer yet, unreachable, rate limited, too slow) the row is created under `<homeUserId>@<domain>`, as before, and renamed by the first username that arrives later, including the backfill when the peering becomes active (see federation.md "Stub Username Backfill"); that home is not asked about that id again for 60 s (in memory). The DM's first message starts the peering as it always has. Every refusal answers with the route's existing not-found code (`404 user_not_found`, `404 users_not_found` for the group route).

**`POST /dm`** — Opens the caller's 1-on-1 with the target, found or created by `findOrCreateOneOnOne` (`utils/dmConversation.ts`): the row holding the pair's key first, then a row whose members are exactly the pair, else a new keyed row. 201 when the row was created, 200 when it existed; the body is the `DmChannel` from `loadDmChannelWire`, the same shape as the ready payload. An existing conversation the caller had closed is reopened for them (with a `dm_reopen` relay). Nothing is sent to the target: a new conversation holds the target's membership closed, and one the target closed stays closed, until the next message or call in it reopens it for them with `dm_channel_created` (#360). See `docs/systems/dm-system.md` "1-on-1 DM Creation".

**`PATCH /dm/:id`** — Owner-only update of a group DM's `name` and `icon`. Either field may be omitted (no-op), null (clear), or set. Empty/whitespace name collapses to null. `icon` accepts a bare attachment filename owned by the caller (image/*, ≤ `GROUP_DM_ICON_MAX_BYTES`) or an absolute http(s) URL. No-op short-circuit when nothing actually changes — emits no system message and no federation relay. See `docs/systems/dm-system.md` "Group Metadata Update" for the full transaction, federation relay, and icon URL round-trip rules.

**`DELETE /dm/:id/members/:targetUserId`** — Owner kicks a member from a group DM. The `:targetUserId` segment carries either a local user id on the owner's instance OR a federated home user id when the `?homeInstance=<origin>` query string is present (server resolves via `resolveRemoteIdentityForClient` — same pattern as `POST /dm/:id/members`). Federated form is required for federated targets, because the client's cached user view returns the user's home id, not the owner instance's local replicated id. Reuses the leave path with `reason: 'kick'`; evicts the target from the DM voice room first. Sends `dm_channel_closed` to the kicked user. Receivers enforce `sourceInstance === ownerHomeInstance`; non-owner kicks reject as `unauthorized_source`.

**`POST /dm/:id/transfer`** — Owner transfers ownership to another current member without leaving. Body accepts either a local id (`newOwnerId`) or a federated identity (`homeUserId` + `homeInstance`). When both forms are supplied, federated args take precedence. Server resolves via `resolveRemoteIdentityForClient` before checking membership — mirrors `POST /dm/:id/members`. Updates `ownerId`, `ownerHomeUserId`, `ownerHomeInstance`; inserts an `owner_changed` system message; broadcasts `dm_owner_updated`; queues an `ownership_transfer` outbox event. Reuses the existing receiver path (`processOwnershipTransferEvent`) with no protocol changes.

**Custom emoji in a DM.** `POST /dm/:id/messages` and `PATCH /dm/messages/:id` by an account whose home is this instance refuse a space's emoji whose space the writer is not a member of with `403 emoji_unavailable` (an edit only for emoji its previous text did not carry; `utils/dmMessageRules.ts`). A DM message names emoji of its writer's home, so one written here by an account whose home is elsewhere is not checked, nor is a message relayed from a peer ("Custom emoji and space stickers", "Using a space's emoji", below).

## Social (`routes/social.ts`) — auth required
```
GET    /social/friends                                    → { friends[] }
GET    /social/requests                                   → { requests[] }
POST   /social/requests        { username } | { homeUserId, homeInstance, username? } → { success, requestId }
PATCH  /social/requests/:id    { status: 'accepted'|'declined' } → { success } [recipient; pending requests only]
DELETE /social/requests/:id                               → { success } (cancel, sender-only)
DELETE /social/friends/:id                                → { success }
GET    /social/search          ?q=                        → UserSearchResult[]
```

`GET /social/discover`, the Discover People list of everyone who had `discoverable` set, is gone together with the column (migration `0042_orbit_drop_discoverable`): no route lists an instance's people any more.

### GET /api/social/search — finding people by username

The search adds someone whose username one knows; it is not a directory. `q` is trimmed, one leading `@` dropped and the rest lowercased, and must then be 3-32 of `a-z`, `0-9` and `_`, the characters of a username (`400 user_search_query_invalid`, `details: { min, max }`). It matches usernames of this instance only, never display names: the exact name first, then names that start with `q` (an `_` in it matched literally) in alphabetical order, at most 8 results, with no paging and no total. Left out are the caller, deleted accounts, replicated rows (people of other instances, whose stored names are not usernames here), accounts suspended now (`suspendedNow`, `utils/suspension.ts`), and anyone in a block with the caller in either direction (`user_blocks`). Two limits apply: the route's own 30 per minute per address, and 20 per minute per account (`429 rate_limited`), counted only for a query that passed the check above.

The answer is a bare array of `UserSearchResult` (`packages/shared/src/types.ts`): `{ id, username, displayName, avatar, avatarColor, homeInstance, homeUserId }`, what a result row, a friend request or a DM needs, and nothing of the profile beyond it. The web client's Add Friend tab asks the home instance and every connected instance (`socialStore.searchUsers`, one result per person); the two DM pickers (`NewDmModal`, `DmSearchBar`) ask the home instance.

### PATCH /api/social/requests/:id — answering a request

Only the recipient answers (`403 friend_request_not_recipient`), and only a request still `pending`: an accepted or declined one answers `404 friend_request_not_found`, as an unknown id does, and changes nothing. A `status` other than `accepted` or `declined` is `400 validation_failed`. Accepting writes the friendship in the same transaction as the status, and writes none when the two are already friends in either direction, so no answer creates a second friendship row.

### POST /api/social/requests — routing & error codes

The target is named one of two ways (`SendFriendRequest` in `packages/shared/src/types.ts`):

- **By identity:** `homeUserId` + `homeInstance` (bare host or full origin), both required together, else 400 `validation_failed`. Takes precedence over `username`. A `homeInstance` that is this instance's host (port included) or one of its bare domain names (`isOwnDomain`: the origin's host or `DOMAIN`) names a native user here by id (`users.id`, or the `homeUserId` natives carry); anything else is the federated branch with the peer asked by `POST /api/federation/users/by-home-id` instead of `/users/lookup`. The web client uses this for every user it already holds (profile modal, member menu, search results), because a replicated row's `username` is only this instance's label and may be `<homeUserId>@<domain>`, which no peer can look up.
- **By username:** `bare` (local), `bare@<own host>` (also routed local — server normalizes), or `bare@<remote host>` (federated branch). Used for a typed handle; the client sends it trimmed and verbatim.

Clients that send an identity send `username` alongside: a server that predates the identity fields ignores them and reads `username`. All parsing, routing, peering, and remote lookup are server-side.

| HTTP | error code | When |
|---|---|---|
| 200 | (success, idempotent) | Same-direction pending request already exists; returns existing `requestId` |
| 201 | (success, created) | New friend request created |
| 400 | `username_required` | No identity, and a missing/empty/non-string username |
| 400 | `validation_failed` | Only one of `homeUserId` / `homeInstance`, or either is empty or not a string (`homeUserId` at most 128 characters) |
| 400 | `cannot_friend_self` | Looked-up identity matches sender |
| 400 | `invalid_target_domain` | Scheme resolution failed (e.g., non-localhost HTTP target when our scheme is HTTPS) |
| 403 | `peer_rejected` | Remote instance has rejected federation; admin must intervene |
| 403 | `not_authoritative_for_sender` | Caller is a federated (replicated) user; should not have reached here |
| 403 | `blocked_by_you` / `interaction_unavailable` | A block stands between the two, in either direction (`blockRefusal`, `utils/blocks.ts`): the blocker reads `blocked_by_you`, the blocked person the neutral `interaction_unavailable`. Checked for a target here and, on the federated branch, once the remote lookup has resolved the target's row on this instance, before any request is stored or relayed |
| 404 | `user_not_found` | No live native account here of that name or id (`findLocalUserByUsername` / `findNativeUserByHomeId`: a tombstone's or a replicated row's stored name is no handle), or the remote lookup (by name or by home id) found no native user (also tombstoned) |
| 409 | `already_friends` | Friendship row already exists |
| 409 | `peer_pending_approval` | Remote admin needs to approve the peering relationship |
| 409 | `peer_pending_local_admin` | Local instance has `autoAcceptPeering=0` and the user attempted to friend-add a never-peered remote target. The user's own admin must approve before any traffic reaches the wire. Distinct from `peer_pending_approval` (remote admin must approve). See [federation.md → Outbound Peering Gate](federation.md#outbound-peering-gate). |
| 409 | `peer_pending` | Peer handshake in flight |
| 409 | `incoming_request_exists` | Opposite-direction pending request exists; response includes `requestId` for deep-link |
| 429 | `lookup_rate_limited` | Remote `/users/lookup` or `/users/by-home-id` returned 429; `Retry-After` header forwarded |
| 503 | `peer_unreachable` | Remote instance unreachable (network/timeout/lookup-unreachable) |

## Pins (`routes/pins.ts`) — auth required

| Method | Path | Rule |
|--------|------|------|
| GET | `/api/channels/:id/pins` | VIEW_CHANNEL and READ_MESSAGE_HISTORY. Hydrated messages, the latest pin first. |
| PUT, DELETE | `/api/messages/:id/pin` | VIEW_CHANNEL and PIN_MESSAGES or MANAGE_MESSAGES, not while timed out. `403 system_message_immutable` for a system line, `400 pin_limit_reached` at `MAX_PINS_PER_CHANNEL` (50). |
| GET | `/api/dm/:id/pins` | A member of the conversation. |
| PUT, DELETE | `/api/dm/messages/:id/pin` | A member, `403 recipient_deleted` when the partner is gone. |

PUT and DELETE answer `MessagePinState` and change nothing the second time. Each change sends `message_pin_changed`. A channel's pin also leaves a passive system line (`message_pinned`) and an audit entry; a conversation's relays as `pin_set`.

## Forwarding (`routes/forward.ts`) — auth required

`POST /api/messages/:id/forward` and `POST /api/dm/messages/:id/forward` take `{ channelId }` or `{ dmChannelId }`, exactly one (`400 validation_failed`). The reader's rights at the source, and at the target SEND_MESSAGES, ATTACH_FILES when it has files, and the space's moderation rules (`spaceMessageRefusal`), or `dmPostRefusal` in a conversation. A system line is refused.

The result is a new message of the person forwarding it with `forwarded: true`. It names neither the original nor its author. Mentions become plain names and `@everyone` gets a zero-width space, so it alerts nobody where it lands. Files are copied on disk (`COPYFILE_FICLONE`), because deleting a message deletes its files; a file from a peer not here yet is left out, and `400 attachment_invalid` when that leaves nothing. Both ends are on this instance.

Since 1.32.7 a forward's files are hard links where the disk makes them, named like any upload, and count on the forwarder's storage: checked with `uploadRefusal` and held with `reserveUpload` until the rows are written, refused as an upload would be (413 `storage_limit_reached`, 507 `disk_full`).

Since 1.34.0 a forward is never refused for the custom emoji in what it copies, and it does not hand on what the forwarder may not use (`forwardableEmojiText`, `utils/emojiUse.ts`): each space emoji the forwarder may not use where the copy lands becomes its `:name:` in the copy, and in a copy into a direct message by an account whose home is elsewhere every custom emoji does, since readers would look for it on that home.

## Deleting several messages (`routes/messages.ts`) — auth required

`POST /api/channels/:id/messages/bulk-delete` with `{ messageIds }`, at most `MAX_BULK_DELETE_MESSAGES` (100), takes VIEW_CHANNEL and MANAGE_MESSAGES. Ids from another channel are ignored. Answers `{ deleted }`, sends one `messages_deleted`, and logs `channel_messages_delete` with the count, not the words.

## Polls (`routes/polls.ts`) — auth required

A poll is a message whose content is the question (`shared/src/polls.ts`).

| Method | Path | Rule |
|--------|------|------|
| POST | `/api/channels/:id/polls` | SEND_MESSAGES. `{ question, options, multiple?, durationHours? }`: 2 to 10 different answers, a duration from `POLL_DURATIONS_HOURS` or null. The space's rules read the answers too; a mass mention in the question takes MENTION_EVERYONE; a space's emoji in the question follows the use rule (403 `emoji_unavailable`, [emoji.md](emoji.md), "Who may use which"). |
| PUT | `/api/messages/:id/poll/votes` | VIEW_CHANNEL, READ_MESSAGE_HISTORY and ADD_REACTIONS, not while timed out. `{ optionIds }` is all of the person's answers; an empty list takes a vote back. `409 poll_ended` after the end. |
| POST | `/api/messages/:id/poll/end` | Its author, or MANAGE_MESSAGES. |
| GET | `/api/messages/:id/poll/voters?optionId=` | Whoever can read the channel: at most 100 people. |

`MessageWithUser.poll` holds the count. Only an answer to one reader has `myVotes`, because what goes to a channel is the same for everyone in it: history, search and the pins pass `readerId` to `hydrateChannelMessages`. `PATCH /api/messages/:id` and the socket's edit answer `403 poll_not_editable`.

## Forums and follows (`routes/forums.ts`, `routes/channelFollows.ts`) — auth required

See [forums.md](forums.md). `POST /api/spaces/:id/channels` takes `type`: `text`, `voice`, `announcement` or `forum`, and `PATCH /api/channels/:id` takes `type` between `text` and `announcement`.

| Method | Path | Who and what |
|--------|------|--------------|
| GET | `/api/channels/:id/posts?tag=&before=` | VIEW_CHANNEL and READ_MESSAGE_HISTORY. `ForumPostsResponse`: the tags and 30 posts by latest activity, `nextBefore` for the next page. Allowed for bots. |
| POST | `/api/channels/:id/posts` | VIEW_CHANNEL, SEND_MESSAGES and CREATE_THREADS, ATTACH_FILES for files. `CreateForumPostRequest`. 201 `ForumPost`. Allowed for bots. |
| GET | `/api/channels/:id/forum-tags` | VIEW_CHANNEL. `{ tags }`. |
| PUT | `/api/channels/:id/forum-tags` | MANAGE_CHANNELS. `{ tags: [{ id?, name, color }] }`, all of them at once. |
| PUT | `/api/threads/:id/tags` | Who started the post, or MANAGE_MESSAGES. `{ tagIds }`. |
| GET | `/api/channels/:id/follows` | VIEW_CHANNEL and MANAGE_WEBHOOKS. `ChannelFollowsResponse`: `followers` and `following`. |
| GET | `/api/channels/:id/follow-targets` | VIEW_CHANNEL. `{ spaces: FollowTargetSpace[] }`: where this person may have the channel's posts arrive. |
| POST | `/api/channels/:id/follows` | VIEW_CHANNEL here, VIEW_CHANNEL and MANAGE_WEBHOOKS at `{ targetChannelId }`. 201 `ChannelFollowInfo`. |
| DELETE | `/api/channel-follows/:id` | MANAGE_WEBHOOKS at either end. What arrived stays. |

| PUT | `/api/spaces/:id/vanity` | MANAGE_SPACE. `{ code }`, or null to give it up. `{ vanityCode }`. |
| POST | `/api/admin/spaces/:id/vanity/revoke` | Instance administrators. `{ reason }`. The name stays blocked. |

## Changing a username (`routes/users.ts`) — auth required

See [auth.md](auth.md), "Changing a username". Not for bots.

| Method | Path | Who and what |
|--------|------|--------------|
| POST | `/api/users/@me/username` | `{ username, password, twoFactorCode? }`. `{ user }`. 400 for the shape, `username_same`, `username_reserved`; 403 `current_password_incorrect`, `username_change_home_only`; 409 `username_taken`, `username_change_connected`; 429 `username_change_too_soon`. |

## Translating a message (`routes/translation.ts`) — auth required

See [translation.md](translation.md). Not for bots.

| Method | Path | Who and what |
|--------|------|--------------|
| POST | `/api/messages/:id/translate` | Who can read the message, in a channel or a conversation; 404 otherwise. `{ target }`, one of `TRANSLATION_TARGETS`. `TranslateMessageResponse`. 503 `translation_unavailable` without a provider, 502 `translation_failed`, 429 `translation_limit_reached`. |

`GET /api/instance/info` has `translation`: whether this server has a provider.

## Linked accounts (`routes/linkedAccounts.ts`) — auth required

See [linked-accounts.md](linked-accounts.md). For the person's own account, homed here (`403 linked_account_home_only` for a copy of an account homed elsewhere); not for bots. `:provider` is one of `LINKED_ACCOUNT_PROVIDERS` (`twitch`), else `404 linked_account_not_found`. Every answer but `start` is `LinkedAccountsResponse` (`{ available, accounts }`).

| Method | Path | Who and what |
|--------|------|--------------|
| GET | `/api/users/@me/linked-accounts` | What this server can link, and what the person linked. |
| POST | `/api/users/@me/linked-accounts/:provider/start` | 10 in 10 minutes. `{ url }`: the service's sign-in address, with a state bound to this account for ten minutes. `503 linked_account_unavailable` when the service is not set up. |
| POST | `/api/users/@me/linked-accounts/:provider` | 10 in 10 minutes. `{ code, state }` from the page the service returned to. `400 linked_account_expired` (state unknown, expired or used, or a code the service refused), `403 linked_account_other_account` (another account started it), `409 linked_account_taken` (linked to another account here), `502 linked_account_failed` (the service did not answer), `400 validation_failed` for the shape, `503 linked_account_unavailable`. |
| PATCH | `/api/users/@me/linked-accounts/:provider` | 60 a minute. `{ showOnProfile?, showLive? }`, booleans, at least one (`400 no_fields_to_update`). Works also after the service stopped being offered. |
| DELETE | `/api/users/@me/linked-accounts/:provider` | 30 a minute. Unlinks; works also after the service stopped being offered. |

`GET /api/instance/info` has `linkedAccounts`: the services people can link on this server (`[]` without any).

## Threads (`routes/threads.ts`) — auth required

See [threads.md](threads.md). A thread is a channel with its parent's rights, so the channel routes also serve its messages; no listing names one.

| Method | Path | Rule |
|--------|------|------|
| POST | `/api/messages/:id/thread` | VIEW_CHANNEL, READ_MESSAGE_HISTORY and CREATE_THREADS in the message's text channel, not while held back. `{ name? }`. Opens the one the message has instead of a second. |
| GET | `/api/channels/:id/threads?archived=1` | Whoever can see the channel. |
| GET | `/api/threads/:id` | The thread with its starting message. |
| PUT, DELETE | `/api/threads/:id/follow` | Whoever can see it. |
| PATCH, DELETE | `/api/threads/:id` | Who started it, or MANAGE_MESSAGES. |

## Events (`routes/events.ts`) — auth required

See [events.md](events.md) for the rules of each.

| Method | Path |
|--------|------|
| GET, POST | `/api/spaces/:id/events` |
| PATCH, DELETE | `/api/events/:id` |
| PUT, DELETE | `/api/events/:id/rsvp` |
| GET | `/api/events/:id/attendees` |

## Welcome and rules (`routes/welcome.ts`) — auth required

See [spaces.md](spaces.md), "Welcome and rules".

| Method | Path | Rule |
|--------|------|------|
| GET | `/api/spaces/:id/welcome` | Members. `SpaceWelcome`, with only the channels this reader can see. |
| PUT | `/api/spaces/:id/welcome` | MANAGE_SPACE. `{ welcomeText?, rulesText?, rulesRequired?, channelIds? }`. All of it, each time. |
| POST | `/api/spaces/:id/rules/accept` | Members. |

## Saved messages and keywords (`routes/saved.ts`, `routes/keywords.ts`) — auth required

See [saved.md](saved.md) for the rules.

| Method | Path |
|--------|------|
| GET | `/api/saved?before=`, `/api/saved/ids` |
| PUT, DELETE | `/api/saved/messages/:id`, `/api/saved/dm-messages/:id` |
| GET, PUT | `/api/users/@me/keywords` |
| GET | `/api/users/@me/keyword-matches?before=&limit=` |

## Soundboard (`routes/soundboard.ts`) — auth required

See [sounds.md](sounds.md), "Soundboard".

| Method | Path | Rule |
|--------|------|------|
| GET | `/api/spaces/:id/sounds` | Members. |
| POST | `/api/spaces/:id/sounds` | MANAGE_SOUNDS. `{ name, audio (base64), duration? }`. Counts on the creator's storage and the disk's reserve (`413 storage_limit_reached`, `507 disk_full`, uploads.md "Limits per account"). Deleting the space deletes the clips' files. |
| PATCH, DELETE | `/api/sounds/:id` | MANAGE_SOUNDS. |
| GET | `/api/sounds/:id/audio` | Members. |
| POST | `/api/channels/:id/soundboard/:soundId/play` | In the call, USE_SOUNDBOARD, not held back. |

## Watching together (`routes/watch.ts`) — auth required

See [watch-together.md](watch-together.md). Every route: the channel is a space's voice channel (`404 channel_not_found`), the caller is in its call and still holds VIEW_CHANNEL and CONNECT there (`403 watch_not_in_call`), and `memberActionRefusal` lets them act. Closed to bots. A changing answer is `{ session: WatchSession | null, serverNow }`.

| Method | Path | Rule |
|--------|------|------|
| GET | `/api/channels/:id/watch` | Where the call's session stands. |
| POST | `/api/channels/:id/watch` | STREAM. `{ url }` (`400 watch_link_unsupported`). Starts a session or adds to its queue (`409 watch_queue_full`, `details.max`, by count or by size). Everything is checked again after the title lookup. 20 a minute. |
| POST | `/api/channels/:id/watch/state` | `{ action: 'play' \| 'pause' \| 'seek' \| 'next' \| 'remove' \| 'control', positionMs?, itemId?, control? }`. `403 watch_not_controller`, `404 watch_not_found`. 60 a minute. |
| DELETE | `/api/channels/:id/watch` | The starter, anyone while everyone steers, or MOVE_MEMBERS. |
| POST | `/api/channels/:id/watch/react` | `{ reaction }`, one of `WATCH_REACTIONS`; the call is not told who. 8 in 10 seconds. |

## Status (`routes/publicStatus.ts`) — public

`GET /api/status` → `PublicStatus`: whether `chat`, `uploads`, `voice` and `mail` are `ok`, `down` or `off`, and the operator's notes. No counts, versions or addresses. Remembered for 30 seconds; 60 requests a minute. See operations.md.

## Load test (`routes/loadtest.ts`) — only with `LOADTEST_ALLOWED=1`, administrators only

`GET /api/loadtest`, `POST /api/loadtest/people` `{ count, channels?, rolesPerPerson?, messages? }`. Without the switch they are not there at all. See operations.md.

## Pages for developers

Not JSON, and no sign-in: `GET /developers`, `/developers/docs` and `/developers/docs/:slug` answer the docs ([developers.md](developers.md)), and `GET /.well-known/security.txt` (`routes/legal.ts`) where to report a vulnerability, or 404 until the operator's details are filled in.

## Bots (`routes/bots.ts`) — auth required

See [bots.md](bots.md) for the rules, and `BOT_ROUTES` in `shared/src/bots.ts`, shown to developers at `/developers/docs/rest`, for the list of routes open to a bot's token (`Authorization: Bot <token>`). **Every other route refuses one with 403 `bot_route_forbidden`.**

| Method | Path |
|--------|------|
| GET, POST | `/api/bots` |
| GET, PATCH, DELETE | `/api/bots/:id` (its owner) |
| POST | `/api/bots/:id/token` |
| GET | `/api/bots/:id/public` |
| POST | `/api/bots/:id/spaces/:spaceId` |
| GET | `/api/bots/@me` (bot) |
| PUT | `/api/bots/@me/commands` (bot) |
| POST | `/api/bots/@me/files` (bot, `routes/botFiles.ts`) |
| POST | `/api/interactions/:id/reply` (bot) |
| PUT, DELETE | `/api/messages/:id/reactions/:emoji` (`routes/messages.ts`) |
| GET | `/api/channels/:id/commands` |
| POST | `/api/channels/:id/commands/:botId/:name` |
| GET | `/api/admin/bots` |
| PUT | `/api/admin/bots/enabled` |
| DELETE | `/api/admin/bots/:id` |

## Webhooks (`routes/webhooks.ts`)

See [webhooks.md](webhooks.md). `POST /api/webhooks/:id/:token` is public: the token is the right. The others need auth and MANAGE_WEBHOOKS.

| Method | Path |
|--------|------|
| GET, POST | `/api/channels/:id/webhooks` |
| PATCH, DELETE | `/api/webhooks/:id` |
| POST | `/api/webhooks/:id/rotate` |
| POST | `/api/webhooks/:id/:token` |

## Push (`routes/push.ts`) — auth required

`GET /api/push/key` answers `{ publicKey }`. `POST /api/push/subscriptions` takes `{ endpoint, keys: { p256dh, auth }, showText?, directMessages?, locale? }`, for an account of this instance, with the address on the list of push services (`400 validation_failed`, field `endpoint`); at most 10 devices, the oldest goes. `DELETE /api/push/subscriptions` takes `{ endpoint }`, an account's own. docs/systems/push.md.

## Blocks (`routes/blocks.ts`) — auth required
```
GET    /users/@me/blocks             → { blocks: [{ user, blockedAt }] }  (newest first)
PUT    /users/@me/blocks/:userId     → { user, blockedAt }  201 new, 200 already blocked
DELETE /users/@me/blocks/:userId     → { success }          (idempotent)
```
A block closes direct contact in both directions (friend requests, new 1-on-1s, messages in a shared 1-on-1, group creation) and ends a friendship; it never removes anyone from a shared space or group, where the clients hide the blocked person's messages. The blocker gets `blocked_by_you`, the blocked person the neutral `interaction_unavailable`. `cannot_block_self` (400), `user_not_found` (404). Blocks are the home instance's and name home rows. After a change the server sends the blocker `blocks_updated` and, for a ended friendship or withdrawn requests, the ordinary friend/request events to both sides.

## Search (`routes/search.ts`) — auth required
```
GET /channels/:id/search         ?q=&from=&has=&before=&after=&offset=&limit= → { results[], totalCount }  [VIEW_CHANNEL]
GET /channels/:id/messages/around ?messageId=&limit=                           → { messages[] }
GET /dm/:id/search               ?q=&from=&has=&before=&after=&offset=&limit= → { results[], totalCount }
GET /dm/:id/messages/around      ?messageId=&limit=                           → { messages[] }
```
has: `file`|`image`|`link`

Channel search matches only messages members wrote (`userWrittenMessages()`); a poke's JSON content is not text anyone wrote. DM search still returns DM system rows.

## Explore (`routes/explore.ts`) — auth required
```
GET    /spaces/explore                   ?q=&limit=&offset=  → { spaces[], total, totalAll, discoveryEnabled }
POST   /spaces/:id/public-join                               → { space }
POST   /spaces/:id/request-join          { message? }        → { request }  [5/min; also where an invite to a request space leads]
GET    /spaces/:id/join-requests         ?status=            → { requests[] }  [MANAGE_SPACE]
PATCH  /spaces/:id/join-requests/:rid    { action }          → { request }  [MANAGE_SPACE]
GET    /users/@me/join-requests          ?status=            → { requests[] }
```
`GET /spaces/explore` lists only the spaces listed in Discovery (`LISTED_IN_DISCOVERY_SQL`, "Reviews" above: approved by an admin, public or request), and `totalAll` counts those; while `instance_settings.discoveryEnabled` is off it answers `{ spaces: [], total: 0, discoveryEnabled: false }`. Each `ExploreSpace` also carries `badges` (as on `Space`) and `category`, the category of its Discovery request (null for a value this version does not know). The two join routes check the visibility, not the listing: `public-join` admits anyone not banned who has the id of a public space, listed or not, and `request-join` takes a request for any request space.

A decision is recorded in the space's audit log (`join_request_approve`, `join_request_decline`). Every join (`public-join`, an accepted request, and the two join-by-code routes in `routes/spaces.ts`) puts back a timeout the user left the space under (spaces.md, "Moderation", "Timeouts").

## Directory (`routes/directory.ts`)
```
GET    /directory/spaces                 (public)                  → DirectoryDocument
GET    /directory                        (auth)  ?q=&limit=&offset= → DirectoryFeed
```
`GET /directory/spaces` is the document the space directory hub indexes: `{ schema: 1, origin, instance: { name, federatedRegistrationOpen, version }, spaces[] }`, at most 200 spaces that are opted in (`directoryListed`) and listed in Discovery, which takes an admin's approval as well as a public or request visibility (`LISTED_IN_DISCOVERY_SQL`, "Reviews" above), every `icon`/`banner` an absolute URL on this origin or null. Unauthenticated by design (the hub is a stranger), cached in memory for 30 s or until the next change, and served `Cache-Control: no-cache` so no intermediary holds a pre-delist copy: the in-memory cache, not a shared cache, is what answers the revalidations. It never 404s: with the directory or discovery off, `spaces` is empty and the envelope stays, so a hub fetch of a switched-off instance is a success that clears its rows.

`GET /directory` is the feed proxy the Explore page's Outer Space section reads; the browser never talks to the hub. `q` (cut to 100 chars), `limit` (1-100, default 50) and `offset` (0-1000) are clamped, not rejected, and forwarded to `{DIRECTORY_ENDPOINT}/v1/spaces`. Each distinct query is cached for 60 s (64 entries) counted from when the hub's edge copy was made (the receive time less the hub's `Age` header, absent or unparsable counting as 0, clamped to 60 s), so the proxy's answer is never older than 60 s end to end even though the hub caches for 60 s of its own; identical in-flight requests share one upstream fetch, and the route carries its own rate limit of 30 per minute, which replaces the global one for it (`429 rate_limited`, the global limiter's shape). `404 directory_disabled` when `DIRECTORY_ENDPOINT` is empty, and the same `404 directory_disabled` when the admin has turned `instance_settings.directoryBrowseEnabled` off, checked before any upstream fetch or cache read; `502 directory_unreachable` when the hub does not answer or answers something that is not a feed. Response `{ schema: 1, spaces: DirectoryEntry[] }`. See [directory.md](directory.md).

## Uploads (`routes/files.ts`, `routes/uploads.ts`)

### Tus Upload Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/files/` | JWT | Create resumable upload. Returns `Location` (upload URL) and `Upload-Expires`. |
| HEAD | `/api/files/:uploadId` | JWT (ownership) | Probe `Upload-Offset` for resume. |
| PATCH | `/api/files/:uploadId` | JWT (ownership) | Append bytes at offset. |
| DELETE | `/api/files/:uploadId` | JWT (ownership) | Abort. |

The final PATCH that completes an upload returns the `Attachment` JSON in its response body. See `docs/systems/uploads.md` for the full pipeline (PRE_CREATE / PRE_PATCH / POST_FINISH hooks, storage layout, janitor).

### File Serving
```
GET  /uploads/:filename  (public, supports Range) → file stream
```
Served `Cache-Control: public, max-age=31536000, immutable`: a stored file's name is the snowflake it was given at upload and its bytes are never rewritten, so the name identifies one immutable file for good. The sandboxing headers on the same response (`default-src 'none'` CSP, `nosniff`, `X-Frame-Options: DENY`, `Content-Disposition: attachment` for SVG and non-media) are in [uploads.md](uploads.md) and [web-security.md](web-security.md).

## Personal stickers (`routes/stickers.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/stickers` | JWT | Current user's collection, newest first: `{id, name, token}[]` |
| POST | `/api/stickers` | JWT | `{name, image}`; canonical base64 image bytes. Creates or reuses an asset and collects it |
| POST | `/api/stickers/:id/collect` | JWT | `{token, name}`; collects an existing local asset under `name` |
| PATCH | `/api/stickers/:id` | JWT | `{name}`; renames only the current user's entry, returns `{id, name, token}` |
| DELETE | `/api/stickers/:id` | JWT | Removes only the current user's entry |
| GET | `/api/stickers/assets/:id.webp` | Public | Immutable WebP; anyone holding the link can read it |

Upload, collect and rename return `{id, name, token}`. The id is the SHA-256 of the re-encoded WebP bytes; the token is `sticker:<canonical absolute asset URL>`. Names follow `normalizeStickerName` (packages/shared/src/stickers.ts): trimmed, 1 to 100 characters, one line, at least one visible character, no control or bidirectional characters. Uploads accept PNG, JPEG, WebP and GIF up to 5 MiB with a 16,777,216 decoded-pixel cap across frames, stored within 512 x 512; the JSON body limit allows for base64. Refusals: `400 sticker_name_invalid` (`details.max`, a name the rule above refuses), `400 validation_failed` (base64 that is not canonical), `400 sticker_invalid_image` (`details.max`, in MB), `409 sticker_collection_full` (`details.max`, 200 entries), `429 rate_limited` (30 uploads per account per minute, counted in the route after auth, next to the per-address limit), `400 sticker_not_local` (a collect token that is not this instance's), `404 sticker_not_found` (unknown asset, a rename of an entry the caller does not have, or a lost file on the asset route). No WebSocket event follows a collection change; the picker reads the collection each time it opens. Collection is idempotent, and removal never deletes a shared asset; unused assets are removed by the storage cleanup. Full description: [uploads.md](uploads.md#14-personal-stickers).

Since 1.34.0 an animation of more than 300 frames (`MAX_STICKER_FRAMES`, refused before anything is encoded) and a picture whose encoding takes longer than 30 seconds are `400 sticker_invalid_image` too, and an upload while the account's previous picture is still being worked on, or while 24 picture jobs wait, is `429 rate_limited` (Rate limiting above). A space's stickers (below) are entries over the same assets and send the same token, and the storage cleanup keeps an asset while a space's sticker names it.

## Custom emoji and space stickers (`routes/emojis.ts`, `routes/spaceExpressions.ts`)

See [emoji.md](emoji.md). Every route but the picture needs a person's sign-in; none is open to a bot's token.
```
GET    /emojis                                              → { emojis: CustomEmoji[] }  (the instance's library, by name)
GET    /emojis/:id.webp            (public)                 → image/webp, an emoji of the library or of a space
POST   /emojis                     { name, image }          → 201 CustomEmoji  [emoji policy `everyone`, or instance admin]
PATCH  /emojis/:id                 { name }                 → CustomEmoji  [who added it, or instance admin]
DELETE /emojis/:id                                          → { success }  [who added it, or instance admin]
GET    /emojis/available                                    → AvailableExpressionsResponse { library, spaces[] }
GET    /spaces/:id/emojis                                   → { emojis: SpaceEmoji[], max }  [member, or MANAGE_EMOJIS]
POST   /spaces/:id/emojis          { name, image }          → 201 SpaceEmoji  [MANAGE_EMOJIS]
PATCH  /space-emojis/:id           { name }                 → SpaceEmoji  [MANAGE_EMOJIS]
DELETE /space-emojis/:id                                    → { success }  [MANAGE_EMOJIS]
GET    /spaces/:id/stickers                                 → { stickers: SpaceSticker[], max }  [member, or MANAGE_EMOJIS]
POST   /spaces/:id/stickers        { name, description?, image } → 201 SpaceSticker  [MANAGE_EMOJIS]
PATCH  /space-stickers/:id         { name?, description? }  → SpaceSticker  [MANAGE_EMOJIS]
DELETE /space-stickers/:id                                  → { success }  [MANAGE_EMOJIS]
```
An emoji is the token `<:name:id>` in text and `emoji:<id>` as a reaction (`packages/shared/src/customEmoji.ts`). The library's emoji and the spaces' take their ids from one generator, so an id names one picture on its instance, and a token names an emoji of the instance the text belongs to: a space channel's host, for its messages and their reactions; in a direct message the writer's home, and for a reaction the reactor's home (emoji.md, "Which instance a token names"). `image` is the picture in canonical base64. `CustomEmoji` is `{ id, name, animated, createdBy, createdAt }`, `SpaceEmoji` the same with `spaceId`, and `SpaceSticker` `{ id, spaceId, stickerId, name, description, animated, token, createdBy, createdAt }` (`packages/shared/src/spaceExpressions.ts`); `createdBy` is null once that account is gone.

**The library.** `POST /emojis` checks `instance_settings.emoji_policy` first (`403 emoji_admins_only` unless it is `everyone` or the caller is an instance admin; admin.md), then the name (`normalizeEmojiName`: 2 to 32 of `a-z`, `0-9` and `_`, surrounding colons, space and capitals forgiven; `400 emoji_name_invalid`, `details: { min, max }`), the account's 10 uploads a minute (`429 rate_limited`), the room (`409 emoji_limit_reached`, `details.max`: 500 on the instance, 50 added by one account that is not an admin), a free name in the library (`409 emoji_name_taken`) and the base64 (`400 emoji_image_invalid`). The picture is a PNG, JPEG, WebP or GIF of at most 3 MB with at most 120 frames, written anew as a WebP within 128 pixels and 256 KB, every quality pass within one 30-second limit: `400 emoji_image_invalid` for anything that is not such a picture, `413 emoji_image_too_large` for a larger original, too many frames, a picture still too heavy at the lowest quality or one that takes too long, and `429 rate_limited` while the account's previous picture is being worked on or the picture queue is full (Rate limiting above). `PATCH` and `DELETE` take whoever added the emoji or an instance admin (`403 forbidden`), and answer `404 emoji_not_found` for an id the library does not hold; `PATCH` checks the name as `POST` does (`400 emoji_name_invalid`, `409 emoji_name_taken`). Each change is followed by `emoji_upserted` (the emoji) or `emoji_removed` (`emojiId`) to every socket on the instance (websocket.md, "Emoji and stickers"); a removed emoji's file goes with it.

**The picture.** `GET /emojis/:id.webp` is public like an upload: an `<img>` sends no token, and a message that uses a space's emoji is read outside the space too. Since 1.34.0 it serves an emoji of the library or of a space alike. The answer is the stored WebP with `Cache-Control: public, max-age=31536000, immutable` (a rename changes the name, never the picture) and an upload's sandbox (`nosniff`, a `default-src 'none'` CSP, `X-Frame-Options: DENY`); `404 emoji_not_found` for an id neither kind holds, a file name that is not `<id>.webp`, or a picture whose file is gone.

**What a person may pick.** `GET /emojis/available` answers `{ library, spaces }`: the instance's library by name, and for every space the caller is a member of on this instance, in the order they joined, `{ spaceId, emojis, stickers }`, emoji by name and stickers in the order they were added, a space with nothing yet included. It is what the pickers offer, asked of each instance where the person writes (client: `stores/emojiStore.ts`); it is not part of `ready`, as it grows with the spaces a person is in.

**A space's emoji and stickers.** The lists answer the space's members and whoever holds MANAGE_EMOJIS there (an instance admin who never joined), else `403 not_space_member`; `max` is the hosting instance's limit, 200 emoji or 60 stickers (`SPACE_EXPRESSION_LIMITS`), which a client of another version may not know. Every write takes MANAGE_EMOJIS (`403 missing_permission`, `details.permission: 'MANAGE_EMOJIS'`; the owner, instance admins and ADMINISTRATOR holders always have it, permissions.md) and nothing holding the caller's actions in the space (`member_timed_out` with `until`, `email_verification_required`, `rules_not_accepted`; `expressionManagerRefusal`, `utils/spaceExpressions.ts`). An add checks the right, the room and the name first and again with nothing awaited right before its row is inserted, so someone who lost the right while the picture was being encoded adds nothing.

- An emoji's name follows the library's rule (`400 emoji_name_invalid`) and is free in the space (`409 space_emoji_name_taken`); a library emoji or another space's may carry the same name. Its picture is checked and written as the library's (`400 emoji_image_invalid`, `413 emoji_image_too_large`).
- A sticker's name follows a personal sticker's rule (`normalizeStickerName`; `400 sticker_name_invalid`, `details.max`) and is free in the space without regard to case (`409 space_sticker_name_taken`). `description` is what a screen reader says in its place: one visible line of at most 200 characters once trimmed, empty or null for none (`400 validation_failed`, `details.field: 'description'`). Its picture is checked and written as a personal sticker's (above: at most 5 MB, 16,777,216 decoded pixels and 300 frames, a WebP within 512 pixels, at most 30 seconds of encoding; `400 sticker_invalid_image`, `details.max` in MB, here also for base64 that is not canonical) and stored as a content-addressed sticker asset, so its `token` (`sticker:<origin>/api/stickers/assets/<stickerId>.webp`) is a personal sticker's and can be collected like one.
- Room: `409 space_emoji_limit_reached` / `space_sticker_limit_reached` (`details.max`). An upload counts towards the account's 30 pictures a minute, a sticker also towards its 100 a day (`429 rate_limited`), and the picture queue applies (Rate limiting above).
- The stored size counts on the uploader's storage for as long as the space keeps the entry, held from before the file is written until the row is in (`413 storage_limit_reached`, `507 disk_full`; uploads.md, "Limits per account").
- `PATCH /space-stickers/:id` takes `name`, `description` or both (an empty body is `400 validation_failed`); a `PATCH` that changes nothing answers the entry and records and sends nothing. `404 space_emoji_not_found` / `space_sticker_not_found` for an id the kind does not hold.
- `DELETE /space-emojis/:id` deletes the picture's file; messages that used the emoji show `:name:` from then on. `DELETE /space-stickers/:id` leaves the shared asset while a message, a reaction or someone's collection names it; the storage cleanup takes it after that. Deleting the space deletes its emoji's files.

Every change is recorded in the space's audit log (`emoji_create`, `emoji_update`, `emoji_delete`, `sticker_create`, `sticker_update`, `sticker_delete`; target type `space` with the entry's id and its name as label, `changes` keyed `name` and `description`) and followed by `space_emojis_changed` or `space_stickers_changed` to the space (websocket.md, "Emoji and stickers").

**Using a space's emoji** (`utils/emojiUse.ts`; emoji.md, "Who may use which"). The library is for everyone. A space's emoji is for everyone who writes in that space's channels, and for the space's members anywhere on this instance: in other spaces' channels and in direct messages written here. Text that uses one its writer may not use is refused with `403 emoji_unavailable`; an id this instance does not know stays text, which readers see as `:name:`, as they do after an emoji was removed. An edit is asked only about emoji its previous text did not carry, since the writer may have left a space since. Checked on `POST /channels/:id/messages`, `PATCH /messages/:id`, `POST /channels/:id/posts`, `POST /interactions/:id/reply`, `POST /webhooks/:id/:token` (a webhook's account belongs to no space, so of the spaces' emoji only its own channel's space's may come) and the socket's `message_create` and `message_edit`; in direct messages, `POST /dm/:id/messages`, `PATCH /dm/messages/:id` and the socket's `dm_message_create` and `dm_message_edit`, for an account whose home is this instance. As a reaction (`PUT /messages/:id/reactions/:emoji`, the socket's `reaction_add`), `emoji:<id>` must also name an emoji this instance holds (`400 emoji_not_found`, as a reaction has no text to fall back on), and joining a reaction someone already gave is always allowed; a DM reaction is checked for an account whose home is here. Not checked: a direct message relayed from a peer, and a direct message or DM reaction written here by an account whose home is elsewhere, whose tokens name its home's emoji. A forward is never refused for them (Forwarding above).

## GIF (`routes/gif.ts`) — auth required
```
GET /gif/enabled                         → { enabled }
GET /gif/trending   ?limit=&pos=         → { results[], next }
GET /gif/search     ?q=&limit=&pos=      → { results[], next }
```
Backend: Klipy API (requires `gifApiKey` in instance_settings)

## Voice (`routes/livekit.ts`) — auth required
```
POST /livekit/token  { channelId | dmChannelId } → { token, url }
```
Permissions checked: CONNECT, SPEAK, STREAM (space channels), less a moderator's space mute or deafen (voice.md, "What LiveKit enforces"). Only a voice channel: any other channel is `404 channel_not_found`. DM calls: always full grants, in the room `fed:<federatedId>` or `dm-<id>`. A member timed out in the channel's space gets no token: `403 member_timed_out` (`details.until`), after the CONNECT check.

## Instance (`routes/instance.ts`) — public
```
GET /instance/info → { name, version, registrationOpen, federatedRegistrationOpen, instanceId, sourceCodeUrl, commit, directoryConfigured, directoryAvailable, directoryEnabled, federationEnabled, setupRequired, sourceCodeConfigured, accentColor }
```
Three directory facts, reported separately because folding any two of them leaves a client unable to tell which is false. `directoryConfigured` is `config.directory.endpoint !== ''` on its own: whether this instance has a hub to talk to at all, which is what the pinger, the proxy and Outer Space all rest on; every surface that promises the directory will do something gates on it. `directoryAvailable` is `directoryConfigured` **and** `instance_settings.directoryBrowseEnabled`: whether people here browse, the endpoint checked first so no setting can advertise a directory the instance cannot reach. The Explore page reads it here to decide whether to render the Outer Space section (directory.md §9). `directoryEnabled` is `instance_settings.directoryEnabled`: whether the admin allows spaces here to be listed. The two are independent; the space settings panel reads the latter through `GET /settings/streaming`, not from here.
`federatedRegistrationOpen` is a UX hint consumed by the Connections add-instance pre-flight (see `client-federation.md`). The 403 from `POST /auth/register` remains the security boundary.

`instanceId` (`InstanceInfoResponse.instanceId`, `string`) is this instance's persistent **epoch** — the incarnation UUID minted once by `ensureDefaults` and stable across restarts (see `database.md → Instance Settings`). It is served here (unauthenticated, credential-free) purely as a **detection** signal: `probePeerReachable` reads it to observe that a peer behind a known origin has been factory-reset (a changed epoch). It is **never** written to a peer's trusted baseline from this channel — only the authenticated `/federation/epoch`, relay envelope, and handshake do that. See `federation.md` "Instance Epoch".

`sourceCodeUrl` (`string`) and `commit` (`string | null`) implement the **AGPL-3.0 § 13 network-use source offer**: every network user (and federated peer) can obtain the Corresponding Source of the exact version this instance is running. `sourceCodeUrl` comes from `config.sourceCodeUrl` (env `BACKSPACE_SOURCE_URL`, default `https://github.com/TheZwiss/backspace`) — operators who modify Backspace MUST set it to their fork's source. `commit` comes from `config.commit` (env `BACKSPACE_COMMIT`, injected at Docker build via `deploy.sh --build-arg`; `null` in local dev). The web client surfaces `sourceCodeUrl`/`version` through one `SourceCodeLink` line, at the foot of the settings sidebar and under the server's details on the About page; nowhere else in the interface mentions the licence or a repository. The desktop app shows the same web client and adds no source item of its own. `sourceCodeConfigured` is false while `TAVVIT_SOURCE_URL` is unset; only an administrator is told so (About page).

The client shows it as one plain word in the legal links (`LegalLinks`, legal.md, "Source offer"); it does not put the version in the link, and About shows `version` and `commit` as a line of their own.

## Settings (`routes/settings.ts`)
```
GET   /settings/streaming    (auth)        → { streamingLimits }
PATCH /settings/streaming    (admin)       → { streamingLimits }
GET   /settings/instance     (admin)       → { instanceName, registrationOpen, federatedRegistrationOpen, discoveryEnabled,
                                               directoryEnabled, directoryBrowseEnabled, directoryLastPingAt,
                                               directoryLastError, directoryListedSpaceCount, accentColor, ... }
PATCH /settings/instance     (admin)       { instanceName?, registrationOpen?, federatedRegistrationOpen?,
                                             discoveryEnabled?, directoryEnabled?, directoryBrowseEnabled?,
                                             gifApiKey?, maxUploadSizeMb?,
                                             storagePerAccountGb?, spacesPerAccount?,
                                             federationRelayEnabled?, federationRelayTtlDays? } → { settings }
```
Either PATCH that changed a stored value records `settings_update` in the platform audit log, target `instance` / `settings`, with `details.fields` naming the changed settings (their names only, since some values are long lists); a save that repeats every stored value records nothing.

`registrationOpen` and `federatedRegistrationOpen` are **independent** toggles. PATCH validates `federatedRegistrationOpen` is `boolean` if provided; rejects 400 otherwise. `registrationOpen` is stored as a nullable column (null = fall back to `config.registrationOpen` env default); `federatedRegistrationOpen` is NOT NULL with default 1.

`directoryEnabled` (space directory, see [directory.md](directory.md)) must be a boolean (`400 field_not_boolean`) and needs discovery on: `directoryEnabled: true` while the resulting `discoveryEnabled` is off is `400 directory_requires_discovery`. Both PATCH routes enforce the invariant the other way round too: a write that leaves discovery off clears `directoryEnabled` in the same write, on `/settings/instance` and on `/settings/streaming` (which carries `discoveryEnabled` but not `directoryEnabled`). `directoryLastPingAt`, `directoryLastError` and `directoryListedSpaceCount` are read-only; the PATCH ignores them in the body. The count is the number of spaces that are listed in Discovery (approved, public or request to join; "Reviews" above) and have opted in to the directory, whatever `directoryEnabled` says. `InstanceStreamingLimits.directoryEnabled` is also carried on `GET /settings/streaming`, read-only there, so a non-admin's space settings can tell whether the instance allows listing. `directoryConfigured` rides with it, also read-only and also from configuration rather than the row (`config.directory.endpoint !== ''`, the same fact `GET /instance/info` reports). It is here because this is the one settings document any signed-in user may read **on any instance**: a space that lives on a peer is gated by that peer's endpoint, which the home instance's `/instance/info` cannot answer for. Neither field is accepted on either PATCH; a body carrying one is ignored, as `directoryLastPingAt` is. A change to `directoryEnabled`, `discoveryEnabled`, `instanceName` or `federatedRegistrationOpen` marks the directory dirty; repeating a stored value does not.

`directoryBrowseEnabled` is the other directory axis: whether people on this instance see spaces from other instances in Explore. It must be a boolean (`400 field_not_boolean`), is independent of `directoryEnabled` (nothing clears it, and the discovery invariant does not touch it), is carried only on `/settings/instance` and not on `/settings/streaming`, and changing it never marks the directory dirty, since it is nowhere in the served document. It gates `GET /directory` and `directoryAvailable` on `GET /instance/info`. Default true. See [directory.md](directory.md).


## Notification settings (`routes/notificationSettings.ts`) — auth required
```
GET   /users/@me/notification-settings                 → { settings: NotificationSetting[] }
PATCH /spaces/:spaceId/notification-settings     { level?, mute?, suppressEveryone?, suppressRoles? } → NotificationSetting
PATCH /channels/:channelId/notification-settings { level?, mute? } → NotificationSetting
```
The signed-in user's per-space and per-channel notification settings on **this** instance, for the spaces it hosts. Keyed by the caller's row here, so a federated member uses their account on the space's instance: the client sends these to the space's origin (`getApiForOrigin`), never to its home. What the settings do is in [sounds.md](sounds.md) ("Notification settings"); the table is `notification_settings` ([database.md](database.md)).

`NotificationSetting` is `{ spaceId, channelId: string | null, level: 'all' | 'mentions' | 'nothing' | null, muted, mutedUntil: number | null, suppressEveryone, suppressRoles, updatedAt }`. The two suppress flags (booleans, false by default, sent by servers since MENTION_EVERYONE and absent before) belong to the space setting; a channel setting always has them false. `channelId` null is the space-wide setting. `level` null is "not chosen": a channel inherits its space, a space uses `mentions`. `muted` with `mutedUntil` null lasts until lifted; a timed mute ends at `mutedUntil` (epoch ms, server clock). `updatedAt` is the server's write time and is always later than the stored one, so clients merge last-write-wins.

The PATCH body changes only the fields it carries, and needs at least one: `level` is a level or null (clear), `mute` is `'1h' | '8h' | '24h' | 'indefinite'` or null (lift), and on the space route only `suppressEveryone` and `suppressRoles` are booleans. A suppress field on the channel route, or a field of the wrong type, is `400 validation_failed` and nothing changes. The server computes `mutedUntil` from the duration with its own clock; a mute that already ended is read as none. A write that leaves nothing chosen (level null, not muted, no suppress flag) deletes the row and answers the setting with level null, not muted and both flags false. A server from before MENTION_EVERYONE refuses a body with only suppress fields (`400 validation_failed`), and the client then shows the save as failed. Every successful write is pushed as `notification_settings_updated` to all of the user's sockets on this instance ([websocket.md](websocket.md)).

GET lists only rows of spaces the caller is a member of, and channel rows of channels they can see (`VIEW_CHANNEL` or `ADMINISTRATOR`). Rows outlive leaving a space or losing a channel: they come back if the user rejoins or regains it, and go with the user, space or channel row (cascade).

Errors: `400 validation_failed` (no known field, or a value of the wrong kind), `404 space_not_found`, `404 channel_not_found`, `403 not_space_member`, `403 missing_permission` (`{ permission: 'VIEW_CHANNEL' }`) for a channel the caller cannot see.

## Admin (`routes/admin.ts`) — admin required
```
GET    /admin/storage/stats                                → StorageStats
GET    /admin/storage/orphans                              → { orphans[] }
POST   /admin/storage/cleanup        { dryRun? }           → CleanupResult
POST   /admin/storage/cleanup-media  { maxAgeDays, dryRun? } → CleanupResult
GET    /admin/users  ?q=&page=&pageSize=&showDeleted=&homeInstance=&role=&status=&joinedAfter=&joinedBefore=&sort= → AdminUserListResponse
GET    /admin/users/instances                              → distinct home instance domains
PATCH  /admin/users/:id/role         { isAdmin }           → AdminUser
POST   /admin/users/:id/reset-password                     → { temporaryPassword }
DELETE /admin/users/:id                                    → { success }
```
`status=suspended` narrows the user list to accounts suspended now (`suspendedNow`, `utils/suspension.ts`): a suspension whose end has passed does not count, and any other `status` value is ignored. Every `AdminUser` (the list, the role route, the Platform administration routes below; `toAdminUser`, `utils/adminUser.ts`) carries `suspension`, the `UserSuspension { since, until, reason }` standing now or null, and `grantedBadges`, the badges an admin gave the account.

These routes write the platform audit log ("Audit log" below): the role route records `user_role` (`details.isAdmin`) when the flag changed, reset-password `user_password_reset`, the deletion `user_delete`, and `storage/cleanup` and `storage/cleanup-media` record `storage_cleanup` (`details: { kind: 'orphans' | 'media', deletedFiles, freedBytes }`, plus `maxAgeDays` for media) unless they are dry runs; the tus sweep (`POST /admin/storage/cleanup-tus`) records nothing. Reset-password ends the account's sessions with `forceDisconnectUser(id, { reason: 'Password reset', endPresence: true })`, the deletion with `forceDisconnectUser(id)` (websocket.md, "Forced disconnects").

## Platform administration (`routes/platformAdmin.ts`) — admin required
```
GET    /admin/overview                                            → PlatformOverview
GET    /admin/users/:id                                           → AdminUserDetail
POST   /admin/users/:id/suspend      { reason, durationHours }    → AdminUser
POST   /admin/users/:id/unsuspend    { reason? }                  → AdminUser
PUT    /admin/users/:id/badges       { badges, reason? }          → AdminUser
GET    /admin/spaces   ?q=&filter=&page=&pageSize=                → AdminSpaceListResponse
GET    /admin/spaces/:id                                          → AdminSpaceDetail
PUT    /admin/spaces/:id/badges      { badges, reason? }          → AdminSpaceSummary
GET    /admin/reviews                                             → ReviewQueueResponse
POST   /admin/spaces/:id/verification/:decision  { note?, requestedAt? } → SpaceReviewState
POST   /admin/spaces/:id/discovery/:decision     { note?, requestedAt? } → SpaceReviewState
GET    /admin/audit    ?before=&limit=&targetType=&targetId=&action= → PlatformAuditResponse { entries, hasMore }
```
The instance's own administration of accounts and spaces, apart from anything a space's roles allow (admin.md, "Platform administration"). Every route sits behind `[authenticate, requireAdmin]`, which reads `users.is_admin` on this instance; a space role, owning a space or a permission bit never opens one (`403 forbidden`). Every decision is recorded in the platform audit log. Nothing here is relayed to peers: a suspension, a badge or a review is this instance's. The types are in `packages/shared/src/platform.ts`.

**Overview.** `PlatformOverview` holds counts read from the database and the open sockets, nothing estimated: `users.total` (accounts homed here, not deleted), `online` (accounts with a socket open on this instance now, from any home), `new7d` (homed here, created in the last 7 days), `active7d` (accounts that wrote a space or DM message here in the last 7 days), `suspended` (homed here, suspended now), `admins`; `activity.messages7d` (space and DM messages on this instance created in the last 7 days); `spaces.total`, `listed` (the Discovery predicate, "Reviews" above), `verified` and `discoveryEnabled` (`instance_settings.discoveryEnabled`; while it is off no approved space is shown); `reviews`, the open-request counts `review_queue_count` carries.

**Accounts.** `GET /admin/users/:id` answers `AdminUserDetail`: the `AdminUser`, the spaces it owns with their member counts, how many memberships, friendships and messages (space and DM, this instance) it has, and the 20 newest audit entries that target it; `404 user_not_found`.

`POST /admin/users/:id/suspend` suspends an account for a time or until lifted; nothing of it is deleted. It is refused, in this order, for the caller's own account (`400 cannot_suspend_self`), an unknown one (`404 user_not_found`), a deleted one (`400 user_already_deleted`) and an instance admin (`400 cannot_suspend_admin`: demote first, so admins can never lock each other out), then for the body: `reason` 3-500 characters once trimmed, without control characters other than tab and line feed (`400 suspension_reason_invalid`, `details: { min, max }`), and `durationHours` a whole number from 1 to `SUSPENSION_LIMITS.MAX_DURATION_HOURS` (8760, a year) or null for until lifted (`400 suspension_duration_invalid`, `details.max`). It writes `suspended_at` (now), `suspended_until` (now plus the hours, or null) and `suspension_reason`, replacing a suspension that stood, closes the account's sockets on this instance with `forceDisconnectUser(id, { reason: 'Account suspended', endPresence: true })`, and records `user_suspend` with the reason and `details: { until, durationHours }`. From then on sign-in, every authenticated route and the socket refuse the account with `account_suspended` (Auth above; auth.md §13). A replicated row suspended here keeps that person off this instance only.

`POST /admin/users/:id/unsuspend` lifts a suspension. One whose end has passed no longer counts but stays recorded until this route clears it. `404 user_not_found`, `409 user_not_suspended` when none is recorded, and an optional `reason` of 1-500 characters (`400 suspension_reason_invalid`). It clears the three columns and records `user_unsuspend` with the reason and `details.expired` (true when the suspension had already ended).

**Badges.** `PUT /admin/users/:id/badges` and `PUT /admin/spaces/:id/badges` set the complete list of granted badges an account or a space carries: `badges` a list of at most 32 ids, each a granted badge of that scope in the registry (`GRANTED_USER_BADGES` / `GRANTED_SPACE_BADGES`, `packages/shared/src/badges.ts`); a missing or longer list, or any other id, the derived `staff` and `verified` included, is `400 badge_invalid`. The list is stored once per id in the registry's order, NULL when empty. `reason` (1-500 characters) goes into the audit entry; one outside that is dropped, not refused. A list that differs from the stored one records `user_badges` / `space_badges` with `details: { added, removed }` and sends `user_updated` to the person and everyone who sees their profile, or `space_updated` to the space (websocket.md); repeating the stored list records and sends nothing. The account route answers `404 user_not_found` and `400 user_already_deleted`, the space route `404 space_not_found`.

**Spaces.** `GET /admin/spaces` lists every space on the instance, newest first. `q` (trimmed, at most 100 characters) matches part of the name or the exact id; `filter` is `all` (the default, also for an unknown value), `listed` (listed in Discovery), `verified`, or `open_review` (a verification `pending` or `needs_info`, or a Discovery request `pending` or `changes_requested`); `page` from 1, `pageSize` 1-100 (default 50). Each `AdminSpaceSummary` carries the owner (`PlatformActor`), member count, visibility, `directoryListed`, both review statuses, `badges` (all it shows) and `grantedBadges`. `GET /admin/spaces/:id` answers `AdminSpaceDetail`: the summary, the description and banner, the `SpaceReviewState` as the owner reads it, and the 20 newest audit entries that target the space; `404 space_not_found`.

**Reviews.** `GET /admin/reviews` answers every open request: `verification` (status `pending` or `needs_info`) and `discovery` (`pending` or `changes_requested`), each oldest request first, each item with the space's summary, its description (and banner for Discovery, what the listing would show), the status and the request.

The decision routes take, as `:decision`, one of `VERIFICATION_DECISIONS` or `DISCOVERY_DECISIONS` (`400 review_decision_invalid` otherwise, before the space is looked up):

| Process | Decision | From | To | Note |
|---------|----------|------|----|------|
| verification | `approve` | `pending`, `needs_info` | `verified` | optional |
| verification | `reject` | `pending`, `needs_info` | `rejected` | required |
| verification | `request_info` | `pending` | `needs_info` | required |
| verification | `revoke` | `verified` | `revoked` | required |
| discovery | `approve` | `pending`, `changes_requested` | `approved` | optional |
| discovery | `reject` | `pending`, `changes_requested` | `rejected` | required |
| discovery | `request_changes` | `pending` | `changes_requested` | required |
| discovery | `withdraw` | `approved`, `pending`, `changes_requested` | `withdrawn` | required |

`note` is the reason the owner reads: trimmed, at most 1000 characters (`400 review_note_too_long`, which also answers a note holding a control character other than tab and line feed), refused when required and empty (`400 review_note_required`), and `400 validation_failed` (`details.field: 'note'`) when it is not a string. A decision that does not apply to the status now, or a space without a request, answers `409 review_status_conflict` and writes nothing, and so does a `requestedAt` (optional: the `requestedAt` of the request the admin read) that no longer matches the stored request because the owner sent it again since; the check and the write are one transaction. A Discovery `approve` of a space that is no longer public or request is `409 discovery_requires_listable_visibility`, and stores what it approved (name, description, icon, banner, category) on the request. The answer is the space's `SpaceReviewState`. The step is announced as an owner's is ("Reviews" above), the history records it (a Discovery `withdraw` as `admin_withdraw`), and the audit log records `verification_<decision>` / `discovery_<decision>` with the note as reason and `details.status`.

**Audit log.** `GET /admin/audit` pages the platform audit log newest first (ids compared as numbers): at most `limit` entries (default `PLATFORM_AUDIT_PAGE_SIZE` 50, clamped to 1-100), older than the entry id `before` when given, narrowed to one `targetType` (`user`, `space` or `instance`), `targetId` (cut to 64 characters) and `action` (one of `PLATFORM_AUDIT_ACTIONS`) when given; `hasMore` says an older page exists. A `before` that is not 1-20 digits, an unknown `targetType` or an unknown `action` answers `400 validation_failed` with `details.field`. Each `PlatformAuditEntry` names its `actor` (`PlatformActor`, null when the row is gone), its target, the target's name when the entry was written (`targetLabel`), the `reason` and the `details`. The log has no retention, and writing an entry never fails the request that took the action (`recordPlatformAudit`, `utils/platformAudit.ts`, logs the failure). Besides the routes above, it records the user-management and storage routes of `routes/admin.ts` (above), every mutating route of `routes/invites.ts`, and both settings PATCHes (`settings_update`).

## Desktop downloads (`routes/desktopDownloads.ts`) — public
```
GET /desktop/release            → DesktopReleaseResponse  { release: { version, releasedAt, files: DesktopReleaseFile[] } | null }
GET /downloads/desktop/<file>   (not under /api) → the file: an installer, its .blockmap, or latest.yml
```
`release` is read per request from `latest.yml` in `<DOWNLOADS_DIR>/desktop/` and lists only the Windows installers that file names **and** the disk has, each with its real size, its SHA-512 from `latest.yml` and the same-origin `url` to download it from; null when nothing is published. `Cache-Control: no-cache`. The files are served by `@fastify/static` with Range support; `latest.yml` is `no-cache`, an installer is an attachment cached for an hour. A file that is not there is a JSON 404 (never the SPA page), because every installed desktop app fetches `latest.yml` from this address to look for updates. Publishing is copying files in; see [desktop.md](desktop.md), "Releases". Both are public: a visitor without an account is who needs the installer.

## Admin: Invite Management (`routes/invites.ts`) — admin required

All endpoints sit behind `[authenticate, requireAdmin]`. Mutating endpoints wrap their read-modify-write in a SQLite transaction with an in-txn re-fetch + status re-derive; any state mismatch returns 409. Service layer: `packages/server/src/utils/inviteService.ts` (`InviteValidationError` → 400, `InviteNotFoundError` → 404, `InviteStateConflictError` → 409).

Each mutating endpoint that succeeds records an entry in the platform audit log (Platform administration, "Audit log"), target `instance` and the invite's id: `invite_create`, `invite_update`, `invite_revoke`, `invite_reinstate` (`details.tokenRotated`) with the invite's name as label, and `invite_delete`.

```
POST   /admin/invites                       { name, maxUses, expiresAt }              → InviteLinkSummary  (201)
GET    /admin/invites              ?status=active|archived (default: active)          → { invites: InviteLinkSummary[] }
PATCH  /admin/invites/:id                   { name?, maxUses?, expiresAt? }           → InviteLinkSummary
POST   /admin/invites/:id/revoke                                                       → { invite: InviteLinkSummary }
POST   /admin/invites/:id/reinstate         { maxUses?, expiresAt? }                  → { invite: InviteLinkSummary, tokenRotated: boolean }
DELETE /admin/invites/:id                                                              → { success: true }
GET    /admin/invites/:id/redemptions                                                  → { redemptions: InviteRedemption[] }
```

**`POST /admin/invites`** — `name` 1-64 chars trimmed; `maxUses` null (unlimited) or positive integer; `expiresAt` null (never) or epoch ms strictly greater than `Date.now()`. 400 on shape violation.

**`GET /admin/invites?status=`** — `active` returns rows whose derived status is `active`; `archived` returns `expired | exhausted | revoked`. Sort `createdAt DESC`. Joins `users` to surface `createdByUsername` (`'Deleted User'` if creator's `isDeleted = 1`).

**`PATCH /admin/invites/:id`** — partial body. 400 if `maxUses` is a positive integer less than the current `usedCount` (would retroactively exhaust — admin should revoke instead). 409 if the invite is currently `revoked` (status conflict — reinstate first).

**`POST /admin/invites/:id/revoke`** — sets `revokedAt = Date.now()`. 409 if already revoked.

**`POST /admin/invites/:id/reinstate`** — branches on the row's pre-reinstate derived status:
- **Path A — was `revoked`**: rotates the token (`crypto.randomBytes(16).toString('base64url')`), clears `revokedAt`, applies any provided `maxUses`/`expiresAt` overrides. Response includes `tokenRotated: true`. 400 if the resulting row would still derive non-`active` (caller must bump enough).
- **Path B — was `expired` or `exhausted`**: token preserved. Applies overrides. Response `tokenRotated: false`. 400 same rule.
- **Path C — already `active`**: 409 "Invite is already active." Pure no-op rejection.

**`DELETE /admin/invites/:id`** — hard-delete. CASCADE removes all `invite_redemptions` rows for this invite. Allowed in any status. 404 if not found.

**`GET /admin/invites/:id/redemptions`** — sort `redeemedAt DESC`. Each row includes the registration-moment snapshot (`registrantUsername`) plus the live joined state (`currentUsername` / `isDeleted`) so the UI can render `alice (now Deleted User)` for renamed/tombstoned users.

```typescript
type InviteLinkSummary = {
  id: string;
  token: string;
  name: string;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';  // derived
  maxUses: number | null;
  usedCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdBy: string;
  createdByUsername: string | null;  // 'Deleted User' if creator tombstoned
  createdAt: number;
  lastRedeemedAt: number | null;  // epoch ms of most recent redemption; null when usedCount = 0
  url: string;  // server-built `https://<host>/register?invite=<token>` — clients MUST NOT assemble
};

type InviteRedemption = {
  id: string;
  userId: string | null;       // null only on hard-delete (defensive — tombstone keeps row)
  registrantUsername: string;  // snapshot at registration moment
  currentUsername: string | null;
  isDeleted: boolean;
  redeemedAt: number;
};
```

## Federation (`routes/federation.ts`)
```
POST   /federation/peer/initiate   (admin)     { remoteOrigin }                    → { peer, verified } (200) | { peer } (202, remote queued it) | 409 { code:'PEER_EXISTS_RESET_REQUIRED' } | 409 (handshake in progress, or awaiting remote approval)
POST   /federation/peer/accept     (public, IP rate-limited 10/min) { sourceOrigin, challenge, hmacSecret, instanceName?, instanceId?, approvalToken? } → { accepted:true, instanceName, instanceId } (200) | queued (202 + { approvalToken }) | 409 { accepted:false, code:'PEER_EXISTS_RESET_REQUIRED', instanceName, instanceId }
GET    /federation/peers           (admin)                                          → { peers[] } (no secrets; each peer carries statusReason)
GET    /federation/reset-events     (admin)                                          → FederationResetEventsResponse
POST   /federation/reset-events/acknowledge (admin)  { origin }                      → { success } (200) | 400 missing origin | 404 unknown origin
DELETE /federation/peers/:id       (admin)                                          → { success } + outbox cleanup
POST   /federation/relay           (HMAC-signed S2S)  FederationRelayRequest (+ sourceInstanceId?) → { accepted[], rejected[] }
POST   /federation/sync            (HMAC-signed S2S)  { sinceTimestamp, afterId?, limit?, dmChannelId?, federatedId?, contextType? } → { events[], hasMore, checkpoint, checkpointId? }   (keyset pagination; see federation.md "Sync Endpoint")
POST   /federation/users/lookup    (HMAC-signed S2S, rate-limited 60/min/peer)  { username }  → { found, user? }
POST   /federation/epoch           (HMAC-signed S2S, HMAC-signed response)  {}  → { instanceId }
POST   /federation/verify-attach-proof (HMAC-signed S2S, HMAC-signed response, rate-limited 60/min/peer)  { token } → { valid:true, homeUserId, username } | { valid:false }
POST   /users/@me/reattach         (JWT as detached account, rate-limited 5/15min)  { token } → { success:true, user } (ReattachResponse) | 400/401/403/404/409
```

**`POST /api/federation/peer/accept`** — public, IP-rate-limited. Optional `approvalToken` (64-hex) on the request body proves mutual admin approval; required to promote an `awaiting_approval` row to `active` when the receiver has `autoAcceptPeering=0`. The receiver returns it in the 202 body when queueing the request for admin review (`{ queued: true, message, approvalToken }`); the initiator stores it and the receiver's `/approve` later forwards it back. See `federation.md` §1 "Approval Token Verification" for the full lifecycle and threat model.

**Handshake epoch exchange.** The handshake carries the **instance epoch** bidirectionally, mirroring `instanceName`: the request body's `instanceId` is the initiator's epoch (written to `federation_peers.peer_instance_id` on every authenticated activation path), and the 200 response body's `instanceId` is the responder's epoch. Older peers omit the field; the column stays `null` until the epoch-refresh/relay backstop fills it. Both are authenticated baselines — never overwritten by the unauthenticated `/instance/info` probe. **`FederationRelayRequest.sourceInstanceId`** stamps the sender's current epoch on every relay; because the whole body is HMAC-verified, a valid relay authentically carries the sender's incarnation id and populates `peer_instance_id` when null (fast-path baseline). See `federation.md` "Instance Epoch".

**Trust re-establishment (verify-before-activate).** `/peer/initiate` no longer treats any `response.ok` as success. On remote 200 it performs a signed `fetchPeerEpoch` (`POST /federation/epoch`) round-trip to PROVE the responder adopted the negotiated secret, then either activates (`200 { peer, verified: true }`, storing the cryptographically-verified epoch as `peer_instance_id`), parks the peer in `needs_attention`/`repeer_incomplete` when `/epoch` refuses the secret (`200 { peer, verified: false }`), or keeps the row `pending` and answers `502` when `/epoch` gives no readable answer. On remote `409 PEER_EXISTS_RESET_REQUIRED` it deletes its pending row (or hands a taken-over row back, see below) and returns `409 { code: 'PEER_EXISTS_RESET_REQUIRED' }`. `/peer/accept` returns that same `409 { accepted: false, code: 'PEER_EXISTS_RESET_REQUIRED', instanceName, instanceId }` for an existing `active`/`needs_attention` row (honest refusal; the existing-row guard is unchanged and never adopts the caller's secret) instead of the old false `200 { accepted: true }`. The handshake `sourceOrigin` is `getOurOrigin()` (honors `PUBLIC_ORIGIN`), so it matches the `X-Federation-Origin` used for all S2S auth. See `federation.md` "Trust re-establishment contract".

**Existing `pending` row.** An `'auto'` pending row is taken over and an admin-created one is retried with its secret, while a remote-created one, or a handshake already in flight for the origin, answers `409` ("already in progress"). The rule is in `federation.md` "Outbound Peering Gate" (`/peer/initiate` and an existing `pending` row).

**`GET /api/federation/reset-events`** — admin-only, read-only. Backs the "Reset cleanup" admin surface (instance-epoch self-healing §6.4). Returns the durable `federation_reset_events` journal, each row augmented with the origin's current orphaned real accounts (`federationHomeOrphaned = 1`) for disposition:

```typescript
type FederationOrphanedAccount = {
  id: string;
  username: string;            // preserved original handle (detach spec); legacy rows may carry '!orphaned:{uid}@domain'
  displayName: string | null;
  avatarColor: string | null;
  ownedSpaces: { id: string; name: string }[];
  spaceMemberCount: number;    // # spaces the account is a member of
  messageCount: number;        // # space messages authored
};
type FederationResetEvent = {
  origin: string; deadEpoch: string; newEpoch: string | null;
  detectedAt: number; resolvedAt: number | null; acknowledgedAt: number | null;
  stubCount: number; orphanedAccountCount: number;
  orphanedAccounts: FederationOrphanedAccount[];
};
type FederationResetEventsResponse = { events: FederationResetEvent[] };
```

**`POST /api/federation/reset-events/acknowledge`** — admin-only, no S2S. Body `{ origin }`: `400` if missing, `404` if no journal row for that origin, else stamps `acknowledged_at = Date.now()` **only if currently null** (idempotent — a second call keeps the original timestamp) and returns `{ success: true }`. Lets the admin banner be dismissed server-side (Task 7) instead of client-only state; purely informational, detached accounts stay detached (detach spec §4.6).

Disposition actions reuse existing endpoints (no new mutating routes): one-click Re-peer = `POST /peers/:id/reset` → `POST /peer/initiate`; full-purge Remove = `DELETE /api/admin/users/:id` (owns-spaces → transfer first). **`statusReason`** (`FederationPeerStatusReason | null`, see `federation.md` "Peer state") is included on each `GET /federation/peers` peer object so the client can raise the persistent Reset-cleanup banner only for reset-detected peers, surface an "incomplete Re-peer" warning for `repeer_incomplete`, and show why a peer needs attention or was rejected. See `federation.md` "Instance Epoch" and `client-federation.md` §8.

**`POST /api/federation/users/lookup`** — HMAC-authenticated S2S endpoint. Resolves a username on this instance to its canonical `(homeUserId, profile snapshot)`. Used by the cross-instance friend-add flow on the sender's home server before queuing a `friend_request_create` event. Responds to native, non-deleted users only (there is no `discoverable` flag to consult any more). Returns `{ found: false, code: 'user_not_found' }` for stubs, tombstoned users, or unknown handles. See `federation.md` §1 "S2S User Lookup" for the full contract.

**`POST /api/users/@me/reattach`** — the owner-initiated detached-account re-attach (re-attach spec §3.2). JWT-authenticated as the detached account but registered in `routes/federation.ts` (consumes the peer HMAC channel + profile machinery). Body `{ token }` (64-hex; else 400). Re-binds the sovereign detached row to the owner's new home identity **only** when both proofs hold: the session IS the detached account AND the token verifies with the home peer over signed S2S (`POST /federation/verify-attach-proof`). Guards: non-detached/native → 403; missing/tombstoned session → 404 (already 401'd at `authenticate`); home not an active peer → 409; proof invalid → 401; new identity held by a **non-stub** local account → 409; the home handle held by another account on this instance → 409 `reattach_handle_taken`. On success: merges any pre-existing replicated stub for the new identity into the detached row (repoint+dedupe every `users.id` FK a DM/friend replica can hold, then delete the stub), sets `home_user_id`/`federation_home_orphaned=0`, names the account exactly `<handle>@<domain>` (`federation.md` "Account names"), nulls `profile_updated_at`, pulls+applies the home profile (best-effort), and broadcasts `user_updated`. The paired mint endpoint is `POST /api/auth/attach-proof` (see Auth). See `federation.md` "Peer-Side Re-Attach" and re-attach spec §3.2–3.3.

**`POST /api/federation/verify-attach-proof`** — HMAC-authenticated S2S endpoint on the home instance that redeems a one-time attach-proof token (single-use, bound to the calling peer's domain, HMAC-signed fail-closed response). See `federation.md` "S2S Detached-Account Re-Attach Proof".

**`POST /api/federation/epoch`** — HMAC-authenticated S2S endpoint returning this instance's persistent epoch (`{ instanceId }`). The **request** is HMAC-signed (only a peer holding the shared secret may call it; unknown/revoked peers → 403, bad signature → 401, missing headers → 400) **and the response body is HMAC-signed** with the same secret (`X-Federation-Signature/Timestamp/Nonce` response headers), so the caller can verify the epoch before writing it as the peer's trusted baseline (`federation_peers.peer_instance_id`). The value is already public via `/instance/info`; signing is for baseline-integrity, not confidentiality. Caller: `fetchPeerEpoch(peer)` (`utils/federationEpoch.ts`), which fails safe — 404 (not-yet-upgraded peer), bad/absent response signature, or network/timeout all return `null` (retry next tick). Populates the epoch baseline deterministically via the bounded periodic epoch-refresh. See `federation.md` "Instance Epoch" §3.2.

### Federation Peering Approval Queue

Inbound + outbound peering approval queue (`autoAcceptPeering=0`). See [federation.md → Peer Approval Queue](federation.md#peer-approval-queue) and [federation.md → Outbound Peering Gate](federation.md#outbound-peering-gate).

```
GET  /federation/approval-requests              (admin)            → { requests: ApprovalRequestSummary[] }
POST /federation/approval-requests/:id/approve  (admin)            → { success, peerStatus?, peer? }
POST /federation/approval-requests/:id/deny     (admin)            → { success }
```

**`ApprovalRequestSummary` shape:**

```typescript
type ApprovalRequestSummary = {
  id: string;
  direction: 'inbound' | 'outbound';
  origin: string;
  instanceName: string | null;
  requestedAt: number;
  expiresAt: number;
  // Outbound rows ONLY — inbound rows OMIT this field entirely (it is absent, not null and not []).
  subscribers?: ApprovalRequestSubscriberSummary[];
};

type ApprovalRequestSubscriberSummary = {
  id: string;
  userId: string;
  username: string;
  triggerReason: 'friend_add' | 'space_join' | 'direct_message';
  triggerTarget: string;
  createdAt: number;
};
```

**`POST /approval-requests/:id/approve`** — direction-branched.
- **Inbound** — existing behavior preserved verbatim (creates / upserts a local `federation_peers` row with status `pending`, sends `/peer/accept` to origin forwarding the stored `approvalToken`, deletes the queue row regardless of whether the result is `active` (200) or `awaiting_approval` (202)).
- **Outbound** — generates a fresh HMAC, sends `/peer/accept` to the origin (no token; we are the initiator).
  - On 200 → peer becomes `active`. `onPeerActivated` runs: fans out `kind='approved'` notifications to subscribers and cascade-deletes the queue row. The handler does NOT duplicate this cleanup.
  - On 202 → peer transitions to `awaiting_approval`, captures the returned `approvalToken`, and the queue row + subscribers are LEFT INTACT for the eventual remote-admin approval. `onPeerActivated` is NOT called yet.
  - On 4xx/5xx/network → the peer row is cleaned up; the queue row is LEFT INTACT so the admin can retry. Response status mirrors the wire failure (`502`/`503`/`504`).
- **Response body:** `{ success, peerStatus?: 'active' | 'awaiting_approval', peer? }` for outbound; `{ success }` for inbound.

**`POST /approval-requests/:id/deny`** — direction-branched.
- **Inbound** — existing behavior preserved (sends signed `/peer/denied` to origin, upserts a local `rejected` `federation_peers` row, deletes the queue row).
- **Outbound** — fans out `kind='denied'` notifications to all `peer_approval_subscribers` of the queue row, then cascade-deletes the parent (no remote network call). Broadcasts `federation_peers_changed` to admins so the queue UI refreshes.

### Federation Peering Subscriptions (user-facing)

```
GET    /federation/peering-subscriptions     (auth)   → { subscriptions: PeeringSubscriptionSummary[] }
DELETE /federation/peering-subscriptions/:id (auth)   → { success }
```

User-facing surface for the rows in `peer_approval_subscribers` belonging to the calling user. GET joins the parent `peer_approval_requests` row to include peer origin/instance metadata.

```typescript
type PeeringSubscriptionSummary = {
  id: string;
  requestId: string;
  peerOrigin: string;
  peerInstanceName: string | null;
  triggerReason: 'friend_add' | 'space_join' | 'direct_message';
  triggerTarget: string;
  createdAt: number;
};
```

**`DELETE /peering-subscriptions/:id`:**
- 404 if the subscriber row doesn't exist.
- 403 if the row belongs to a different user.
- On success: deletes the subscriber row; if it was the last subscriber for the parent, cascade-deletes the parent (admin's queue row disappears too). No `peer_approval_notifications` row is created (the user took the action; they know).
- Broadcasts `peering_subscription_changed` to the calling user (multi-tab refresh) and `federation_peers_changed` to admins if the parent was deleted.

### Federation Peering Notifications (user-facing)

```
GET  /federation/peering-notifications        (auth)  ?unread=1?  → { notifications: PeeringNotificationSummary[] }
POST /federation/peering-notifications/:id/read   (auth)         → { success }
POST /federation/peering-notifications/read-all   (auth)         → { success, count }
```

User-facing terminal-state notifications for peering events. GET orders DESC by `createdAt`; `?unread=1` filters to `readAt IS NULL`.

```typescript
type PeeringNotificationSummary = {
  id: string;
  kind: 'approved' | 'denied' | 'expired';
  peerOrigin: string;
  triggerReason: 'friend_add' | 'space_join' | 'direct_message';
  triggerTarget: string;
  createdAt: number;
  readAt: number | null;
};
```

**`POST /:id/read`** — sets `readAt = Date.now()` for the calling user's notification (404 / 403 on miss / mismatch).
**`POST /read-all`** — marks all of the calling user's unread notifications as read; returns `{ success, count }` where `count` is the number of rows updated.

## Utilities (`routes/utils.ts`) — auth required
```
GET /utils/metadata  ?url= → { title?, description?, image?, siteName? }
GET /health          (public) → { status: 'ok', timestamp }
```

## Security reporting (`routes/cspReport.ts`), public
```
POST /csp-report     (no auth) -> 204
```

**`POST /api/csp-report`** is the Content Security Policy violation sink named by the policy's `report-uri` and `report-to`. Unauthenticated on purpose: a violation can happen on the login screen before any token exists. It registers content-type parsers for `application/csp-report` and `application/reports+json` in addition to the built-in `application/json`. Fastify ships parsers for neither of the first two and would otherwise answer 415, leaving an empty report log that looks exactly like a clean policy. It answers `204` to everything, including a malformed body, because a browser cannot act on an error and would only retry. It reads at most 16 KB off the wire and logs at most 4096 characters per report at `warn` level with the message `CSP violation reported`. Registered after `@fastify/rate-limit` so the shared 200/minute limit applies; that ordering is load-bearing. See `docs/systems/web-security.md`.

## Legal (`routes/legal.ts`)

Full description: [legal.md](legal.md).

```
GET  /api/legal                              public  LegalInfoResponse
GET  /api/legal/documents/:kind?lang=&version=upcoming  public  LegalDocumentResponse
POST /api/legal/reports                      public (5 per 10 min per address)  CreateReportBody → 201 { id, receivedAt }
POST /api/legal/terms/accept                 auth    { version } → { termsVersion }
GET  /api/legal/notices                      auth    UserNoticeListResponse
POST /api/legal/notices/:id/read             auth
GET  /api/admin/legal                        admin   AdminLegalResponse
PUT  /api/admin/legal/operator               admin   LegalOperator
GET  /api/admin/legal/documents/:id          admin   AdminLegalDocument
GET  /api/admin/legal/templates/:kind?lang=  admin   { text }
POST /api/admin/legal/documents              admin   PublishLegalDocumentBody → 201 { id, version }
GET  /api/admin/reports?status=open|closed&before=  admin  AdminReportListResponse
POST /api/admin/reports/:id/decide           admin   DecideReportBody → AdminReport
GET  /downloads/source/<release>.tar.gz      public  the source of the running release
```

`POST /api/auth/register` takes `acceptedTermsVersion` and `ageConfirmed`: once terms are in force a local account needs both (`400 terms_not_accepted`, `400 age_not_confirmed`).

## The rest of 1.23.0

`GET /api/auth/challenge` (public, 30 a minute) answers the task for a new account: `{ level: 'off' }` or `{ level, salt, bits, signature }`. `POST /api/auth/register` takes `challenge: { salt, bits, signature, nonce }` and, as its first step, answers `400 signup_challenge_failed` without a good one. See auth.md, "Automatic sign-ups".

`GET /api/admin/signup-rules` also answers `challengeLevel`; `PUT /api/admin/signup-rules/challenge` takes `{ level }`.

`POST /api/channels/:id/messages` and `POST /api/dm/:id/messages` take `spoilerAttachments`, those of `attachments` to show as spoilers. An attachment on the wire has `spoiler`.

## Space tags (`routes/spaces.ts`, `routes/explore.ts`)
```
PATCH  /spaces/:id              { tag: { text, glyph, color } | null, ... }   MANAGE_SPACE → Space (with `tag`)
GET    /spaces/:id/tag          → { space: ExploreSpace, tag }                 signed in; 404 space_tag_unavailable without a tag
```
`400 space_tag_invalid` with `details: { min, max, reason }` (`length`, `characters`, `glyph`, `color`) and `400 space_tag_reserved` for a word reserved for the platform. A changed or removed tag reaches every wearer's profile (`user_updated`). See space-tags.md.

## Voice overlay (`routes/voiceOverlay.ts`)
```
GET    /channels/:id/overlay        → { exists, createdAt }                      VIEW_CHANNEL; the caller's own link
POST   /channels/:id/overlay        → 201 { secret, createdAt }                  VIEW_CHANNEL + CONNECT + STREAM; 503 voice_disabled; 10/min
DELETE /channels/:id/overlay        → { success: true }                          VIEW_CHANNEL
GET    /overlay/voice/:secret       → { channelName, people, livekit }           no account; no-store; 120/min; 404 voice_overlay_unavailable
```
The secret is shown once and only its hash is stored; a new link ends the old. The LiveKit token is for a hidden participant that cannot publish, subscribe or send data. See voice-overlay.md.
