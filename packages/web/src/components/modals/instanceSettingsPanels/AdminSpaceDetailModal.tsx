import { useCallback, useEffect, useState, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DISCOVERY_DECISIONS,
  VERIFICATION_DECISIONS,
  discoveryDecisionApplies,
  verificationDecisionApplies,
  type AdminSpaceDetail,
  type DiscoveryDecision,
  type VerificationDecision,
} from '@backspace/shared/src/platform';
import { badgeDefinition, GRANTED_SPACE_BADGES, type GrantedSpaceBadgeId } from '@backspace/shared/src/badges';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { spaceCategoryKey } from '../../../i18n/review';
import { BADGE_TONE_CLASS, useBadgeText } from '../../../badges/badgeText';
import { BadgeGlyph } from '../../../badges/BadgeGlyph';
import { BadgeList } from '../../../badges/BadgeList';
import { Modal } from '../../ui/Modal';
import { Avatar } from '../../ui/Avatar';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { ListingPreview, ReviewDecisionDialog, ReviewHistory, ReviewStatusChip } from '../../review/ReviewParts';
import { PlatformAuditList } from './PlatformAuditList';

const VERIFICATION_ORDER: readonly VerificationDecision[] = ['approve', 'request_info', 'reject', 'revoke'];
const DISCOVERY_ORDER: readonly DiscoveryDecision[] = ['approve', 'request_changes', 'reject', 'withdraw'];

type PendingDecision =
  | { process: 'verification'; decision: VerificationDecision }
  | { process: 'discovery'; decision: DiscoveryDecision };

/** An address the owner gave: shown as text, opened only on a click, never fetched. */
function ExternalLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-txt-link hover:underline">
      {href}
    </a>
  );
}

/**
 * One space in the admin area (docs/systems/admin.md, "Platform
 * administration"): its owner and facts, both reviews with every detail the
 * owner sent, the decisions that apply now, the badges an admin gives it, and
 * the platform audit entries about it. Every decision asks for its reason in a
 * dialog first; the owner reads it.
 */
