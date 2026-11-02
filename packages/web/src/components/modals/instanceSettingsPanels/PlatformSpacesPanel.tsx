import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSpaceFilter, AdminSpaceListResponse } from '@backspace/shared/src/platform';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { BadgeList } from '../../../badges/BadgeList';
import { Avatar } from '../../ui/Avatar';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { Icon } from '../../ui/Icon';
import { ReviewStatusChip } from '../../review/ReviewParts';
import { AdminSpaceDetailModal } from './AdminSpaceDetailModal';
import { AdminUserDetailModal } from './AdminUserDetailModal';

const PAGE_SIZE = 50;
const FILTERS: readonly AdminSpaceFilter[] = ['all', 'listed', 'verified', 'open_review'];

function isFilter(value: string): value is AdminSpaceFilter {
  return (FILTERS as readonly string[]).includes(value);
}

/**
 * Every space this instance hosts, for its admins (docs/systems/admin.md,
 * "Platform administration"): search by name or id, filter by listing,
 * verification or open review, and open one for its reviews, badges and
 * history. The admin area reads spaces without being a member of them.
 */
export function PlatformSpacesPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AdminSpaceFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminSpaceListResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openSpace, setOpenSpace] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async (q: string, which: AdminSpaceFilter, p: number) => {
    setLoading(true);
    setError('');
    try {
      setData(await api.admin.listSpaces({ q: q || undefined, filter: which, page: p, pageSize: PAGE_SIZE }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(debouncedQuery, filter, page); }, [load, debouncedQuery, filter, page]);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const changeQuery = (value: string) => {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setPage(1);
      setDebouncedQuery(value.trim());
    }, 300);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">{t('admin:platform.spaces.title')}</h2>
        <p className="mt-1 text-meta text-txt-tertiary">{t('admin:platform.spaces.description')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder={t('admin:platform.spaces.searchPlaceholder')}
          aria-label={t('admin:platform.spaces.searchPlaceholder')}
          className="input-search h-8 min-w-[200px] flex-1 py-0"
        />
        <select
          value={filter}
          onChange={(e) => { if (isFilter(e.target.value)) { setFilter(e.target.value); setPage(1); } }}
          aria-label={t('admin:platform.spaces.filterLabel')}
          className="input-search h-8 py-0 text-ui"
        >
          {FILTERS.map((entry) => <option key={entry} value={entry}>{t(`admin:platform.spaces.filters.${entry}`)}</option>)}
        </select>
      </div>

      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {loading && !data && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}

      {data && (data.spaces.length === 0 ? (
        <div className="surface-card rounded-lg">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Icon name="grid" size={18} /></span>
            <p className="empty-state-body">{t('admin:platform.spaces.empty')}</p>
          </div>
        </div>
      ) : (
        <ul className="surface-card divide-y divide-border-hard overflow-hidden rounded-lg">
          {data.spaces.map((space) => (
            <li key={space.id}>
              <button type="button" onClick={() => setOpenSpace(space.id)} className="list-row w-full rounded-none px-3 text-left">
                <Avatar src={space.icon} name={space.name} size={32} userId={space.id} avatarColor={space.avatarColor} palette="space" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-ui font-medium text-txt-primary">{space.name}</span>
                    <BadgeList badges={space.badges} size="sm" />
                  </div>
                  <div className="mt-0.5 truncate font-mono text-label text-txt-tertiary">
                    {space.owner ? `@${space.owner.username}` : t('admin:platform.spaces.ownerGone')}
                    {' · '}{t('admin:platform.spaces.members', { count: space.memberCount })}
                    {' · '}{f.formatMediumDate(space.createdAt)}
                  </div>
                </div>
                <div className="hidden flex-shrink-0 items-center gap-1.5 desktop:flex">
                  <ReviewStatusChip process="discovery" status={space.discoveryStatus} />
                  <ReviewStatusChip process="verification" status={space.verificationStatus} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      ))}

      {data && totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="btn-outline btn-sm">
            {t('common:actions.previous')}
          </button>
          <span className="font-mono text-label text-txt-tertiary">{t('admin:platform.spaces.page', { page, total: totalPages })}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="btn-outline btn-sm">
            {t('common:actions.next')}
          </button>
        </div>
      )}

      <AdminSpaceDetailModal
        spaceId={openSpace}
        onClose={() => setOpenSpace(null)}
        onChanged={() => void load(debouncedQuery, filter, page)}
        onOpenUser={(id) => { setOpenSpace(null); setOpenUser(id); }}
      />
      <AdminUserDetailModal userId={openUser} onClose={() => setOpenUser(null)} onChanged={() => void load(debouncedQuery, filter, page)} />
    </div>
  );
}
