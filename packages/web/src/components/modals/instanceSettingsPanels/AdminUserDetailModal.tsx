import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SUSPENSION_DURATIONS,
  SUSPENSION_LIMITS,
  type AdminUserDetail,
  type SuspensionDuration,
} from '@backspace/shared/src/platform';
import { GRANTED_USER_BADGES, type GrantedUserBadgeId } from '@backspace/shared/src/badges';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { useAuthStore } from '../../../stores/authStore';
import { useBadgeText } from '../../../badges/badgeText';
import { BadgeGlyph } from '../../../badges/BadgeGlyph';
import { Modal } from '../../ui/Modal';
import { Avatar } from '../../ui/Avatar';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { ReviewDecisionDialog } from '../../review/ReviewParts';
import { SlidingMark } from '../../ui/SlidingMark';
import { AccountNotesSection, AccountSecuritySection, AccountSessionsSection, AccountStorageSection, AccountWarningSection } from '../../admin/AccountSections';
import { ProfileRemovalSection } from '../../admin/RemovalSections';
import { PlatformAuditList } from './PlatformAuditList';

/** What the detail of an account opens on, and the rest of it behind tabs. */
const VIEWS = ['overview', 'moderation', 'access', 'notes', 'log'] as const;
type View = (typeof VIEWS)[number];

/** The key naming a suspension length; null is "until lifted". */
export function durationKey(duration: SuspensionDuration): `admin:platform.suspension.durations.${'h1' | 'h24' | 'h72' | 'h168' | 'h720' | 'lifted'}` {
  switch (duration) {
    case 1: return 'admin:platform.suspension.durations.h1';
    case 24: return 'admin:platform.suspension.durations.h24';
    case 72: return 'admin:platform.suspension.durations.h72';
    case 168: return 'admin:platform.suspension.durations.h168';
    case 720: return 'admin:platform.suspension.durations.h720';
    default: return 'admin:platform.suspension.durations.lifted';
  }
}

/**
 * One account in the admin area (docs/systems/admin.md, "Suspensions"): what
 * it is, a suspension with its reason and end or the form to suspend it, the
 * badges an admin gives it, and the platform audit entries about it. A
 * suspension never deletes anything; it ends the account's sessions and
 * keeps it out until it ends or an admin lifts it.
 */
