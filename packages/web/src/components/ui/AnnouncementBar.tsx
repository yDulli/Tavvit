import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnnouncementTone } from '@backspace/shared/src/adminConsole';
import { useAnnouncementStore } from '../../stores/announcementStore';
import { Icon } from './Icon';

/** How often the bar looks whether something has run out. */
const CHECK_EVERY_MS = 60_000;

/** The bar's look for a tone; the console's preview shows the same. */
export function announcementClass(tone: AnnouncementTone): string {
  return tone === 'warning' ? 'announcement announcement-warning' : 'announcement';
}

/**
 * What the operator says to everyone signed in (the console's Announcements), above the app.
 * Words only, as plain text. Each can be put away on this device; the server tells every
 * connected client when the list changes.
 */
export function AnnouncementBar() {
  const { t } = useTranslation('common');
  const announcements = useAnnouncementStore((s) => s.announcements);
  const dismissed = useAnnouncementStore((s) => s.dismissed);
  const load = useAnnouncementStore((s) => s.load);
  const dismiss = useAnnouncementStore((s) => s.dismiss);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  const shown = announcements.filter((entry) => !dismissed.includes(entry.id) && (entry.endsAt === null || entry.endsAt > now));
  if (shown.length === 0) return null;

  return (
    <div className="flex-shrink-0">
      {shown.map((entry) => (
        <div key={entry.id} role="status" className={`${announcementClass(entry.tone)} animate-slide-down border-b border-border-hard`}>
          <Icon name={entry.tone === 'warning' ? 'alert' : 'info'} size={14} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{entry.body}</span>
          <button
            type="button"
            onClick={() => dismiss(entry.id)}
            aria-label={t('actions.dismiss')}
            title={t('actions.dismiss')}
            className="icon-btn h-6 w-6 flex-shrink-0 text-current hover:text-current"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
