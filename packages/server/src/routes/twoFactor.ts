import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { AuthResponse, SecurityOverview, TwoFactorSetupResponse } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { authenticate, issueSessionToken, verifyPassword } from '../utils/auth.js';
import { errorBody, sendError } from '../utils/httpErrors.js';
import { loginThrottle, loginThrottleKey } from '../utils/loginThrottle.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { endOtherSessions, listSessions } from '../utils/sessions.js';
import { activeSuspension, suspensionDetails } from '../utils/suspension.js';
import { connectionManager } from '../ws/handler.js';
import { listSecurityEvents, recordSecurityEvent } from '../security/events.js';
import { noteFailedSecondFactor, noteSecurityChange, noteSignIn } from '../security/notices.js';
import {
  beginEnrollment,
  checkSecondFactor,
  completeEnrollment,
  dropMfaTicket,
  isMfaTicket,
  liveMfaTicket,
  noteMfaTicketFailure,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
  removeTwoFactor,
  twoFactorAvailable,
} from '../security/twoFactor.js';

type UserRow = typeof schema.users.$inferSelect;

/** The longest anything typed as a code can be: a recovery code with its dashes, and some room. */
const CODE_MAX_LENGTH = 64;

function usableCode(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= CODE_MAX_LENGTH;
}

function sendLocked(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  reply.header('Retry-After', String(retryAfterSeconds));
  return reply.code(429).send({ ...errorBody(429, 'mfa_locked', { seconds: retryAfterSeconds }), retryAfter: retryAfterSeconds });
}

/**
 * The second factor for something sensitive, on an account that has one. Null means go on;
 * otherwise the refusal has been sent. Accounts without 2FA, replicated ones among them,
 * pass untouched, so the multi-instance paths keep working.
 */
