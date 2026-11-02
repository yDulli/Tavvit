/**
 * Whether every rate limit is off: the route plugin's, the sign-in throttle, the DM and upload
 * windows. Tests and local load runs set `DISABLE_RATE_LIMITS=1` (or `true`), because their
 * requests share one loopback address. A server in production (`NODE_ENV=production`, which the
 * Docker image sets) ignores it, so a setting copied from a test setup cannot take away the brakes
 * on guessing passwords; the boot log says so (`warnIgnoredRateLimitSwitch`). Read at every call,
 * never cached, since tests change it while they run.
 */
export function rateLimitsDisabled(): boolean {
  const value = process.env.DISABLE_RATE_LIMITS;
  if (value !== '1' && value !== 'true') return false;
  return process.env.NODE_ENV !== 'production';
}

/** A line in the boot log when the switch is set where it is ignored. */
export function warnIgnoredRateLimitSwitch(): void {
  const value = process.env.DISABLE_RATE_LIMITS;
  if ((value === '1' || value === 'true') && process.env.NODE_ENV === 'production') {
    console.warn('[security] DISABLE_RATE_LIMITS is set but ignored: rate limits stay on in production. Remove it from .env.');
  }
}
