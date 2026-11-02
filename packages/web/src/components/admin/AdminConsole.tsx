import { BotsSection } from './BotsSection';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { openReviewTotal, useReviewStore } from '../../stores/reviewStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useFederationEnabled } from '../../hooks/useFederationEnabled';
import {
  EmailPanel,
  FederationPanel,
  GeneralPanel,
  LegalPanel,
  PlatformAuditPanel,
  PlatformSpacesPanel,
  RegistrationPanel,
  ReportsPanel,
  ReviewQueuePanel,
  SettingsPanelSuspense,
  StoragePanel,
  StreamingPanel,
  UsersPanel,
} from '../modals/lazySettingsPanels';
import { AdminSpaceDetailModal } from '../modals/instanceSettingsPanels/AdminSpaceDetailModal';
import { AdminUserDetailModal } from '../modals/instanceSettingsPanels/AdminUserDetailModal';
import { CountBadge } from '../ui/CountBadge';
import { Icon, type IconName } from '../ui/Icon';
import { SlidingMark } from '../ui/SlidingMark';
import { AdminDashboard } from './AdminDashboard';
import { AdminSearch } from './AdminSearch';
import { AnnouncementsSection } from './AnnouncementsSection';
import { SignupRulesSection } from './SignupRulesSection';
import { StarterSpacesSection } from './StarterSpacesSection';
import { SystemSection } from './SystemSection';

/** The console's places, in the order of its navigation. */
const SECTION_GROUPS = [
  { group: 'overview', sections: ['overview'] },
  { group: 'moderation', sections: ['reviews', 'reports', 'users', 'spaces', 'audit'] },
  { group: 'community', sections: ['announcements', 'signup', 'starter', 'bots'] },
  { group: 'instance', sections: ['general', 'registration', 'email', 'legal', 'federation', 'streaming', 'storage', 'system'] },
] as const;

type AdminSection = (typeof SECTION_GROUPS)[number]['sections'][number];

const SECTION_ICONS: Record<AdminSection, IconName> = {
  overview: 'grid',
  reviews: 'shield',
  reports: 'flag',
  users: 'users',
  spaces: 'compass',
  audit: 'file',
  announcements: 'bell',
  signup: 'user-plus',
  bots: 'link',
  starter: 'star',
  general: 'settings',
  registration: 'lock',
  email: 'at',
  legal: 'info',
  federation: 'globe',
  streaming: 'video',
  storage: 'download',
  system: 'monitor',
};

function isSection(value: string | undefined): value is AdminSection {
  return SECTION_GROUPS.some(({ sections }) => (sections as readonly string[]).includes(value ?? ''));
}

/**
 * The admin console (docs/systems/admin.md, "The console"): a page of its own at `/admin`,
 * under the top bar, for everything an instance's administrators do. This shell only says
 * which section is open, and it is not what protects them: every request behind it is
 * refused by the server unless `users.is_admin` says otherwise. Someone who is not an admin
 * is sent home, so they never see a page full of refusals.
 */
