import { useTranslation } from 'react-i18next';

/**
 * How much is unread in one place, as a badge.
 *
 * `accent` is for what is addressed to the viewer (a direct message, a
 * mention), `muted` for the traffic of a channel or a space, so the one accent
 * colour stays on what needs them. The number is the exact count when the
 * instance sends counts; without one (an older instance) a small neutral dot
 * says only that something is new: a dot with no count is never the signal
 * colour. The digits are drawn for sight and `label` is read instead, so a
 * screen reader hears "4 unread messages" rather than "4".
 */
export function UnreadBadge({ count, tone = 'accent', label }: {
  count: number | null;
  tone?: 'accent' | 'muted';
  /** What a screen reader hears; "N unread messages" (or "Unread") when left out. */
  label?: string;
}) {
  const { t } = useTranslation(['home', 'spaces']);
  if (count === null || count <= 0) {
    return (
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone === 'accent' ? 'bg-txt-primary' : 'bg-txt-secondary'}`} />
        <span className="sr-only">{label ?? t('home:unread.dot')}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-shrink-0">
      <span aria-hidden="true" className={tone === 'accent' ? 'count-badge' : 'count-badge count-badge-muted'}>
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only">{label ?? t('spaces:sidebar.space.unreadMessages', { count })}</span>
    </span>
  );
}
