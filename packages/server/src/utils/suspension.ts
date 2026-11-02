import { and, gt, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { ErrorDetails } from '@backspace/shared/src/errors.js';
import type { UserSuspension } from '@backspace/shared/src/platform.js';
import { schema } from '../db/index.js';

// Account suspensions (docs/systems/admin.md, "Suspensions"). An instance
// admin suspends an account here with a reason and an end, or until lifted;
// while it stands the account cannot sign in, call the API or hold a socket.
// Nothing about the account is deleted. A time-limited suspension ends by
// itself: every check compares its end with the clock, so nothing has to run
// when it passes.

export interface SuspensionColumns {
  suspendedAt: number | null;
  suspendedUntil: number | null;
  suspensionReason: string | null;
}

/** The suspension standing at `now`, or null. */
export function activeSuspension(row: SuspensionColumns, now: number = Date.now()): UserSuspension | null {
  if (row.suspendedAt === null) return null;
  if (row.suspendedUntil !== null && row.suspendedUntil <= now) return null;
  return { since: row.suspendedAt, until: row.suspendedUntil, reason: row.suspensionReason ?? '' };
}

/** The condition "suspended at `now`" on the users table. */
export function suspendedNow(now: number): SQL {
  return and(
    isNotNull(schema.users.suspendedAt),
    or(isNull(schema.users.suspendedUntil), gt(schema.users.suspendedUntil, now)),
  ) as SQL;
}

/**
 * What a refusal tells the suspended person: the reason, and the end when
 * there is one. Only the account's own sign-in, token or socket gets it; the
 * sign-in answers with it only after the password was right.
 */
export function suspensionDetails(suspension: UserSuspension): ErrorDetails {
  return suspension.until === null
    ? { reason: suspension.reason }
    : { reason: suspension.reason, until: suspension.until };
}