export function AdminConsole() {
  const { t } = useTranslation(['admin', 'common']);
  const { section: rawSection } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const isMobile = useUIStore((s) => s.isMobile);
  const fetchInstanceSettings = useSettingsStore((s) => s.fetchInstanceSettings);
  const federation = useFederationEnabled() === true;
  const reviewCount = useReviewStore((s) => openReviewTotal(s.queue));
  const reportCount = useReviewStore((s) => s.reportsOpen ?? 0);
  const [approvalCount, setApprovalCount] = useState(0);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [openSpaceId, setOpenSpaceId] = useState<string | null>(null);
  // Something changed in a detail opened from the search: the list behind it starts over.
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((current) => current + 1);

  useEffect(() => {
    if (isAdmin) void fetchInstanceSettings();
  }, [fetchInstanceSettings, isAdmin]);

  // The list says what waits in a section before that section has been opened.
  useEffect(() => {
    if (!isAdmin || !federation) return;
    let stale = false;
    api.federation.approvalRequests()
      .then(({ requests }) => { if (!stale) setApprovalCount(requests.length); })
      .catch(() => {});
    return () => { stale = true; };
  }, [federation, isAdmin]);

  if (!isAdmin) return <Navigate to="/channels/@me" replace />;

  const known = isSection(rawSection) && (rawSection !== 'federation' || federation);
  const section: AdminSection = known ? rawSection : 'overview';
  // On a phone the console opens on its list of places; on a window the list is always there.
  const onPhoneHub = isMobile && !known;

  const countOf: Partial<Record<AdminSection, number>> = { reviews: reviewCount, reports: reportCount, federation: approvalCount };

  const open = (target: AdminSection) => navigate(target === 'overview' && !isMobile ? '/admin' : `/admin/${target}`);

  const panels: Record<AdminSection, () => ReactNode> = {
    overview: () => <AdminDashboard />,
    reviews: () => <ReviewQueuePanel />,
    reports: () => <ReportsPanel />,
    users: () => <UsersPanel />,
    spaces: () => <PlatformSpacesPanel />,
    audit: () => <PlatformAuditPanel />,
    announcements: () => <AnnouncementsSection />,
    signup: () => <SignupRulesSection />,
    starter: () => <StarterSpacesSection />,
    bots: () => <BotsSection />,
    general: () => <GeneralPanel />,
    registration: () => <RegistrationPanel />,
    email: () => <EmailPanel />,
    legal: () => <LegalPanel />,
    federation: () => <FederationPanel onApprovalCountChange={setApprovalCount} />,
    streaming: () => <StreamingPanel />,
    storage: () => <StoragePanel />,
    system: () => <SystemSection />,
  };

  const navigation = (
    <>
      {SECTION_GROUPS.map(({ group, sections }, index) => (
        <div key={group} className={index > 0 ? 'mt-4' : ''}>
          {group !== 'overview' && <div className="label-mono px-2.5 pb-1.5">{t(`admin:console.groups.${group}`)}</div>}
          {sections.filter((entry) => entry !== 'federation' || federation).map((entry) => {
            const count = countOf[entry] ?? 0;
            const active = !onPhoneHub && !isMobile && section === entry;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => open(entry)}
                data-active={active ? 'true' : undefined}
                aria-current={active ? 'page' : undefined}
                className={`nav-item group w-full ${isMobile ? 'h-11' : ''}`}
              >
                <Icon name={SECTION_ICONS[entry]} size={15} className={`flex-shrink-0 ${active ? 'text-txt-primary' : 'text-txt-tertiary group-hover:text-txt-secondary'}`} />
                <span className="min-w-0 flex-1 truncate">{t(`admin:console.sections.${entry}`)}</span>
                {count > 0 && <CountBadge count={count} />}
                {isMobile && <Icon name="chevron-right" size={15} className="flex-shrink-0 text-txt-tertiary" />}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );

  const search = <AdminSearch onOpenUser={setOpenUserId} onOpenSpace={setOpenSpaceId} />;

  const details = (
    <>
      <AdminUserDetailModal userId={openUserId} onClose={() => setOpenUserId(null)} onChanged={changed} />
      <AdminSpaceDetailModal
        spaceId={openSpaceId}
        onClose={() => setOpenSpaceId(null)}
        onChanged={changed}
        onOpenUser={(userId) => { setOpenSpaceId(null); setOpenUserId(userId); }}
      />
    </>
  );

  if (isMobile) {
    return (
      <div className="lit flex h-full flex-col bg-surface-channel" style={{ paddingTop: 'var(--safe-top)' }}>
        <header className="panel-bar flex h-12 items-center gap-1 px-1">
          <button
            type="button"
            onClick={() => navigate(onPhoneHub ? '/channels/@me' : '/admin')}
            aria-label={t('common:actions.back')}
            className="icon-btn h-10 w-10"
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lead font-semibold tracking-[-0.01em] text-txt-primary">
            {onPhoneHub ? t('admin:console.title') : t(`admin:console.sections.${section}`)}
          </h1>
        </header>
        <div className="relative isolate min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: 'var(--safe-bottom)' }}>
          {onPhoneHub ? (
            <div className="space-y-4 px-3 py-3">
              {search}
              <nav aria-label={t('admin:console.title')}>{navigation}</nav>
            </div>
          ) : (
            <div className="px-4 py-4">
              <SettingsPanelSuspense key={`${section}:${revision}`}>{panels[section]()}</SettingsPanelSuspense>
            </div>
          )}
        </div>
        {details}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <nav aria-label={t('admin:console.title')} className="lit relative flex w-[var(--sidebar-width)] flex-shrink-0 flex-col border-r border-border-hard bg-surface-channel">
        <div className="panel-bar flex items-center gap-2 px-4">
          <Icon name="shield" size={16} className="flex-shrink-0 text-txt-secondary" />
          <span className="truncate text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('admin:console.title')}</span>
        </div>
        <div className="sliding-list min-h-0 flex-1 overflow-y-auto px-2 py-3 no-scrollbar">
          <SlidingMark variant="row" />
          {navigation}
        </div>
      </nav>
      <main className="lit relative isolate min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface-chat">
        <div aria-hidden="true" className="hero-light" />
        <div className="relative z-20 flex justify-end px-6 pt-4">{search}</div>
        <div key={`${section}:${revision}`} className="mx-auto w-full max-w-[1120px] px-6 pb-12 pt-4">
          <SettingsPanelSuspense>{panels[section]()}</SettingsPanelSuspense>
        </div>
      </main>
      {details}
    </div>
  );
}
