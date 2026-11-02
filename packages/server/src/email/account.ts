/**
 * What happens to an account's address (docs/systems/email.md). Routes check who is asking;
 * this is what follows, each change in one transaction with the mail that reports it.
 */
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { AccountEmailStatus } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { maskEmail } from './address.js';
import { isMailLocale, type MailLocale } from './copy.js';
import { addressUndeliverable, dropLinks, emailEnabled, enqueueEmail, issueLink, mailDecision, takeLink, type MailDecision } from './service.js';

type UserRow = typeof schema.users.$inferSelect;

/** The language mail to this account is written in. What the account chose outranks what a request says. */
export function mailLocaleOf(user: { locale: string | null }, fallback?: unknown): MailLocale {
  if (isMailLocale(user.locale)) return user.locale;
  return isMailLocale(fallback) ? fallback : 'en';
}

export function accountEmailStatus(user: UserRow): AccountEmailStatus {
  const waiting = user.pendingEmail ?? (user.emailVerifiedAt === null ? user.email : null);
  const last = getDb().select({ status: schema.emailOutbox.status }).from(schema.emailOutbox)
    .where(and(eq(schema.emailOutbox.userId, user.id), sql`${schema.emailOutbox.kind} IN ('verify_email', 'change_email_confirm', 'address_in_use')`))
    .orderBy(sql`${schema.emailOutbox.createdAt} DESC`).limit(1).get();
  return {
    address: user.email,
    verified: user.emailVerifiedAt !== null,
    pendingAddress: user.pendingEmail,
    undeliverable: waiting !== null && addressUndeliverable(waiting),
    lastSend: (last?.status as AccountEmailStatus['lastSend'] | undefined) ?? null,
  };
}

function verifiedHolder(address: string, exceptUserId: string): boolean {
  return getDb().select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.email, address), isNotNull(schema.users.emailVerifiedAt), ne(schema.users.id, exceptUserId))).get() !== undefined;
}

/**
 * Sends the link that confirms `address` for this account, and replaces any earlier one. An
 * address someone else has confirmed gets a notice instead and no link. The person asking
 * sees no difference; whoever reads that mailbox learns what happened, and nobody else can.
 */
export function sendConfirmationLink(user: UserRow, address: string, kind: 'verify_email' | 'change_email_confirm', locale: MailLocale, now: number = Date.now()): MailDecision {
  return getDb().transaction(() => {
    if (verifiedHolder(address, user.id)) {
      return enqueueEmail({ kind: 'address_in_use', to: address, userId: user.id, locale }, now);
    }
    const decision = mailDecision(kind, address, now);
    if (decision !== 'ok') return decision;
    const linkNonce = issueLink(user.id, 'verify', address, now);
    return enqueueEmail({ kind, to: address, userId: user.id, locale, params: { username: user.username }, linkNonce }, now);
  });
}

/**
 * The address this account is asking for. With a confirmed one in place it waits as pending,
 * and the old address stays in force and hears about it. Without one it simply replaces
 * what was there, since nothing depended on that.
 */
export function requestAddressChange(user: UserRow, address: string, locale: MailLocale, now: number = Date.now()): void {
  const db = getDb();
  db.transaction(() => {
    const previous = user.emailVerifiedAt !== null ? user.email : null;
    db.update(schema.users)
      .set(previous !== null ? { pendingEmail: address, locale } : { email: address, pendingEmail: null, locale })
      .where(eq(schema.users.id, user.id)).run();
    sendConfirmationLink(user, address, previous !== null ? 'change_email_confirm' : 'verify_email', locale, now);
    if (previous !== null) {
      enqueueEmail({ kind: 'change_requested', to: previous, userId: user.id, locale, params: { username: user.username, newAddress: maskEmail(address) } }, now);
    }
  });
}

export function cancelPendingAddress(userId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.update(schema.users).set({ pendingEmail: null }).where(eq(schema.users.id, userId)).run();
    dropLinks(userId, ['verify']);
  });
}

/** The account no longer has an address. The one it had hears about it, if it was confirmed. */
export function removeAddress(user: UserRow, now: number = Date.now()): void {
  const db = getDb();
  db.transaction(() => {
    db.update(schema.users).set({ email: null, emailVerifiedAt: null, pendingEmail: null }).where(eq(schema.users.id, user.id)).run();
    dropLinks(user.id);
    if (user.email && user.emailVerifiedAt !== null) {
      enqueueEmail({ kind: 'email_removed', to: user.email, userId: null, locale: mailLocaleOf(user), params: { username: user.username } }, now);
    }
  });
}

export type VerifyOutcome =
  | { ok: true; user: UserRow; address: string; replaced: boolean }
  | { ok: false; code: 'email_token_invalid' | 'email_address_in_use' };

/**
 * Uses a confirmation link. Only using the link confirms anything; sending it never does. The
 * link names its account and address, so it cannot confirm anyone else's, and it stops
 * working when the account has since asked for another address.
 */
export function confirmAddress(token: string, now: number = Date.now()): VerifyOutcome {
  const db = getDb();
  return db.transaction((): VerifyOutcome => {
    const link = takeLink(token, 'verify', now);
    if (!link) return { ok: false, code: 'email_token_invalid' };
    const user = db.select().from(schema.users).where(eq(schema.users.id, link.userId)).get();
    if (!user || user.isDeleted === 1) return { ok: false, code: 'email_token_invalid' };
    if (user.pendingEmail !== link.address && user.email !== link.address) return { ok: false, code: 'email_token_invalid' };
    // Two accounts may wait on one address; the first to use its link gets it.
    if (verifiedHolder(link.address, user.id)) return { ok: false, code: 'email_address_in_use' };
    const previous = user.emailVerifiedAt !== null && user.email !== link.address ? user.email : null;
    db.update(schema.users).set({ email: link.address, emailVerifiedAt: now, pendingEmail: null }).where(eq(schema.users.id, user.id)).run();
    // A reset link went to the old address, and that one no longer speaks for the account.
    dropLinks(user.id, ['reset']);
    if (previous !== null) {
      enqueueEmail({ kind: 'email_changed', to: previous, userId: null, locale: mailLocaleOf(user), params: { username: user.username, newAddress: maskEmail(link.address) } }, now);
    }
    const updated = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    return updated ? { ok: true, user: updated, address: link.address, replaced: previous !== null } : { ok: false, code: 'email_token_invalid' };
  });
}

/** The reset link for whoever holds this address, if anyone does. No answer: nobody may learn which it was. */
export function sendPasswordReset(address: string, requestLocale: unknown, now: number = Date.now()): void {
  if (!emailEnabled()) return;
  const db = getDb();
  db.transaction(() => {
    const user = db.select().from(schema.users)
      .where(and(eq(schema.users.email, address), isNotNull(schema.users.emailVerifiedAt))).get();
    if (!user || user.isDeleted === 1 || user.homeInstance !== null) return;
    if (mailDecision('password_reset', address, now) !== 'ok') return;
    const linkNonce = issueLink(user.id, 'reset', address, now);
    enqueueEmail({ kind: 'password_reset', to: address, userId: user.id, locale: mailLocaleOf(user, requestLocale), params: { username: user.username }, linkNonce }, now);
  });
}

/** Tells a confirmed address that the password changed. Nothing for an account without one. */
export function notifyPasswordChanged(user: UserRow, now: number = Date.now()): void {
  if (!user.email || user.emailVerifiedAt === null) return;
  enqueueEmail({ kind: 'password_changed', to: user.email, userId: user.id, locale: mailLocaleOf(user), params: { username: user.username } }, now);
}
