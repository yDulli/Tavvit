import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { emailEnabled } from './service.js';

/** Since when new accounts need a confirmed address, or null while nobody does. */
export function emailRequiredSince(): number | null {
  if (!emailEnabled()) return null;
  return getDb().select({ since: schema.instanceSettings.emailRequiredSince }).from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get()?.since ?? null;
}

type GatedFields = {
  homeInstance: string | null;
  emailVerifiedAt: number | null;
  createdAt: number;
  isAdmin: number | null;
  accountKind?: string | null;
};

/**
 * Whether this account still has to confirm its address before it may do anything in a space
 * but read, approach strangers or create spaces (docs/systems/email.md, "The gate"). Accounts
 * older than the switch are not concerned: an upgrade must not take anything away from anyone.
 * Neither are replicated accounts, which have no address here, administrators, who must be able
 * to fix things, and accounts that are not people (bots, webhooks, follows), which have none.
 */
export function needsVerifiedEmail(user: GatedFields, since: number | null = emailRequiredSince()): boolean {
  if (user.homeInstance !== null || user.emailVerifiedAt !== null || user.isAdmin === 1) return false;
  if (user.accountKind !== undefined && user.accountKind !== null && user.accountKind !== 'person') return false;
  return since !== null && user.createdAt >= since;
}

/** `needsVerifiedEmail` by id. While the gate is off this asks the database nothing about the account. */
export function accountNeedsVerifiedEmail(userId: string): boolean {
  const since = emailRequiredSince();
  if (since === null) return false;
  const user = getDb().select({
    homeInstance: schema.users.homeInstance,
    emailVerifiedAt: schema.users.emailVerifiedAt,
    createdAt: schema.users.createdAt,
    isAdmin: schema.users.isAdmin,
    accountKind: schema.users.accountKind,
  }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return user !== undefined && needsVerifiedEmail(user, since);
}
