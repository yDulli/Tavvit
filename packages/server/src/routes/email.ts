import { isWeakPassword } from '../utils/passwordPolicy.js';
import { recordSecurityEvent } from '../security/events.js';
import { refuseWithoutSecondFactor } from './twoFactor.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@backspace/shared/src/constants.js';
import type { ChangeEmailRequest } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate, hashPassword, requireAdmin, verifyPassword } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { endOtherSessions } from '../utils/sessions.js';
import { loginThrottle, loginThrottleKey } from '../utils/loginThrottle.js';
import { connectionManager } from '../ws/handler.js';
import { domainReceivesMail, normalizeEmail } from '../email/address.js';
import { emailDomainBlocked } from '../utils/signupRules.js';
import { isMailLocale } from '../email/copy.js';
import {
  accountEmailStatus,
  cancelPendingAddress,
  confirmAddress,
  mailLocaleOf,
  notifyPasswordChanged,
  removeAddress,
  requestAddressChange,
  sendConfirmationLink,
  sendPasswordReset,
} from '../email/account.js';
import {
  adminEmailStatus,
  dropLinks,
  emailEnabled,
  emailState,
  emailTransportName,
  enqueueEmail,
  isLinkToken,
  linkOwner,
  mailDecision,
  recordDeliveryProblem,
  takeLink,
} from '../email/service.js';

/** Whether a mail could reach this address. The test transport has no outside world to ask. */
export async function addressAccepted(address: string): Promise<boolean> {
  return emailTransportName() === 'memory' || domainReceivesMail(address);
}

const byClient = (request: FastifyRequest): string => request.ip;