export function AdminSpaceDetailModal({
  spaceId,
  onClose,
  onChanged,
  onOpenUser,
}: {
  spaceId: string | null;
  onClose: () => void;
  /** After a decision or a badge change, so the list behind it can reload. */
  onChanged: () => void;
  onOpenUser: (userId: string) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const badgeText = useBadgeText();
  const [detail, setDetail] = useState<AdminSpaceDetail | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [badges, setBadges] = useState<GrantedSpaceBadgeId[]>([]);
  const [badgeBusy, setBadgeBusy] = useState(false);
  const [badgeError, setBadgeError] = useState('');

  // Only the last request counts: a slow answer about the space before stays out.
  const loadSeq = useRef(0);
  const load = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    setError('');
    try {
      const next = await api.admin.spaceDetail(id);
      if (seq !== loadSeq.current) return;
      setDetail(next);
      setBadges(next.space.grantedBadges);
    } catch (err) {
      if (seq === loadSeq.current) setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    loadSeq.current += 1;
    setDetail(null);
    setPending(null);
    setBadgeError('');
    if (spaceId) void load(spaceId);
  }, [spaceId, load]);

  const decide = async (note: string) => {
    if (!detail || !pending) return;
    const id = detail.space.id;
    if (pending.process === 'verification') {
      await api.admin.decideVerification(id, pending.decision, {
        note: note || null,
        requestedAt: detail.review.verification.request?.requestedAt,
      });
    } else {
      await api.admin.decideDiscovery(id, pending.decision, {
        note: note || null,
        requestedAt: detail.review.discovery.request?.requestedAt,
      });
    }
    setPending(null);
    onChanged();
    await load(id);
  };

  const revokeVanity = async (reason: string) => {
    if (!detail) return;
    await api.admin.revokeSpaceVanity(detail.space.id, reason);
    setRevoking(false);
    onChanged();
    await load(detail.space.id);
  };

  const saveBadges = async () => {
    if (!detail) return;
    setBadgeBusy(true);
    setBadgeError('');
    try {
      await api.admin.setSpaceBadges(detail.space.id, { badges });
      onChanged();
      await load(detail.space.id);
    } catch (err) {
      setBadgeError(describeError(err));
    } finally {
      setBadgeBusy(false);
    }
  };

  const space = detail?.space ?? null;
  const joinPath = detail?.vanityCode ? `/join/${detail.vanityCode}` : '';
  const verification = detail?.review.verification ?? null;
  const discovery = detail?.review.discovery ?? null;
  const badgesChanged = space !== null && [...badges].sort().join() !== [...space.grantedBadges].sort().join();

  const decisionTexts = (decision: PendingDecision): { title: string; description: string; confirm: string } => (
    decision.process === 'verification'
      ? {
        title: t(`admin:platform.decisions.verification.${decision.decision}.title`),
        description: t(`admin:platform.decisions.verification.${decision.decision}.description`),
        confirm: t(`admin:platform.decisions.verification.${decision.decision}.confirm`),
      }
      : {
        title: t(`admin:platform.decisions.discovery.${decision.decision}.title`),
        description: t(`admin:platform.decisions.discovery.${decision.decision}.description`),
        confirm: t(`admin:platform.decisions.discovery.${decision.decision}.confirm`),
      }
  );
  const pendingTexts = pending ? decisionTexts(pending) : null;
  const pendingRule = pending
    ? (pending.process === 'verification' ? VERIFICATION_DECISIONS[pending.decision] : DISCOVERY_DECISIONS[pending.decision])
    : null;
  const pendingDanger = pending !== null && (pending.decision === 'reject' || pending.decision === 'revoke' || pending.decision === 'withdraw');

  return (
    <Modal isOpen={spaceId !== null} onClose={onClose} title={space?.name ?? t('admin:platform.spaces.detailTitle')} maxWidth="max-w-3xl" mobileStyle="fullscreen">
      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {!detail && !error && <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div>}

      {detail && space && verification && discovery && (
        <div className="space-y-6">
          <section className="flex items-start gap-3">
            <Avatar src={space.icon} name={space.name} size={48} userId={space.id} avatarColor={space.avatarColor} palette="space" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-lead font-semibold text-txt-primary">{space.name}</span>
                <BadgeList badges={space.badges} size="sm" />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-label text-txt-tertiary">
                <span>{t('admin:platform.spaces.members', { count: space.memberCount })}</span>
                <span>{t(`admin:platform.spaces.visibility.${space.visibility}`)}</span>
                <span>{t('admin:platform.spaces.created', { date: f.formatMediumDate(space.createdAt) })}</span>
                {space.directoryListed && <span>{t('admin:platform.spaces.directoryOptIn')}</span>}
              </div>
              {space.owner ? (
                <button type="button" onClick={() => space.owner && onOpenUser(space.owner.id)} className="mt-1.5 text-left text-ui text-txt-secondary transition-colors duration-100 hover:text-txt-primary hover:underline">
                  {t('admin:platform.spaces.ownedBy', { name: space.owner.displayName || space.owner.username, username: space.owner.username })}
                </button>
              ) : (
                <p className="mt-1.5 text-ui text-txt-tertiary">{t('admin:platform.spaces.ownerGone')}</p>
              )}
            </div>
          </section>

          {/* Verification */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="label-mono">{t('admin:platform.verification.title')}</h3>
              <ReviewStatusChip process="verification" status={verification.status} />
            </div>
            {verification.request ? (
              <div className="space-y-2 surface-card rounded-lg p-4 text-ui">
                <Field label={t('admin:platform.verification.name')}>{verification.request.name}</Field>
                <Field label={t('admin:platform.verification.description')}>{verification.request.description || '—'}</Field>
                <Field label={t('admin:platform.verification.category')}>{t(spaceCategoryKey(verification.request.category))}</Field>
                <Field label={t('admin:platform.verification.website')}>
                  {verification.request.website ? <ExternalLink href={verification.request.website} /> : '—'}
                </Field>
                <Field label={t('admin:platform.verification.profiles')}>
                  {verification.request.profiles.length > 0
                    ? <ul className="space-y-0.5">{verification.request.profiles.map((href) => <li key={href}><ExternalLink href={href} /></li>)}</ul>
                    : '—'}
                </Field>
                <Field label={t('admin:platform.verification.reason')}><span className="whitespace-pre-wrap break-words">{verification.request.reason}</span></Field>
                <Field label={t('admin:platform.verification.proof')}><span className="whitespace-pre-wrap break-words">{verification.request.proof}</span></Field>
                <Field label={t('admin:platform.verification.requested')}>
                  {t('admin:platform.requestedBy', {
                    name: verification.request.requestedBy ? `@${verification.request.requestedBy.username}` : t('common:review.unknownActor'),
                    date: f.formatDateTime(verification.request.requestedAt),
                  })}
                </Field>
              </div>
            ) : (
              <p className="text-ui text-txt-tertiary">{t('admin:platform.verification.none')}</p>
            )}
            <DecisionButtons
              order={VERIFICATION_ORDER}
              applies={(decision) => verificationDecisionApplies(decision, verification.status)}
              label={(decision) => t(`admin:platform.decisions.verification.${decision}.button`)}
              onPick={(decision) => setPending({ process: 'verification', decision })}
            />
          </section>

          {/* Discovery */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="label-mono">{t('admin:platform.discovery.title')}</h3>
              <ReviewStatusChip process="discovery" status={discovery.status} />
            </div>
            <div className="grid gap-4 desktop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ListingPreview
                spaceId={space.id}
                name={space.name}
                description={detail.description}
                icon={space.icon}
                banner={detail.banner}
                avatarColor={space.avatarColor}
                memberCount={space.memberCount}
                category={discovery.request?.category ?? null}
                badges={space.badges}
              />
              {discovery.request ? (
                <div className="space-y-2 text-ui">
                  <Field label={t('admin:platform.discovery.category')}>{t(spaceCategoryKey(discovery.request.category))}</Field>
                  <Field label={t('admin:platform.discovery.requested')}>
                    {t('admin:platform.requestedBy', {
                      name: discovery.request.requestedBy ? `@${discovery.request.requestedBy.username}` : t('common:review.unknownActor'),
                      date: f.formatDateTime(discovery.request.requestedAt),
                    })}
                  </Field>
                  {discovery.request.decisionNote && (
                    <Field label={t('admin:platform.discovery.lastNote')}><span className="whitespace-pre-wrap break-words">{discovery.request.decisionNote}</span></Field>
                  )}
                </div>
              ) : (
                <p className="text-ui text-txt-tertiary">{t('admin:platform.discovery.none')}</p>
              )}
            </div>
            <DecisionButtons
              order={DISCOVERY_ORDER}
              applies={(decision) => discoveryDecisionApplies(decision, discovery.status)}
              label={(decision) => t(`admin:platform.decisions.discovery.${decision}.button`)}
              onPick={(decision) => setPending({ process: 'discovery', decision })}
            />
          </section>

          {/* Badges */}
          <section className="space-y-2">
            <h3 className="label-mono">{t('admin:platform.badges.spaceTitle')}</h3>
            <p className="text-meta text-txt-tertiary">{t('admin:platform.badges.spaceHint')}</p>
            <div className="space-y-1">
              {GRANTED_SPACE_BADGES.map((badge) => (
                <label key={badge} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-interactive-hover">
                  <input
                    type="checkbox"
                    checked={badges.includes(badge)}
                    onChange={(e) => setBadges((current) => e.target.checked ? [...current, badge] : current.filter((entry) => entry !== badge))}
                  />
                  <span className={`inline-flex ${BADGE_TONE_CLASS[badgeDefinition(badge)?.tone ?? 'neutral']}`}>
                    <BadgeGlyph id={badge} size={16} />
                  </span>
                  <span className="text-ui text-txt-primary">{badgeText[badge].name}</span>
                  <span className="truncate text-meta text-txt-tertiary">{badgeText[badge].description}</span>
                </label>
              ))}
            </div>
            {badgeError && <p role="alert" className="text-meta text-txt-danger">{badgeError}</p>}
            {badgesChanged && (
              <button type="button" onClick={() => void saveBadges()} disabled={badgeBusy} aria-busy={badgeBusy} className="btn-primary btn-sm">
                {badgeBusy ? t('common:states.saving') : t('common:actions.save')}
              </button>
            )}
          </section>

          {detail.vanityCode && (
            <section className="space-y-2">
              <h3 className="label-mono">{t('admin:platform.vanity.title')}</h3>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-ui text-txt-primary">{joinPath}</span>
                <button type="button" onClick={() => setRevoking(true)} className="btn-outline btn-sm flex-shrink-0">
                  {t('admin:platform.vanity.revoke')}
                </button>
              </div>
              <p className="text-meta text-txt-tertiary">{t('admin:platform.vanity.hint')}</p>
            </section>
          )}

          <section className="grid gap-5 desktop:grid-cols-2">
            <div>
              <h3 className="label-mono mb-2">{t('admin:platform.verification.history')}</h3>
              <ReviewHistory events={verification.history} />
            </div>
            <div>
              <h3 className="label-mono mb-2">{t('admin:platform.discovery.history')}</h3>
              <ReviewHistory events={discovery.history} />
            </div>
          </section>

          <section>
            <h3 className="label-mono mb-2">{t('admin:platform.audit.aboutSpace')}</h3>
            <PlatformAuditList entries={detail.audit} compact />
          </section>
        </div>
      )}

      {revoking && detail && (
        <ReviewDecisionDialog
          isOpen
          onClose={() => setRevoking(false)}
          onConfirm={revokeVanity}
          title={t('admin:platform.vanity.confirmTitle')}
          description={t('admin:platform.vanity.confirmBody')}
          noteRequired
          confirmLabel={t('admin:platform.vanity.revoke')}
          variant="danger"
        />
      )}

      {pending && pendingTexts && pendingRule && (
        <ReviewDecisionDialog
          isOpen
          onClose={() => setPending(null)}
          onConfirm={decide}
          title={pendingTexts.title}
          description={pendingTexts.description}
          noteRequired={pendingRule.noteRequired}
          confirmLabel={pendingTexts.confirm}
          variant={pendingDanger ? 'danger' : 'primary'}
        />
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 desktop:grid-cols-[140px_minmax(0,1fr)] desktop:gap-3">
      <span className="text-meta text-txt-tertiary">{label}</span>
      <div className="min-w-0 text-txt-primary">{children}</div>
    </div>
  );
}

function DecisionButtons<D extends string>({
  order,
  applies,
  label,
  onPick,
}: {
  order: readonly D[];
  applies: (decision: D) => boolean;
  label: (decision: D) => string;
  onPick: (decision: D) => void;
}) {
  const open = order.filter(applies);
  if (open.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {open.map((decision) => (
        <button
          key={decision}
          type="button"
          onClick={() => onPick(decision)}
          className={decision === 'approve' ? 'btn-primary btn-sm' : decision === 'reject' || decision === 'revoke' || decision === 'withdraw' ? 'btn-danger btn-sm' : 'btn-outline btn-sm'}
        >
          {label(decision)}
        </button>
      ))}
    </div>
  );
}
