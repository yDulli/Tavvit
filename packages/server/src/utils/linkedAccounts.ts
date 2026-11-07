/**
 * Linked accounts (docs/systems/linked-accounts.md): accounts elsewhere a person proved are theirs
 * by signing in there. Twitch is the one service so far (utils/twitchApi.ts).
 *
 * Linking takes two steps, each with the person's own session here:
 *
 * 1. Start: a random `state`, bound to the account that asked and good for ten minutes, goes to the
 *    service with the person. The service sends them back to `/linked-accounts/<provider>` with it
 *    and a code.
 * 2. Complete: that page hands both to this server with the session of whoever is signed in in that
 *    browser. Only a state this very account started is taken, and only then is the code exchanged.
 *
 * So nobody can link their own account elsewhere to someone else's account here by sending them a
 * link: the page that receives it completes for whoever is signed in there, and their session did
 * not start that state. The pending states live in memory; a restart ends them, and the person
 * starts again.
 */
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { LINKED_ACCOUNT_PROVIDERS, type LinkedAccountProvider, type LinkedAccountView, type ProfileLinkedAccount } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { announceProfileChange } from './profileBroadcast.js';
import { generateSnowflake } from './snowflake.js';

/** How long a person has to sign in at the service and come back. */
export const LINKING_TTL_MS = 10 * 60_000;
/** Pending states held at most; past it the oldest go. */
const MOST_PENDING = 10_000;

interface PendingLink {
  userId: string;
  provider: LinkedAccountProvider;
  expiresAt: number;
}

const pending = new Map<string, PendingLink>();

