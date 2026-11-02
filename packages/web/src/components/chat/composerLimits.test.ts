import { describe, expect, it } from 'vitest';
import { HttpError, RateLimitError } from '../../api/client';
import { activeTimeoutEnd, slowmodeRemainingMs, slowmodeRetryAfterSeconds } from './composerLimits';

const NOW = 1_000_000;

describe('slowmodeRemainingMs', () => {
  it('is nothing without a wait or with slow mode off', () => {
    expect(slowmodeRemainingMs(undefined, 30, NOW)).toBe(0);
    expect(slowmodeRemainingMs(NOW + 10_000, 0, NOW)).toBe(0);
  });

  it('counts down to the end of the wait and stops at zero', () => {
    expect(slowmodeRemainingMs(NOW + 25_000, 30, NOW)).toBe(25_000);
    expect(slowmodeRemainingMs(NOW - 1, 30, NOW)).toBe(0);
  });

  it('never waits longer than the current interval', () => {
    // The wait began under a one-hour interval that is now ten seconds.
    expect(slowmodeRemainingMs(NOW + 3_600_000, 10, NOW)).toBe(10_000);
  });
});

describe('slowmodeRetryAfterSeconds', () => {
  it('reads the seconds a slow-mode refusal names', () => {
    const refusal = new RateLimitError(60, { error: 'Slow mode', code: 'slowmode_active', details: { retryAfterSeconds: 12 } });
    expect(slowmodeRetryAfterSeconds(refusal)).toBe(12);
  });

  it('falls back to the rate limit retry time when the details say nothing', () => {
    expect(slowmodeRetryAfterSeconds(new RateLimitError(7, { error: 'Slow mode', code: 'slowmode_active' }))).toBe(7);
  });

  it('is null for any other failure', () => {
    expect(slowmodeRetryAfterSeconds(new RateLimitError(7, { error: 'Too many requests' }))).toBeNull();
    expect(slowmodeRetryAfterSeconds(new HttpError(403, 'Blocked', undefined, 'automod_blocked_word'))).toBeNull();
    expect(slowmodeRetryAfterSeconds(new Error('Offline'))).toBeNull();
  });
});

describe('activeTimeoutEnd', () => {
  it('is the end of a timeout still running', () => {
    expect(activeTimeoutEnd(NOW + 60_000, NOW)).toBe(NOW + 60_000);
  });

  it('is null for a timeout that is over, cleared or unknown', () => {
    expect(activeTimeoutEnd(NOW, NOW)).toBeNull();
    expect(activeTimeoutEnd(NOW - 5, NOW)).toBeNull();
    expect(activeTimeoutEnd(null, NOW)).toBeNull();
    expect(activeTimeoutEnd(undefined, NOW)).toBeNull();
  });
});
