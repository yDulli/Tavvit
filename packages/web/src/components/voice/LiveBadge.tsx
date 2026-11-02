import { useTranslation } from 'react-i18next';

/**
 * The mark of a live stream: a small red dot and white capitals on a dark chip.
 * The same chip on a sidebar row and over a moving picture, because a filled
 * colour would disappear over some videos and white on the accent rose is too
 * faint to read at this size.
 */
export function LiveBadge({ className = 'h-4' }: { className?: string }) {
  const { t } = useTranslation('voice');
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded bg-black/65 pl-1 pr-1.5 font-mono text-2xs font-medium uppercase leading-none tracking-wide text-white ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-txt-danger" />
      {t('badges.live')}
    </span>
  );
}
