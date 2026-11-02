import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** How long the connection may be down before the banner appears; shorter blips are not worth a flash. */
export const CONNECTION_BANNER_GRACE_MS = 2500;

interface ConnectionBannerProps {
  /** The live connection to the server is open. */
  connected: boolean;
  graceMs?: number;
}

/**
 * A slim bar across the top of the app while the live connection to the server is
 * down: messages will not arrive and sending waits until it is back. It waits a
 * moment before appearing so that a reload or a brief network wobble does not
 * flash it, and it goes away the instant the connection returns.
 *
 * On the desktop it takes its own line above the top bar and moves the app down
 * by its height, so it never covers half of the tabs. On the phone, whose shell
 * fills the screen, it floats over the top edge.
 */
export function ConnectionBanner({ connected, graceMs = CONNECTION_BANNER_GRACE_MS }: ConnectionBannerProps) {
  const { t } = useTranslation('common');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), graceMs);
    return () => clearTimeout(timer);
  }, [connected, graceMs]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass fixed inset-x-0 top-0 z-[250] flex flex-shrink-0 items-center justify-center gap-2 border-x-0 border-t-0 border-b-accent-amber/30 px-3 py-1 text-meta font-medium text-accent-amber desktop:static desktop:z-auto desktop:bg-surface-base desktop:shadow-none"
      style={{ paddingTop: 'max(0.25rem, var(--safe-top))' }}
    >
      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-accent-amber" />
      {t('connection.lost')}
    </div>
  );
}
