import React from 'react';
import { useBump } from '../../hooks/useBump';

/** The figures a count is drawn with: the number itself up to 99, then "99+". */
export function countDigits(count: number): string {
  return count > 99 ? '99+' : String(count);
}

interface CountBadgeProps {
  count: number;
  /**
   * What a screen reader hears instead of the bare number ("12 unread
   * messages"). Leave it out where the control around the badge already says
   * the count in its own name.
   */
  label?: string;
  /** The neutral colour, for a place whose notifications are muted. */
  muted?: boolean;
  /**
   * `inline` runs in a line (a tab, a row); `corner` sits on the top-right
   * corner of an icon button or a tile, which must be `relative`, cut out from
   * it by a ring of the surface the bar or tile stands on.
   */
  placement?: 'inline' | 'corner';
}

/**
 * A count of unread messages or mentions, drawn as `.count-badge` (globals.css):
 * white figures on the signal colour, or `.count-badge-muted` for a muted place.
 * The number is for the eye; `label`, when given, is what assistive technology
 * reads, so the figures are hidden from it.
 */
export function CountBadge({ count, label, muted = false, placement = 'inline' }: CountBadgeProps): React.JSX.Element {
  const tone = muted ? 'count-badge count-badge-muted' : 'count-badge';
  const bumps = useBump(count);
  const figures = (
    <span
      key={bumps}
      aria-hidden={label ? true : undefined}
      className={`${placement === 'corner' ? `${tone} ring-2 ring-surface-base` : tone}${bumps > 0 ? ' bump' : ''}`}
    >
      {countDigits(count)}
    </span>
  );
  return (
    <span className={placement === 'corner' ? 'pointer-events-none absolute -right-1 -top-1 z-10 flex' : 'pointer-events-none inline-flex flex-shrink-0'}>
      {figures}
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
