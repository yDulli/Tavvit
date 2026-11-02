export const REMINDER_PRESETS = ['hour', 'threeHours', 'tomorrow', 'nextWeek'] as const;
export type ReminderPreset = (typeof REMINDER_PRESETS)[number];

const MORNING_HOUR = 9;

/** When a preset falls, on the person's own clock: the morning ones at nine. */
export function reminderMoment(preset: ReminderPreset, now: Date = new Date()): number {
  const at = new Date(now);
  switch (preset) {
    case 'hour':
      return now.getTime() + 3_600_000;
    case 'threeHours':
      return now.getTime() + 3 * 3_600_000;
    case 'tomorrow':
      at.setDate(at.getDate() + 1);
      at.setHours(MORNING_HOUR, 0, 0, 0);
      return at.getTime();
    case 'nextWeek':
      at.setDate(at.getDate() + 7);
      at.setHours(MORNING_HOUR, 0, 0, 0);
      return at.getTime();
  }
}
