import { homeIdentityProven } from '../utils/federationAttach.js';
import { PASSWORD_MAX_LENGTH } from '@backspace/shared/src/constants.js';
import type { SessionsResponse } from '@backspace/shared';
import { LEGAL_LIMITS } from '@backspace/shared/src/legal.js';
import { currentDocument, readOperator } from '../utils/legal.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNotNull, or, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getDb, schema } from '../db/index.js';
import { hashPassword, verifyPassword, passwordNeedsRehash, issueSessionToken, authenticate } from '../utils/auth.js';
import { normalizeEmail } from '../email/address.js';
import { isMailLocale } from '../email/copy.js';
import { mailLocaleOf, sendConfirmationLink } from '../email/account.js';
import { emailRequiredSince } from '../email/gate.js';
import { emailEnabled } from '../email/service.js';
import { addressAccepted } from './email.js';
import { isWeakPassword } from '../utils/passwordPolicy.js';
import { isDeviceId, recordSecurityEvent } from '../security/events.js';
import { noteFailedPassword, noteSignIn } from '../security/notices.js';
import { issueMfaTicket, twoFactorAvailable } from '../security/twoFactor.js';
import { endOtherSessions, endSession, listSessions } from '../utils/sessions.js';
import { emailDomainBlocked, usernameReserved } from '../utils/signupRules.js';
import { USERNAME_LIMITS } from '@backspace/shared/src/usernames.js';
import { usernameHeld, usernameShapeRefusal } from '../utils/usernames.js';
import { acceptSignupChallenge, createSignupChallenge, signupChallengeLevel } from '../utils/signupChallenge.js';
import { joinStarterSpaces } from '../utils/spaceJoin.js';
import { connectionManager } from '../ws/handler.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { config } from '../config.js';
import type { RegisterRequest, LoginRequest, AuthResponse } from '@backspace/shared';
import { AVATAR_COLORS } from '@backspace/shared';
import { PASSWORD_MIN_LENGTH } from '@backspace/shared/src/constants.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { extractDomain } from './federation.js';
import { fetchPeerEpoch } from '../utils/federationEpoch.js';
import { stripTrailingSlashes } from '../utils/federationAuth.js';
import { getInviteByToken, inviteStatus, redeemInvite, InviteUnavailableError } from '../utils/inviteService.js';
import { sendError, errorText, errorBody } from '../utils/httpErrors.js';
import { loginThrottle, loginThrottleKey, loginThrottleDisabled, loginWait } from '../utils/loginThrottle.js';
import { activeSuspension, suspensionDetails } from '../utils/suspension.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors';

const USERNAME_MIN = USERNAME_LIMITS.MIN_LENGTH;
const USERNAME_MAX = USERNAME_LIMITS.MAX_LENGTH;
const FEDERATED_USERNAME_MAX = 100;
const DISPLAY_NAME_MAX = 32;

/** How long a flood of attempts on one name is told to wait, in seconds. */
const THROTTLE_RETRY_SECONDS = 5;

/**
 * A bcrypt hash of a random string nobody knows, made once on first use at the
 * production cost. Comparing a typed password against it costs exactly what a
 * comparison against a real account costs, which is what lets the login route
 * answer an unknown username as slowly as a known one. Lazy so that importing
 * this module does not spend a quarter of a second hashing at start-up.
 */
let dummyHash: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummyHash;
}

/**
 * The availability check answers `{ available, reason }` rather than the
 * error contract, so a client that predates codes keeps working; the code
 * and details ride along for clients that localize.
 */
function unavailable(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  details?: ErrorDetails,
): FastifyReply {
  return reply.code(statusCode).send({
    available: false,
    reason: errorText(code, details),
    code,
    ...(details ? { details } : {}),
  });
}

/**
 * Whether the account a home instance's login answer names (`user` from its
 * `AuthResponse`) is the home identity `homeUserId`. A native account presents
 * its identity as `homeUserId ?? id`; either field matching counts, as it does
 * for `/users/by-home-id`. A row without a home identity matches nothing.
 */
