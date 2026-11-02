import { describe, expect, it } from 'vitest';
import { reminderMoment } from './reminderTimes';

describe('reminderMoment', () => {
  const now = new Date(2026, 10, 30, 22, 15, 40);

  it('counts hours from now', () => {
    expect(reminderMoment('hour', now)).toBe(now.getTime() + 3_600_000);
    expect(reminderMoment('threeHours', now)).toBe(now.getTime() + 3 * 3_600_000);
  });

  it('falls at nine in the morning for the later ones, across a month\'s end', () => {
    expect(new Date(reminderMoment('tomorrow', now))).toEqual(new Date(2026, 11, 1, 9, 0, 0, 0));
    expect(new Date(reminderMoment('nextWeek', now))).toEqual(new Date(2026, 11, 7, 9, 0, 0, 0));
  });

  it('is always ahead, also just after midnight', () => {
    const early = new Date(2026, 10, 30, 0, 5);
    for (const preset of ['hour', 'threeHours', 'tomorrow', 'nextWeek'] as const) {
      expect(reminderMoment(preset, early)).toBeGreaterThan(early.getTime());
    }
  });
});
