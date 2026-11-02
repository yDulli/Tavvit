import type { TimeFormat } from '../utils/appearanceOptions';

/**
 * Every date, time, number and byte size the UI shows goes through here, so
 * that the locale is the language the user selected in settings rather than
 * whatever the browser happens to report. The consistency check fails any
 * direct `toLocale*` or `Intl.*` use elsewhere in the web package.
 *
 * Formatters are cached per locale and option set: constructing an `Intl`
 * formatter is expensive enough to matter in a message list.
 */
export interface Formatters {
  /** `2:05 PM` / `14:05` */
  formatTime: (timestamp: number) => string;
  /** `Mar 15` this year, `Dec 14, 2025` otherwise. */
  formatShortDate: (timestamp: number, now?: Date) => string;
  /** `March 15, 2026` */
  formatLongDate: (timestamp: number) => string;
  /** `Mar 15, 2026`: always carries the year, for "member since" and audit dates. */
  formatMediumDate: (timestamp: number) => string;
  /** `3/15/2026`: all numeric, for dense lists. */
  formatNumericDate: (timestamp: number) => string;
  /** `Sunday, March 15, 2026`: with the weekday, for day dividers. */
  formatFullDate: (timestamp: number) => string;
  /** `Mar 15, 2026, 2:05 PM` */
  formatDateTime: (timestamp: number) => string;
  /** `5 minutes ago`, `20 hours ago`, `in 3 days`: elapsed time in the largest whole unit that fits. */
  formatRelativeTime: (timestamp: number, now?: Date) => string;
  /** `today`, `yesterday`, `3 days ago`: the calendar day, so 11 pm and 1 am are a day apart. */
  formatRelativeDay: (timestamp: number, now?: Date) => string;
  formatNumber: (value: number) => string;
  /** A large number short, for an axis: 12K. */
  formatCompactNumber: (value: number) => string;
  /** `150%` / `150 %` from a whole-number percent such as a volume slider value. */
  formatPercent: (percent: number) => string;
  /** `1.5 kB`, `3 MB`; binary steps of 1024 with the conventional SI labels. */
  formatBytes: (bytes: number) => string;
  /** `05:08` / `2:05:08`: elapsed whole seconds with locale-native digits. */
  formatDuration: (elapsedSeconds: number) => string;
  /**
   * `30 seconds`, `5 minutes`, `6 hours`, `1 week`: a span of whole seconds in
   * the largest unit that divides it evenly, for settings such as slow mode
   * and timeout lengths. `short` gives `30 sec`, `narrow` gives `30s`.
   */
  formatInterval: (seconds: number, unitDisplay?: IntervalUnitDisplay) => string;
  /** `You, Mira, and 3 others` / `Du, Mira und 3 weitere`: an "and" list with the language's separators. */
  formatList: (items: readonly string[]) => string;
  /** `German`, in the language of the interface; the code itself when the browser has no name for it. */
  formatLanguageName: (code: string) => string;
}

type DateTimeOptions = Intl.DateTimeFormatOptions;

const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** How `formatInterval` writes its unit: `5 minutes`, `5 min` or `5m`. */
export type IntervalUnitDisplay = 'long' | 'short' | 'narrow';

