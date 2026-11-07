# Authentication & Session System

Source files:
- `packages/server/src/routes/auth.ts` -- Registration, login, username availability, invite-token check endpoints
- `packages/server/src/routes/invites.ts` -- Admin invite-link CRUD (create / list / patch / revoke / reinstate / delete / redemptions)
- `packages/server/src/utils/inviteService.ts` -- Invite token generation, status derivation, atomic `redeemInvite()` transaction
- `packages/server/src/routes/users.ts` -- Password change, account deletion endpoints (lines 58-156)
- `packages/server/src/routes/admin.ts` -- Admin password reset endpoint (lines 232-265)
- `packages/server/src/utils/auth.ts` -- JWT sign/verify, `verifyAccessToken`, `authenticate` preHandler, `requireAdmin`
- `packages/server/src/utils/passwordHash.ts` -- Argon2id, reading old bcrypt hashes
- `packages/server/src/utils/sessions.ts` -- The session rows
- `packages/server/src/utils/loginThrottle.ts` -- The sign-in delay
- `packages/server/src/utils/apiErrorHandler.ts` -- What a client hears when a route throws
- `packages/server/src/utils/suspension.ts` -- `activeSuspension`, `suspendedNow`, `suspensionDetails`: the one test for a standing suspension (§13)
- `packages/server/src/routes/platformAdmin.ts` -- Suspend and unsuspend endpoints, among the platform admin routes (§13)
- `packages/server/src/utils/userDeletion.ts` -- `tombstoneUser()` transactional account erasure
- `packages/server/src/utils/sanitize.ts` -- `sanitizeUser()` strips internal fields, anonymizes deleted users
- `packages/server/src/ws/handler.ts` -- WebSocket auth handshake (lines 1282-1374)
- `packages/web/src/stores/authStore.ts` -- Client session state, login/register/logout/password/delete actions
- `packages/web/src/hooks/useAuth.ts` -- Route guard hook (redirect to `/login` when no token)
- `packages/web/src/App.tsx` -- `ProtectedRoute` and `AuthRedirect` route wrappers
- `packages/web/src/utils/identity.ts` -- Federation-aware identity helpers (`parseFederatedUsername`, `homeIdentityOf`, `userKey`, `isMine`; see `client-federation.md` section 5)
- `packages/web/src/utils/federationOps.ts` -- Account deletion propagation to connected remote instances
- `packages/web/src/stores/instanceStore.ts` -- `resolveCredentialHome()` / `issuedCredential()` / `ensureRemoteCredential()`: per-remote federation credentials (§5b)
- `packages/server/src/config.ts` -- `jwtSecret`, `jwtExpiresIn`, `registrationOpen` config

DB tables: `users`, `instanceSettings`, `userFederationCredentials`. See `database.md` for full schemas.

---

## 1. Password Hashing

**Argon2id**, through Node's own `crypto.argon2` (Node 24.7 and up, which is why `engines` asks for it), written and read as a PHC string in `users.password_hash` (`utils/passwordHash.ts`). No native package.

