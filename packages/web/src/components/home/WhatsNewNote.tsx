import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { Icon } from '../ui/Icon';

const SEEN_KEY = 'tavvit-whats-new-seen';

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(version: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Without storage the note comes back next time, which is no harm.
  }
}

/**
 * One quiet line on the home page, once for each version that has something to say. Someone new
 * has nothing to catch up on, so a first visit only remembers where they started. It goes when it
 * is closed or followed.
 */
export function WhatsNewNote() {
  const { t } = useTranslation(['changelog']);
  const version = useHomeInstanceInfo()?.version ?? null;
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    if (version && seen === null) {
      writeSeen(version);
      setSeen(version);
    }
  }, [version, seen]);

  const entries = t('changelog:versions', { returnObjects: true }) as unknown as Record<string, { title: string }>;
  const entry = version ? entries[version] : undefined;
  if (!version || !entry || seen === null || seen === version) return null;

  const done = () => {
    writeSeen(version);
    setSeen(version);
  };

  return (
    <p className="mt-2 flex items-center gap-1.5 text-meta text-txt-tertiary">
      <a href="/changelog" target="_blank" rel="noopener noreferrer" onClick={done} className="min-w-0 truncate transition-colors hover:text-txt-secondary hover:underline">
        {t('changelog:note', { version, title: entry.title })}
      </a>
      <button type="button" onClick={done} aria-label={t('changelog:noteClose')} className="icon-btn flex-shrink-0">
        <Icon name="x" size={12} />
      </button>
    </p>
  );
}
