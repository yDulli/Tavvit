import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  REVIEW_LIMITS,
  SPACE_CATEGORIES,
  canRequestVerification,
  canWithdrawVerification,
  isSpaceCategory,
  type SpaceCategory,
  type SpaceReviewState,
  type VerificationStatus,
} from '@backspace/shared/src/platform';
import { useSpaceStore } from '../../../stores/spaceStore';
import { useReviewStore } from '../../../stores/reviewStore';
import { useUIStore } from '../../../stores/uiStore';
import { getApiForOrigin } from '../../../utils/crossStoreResolvers';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { spaceCategoryKey } from '../../../i18n/review';
import { useIsSpaceOwner } from '../../../hooks/useIsSpaceOwner';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { ReviewHistory, ReviewStatusChip } from '../../review/ReviewParts';

/** A public address as the instance takes it: http or https, nothing else. */
function isPublicUrl(value: string): boolean {
  if (value.length === 0 || value.length > REVIEW_LIMITS.URL_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The sentence under the status: what it means for the owner, and what they can do now. */
type StatusTextKey =
  | 'spaces:verification.status.none'
  | 'spaces:verification.status.pending'
  | 'spaces:verification.status.needs_info'
  | 'spaces:verification.status.verified'
  | 'spaces:verification.status.rejected'
  | 'spaces:verification.status.revoked';

function statusTextKey(status: VerificationStatus | null): StatusTextKey {
  return `spaces:verification.status.${status ?? 'none'}`;
}

/**
 * A space owner's verification (docs/systems/admin.md, "Verification"): where
 * it stands, the request with what an admin can check, and its history. Only
 * the owner sees this tab; the instance that hosts the space decides, through
 * its administrators, and the owner hears of each step here and as a notice.
 */
export function VerificationPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const f = useFormatters();
  const space = useSpaceStore((s) => s.spaces.find((sp) => sp.id === spaceId));
  const isOwner = useIsSpaceOwner(spaceId);
  const revision = useReviewStore((s) => s.revisions[spaceId] ?? 0);
  const addToast = useUIStore((s) => s.addToast);
  const origin = space?._instanceOrigin ?? '';
  const formId = useId();

  const [state, setState] = useState<SpaceReviewState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [category, setCategory] = useState<SpaceCategory>('community');
  const [website, setWebsite] = useState('');
  const [profiles, setProfiles] = useState<string[]>(['']);
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    setState(null);
    setLoadError('');
    getApiForOrigin(origin).review.get(spaceId)
      .then((next) => { if (!cancelled) setState(next); })
      .catch((err: unknown) => { if (!cancelled) setLoadError(describeError(err)); });
    return () => { cancelled = true; };
  }, [spaceId, origin, isOwner, revision]);

  // A request sent before seeds the form, so sending it again starts from it.
  const request = state?.verification.request ?? null;
  const requestedAt = request?.requestedAt ?? null;
  useEffect(() => {
    if (!request) return;
    setCategory(isSpaceCategory(request.category) ? request.category : 'community');
    setWebsite(request.website ?? '');
    setProfiles(request.profiles.length > 0 ? request.profiles : ['']);
    setReason(request.reason);
    setProof(request.proof);
    // Seeded once per request the server holds, not on every reload of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedAt]);

  if (!space) return null;
  if (!isOwner) {
    return (
      <div className="space-y-3">
        <h2 className="page-title">{t('spaces:verification.title')}</h2>
        <p className="text-ui text-txt-secondary">{t('spaces:verification.ownerOnly')}</p>
      </div>
    );
  }

  const status = state?.verification.status ?? null;
  const filledProfiles = profiles.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const websiteValid = website.trim().length === 0 || isPublicUrl(website.trim());
  const profilesValid = filledProfiles.every(isPublicUrl);
  const reasonValid = reason.trim().length >= REVIEW_LIMITS.REASON_MIN_LENGTH && reason.trim().length <= REVIEW_LIMITS.REASON_MAX_LENGTH;
  const proofValid = proof.trim().length >= REVIEW_LIMITS.PROOF_MIN_LENGTH && proof.trim().length <= REVIEW_LIMITS.PROOF_MAX_LENGTH;
  const formValid = websiteValid && profilesValid && reasonValid && proofValid;
  const mayRequest = state !== null && canRequestVerification(status);

  const submit = async () => {
    if (!formValid || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await getApiForOrigin(origin).review.requestVerification(spaceId, {
        category,
        website: website.trim() || null,
        profiles: filledProfiles,
        reason: reason.trim(),
        proof: proof.trim(),
      });
      setState(next);
      addToast(t('spaces:verification.sent'), 'success', 2500);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError('');
    try {
      setState(await getApiForOrigin(origin).review.withdrawVerification(spaceId));
      setConfirmWithdraw(false);
    } catch (err) {
      setError(describeError(err));
      setConfirmWithdraw(false);
    } finally {
      setBusy(false);
    }
  };

  const setProfile = (index: number, value: string) => {
    setProfiles((current) => current.map((entry, i) => (i === index ? value : entry)));
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{t('spaces:verification.title')}</h2>
        <p className="mt-1 text-meta text-txt-tertiary">{t('spaces:verification.intro')}</p>
      </div>

      {loadError && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{loadError}</div>}
      {!state && !loadError && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}

      {state && (
        <>
          <section className="surface-card rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-mono">{t('spaces:verification.statusLabel')}</span>
              <ReviewStatusChip process="verification" status={status} />
            </div>
            <p className="mt-2 text-ui text-txt-secondary">{t(statusTextKey(status))}</p>
            {request?.decisionNote && (
              <div className="mt-2.5 rounded-md border border-border-soft px-3 py-2">
                <div className="label-mono mb-1">{t('spaces:verification.adminNote')}</div>
                <p className="whitespace-pre-wrap break-words text-ui text-txt-primary">{request.decisionNote}</p>
              </div>
            )}
            {request && (
              <p className="mt-2 font-mono text-label text-txt-tertiary">
                {t('spaces:verification.sentAt', { date: f.formatDateTime(request.requestedAt) })}
              </p>
            )}
            {canWithdrawVerification(status) && (
              <button type="button" onClick={() => setConfirmWithdraw(true)} disabled={busy} className="btn-outline btn-sm mt-3">
                {t('spaces:verification.withdraw')}
              </button>
            )}
          </section>

          {mayRequest && (
            <section aria-labelledby={`${formId}-heading`} className="space-y-3.5">
              <div>
                <h3 id={`${formId}-heading`} className="label-mono">{t('spaces:verification.form.title')}</h3>
                <p className="mt-1 text-meta text-txt-tertiary">{t('spaces:verification.form.privacy')}</p>
              </div>

              <div className="surface-card rounded-lg p-4 text-ui">
                <div className="label-mono mb-1">{t('spaces:verification.form.identity')}</div>
                <div className="font-medium text-txt-primary">{space.name}</div>
                <p className="mt-0.5 text-txt-secondary">{space.description || t('spaces:verification.form.noDescription')}</p>
                <p className="mt-1.5 text-meta text-txt-tertiary">{t('spaces:verification.form.identityHint')}</p>
              </div>

              <div>
                <label htmlFor={`${formId}-category`} className="field-label">{t('spaces:verification.form.category')}</label>
                <select
                  id={`${formId}-category`}
                  value={category}
                  onChange={(e) => { if (isSpaceCategory(e.target.value)) setCategory(e.target.value); }}
                  className="input-standard w-full"
                >
                  {SPACE_CATEGORIES.map((entry) => <option key={entry} value={entry}>{t(spaceCategoryKey(entry))}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor={`${formId}-website`} className="field-label">{t('spaces:verification.form.website')}</label>
                <input
                  id={`${formId}-website`}
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder={t('spaces:verification.form.urlPlaceholder')}
                  maxLength={REVIEW_LIMITS.URL_MAX_LENGTH}
                  aria-invalid={!websiteValid}
                  className="input-standard w-full"
                />
              </div>

              <div>
                <div className="field-label">{t('spaces:verification.form.profiles', { max: REVIEW_LIMITS.MAX_PROFILES })}</div>
                <div className="space-y-1.5">
                  {profiles.map((entry, index) => {
                    const valid = entry.trim().length === 0 || isPublicUrl(entry.trim());
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="url"
                          value={entry}
                          onChange={(e) => setProfile(index, e.target.value)}
                          placeholder={t('spaces:verification.form.urlPlaceholder')}
                          maxLength={REVIEW_LIMITS.URL_MAX_LENGTH}
                          aria-label={t('spaces:verification.form.profileAria', { index: index + 1 })}
                          aria-invalid={!valid}
                          className="input-standard w-full"
                        />
                        {profiles.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setProfiles((current) => current.filter((_, i) => i !== index))}
                            className="btn-quiet btn-sm flex-shrink-0"
                          >
                            {t('common:actions.remove')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {profiles.length < REVIEW_LIMITS.MAX_PROFILES && (
                  <button type="button" onClick={() => setProfiles((current) => [...current, ''])} className="btn-quiet btn-sm mt-1.5">
                    {t('spaces:verification.form.addProfile')}
                  </button>
                )}
              </div>

              <div>
                <label htmlFor={`${formId}-reason`} className="field-label">{t('spaces:verification.form.reason')}</label>
                <textarea
                  id={`${formId}-reason`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, REVIEW_LIMITS.REASON_MAX_LENGTH))}
                  rows={3}
                  placeholder={t('spaces:verification.form.reasonPlaceholder')}
                  className="input-standard w-full resize-none"
                />
                <div className="tabular mt-1 text-right font-mono text-label text-txt-tertiary">
                  {t('spaces:verification.form.counter', { length: reason.trim().length, min: REVIEW_LIMITS.REASON_MIN_LENGTH, max: REVIEW_LIMITS.REASON_MAX_LENGTH })}
                </div>
              </div>

              <div>
                <label htmlFor={`${formId}-proof`} className="field-label">{t('spaces:verification.form.proof')}</label>
                <textarea
                  id={`${formId}-proof`}
                  value={proof}
                  onChange={(e) => setProof(e.target.value.slice(0, REVIEW_LIMITS.PROOF_MAX_LENGTH))}
                  rows={3}
                  placeholder={t('spaces:verification.form.proofPlaceholder')}
                  className="input-standard w-full resize-none"
                />
                <div className="tabular mt-1 text-right font-mono text-label text-txt-tertiary">
                  {t('spaces:verification.form.counter', { length: proof.trim().length, min: REVIEW_LIMITS.PROOF_MIN_LENGTH, max: REVIEW_LIMITS.PROOF_MAX_LENGTH })}
                </div>
              </div>

              {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}

              <button type="button" onClick={() => void submit()} disabled={!formValid || busy} aria-busy={busy} className="btn-primary">
                {busy ? t('common:states.saving') : status === null ? t('spaces:verification.form.send') : t('spaces:verification.form.sendAgain')}
              </button>
            </section>
          )}

          <section>
            <div className="label-mono mb-2">{t('common:review.history')}</div>
            <ReviewHistory events={state.verification.history} />
          </section>
        </>
      )}

      <ConfirmDialog
        isOpen={confirmWithdraw}
        onClose={() => setConfirmWithdraw(false)}
        onConfirm={withdraw}
        title={t('spaces:verification.withdrawDialog.title')}
        description={t('spaces:verification.withdrawDialog.description')}
        confirmLabel={t('spaces:verification.withdraw')}
        variant="warning"
        loading={busy}
      />
    </div>
  );
}
