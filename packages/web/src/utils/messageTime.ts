/**
 * When a message's stamp also says its day. The divider over each day says the date, which is
 * enough for the last few days; in a long conversation from longer ago the divider is far up, so
 * from this many calendar days back each message's stamp carries its date beside its time.
 */
export const DATED_AFTER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `timestamp` to `now`, in the viewer's time zone: 23:00 and 01:00 are a day apart. */
export function calendarDaysAgo(timestamp: number, now: Date = new Date()): number {
  const dayOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Rounded, since a day with a clock change is 23 or 25 hours long.
  return Math.round((dayOf(now) - dayOf(new Date(timestamp))) / DAY_MS);
}

/** Whether a message's stamp carries its date (`DATED_AFTER_DAYS`). */
export function isDatedMessage(timestamp: number, now?: Date): boolean {
  return calendarDaysAgo(timestamp, now) >= DATED_AFTER_DAYS;
}
