/**
 * The "clear after" choices of the custom status, and the minutes each one
 * stands for when the status is saved. The server counts the end from the save
 * (`customStatusExpiresInMinutes`, 1 to 10080) and clears the status itself.
 */

export const STATUS_EXPIRY_MIN_MINUTES = 1;
export const STATUS_EXPIRY_MAX_MINUTES = 7 * 24 * 60;

/**
 * - `keep`: leave the end the status already has (only offered while it has one)
 * - `never`: until the person changes it
 * - `today`: until the end of the local day
 */
export type StatusExpiryChoice = 'keep' | 'never' | '30' | '60' | '240' | 'today' | '10080';

export const STATUS_EXPIRY_CHOICES: readonly Exclude<StatusExpiryChoice, 'keep'>[] = [
  'never', '30', '60', '240', 'today', '10080',
];

function clamp(minutes: number): number {
  return Math.min(STATUS_EXPIRY_MAX_MINUTES, Math.max(STATUS_EXPIRY_MIN_MINUTES, Math.ceil(minutes)));
}

/** Whole minutes from `now` to the next local midnight, at least one. */
export function minutesUntilEndOfToday(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return clamp((midnight.getTime() - now.getTime()) / 60_000);
}

/** Whether a status end is still ahead. */
export function isFutureEnd(endsAt: number | null | undefined, now: number): endsAt is number {
  return typeof endsAt === 'number' && endsAt > now;
}

/**
 * The value for `customStatusExpiresInMinutes`: minutes to the end, or null
 * for "no end". `currentEndsAt` is the end the status has now, for `keep`.
 */
export function expiryMinutes(
  choice: StatusExpiryChoice,
  now: Date,
  currentEndsAt: number | null | undefined,
): number | null {
  switch (choice) {
    case 'never':
      return null;
    case 'today':
      return minutesUntilEndOfToday(now);
    case 'keep':
      return isFutureEnd(currentEndsAt, now.getTime()) ? clamp((currentEndsAt - now.getTime()) / 60_000) : null;
    default:
      return clamp(Number(choice));
  }
}

/** The choice to show for a status that has `endsAt` now. */
export function initialExpiryChoice(endsAt: number | null | undefined, now: number): StatusExpiryChoice {
  return isFutureEnd(endsAt, now) ? 'keep' : 'never';
}
