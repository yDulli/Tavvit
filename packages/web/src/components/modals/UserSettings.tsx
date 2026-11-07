import { DevelopersPanel } from './settingsPanels/DevelopersPanel';
import { Fragment, useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { LegalLinks } from '../legal/LegalLinks';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import {
  AccountPanel,
  DecorationsPanel,
  SecurityPanel,
  AccessibilityPanel,
  AppearancePanel,
  LanguagePanel,
  NotificationsPanel,
  VoicePanel,
  GamesPanel,
  EmojiSettingsPanel,
  PrivacyPanel,
  LinkedAccountsPanel,
  ConnectionsPanel,
  DesktopPanel,
  KeybindsPanel,
  SettingsPanelSuspense,
} from './lazySettingsPanels';
import { isElectron } from '../../platform/platform';
import { useFederationEnabled } from '../../hooks/useFederationEnabled';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { useLinkedAccountsStore } from '../../stores/linkedAccountsStore';
import { Icon } from '../ui/Icon';
import { SlidingMark } from '../ui/SlidingMark';

/**
 * Every tab of user settings, in nav order. The nav on both layouts, the
 * deep-link check (`openModal('userSettings', { tab })`) and the panel switch
 * are all read from this one table, so a tab cannot exist in one and be
 * missing from another. `admin` tabs are shown and reachable only for admins.
 */
const USER_SETTINGS_TABS = [
  { id: 'account', group: 'user', label: 'settings:nav.tabs.account' },
  { id: 'decorations', group: 'user', label: 'settings:nav.tabs.decorations' },
  { id: 'security', group: 'user', label: 'settings:nav.tabs.security' },
  { id: 'privacy', group: 'user', label: 'settings:nav.tabs.privacy' },
  { id: 'linkedAccounts', group: 'user', label: 'settings:nav.tabs.linkedAccounts' },
  { id: 'notifications', group: 'user', label: 'settings:nav.tabs.notifications' },
  { id: 'appearance', group: 'app', label: 'settings:nav.tabs.appearance' },
  { id: 'accessibility', group: 'app', label: 'settings:nav.tabs.accessibility' },
  { id: 'language', group: 'app', label: 'settings:nav.tabs.language' },
  { id: 'voice', group: 'app', label: 'settings:nav.tabs.voice' },
  { id: 'emoji', group: 'app', label: 'settings:nav.tabs.emoji' },
  { id: 'connections', group: 'app', label: 'settings:nav.tabs.connections' },
  { id: 'games', group: 'app', label: 'settings:nav.tabs.games' },
  { id: 'developers', group: 'app', label: 'settings:nav.tabs.developers' },
  { id: 'keybinds', group: 'app', label: 'settings:nav.tabs.keybinds' },
  { id: 'desktop', group: 'app', label: 'settings:nav.tabs.desktop' },
] as const;

export type UserSettingsTab = (typeof USER_SETTINGS_TABS)[number]['id'];
type TabGroup = (typeof USER_SETTINGS_TABS)[number]['group'];

const GROUP_HEADINGS = {
  user: 'settings:nav.userSettings',
  app: 'settings:nav.appSettings',
} as const satisfies Record<TabGroup, string>;

const GROUP_ORDER: readonly TabGroup[] = ['user', 'app'];

function isUserSettingsTab(value: unknown): value is UserSettingsTab {
  return typeof value === 'string' && USER_SETTINGS_TABS.some((tab) => tab.id === value);
}

/** What decides which tabs a person is offered. */
interface TabAccess {
  /** This instance federates; account linking ("Connections") is meaningless otherwise. */
  federation: boolean;
  /** Running inside the desktop app; the Desktop tab holds that app's own settings. */
  electron: boolean;
  /** The home links accounts elsewhere, or the person still has one linked to unlink (linked-accounts.md). */
  linkedAccounts: boolean;
}

function tabVisible(tab: UserSettingsTab, access: TabAccess): boolean {
  if (tab === 'connections') return access.federation;
  if (tab === 'desktop') return access.electron;
  if (tab === 'linkedAccounts') return access.linkedAccounts;
  return true;
}

function SettingsScrollContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel-light flex-1 min-w-0 overflow-y-auto scrollbar-thin bg-surface-chat py-8">
      {children}
    </div>
  );
}

