/**
 * The small task a browser solves before an account is created (docs/systems/auth.md,
 * "Automatic sign-ups"): find a nonce so that SHA-256 of `salt:nonce` starts with this many
 * zero bits. It costs a person a moment and a script that does not run a browser its whole
 * attempt, sends nothing to anybody else, and the server only checks. Someone who sets out
 * to pay the price still can: rate limits, sign-up rules and confirmed addresses are for that.
 */

export const SIGNUP_CHALLENGE_LEVELS = ['off', 'normal', 'high'] as const;
export type SignupChallengeLevel = (typeof SIGNUP_CHALLENGE_LEVELS)[number];

/** Zero bits a solution must start with. Each one more doubles the work. */
export const SIGNUP_CHALLENGE_BITS: Record<Exclude<SignupChallengeLevel, 'off'>, number> = {
  normal: 16,
  high: 18,
};

export function isSignupChallengeLevel(value: unknown): value is SignupChallengeLevel {
  return typeof value === 'string' && (SIGNUP_CHALLENGE_LEVELS as readonly string[]).includes(value);
}

/** What `GET /api/auth/challenge` answers. `level: 'off'` asks for nothing. */
export type SignupChallengeResponse =
  | { level: 'off' }
  | { level: 'normal' | 'high'; salt: string; bits: number; signature: string };

/** What a registration carries: the task as it was given, and the answer. */
export interface SignupChallengeSolution {
  salt: string;
  bits: number;
  signature: string;
  nonce: string;
}

/** Whether a digest starts with `bits` zero bits. */
export function hasLeadingZeroBits(digest: Uint8Array, bits: number): boolean {
  let left = bits;
  for (const byte of digest) {
    if (left <= 0) return true;
    if (left >= 8) {
      if (byte !== 0) return false;
      left -= 8;
      continue;
    }
    return byte >> (8 - left) === 0;
  }
  return left <= 0;
}
