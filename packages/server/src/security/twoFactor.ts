/**
 * Two-factor authentication (docs/systems/auth.md, "Two-factor authentication").
 *
 * The secret is encrypted with AES-256-GCM under `TOTP_ENCRYPTION_KEY`, which is not in the
 * database, and bound to its account. Recovery codes are kept as keyed hashes, tickets as
 * hashes. Nothing here logs a secret, a code or a ticket.
 *
 * Without the key a server cannot offer 2FA, and an account that has it cannot pass it:
 * sign-in fails closed rather than skipping the step.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { base32Encode, generateTotpSecret, looksLikeTotpCode, matchTotp, otpauthUrl } from './totp.js';

const RECOVERY_CODE_COUNT = 10;
/** 16 base32 characters: 80 random bits, far beyond guessing, grouped so they can be typed. */
const RECOVERY_CODE_LENGTH = 16;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TICKET_LIFETIME_MS = 5 * 60_000;
const TICKET_ATTEMPTS = 5;
const TICKETS_PER_ACCOUNT = 5;

/** Free attempts on an account's second factor before each further one has to wait, doubling up to the cap. */
const FREE_ATTEMPTS = 5;
const FIRST_WAIT_MS = 60_000;
const LONGEST_WAIT_MS = 60 * 60_000;

/** The key from the configuration, or null. Missing only where a test replaces the configuration with part of it. */
function encryptionKey(): Buffer | null {
  const key: Buffer | null | undefined = config.twoFactorKey;
  return key ?? null;
}

let keyForTests: Buffer | null | undefined;

/** A key for tests, which cannot set the environment after the configuration was read. */
export function setTwoFactorKeyForTests(key: Buffer | null | undefined): void {
  keyForTests = key;
}

function activeKey(): Buffer | null {
  return keyForTests !== undefined ? keyForTests : encryptionKey();
}

export function twoFactorAvailable(): boolean {
  return activeKey() !== null;
}

function encryptSecret(userId: string, secret: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  // Bound to its account: a row copied onto another account does not decrypt.
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

function decryptSecret(userId: string, stored: string, key: Buffer): Buffer | null {
  const [version, iv, tag, body] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
  } catch {
    return null;
  }
}

function recoveryHash(userId: string, code: string, key: Buffer): string {
  const pepper = Buffer.from(hkdfSync('sha256', key, '', 'tavvit-recovery-codes', 32));
  return createHmac('sha256', pepper).update(`${userId}:${code}`).digest('hex');
}

/** As it is typed: any case, with or without dashes and spaces. */
function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

function newRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let code = '';
  // 32 symbols, so each byte's low five bits are uniform.
  for (const byte of bytes) code += RECOVERY_ALPHABET[byte & 31];
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/** Replaces every recovery code. Call it in the transaction that makes the change. The only time they exist in the clear. */
function issueRecoveryCodes(userId: string, key: Buffer, now: number): string[] {
  const db = getDb();
  db.delete(schema.twoFactorRecoveryCodes).where(eq(schema.twoFactorRecoveryCodes.userId, userId)).run();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  for (const code of codes) {
    db.insert(schema.twoFactorRecoveryCodes).values({
      codeHash: recoveryHash(userId, normalizeRecoveryCode(code), key),
      userId,
      createdAt: now,
    }).run();
  }
  return codes;
}

export function recoveryCodesLeft(userId: string): number {
  return getDb().select({ total: sql<number>`COUNT(*)` }).from(schema.twoFactorRecoveryCodes)
    .where(and(eq(schema.twoFactorRecoveryCodes.userId, userId), isNull(schema.twoFactorRecoveryCodes.usedAt))).get()?.total ?? 0;
}

/**
 * A new secret, not in force yet. Starting over replaces an earlier attempt. It is shown once,
 * and 2FA only comes on when a code made from it comes back.
 */
export function beginEnrollment(userId: string, username: string, now: number = Date.now()): { secret: string; otpauthUrl: string } | null {
  const key = activeKey();
  if (!key) return null;
  const db = getDb();
  const secret = generateTotpSecret();
  const issuer = db.select({ name: schema.instanceSettings.instanceName }).from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get()?.name ?? DEFAULT_INSTANCE_NAME;
  db.insert(schema.twoFactorSecrets)
    .values({ userId, secretEnc: encryptSecret(userId, secret, key), confirmedAt: null, lastUsedStep: null, failedAttempts: 0, lockedUntil: null, createdAt: now })
    .onConflictDoUpdate({
      target: schema.twoFactorSecrets.userId,
      set: { secretEnc: encryptSecret(userId, secret, key), confirmedAt: null, lastUsedStep: null, failedAttempts: 0, lockedUntil: null, createdAt: now },
    })
    .run();
  return { secret: base32Encode(secret), otpauthUrl: otpauthUrl({ issuer, account: username, secret }) };
}

/** Turns 2FA on when the code is right, and only then. Returns the recovery codes, which exist in the clear only now. */
export function completeEnrollment(userId: string, code: string, now: number = Date.now()): string[] | null {
  const key = activeKey();
  if (!key) return null;
  const db = getDb();
  return db.transaction(() => {
    const row = db.select().from(schema.twoFactorSecrets).where(eq(schema.twoFactorSecrets.userId, userId)).get();
    if (!row || row.confirmedAt !== null) return null;
    const secret = decryptSecret(userId, row.secretEnc, key);
    const step = secret ? matchTotp(secret, code, now, null) : null;
    if (step === null) return null;
    db.update(schema.twoFactorSecrets).set({ confirmedAt: now, lastUsedStep: step, failedAttempts: 0, lockedUntil: null })
      .where(eq(schema.twoFactorSecrets.userId, userId)).run();
    db.update(schema.users).set({ twoFactorEnabledAt: now }).where(eq(schema.users.id, userId)).run();
    return issueRecoveryCodes(userId, key, now);
  });
}

