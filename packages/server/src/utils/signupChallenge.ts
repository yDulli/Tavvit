import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  hasLeadingZeroBits,
  isSignupChallengeLevel,
  SIGNUP_CHALLENGE_BITS,
  type SignupChallengeLevel,
  type SignupChallengeResponse,
} from '@backspace/shared/src/signupChallenge.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';

const TTL_MS = 10 * 60_000;
const NONCE_MAX_LENGTH = 32;

/** Answered tasks, until they would have expired anyway: one task opens one attempt. */
const spent = new Map<string, number>();

const signatureOf = (salt: string, bits: number): string =>
  createHmac('sha256', config.jwtSecret).update(`signup-challenge:${salt}:${bits}`).digest('hex');

/** What this instance asks of a new account. A harness that turns the rate limits off turns this off with them. */
export function signupChallengeLevel(): SignupChallengeLevel {
  if (process.env.DISABLE_RATE_LIMITS === '1' || process.env.DISABLE_RATE_LIMITS === 'true') return 'off';
  const row = getDb().select({ level: schema.instanceSettings.signupChallenge }).from(schema.instanceSettings).get();
  return isSignupChallengeLevel(row?.level) ? row.level : 'off';
}

/** A new task at this level. Nothing is stored: the signature is what makes it this server's. */
export function createSignupChallenge(level: SignupChallengeLevel, now: number = Date.now()): SignupChallengeResponse {
  if (level === 'off') return { level };
  const bits = SIGNUP_CHALLENGE_BITS[level];
  const salt = `${now + TTL_MS}.${randomBytes(16).toString('hex')}`;
  return { level, salt, bits, signature: signatureOf(salt, bits) };
}

/**
 * Whether a registration's answer opens the door: a task this server gave, still in time, at
 * least as hard as this instance asks now, solved, and not used before. A task is spent by
 * being answered, whatever happens to the registration after it.
 */
export function acceptSignupChallenge(input: unknown, level: SignupChallengeLevel, now: number = Date.now()): boolean {
  if (level === 'off') return true;
  if (typeof input !== 'object' || input === null) return false;
  const { salt, bits, signature, nonce } = input as Record<string, unknown>;
  if (typeof salt !== 'string' || typeof bits !== 'number' || typeof signature !== 'string' || typeof nonce !== 'string') return false;
  if (nonce.length === 0 || nonce.length > NONCE_MAX_LENGTH || !Number.isInteger(bits)) return false;

  const expected = Buffer.from(signatureOf(salt, bits));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

  const expiresAt = Number(salt.split('.')[0]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  if (bits < SIGNUP_CHALLENGE_BITS[level]) return false;
  if (spent.has(salt)) return false;

  const digest = createHash('sha256').update(`${salt}:${nonce}`).digest();
  if (!hasLeadingZeroBits(digest, bits)) return false;

  for (const [key, until] of spent) {
    if (until <= now) spent.delete(key);
  }
  spent.set(salt, expiresAt);
  return true;
}
