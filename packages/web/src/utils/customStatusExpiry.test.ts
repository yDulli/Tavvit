import { describe, it, expect } from 'vitest';
import {
  STATUS_EXPIRY_MAX_MINUTES,
  expiryMinutes,
  initialExpiryChoice,
  minutesUntilEndOfToday,
} from './customStatusExpiry';

const at = (h: number, m: number, s = 0) => new Date(2026, 5, 10, h, m, s, 0);

describe('minutesUntilEndOfToday', () => {
  it('counts to the next local midnight', () => {
    expect(minutesUntilEndOfToday(at(12, 0))).toBe(12 * 60);
    expect(minutesUntilEndOfToday(at(23, 30))).toBe(30);
  });

  it('rounds a partial minute up and never goes below one minute', () => {
    expect(minutesUntilEndOfToday(at(23, 59, 30))).toBe(1);
    expect(minutesUntilEndOfToday(at(23, 59, 59))).toBe(1);
  });
});

describe('expiryMinutes', () => {
  const now = at(10, 0);

  it('maps the fixed choices to their minutes', () => {
    expect(expiryMinutes('30', now, null)).toBe(30);
    expect(expiryMinutes('60', now, null)).toBe(60);
    expect(expiryMinutes('240', now, null)).toBe(240);
    expect(expiryMinutes('10080', now, null)).toBe(STATUS_EXPIRY_MAX_MINUTES);
  });

  it('means no end for never', () => {
    expect(expiryMinutes('never', now, now.getTime() + 60_000)).toBeNull();
  });

  it('means the end of the day for today', () => {
    expect(expiryMinutes('today', now, null)).toBe(14 * 60);
  });

  it('keeps the current end as the minutes that remain, rounded up', () => {
    expect(expiryMinutes('keep', now, now.getTime() + 10 * 60_000 + 1)).toBe(11);
  });

  it('keeps nothing when the current end has passed or there is none', () => {
    expect(expiryMinutes('keep', now, now.getTime() - 1)).toBeNull();
    expect(expiryMinutes('keep', now, null)).toBeNull();
    expect(expiryMinutes('keep', now, undefined)).toBeNull();
  });

  it('never exceeds what the server accepts', () => {
    expect(expiryMinutes('keep', now, now.getTime() + 30 * 24 * 3_600_000)).toBe(STATUS_EXPIRY_MAX_MINUTES);
  });
});

describe('initialExpiryChoice', () => {
  it('offers to keep an end that is still ahead, otherwise never', () => {
    expect(initialExpiryChoice(2_000, 1_000)).toBe('keep');
    expect(initialExpiryChoice(1_000, 1_000)).toBe('never');
    expect(initialExpiryChoice(null, 1_000)).toBe('never');
    expect(initialExpiryChoice(undefined, 1_000)).toBe('never');
  });
});