/** A new state for `userId` linking at `provider`; an earlier one of theirs for it ends. */
export function startLinking(userId: string, provider: LinkedAccountProvider, now = Date.now()): string {
  for (const [state, link] of pending) {
    if (link.expiresAt <= now || (link.userId === userId && link.provider === provider)) pending.delete(state);
  }
  while (pending.size >= MOST_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  const state = crypto.randomBytes(32).toString('base64url');
  pending.set(state, { userId, provider, expiresAt: now + LINKING_TTL_MS });
  return state;
}

/** `ok`: the state is one this account started, and is used up. */
export type LinkingCheck = 'ok' | 'expired' | 'other_account';

/**
 * Whether `state` is one `userId` started for `provider`. Taken, it is used up.
 * Presented by another account, it stays: whoever started it may still sign in
 * in that browser and complete it.
 */
export function takeLinking(state: unknown, userId: string, provider: LinkedAccountProvider, now = Date.now()): LinkingCheck {
  if (typeof state !== 'string') return 'expired';
  const link = pending.get(state);
  if (!link || link.expiresAt <= now || link.provider !== provider) {
    if (link && link.expiresAt <= now) pending.delete(state);
    return 'expired';
  }
  if (link.userId !== userId) return 'other_account';
  pending.delete(state);
  return 'ok';
}

type LinkedAccountRow = typeof schema.linkedAccounts.$inferSelect;

function viewOf(row: LinkedAccountRow): LinkedAccountView {
  return {
    provider: row.provider,
    login: row.login,
    name: row.displayName,
    showOnProfile: row.showOnProfile === 1,
    showLive: row.showLive === 1,
    linkedAt: row.createdAt,
  };
}

const ORDER = (row: { provider: LinkedAccountProvider }): number => LINKED_ACCOUNT_PROVIDERS.indexOf(row.provider);

/** A person's linked accounts, as their settings show them. */
export function listLinkedAccounts(userId: string): LinkedAccountView[] {
  return getDb().select().from(schema.linkedAccounts)
    .where(eq(schema.linkedAccounts.userId, userId))
    .all()
    .sort((a, b) => ORDER(a) - ORDER(b))
    .map(viewOf);
}

/** Who signed in at the service, as it named them. */
export interface LinkedIdentity {
  id: string;
  login: string;
  name: string;
}

/**
 * Link `identity` at `provider` to `userId`, or say it is linked to another
 * account here already. Linking another account at the same service replaces
 * the earlier one and keeps the person's choices about showing it.
 */
export function linkAccount(userId: string, provider: LinkedAccountProvider, identity: LinkedIdentity, now = Date.now()): 'linked' | 'taken' {
  return getDb().transaction((tx) => {
    const holder = tx.select({ userId: schema.linkedAccounts.userId }).from(schema.linkedAccounts)
      .where(and(eq(schema.linkedAccounts.provider, provider), eq(schema.linkedAccounts.providerUserId, identity.id)))
      .get();
    if (holder && holder.userId !== userId) return 'taken';
    const existing = tx.select().from(schema.linkedAccounts)
      .where(and(eq(schema.linkedAccounts.userId, userId), eq(schema.linkedAccounts.provider, provider)))
      .get();
    if (existing) {
      tx.update(schema.linkedAccounts).set({
        providerUserId: identity.id,
        login: identity.login,
        displayName: identity.name,
        // Another account at the service is a new link; the same one keeps its date.
        ...(existing.providerUserId !== identity.id ? { createdAt: now } : {}),
        updatedAt: now,
      }).where(eq(schema.linkedAccounts.id, existing.id)).run();
    } else {
      tx.insert(schema.linkedAccounts).values({
        id: generateSnowflake(),
        userId,
        provider,
        providerUserId: identity.id,
        login: identity.login,
        displayName: identity.name,
        showOnProfile: 1,
        showLive: 1,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    return 'linked';
  });
}

/** Change what a linked account shows. False when nothing is linked there. */
export function updateLinkedAccount(
  userId: string,
  provider: LinkedAccountProvider,
  change: { showOnProfile?: boolean; showLive?: boolean },
  now = Date.now(),
): boolean {
  const set: Partial<LinkedAccountRow> = { updatedAt: now };
  if (change.showOnProfile !== undefined) set.showOnProfile = change.showOnProfile ? 1 : 0;
  if (change.showLive !== undefined) set.showLive = change.showLive ? 1 : 0;
  const result = getDb().update(schema.linkedAccounts).set(set)
    .where(and(eq(schema.linkedAccounts.userId, userId), eq(schema.linkedAccounts.provider, provider)))
    .run();
  return result.changes > 0;
}

/** Unlink the account at `provider`. False when nothing was linked there. */
export function unlinkAccount(userId: string, provider: LinkedAccountProvider): boolean {
  const result = getDb().delete(schema.linkedAccounts)
    .where(and(eq(schema.linkedAccounts.userId, userId), eq(schema.linkedAccounts.provider, provider)))
    .run();
  return result.changes > 0;
}

/** What the profile shows of a person's linked accounts, from their rows. */
function profileLinkedAccountsOf(userId: string): ProfileLinkedAccount[] {
  return listLinkedAccounts(userId)
    .filter((account) => account.showOnProfile)
    .map(({ provider, login, name }) => ({ provider, login, name }));
}

/** Write `users.profile_linked_accounts` from the rows. Whether it changed. */
export function writeProfileLinkedAccounts(userId: string): boolean {
  const db = getDb();
  const shown = profileLinkedAccountsOf(userId);
  const next = shown.length > 0 ? JSON.stringify(shown) : null;
  const row = db.select({ stored: schema.users.profileLinkedAccounts }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!row || (row.stored ?? null) === next) return false;
  db.update(schema.users).set({ profileLinkedAccounts: next }).where(eq(schema.users.id, userId)).run();
  return true;
}

/**
 * After any change to a person's linked accounts: the profile is written
 * again, everyone who sees it gets its new look when that changed, and the
 * person's own windows get the new list, on this device or another (the
 * settings of the desktop app when the link was made in a browser).
 */
export function announceLinkedAccounts(userId: string): void {
  if (writeProfileLinkedAccounts(userId)) {
    const row = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (row) announceProfileChange(row);
  }
  connectionManager.sendToUser(userId, { type: 'linked_accounts_update', accounts: listLinkedAccounts(userId) });
}

/**
 * The service named a linked account anew (Twitch: in an answer about a live
 * stream, after a rename there). The row and the profile follow.
 */
export function noteLinkedAccountName(provider: LinkedAccountProvider, providerUserId: string, login: string, name: string, now = Date.now()): void {
  const db = getDb();
  const row = db.select().from(schema.linkedAccounts)
    .where(and(eq(schema.linkedAccounts.provider, provider), eq(schema.linkedAccounts.providerUserId, providerUserId)))
    .get();
  if (!row || (row.login === login && row.displayName === name)) return;
  db.update(schema.linkedAccounts).set({ login, displayName: name, updatedAt: now }).where(eq(schema.linkedAccounts.id, row.id)).run();
  announceLinkedAccounts(row.userId);
}

/** Forget every pending state (tests). */
export function resetLinking(): void {
  pending.clear();
}
