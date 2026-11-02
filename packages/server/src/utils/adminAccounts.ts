import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { AVATAR_COLORS } from '@backspace/shared';
import { PASSWORD_MIN_LENGTH } from '@backspace/shared/src/constants.js';
import { hashPassword } from './auth.js';
import { hashAddress } from '../email/address.js';
import { isWeakPassword } from './passwordPolicy.js';
import { generateSnowflake } from './snowflake.js';

/**
 * Account operations for the server operator, run from the command line
 * (`scripts/tavvit-admin.ts`) against the database file rather than through the
 * HTTP API.
 *
 * They exist because a private instance has no open registration: with it
 * closed and no account in the database, there is no administrator to mint an
 * invite, and leaving a "first visitor becomes admin" window open would let
 * anyone who found the URL first take the instance. The person with shell
 * access to the server is the owner, so the first administrator is made here.
 * The same tool recovers a forgotten admin password.
 *
 * These functions take the database handle as an argument so tests can run them
 * on an in-memory database. They never log, and never return a password hash.
 */

export const ACCOUNT_USERNAME_MIN = 3;
export const ACCOUNT_USERNAME_MAX = 32;
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

export type AccountOperationErrorCode =
  | 'username_invalid'
  | 'username_taken'
  | 'password_too_short'
  | 'password_too_common'
  | 'not_found'
  | 'not_local'
  | 'deleted'
  | 'two_factor_off';

/** A refusal with a stable code; `message` is written for the operator at the terminal. */
export class AccountOperationError extends Error {
  constructor(readonly code: AccountOperationErrorCode, message: string) {
    super(message);
    this.name = 'AccountOperationError';
  }
}

/** The username as the registration route stores it: trimmed, lowercased. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function assertUsername(username: string): void {
  if (
    username.length < ACCOUNT_USERNAME_MIN ||
    username.length > ACCOUNT_USERNAME_MAX ||
    !USERNAME_PATTERN.test(username)
  ) {
    throw new AccountOperationError(
      'username_invalid',
      `A username is ${ACCOUNT_USERNAME_MIN}-${ACCOUNT_USERNAME_MAX} characters: lowercase letters, digits and underscores only.`,
    );
  }
}

function assertPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AccountOperationError(
      'password_too_short',
      `A password needs at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (isWeakPassword(password)) {
    throw new AccountOperationError('password_too_common', 'That password is among the first anyone tries. Choose another, or use --generate.');
  }
}

/** A random 20-character password (120 bits), for `--generate`. Shown to the operator once. */
export function generatePassword(): string {
  return crypto.randomBytes(15).toString('base64url');
}

export interface CreateAccountInput {
  username: string;
  password: string;
  isAdmin: boolean;
  displayName?: string | null;
}

export interface AccountRef {
  id: string;
  username: string;
}

/** Create a local account. Refuses a username that is malformed or already used (deleted accounts free theirs). */
export async function createAccount(db: Database.Database, input: CreateAccountInput): Promise<AccountRef> {
  const username = normalizeUsername(input.username);
  assertUsername(username);
  assertPassword(input.password);

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new AccountOperationError('username_taken', `The username "${username}" is already taken.`);
  }

  const id = generateSnowflake();
  const passwordHash = await hashPassword(input.password);
  const avatarColor = AVATAR_COLORS[crypto.randomInt(0, AVATAR_COLORS.length)];
  const displayName = input.displayName?.trim() || null;

  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, is_admin, avatar_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, username, displayName, passwordHash, input.isAdmin ? 1 : 0, avatarColor, Date.now());

  return { id, username };
}

interface AccountRow {
  id: string;
  username: string;
  home_instance: string | null;
  is_deleted: number | null;
}

/**
 * Set a new password for a local account. Stamps `password_changed_at`, which is
 * what makes the server reject every token issued before now: whoever was signed
 * in with the old password is signed out on their next request.
 */
