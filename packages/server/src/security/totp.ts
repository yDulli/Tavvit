/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), on Node's own HMAC. There is little to it and no
 * dependency is worth adding for it; `totp.test.ts` holds it to the RFCs' test vectors.
 * Nothing here logs or keeps a code.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** A step either way: a phone's clock is rarely exact, and typing takes a moment. */
const DRIFT_STEPS = 1;
/** 160 bits, what RFC 4226 recommends and every authenticator app expects. */
const SECRET_BYTES = 20;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** RFC 4226: an HMAC of the counter, cut down to a few digits. `algorithm` is SHA-1 for what apps use; RFC 6238's vectors name others. */
export function hotp(secret: Buffer, counter: number, digits: number = DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const number = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 10 ** digits).padStart(digits, '0');
}

export function timeStep(now: number): number {
  return Math.floor(now / 1000 / PERIOD_SECONDS);
}

export function looksLikeTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/**
 * The step this code belongs to, or null. A step at or before `afterStep` does not count,
 * which is what keeps an accepted code from being used a second time. Every candidate is
 * compared, in constant time, so the answer's timing says nothing about which one matched.
 */
export function matchTotp(secret: Buffer, code: string, now: number, afterStep: number | null): number | null {
  if (!looksLikeTotpCode(code)) return null;
  const given = Buffer.from(code);
  const current = timeStep(now);
  let matched: number | null = null;
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(given, expected) && (afterStep === null || step > afterStep)) matched = step;
  }
  return matched;
}

/** What the QR code holds. Standard parameters, spelled out, because some apps ignore defaults. */
export function otpauthUrl(options: { issuer: string; account: string; secret: Buffer }): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
  const query = new URLSearchParams({
    secret: base32Encode(options.secret),
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
