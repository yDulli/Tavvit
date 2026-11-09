import { describe, expect, it } from 'vitest';
import { calendarDaysAgo, DATED_AFTER_DAYS, isDatedMessage } from './messageTime';

// From a few calendar days back a message's stamp carries its date: a long old conversation says
// when it was without scrolling up to its day's divider.

const now = new Date(2026, 10, 9, 10, 0);

describe('a message\'s stamp', () => {
  it('counts calendar days, so late last night is yesterday', () => {
    expect(calendarDaysAgo(new Date(2026, 10, 9, 0, 5).getTime(), now)).toBe(0);
    expect(calendarDaysAgo(new Date(2026, 10, 8, 23, 55).getTime(), now)).toBe(1);
    expect(calendarDaysAgo(new Date(2026, 9, 25, 12, 0).getTime(), now)).toBe(15);
  });

  it('carries the date from three days back, not before', () => {
    expect(DATED_AFTER_DAYS).toBe(3);
    expect(isDatedMessage(new Date(2026, 10, 7, 9, 0).getTime(), now)).toBe(false);
    expect(isDatedMessage(new Date(2026, 10, 6, 23, 59).getTime(), now)).toBe(true);
    expect(isDatedMessage(new Date(2025, 11, 14, 9, 30).getTime(), now)).toBe(true);
  });

  it('counts a day with a clock change as one day', () => {
    // Europe's clocks went back on 25 October 2026: that day had 25 hours wherever they did.
    const morning = new Date(2026, 9, 27, 8, 0);
    expect(calendarDaysAgo(new Date(2026, 9, 24, 8, 0).getTime(), morning)).toBe(3);
  });
});