export async function resetAccountPassword(
  db: Database.Database,
  rawUsername: string,
  password: string,
): Promise<AccountRef> {
  const username = normalizeUsername(rawUsername);
  assertPassword(password);

  const row = db.prepare(
    "SELECT id, username, home_instance, is_deleted FROM users WHERE username = ? AND account_kind = 'person'",
  ).get(username) as AccountRow | undefined;
  if (!row) throw new AccountOperationError('not_found', `There is no account named "${username}".`);
  if (row.is_deleted === 1) throw new AccountOperationError('deleted', `The account "${username}" was deleted.`);
  if (row.home_instance !== null) {
    throw new AccountOperationError(
      'not_local',
      `"${username}" belongs to another instance, which holds its password. It cannot be reset here.`,
    );
  }

  const passwordHash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
    .run(passwordHash, Date.now(), row.id);
  // This runs in its own process: the server finds the sockets of these sessions at its
  // next check (ConnectionManager.revalidateSockets), within half a minute.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  return { id: row.id, username: row.username };
}

export interface AccountSummary {
  username: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: number;
}

/** Local, non-deleted accounts, administrators first and then oldest first. */
export function listLocalAccounts(db: Database.Database): AccountSummary[] {
  const rows = db.prepare(
    `SELECT username, display_name, is_admin, created_at FROM users
     WHERE home_instance IS NULL AND (is_deleted IS NULL OR is_deleted = 0)
     ORDER BY is_admin DESC, created_at ASC`,
  ).all() as Array<{ username: string; display_name: string | null; is_admin: number; created_at: number }>;
  return rows.map((r) => ({
    username: r.username,
    displayName: r.display_name,
    isAdmin: r.is_admin === 1,
    createdAt: r.created_at,
  }));
}

/**
 * Turns off 2FA for someone who lost their phone and their recovery codes. Only from the
 * server's shell: whoever is that can read the database anyway, while a stolen admin session
 * or a mailbox must not be a way around a second factor, so neither the admin area nor a reset
 * by mail does this. Every device has to sign in again, it goes on the account's activity
 * list, and the account's confirmed address hears, which the running server sends within
 * seconds. Prove who is asking first: this is the one way past the second factor.
 */
export function resetAccountTwoFactor(db: Database.Database, rawUsername: string): AccountRef {
  const username = normalizeUsername(rawUsername);
  const row = db.prepare(
    "SELECT id, username, home_instance, is_deleted, two_factor_enabled_at, email, email_verified_at, locale FROM users WHERE username = ? AND account_kind = 'person'",
  ).get(username) as (AccountRow & { two_factor_enabled_at: number | null; email: string | null; email_verified_at: number | null; locale: string | null }) | undefined;
  if (!row) throw new AccountOperationError('not_found', `There is no account named "${username}".`);
  if (row.is_deleted === 1) throw new AccountOperationError('deleted', `The account "${username}" was deleted.`);
  if (row.home_instance !== null) {
    throw new AccountOperationError('not_local', `"${username}" belongs to another instance, which holds its second factor. It cannot be reset here.`);
  }
  if (row.two_factor_enabled_at === null) throw new AccountOperationError('two_factor_off', `"${username}" does not have two-factor authentication on.`);

  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM two_factor_secrets WHERE user_id = ?').run(row.id);
    db.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(row.id);
    db.prepare('DELETE FROM mfa_tickets WHERE user_id = ?').run(row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    db.prepare('UPDATE users SET two_factor_enabled_at = NULL WHERE id = ?').run(row.id);
    db.prepare('INSERT INTO security_events (id, user_id, kind, count, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(crypto.randomUUID(), row.id, 'two_factor_reset', now);
    if (row.email && row.email_verified_at !== null) {
      db.prepare(`INSERT INTO email_outbox (id, kind, priority, user_id, to_address, to_hash, locale, params, next_attempt_at, expires_at, created_at)
        VALUES (?, 'two_factor_reset', 'critical', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), row.id, row.email, hashAddress(row.email), row.locale ?? 'en', JSON.stringify({ username: row.username }), now, now + 24 * 60 * 60_000, now);
    }
  })();
  return { id: row.id, username: row.username };
}