export function refuseWithoutSecondFactor(user: UserRow, code: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply | null {
  if (user.twoFactorEnabledAt === null) return null;
  if (!usableCode(code)) return sendError(reply, 403, 'mfa_code_required');
  const result = checkSecondFactor(user.id, code);
  if (result.ok) {
    if (result.via === 'recovery') noteSecurityChange(user, 'recovery_used', 'recovery_used', request);
    return null;
  }
  if (result.reason === 'locked') return sendLocked(reply, result.retryAfterSeconds);
  if (result.reason === 'unavailable') return sendError(reply, 503, 'two_factor_unavailable');
  noteFailedSecondFactor(user, request);
  return sendError(reply, 403, 'mfa_code_invalid');
}

function selfUpdated(userId: string): void {
  const row = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (row) connectionManager.sendToUser(userId, { type: 'user_updated', user: sanitizeUser(row, true) });
}

export async function twoFactorRoutes(app: FastifyInstance): Promise<void> {
  // The sign-in's second step. Only the ticket from its first step gets here, so this route
  // needs no password; and nothing else accepts a ticket, so stopping before it reaches nothing.
  app.post<{ Body: { ticket?: unknown; code?: unknown } }>('/api/auth/login/2fa', {
    config: { rateLimit: { max: 15, timeWindow: '5 minutes', keyGenerator: (request: FastifyRequest) => request.ip } },
  }, async (request, reply) => {
    const { ticket, code } = request.body ?? {};
    if (!isMfaTicket(ticket)) return sendError(reply, 401, 'mfa_ticket_invalid');
    const row = liveMfaTicket(ticket);
    if (!row) return sendError(reply, 401, 'mfa_ticket_invalid');
    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, row.userId)).get();
    // The password this ticket was earned with may have changed since.
    if (!user || user.isDeleted === 1 || user.twoFactorEnabledAt === null || (user.passwordChangedAt ?? 0) > row.createdAt) {
      dropMfaTicket(row.ticketHash);
      return sendError(reply, 401, 'mfa_ticket_invalid');
    }
    if (!usableCode(code)) return sendError(reply, 400, 'mfa_code_invalid');

    const result = checkSecondFactor(user.id, code);
    if (!result.ok) {
      if (result.reason === 'unavailable') return sendError(reply, 503, 'two_factor_unavailable');
      if (result.reason === 'locked') return sendLocked(reply, result.retryAfterSeconds);
      noteMfaTicketFailure(row.ticketHash);
      noteFailedSecondFactor(user, request);
      return sendError(reply, 401, 'mfa_code_invalid');
    }
    dropMfaTicket(row.ticketHash);
    loginThrottle.recordSuccess(loginThrottleKey(user.username), request.ip);
    if (result.via === 'recovery') noteSecurityChange(user, 'recovery_used', 'recovery_used', request);

    const suspension = activeSuspension(user);
    if (suspension) return sendError(reply, 403, 'account_suspended', suspensionDetails(suspension));

    const { token } = issueSessionToken(user, request);
    noteSignIn(user, request, row.deviceId);
    const response: AuthResponse = { token, user: sanitizeUser(user, true) };
    return reply.code(200).send(response);
  });

  // ─── What the security tab shows ─────────────────────────────────────────

  app.get('/api/auth/security', { preHandler: authenticate }, async (request, reply) => {
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    const response: SecurityOverview = {
      twoFactor: {
        available: twoFactorAvailable(),
        enabled: user.twoFactorEnabledAt !== null,
        enabledAt: user.twoFactorEnabledAt,
        recoveryCodesLeft: user.twoFactorEnabledAt !== null ? recoveryCodesLeft(user.id) : 0,
      },
      passwordChangedAt: user.passwordChangedAt ?? null,
      sessionCount: listSessions(user.id, request.sessionId ?? null).length,
      events: listSecurityEvents(user.id),
    };
    return reply.code(200).send(response);
  });

  app.post('/api/auth/sessions/end-all', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    recordSecurityEvent(request.userId, 'sessions_ended', request);
    connectionManager.closeSessionSockets(new Set(endOtherSessions(request.userId, null)));
    return reply.code(200).send({ success: true });
  });

  // ─── Turning it on, off, and new recovery codes ──────────────────────────

  app.post<{ Body: { password?: unknown } }>('/api/auth/2fa/setup', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    // Its home instance is where a replicated account signs in, so that is where 2FA belongs.
    if (user.homeInstance !== null) return sendError(reply, 403, 'native_account_required');
    if (!twoFactorAvailable()) return sendError(reply, 503, 'two_factor_unavailable');
    if (user.twoFactorEnabledAt !== null) return sendError(reply, 409, 'two_factor_already_enabled');
    const password = request.body?.password;
    if (typeof password !== 'string' || !password) return sendError(reply, 400, 'password_required');
    if (!(await verifyPassword(password, user.passwordHash))) return sendError(reply, 403, 'current_password_incorrect');
    const enrollment = beginEnrollment(user.id, user.username);
    if (!enrollment) return sendError(reply, 503, 'two_factor_unavailable');
    const response: TwoFactorSetupResponse = enrollment;
    return reply.code(200).send(response);
  });

  app.post<{ Body: { code?: unknown } }>('/api/auth/2fa/enable', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    if (user.twoFactorEnabledAt !== null) return sendError(reply, 409, 'two_factor_already_enabled');
    const code = request.body?.code;
    if (!usableCode(code)) return sendError(reply, 400, 'mfa_code_invalid');
    const recoveryCodes = completeEnrollment(user.id, code.trim());
    if (!recoveryCodes) return sendError(reply, 400, 'mfa_code_invalid');
    // Any other device got in without this. It signs in again, now with the code.
    const ended = endOtherSessions(user.id, request.sessionId ?? null);
    connectionManager.closeSessionSockets(new Set(ended));
    noteSecurityChange(user, 'two_factor_on', 'two_factor_on', request);
    selfUpdated(user.id);
    return reply.code(200).send({ recoveryCodes });
  });

  app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/auth/2fa/disable', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    if (user.twoFactorEnabledAt === null) return reply.code(200).send({ success: true });
    const password = request.body?.password;
    if (typeof password !== 'string' || !password) return sendError(reply, 400, 'password_required');
    if (!(await verifyPassword(password, user.passwordHash))) return sendError(reply, 403, 'current_password_incorrect');
    const refused = refuseWithoutSecondFactor(user, request.body?.code, request, reply);
    if (refused) return refused;
    removeTwoFactor(user.id);
    noteSecurityChange(user, 'two_factor_off', 'two_factor_off', request);
    selfUpdated(user.id);
    return reply.code(200).send({ success: true });
  });

  app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/auth/2fa/recovery-codes', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    if (user.twoFactorEnabledAt === null) return sendError(reply, 409, 'two_factor_not_enabled');
    const password = request.body?.password;
    if (typeof password !== 'string' || !password) return sendError(reply, 400, 'password_required');
    if (!(await verifyPassword(password, user.passwordHash))) return sendError(reply, 403, 'current_password_incorrect');
    const refused = refuseWithoutSecondFactor(user, request.body?.code, request, reply);
    if (refused) return refused;
    const recoveryCodes = regenerateRecoveryCodes(user.id);
    if (!recoveryCodes) return sendError(reply, 503, 'two_factor_unavailable');
    noteSecurityChange(user, 'recovery_regenerated', 'recovery_regenerated', request);
    return reply.code(200).send({ recoveryCodes });
  });
}