export async function emailRoutes(app: FastifyInstance): Promise<void> {
  // ─── Without an account ──────────────────────────────────────────────────

  // The same answer whether the address belongs to anyone. Mail being down is the
  // instance's state and is said before any account is looked up, so that says nothing either.
  app.post<{ Body: { email?: unknown; locale?: unknown } }>('/api/auth/password/forgot', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: byClient } },
  }, async (request, reply) => {
    const state = emailState();
    if (state === 'off') return sendError(reply, 503, 'email_not_configured');
    if (state !== 'ok') return sendError(reply, 503, 'email_unavailable');
    const address = normalizeEmail(request.body?.email);
    if (!address) return sendError(reply, 400, 'email_invalid');
    const locale = request.body?.locale;
    // After the answer: how long the work takes must not tell either.
    setImmediate(() => {
      try {
        sendPasswordReset(address, locale);
      } catch (error) {
        console.error('[email] reset request failed:', error instanceof Error ? error.name : 'unknown error');
      }
    });
    return reply.code(200).send({ success: true });
  });

  app.post<{ Body: { token?: unknown; password?: unknown } }>('/api/auth/password/reset', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes', keyGenerator: byClient } },
  }, async (request, reply) => {
    const token = request.body?.token;
    const password = request.body?.password;
    if (!isLinkToken(token)) return sendError(reply, 410, 'email_token_invalid');
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
      return sendError(reply, 400, 'password_too_short', { min: PASSWORD_MIN_LENGTH });
    }
    if (password.length > PASSWORD_MAX_LENGTH) return sendError(reply, 400, 'password_too_long', { max: PASSWORD_MAX_LENGTH });
    // Hashing is the costly part, so nobody gets it for a made-up token. A too short password above does not use the link up.
    const owner = linkOwner(token, 'reset');
    if (!owner) return sendError(reply, 410, 'email_token_invalid');
    if (isWeakPassword(password, getDb().select({ username: schema.users.username }).from(schema.users).where(eq(schema.users.id, owner)).get()?.username)) {
      return sendError(reply, 400, 'password_too_common');
    }
    const passwordHash = await hashPassword(password);

    const db = getDb();
    const now = Date.now();
    const user = db.transaction(() => {
      const link = takeLink(token, 'reset', now);
      if (!link) return null;
      const row = db.select().from(schema.users).where(eq(schema.users.id, link.userId)).get();
      // The address must still be the one that speaks for this account.
      if (!row || row.isDeleted === 1 || row.homeInstance !== null || row.emailVerifiedAt === null || row.email !== link.address) return null;
      db.update(schema.users).set({ passwordHash, passwordChangedAt: now }).where(eq(schema.users.id, row.id)).run();
      endOtherSessions(row.id, null);
      dropLinks(row.id, ['reset']);
      notifyPasswordChanged(row, now);
      return row;
    });
    if (!user) return sendError(reply, 410, 'email_token_invalid');

    // Nobody is signed in by this: whoever has the link only gets to choose a password.
    connectionManager.forceDisconnectUser(user.id, { reason: 'Password reset', endPresence: true });
    loginThrottle.recordSuccess(loginThrottleKey(user.username), request.ip);
    recordSecurityEvent(user.id, 'password_reset', request);
    return reply.code(200).send({ success: true });
  });

  // A click on a page, not the GET of the link: mail scanners follow links, and must not confirm anything.
  app.post<{ Body: { token?: unknown } }>('/api/auth/email/verify', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes', keyGenerator: byClient } },
  }, async (request, reply) => {
    const token = request.body?.token;
    if (!isLinkToken(token)) return sendError(reply, 410, 'email_token_invalid');
    const outcome = confirmAddress(token);
    if (!outcome.ok) return sendError(reply, outcome.code === 'email_address_in_use' ? 409 : 410, outcome.code);
    connectionManager.sendToUser(outcome.user.id, { type: 'user_updated', user: sanitizeUser(outcome.user, true) });
    recordSecurityEvent(outcome.user.id, outcome.replaced ? 'email_changed' : 'email_added', request);
    return reply.code(200).send({ success: true, address: outcome.address });
  });

  // ─── The account's own address ───────────────────────────────────────────

  app.get('/api/users/@me/email', { preHandler: authenticate }, async (request, reply) => {
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    return reply.code(200).send(accountEmailStatus(user));
  });

  // The password is asked every time: a token left behind on some device must not be enough
  // to move the account's way back in somewhere else.
  app.put<{ Body: ChangeEmailRequest }>('/api/users/@me/email', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    if (!emailEnabled()) return sendError(reply, 503, 'email_not_configured');
    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    if (user.homeInstance !== null) return sendError(reply, 403, 'native_account_required');

    const { address: rawAddress, password, locale: rawLocale } = request.body ?? {};
    if (!password || typeof password !== 'string') return sendError(reply, 400, 'password_required');
    if (!(await verifyPassword(password, user.passwordHash))) return sendError(reply, 403, 'current_password_incorrect');
    const address = normalizeEmail(rawAddress);
    if (!address) return sendError(reply, 400, 'email_invalid');

    const locale = mailLocaleOf({ locale: isMailLocale(rawLocale) ? rawLocale : user.locale });
    if (user.emailVerifiedAt !== null && user.email === address) {
      cancelPendingAddress(user.id);
    } else {
      if (emailDomainBlocked(address)) return sendError(reply, 400, 'email_domain_blocked');
      if (!(await addressAccepted(address))) return sendError(reply, 400, 'email_undeliverable');
      const decision = mailDecision(user.emailVerifiedAt !== null ? 'change_email_confirm' : 'verify_email', address);
      if (decision === 'suppressed') return sendError(reply, 409, 'email_undeliverable');
      if (decision === 'cooldown' || decision === 'limit') return sendError(reply, 429, 'rate_limited');
      // Last, so that nothing above can use up a code and then refuse.
      const refused = refuseWithoutSecondFactor(user, request.body?.twoFactorCode, request, reply);
      if (refused) return refused;
      requestAddressChange(user, address, locale);
    }
    const updated = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    if (!updated) return sendError(reply, 404, 'user_not_found');
    connectionManager.sendToUser(user.id, { type: 'user_updated', user: sanitizeUser(updated, true) });
    return reply.code(200).send(accountEmailStatus(updated));
  });

  app.post('/api/users/@me/email/resend', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    if (!emailEnabled()) return sendError(reply, 503, 'email_not_configured');
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    const waiting = user.pendingEmail ?? (user.emailVerifiedAt === null ? user.email : null);
    if (!waiting) return sendError(reply, 409, 'email_nothing_to_confirm');
    const kind = user.pendingEmail !== null ? 'change_email_confirm' : 'verify_email';
    const decision = sendConfirmationLink(user, waiting, kind, mailLocaleOf(user));
    if (decision === 'suppressed') return sendError(reply, 409, 'email_undeliverable');
    if (decision === 'cooldown' || decision === 'limit') return sendError(reply, 429, 'rate_limited');
    return reply.code(200).send(accountEmailStatus(user));
  });

  app.delete('/api/users/@me/email/pending', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const db = getDb();
    cancelPendingAddress(request.userId);
    const user = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    connectionManager.sendToUser(user.id, { type: 'user_updated', user: sanitizeUser(user, true) });
    return reply.code(200).send(accountEmailStatus(user));
  });

  app.delete<{ Body: { password?: unknown; twoFactorCode?: unknown } }>('/api/users/@me/email', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    const password = request.body?.password;
    if (!password || typeof password !== 'string') return sendError(reply, 400, 'password_required');
    if (!(await verifyPassword(password, user.passwordHash))) return sendError(reply, 403, 'current_password_incorrect');
    const refused = refuseWithoutSecondFactor(user, request.body?.twoFactorCode, request, reply);
    if (refused) return refused;
    removeAddress(user);
    recordSecurityEvent(user.id, 'email_removed', request);
    const updated = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    if (!updated) return sendError(reply, 404, 'user_not_found');
    connectionManager.sendToUser(user.id, { type: 'user_updated', user: sanitizeUser(updated, true) });
    return reply.code(200).send(accountEmailStatus(updated));
  });

  // Which language mail to this account is written in. The client says when it differs.
  app.put<{ Body: { locale?: unknown } }>('/api/users/@me/locale', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const locale = request.body?.locale;
    if (!isMailLocale(locale)) return sendError(reply, 400, 'validation_failed', { field: 'locale' });
    getDb().update(schema.users).set({ locale }).where(eq(schema.users.id, request.userId)).run();
    return reply.code(200).send({ locale });
  });

  // ─── Admin ───────────────────────────────────────────────────────────────

  app.get('/api/admin/email/status', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.code(200).send(adminEmailStatus());
  });

  app.post<{ Body: { to?: unknown } }>('/api/admin/email/test', {
    preHandler: [authenticate, requireAdmin],
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (!emailEnabled()) return sendError(reply, 503, 'email_not_configured');
    const to = normalizeEmail(request.body?.to);
    if (!to) return sendError(reply, 400, 'email_invalid');
    const admin = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    const decision = enqueueEmail({ kind: 'test', to, userId: null, locale: mailLocaleOf({ locale: admin?.locale ?? null }) });
    if (decision === 'suppressed') return sendError(reply, 409, 'email_undeliverable');
    if (decision !== 'ok') return sendError(reply, 429, 'rate_limited');
    return reply.code(202).send({ queued: true });
  });
}

