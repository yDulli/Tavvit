import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ADMIN_SEARCH_LIMITS, type AdminSearchResponse } from '@backspace/shared/src/adminConsole';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { iconSrc } from '../inbox/InboxPage';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

const DEBOUNCE_MS = 200;

/**
 * The console's one search: an account or a space by name, or an account by its whole
 * address or id. It opens what it finds in the same detail the lists open.
 */
export function AdminSearch({ onOpenUser, onOpenSpace }: {
  onOpenUser: (userId: string) => void;
  onOpenSpace: (spaceId: string) => void;
}) {
  const { t } = useTranslation('admin');
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminSearchResponse | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const wanted = query.trim();

  useEffect(() => {
    if (wanted.length < ADMIN_SEARCH_LIMITS.QUERY_MIN_LENGTH) {
      setResults(null);
      setError('');
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      api.admin.search(wanted)
        .then((response) => { if (!stale) { setResults(response); setError(''); } })
        .catch((err: unknown) => { if (!stale) setError(describeError(err)); });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [wanted]);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    setQuery('');
    action();
  };

  const nothing = results !== null && results.users.length === 0 && results.spaces.length === 0;

  return (
    <div
      ref={boxRef}
      className="relative w-full max-w-[420px]"
      onKeyDown={(event) => {
        // Only while there is a list to close: otherwise Escape is the dialog's.
        if (event.key === 'Escape' && open && (results !== null || error)) {
          setOpen(false);
          event.stopPropagation();
        }
      }}
    >
      <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-tertiary" />
      <input
        type="search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={t('console.search.placeholder')}
        aria-label={t('console.search.label')}
        className="input-search h-9 w-full !pl-8"
        spellCheck={false}
        autoComplete="off"
      />
      {open && (results !== null || error) && (
        <div className="glass animate-slide-up absolute inset-x-0 top-full z-30 mt-1.5 max-h-[calc(60*var(--app-vh))] overflow-y-auto rounded-lg p-1 scrollbar-thin">
          {error && <p role="alert" className="px-2.5 py-2 text-meta text-txt-danger">{error}</p>}
          {nothing && <p className="px-2.5 py-2 text-ui text-txt-tertiary">{t('console.search.nothing', { query: wanted })}</p>}
          {results && results.users.length > 0 && (
            <>
              <div className="label-mono px-2.5 pb-1 pt-2">{t('console.search.accounts')}</div>
              <ul>
                {results.users.map((user) => (
                  <li key={user.id}>
                    <button type="button" onClick={() => choose(() => onOpenUser(user.id))} className="list-row w-full py-1.5">
                      <Avatar src={user.avatar} name={user.displayName || user.username} size={28} userId={user.id} avatarColor={user.avatarColor} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui font-medium text-txt-primary">{user.displayName || user.username}</span>
                        <span className="block truncate font-mono text-label text-txt-tertiary">@{user.username}</span>
                      </span>
                      {user.suspended && <span className="flex-shrink-0 rounded bg-accent-rose/15 px-1.5 py-px text-label font-medium text-txt-danger">{t('platform.suspension.chip')}</span>}
                      {user.isAdmin && <span className="flex-shrink-0 rounded bg-accent-amber/15 px-1.5 py-px text-label font-medium text-accent-amber">{t('users.badge.admin')}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {results && results.spaces.length > 0 && (
            <>
              <div className="label-mono px-2.5 pb-1 pt-2">{t('console.search.spaces')}</div>
              <ul>
                {results.spaces.map((space) => (
                  <li key={space.id}>
                    <button type="button" onClick={() => choose(() => onOpenSpace(space.id))} className="list-row w-full py-1.5">
                      <Avatar src={space.icon ? iconSrc(space.icon) : null} name={space.name} size={28} palette="space" userId={space.id} avatarColor={space.avatarColor} />
                      <span className="min-w-0 flex-1 truncate text-ui font-medium text-txt-primary">{space.name}</span>
                      <span className="flex-shrink-0 font-mono text-label text-txt-tertiary">{t('platform.spaces.members', { count: space.memberCount })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
