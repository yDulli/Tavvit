import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../ui/Icon';
import { useFormatters } from '../../../i18n/formatters';

/** setTimeout's ceiling; a later end is waited for in steps. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The hourglass beside a timed-out member's name in a member list, with the
 * end of the timeout as its title. Draws nothing for a member who is not
 * timed out, and goes away by itself when the timeout ends.
 */
export function MemberTimeoutIndicator({ timedOutUntil }: {
  /** `Member.timedOutUntil`: epoch ms of the hosting instance's clock, or none. */
  timedOutUntil: number | null | undefined;
}) {
  const { t } = useTranslation(['spaces']);
  const { formatTime, formatDateTime } = useFormatters();
  // Bumped when the timeout ends (or a capped timer step passes), to re-render.
  const [wake, setWake] = useState(0);
  const until = typeof timedOutUntil === 'number' ? timedOutUntil : null;

  useEffect(() => {
    if (until === null) return;
    const left = until - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setWake((n) => n + 1), Math.min(left + 50, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [until, wake]);

  const now = Date.now();
  if (until === null || until <= now) return null;
  const sameDay = new Date(until).toDateString() === new Date(now).toDateString();
  const label = t('spaces:members.timedOutUntil', { time: sameDay ? formatTime(until) : formatDateTime(until) });
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex flex-shrink-0 text-txt-tertiary">
      <Icon name="hourglass" size={13} />
    </span>
  );
}
