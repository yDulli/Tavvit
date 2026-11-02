import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STARTER_SPACES_MAX, type AdminSearchSpace } from '@backspace/shared/src/adminConsole';
import type { AdminSpaceSummary } from '@backspace/shared/src/platform';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { iconSrc } from '../inbox/InboxPage';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { LoadingSpinner } from '../ui/LoadingSpinner';

/**
 * The public spaces a new account of this instance starts in, so that nobody's first look
 * is an empty app. It goes for accounts made from now on and moves nobody who is here.
 */
export function StarterSpacesSection() {
  const { t } = useTranslation('admin');
  const f = useFormatters();
  const [chosen, setChosen] = useState<AdminSearchSpace[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminSpaceSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setChosen((await api.admin.starterSpaces()).spaces);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const wanted = query.trim();
    if (!wanted) {
      setResults([]);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      api.admin.listSpaces({ q: wanted, visibility: 'public', pageSize: 8 })
        .then((page) => { if (!stale) setResults(page.spaces); })
        .catch((err: unknown) => { if (!stale) setError(describeError(err)); });
    }, 200);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const save = async (ids: string[]) => {
    setBusy(true);
    setError('');
    try {
      setChosen((await api.admin.setStarterSpaces(ids)).spaces);
      setQuery('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const ids = chosen?.map((space) => space.id) ?? [];
  const full = ids.length >= STARTER_SPACES_MAX;
  const offered = results.filter((space) => !ids.includes(space.id));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{t('console.sections.starter')}</h2>
        <p className="mt-1 max-w-[640px] text-meta leading-snug text-txt-tertiary">{t('console.starter.description')}</p>
      </div>
      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {!chosen && !error && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}

      {chosen && (
        <section aria-label={t('console.sections.starter')}>
          {chosen.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true"><Icon name="star" size={18} /></span>
              <p className="empty-state-title">{t('console.starter.emptyTitle')}</p>
              <p className="empty-state-body">{t('console.starter.emptyBody')}</p>
            </div>
          ) : (
            <ul className="surface-card divide-y divide-border-hard rounded-lg">
              {chosen.map((space) => (
                <li key={space.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar src={space.icon ? iconSrc(space.icon) : null} name={space.name} size={32} palette="space" userId={space.id} avatarColor={space.avatarColor} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui font-medium text-txt-primary">{space.name}</span>
                    <span className="block font-mono text-label text-txt-tertiary">{t('platform.spaces.members', { count: space.memberCount })}</span>
                    {space.visibility !== 'public' && <span className="mt-0.5 block text-meta text-txt-warning">{t('console.starter.notPublic')}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => void save(ids.filter((id) => id !== space.id))}
                    disabled={busy}
                    className="btn-quiet btn-sm flex-shrink-0"
                  >
                    {t('console.starter.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {chosen && (
        <section className="surface-card rounded-lg p-4" aria-label={t('console.starter.add')}>
          <label htmlFor="starter-space-search" className="field-label">{t('console.starter.add')}</label>
          <input
            id="starter-space-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={full}
            placeholder={full ? t('console.starter.full', { max: f.formatNumber(STARTER_SPACES_MAX) }) : t('console.starter.searchPlaceholder')}
            className="input-search w-full"
          />
          {query.trim() !== '' && offered.length === 0 && <p className="mt-2 text-meta text-txt-tertiary">{t('console.starter.noResults')}</p>}
          {offered.length > 0 && (
            <ul className="mt-2 space-y-px">
              {offered.map((space) => (
                <li key={space.id}>
                  <button type="button" onClick={() => void save([...ids, space.id])} disabled={busy} className="list-row w-full">
                    <Avatar src={space.icon ? iconSrc(space.icon) : null} name={space.name} size={28} palette="space" userId={space.id} avatarColor={space.avatarColor} />
                    <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{space.name}</span>
                    <Icon name="plus" size={14} className="flex-shrink-0 text-txt-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