| | |
|---|---|
| Memory, passes, lanes | 64 MiB, 3, 1 (RFC 9106's second recommended setting). `config.passwordArgon2`; under the test suite the smallest there is |
| Salt, tag | 16 and 32 random bytes |
| Length | At least `PASSWORD_MIN_LENGTH` (8), at most `PASSWORD_MAX_LENGTH` (256). Sign-in refuses a longer one as a wrong password, without hashing it |
| What it may not be | The account's name, one character repeated, or on the short list of the first things anyone tries (`utils/passwordPolicy.ts`, `password_too_common`). No rules about digits or capitals, which do little and make passwords worse. Asked when a password is set, never at sign-in, so nobody is locked out |

**Accounts from before** keep their bcrypt hash until their next login: `verifyPassword` reads both, `passwordNeedsRehash` says when one should go, and the login route replaces it now that the password is at hand. That is not a password change: nothing is stamped and no session ends. It also applies when the settings change, since each hash carries its own. bcrypt stops at 72 bytes; Argon2id does not.

**Anything else opens nothing.** `verifyPassword` returns false for the marker `'!federation-replicated'` on a relay stub, for a deleted account's random bytes, and for a hash asking for more than 1 GiB or 16 passes, so a damaged row cannot exhaust the server.

---

## 2. Tokens and sessions

A token is a bearer JWT (HS256, `{ userId, username, sid, iat, exp }`, `JWT_SECRET`, 30 days by `JWT_EXPIRES_IN`). Cookies stay out on purpose: the multi-instance client holds a token per instance in script, the CORS posture rests on there being no ambient credential (`web-security.md`), and so CSRF does not arise. What remains is that script on the page could read a token; that limit is stated openly.

### Sessions

Each signed-in device has a row in `sessions` (`utils/sessions.ts`), named by the token's `sid`. **Deleting the row is what ending a session means.**

| What ends it | Route or path | This device's token | Sockets |
|---|---|---|---|
| Log out | `POST /auth/logout` | dead | closed at once |
| Sign a device out | `DELETE /auth/sessions/:id` | dead | closed at once |
| Sign out everywhere else | `POST /auth/sessions/end-others` | goes on | others closed at once |
| Change password | `POST /users/@me/change-password` | dead, a new session and token replace it | others closed at once; this device reconnects on the answer |
| Admin reset | `POST /admin/users/:id/reset-password` | dead | all closed (`forceDisconnectUser`) |
| `tavvit-admin reset-password` | separate process, deletes the rows | dead | closed within 30 s (`revalidateSockets`) |
| Deleting the account | `tombstoneUser` | dead | all closed |
| Time | `expires_at`; swept hourly | dead | closed within 30 s |

Each password change ends this device's session as well, because whoever copied its token is exactly who it is meant to shut out. A person's list shows only their own sessions and every query carries the user id the token proved, so nobody else's can be named.

**What a row holds:** the device's browser and system (`describeClient`, "Chrome · Windows"), the address cut short (`maskAddress`: the last part of IPv4, all but three groups of IPv6), when it started, when it was last active (written at most every 5 minutes), when it runs out. No location: that would take GeoIP or a third party. The privacy draft says so.

### One check, for REST and for the socket

`verifyAccessToken` (`utils/auth.ts`) is the only place that decides: signed by this server and in date; the account there and not deleted; the session live for this account; not suspended. `authenticate`, tus and the socket's first message all go through it, so they cannot disagree. It throws `AuthError` with a code: `unauthorized`, `account_deleted`, `session_ended`, `account_suspended`.

**A token from before sessions** has no `sid`, and since 1.31.0 it opens nothing: `verifyAccessToken` answers `session_ended`, because nothing could sign it out. Whoever still holds one signs in once more. Nothing has issued one for a long time, and those in use were traded in for one with a session while `POST /auth/upgrade-session` existed. (`sessionlessInTests` is what lets the test suite sign tokens without opening a session for each. Only `test/setup-env.ts` sets it: it is neither an environment variable nor anything a request can reach.)

### Sockets

Authentication on `/ws` is its first message: `{ type: 'auth', token, client? }`, within 10 seconds. A refusal is the same check's code, sent as `{ type: 'error', code, message, details? }`, then close 4001. The client signs out on those instead of knocking again (`useWebSocket.ts`); its backoff only starts over after `ready`, so a refused socket cannot retry at full speed. If this browser holds a newer token (a password changed in another tab), it reconnects with that one instead.

`ConnectionManager` remembers what each socket came in on (`SocketAccess`):
- `closeSessionSockets` closes those of ended sessions and no others, so a call on another device goes on.
- `revalidateSockets` runs with the 30 s heartbeat and checks every open socket again, for what happens outside the routes.

**Limit:** the server has no LiveKit room client, so a signed-out device already in a call stays in the audio until its LiveKit token runs out; its socket and its place in the room's state are gone at once.

### Sign-in delay

`utils/loginThrottle.ts` slows guessing without ever refusing the right password. The first three failures cost nothing. After that the next attempt waits before its password is looked at, doubling up to 30 s for the same name from the same address, and up to 5 s for the name from anywhere, so the worst a griefer can do to an owner is that short wait. At most 4 attempts on a name run at once; a flood past that gets `429 login_throttled`. Failures on unknown names count the same. The route's own limit is 15 per 2 minutes per address. State is in memory: a restart forgives everyone.

### Errors

`setErrorHandler` (`utils/apiErrorHandler.ts`) answers in the contract and never with an error's own message: the JSON parser's quotes the body it could not read, passwords included. 4xx is not logged at all; 5xx is logged by name, code and stack, without the message.

---

## 3. Registration Flow

With mail on (email.md), a local account may give an address, or must while the admin requires it. The confirmation link goes after the account exists; if the mail fails, the account is still there and can ask again.

**Endpoint:** `POST /api/auth/register`
**Rate limit:** 10 requests / 2 minutes per IP
**Auth:** None

### Input Validation

| Field | Rules |
|-------|-------|
| `username` | Required string. Trimmed, lowercased. |
| `password` | Required string. At least `PASSWORD_MIN_LENGTH` (8) characters, from `packages/shared/src/constants.ts`; shorter is `400 password_too_short` with `details.min`. |
| `displayName` | Optional. Trimmed or null. |
| `avatarColor` | Optional. Must be in `AVATAR_COLORS` array, else random. |
| `homeInstance` | Optional (federation only). Max 253 chars, alphanumeric + `.` `-` `_`. |
| `homeUserId` | Required with `homeInstance`. |
| `attachProof` | Required with `homeInstance`: what their home gave them for this instance. See below. |

**Password minimum, one source:** `PASSWORD_MIN_LENGTH` in `packages/shared/src/constants.ts` is the only definition. The register route (`routes/auth.ts`), the change-password route (`routes/users.ts`), the registration page (`RegisterPage.tsx`, step 1) and the Account settings panel (`AccountPanel.tsx`, check and placeholder) all import it, so the client can never accept a password at one step that the server then refuses (#397). Admin-issued temporary passwords (16 chars) and federation credential secrets are generated well above it.

### Username Validation (Two Paths)

**Local registration** (`homeInstance` absent):
- Length: 3-32 characters
- Pattern: `/^[a-z0-9_]+$/` (lowercase alphanumeric + underscore)
- No `@` allowed

**Federated/replicated registration** (`homeInstance` present):
- MUST use `username@domain` format (plain usernames reserved for native users)
- Local part: 3-32 chars, `/^[a-z0-9_]+$/`
- Domain part: 1-253 chars, `/^[a-zA-Z0-9._-]+$/`
- Total: max 100 characters

### Registration Gate

The `/api/auth/register` route splits its gate by request shape (spec §1.2). There are **two independent toggles** plus an **invite-token bypass** for the local path.

**Local anonymous signup** (no `homeInstance` in body):

1. `instanceSettings.registrationOpen` (DB, id=1) -- if not null, this takes priority
2. `config.registrationOpen` (env `REGISTRATION_OPEN`, default `true`) -- fallback

DB value overrides env when explicitly set by admin. When closed, a valid `inviteToken` bypasses the gate and is **atomically consumed** alongside the user insert (see "Invite Tokens" below). When open, an `inviteToken` field is **silently ignored** (no validation, no consumption).

**Federated identity replication** (request body has `homeInstance`):

- Gated by `instanceSettings.federatedRegistrationOpen`, and by the home vouching for the person (below).
- `inviteToken` is **ignored entirely** on this path -- tokens never unlock federated creation, even when supplied.
- Closed → 403 `"Federated registration is closed on this instance"`.

**Invariants** (spec §1.3):

- **Login-unaffected invariant.** Neither toggle gates `POST /api/auth/login` for any user. Existing federated accounts always log in regardless of `federatedRegistrationOpen`; existing local accounts always log in regardless of `registrationOpen`. Both gates affect **creation only**. This is why the Connections add-instance form keeps its submit button enabled even when the target instance has `federatedRegistrationOpen = false` (see `client-federation.md`): the request runs through `instanceStore`'s register-then-login fall-through, and the login leg succeeds for users who already have a federated account on that instance.
- The federated registration path is gated by `federatedRegistrationOpen`, never by an invite token. Tokens only unlock the local anonymous-signup path.
- **Creation-only invariant.** `/register` only ever INSERTs. It never binds the submitted credentials to a row that already exists — see "Federated Registration Never Claims an Existing Row" below.

**Toggle matrix** (spec §5.6):

| `registrationOpen` | `federatedRegistrationOpen` | Local register | Federated register | Connections UI behavior |
|---|---|---|---|---|
| true | true | open | allowed | normal |
| true | false | open | 403 | warning banner; submit enabled (login fall-through) |
| false | true | invite-required | allowed | normal |
| false | false | invite-required | 403 | warning banner; submit enabled (login fall-through) |
| false (any) | (any) | invite bypasses | NOT bypassable by token | — |

S2S DM stub creation (relay path, never `/register`) is gated only by federation peering settings — neither toggle affects it.

### Invite Tokens

When `registrationOpen` is false, the local-signup path accepts an `inviteToken` field on the register body. Token format: 22-char base64url (`crypto.randomBytes(16).toString('base64url')` — 128 bits of entropy; collision probability against the existing space is `~2^-122`, with the DB UNIQUE on `invite_links.token` as the safety net + retry-up-to-3 in the create handler). Admin CRUD lives in `inviteService.ts` and `routes/invites.ts` -- see `docs/systems/admin.md` for the panel UX and the full status state machine.

**Lifecycle:**

```
create  →  active  ──(usedCount = maxUses)─→  exhausted  ┐
              │                                          │
              │  ┌──(expiresAt < now)──→  expired  ──────┤
              │  │                                       │
              ↓  ↓                                       │
            revoke ──(revokedAt set)──→  revoked         │ reinstate
                                            │           ←┘ (Path A: token rotates;
                                            │              Path B: same token)
                                            └──→ active again
                                                   │
                                            DELETE /admin/invites/:id
                                                   │
                                                   ↓
                                                hard-delete (CASCADE redemptions)
```

Status is **derived** at read time from `(revokedAt, expiresAt, usedCount, maxUses)` — no stored column. Reinstate branches on the pre-reinstate status: revoked → token rotates (`tokenRotated: true`); expired/exhausted → token preserved (`tokenRotated: false`); already-active → 409.

**Audit trail (`invite_redemptions`):** every successful redemption inserts one row with `inviteId` (FK CASCADE — admin hard-delete drops the audit), `userId` (FK SET NULL — defensive against future hard-delete; tombstone keeps it populated), `registrantUsername` (snapshot at registration moment, preserves forensic value when the user is later renamed or tombstoned `!deleted:{uid}`), and `redeemedAt`.

Atomic redemption (spec §2.4):

```
db.transaction(() => {
  // 1. Re-fetch invite by token under txn (closes TOCTOU vs /check-invite)
  // 2. Reject if status !== 'active' → throw InviteUnavailableError → 403
  // 3. INSERT user row
  // 4. UPDATE invite_links SET usedCount = usedCount + 1
  // 5. INSERT invite_redemptions row (forensic audit, snapshots username)
})
```

If any step throws (concurrent revoke, last-slot race, username collision against the unique index), the entire transaction rolls back -- `usedCount` is never incremented on a failed registration. The route catches `InviteUnavailableError` from `redeemInvite()` and surfaces it as 403 `"Invalid or expired invite"`.

- **The federated registration path does NOT enter `redeemInvite`.** It is gated only by `federatedRegistrationOpen` and never consumes tokens, even if a token is provided in the request body. This is the structural enforcement of the spec §1.3 invariant "tokens never unlock federated creation".

The `/api/auth/check-invite` debounced UX endpoint pre-validates a token from the register page; the in-txn re-derive inside `redeemInvite()` is the authoritative enforcement point.

### Nobody becomes an administrator by registering

Not even the first, on an instance with open registration and no accounts: that would be whoever came first. `tavvit-admin create <name> --admin` on the server is the only way (docs/tavvit/FIRST-ADMIN.md), and the startup summary says so while there is no administrator. `ensureDefaults` no longer promotes anyone at a start either.

### Avatar Color Assignment

```typescript
const AVATAR_COLORS = ['mint', 'sky', 'lavender', 'coral', 'rose', 'teal', 'amber'] as const;
```

If `requestedAvatarColor` is provided and is in `AVATAR_COLORS`, use it. Otherwise, pick randomly from the array.

### Registration Steps

1. Validate inputs (username format, password length)
2. Read both registration gates from `instance_settings`
3. **Branch by request shape** (spec §1.2):
   - If `homeInstance` set → reject with 403 unless `federatedRegistrationOpen === true`. `inviteToken` ignored on this path.
   - Else (local) → if `registrationOpen` is false, require a valid `inviteToken`; otherwise reject with 403. Pre-flight token check rejects obvious-invalid tokens before bcrypt.
4. Hash password (Argon2id, section 1)
5. Check username uniqueness (exact match on lowercased username)
6. Generate Snowflake ID
7. Insert user row (status defaults to `'offline'` at the schema level; it is set to `'online'` only when the client establishes a WebSocket via the WS auth path in `ws/handler.ts`). **When the local-closed-with-token path is in play**, the insert runs inside `redeemInvite()`'s transaction so the user row, the `usedCount` bump, and the `invite_redemptions` row commit atomically (or all roll back).
8. Open a session and sign its token (section 2)
9. Return `201 { token, user }` (user sanitized via `sanitizeUser(user, true)`)

### Federated Registration Needs Its Home's Word, and Never Claims an Existing Row

`/api/auth/register` is public and unauthenticated, so `homeInstance` and `homeUserId` prove nothing by themselves. Since 1.31.0 a registration naming a home is refused with 403 `home_instance_unproven` unless the home vouches for it (`homeIdentityProven`, `utils/federationAttach.ts`):

1. The client asks its home to peer with this instance, and for a one-time proof for it (`POST /api/auth/attach-proof`, one minute, single use, only for a person native there).
2. It registers here with `attachProof`.
3. This instance looks for an **active peer** under that domain. None is a refusal with no outbound request, so that a stranger cannot make this server call an address they name.
4. It asks that peer over the signed channel (`verifyAttachProofWithPeer`), and takes the answer only if the signature holds.
5. The answer must name exactly this `homeUserId`, and this account's name must be that person's name at home under that domain.

The proof is spent by asking, so this comes after the check for a name already taken. Where the two have not finished peering, which on instances with auto-accept off takes an administrator, the registration is refused and the client falls back to its login form (client-federation.md).

Even then a registration is **never** merged into a relay-created stub (`passwordHash = '!federation-replicated'`): it only ever makes a new row, and a name already taken is the ordinary `409`. `homeUserId` is unique only *within* an instance. See `src/routes/auth.homeProof.test.ts`.

**Merging a stub into a real account is exclusively the job of `POST /api/users/@me/reattach`** (`routes/federation/handlers/attach.ts`; see `federation.md` "Peer-Side Re-Attach"). That flow requires two independent proofs — a JWT session that already *is* the account, plus a one-time attach-proof token minted by the home instance via `POST /api/auth/attach-proof` and verified with the home peer over signed S2S — and it is the only place `'!federation-replicated'` rows are ever absorbed.

**Consequence:** a person who already has a relay-created stub here and then registers federated ends up with a second row sharing that `homeUserId` until they re-attach. The stub keeps the DM history; the new row is a fresh account. Wiring fresh federated registration to the proof-gated reattach primitive for history continuity is a separate, unimplemented enhancement.

### Changing a username

`POST /api/users/@me/username` with `{ username, password, twoFactorCode? }`, in Settings under the account (`UsernameSection`). It is what someone signs in with, so it takes what changing the password takes: the password, the second factor where it is on, and 5 tries in 15 minutes. Bots may not.

- **The rules of a new name** are registration's (`usernameShapeRefusal`, `usernameReserved`), and it must be free.
- **Once in 30 days** (`USERNAME_LIMITS`, `users.username_changed_at`): 429 `username_change_too_soon`. The account sees the date (`User.usernameChangedAt`, its own view only).
- **The old name stays out of reach for 30 days** (`retired_usernames`, `usernameHeld`), for sign-up and for anyone changing theirs, so nobody can pose as who had it. Taken and held answer the same: `username_taken`. After that it is free, and the row goes with the next change.
- **Sessions go on.** A token's `username` is what it said when it was made, so `authenticate` reads the name from the row. Signing in takes the new name from then on.
- **Told:** `user_updated` to whoever can see the account, `username_changed` in the security activity and a mail to a confirmed address, with a way out if it was not them.
- **Federation:** an account homed elsewhere, or a detached one, answers 403 `username_change_home_only`, as the name is its home's. One with accounts on other instances (`replicated_instances`, `user_federation_registry`) answers 409 `username_change_connected`: those accounts sign in as `<handle>@<home>`, and the client would look for them under the new name. Copies of this person on other instances that are only replicas follow through `profile_update` ([federation.md](federation.md), "Account names").

### Username Availability Check

**Endpoint:** `GET /api/auth/check-username?username=<name>`
**Rate limit:** 30 requests / 1 minute per IP
**Auth:** None

Validates format (same rules as local registration: 3-32 chars, `/^[a-z0-9_]+$/`), checks registration gate, then queries `users` table for existence. Returns `{ available: boolean, reason?: string }`.

---

## 4. Login Flow

The name typed is a username, and on an instance that sends mail also a confirmed address (`accountNamed`). The sign-in delay counts for the account, however it was named.

**Endpoint:** `POST /api/auth/login`
**Rate limit:** 15 requests / 2 minutes per IP
**Auth:** None

### Steps

1. Validate `username` and `password` are present strings
2. Look up user by `username` (trimmed, lowercased)
3. Reject if not found (generic "Invalid username or password")
4. Reject if `isDeleted === 1` ("This account has been deleted")
5. Verify password (section 1). **`federationHomeOrphaned === 1` no longer short-circuits here.** A federated account whose home instance was reset (a new incarnation stood up on the same domain) is now treated as **detached** — a sovereign LOCAL account whose local password hash is the sole authority (detach design §4.1). Local-hash verification proceeds normally: the correct local password logs in. The flag's only login effect is to permanently disable the self-heal path (step 7). *(Historical note: this check was previously a pre-verification freeze that blocked the local-password path too; the detach re-interpretation removed it so the real owner keeps their account instead of being locked out.)*
6. *(merged into step 5)*
7. **If password invalid AND user is federated:** if `federationHomeOrphaned === 1` (detached), reject immediately with the generic "Invalid username or password" — **no outbound request to the home domain**: there is no trusted home to consult, and re-hashing on the new incarnation's say-so would hand the account to a stranger. Otherwise attempt self-healing (see below).
8. **If password invalid AND user is local:** reject
9. **If the account is suspended** (`activeSuspension`): answer `403 account_suspended` with `details: { reason, until? }` and sign no token (§13). This runs only here, after the password proved right against the local hash or through a self-heal, so a wrong password on a suspended account is rejected in steps 7-8 like any other and learns nothing of the suspension
10. Sign JWT, return `{ token, user }`. **Note:** Login does NOT mutate `users.status`. A successful login does not by itself imply a live connection (the client may never establish a WebSocket due to network failure, mobile background, error path); writing `'online'` here would produce a permanently stuck-online row that no disconnect timer cleans up. The WebSocket auth path (`ws/handler.ts`) is the single source of truth for `status = 'online'`. See `docs/systems/activity-presence.md` "Boot Reset" for the mitigation that runs on server start.

### Federation Password Self-Healing

When local verification fails for a user with `homeInstance` set:

1. Extract base username (strip `@domain` if present)
2. POST to `https://{homeInstance}/api/auth/login` with base username and provided password
3. Timeout: 10 seconds (`AbortController`)
4. **If home instance accepts (200):** check that the account the home signed in is this row's home identity: the answer's `user.id` or `user.homeUserId` equals the row's `homeUserId` (the identity a native account presents is `homeUserId ?? id`, as registration and `/users/by-home-id` read it). Otherwise, and for a row without a `homeUserId`, reject with "Invalid username or password" and leave the hash alone: a 200 only says that some account on the home has that name and password, and the name sent is the row's local part, which a pre-1.8 re-attach suffixed (`kai_1`) and which can be another person's handle there. Then run the **epoch guard** (see below). If both pass:
   - Re-hash password locally: `hashPassword(password)`
   - Update local `passwordHash` -- but **do NOT set `passwordChangedAt`** (this is a state correction, not a password change; setting it would invalidate existing valid JWTs on this instance)
   - Log the self-healing event
   - Continue with login success
5. **If home instance rejects:** return "Invalid username or password"
6. **If home instance unreachable (network error/timeout):** return "Invalid username or password" (fall back to local-only rejection)

This flow ensures that when a federated user changes their password on their home instance, they can still log in on remote instances even if the remote's hash is stale.

#### Epoch guard (instance-epoch self-healing §6.3a)

Before re-hashing, the self-heal confirms the home instance is the **same incarnation** the trusted baseline was established with. Without this, a factory-reset home accepting a *new* same-name user's password would silently hand that stranger the established account. The guard does **not** trust the login-response body (TLS-MITM-bypassable, and a reset home would just echo its new epoch); it **reuses the authenticated `fetchPeerEpoch(peer)`** (`utils/federationEpoch.ts`, HMAC-signed request *and* response) to read the home's current epoch, then compares it to `federation_peers.peerInstanceId` for that origin (three-way):

- **No peer row / `peerInstanceId` is null** (legacy/never-tracked): allow — fall through to self-heal (no regression).
- **Baseline on record AND `fetchPeerEpoch` returns a *different* epoch:** refuse self-heal → "Invalid username or password" (the hijack case).
- **Baseline on record AND `fetchPeerEpoch` returns `null`** — epoch cannot be determined (peer too old → 404, unreachable, bad/absent response signature, **or the reset peer's desynced secret rejecting our signed request**): **fail closed — refuse self-heal.**
- **Baseline on record AND the epoch matches:** allow.

Trade-off: the separate authenticated call can fail independently of the login POST, so a transient home outage during a legitimate stale-hash login fails closed. This is security-over-availability on a rare, recoverable path (fallback: a normal password change once the home is reachable); trusting an unauthenticated body would re-open the hijack. A reset peer's `null` result also doubles as a reset signal — the guard is correct even before reset-detection has flagged the peer. This epoch guard covers the **undetected-reset window** — non-detached federated accounts whose home was reset but not yet quarantined. Once the quarantine flags an account as **detached** (`federationHomeOrphaned = 1`), the self-heal path is disabled for it entirely (step 7 of the Login Flow): the detached account is no longer a remote identity that can be self-healed at all, so the epoch comparison never runs for it — the local hash is its only authority. Re-peering the new incarnation therefore cannot re-open self-heal into a detached account.

#### Re-attach: leaving the detached state (re-attach spec §3.2)

Detach is sovereign but not permanent: the legitimate owner who re-created their account on the reset home can re-bind the detached account to the new home identity via `POST /api/users/@me/reattach` (registered in `routes/federation.ts`; see `federation.md` "Peer-Side Re-Attach"). It re-binds **only** on possession of BOTH identities — the session IS the detached account (local password authority, via `authenticate`) AND a one-time proof token minted on the home via `POST /api/auth/attach-proof` verifies with the home peer over signed S2S. Identity is never username-matched (that is the tier-2 hijack). On success the endpoint merges any pre-existing replicated stub for the new identity into the detached row, sets `home_user_id = <new homeUserId>`, **clears `federation_home_orphaned` (0)**, nulls `profile_updated_at`, and applies the current home profile. Clearing the flag automatically **re-enables** normal federated-account semantics: login self-heal resumes (the epoch guard above runs again) and the S2S binding guards stop excluding the account — live profile/presence sync from the home is restored. The local password hash is kept; a detached tombstone (`is_deleted = 1`) is never re-attachable.

**Proof-mint endpoint — `POST /api/auth/attach-proof`** (`routes/auth.ts`). The home-side half of the exchange, run against the owner's re-created **native** account on the reset home. JWT-authenticated, rate-limited 5/15min. Body `{ targetDomain }` names the peer the caller intends to re-attach on. Guards: the session user must be **native** (`homeInstance` null) — a federated/replicated session cannot mint a proof for itself. Mints a random 256-bit token (`randomBytes(32).toString('hex')`), inserts a `federation_attach_proofs` row `{ homeUserId, targetDomain, createdAt, expiresAt = now + 60s, usedAt: null }`, and returns `{ token }`. The token is **single-use, 60s TTL, and bound to `targetDomain`** — only the named peer can redeem it (verified server-side against the authenticated peer domain, not the request body, at `POST /api/federation/verify-attach-proof`). Each mint opportunistically janitors expired rows (`DELETE ... WHERE expires_at < now`); since the TTL is 60s, any spent (`used_at` set) token is swept on the next mint after it expires, so the table stays bounded without a background worker.

---

## 5. Password Change

**Every route that asks for the current password** (verify, change, username, address, second factor, export, account deletion, admin actions) goes through `checkPassword` in `utils/passwordConfirm.ts` (1.32.8): a wrong answer counts as a failed sign-in of the account and waits as one does, and at most as many are checked at once as for a sign-in (`utils/loginThrottle.ts`; past that `429 login_throttled`), so a stolen session cannot test guesses side by side from many addresses. The wait can be long, and the route goes on with the account as it read it before: so once checked, the account is read again, and a password changed or reset meanwhile, a second factor turned on, the account deleted or the request's session ended answer `wrong` (counted neither way), so a request already waiting cannot undo them. The sign-in itself waits before it takes one of the name's few places, which are held only while a password is checked: guesses that are made to wait no longer keep the owner's attempt from being checked.

**A display name or custom status** with a control character or a bidirectional override (`hasUnsafeCharacters`, shared/src/profileFields.ts) is refused at sign-up and in `PATCH /api/users/@me` (`400 validation_failed`), and such characters are taken out of any stored or relayed one before it is sent (`publicUserOf`): a right-to-left override would show one name as another.

### User Password Change

**Endpoint:** `POST /api/users/@me/change-password`
**Rate limit:** 5 requests / 15 minutes
**Auth:** JWT (`authenticate` preHandler)

**Request body:** `{ currentPassword?: string, newPassword: string }`

| User type | `currentPassword` | Behavior |
|-----------|-------------------|----------|
| Local (`homeInstance` is null) | Required | Verified against the stored hash |
| Federated (`homeInstance` set, `federationHomeOrphaned !== 1`) | Not required | JWT auth is sufficient (home instance already verified the change) |
| Detached (`federationHomeOrphaned === 1`; homed here since #310, so `homeInstance` is null) | Required | Follows the **local** rule — the home is gone, so nothing external verified the change; the local hash is the sole authority (detach design §4.4) |

**Steps:**
1. Validate `newPassword` is a string of at least `PASSWORD_MIN_LENGTH` (8) characters, else `400 password_too_short` with `details.min`
2. Load user from DB
3. If local **or detached** (`!homeInstance || federationHomeOrphaned === 1`): require and verify `currentPassword`
4. Hash new password
5. Update `passwordHash` AND `passwordChangedAt = Date.now()` -- this invalidates all prior tokens
6. End every session, this one too; open a new one and return its `{ token }` (section 2)

### Admin Password Reset

**Endpoint:** `POST /api/admin/users/:id/reset-password`
**Auth:** JWT + `requireAdmin` (instance admin only)

**Guards:**
- Target user must exist
- Target must not be deleted
- Target must not be federated (`homeInstance` must be null -- "Federated users authenticate via their home instance")

**Steps:**
1. Generate temporary password: `crypto.randomBytes(12).toString('base64url')` (16 chars)
2. Hash it and update `passwordHash` + `passwordChangedAt = Date.now()`
3. `connectionManager.forceDisconnectUser(targetId, { reason: 'Password reset', endPresence: true })` -- closes all WS connections (code 4001, reason `Password reset`) and ends the account's presence, forcing re-auth; the reconnect's old token is refused as revoked (websocket.md, "Forced disconnects")
4. Record `user_password_reset` in the platform audit log (api.md, "Platform administration")
5. Return `{ temporaryPassword }` -- admin must relay this to the user out-of-band

---

## 5c. Two-factor authentication

TOTP (RFC 6238: SHA-1, six digits, 30 seconds), in `security/totp.ts` on Node's own HMAC and held to the RFCs' test vectors; `security/twoFactor.ts` around it; `routes/twoFactor.ts`. No dependency on the server. `qrcode-generator` draws the QR code in the browser (loaded only in the security tab), so the secret goes to no image service.

**The key.** `TOTP_ENCRYPTION_KEY`, 32 bytes, in `.env`. Not in the database, and not derived from `JWT_SECRET`, whose rotation must not lock anyone out. `install.sh` generates it. `update.sh` never writes `.env`, so an update does not depend on it: without it the server starts, 2FA cannot be turned on (`/instance/info` says `twoFactor: false`, and `doctor.sh` warns), and an account that has 2FA cannot sign in. **That failure is closed on purpose:** a missing or different key answers `503 two_factor_unavailable`, and never skips the step. Mistyped, the server refuses to start.

**Turning it on.** Password, then a new secret (shown once, as a QR code and as text), then a code made from it. Only that turns it on; before that a sign-in does not ask. Ten recovery codes come back with the answer, once. Other sessions end, because they got in without it. An account whose home is elsewhere does this at home: a replicated row cannot enroll.

**Signing in.**

1. `POST /auth/login` with a right password answers **`401 mfa_required`** with a `ticket`, not a token. A JWT with a user id is a login to everything here, so nothing resembling one exists until the second step. A wrong password gets the usual answer, so nothing about 2FA is said to someone without the password. A client that does not know about this sees a refusal.
2. `POST /auth/login/2fa` takes the ticket and a code. Only it reads tickets: they are random, kept as hashes, last 5 minutes, take 5 attempts and go when used or when the password changed.

The throttle's success, the suspension notice and the session all come after the second step.

**What cannot be got around.**

| | |
|---|---|
| A code twice | `last_used_step`: an accepted step, and any before it, does not count again. One step of drift either way |
| Guessing | Per account, not per ticket, and in the database: after 5 wrong codes each next one waits 1, 2, 4 minutes up to an hour, even the right one. Only someone with the password gets here, so a stranger cannot use this against the owner. The route has its own limit too |
| A recovery code twice | Spent in the same statement that finds it |
| A mailbox | Resetting a password or changing an address leaves 2FA on. **No mail ever turns it off** |
| An admin session | The admin area cannot turn it off, and neither its password reset nor `tavvit-admin reset-password` does |
| The database alone | The secret does not decrypt, also not copied onto another row. Recovery hashes are keyed |

**A lost phone.** A recovery code gets in, and can turn 2FA off or make new codes. Without one, `./tavvit-admin.sh reset-2fa <username>`, from the server's shell, after proving who is asking: it is the one way past the factor, so it ends every session, goes on the activity list, and tells the confirmed address.

**Sensitive changes** take the code as well as the password while 2FA is on (`refuseWithoutSecondFactor`, the field is `twoFactorCode`): changing the password, changing or removing the address, asking for all data, deleting the account, turning 2FA off, new recovery codes. Accounts without 2FA, replicated ones among them, are asked for nothing new, which keeps `ensureRemoteCredential` and `deleteAccountOnRemotes` working.

**Other instances.** `connectToRemote` and `loginToRemote` go through `loginWithSecondFactor` (`instanceStore.ts`): one dialog, `MfaPromptDialog`, so that none of the callers has to know. The self-heal check on a home instance gets a refusal from a home with 2FA, and fails closed.

---

## 5d. Security activity and notifications

`security/events.ts`, `security/notices.ts`, `GET /auth/security`. What the tab lists, and what is said by mail:

| Happened | On the list | Mail |
|---|---|---|
| Signed in | `login` | |
| From a device not seen before | `login_new_device` | `new_device` |
| Wrong password | `login_failed` | `suspicious_login`, after 5 within 15 minutes, at most once a day |
| Right password, wrong code | `mfa_failed` | `mfa_failures`, after 3, at most every 6 hours: someone has the password |
| Password changed, reset | `password_changed`, `password_reset` | `password_changed` |
| Address confirmed, changed, removed | `email_added`, `email_changed`, `email_removed` | email.md |
| 2FA on, off, reset by the operator | `two_factor_on`, `two_factor_off`, `two_factor_reset` | each |
| Recovery codes made, one used | `recovery_regenerated`, `recovery_used` | each |
| A device signed out, or many | `session_revoked`, `sessions_ended` | |

Mail goes to a confirmed address only. No mail or list has a password, a code, a secret or a token in it, and `twoFactor.test.ts` checks that.

**Failures** from one place within 15 minutes are one row with a count, and each account keeps 200 rows and 90 days, so that strangers failing to sign in cannot fill it. Failures on names that do not exist have no account to go on; the throttle counts those.

**Devices.** The browser keeps a random id (`utils/deviceId.ts`) and sends it when signing in; the server keeps a hash of it with the account's id. The first device on record says nothing, as with everyone after the update. A sign-in with no id counts as new, or leaving it out would hide one.

**No location.** It would take GeoIP or a third party, for something that is often wrong. The address is cut short as on a session (section 2).

Recording never gets in the way: a failure to write one (`quietly`) does not refuse a sign-in.

---

## 5a. Forgetting a password

With mail on (email.md), `POST /auth/password/forgot` answers the same for any address and does its work after answering. A link goes only to a confirmed address of a local account. `POST /auth/password/reset` takes the link and a new password: it checks the length first (a refused password does not use the link up), checks the link is live before hashing (nobody gets the hash's work for a made-up token), then in one transaction uses the link, re-checks that this address still speaks for the account, sets the hash and `password_changed_at`, ends every session and queues the confirmation. Sockets close at once. Nobody is signed in by it.

Without mail, a forgotten password is an administrator's to reset: the admin route, or `tavvit-admin reset-password`.

---

## 5b. Per-Remote Federation Credentials

**The home password is never sent to another instance.** Before 2026-09-02 the client verified the entered password locally and then reused that same plaintext password for the remote's `/auth/register` and `/auth/login`, and kept it in sync on every remote via `changePasswordOnRemotes()`. That handed a reusable, pre-hash home credential to every remote operator the user had ever connected to. Both the reuse and the propagation are gone.

**Model.** Each (account, remote instance) pair gets its own high-entropy secret with no relationship to the account password or to any other remote's secret. The secret is issued and stored by the account's **home** instance in `user_federation_credentials` (see `database.md`) and handed only to that account's own authenticated client.

**Endpoint — `POST /api/users/@me/federation-credential`** (`routes/users.ts`), JWT-authenticated, scoped to `request.userId`:

- Body `{ origin, markProvisioned?, password?, twoFactorCode? }` → `{ origin, secret?, provisioned }`.
- **The secret only for the home password** (1.32.8). It signs in to the account on the remote, so it is given out only when the request carries the account's current password, checked with `checkPassword` (held to what a sign-in is, §4), and the second factor while 2FA is on (`refuseWithoutSecondFactor`): a wrong password is `403 current_password_incorrect`, a missing code `403 mfa_code_required`. Without a password the answer is `{ origin, provisioned }` only and nothing is made, so a stolen session learns whether a rotation is due and nothing more; `markProvisioned: true` then marks a row given out before and makes none. Rate limit 60/min.
- `origin` is canonicalized to `https://host[:port]`; unparseable/non-http(s) → 400; our own origin → 400.
- Get-or-create with `onConflictDoNothing` + re-read = **first-writer-wins**. A racing second call gets the stored secret; it never replaces one, which would lock the loser out of the remote account.
- **409 for a replicated federated account** (`homeInstance` set and `federationHomeOrphaned !== 1`): credentials must be issued in exactly one place or the same remote account is handed two different secrets. Detached accounts (`federationHomeOrphaned === 1`) have no home left to ask and follow the LOCAL rule, matching §5 change-password and §6 deletion.
- `markProvisioned: true` latches `provisioned_at` (set-once; the secret is never rotated by this call).

**Client side** (`instanceStore.ts`). `resolveCredentialHome()` returns the API client of the account's **true home**, with the origin its code dialog names — the primary connection when browsing home natively, else a connected secondary instance for that domain, else `null`. `issuedCredential()` asks it for the secret with the password and, on `mfa_code_required` or `mfa_code_invalid`, asks for the code through the one dialog (`useMfaPromptStore`) and tries again. `connectToRemote()`:

1. If the target IS the account's own home, log in with the entered password as before. Nothing else applies — that password is that account's password.
2. Otherwise the entered password goes to the home instance (never the target) with the request for the secret, which checks it; a wrong one is "Incorrect password". The remote `register` / `login` is performed with **that secret**. There is deliberately no retry with the entered password.
3. On success the credential is marked provisioned.
4. If the home instance is not reachable in this session, the connect **fails with a message naming the home** rather than minting a divergent secret on the instance being browsed.

`ensureRemoteCredential(instance, { force?, password? })` is the single reconciliation point, called after every path that establishes a remote session — fresh connect, explicit `loginToRemote`, and token reconnect in `autoConnectAll`. Without `force` it first asks the home whether the account is provisioned; when a rotation is due and a password is at hand, it gets the secret with it and rotates the remote account onto it via that instance's `change-password` (which needs no `currentPassword` for a federated account — §5), then marks it provisioned. A path without the password (a token reconnect) leaves the rotation for one that has it. It refuses unless the remote account is this user's own federated identity (`homeInstance` **and** `homeUserId` both match), so a native account someone logged into on the remote is never touched.

**Migrating connections made before this existed.** Those remote accounts carry `bcrypt(home password)`. `provisioned_at = NULL` marks them; `ensureRemoteCredential` rotates each one exactly once. Since 1.32.8 the secret needs the home password, so a token reconnect only learns that the rotation is due, and it happens at the next path that has the password: the explicit per-instance login, where an account made before the secrets takes the home password, passes what was typed. Any other password the home refuses (counted as a wrong one), and the remote keeps the password typed. Two consequences worth knowing:

- The rotation sets `passwordChangedAt` on the remote, which revokes that account's other sessions there. Those devices re-authenticate through the normal prompt — and their entered password only ever reaches the home instance.
- If the token has already expired, the connect surfaces `RemoteLoginRequiredError` and the per-instance login form. What the user types there goes to that instance by their explicit choice; `ensureRemoteCredential(..., { force: true })` then switches the account onto the issued secret.

**Residual exposure this does not undo.** Every instance a user federated with before this change still holds `bcrypt(home password)` for their account, and `/api/auth/login`'s federated self-heal path (§4) still forwards a submitted password to the home instance, so a remote operator who captured the old hash — or who is typed into directly — retains a credential that is meaningful on the home. Migrating the schema does not scrub other operators' databases. **A user who connected to an instance they do not trust should change their home password**; after the change no remote is given the new one.

**Changing the home password no longer touches remotes.** `authStore.changePassword()` calls the home endpoint and updates the local token, and stops there. The remote-propagation machinery (`changePasswordOnRemotes`, `scheduleBackgroundRetry`, `clearPasswordSyncTimers`, the `pendingPasswordSync` / `pendingSyncOrigins` flags and their AccountPanel indicator) is removed: with per-remote secrets there is nothing to propagate.

---

## 6. Account Deletion

### Self-Deletion

**Endpoint:** `DELETE /api/users/@me`
**Rate limit:** 3 requests / 15 minutes
**Auth:** JWT (`authenticate` preHandler)

**Request body:** `{ password: string, username: string }`

**Pre-checks:**
1. `username` must match stored username (confirmation safeguard)
2. Native local users **and detached accounts** (`federation_home_orphaned = 1`) must provide and verify `password` against the local hash; non-detached federated users rely on JWT auth (their home instance already vouches for them). A detached account is a sovereign local account with no home verifying anything, so it follows the LOCAL rule — the same self-destruct protection as a native account, and mirroring the change-password rule (§5, detach spec §4.4). Condition: `!user.homeInstance || user.federationHomeOrphaned === 1`. Missing password → 400; wrong password → 403.
3. Must not own any spaces (returns 400 with `ownedSpaces` list)

**Client-side flow** (`authStore.deleteAccount()`):
1. Call `deleteAccountOnRemotes()` first (best-effort, see below)
2. Call `api.users.deleteAccount()` on home instance
3. Clear localStorage token, reset all user-scoped stores

### Federation Account Deletion

`deleteAccountOnRemotes()` runs before home deletion:
- For each connected remote instance, calls `inst.api.users.deleteAccount({ password: '', username: inst.username })`
- Password is empty string (not needed for federated users on remotes)
- Best-effort: failures are caught and returned as `FederationOpResult[]` but do not block home deletion

### Tombstoning (`tombstoneUser()`)

All cleanup runs in a single SQLite transaction:

**Relationship cleanup (deletes):**
- `spaceMembers` -- removes from all spaces
- `memberRoles` -- removes all role assignments
- `friends` -- removes all friendships (both directions)
- `friendRequests` -- removes all friend requests (both directions)
- `dmMembers` -- **partitioned**: the row is KEPT for 1-on-1 DMs (`dm_channels.ownerId IS NULL`) so the thread survives as a readable anonymized "Deleted User" thread; it is deleted only for group DMs (`ownerId IS NOT NULL`). The in-function `userDmChannelIds` local captures the user's DM channel ids before partitioning.
- `readStates` -- removes all read state records
- `reactions` -- removes all message reactions
- `dmReactions` -- removes all DM reactions
- `spaceFolders` -- removes all space folders
- `bans` -- removes bans where user is target (try/catch for table existence)
- `joinRequests` -- removes join requests (try/catch)
- `voiceRestrictions` -- removes voice restrictions (try/catch)

**Moderator reference cleanup (nullifies):**
- `bans.bannedBy` -- nullified where points to deleted user
- `voiceRestrictions.moderatorId` -- nullified
- `joinRequests.decidedBy` -- nullified

**Channel override cleanup:**
- Deletes `channelOverrides` where `targetType = 'member'` and `targetId = uid`

**Group DM ownership transfer:**
- For each group DM owned by the user, transfers to next remaining member
- If no remaining members, DM becomes orphaned

**Orphaned DM cleanup:**
- Among the user's DM channels, finds those with **zero live members** — `users.isDeleted = 0`, excluding the uid being tombstoned right now (it still reads `isDeleted = 0` at scan time). A Deleted ↔ Survivor 1-on-1 is kept; a Deleted ↔ Deleted 1-on-1 is purged.
- For each: collects attachment filenames, deletes attachments, reactions, messages, and the channel

> **DM tombstone semantics** (1-on-1 survives as a read-only "Deleted User" thread, group DMs drop the member, `isDeadOneOnOne` read-only guard, dead-DM purge rule, one-time backfill, heal-path `user_updated` broadcast): see `docs/systems/dm-system.md` § "DM Tombstone Semantics".

**User row anonymization:**
```
username:    '!deleted:{uid}'     -- frees original username for reuse
passwordHash: crypto.randomBytes(32).toString('hex')  -- random, unverifiable
displayName:  null
avatar:       null
banner:       null
bio:          null
customStatus: null
accentColor:  null
avatarColor:  null
replicatedInstances: '[]'
isDeleted:    1
status:       'offline'
isAdmin:      0
```

**Return value:** Array of filenames to delete from disk (avatar, banner, orphaned DM attachments). Caller handles disk cleanup.

**Post-transaction (in route handler):**
- Delete files from disk via `deleteUploadFile()`
- `connectionManager.forceDisconnectUser()` -- closes all WS connections (code 4001, reason `Account deleted`) and leaves voice rooms. Called without `endPresence`, it sends no presence of its own: the anonymized `user_updated` broadcast just before it (`status: 'offline'`) is what the others receive (websocket.md, "Forced disconnects")

### `tombstoneUser()` Options

`tombstoneUser` accepts an optional second argument:

```typescript
interface TombstoneOptions { purgeContent?: boolean }
function tombstoneUser(uid: string, options?: TombstoneOptions): string[]
```

- **`purgeContent: true`** (default / omitted): full tombstone — removes the user from spaces, friends, group DM membership, and read-states; then also deletes `reactions`, `dmReactions`, and the user's space `messages` with their attachments and embeds. 1-on-1 DM membership is kept (see below).
- **`purgeContent: false`**: soft tombstone — removes the user from spaces, friends, group DM membership, and read-states. The `purgeContent: false` flag skips only `reactions`, `dm_reactions`, and the user's space `messages` (with attachments + embeds). The DM membership partition and orphaned-DM purge always run in both modes: group-DM `dm_members` rows are deleted, 1-on-1 `dm_members` rows are KEPT (so the thread survives as an anonymized "Deleted User" thread), and any resulting zero-member DM channel is purged as unreachable garbage. Used by the federation identity soft-delete endpoint so remote message history is retained.

### `resolveOrCreateReplicatedUser` and Deleted Users

`resolveOrCreateReplicatedUser` checks whether a user matching `homeUserId + homeInstance` already exists and has `isDeleted = 1`. If so, it returns `null` rather than returning or re-creating the deleted stub. This prevents zombie identities from reappearing after a federation identity deletion.

### Federation Identity Deletion (Home-Side Trigger)

**Endpoint:** `POST /api/users/@me/federation-identity/delete`
**Rate limit:** 5 requests / 15 minutes
**Auth:** JWT (`authenticate` preHandler)

**Request body:** `{ origins: string[], mode: 'soft' | 'full' }`

Fans out HMAC-signed `DELETE /api/federation/identity` requests to each listed remote in parallel. Returns a per-origin results map:

```json
{ "results": { "<origin>": { "success": true } } }
```

On failure for a given origin the entry contains `{ "success": false, "error": "<message>", "ownedSpaces"?: [...] }`. A `409` from a remote means the user owns spaces there that must be resolved before deletion can proceed.

### `sanitizeUser()` for Deleted Users

When `isDeleted === 1`, returns an anonymized profile:
- `username: 'Deleted User'`
- All profile fields null/empty/false
- `status: 'offline'`
- Only `id` and `createdAt` preserved

---

## 7. Client-Side Session Lifecycle

### State (`authStore`)

```typescript
interface AuthState {
  token: string | null;        // Persisted in localStorage as 'backspace_token'
  user: User | null;           // Current user object
  isLoading: boolean;
  error: string | null;
}
```

**Initialization:** `token` is read from `localStorage.getItem('backspace_token')` on store creation.

### `initSession(token, user)`

Called after successful login or registration:
1. `resetUserStores()` -- clears every user-scoped store (see below)
2. Saves token to localStorage
3. Sets token + user in Zustand state, empties `myRowIds` (the user's row id per connected instance, client-federation.md §5) and starts `trueHomeStatus` from the kept true-home report (`seedTrueHomeStatus`, activity-presence.md)
4. Fires `useInstanceStore.autoConnectAll()` (fire-and-forget) for federation

### `loadUser()`

Called by `useAuth()` hook when token exists but user object is null:
1. Calls `api.users.me()` to fetch current user
2. On success: sets user, triggers `autoConnectAll()`
3. On failure: removes token from localStorage, clears state (forces redirect to login)

Step 3 does **not** call `resetUserStores()`. It runs at boot, on a stored
token the server rejects, when the stores are still at their initial values,
so there is nothing to clear; it is the one session-ending path that does not
go through the fan-out, and it would need the call if it ever ran mid-session.

### `logout()`

1. Removes token from localStorage
2. Calls `resetUserStores()` (see below) and cancels the expiry of a kept true-home status
3. Sets token and user to null and empties `trueHomeStatus` and `myRowIds`

### `resetUserStores()`

The one place a session's client state is dropped. Called by `initSession`
(so signing in as another account without a reload cannot inherit the
previous one's rows), by `logout`, and by `deleteAccount`. It clears, in
order: chat messages, the space, social, voice, instance, activity, explore
and directory stores, and the settings store's update state. The signed-in
user's own records (`myRowIds`, `trueHomeStatus`) live on `authStore`
itself; each caller resets them in the same `set` that replaces the user.

`exploreStore` and `directoryStore` were added to it on the space directory
branch. `exploreStore.myRequests` holds the signed-in user's own pending
join requests and a space card reads "Request Pending" off them, so leaving
it behind showed one account's requests under another account's session
until the next fan-out replaced them; `directoryStore` holds a feed fetched
through the home proxy as the signed-in user. Both stores' `reset()` also
bump the sequence counters that guard their fan-outs
([spaces.md](spaces.md#multi-instance-discovery-explorestorets)), so the call
is what stops a reply for the old session landing in the new one.

Two paths end a session without going through this function, and both are
safe because they replace the whole JS context: `handleUnauthorized` in
`api/client.ts`, which drops the token on a 401 from the home instance (a
suspension's `401 account_suspended` included) and navigates to `/login`
with `window.location.href`, and which `useWebSocket` also calls when the
home socket is refused with `account_suspended` (§13); and the post-deletion redirect in
`DeleteAccountModal`, which does the same three seconds after the flow
completes (`authStore.deleteAccount` has already reset by then).

### Route Guards

**`ProtectedRoute`** (in `App.tsx`):
- Reads `token` from authStore
- If no token: `<Navigate to="/login" replace />`
- Used for `/channels/:spaceId/:channelId?` and `/explore`

**`AuthRedirect`** (in `App.tsx`):
- Reads `token` from authStore
- If token present: redirects to `?redirect` param or `/channels/@me`
- Used for `/login` and `/register` routes
- Prevents authenticated users from seeing auth pages

**`useAuth()` hook:**
- Watches `token`, `user`, `isLoading`
- If no token: navigates to `/login`
- If token but no user and not loading: calls `loadUser()`
- Returns `{ user, isLoading, isAuthenticated }`

### Login Page

- Fields: username, password
- Redirect support: reads `?redirect` param, navigates there on success (validated: must start with `/`, not `//`)
- Rate limit handling: catches `RateLimitError`, shows countdown timer
- Suspension: an `HttpError` with code `account_suspended` (only ever answered to the right password, §13) shows a notice instead of the error line: "until lifted", or the end as a date and time in the user's language, and the reason when there is one
- Links to register page (preserves redirect param)

### Registration Page (Two-Step)

**Step 1 -- Credentials:**
- Fields: username, password, confirm password
- Client-side validation: 3-32 chars, `/^[a-z0-9_]+$/`, passwords match, at least `PASSWORD_MIN_LENGTH` chars
- Debounced username availability check (500ms delay, abort on new input)
- Continue button disabled if username taken or invalid

**Step 2 -- Personalization:**
- Fields: display name (optional), avatar color picker, avatar upload (with crop modal)
- "Get Started" button: registers with personalization
- "Skip for now" button: registers without personalization
- Registration flow:
  1. Call `api.auth.register()` -- saves token to localStorage but NOT to Zustand (prevents premature `AuthRedirect`)
  2. If avatar file selected: upload file, then `api.users.update({ avatar })` (failure is non-fatal)
  3. `initSession(token, finalUser)` -- activates Zustand state, triggers redirect
  4. Navigate to redirect param or `/channels/@me`

  **Auth-token source of truth.** During the step-2 avatar upload, the JWT lives in `localStorage` only -- `authStore.token` (Zustand) is still null because step 3 hasn't fired. Both the home `api` client (`api/client.ts`) and the home-origin branch of `setTokenForOriginResolver` in `instanceStore.ts` therefore read the home JWT from `localStorage.getItem('backspace_token')`, never from `authStore.token`. This keeps `transferStore.startUpload` (and any other path that resolves a home-origin bearer) authenticated during the registration window. The two stores are written together everywhere else (`initSession`/`logout`), so the divergence only matters between steps 1 and 3 here.

**Responsive contract.** Auth pages render outside `MobileShell` (they are pre-layout). The `RegisterPage` outer wrapper is a self-contained scroll container -- `h-full overflow-y-auto` on the outermost `<div>` because `#root` is `h-full overflow-hidden` (see `globals.css`). An inner `min-h-full flex items-center justify-center` wrapper centers the card vertically when content fits, and falls back to top-aligned scroll when content exceeds the viewport (as on iOS Safari with the keyboard up, where the visible viewport shrinks by ~300 px). Card width is `max-w-[480px]` with `px-4` outer gutters, `p-6 md:p-8` inner padding (smaller on mobile to reclaim 16 px content area at 360 px viewports). All `<input>` elements override the shared `input-standard` class's `text-sm` with `text-base md:text-sm` -- iOS Safari auto-zooms when an input has font-size <16 px. Primary submit buttons use `py-3 md:py-2.5` to satisfy Apple HIG's ≥44 px tap-target rule on mobile. The closed-registration URL-token chip switches from `inline-flex` (desktop pill) to `flex` (mobile full-width banner) so longer error copy ("Invalid invite link -- please request a new one") wraps cleanly inside a 360 px viewport instead of forcing a single-line pill that overflows. The avatar color swatch row uses `gap-2 md:gap-2.5` so the 7 swatches fit within the 360 px content area. **Note:** `LoginPage` does NOT yet apply the same scroll/iOS-zoom/tap-target treatment; this is a known follow-up since LoginPage's shorter form is less likely to clip. Update both together if revisiting.

---

## 8. Federation-Aware Identity Utilities

### `parseFederatedUsername(username)`

Splits a potentially federated username:
```
"erin@nova.ddns.net" -> { baseName: "erin", domain: "nova.ddns.net" }
"erin"                -> { baseName: "erin", domain: null }
```

### Who a user is, and whether it is the signed-in user

`homeIdentityOf` / `userKey` (the person a row names, given the instance that issued it), `authStore.myRowIds` with `getMyUserIdForOrigin`, and `isMine` / `isMe` (the signed-in user) are described once, in `client-federation.md` section 5.

---

## 9. Rate Limits Summary

| Endpoint | Max | Window |
|----------|-----|--------|
| `POST /api/auth/register` | 10 | 2 min |
| `GET /api/auth/check-username` | 30 | 1 min |
| `GET /api/auth/check-invite` | 30 | 1 min |
| `POST /api/auth/login` | 15 | 2 min |
| `POST /api/users/@me/change-password` | 5 | 15 min |
| `DELETE /api/users/@me` | 3 | 15 min |

All keyed by `request.ip`.

---

## 10. Configuration Reference

| Config key | Env var | Default | Notes |
|------------|---------|---------|-------|
| `jwtSecret` | `JWT_SECRET` | (required) | Min 32 chars, startup crash if shorter |
| `jwtExpiresIn` | `JWT_EXPIRES_IN` | `'30d'` | Passed to `jsonwebtoken` `expiresIn` option |
| `registrationOpen` | `REGISTRATION_OPEN` | `true` | Overridden by `instanceSettings.registrationOpen` in DB (null DB row = env fallback). Local anonymous signup gate. |
| (no env) | -- | `true` | `instanceSettings.federatedRegistrationOpen` is DB-only (NOT NULL DEFAULT 1) — no env override. Federated identity replication gate. |

---

## 11. `requireAdmin` Guard

`auth.ts:requireAdmin()` -- used as preHandler alongside `authenticate`:
1. Loads full user from DB by `request.userId`
2. Rejects with `403 forbidden` if user not found or `isAdmin !== 1`
3. Used by admin routes (user management, password reset, federation peer management, invites, instance settings) and by every platform admin route in `routes/platformAdmin.ts` (overview, suspensions, badges, spaces, reviews, audit log)

`users.is_admin` on this instance is the only thing that passes it. A space role, owning a space or a permission bit never does: platform matters, suspensions among them (§13), are an instance admin's alone.


## 12. Profile fields

Besides the name, pictures, colours and bio, a profile has three fields of its own, set with `PATCH /api/users/@me` (api.md, "Profile card fields") and shown on the profile card and the full profile:

- **Pronouns** (`users.pronouns`): up to 40 characters, shown after the username.
- **Links** (`users.profile_links`, JSON): up to 5, each a plain `http`/`https` address (no user name or password in it, at most 200 characters) with an optional label of up to 32 characters; the card shows the label or the address's host.
- **Layout** (`users.profile_layout`): `standard` (the banner across the top, the picture over its edge), `centered` (picture and name centred under the banner) or `compact` (no banner area; picture and name side by side). `profileHeaderLook` (web/src/utils/profileLayout.ts) holds what each layout means for the card, the full profile and the editor's preview.

The rules live in packages/shared/src/profileFields.ts and are applied three times: by the instance that stores them, by the editor before it saves (Settings, My Account, with a live preview and save or discard), and by every profile surface before it shows them. That last check matters for profiles from other instances, which carry whatever their instance sent: a link that is not a plain web address is not shown as a link, and pronouns or labels with control or bidirectional characters are not shown. Links open in a new tab with `rel="noopener noreferrer nofollow"`.

Only the account itself writes these fields (`PATCH /users/@me` acts on the caller's own row). Like `accentColorSecondary` they are not relayed to federation peers: another instance shows them for its own users only. Deleting the account (`tombstoneUser`) clears all of them, the second accent colour included, and hands the pictures of the person's space profiles to the caller for deletion with the rest.

A Twitch address among the links is only a link. An account elsewhere shows as the person's own only when they linked it by signing in there: **linked accounts** (`users.profile_linked_accounts`, written from `linked_accounts`; linked-accounts.md), shown first under the same "Links" heading, marked as linked. Deleting the account deletes them too, and they are in the personal export.


## 13. Suspensions

An instance admin can suspend an account on this instance, for a time or until lifted, with a reason the account's owner reads (`POST /api/admin/users/:id/suspend` and `/unsuspend` in `routes/platformAdmin.ts`; api.md, "Platform administration"). Nothing of the account is deleted: its spaces, messages, friends and DMs stay as they are, and only its access stops. Deciding is the instance admin's alone (§11): no space role or ownership can suspend anyone. An admin cannot suspend their own account or another admin (`cannot_suspend_self`, `cannot_suspend_admin`: the role is removed first), so an admin team cannot lock itself out. Nothing is relayed to peers: suspending a replicated row keeps that person off this instance only, and their home instance does not know.

### State

Three columns on `users` (database.md): `suspended_at`, `suspended_until` (NULL until lifted) and `suspension_reason`. `activeSuspension(row, now)` in `utils/suspension.ts` is the one test: an account is suspended while `suspended_at` is set and `suspended_until` is NULL or later than now. A time-limited suspension therefore ends by itself, and nothing runs when it does: every check compares the end with the clock. The columns stay set until an admin lifts the suspension (`/unsuspend` clears all three, and records whether it had already ended); meanwhile an ended suspension reads as none everywhere. `suspendedNow(now)` is the same condition in SQL, used by the admin user list's `status=suspended` and by people search (`GET /api/social/search`), which leaves suspended accounts out. `suspensionDetails` builds what a refusal tells the account: `{ reason }`, plus `until` when the suspension has an end.

### Enforcement

Three points refuse a standing suspension, each with the code `account_suspended` and those details:

| Where | When | Answer |
|-------|------|--------|
| `verifyJwtAndUser` (`utils/auth.ts`), behind `authenticate` and the tus upload hooks | every authenticated request, after the deleted-account and revoked-token checks (§2) | `401` with code and details; the tus hooks answer the 401 with the message only. A 401 is what makes the web client drop the token (`handleUnauthorized`), so a session ends at its next request |
| `POST /api/auth/login` (`routes/auth.ts`) | after the password check, a federated self-heal included, before a token is signed (§4, step 9) | `403` with code and details; no token |
| WebSocket auth (`ws/handler.ts`) | after the deleted-account and revoked-token checks (§2, "WebSocket Auth") | an `error` event with code and details, then close code 4001, reason `Account suspended`; nothing published, no `ready` |

**The sign-in disclosure rule.** The login says that an account is suspended, and why and until when, only to someone who gave its right password. A wrong password, or a username nobody has, answers `401 invalid_credentials` exactly as for any account, so knowing a username tells nobody whether, why or until when its account is suspended: the reason is for the account's owner. This is why the suspension check sits after the password check in the login, unlike the deleted-account check, and why the token is never signed for a suspended account. The other two points answer only a valid token of the account, which nobody holds without having signed in as it.

**Ending sessions.** A suspension deletes the account's session rows (`endOtherSessions`), so a token taken before it does not work again when it ends, and closes the account's sockets on this instance at once with `connectionManager.forceDisconnectUser(id, { reason: 'Account suspended', endPresence: true })`: voice is left, every socket closes with code 4001, and the account's presence ends as at a last disconnect (websocket.md, "Forced disconnects"). The client's reconnect is then refused at WebSocket auth and its next REST call with the 401. The JWT itself is not revoked (`passwordChangedAt` does not move): a token kept somewhere is accepted again once the suspension is lifted or its end has passed.

### Client

`LoginPage` shows an `account_suspended` answer as a notice in place of the error line: "until lifted" or the end as a date and time in the user's language (`formatDateTime`), and the reason. When the home instance refuses the socket with `account_suspended`, `useWebSocket` calls `handleUnauthorized` instead of reconnecting: the token goes and `/login` opens, where the person learns why once they sign in with their password. A refusal from another instance shows as the coded error's toast, and that connection keeps retrying (websocket.md, "Platform administration", "Known limits").

## An administrator and these

From the admin console an administrator can see an account's sessions and security activity and end its sessions; that records `sessions_ended_by_admin` in the person's own activity, without the admin's device or address. A second factor cannot be turned off from there, only with `tavvit-admin reset-2fa` on the server's shell ([admin.md](admin.md), "The console").

Deleting an account also removes what would otherwise stay behind a tombstone, because a tombstone keeps the users row and so no cascade fires: `user_federation_registry`, `user_blocks` in both directions, `notification_settings`, `user_space_layout`, `personal_stickers`, `peer_approval_subscribers`, `peer_approval_notifications`, `channel_slowmode_posts`, `space_departed_timeouts`, `admin_notes`, member rows of `category_overrides`, the suspension columns and `users.badges`. `invite_redemptions` keeps the record of the use, under `Deleted User`.

The last administrator who can act cannot delete their own account (`last_admin_cannot_leave`). At start, an instance without a live admin promotes the earliest account of this instance that is not deleted or suspended; with none, nobody.

## Automatic sign-ups

Before an account is created, the browser solves a small task: find a nonce so that SHA-256 of `salt:nonce` starts with a number of zero bits (`shared/src/signupChallenge.ts`). `normal` is 16 bits, about half a second on a computer and a few seconds on a phone; `high` is 18. `api.auth.register` does it, on a worker, on whichever instance the client is for, so every way to an account goes through it. An instance from before this answers 404 to the question, which counts as asking nothing.

`POST /api/auth/register` checks it first (`acceptSignupChallenge`): a task this server signed, not older than 10 minutes, at least as hard as the level in force, solved, and not used before. A task is spent by being answered. Nothing is stored for a task until then, and spent ones are held in memory until they would have expired, so a restart forgets them for those few minutes.

**What it is for.** It stops a script that does not run a browser and costs a person a moment, with nothing sent to anyone else: no captcha service, no cookie, no data. Someone who sets out to pay the price still can, on their own hardware far faster than a phone. Rate limits, sign-up rules and confirmed addresses are for them. `crypto.subtle` needs https, so a page on plain http cannot answer and the server says `signup_challenge_failed`; turn the check off there.

The level is set in the admin console, under sign-up rules (`signup_challenge_update` in the audit log). `DISABLE_RATE_LIMITS` turns it off with the rate limits, for test harnesses.

## Accounts that are not people

`users.account_kind` says what an account is. Only a `person` signs in: `accountNamed` looks only among people, and `verifyAccessToken` refuses a token that names any other kind. Such an account exists because a message needs an author ([webhooks.md](webhooks.md)).