/** The units `formatInterval` picks from, largest first, with their length in seconds. */
const INTERVAL_UNITS: ReadonlyArray<{ unit: 'week' | 'day' | 'hour' | 'minute'; seconds: number }> = [
  { unit: 'week', seconds: 7 * 24 * 60 * 60 },
  { unit: 'day', seconds: 24 * 60 * 60 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

export function createFormatters(getLocale: () => string, getClock: () => TimeFormat = () => 'auto'): Formatters {
  const dateCache = new Map<string, Intl.DateTimeFormat>();
  const numberCache = new Map<string, Intl.NumberFormat>();
  const relativeCache = new Map<string, Intl.RelativeTimeFormat>();
  const listCache = new Map<string, Intl.ListFormat>();

  function dateFormat(options: DateTimeOptions): Intl.DateTimeFormat {
    const locale = getLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let formatter = dateCache.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, options);
      dateCache.set(key, formatter);
    }
    return formatter;
  }

  /** The person's choice of a 12 or 24 hour clock, where they made one; otherwise the language's own convention. */
  function clock(): Pick<DateTimeOptions, 'hourCycle'> {
    const choice = getClock();
    if (choice === '12h') return { hourCycle: 'h12' };
    if (choice === '24h') return { hourCycle: 'h23' };
    return {};
  }

  function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const locale = getLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let formatter = numberCache.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, options);
      numberCache.set(key, formatter);
    }
    return formatter;
  }

  function relativeFormat(): Intl.RelativeTimeFormat {
    const locale = getLocale();
    let formatter = relativeCache.get(locale);
    if (!formatter) {
      formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      relativeCache.set(locale, formatter);
    }
    return formatter;
  }

  function listFormat(): Intl.ListFormat {
    const locale = getLocale();
    let formatter = listCache.get(locale);
    if (!formatter) {
      formatter = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
      listCache.set(locale, formatter);
    }
    return formatter;
  }

  return {
    formatTime: (timestamp) => dateFormat({ hour: 'numeric', minute: '2-digit', ...clock() }).format(timestamp),

    formatShortDate: (timestamp, now = new Date()) => {
      const sameYear = new Date(timestamp).getFullYear() === now.getFullYear();
      return dateFormat(
        sameYear
          ? { month: 'short', day: 'numeric' }
          : { month: 'short', day: 'numeric', year: 'numeric' },
      ).format(timestamp);
    },

    formatLongDate: (timestamp) => dateFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(timestamp),

    formatMediumDate: (timestamp) => dateFormat({ dateStyle: 'medium' }).format(timestamp),

    formatNumericDate: (timestamp) => dateFormat({ year: 'numeric', month: 'numeric', day: 'numeric' }).format(timestamp),

    formatFullDate: (timestamp) => dateFormat({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp),

    formatDateTime: (timestamp) => dateFormat({ dateStyle: 'medium', timeStyle: 'short', ...clock() }).format(timestamp),

    formatRelativeTime: (timestamp, now = new Date()) => {
      const delta = timestamp - now.getTime();
      const magnitude = Math.abs(delta);
      for (const { unit, ms } of RELATIVE_UNITS) {
        if (magnitude >= ms) {
          return relativeFormat().format(Math.round(delta / ms), unit);
        }
      }
      return relativeFormat().format(0, 'second');
    },

    formatRelativeDay: (timestamp, now = new Date()) => {
      const dayOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const days = Math.round((dayOf(new Date(timestamp)) - dayOf(now)) / (24 * 60 * 60 * 1000));
      return relativeFormat().format(days, 'day');
    },

    formatNumber: (value) => numberFormat({}).format(value),

    formatCompactNumber: (value) => numberFormat({ notation: 'compact', maximumFractionDigits: 1 }).format(value),

    formatPercent: (percent) => numberFormat({ style: 'percent', maximumFractionDigits: 0 }).format(percent / 100),

    formatBytes: (bytes) => {
      let value = Math.max(0, bytes);
      let index = 0;
      while (value >= 1024 && index < BYTE_UNITS.length - 1) {
        value /= 1024;
        index += 1;
      }
      return numberFormat({
        style: 'unit',
        unit: BYTE_UNITS[index],
        unitDisplay: 'short',
        maximumFractionDigits: index === 0 ? 0 : 1,
      }).format(value);
    },

    formatDuration: (elapsedSeconds) => {
      const total = Math.max(0, Math.floor(elapsedSeconds));
      const hours = Math.floor(total / 3_600);
      const minutes = Math.floor((total % 3_600) / 60);
      const seconds = total % 60;
      const segment = (value: number) => numberFormat({
        minimumIntegerDigits: 2,
        maximumFractionDigits: 0,
        useGrouping: false,
      }).format(value);
      const tail = `${segment(minutes)}:${segment(seconds)}`;
      return hours > 0
        ? `${numberFormat({ maximumFractionDigits: 0, useGrouping: false }).format(hours)}:${tail}`
        : tail;
    },

    formatInterval: (seconds, unitDisplay = 'long') => {
      const total = Math.max(0, Math.round(seconds));
      // A whole number of the largest unit that fits, so 90 seconds stays
      // `90 seconds` rather than turning into `1.5 minutes`.
      const fit = total > 0 ? INTERVAL_UNITS.find(({ seconds: length }) => total % length === 0) : undefined;
      const unit = fit?.unit ?? 'second';
      const value = fit ? total / fit.seconds : total;
      return numberFormat({ style: 'unit', unit, unitDisplay, maximumFractionDigits: 0 }).format(value);
    },

    formatList: (items) => listFormat().format(items),
    formatLanguageName: (code) => {
      try {
        return new Intl.DisplayNames([getLocale()], { type: 'language' }).of(code) ?? code;
      } catch {
        return code;
      }
    },
  };
}
