import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SPACE_CATEGORIES,
  canWithdrawDiscovery,
  isSpaceCategory,
  type DiscoveryStatus,
  type SpaceCategory,
  type SpaceReviewState,
} from '@backspace/shared/src/platform';
import { useSpaceStore, type TaggedSpace } from '../../../stores/spaceStore';
import { useReviewStore } from '../../../stores/reviewStore';
import { useUIStore } from '../../../stores/uiStore';
import { getApiForOrigin } from '../../../utils/crossStoreResolvers';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { spaceCategoryKey } from '../../../i18n/review';
import { Icon } from '../../ui/Icon';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { ListingPreview, ReviewHistory, ReviewStatusChip } from '../../review/ReviewParts';

type StatusTextKey =
  | 'spaces:listing.status.none'
  | 'spaces:listing.status.pending'
  | 'spaces:listing.status.changes_requested'
  | 'spaces:listing.status.approved'
  | 'spaces:listing.status.rejected'
  | 'spaces:listing.status.withdrawn';

function statusTextKey(status: DiscoveryStatus | null): StatusTextKey {
  return `spaces:listing.status.${status ?? 'none'}`;
}

interface Criterion {
  id: string;
  label: string;
  /** Met, not met, or one the reviewer judges (null). */
  met: boolean | null;
}

/**
 * A space's Discovery listing as its owner asks for it (docs/systems/admin.md,
 * "Discovery approval"): what the card would show, what the reviewers look
 * for, the category, and where the request stands. Visibility only says how
 * people join; a space is listed once an instance admin approved it, and an
 * edit of its name, description or pictures sends it back to review.
 */