export type SecondFactorResult =
  | { ok: true; via: 'totp' | 'recovery' }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number }
  /** The server has lost its key. Nobody passes: that is the one failure that must not open anything. */
  | { ok: false; reason: 'unavailable' };

function wait(failures: number): number {
  return Math.min(FIRST_WAIT_MS * 2 ** (failures - FREE_ATTEMPTS), LONGEST_WAIT_MS);
}

/**
 * Checks a code from an authenticator app or a recovery code, whichever it looks like. Only
 * someone who already has the password gets this far, so a stranger cannot use the wait
 * against the account's owner, and it can be strict: it counts for the account, and survives
 * a new ticket and a restart.
 */
export function checkSecondFactor(userId: string, rawCode: string, now: number = Date.now()): SecondFactorResult {
  const key = activeKey();
  if (!key) return { ok: false, reason: 'unavailable' };
  const db = getDb();
  return db.transaction((): SecondFactorResult => {
    const row = db.select().from(schema.twoFactorSecrets).where(eq(schema.twoFactorSecrets.userId, userId)).get();
    if (!row || row.confirmedAt === null) return { ok: false, reason: 'unavailable' };
    if (row.lockedUntil !== null && row.lockedUntil > now) {
      return { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil((row.lockedUntil - now) / 1000) };
    }
    const code = rawCode.trim();
    let via: 'totp' | 'recovery' | null = null;
    if (looksLikeTotpCode(code)) {
      const secret = decryptSecret(userId, row.secretEnc, key);
      if (!secret) return { ok: false, reason: 'unavailable' };
      const step = matchTotp(secret, code, now, row.lastUsedStep);
      if (step !== null) {
        db.update(schema.twoFactorSecrets).set({ lastUsedStep: step }).where(eq(schema.twoFactorSecrets.userId, userId)).run();
        via = 'totp';
      }
    } else {
      // Spent in the same statement that finds it: a code cannot be used twice, however close together.
      const used = db.update(schema.twoFactorRecoveryCodes).set({ usedAt: now })
        .where(and(
          eq(schema.twoFactorRecoveryCodes.codeHash, recoveryHash(userId, normalizeRecoveryCode(code), key)),
          eq(schema.twoFactorRecoveryCodes.userId, userId),
          isNull(schema.twoFactorRecoveryCodes.usedAt),
        )).run();
      if (used.changes === 1) via = 'recovery';
    }
    if (via) {
      db.update(schema.twoFactorSecrets).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.twoFactorSecrets.userId, userId)).run();
      return { ok: true, via };
    }
    const failures = row.failedAttempts + 1;
    db.update(schema.twoFactorSecrets)
      .set({ failedAttempts: failures, lockedUntil: failures >= FREE_ATTEMPTS ? now + wait(failures) : null })
      .where(eq(schema.twoFactorSecrets.userId, userId)).run();
    return { ok: false, reason: 'invalid' };
  });
}

/** Replaces the recovery codes, for someone who proved it is them. */
export function regenerateRecoveryCodes(userId: string, now: number = Date.now()): string[] | null {
  const key = activeKey();
  if (!key) return null;
  return getDb().transaction(() => issueRecoveryCodes(userId, key, now));
}

/** 2FA is off and leaves nothing behind. Who may do this is the caller's question. */
export function removeTwoFactor(userId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.delete(schema.twoFactorSecrets).where(eq(schema.twoFactorSecrets.userId, userId)).run();
    db.delete(schema.twoFactorRecoveryCodes).where(eq(schema.twoFactorRecoveryCodes.userId, userId)).run();
    db.delete(schema.mfaTickets).where(eq(schema.mfaTickets.userId, userId)).run();
    db.update(schema.users).set({ twoFactorEnabledAt: null }).where(eq(schema.users.id, userId)).run();
  });
}

// ─── Tickets ───────────────────────────────────────────────────────────────

function hashTicket(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex');
}

/**
 * What the sign-in's first step hands back when a second is due. It is not a token: nothing
 * but `POST /auth/login/2fa` reads it, so a person who stopped here can reach nothing.
 */
export function issueMfaTicket(userId: string, deviceId: string | null, now: number = Date.now()): string {
  const ticket = randomBytes(32).toString('base64url');
  const db = getDb();
  db.delete(schema.mfaTickets).where(lt(schema.mfaTickets.expiresAt, now)).run();
  db.insert(schema.mfaTickets).values({ ticketHash: hashTicket(ticket), userId, deviceId, attempts: 0, createdAt: now, expiresAt: now + TICKET_LIFETIME_MS }).run();
  db.run(sql`DELETE FROM mfa_tickets WHERE user_id = ${userId} AND ticket_hash NOT IN (
    SELECT ticket_hash FROM mfa_tickets WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${TICKETS_PER_ACCOUNT})`);
  return ticket;
}

export function isMfaTicket(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function liveMfaTicket(ticket: string, now: number = Date.now()) {
  const row = getDb().select().from(schema.mfaTickets).where(eq(schema.mfaTickets.ticketHash, hashTicket(ticket))).get();
  return row && row.expiresAt > now && row.attempts < TICKET_ATTEMPTS ? row : null;
}

export function noteMfaTicketFailure(ticketHash: string): void {
  getDb().update(schema.mfaTickets).set({ attempts: sql`${schema.mfaTickets.attempts} + 1` }).where(eq(schema.mfaTickets.ticketHash, ticketHash)).run();
}

export function dropMfaTicket(ticketHash: string): void {
  getDb().delete(schema.mfaTickets).where(eq(schema.mfaTickets.ticketHash, ticketHash)).run();
}