export function AdminUserDetailModal({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  /** After a suspension, a lift or a badge change, so the list behind it can reload. */
  onChanged: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const badgeText = useBadgeText();
  const selfId = useAuthStore((s) => s.user?.id);
  const formId = useId();

  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState<SuspensionDuration>(24);
  const [reason, setReason] = useState('');
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [liftOpen, setLiftOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [badges, setBadges] = useState<GrantedUserBadgeId[]>([]);
  const [view, setView] = useState<View>('overview');

  // Only the last request counts: a slow answer about the account before stays out.
  const loadSeq = useRef(0);
  const load = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    setError('');
    try {
      const next = await api.admin.userDetail(id);
      if (seq !== loadSeq.current) return;
      setDetail(next);
      setBadges(next.user.grantedBadges);
    } catch (err) {
      if (seq === loadSeq.current) setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    loadSeq.current += 1;
    setDetail(null);
    setView('overview');
    setReason('');
    setDuration(24);
    setActionError('');
    if (userId) void load(userId);
  }, [userId, load]);

  const user = detail?.user ?? null;
  const reasonValid = reason.trim().length >= SUSPENSION_LIMITS.REASON_MIN_LENGTH && reason.trim().length <= SUSPENSION_LIMITS.REASON_MAX_LENGTH;
  const isSelf = user !== null && user.id === selfId;
  const canSuspend = user !== null && !user.isDeleted && !user.isAdmin && !isSelf;
  const badgesChanged = user !== null && [...badges].sort().join() !== [...user.grantedBadges].sort().join();

  /** Runs an admin action; true when it went through. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (!user) return false;
    setBusy(true);
    setActionError('');
    try {
      await action();
      onChanged();
      await load(user.id);
      return true;
    } catch (err) {
      setActionError(describeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const suspend = async () => {
    if (!user) return;
    const done = await run(() => api.admin.suspendUser(user.id, { reason: reason.trim(), durationHours: duration }));
    setConfirmSuspend(false);
    // A refused suspension keeps what the admin wrote.
    if (done) setReason('');
  };

  const lift = async (note: string) => {
    if (!user) return;
    await api.admin.unsuspendUser(user.id, { reason: note || null });
    setLiftOpen(false);
    onChanged();
    await load(user.id);
  };

  const name = user ? (user.displayName || user.username) : '';
  // What a section did is in the Log tab, and on the list behind this dialog.
  const sectionChanged = () => {
    onChanged();
    if (user) void load(user.id);
  };

  return (
    <Modal isOpen={userId !== null} onClose={onClose} title={name || t('admin:platform.users.detailTitle')} maxWidth="max-w-2xl" mobileStyle="fullscreen">
      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {!detail && !error && <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div>}

      {detail && user && (
        <div className="space-y-6">
          <section className="flex items-start gap-3">
            <Avatar src={user.avatar} name={name} size={48} userId={user.id} avatarColor={user.avatarColor} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lead font-semibold text-txt-primary">{name}</div>
              <div className="truncate font-mono text-meta text-txt-tertiary">@{user.username}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {user.isAdmin && <Chip tone="amber">{t('admin:users.badge.admin')}</Chip>}
                {user.homeInstance && <Chip tone="sky">{user.homeInstance}</Chip>}
                {user.isDeleted && <Chip tone="rose">{t('admin:users.badge.deleted')}</Chip>}
                {user.suspension && <Chip tone="rose">{t('admin:platform.suspension.chip')}</Chip>}
              </div>
            </div>
          </section>

          <div role="tablist" aria-label={name} className="sliding-list -mx-1 flex gap-1 overflow-x-auto border-b border-border-hard no-scrollbar">
            <SlidingMark variant="line" selector="[data-active-line]" />
            {VIEWS.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={view === entry}
                onClick={() => setView(entry)}
                className={`relative flex h-9 flex-shrink-0 items-center whitespace-nowrap px-2 text-ui font-medium transition-colors ${view === entry ? 'text-txt-primary' : 'text-txt-tertiary hover:text-txt-secondary'}`}
              >
                {t(`admin:console.account.tabs.${entry}`)}
                {view === entry && <span aria-hidden="true" data-active-line="" className="active-line absolute inset-x-2 bottom-0 h-[2px]" />}
              </button>
            ))}
          </div>

          {view === 'overview' && <section className="grid grid-cols-2 gap-2 desktop:grid-cols-4">
            <Fact label={t('admin:platform.users.joined')} value={f.formatMediumDate(user.createdAt)} />
            <Fact label={t('admin:platform.users.memberships')} value={f.formatNumber(detail.memberships)} />
            <Fact label={t('admin:platform.users.friends')} value={f.formatNumber(detail.friends)} />
            <Fact label={t('admin:platform.users.messages')} value={f.formatNumber(detail.messages)} />
          </section>}

          {view === 'overview' && (
            <AccountStorageSection userId={user.id} isAdmin={user.isAdmin} isDeleted={user.isDeleted} storage={detail.storage} onChanged={sectionChanged} />
          )}

          {view === 'overview' && detail.ownedSpaces.length > 0 && (
            <section>
              <h3 className="label-mono mb-2">{t('admin:platform.users.ownedSpaces')}</h3>
              <ul className="surface-card divide-y divide-border-hard rounded-lg">
                {detail.ownedSpaces.map((space) => (
                  <li key={space.id} className="flex items-center justify-between gap-3 px-3 py-2 text-ui">
                    <span className="truncate text-txt-primary">{space.name}</span>
                    <span className="flex-shrink-0 font-mono text-label text-txt-tertiary">{t('admin:platform.spaces.members', { count: space.memberCount })}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Suspension */}
          {view === 'moderation' && <section className="space-y-2.5">
            <h3 className="label-mono">{t('admin:platform.suspension.title')}</h3>
            {user.suspension ? (
              <div className="space-y-2 rounded-lg border border-accent-rose/25 bg-accent-rose/[0.04] p-4 text-ui">
                <p className="text-txt-primary">
                  {user.suspension.until === null
                    ? t('admin:platform.suspension.activeUntilLifted', { date: f.formatDateTime(user.suspension.since) })
                    : t('admin:platform.suspension.activeUntil', { since: f.formatDateTime(user.suspension.since), until: f.formatDateTime(user.suspension.until) })}
                </p>
                <p className="whitespace-pre-wrap break-words text-txt-secondary">{user.suspension.reason}</p>
                <button type="button" onClick={() => setLiftOpen(true)} disabled={busy} className="btn-outline btn-sm">
                  {t('admin:platform.suspension.lift')}
                </button>
              </div>
            ) : canSuspend ? (
              <div className="space-y-3 surface-card rounded-lg p-4">
                <p className="text-meta text-txt-tertiary">{t('admin:platform.suspension.hint')}</p>
                <div>
                  <label htmlFor={`${formId}-duration`} className="field-label">{t('admin:platform.suspension.duration')}</label>
                  <select
                    id={`${formId}-duration`}
                    value={duration === null ? 'lifted' : String(duration)}
                    onChange={(e) => {
                      const next = SUSPENSION_DURATIONS.find((entry) => (entry === null ? 'lifted' : String(entry)) === e.target.value);
                      if (next !== undefined) setDuration(next);
                    }}
                    className="input-standard w-full max-w-xs"
                  >
                    {SUSPENSION_DURATIONS.map((entry) => (
                      <option key={entry === null ? 'lifted' : entry} value={entry === null ? 'lifted' : String(entry)}>{t(durationKey(entry))}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${formId}-reason`} className="field-label">{t('admin:platform.suspension.reason')}</label>
                  <textarea
                    id={`${formId}-reason`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, SUSPENSION_LIMITS.REASON_MAX_LENGTH))}
                    rows={3}
                    placeholder={t('admin:platform.suspension.reasonPlaceholder')}
                    className="input-standard w-full resize-none"
                  />
                  <p className="mt-1 text-meta text-txt-tertiary">{t('admin:platform.suspension.reasonShown')}</p>
                </div>
                <button type="button" onClick={() => setConfirmSuspend(true)} disabled={!reasonValid || busy} className="btn-danger btn-sm">
                  {t('admin:platform.suspension.suspend')}
                </button>
              </div>
            ) : (
              <p className="text-ui text-txt-tertiary">
                {user.isDeleted
                  ? t('admin:platform.suspension.deleted')
                  : isSelf ? t('admin:platform.suspension.self') : t('admin:platform.suspension.adminFirst')}
              </p>
            )}
            {actionError && <p role="alert" className="text-meta text-txt-danger">{actionError}</p>}
          </section>}

          {/* These two stay mounted behind their tabs, so a draft survives a look at another tab. */}
          {!isSelf && !user.isDeleted && (
            <div hidden={view !== 'moderation'}>
              <AccountWarningSection key={user.id} userId={user.id} onChanged={sectionChanged} />
            </div>
          )}

          {view === 'moderation' && !isSelf && !user.isDeleted && (
            <ProfileRemovalSection key={user.id} userId={user.id} keptBy={user.profileKeptByHome ? user.homeInstance : null} onChanged={sectionChanged} />
          )}

          {view === 'access' && <AccountSessionsSection userId={user.id} isSelf={isSelf} onChanged={sectionChanged} />}
          {view === 'access' && <AccountSecuritySection userId={user.id} />}

          <div hidden={view !== 'notes'}>
            <AccountNotesSection key={user.id} userId={user.id} isDeleted={user.isDeleted} onChanged={sectionChanged} />
          </div>

          {/* Badges */}
          {view === 'overview' && !user.isDeleted && (
            <section className="space-y-2">
              <h3 className="label-mono">{t('admin:platform.badges.userTitle')}</h3>
              <p className="text-meta text-txt-tertiary">{t('admin:platform.badges.userHint')}</p>
              <div className="grid gap-1 desktop:grid-cols-2">
                {GRANTED_USER_BADGES.map((badge) => (
                  <label key={badge} className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-interactive-hover">
                    <input
                      type="checkbox"
                      checked={badges.includes(badge)}
                      onChange={(e) => setBadges((current) => e.target.checked ? [...current, badge] : current.filter((entry) => entry !== badge))}
                    />
                    <span className="inline-flex">
                      <BadgeGlyph id={badge} size={16} />
                    </span>
                    <span className="truncate text-ui text-txt-primary" title={badgeText[badge].description}>{badgeText[badge].name}</span>
                  </label>
                ))}
              </div>
              {actionError && <p role="alert" className="text-meta text-txt-danger">{actionError}</p>}
              {badgesChanged && (
                <button
                  type="button"
                  onClick={() => void run(() => api.admin.setUserBadges(user.id, { badges }))}
                  disabled={busy}
                  aria-busy={busy}
                  className="btn-primary btn-sm"
                >
                  {busy ? t('common:states.saving') : t('common:actions.save')}
                </button>
              )}
            </section>
          )}

          {view === 'log' && (
            <section>
              <h3 className="label-mono mb-2">{t('admin:platform.audit.aboutUser')}</h3>
              <PlatformAuditList entries={detail.audit} compact />
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmSuspend}
        onClose={() => setConfirmSuspend(false)}
        onConfirm={suspend}
        title={t('admin:platform.suspension.confirmTitle')}
        description={t('admin:platform.suspension.confirmDescription', { username: user?.username ?? '', duration: t(durationKey(duration)) })}
        confirmLabel={t('admin:platform.suspension.suspend')}
        variant="danger"
        loading={busy}
      />
      {liftOpen && (
        <ReviewDecisionDialog
          isOpen
          onClose={() => setLiftOpen(false)}
          onConfirm={lift}
          title={t('admin:platform.suspension.liftTitle')}
          description={t('admin:platform.suspension.liftDescription', { username: user?.username ?? '' })}
          noteRequired={false}
          confirmLabel={t('admin:platform.suspension.lift')}
          variant="primary"
          noteLabel={t('admin:platform.suspension.liftNoteLabel')}
          notePlaceholder={t('admin:platform.suspension.liftNotePlaceholder')}
          noteMaxLength={SUSPENSION_LIMITS.REASON_MAX_LENGTH}
        />
      )}
    </Modal>
  );
}

function Chip({ tone, children }: { tone: 'amber' | 'sky' | 'rose'; children: string }) {
  const toneClass = tone === 'amber'
    ? 'bg-accent-amber/15 text-accent-amber'
    : tone === 'sky' ? 'bg-accent-sky/15 text-accent-sky' : 'bg-accent-rose/15 text-txt-danger';
  return <span className={`max-w-[200px] truncate rounded px-1.5 py-px text-label font-medium ${toneClass}`}>{children}</span>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card rounded-lg px-3 py-2">
      <div className="truncate text-meta text-txt-tertiary">{label}</div>
      <div className="tabular mt-0.5 truncate font-mono text-body text-txt-primary">{value}</div>
    </div>
  );
}
