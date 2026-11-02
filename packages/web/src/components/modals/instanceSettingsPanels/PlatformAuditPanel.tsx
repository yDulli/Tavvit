import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLATFORM_AUDIT_PAGE_SIZE, type PlatformAuditEntry, type PlatformAuditTargetType } from '@backspace/shared/src/platform';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { saveBlob } from '../../../utils/saveBlob';
import { Icon } from '../../ui/Icon';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { PlatformAuditList } from './PlatformAuditList';

type TargetFilter = 'all' | PlatformAuditTargetType;

function isTargetFilter(value: string): value is TargetFilter {
  return value === 'all' || value === 'user' || value === 'space' || value === 'instance';
}

/**
 * The platform audit log (docs/systems/admin.md, "Platform audit log"): every
 * suspension, review decision, badge, role change and instance setting an
 * admin made here, newest first, a page at a time.
 */
export function PlatformAuditPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const [filter, setFilter] = useState<TargetFilter>('all');
  const [entries, setEntries] = useState<PlatformAuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (target: TargetFilter, before?: string) => {
    setLoading(true);
    setError('');
    try {
      const page = await api.admin.audit({
        before,
        limit: PLATFORM_AUDIT_PAGE_SIZE,
        targetType: target === 'all' ? undefined : target,
      });
      setEntries((current) => (before ? [...current, ...page.entries] : page.entries));
      setHasMore(page.hasMore);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setEntries([]);
    void load(filter);
  }, [filter, load]);

  const last = entries[entries.length - 1];

  const exportAll = async () => {
    setExporting(true);
    setError('');
    try {
      saveBlob(await api.admin.exportAudit(), 'platform-audit.csv');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="page-title">{t('admin:platform.audit.title')}</h2>
          <p className="mt-1 text-meta text-txt-tertiary">{t('admin:platform.audit.description')}</p>
        </div>
        <button type="button" onClick={() => void exportAll()} disabled={exporting} aria-busy={exporting} className="btn-outline btn-sm flex-shrink-0">
          <Icon name="download" size={13} />
          {t('admin:console.export')}
        </button>
      </div>

      <select
        value={filter}
        onChange={(e) => { if (isTargetFilter(e.target.value)) setFilter(e.target.value); }}
        aria-label={t('admin:platform.audit.filterLabel')}
        className="input-search block h-8 w-fit py-0 text-ui"
      >
        <option value="all">{t('admin:platform.audit.filters.all')}</option>
        <option value="user">{t('admin:platform.audit.filters.user')}</option>
        <option value="space">{t('admin:platform.audit.filters.space')}</option>
        <option value="instance">{t('admin:platform.audit.filters.instance')}</option>
      </select>

      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {loading && entries.length === 0 ? (
        <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <PlatformAuditList entries={entries} />
      )}

      {hasMore && last && (
        <button type="button" onClick={() => void load(filter, last.id)} disabled={loading} aria-busy={loading} className="btn-outline btn-sm">
          {loading ? t('common:states.loading') : t('admin:platform.audit.more')}
        </button>
      )}
    </div>
  );
}
