/**
 * What a username may be, and how often it may change (docs/systems/auth.md, "Changing a
 * username"). The name someone signs in with and is found by, not the name they show.
 */
export const USERNAME_LIMITS = {
  MIN_LENGTH: 3,
  MAX_LENGTH: 32,
  /** How long one change holds before the next. */
  CHANGE_EVERY_DAYS: 30,
  /** How long a name given up stays out of reach, so nobody can pose as who had it. */
  HELD_DAYS: 30,
} as const;

const DAY_MS = 86_400_000;
const USERNAME = /^[a-z0-9_]+$/;

/** The name as it is stored. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isUsernameShape(name: string): boolean {
  return name.length >= USERNAME_LIMITS.MIN_LENGTH && name.length <= USERNAME_LIMITS.MAX_LENGTH && USERNAME.test(name);
}

/** From when an account may change its name again. Zero for one that never did. */
export function usernameChangeAllowedAt(changedAt: number | null | undefined): number {
  return changedAt ? changedAt + USERNAME_LIMITS.CHANGE_EVERY_DAYS * DAY_MS : 0;
}

/** Until when a name given up now stays out of reach. */
export function usernameHeldUntil(now: number): number {
  return now + USERNAME_LIMITS.HELD_DAYS * DAY_MS;
}
