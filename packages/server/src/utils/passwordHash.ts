/**
 * How passwords are kept: Argon2id through Node's own `crypto.argon2` (24.7 and up), so
 * no native package. Accounts from before keep their bcrypt hash until their next login,
 * when `passwordNeedsRehash` says so and the login route replaces it.
 *
 * A stored value that is neither is not a password anyone can have: the marker on a
 * replicated row, a deleted account's random bytes. It verifies against nothing.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

interface Argon2Parameters {
  message: string | Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}

type Argon2 = (algorithm: 'argon2id', parameters: Argon2Parameters, callback: (error: Error | null, derived: Buffer) => void) => void;

/** `@types/node` has no declaration of it yet. */
const { argon2 } = crypto as unknown as { argon2: Argon2 };

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const LANES = 1;
/** What a stored hash may ask of this server, so a damaged row cannot exhaust its memory. */
const MAX_STORED_MEMORY_KIB = 1_048_576;
const MAX_STORED_PASSES = 16;

const STORED = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function derive(password: string, salt: Buffer, memory: number, passes: number, parallelism: number, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, parallelism, tagLength, memory, passes }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

const encode = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const { memoryKiB, passes } = config.passwordArgon2;
  const salt = crypto.randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, memoryKiB, passes, LANES, TAG_BYTES);
  return `$argon2id$v=19$m=${memoryKiB},t=${passes},p=${LANES}$${encode(salt)}$${encode(tag)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) return bcrypt.compare(password, stored);
  const match = STORED.exec(stored);
  if (!match) return false;
  const [memory, passes, parallelism] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (memory > MAX_STORED_MEMORY_KIB || passes > MAX_STORED_PASSES || parallelism > 16) return false;
  const expected = Buffer.from(match[5]!, 'base64');
  const tag = await derive(password, Buffer.from(match[4]!, 'base64'), memory, passes, parallelism, expected.length);
  return crypto.timingSafeEqual(tag, expected);
}

/** A hash from before, or made with other settings than this server uses now. */
export function passwordNeedsRehash(stored: string): boolean {
  const { memoryKiB, passes } = config.passwordArgon2;
  return !stored.startsWith(`$argon2id$v=19$m=${memoryKiB},t=${passes},p=${LANES}$`);
}