/** The way to the admin console, which is a page of its own and not a tab of this dialog. */
function AdminConsoleRow({ tall, onLeave }: { tall: boolean; onLeave: () => void }) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        onLeave();
        navigate('/admin');
      }}
      className={`nav-item w-full ${tall ? 'h-11' : ''}`}
    >
      <span className="min-w-0 flex-1 truncate">{t('nav.tabs.instance')}</span>
      <Icon name="chevron-right" size={15} className="flex-shrink-0 text-txt-tertiary" />
    </button>
  );
}

export function UserSettingsModal() {
  const { t } = useTranslation(['settings', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const isMobile = useUIStore((s) => s.isMobile);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const federation = useFederationEnabled() === true;
  const electron = isElectron();
  const linkable = (useHomeInstanceInfo()?.linkedAccounts?.length ?? 0) > 0;
  const stillLinked = (useLinkedAccountsStore((s) => s.accounts)?.length ?? 0) > 0;
  const linkedAccounts = linkable || stillLinked || (user?.linkedAccounts?.length ?? 0) > 0;
  const access: TabAccess = { federation, electron, linkedAccounts };

  const [tab, setTab] = useState<UserSettingsTab>('account');
  const [mobileView, setMobileView] = useState<'tabs' | 'content'>('tabs');
  const isOpen = activeModal === 'userSettings';

  // Deep-linking: a caller may name the tab to open on. A tab that does not
  // exist, or that this user cannot see, opens Account; on mobile a named tab
  // opens straight on its content.
  useEffect(() => {
    if (isOpen) {
      const requested = modalData.tab;
      const deepLinked = isUserSettingsTab(requested) && tabVisible(requested, access);
      setTab(deepLinked ? requested : 'account');
      setMobileView(deepLinked ? 'content' : 'tabs');
    }
    // `federation` and the home's linked-account services are read when the modal
    // opens; both answers are cached by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, modalData.tab]);

  const handleLogout = () => {
    logout();
    closeModal();
  };

  const handleTabClick = (target: UserSettingsTab) => {
    setTab(target);
    if (isMobile) setMobileView('content');
  };

  // One `.nav-item` per tab: the open one is a step lighter with the violet
  // edge. On the phone the rows are taller, for a thumb.
  const renderNav = (layout: 'desktop' | 'mobile'): ReactNode => (
    <>
      {GROUP_ORDER.map((group, index) => (
        <Fragment key={group}>
          <div className={`label-mono px-2.5 pb-1.5 ${index > 0 ? 'pt-5' : 'pt-1'}`}>{t(GROUP_HEADINGS[group])}</div>
          {USER_SETTINGS_TABS.filter((entry) => entry.group === group && tabVisible(entry.id, access)).map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => handleTabClick(entry.id)}
              className={`nav-item w-full ${layout === 'mobile' ? 'h-11' : ''}`}
              data-active={tab === entry.id}
              aria-current={tab === entry.id ? 'page' : undefined}
            >
              <span className="min-w-0 flex-1 truncate">{t(entry.label)}</span>
              {layout === 'mobile' && <Icon name="chevron-right" size={15} className="flex-shrink-0 text-txt-tertiary" />}
            </button>
          ))}
        </Fragment>
      ))}
      {isAdmin && (
        <>
          <div className="label-mono px-2.5 pb-1.5 pt-5">{t('settings:nav.administration')}</div>
          <AdminConsoleRow tall={layout === 'mobile'} onLeave={closeModal} />
        </>
      )}
    </>
  );

  const panels: Record<UserSettingsTab, () => ReactNode> = {
    account: () => <AccountPanel />,
    decorations: () => <DecorationsPanel />,
    security: () => <SecurityPanel />,
    appearance: () => <AppearancePanel />,
    accessibility: () => <AccessibilityPanel />,
    language: () => <LanguagePanel />,
    notifications: () => <NotificationsPanel />,
    voice: () => <VoicePanel />,
    games: () => <GamesPanel />,
    emoji: () => <EmojiSettingsPanel />,
    privacy: () => <PrivacyPanel />,
    linkedAccounts: () => <LinkedAccountsPanel />,
    connections: () => <ConnectionsPanel />,
    developers: () => <DevelopersPanel />,
    keybinds: () => <KeybindsPanel />,
    desktop: () => <DesktopPanel />,
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="settings" mobileStyle="fullscreen">
      <div className="flex h-full">
        {/* Desktop navigation: a flat column on the sidebar colour, parted from
            the page by a hairline, like the app's own sidebars. */}
        <div className="hidden desktop:flex w-60 flex-shrink-0 flex-col border-r border-border-hard bg-surface-channel">
          {/* Who is signed in */}
          <div className="panel-bar flex items-center gap-2.5 px-4">
            <Avatar
              src={user?.avatar}
              name={user?.displayName || user?.username || ''}
              size={28}
              userId={user?.id}
              avatarColor={user?.avatarColor}
            />
            <div className="min-w-0">
              <div className="truncate text-ui font-medium leading-tight text-txt-primary">{user?.displayName || user?.username}</div>
              <div className="truncate font-mono text-label leading-tight text-txt-tertiary">@{user?.username}</div>
            </div>
          </div>

          {/* Nav list */}
          <nav aria-label={t('common:labels.settings')} className="sliding-list flex flex-1 flex-col overflow-y-auto scrollbar-thin px-2 py-3">
            <SlidingMark variant="row" />
            {renderNav('desktop')}

            <div className="flex-1" />

            <div className="divider-fade mx-1 mb-2 mt-4" />
            <button
              type="button"
              onClick={handleLogout}
              className="nav-item w-full text-txt-danger hover:bg-accent-rose/10 hover:text-txt-danger"
            >
              <Icon name="logout" size={16} className="flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('settings:nav.logOut')}</span>
            </button>

            <div className="px-2.5 pt-2">
              <LegalLinks />
            </div>
          </nav>
        </div>

        {/* Mobile: Tab list */}
        {isMobile && mobileView === 'tabs' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Mobile user card */}
            <div className="rounded-lg border border-border-hard bg-surface-channel p-3 flex items-center gap-3">
              <Avatar
                src={user?.avatar}
                name={user?.displayName || user?.username || ''}
                size={36}
                userId={user?.id}
                avatarColor={user?.avatarColor}
              />
              <div className="min-w-0">
                <div className="truncate text-body font-medium text-txt-primary">{user?.displayName || user?.username}</div>
                <div className="truncate font-mono text-meta text-txt-tertiary">@{user?.username}</div>
              </div>
            </div>

            <nav aria-label={t('common:labels.settings')} className="rounded-lg border border-border-hard bg-surface-channel p-2">
              {renderNav('mobile')}

              <div className="divider-fade mx-1 my-2" />
              <button
                type="button"
                onClick={handleLogout}
                className="nav-item h-11 w-full text-txt-danger hover:bg-accent-rose/10 hover:text-txt-danger"
              >
                <Icon name="logout" size={16} className="flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t('settings:nav.logOut')}</span>
              </button>

              <div className="px-2.5 pt-2">
                <LegalLinks />
              </div>
            </nav>
          </div>
        )}

        {/* Content area (desktop always, mobile only when viewing content) */}
        {(!isMobile || mobileView === 'content') && (
          <SettingsScrollContainer>
            <div className="px-6 max-w-[640px] mx-auto">
              {/* Mobile back button */}
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setMobileView('tabs')}
                  className="btn-quiet -ml-2 mb-4 px-2"
                  aria-label={t('settings:nav.backToMenu')}
                >
                  <Icon name="chevron-left" size={16} />
                  {t('common:labels.settings')}
                </button>
              )}
              <SettingsPanelSuspense key={tab}>
                {panels[tab]()}
              </SettingsPanelSuspense>
            </div>
          </SettingsScrollContainer>
        )}
      </div>
    </Modal>
  );
}
