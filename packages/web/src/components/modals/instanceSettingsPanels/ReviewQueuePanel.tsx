import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSpaceSummary, ReviewQueueResponse } from '@backspace/shared/src/platform';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { spaceCategoryKey } from '../../../i18n/review';
import { useReviewStore } from '../../../stores/reviewStore';
import { BadgeList } from '../../../badges/BadgeList';
import { Avatar } from '../../ui/Avatar';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { Icon } from '../../ui/Icon';
import { ReviewStatusChip } from '../../review/ReviewParts';
import { AdminSpaceDetailModal } from './AdminSpaceDetailModal';
import { AdminUserDetailModal } from './AdminUserDetailModal';

/**
 * The platform's review queue (docs/systems/admin.md, "Verification" and
 * "Discovery approval"): every open request, oldest first, with what the
 * reviewer needs at a glance. Opening one shows the whole request, the
 * listing preview, the history and the decisions, each with its reason.
 */
export function ReviewQueuePanel() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const queue = useReviewStore((s) => s.queue);
  const [data, setData] = useState<ReviewQueueResponse | null>(null);
  const [error, setError] = useState('');
  const [openSpace, setOpenSpace] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.admin.reviews());
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  // A request sent or decided anywhere moves the live count; the list follows.
  const queueKey = queue ? `${queue.verificationOpen}:${queue.discoveryOpen}` : '';
  useEffect(() => { void load(); }, [load, queueKey]);

  const spaceLine = (space: AdminSpaceSummary, extra: string) => (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-body font-medium text-txt-primary">{space.name}</span>
        <BadgeList badges={space.badges} size="sm" />
      </div>
      <div className="truncate font-mono text-label text-txt-tertiary">
        {space.owner ? `@${space.owner.username}` : t('admin:platform.spaces.ownerGone')} · {extra}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{t('admin:platform.reviews.title')}</h2>
        <p className="mt-1 text-meta text-txt-tertiary">{t('admin:platform.reviews.description')}</p>
      </div>

      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {!data && !error && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}

      {data && (
        <>
          <section>
            <div className="label-mono mb-2">{t('admin:platform.reviews.verification', { n: data.verification.length })}</div>
            {data.verification.length === 0 ? (
              <div className="surface-card rounded-lg">
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true"><Icon name="shield" size={18} /></span>
                  <p className="empty-state-body">{t('admin:platform.reviews.noVerification')}</p>
                </div>
              </div>
            ) : (
              <ul className="surface-card divide-y divide-border-hard overflow-hidden rounded-lg">
                {data.verification.map((item) => (
                  <li key={item.space.id}>
                    <button type="button" onClick={() => setOpenSpace(item.space.id)} className="list-row w-full rounded-none px-3 text-left">
                      <Avatar src={item.space.icon} name={item.space.name} size={32} userId={item.space.id} avatarColor={item.space.avatarColor} palette="space" />
                      {spaceLine(item.space, `${t(spaceCategoryKey(item.request.category))} · ${f.formatMediumDate(item.request.requestedAt)}`)}
                      <ReviewStatusChip process="verification" status={item.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="label-mono mb-2">{t('admin:platform.reviews.discovery', { n: data.discovery.length })}</div>
            {data.discovery.length === 0 ? (
              <div className="surface-card rounded-lg">
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true"><Icon name="compass" size={18} /></span>
                  <p className="empty-state-body">{t('admin:platform.reviews.noDiscovery')}</p>
                </div>
              </div>
            ) : (
              <ul className="surface-card divide-y divide-border-hard overflow-hidden rounded-lg">
                {data.discovery.map((item) => (
                  <li key={item.space.id}>
                    <button type="button" onClick={() => setOpenSpace(item.space.id)} className="list-row w-full items-start rounded-none px-3 text-left">
                      <Avatar src={item.space.icon} name={item.space.name} size={32} userId={item.space.id} avatarColor={item.space.avatarColor} palette="space" />
                      <div className="min-w-0 flex-1">
                        {spaceLine(item.space, `${t(spaceCategoryKey(item.request.category))} · ${f.formatMediumDate(item.request.requestedAt)}`)}
                        {item.description && <p className="mt-1 line-clamp-2 text-meta text-txt-secondary">{item.description}</p>}
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end gap-1">
                        <ReviewStatusChip process="discovery" status={item.status} />
                        <ReviewStatusChip process="verification" status={item.space.verificationStatus} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <AdminSpaceDetailModal
        spaceId={openSpace}
        onClose={() => setOpenSpace(null)}
        onChanged={() => void load()}
        onOpenUser={(id) => { setOpenSpace(null); setOpenUser(id); }}
      />
      <AdminUserDetailModal userId={openUser} onClose={() => setOpenUser(null)} onChanged={() => void load()} />
    </div>
  );
}
