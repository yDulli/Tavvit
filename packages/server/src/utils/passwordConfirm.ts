import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { ErrorCode } from '@backspace/shared/src/errors.js';
import { getDb, schema } from '../db/index.js';
import { verifyPassword } from './auth.js';
import { sendError } from './httpErrors.js';
import { loginThrottle, loginThrottleDisabled, loginThrottleKey, loginWait } from './loginThrottle.js';
import { liveSessionIds } from './sessions.js';

/** What checking the current password came to: right, wrong, or not checked now because the account's checks are all in use. */
export type PasswordCheck = 'valid' | 'wrong' | 'busy';

/** The account as the route read it before asking: what the check compares with what holds once it is done. */
export interface CheckedAccount {
  id: string;
  username: string;
  passwordHash: string;
  twoFactorEnabledAt: number | null;
}

/**
 * Whether what the route read before the check still holds once it is done: the same password and
 * second factor, the account not deleted, and the session the request came with still open. The
 * check can wait long (utils/loginThrottle.ts), and the route goes on with what it read: a password
 * reset by mail, a second factor turned on or every session ended meanwhile must not be undone by a
 * request that was already waiting.
 */
function stillAsRead(user: CheckedAccount, sessionId: string | null | undefined): boolean {
  const current = getDb().select({
    passwordHash: schema.users.passwordHash,
    twoFactorEnabledAt: schema.users.twoFactorEnabledAt,
    isDeleted: schema.users.isDeleted,
  }).from(schema.users).where(eq(schema.users.id, user.id)).get();
  if (!current || current.isDeleted === 1) return false;
  if (current.passwordHash !== user.passwordHash || current.twoFactorEnabledAt !== user.twoFactorEnabledAt) return false;
  return !sessionId || liveSessionIds([sessionId]).has(sessionId);
}

/**
 * Whether `password` is the account's, for a route that asks for the current password before a
 * change (a new address, a new password, a second factor turned off, the account deleted). It is
 * held to what a sign-in is (utils/loginThrottle.ts): each wrong answer counts as a failed sign-in of
 * the account and the next waits as one does, and at most a few are checked at once, so a stolen
 * session cannot test guesses side by side from many addresses and keep the account for good. An
 * account that changed while the check ran (stillAsRead) answers `wrong`, counted neither way.
 */
export async function checkPassword(
  user: CheckedAccount,
  password: string,
  request: Pick<FastifyRequest, 'ip' | 'sessionId'>,
): Promise<PasswordCheck> {
  if (loginThrottleDisabled()) {
    const valid = await verifyPassword(password, user.passwordHash);
    return valid && stillAsRead(user, request.sessionId) ? 'valid' : 'wrong';
  }
  const key = loginThrottleKey(user.username);
  await loginWait.sleep(loginThrottle.waitFor(key, request.ip));
  if (!loginThrottle.enter(key)) return 'busy';
  try {
    const valid = await verifyPassword(password, user.passwordHash);
    if (!stillAsRead(user, request.sessionId)) return 'wrong';
    if (valid) loginThrottle.recordSuccess(key, request.ip);
    else loginThrottle.recordFailure(key, request.ip);
    return valid ? 'valid' : 'wrong';
  } finally {
    loginThrottle.leave(key);
  }
}

/** The answer to a check that did not pass: `wrong` with the route's own code, `busy` as a throttled sign-in is answered. */
export function refusePasswordCheck(
  reply: FastifyReply,
  check: Exclude<PasswordCheck, 'valid'>,
  wrong: ErrorCode = 'current_password_incorrect',
): FastifyReply {
  if (check === 'busy') {
    reply.header('Retry-After', '5');
    return sendError(reply, 429, 'login_throttled', { minutes: 1 });
  }
  return sendError(reply, 403, wrong);
}
