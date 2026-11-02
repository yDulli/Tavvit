import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { emailEnabled } from './service.js';

/** Since when new accounts need a confirmed address, or null while nobody does. */
export function emailRequiredSince(): number | null {
  if (!emailEnabled()) return null;
  return getDb().select({ since: schema.instanceSettings.emailRequiredSince }).from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get()?.since ?? null;
}

/**
 * Whether this account still has to confirm its address before it may approach strangers or
 * create spaces (docs/systems/email.md, "The gate"). Accounts older than the switch are not
 * concerned: an upgrade must not take anything away from anyone. Neither are replicated
 * accounts, which have no address here, and administrators, who must be able to fix things.
 */
export function needsVerifiedEmail(user: { homeInstance: string | null; emailVerifiedAt: number | null; createdAt: number; isAdmin: number | null }): boolean {
  if (user.homeInstance !== null || user.emailVerifiedAt !== null || user.isAdmin === 1) return false;
  const since = emailRequiredSince();
  return since !== null && user.createdAt >= since;
}

export function accountNeedsVerifiedEmail(userId: string): boolean {
  const user = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
  return user !== undefined && needsVerifiedEmail(user);
}
