import { HttpError, RateLimitError } from '../../api/client';

// The arithmetic of the composer's slow-mode wait and timeout notice, kept
// apart from the hook that reads the stores (`composerModeration.ts`).

/**
 * Milliseconds left of a slow-mode wait at `now`, never more than one whole
 * interval: in a channel whose interval was shortened since the wait began,
 * the member may post again by the new rule, which is how the instance counts
 * it too (from the last message, with the current interval).
 */
export function slowmodeRemainingMs(readyAt: number | undefined, intervalSeconds: number, now: number): number {
  if (readyAt === undefined || intervalSeconds <= 0) return 0;
  return Math.max(0, Math.min(readyAt - now, intervalSeconds * 1000));
}

/**
 * The seconds a `slowmode_active` refusal says to wait (`details.retryAfterSeconds`,
 * else the rate limit's own retry time), or null for any other failure.
 */
export function slowmodeRetryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof HttpError) || error.code !== 'slowmode_active') return null;
  const stated = Number(error.details?.retryAfterSeconds);
  if (Number.isFinite(stated) && stated > 0) return stated;
  return error instanceof RateLimitError && error.retryAfter > 0 ? error.retryAfter : null;
}

/** The end of a timeout at `now`, or null when there is none or it is over. */
export function activeTimeoutEnd(timedOutUntil: number | null | undefined, now: number): number | null {
  return typeof timedOutUntil === 'number' && timedOutUntil > now ? timedOutUntil : null;
}