export function DiscoveryListingSection({ space, isOwner }: { space: TaggedSpace; isOwner: boolean }) {
  const { t } = useTranslation(['spaces', 'common']);
  const f = useFormatters();
  const members = useSpaceStore((s) => s.members);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const revision = useReviewStore((s) => s.revisions[space.id] ?? 0);
  const addToast = useUIStore((s) => s.addToast);
  const origin = space._instanceOrigin ?? '';
  const categoryId = useId();

  const [state, setState] = useState<SpaceReviewState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [category, setCategory] = useState<SpaceCategory>('community');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmResubmit, setConfirmResubmit] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    setState(null);
    setLoadError('');
    getApiForOrigin(origin).review.get(space.id)
      .then((next) => { if (!cancelled) setState(next); })
      .catch((err: unknown) => { if (!cancelled) setLoadError(describeError(err)); });
    return () => { cancelled = true; };
  }, [space.id, origin, isOwner, revision]);

  const requestedCategory = state?.discovery.request?.category ?? null;
  useEffect(() => {
    if (requestedCategory && isSpaceCategory(requestedCategory)) setCategory(requestedCategory);
  }, [requestedCategory]);

  if (!isOwner) {
    return (
      <section className="surface-card rounded-lg p-4">
        <div className="label-mono mb-1">{t('spaces:listing.title')}</div>
        <p className="text-ui text-txt-secondary">{t('spaces:listing.ownerOnly')}</p>
      </section>
    );
  }

  const status = state?.discovery.status ?? null;
  const request = state?.discovery.request ?? null;
  const listable = space.visibility === 'public' || space.visibility === 'request';
  const hasDescription = (space.description ?? '').trim().length > 0;
  const criteria: Criterion[] = [
    { id: 'visibility', label: t('spaces:listing.criteria.visibility'), met: listable },
    { id: 'description', label: t('spaces:listing.criteria.description'), met: hasDescription },
    { id: 'icon', label: t('spaces:listing.criteria.icon'), met: Boolean(space.icon) },
    { id: 'honest', label: t('spaces:listing.criteria.honest'), met: null },
    { id: 'rules', label: t('spaces:listing.criteria.rules'), met: null },
  ];
  const canSubmit = state !== null && listable && hasDescription;
  const memberCount = currentSpaceId === space.id ? members.length : null;
  // A listed space is sent again only to change its category, which takes it
  // off Explore until it is approved again; nothing else needs a new request.
  const approved = status === 'approved';
  const offersSubmit = !approved || (request !== null && category !== request.category);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      setState(await getApiForOrigin(origin).review.requestDiscovery(space.id, { category }));
      addToast(t('spaces:listing.sent'), 'success', 2500);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setConfirmResubmit(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError('');
    try {
      setState(await getApiForOrigin(origin).review.withdrawDiscovery(space.id));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setConfirmWithdraw(false);
    }
  };

  return (
    <section className="space-y-3.5">
      <div>
        <div className="label-mono mb-1">{t('spaces:listing.title')}</div>
        <p className="text-meta text-txt-tertiary">{t('spaces:listing.intro')}</p>
      </div>

      {loadError && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{loadError}</div>}
      {!state && !loadError && <div className="flex h-20 items-center justify-center"><LoadingSpinner /></div>}

      {state && (
        <>
          <div className="surface-card rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-mono">{t('spaces:listing.statusLabel')}</span>
              <ReviewStatusChip process="discovery" status={status} />
            </div>
            <p className="mt-2 text-ui text-txt-secondary">{t(statusTextKey(status))}</p>
            {request?.decisionNote && (
              <div className="mt-2.5 rounded-md border border-border-soft px-3 py-2">
                <div className="label-mono mb-1">{t('spaces:listing.adminNote')}</div>
                <p className="whitespace-pre-wrap break-words text-ui text-txt-primary">{request.decisionNote}</p>
              </div>
            )}
            {request && (
              <p className="mt-2 font-mono text-label text-txt-tertiary">
                {t('spaces:listing.sentAt', { date: f.formatDateTime(request.requestedAt) })}
              </p>
            )}
          </div>

          <div className="grid gap-4 desktop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="field-label">{t('spaces:listing.preview')}</div>
              <ListingPreview
                spaceId={space.id}
                name={space.name}
                description={space.description ?? null}
                icon={space.icon}
                banner={space.banner ?? null}
                avatarColor={space.avatarColor ?? null}
                memberCount={memberCount}
                category={category}
                badges={space.badges ?? []}
              />
            </div>
            <div>
              <div className="field-label">{t('spaces:listing.criteria.title')}</div>
              <ul className="space-y-1.5">
                {criteria.map((criterion) => (
                  <li key={criterion.id} className="flex items-start gap-2 text-ui">
                    <span
                      aria-hidden="true"
                      className={`mt-[3px] flex-shrink-0 ${criterion.met === true ? 'text-accent-mint' : criterion.met === false ? 'text-accent-rose' : 'text-txt-tertiary'}`}
                    >
                      <Icon name={criterion.met === false ? 'x' : criterion.met === true ? 'check' : 'info'} size={14} />
                    </span>
                    <span className="text-txt-secondary">{criterion.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <label htmlFor={categoryId} className="field-label">{t('spaces:listing.category')}</label>
            <select
              id={categoryId}
              value={category}
              onChange={(e) => { if (isSpaceCategory(e.target.value)) setCategory(e.target.value); }}
              className="input-standard w-full max-w-xs"
            >
              {SPACE_CATEGORIES.map((entry) => <option key={entry} value={entry}>{t(spaceCategoryKey(entry))}</option>)}
            </select>
          </div>

          {!listable && <p className="text-meta text-txt-secondary">{t('spaces:listing.needsVisibility')}</p>}
          {listable && !hasDescription && <p className="text-meta text-txt-secondary">{t('spaces:listing.needsDescription')}</p>}
          {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}

          <div className="flex flex-wrap gap-2">
            {offersSubmit && (
              <button
                type="button"
                onClick={() => { if (approved) setConfirmResubmit(true); else void submit(); }}
                disabled={!canSubmit || busy}
                aria-busy={busy}
                className="btn-primary"
              >
                {busy
                  ? t('common:states.saving')
                  : status === null ? t('spaces:listing.send') : t('spaces:listing.sendAgain')}
              </button>
            )}
            {canWithdrawDiscovery(status) && (
              <button type="button" onClick={() => setConfirmWithdraw(true)} disabled={busy} className="btn-outline">
                {status === 'approved' ? t('spaces:listing.unlist') : t('spaces:listing.withdraw')}
              </button>
            )}
          </div>

          <div>
            <div className="label-mono mb-2">{t('common:review.history')}</div>
            <ReviewHistory events={state.discovery.history} />
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={confirmResubmit}
        onClose={() => setConfirmResubmit(false)}
        onConfirm={submit}
        title={t('spaces:listing.resubmitDialog.title')}
        description={t('spaces:listing.resubmitDialog.description')}
        confirmLabel={t('spaces:listing.sendAgain')}
        variant="warning"
        loading={busy}
      />
      <ConfirmDialog
        isOpen={confirmWithdraw}
        onClose={() => setConfirmWithdraw(false)}
        onConfirm={withdraw}
        title={t('spaces:listing.withdrawDialog.title')}
        description={t('spaces:listing.withdrawDialog.description')}
        confirmLabel={status === 'approved' ? t('spaces:listing.unlist') : t('spaces:listing.withdraw')}
        variant="warning"
        loading={busy}
      />
    </section>
  );
}