// ─── Bounce reports from Resend ────────────────────────────────────────────

const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

/**
 * A webhook's signature, as Resend sends it (Svix's scheme): HMAC-SHA256 of
 * `id.timestamp.body` with the secret after its `whsec_` prefix, base64-encoded, possibly
 * several of them separated by spaces. It covers the exact bytes, so the body must be the raw one.
 */
export function webhookSignatureValid(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, rawBody: string, now: number = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > SIGNATURE_TOLERANCE_MS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** What the report says about its addresses, if anything lasting. A bounce that may pass is not held against anyone. */
export function applyResendEvent(event: unknown): void {
  const { type, data } = (event ?? {}) as { type?: unknown; data?: { to?: unknown; bounce?: { type?: unknown } } };
  const reason = type === 'email.complained' ? 'complaint'
    : type === 'email.suppressed' ? 'bounce'
      : type === 'email.bounced' && data?.bounce?.type !== 'Transient' ? 'bounce'
        : null;
  if (!reason) return;
  const recipients = Array.isArray(data?.to) ? data.to : [data?.to];
  for (const recipient of recipients) {
    const address = normalizeEmail(recipient);
    if (address) recordDeliveryProblem(address, reason);
  }
}

/** The route, with its own parser for the raw body. In a plugin scope of its own, so nothing else gets that parser. */
export async function registerResendWebhook(app: FastifyInstance, secret: string): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256 * 1024 }, (_request, body, done) => {
    done(null, body);
  });
  app.post('/api/email/webhooks/resend', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const rawBody = typeof request.body === 'string' ? request.body : '';
    const valid = webhookSignatureValid(secret, {
      id: firstHeader(request.headers['svix-id']),
      timestamp: firstHeader(request.headers['svix-timestamp']),
      signature: firstHeader(request.headers['svix-signature']),
    }, rawBody);
    if (!valid) return sendError(reply, 401, 'unauthorized');
    try {
      applyResendEvent(JSON.parse(rawBody));
    } catch {
      return sendError(reply, 400, 'validation_failed');
    }
    return reply.code(200).send({ received: true });
  });
}

/** Only with Resend and a secret: otherwise this address does not exist. */
export async function emailWebhookRoutes(app: FastifyInstance): Promise<void> {
  const secret = config.email.resend.webhookSecret;
  if (config.email.transport !== 'resend' || !secret) return;
  await registerResendWebhook(app, secret);
}