function isSameHomeAccount(
  account: { id?: unknown; homeUserId?: unknown } | undefined,
  homeUserId: string | null,
): boolean {
  if (!homeUserId || !account) return false;
  return account.id === homeUserId || account.homeUserId === homeUserId;
}

/**
 * The account a sign-in names: by username, and on an instance that sends mail also by a
 * confirmed address. A username with an `@` is a replicated row's, and it is looked at first.
 */
function accountNamed(identifier: string) {
  const db = getDb();
  const name = identifier.trim().toLowerCase();
  const byName = db.select().from(schema.users).where(and(eq(schema.users.username, name), eq(schema.users.accountKind, 'person'))).get();
  if (byName || !emailEnabled() || !name.includes('@')) return byName;
  return db.select().from(schema.users).where(and(eq(schema.users.email, name), isNotNull(schema.users.emailVerifiedAt))).get();
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/auth/challenge - What this instance asks of a new account
  app.get('/api/auth/challenge', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (_request, reply) => reply.code(200).send(createSignupChallenge(signupChallengeLevel())));

  app.post<{ Body: RegisterRequest }>('/api/auth/register', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '2 minutes',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    // Before anything is read or looked up, so a script without a browser learns nothing here.
    if (!acceptSignupChallenge(request.body?.challenge, signupChallengeLevel())) {
      return sendError(reply, 400, 'signup_challenge_failed');
    }

    const { username, password, displayName, avatarColor: requestedAvatarColor, homeInstance, homeUserId, attachProof, acceptedTermsVersion, ageConfirmed } = request.body;

    if (!username || typeof username !== 'string') {
      return sendError(reply, 400, 'username_required');
    }

    if (!password || typeof password !== 'string') {
      return sendError(reply, 400, 'password_required');
    }

    // Once the instance has published terms, a local account starts by agreeing
    // to them and confirming the minimum age (docs/systems/legal.md). A
    // replicated row is created by the person's home instance, not by a sign-up.
    const termsInForce = homeInstance ? undefined : currentDocument('terms');
    if (termsInForce) {
      if (acceptedTermsVersion !== termsInForce.version) {
        return sendError(reply, 400, 'terms_not_accepted', { version: termsInForce.version });
      }
      if (ageConfirmed !== true) {
        return sendError(reply, 400, 'age_not_confirmed', { age: readOperator()?.minimumAge ?? LEGAL_LIMITS.MIN_AGE_DEFAULT });
      }
    }

    const trimmedUsername = username.trim().toLowerCase();

    // Replicated registrations (homeInstance provided) may use username@domain format
    // for collision fallback. Local registrations use strict alphanumeric+underscore.
    if (homeInstance) {
      // Validate homeInstance is a reasonable domain string
      if (typeof homeInstance !== 'string' || homeInstance.length > 253 || !/^[a-zA-Z0-9._-]+$/.test(homeInstance)) {
        return sendError(reply, 400, 'home_instance_invalid');
      }

      if (trimmedUsername.includes('@')) {
        // username@domain format: validate local part + domain part
        const atIndex = trimmedUsername.indexOf('@');
        const localPart = trimmedUsername.slice(0, atIndex);
        const domainPart = trimmedUsername.slice(atIndex + 1);

        if (localPart.length < USERNAME_MIN || localPart.length > USERNAME_MAX || !/^[a-z0-9_]+$/.test(localPart)) {
          return sendError(reply, 400, 'username_local_part_invalid', { min: USERNAME_MIN, max: USERNAME_MAX });
        }
        if (domainPart.length === 0 || domainPart.length > 253 || !/^[a-zA-Z0-9._-]+$/.test(domainPart)) {
          return sendError(reply, 400, 'username_domain_part_invalid');
        }
        if (trimmedUsername.length > FEDERATED_USERNAME_MAX) {
          return sendError(reply, 400, 'username_too_long', { max: FEDERATED_USERNAME_MAX });
        }
      } else {
        // Replicated users MUST use username@domain format — plain usernames
        // are reserved exclusively for native users of this instance
        return sendError(reply, 400, 'replicated_username_format_required');
      }
    } else {
      // Local registration — strict validation
      const refusal = usernameShapeRefusal(trimmedUsername);
      if (refusal) return sendError(reply, 400, refusal.code, refusal.details);
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      return sendError(reply, 400, 'password_too_short', { min: PASSWORD_MIN_LENGTH });
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      return sendError(reply, 400, 'password_too_long', { max: PASSWORD_MAX_LENGTH });
    }
    // The same limit as changing it later: this name goes out to whoever is in the starter spaces.
    if (displayName !== undefined && displayName !== null) {
      if (typeof displayName !== 'string') return sendError(reply, 400, 'validation_failed', { field: 'displayName' });
      if (displayName.trim().length > DISPLAY_NAME_MAX) return sendError(reply, 400, 'display_name_too_long', { max: DISPLAY_NAME_MAX });
    }

    // A replicated row's password is a secret its home made up, not something anyone chose.
    if (!homeInstance && isWeakPassword(password, trimmedUsername)) {
      return sendError(reply, 400, 'password_too_common');
    }

    // An address is for local accounts, on an instance that sends mail. Without either it is
    // not looked at, so nothing that registers without one changes.
    const wantsAddress = !homeInstance && emailEnabled();
    let address: string | null = null;
    if (wantsAddress) {
      if (request.body.email) {
        address = normalizeEmail(request.body.email);
        if (!address) return sendError(reply, 400, 'email_invalid');
      } else if (emailRequiredSince() !== null) {
        return sendError(reply, 400, 'email_required');
      }
    }

    const db = getDb();

    // Read both gates from instance_settings.
    // - registrationOpen: nullable column; null falls back to env var (config.registrationOpen).
    //   Admin-explicit 0/1 overrides env. Gates LOCAL anonymous signup.
    // - federatedRegistrationOpen: NOT NULL DEFAULT 1 column. Gates FEDERATED identity
    //   replication (homeInstance set). Independent of registrationOpen by spec §1.2.
    const instanceRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    const registrationOpen = instanceRow?.registrationOpen !== null && instanceRow?.registrationOpen !== undefined
      ? instanceRow.registrationOpen === 1
      : config.registrationOpen;
    // instanceRow is guaranteed by ensureDefaults() (migrate.ts) to have id=1
    // post-boot, with federatedRegistrationOpen NOT NULL DEFAULT 1. The optional
    // chain is defensive against the impossible-in-production case of a missing
    // row (e.g., a hand-cleared DB) — falls open-closed rather than open-open
    // for federation, which is the safer default.
    const federatedRegistrationOpen = instanceRow?.federatedRegistrationOpen === 1;

    // Optional invite token. Only meaningful for the local-closed path; ignored
    // entirely on the federated path (spec §1.3, §5.6) and on the local-open path
    // (spec §5.7).
    const inviteToken = typeof request.body.inviteToken === 'string'
      ? request.body.inviteToken
      : undefined;

    if (homeInstance) {
      // Federated path: token IGNORED entirely. Gate is federatedRegistrationOpen.
      // With federation switched off at deployment level there is no home
      // instance to be replicated from, whatever the DB flag says.
      if (!config.federation.enabled) {
        return sendError(reply, 403, 'federation_disabled');
      }
      if (!federatedRegistrationOpen) {
        return sendError(reply, 403, 'federated_registration_closed');
      }
      // Anyone can say they are someone elsewhere. Asked of their home below.
      if (typeof attachProof !== 'string' || typeof homeUserId !== 'string') {
        return sendError(reply, 403, 'home_instance_unproven');
      }
      // Falls through to the normal create-a-new-row path below. A federated
      // registration NEVER binds credentials to a pre-existing row.
    } else {
      // Local path: registrationOpen is the primary gate. A valid invite token
      // bypasses it when closed. When open, the token is silently ignored.
      if (!registrationOpen) {
        if (!inviteToken) {
          return sendError(reply, 403, 'invite_required');
        }
        // Pre-flight check: reject obviously-invalid tokens before any expensive
        // work (bcrypt). The final enforcement still happens inside the redemption
        // transaction below — this only short-circuits the easy reject path.
        const inviteRow = getInviteByToken(inviteToken);
        if (!inviteRow || inviteStatus(inviteRow) !== 'active') {
          return sendError(reply, 403, 'invite_invalid');
        }
      }
      // If registrationOpen is true: inviteToken is silently ignored — no validation,
      // no consumption (spec §5.7).
    }

    // Behind the door above, so that a closed instance does not answer what is on its lists.
    if (!homeInstance && usernameReserved(trimmedUsername)) {
      return sendError(reply, 400, 'username_reserved');
    }
    if (address && emailDomainBlocked(address)) return sendError(reply, 400, 'email_domain_blocked');

    if (address && !(await addressAccepted(address))) return sendError(reply, 400, 'email_undeliverable');

    const passwordHash = await hashPassword(password);

    // --- Registration always creates a NEW row ---
    // This endpoint is public and unauthenticated: the caller supplies
    // `homeInstance`/`homeUserId` with no proof whatsoever that they control
    // that federated identity. It therefore must never bind these credentials
    // to a row that already exists — in particular not to a relay-created stub
    // (`passwordHash = '!federation-replicated'`), which is a placeholder for a
    // person who has never authenticated here. `homeUserId` is only unique
    // WITHIN an instance, so it is not an identifier we can match on either.
    //
    // Merging a stub into a real account (so the owner inherits their DM
    // history) is exclusively the job of the authenticated, S2S-proof-gated
    // reattach flow: POST /api/users/@me/reattach, which requires an
    // attach-proof token minted by the home instance.
    const existing = db.select().from(schema.users).where(eq(schema.users.username, trimmedUsername)).get();
    if (existing || usernameHeld(trimmedUsername)) {
      return sendError(reply, 409, 'username_taken');
    }

    // Only an instance this one already trusts is asked, so that registering
    // cannot make this server call an address a stranger names. The proof is
    // spent by asking, which is why this comes after everything else that can fail.
    if (homeInstance && !(await homeIdentityProven(homeInstance, homeUserId as string, trimmedUsername, attachProof as string))) {
      return sendError(reply, 403, 'home_instance_unproven');
    }

    const userId = generateSnowflake();
    const now = Date.now();

    const avatarColor = (requestedAvatarColor && (AVATAR_COLORS as readonly string[]).includes(requestedAvatarColor))
      ? requestedAvatarColor
      : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    // Note: status is left at the schema default ('offline') and is set to
    // 'online' exclusively by the WebSocket auth path (ws/handler.ts). A
    // successful REST /register does not by itself imply a live connection —
    // the client may never establish a WS (transient network failure, mobile
    // background, error path between this 201 response and /ws connect),
    // which would otherwise produce a permanently stuck-online row that no
    // disconnect timer can clean up. The WS handshake will flip it to
    // 'online' once a real socket attaches.
    const userRow = {
      id: userId,
      username: trimmedUsername,
      displayName: displayName?.trim() || null,
      passwordHash,
      // Nobody becomes an administrator by registering, however early: that is `tavvit-admin`'s.
      isAdmin: 0,
      homeInstance: homeInstance || null,
      homeUserId: (homeInstance && homeUserId && typeof homeUserId === 'string') ? homeUserId : null,
      avatarColor,
      createdAt: now,
      termsVersion: termsInForce?.version ?? null,
      termsAcceptedAt: termsInForce ? now : null,
      email: address,
      locale: !homeInstance && isMailLocale(request.body.locale) ? request.body.locale : null,
    };

    // Only the LOCAL-CLOSED-WITH-VALID-TOKEN path consumes an invite. The
    // federated path (gated above on federatedRegistrationOpen) and the
    // local-open path never touch the invite_links table.
    const consumesInvite = !homeInstance && !registrationOpen && !!inviteToken;

    if (consumesInvite) {
      // Atomic redemption: the user INSERT, the usedCount bump, and the
      // invite_redemptions row all run inside one SQLite transaction. If any
      // step throws (token consumed by a concurrent request, username collision
      // bumping into the unique index, etc.) the entire transaction rolls back —
      // we never burn a redemption on a failed registration.
      try {
        redeemInvite(inviteToken!, () => {
          db.insert(schema.users).values(userRow).run();
          return { id: userId, username: trimmedUsername };
        });
      } catch (err) {
        if (err instanceof InviteUnavailableError) {
          // Concurrent revoke / last-slot race / expiry-while-typing all surface here.
          return sendError(reply, 403, 'invite_invalid');
        }
        throw err;
      }
    } else {
      // Standard local-open or federated-new-user path: plain user insert.
      db.insert(schema.users).values(userRow).run();
    }

    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) {
      return sendError(reply, 500, 'user_create_failed');
    }

    if (!homeInstance) joinStarterSpaces(user.id, now);

    const { token } = issueSessionToken(user, request);

    // The account exists whatever happens to this mail: the person can ask for it again
    // in settings, and it confirms nothing until its link is used.
    if (address) {
      try {
        sendConfirmationLink(user, address, 'verify_email', mailLocaleOf(user));
      } catch (error) {
        console.error('[email] could not queue a confirmation:', error instanceof Error ? error.name : 'unknown error');
      }
    }

    const response: AuthResponse = {
      token,
      user: sanitizeUser(user, true),
    };

    return reply.code(201).send(response);
  });

  app.get<{ Querystring: { username?: string } }>('/api/auth/check-username', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    const raw = request.query.username;
    if (!raw || typeof raw !== 'string') {
      return unavailable(reply, 400, 'username_required');
    }

    const trimmed = raw.trim().toLowerCase();

    // Format validation (same rules as registration)
    const refusal = usernameShapeRefusal(trimmed);
    if (refusal) return unavailable(reply, 200, refusal.code, refusal.details);

    // Check registration is open
    const db = getDb();
    const instanceRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    const registrationOpen = instanceRow?.registrationOpen !== null && instanceRow?.registrationOpen !== undefined
      ? instanceRow.registrationOpen === 1
      : config.registrationOpen;
    if (!registrationOpen) {
      return unavailable(reply, 403, 'registration_closed');
    }
    if (usernameReserved(trimmed)) {
      return unavailable(reply, 200, 'username_reserved');
    }

    const existing = db.select().from(schema.users).where(eq(schema.users.username, trimmed)).get();
    return reply.code(200).send({ available: !existing && !usernameHeld(trimmed) });
  });

  // Public — used by RegisterPage to debounce-validate invite tokens during
  // typing. The status -> response mapping enforces a "collapsed enumeration
  // shield": revoked, not-found, and malformed tokens all collapse to
  // `'invalid'` so this endpoint can't be used to distinguish them. Only
  // `expired` and `exhausted` surface as themselves because those are
  // legitimate UX hints ("ask the admin to extend it") rather than
  // existence/state leaks. The `name` field is returned ONLY in the valid
  // case — invalid responses must not leak any invite metadata.
  // Status code is always 200; the response body discriminates.
  app.get<{ Querystring: { token?: string } }>('/api/auth/check-invite', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    const token = request.query.token;
    if (!token || typeof token !== 'string') {
      return reply.code(200).send({ valid: false, reason: 'invalid' });
    }

    // getInviteByToken pre-validates the 22-char base64url shape before
    // hitting the DB; malformed inputs return null here, so the same branch
    // covers both "wrong shape" and "shape ok, not in DB".
    const row = getInviteByToken(token);
    if (!row) {
      return reply.code(200).send({ valid: false, reason: 'invalid' });
    }

    const status = inviteStatus(row);
    if (status === 'active') {
      return reply.code(200).send({ valid: true, name: row.name });
    }
    if (status === 'expired' || status === 'exhausted') {
      return reply.code(200).send({ valid: false, reason: status });
    }
    // status === 'revoked' — collapsed to 'invalid' (no enumeration leak)
    return reply.code(200).send({ valid: false, reason: 'invalid' });
  });

  app.post<{ Body: LoginRequest }>('/api/auth/login', {
    config: {
      rateLimit: {
        max: 15,
        timeWindow: '2 minutes',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    const { username, password, deviceId: rawDeviceId } = request.body ?? {};
    const deviceId = isDeviceId(rawDeviceId) ? rawDeviceId : null;

    if (!username || typeof username !== 'string') {
      return sendError(reply, 400, 'username_required');
    }

    if (!password || typeof password !== 'string') {
      return sendError(reply, 400, 'password_required');
    }

    // One answer for every way a credential can be wrong, and every one of them
    // counts against the name. A password longer than any can be is one of them.
    // The count is the account's however it is named, or two spellings would mean twice the guesses.
    const user = accountNamed(username);
    const throttleKey = loginThrottleKey(user?.username ?? username);
    const throttleActive = !loginThrottleDisabled();
    if (throttleActive && !loginThrottle.enter(throttleKey)) {
      reply.header('Retry-After', String(THROTTLE_RETRY_SECONDS));
      return reply.code(429).send({
        ...errorBody(429, 'login_throttled', { minutes: 1 }),
        retryAfter: THROTTLE_RETRY_SECONDS,
      });
    }
    const rejectCredentials = (): FastifyReply => {
      if (throttleActive) loginThrottle.recordFailure(throttleKey, request.ip);
      if (user && user.isDeleted !== 1) noteFailedPassword(user, request);
      return sendError(reply, 401, 'invalid_credentials');
    };

    try {
    // Earlier failures make this one wait, before any database or hashing work
    // (utils/loginThrottle.ts). The right password is never refused, only delayed.
    if (throttleActive) await loginWait.sleep(loginThrottle.waitFor(throttleKey, request.ip));

    if (password.length > PASSWORD_MAX_LENGTH) return rejectCredentials();

    const db = getDb();

    if (!user) {
      // Spend the same time a real comparison costs, so the response time does
      // not tell a guesser which usernames exist.
      await verifyPassword(password, await dummyPasswordHash());
      return rejectCredentials();
    }

    if (user.isDeleted) {
      await verifyPassword(password, await dummyPasswordHash());
      return sendError(reply, 401, 'account_deleted');
    }

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      // For federated users, try verifying against the home instance.
      // If the password is valid there but stale here, self-heal the local hash.
      // With federation off, a row that still names a home instance never
      // triggers a request to it: the self-heal below POSTs the password to that
      // host, and nothing may leave the server for a host while the switch is off.
      if (user.homeInstance && config.federation.enabled) {
        // Detached account (§6.3b detach): its home domain now belongs to a
        // DIFFERENT incarnation — there is no trusted home to consult. The
        // self-heal path is permanently disabled: re-hashing on the new
        // incarnation's say-so would hand this established account to a
        // stranger. Local-hash login above remains the only (and sufficient)
        // way in — the hash was only ever written by the owner's registration
        // or an epoch-gated self-heal against the OLD incarnation.
        if (user.federationHomeOrphaned === 1) {
          return rejectCredentials();
        }
        try {
          const homeUsername = user.username.includes('@')
            ? user.username.split('@')[0]!
            : user.username;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);

          // Not followed elsewhere: a redirect would take the password along, to wherever it points.
          // An answer of 3xx is then no 200, and counts as a failed check.
          const homeResponse = await fetch(`https://${user.homeInstance}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: homeUsername, password }),
            signal: controller.signal,
            redirect: 'manual',
          });

          clearTimeout(timeout);

          if (homeResponse.ok) {
            // A 200 says only that SOME account on the home has that name and
            // password. The name sent is the local part of this row's name,
            // which older re-attaches suffixed (`kai_1`), so it can be another
            // person's handle there. The rehash is for this row only when the
            // account the home signed in is this row's home identity: the
            // identity a native account presents (`homeUserId ?? id`, as
            // registration and `/users/by-home-id` read it).
            const homeAccount = await homeResponse.json().catch(() => null) as
              { user?: { id?: unknown; homeUserId?: unknown } } | null;
            if (!isSameHomeAccount(homeAccount?.user, user.homeUserId)) {
              app.log.warn(`Refused self-heal for ${user.username}: the home signed in a different account`);
              return rejectCredentials();
            }

            // §6.3a epoch guard: self-heal (re-hashing the local password because
            // the home accepted it) must fire ONLY when the home instance is the
            // SAME incarnation we established trust with. A reset home (new
            // incarnation on the same domain) accepting a NEW same-name user's
            // credentials would otherwise silently hand that stranger this
            // established account. We gate on the trusted baseline epoch.
            //
            // Reuse the authenticated fetchPeerEpoch (HMAC-signed both ways) rather
            // than an unauthenticated login-response body — the latter is
            // TLS-MITM-bypassable and would re-open the exact hijack this closes.
            const homeDomain = extractDomain(user.homeInstance);
            const peer = db.select().from(schema.federationPeers)
              .where(or(
                eq(schema.federationPeers.origin, homeDomain),
                eq(schema.federationPeers.origin, `https://${homeDomain}`),
                eq(schema.federationPeers.origin, `http://${homeDomain}`),
              ))
              .get();

            if (peer && peer.peerInstanceId) {
              // Baseline on record → enforce. currentEpoch === null means "cannot
              // determine" (peer too old → 404, unreachable, bad sig, or the reset
              // peer's desynced secret rejects our signed request) → fail closed.
              const currentEpoch = await fetchPeerEpoch({ origin: peer.origin, hmacSecret: peer.hmacSecret });
              if (currentEpoch !== peer.peerInstanceId) {
                app.log.warn(
                  `Refused self-heal for ${user.username}: home epoch ${currentEpoch ?? 'unknown'} != baseline ${peer.peerInstanceId}`,
                );
                return rejectCredentials();
              }
            }
            // No peer row / null baseline → legacy allow (fall through to self-heal).

            // Home instance accepted the password — update our stale hash.
            // Do NOT set passwordChangedAt: this is a state correction, not a
            // password change. Setting it would invalidate existing valid JWTs.
            const newHash = await hashPassword(password);
            db.update(schema.users)
              .set({ passwordHash: newHash })
              .where(eq(schema.users.id, user.id))
              .run();

            app.log.info(`Self-healed password hash for federated user ${user.username} via ${user.homeInstance}`);
          } else {
            // Home instance also rejected — password is genuinely wrong
            return rejectCredentials();
          }
        } catch {
          // Home instance unreachable — fall back to local-only rejection
          return rejectCredentials();
        }
      } else {
        return rejectCredentials();
      }
    }

    // Note: status='online' is set exclusively by the WebSocket auth path
    // (ws/handler.ts). A successful REST /login does not by itself imply a
    // live connection — the client may never establish a WS (transient
    // network failure, mobile background, error path), which would otherwise
    // produce a permanently stuck-online row that no disconnect timer can
    // clean up. The user's reported status remains whatever it was; the WS
    // handshake will flip it to 'online' once a real socket attaches.

    // A hash from before Argon2id, or from other settings, is replaced now that the
    // password is at hand. Not a password change: nothing is stamped, no session ends.
    if (passwordNeedsRehash(user.passwordHash) && await verifyPassword(password, user.passwordHash)) {
      db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, user.id)).run();
    }

    // The password was right and a second factor is due. No session and no token: a JWT
    // with a user id is a login to everything here, so the answer is a ticket only the
    // second step reads, and a refusal to anything that does not know what that is. A
    // server that lost its key must not skip the step, so it fails closed.
    if (user.twoFactorEnabledAt !== null) {
      if (!twoFactorAvailable()) return sendError(reply, 503, 'two_factor_unavailable');
      return reply.code(401).send({ ...errorBody(401, 'mfa_required'), ticket: issueMfaTicket(user.id, deviceId) });
    }

    if (throttleActive) loginThrottle.recordSuccess(throttleKey, request.ip);

    // A suspended account is told so only now, with the password right: the
    // reason is for its owner, not for whoever knows the username.
    const suspension = activeSuspension(user);
    if (suspension) return sendError(reply, 403, 'account_suspended', suspensionDetails(suspension));

    const { token } = issueSessionToken(user, request);
    noteSignIn(user, request, deviceId);

    const response: AuthResponse = {
      token,
      user: sanitizeUser(user, true),
    };

    return reply.code(200).send(response);
    } finally {
      if (throttleActive) loginThrottle.leave(throttleKey);
    }
  });

  // ─── Sessions (docs/systems/auth.md, "Sessions") ─────
  // A person's own sessions, on this instance. Nobody else's can be named here: every
  // query carries the user id the token proved.
  app.post('/api/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    if (request.sessionId) {
      endSession(request.userId, request.sessionId);
      connectionManager.closeSessionSockets(new Set([request.sessionId]));
    }
    return reply.code(200).send({ success: true });
  });

  app.get('/api/auth/sessions', { preHandler: authenticate }, async (request, reply) => {
    const response: SessionsResponse = { sessions: listSessions(request.userId, request.sessionId ?? null) };
    return reply.code(200).send(response);
  });

  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!endSession(request.userId, request.params.id)) return sendError(reply, 404, 'not_found');
    connectionManager.closeSessionSockets(new Set([request.params.id]));
    recordSecurityEvent(request.userId, 'session_revoked', request);
    const response: SessionsResponse = { sessions: listSessions(request.userId, request.sessionId ?? null) };
    return reply.code(200).send(response);
  });

  app.post('/api/auth/sessions/end-others', { preHandler: authenticate }, async (request, reply) => {
    connectionManager.closeSessionSockets(new Set(endOtherSessions(request.userId, request.sessionId ?? null)));
    recordSecurityEvent(request.userId, 'sessions_ended', request);
    const response: SessionsResponse = { sessions: listSessions(request.userId, request.sessionId ?? null) };
    return reply.code(200).send(response);
  });

  // ─── POST /api/auth/attach-proof ──────────────────────────────────────────
  // Mint a one-time proof token for detached-account re-attach on a peer
  // (re-attach spec §3.1). Native accounts only — the token proves control of
  // THIS home identity. 60s TTL, single-use, bound to the target peer domain
  // (the verifying peer's domain is checked server-side on D, not trusted from
  // the token bearer).
  app.post<{ Body: { targetDomain?: unknown } }>('/api/auth/attach-proof', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const db = getDb();

    const rawTarget = request.body?.targetDomain;
    if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0 || rawTarget.length > 255) {
      return sendError(reply, 400, 'target_domain_required');
    }
    const targetDomain = stripTrailingSlashes(rawTarget.trim().toLowerCase().replace(/^https?:\/\//, ''));
    // Re-check emptiness AFTER normalization: inputs like "https://" or "/"
    // pass the pre-normalization guard but collapse to "" — never persist an
    // inert target_domain='' proof row.
    if (targetDomain.length === 0) {
      return sendError(reply, 400, 'target_domain_required');
    }

    // Native accounts only — a federated/replicated account has no authority
    // to mint proofs for this domain's identities.
    if (request.homeInstance) {
      return sendError(reply, 403, 'native_account_required');
    }

    const now = Date.now();
    // Opportunistic janitor: expired rows have no residual value.
    db.delete(schema.federationAttachProofs)
      .where(lt(schema.federationAttachProofs.expiresAt, now))
      .run();

    const token = randomBytes(32).toString('hex');
    db.insert(schema.federationAttachProofs).values({
      token,
      homeUserId: request.userId,
      targetDomain,
      createdAt: now,
      expiresAt: now + 60_000,
      usedAt: null,
    }).run();

    return reply.code(200).send({ token });
  });
}
