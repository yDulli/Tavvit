import { DevelopersPanel } from '../modals/settingsPanels/DevelopersPanel';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
  ConnectionsPanel,
  GamesPanel,
  EmojiSettingsPanel,
  PrivacyPanel,
  LinkedAccountsPanel,
  KeybindsPanel,
  DesktopPanel,
  SettingsPanelSuspense,
} from '../modals/lazySettingsPanels';
import { Icon, type IconName } from '../ui/Icon';
import { MobileScreenHeader } from './MobileScreenHeader';
import { MobileNavRow } from './MobileNavRow';
import { PANEL_BODY } from './mobileClasses';
import { TransferIndicator } from './TransferIndicator';
import { isElectron } from '../../platform/platform';
import { useFederationEnabled } from '../../hooks/useFederationEnabled';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { useLinkedAccountsStore } from '../../stores/linkedAccountsStore';

interface MobileSettingsScreenProps {
  initialPanel?: string;
}

type PanelTitleKey =
  | 'settings:nav.tabs.account'
  | 'settings:nav.tabs.decorations'
  | 'settings:nav.tabs.security'
  | 'settings:nav.tabs.appearance'
  | 'settings:nav.tabs.accessibility'
  | 'settings:nav.tabs.language'
  | 'settings:nav.tabs.notifications'
  | 'settings:nav.tabs.voice'
  | 'settings:nav.tabs.games'
  | 'settings:nav.tabs.emoji'
  | 'settings:nav.tabs.privacy'
  | 'settings:nav.tabs.linkedAccounts'
  | 'settings:nav.tabs.connections'
  | 'settings:nav.tabs.keybinds'
  | 'settings:nav.tabs.developers'
  | 'settings:nav.tabs.desktop';

/**
 * Every panel this screen can open directly: its header title and its body.
 */
const panelConfig: Record<
  string,
  { titleKey: PanelTitleKey; body: () => React.ReactNode }
> = {
  account: { titleKey: 'settings:nav.tabs.account', body: () => <AccountPanel /> },
  decorations: { titleKey: 'settings:nav.tabs.decorations', body: () => <DecorationsPanel /> },
  security: { titleKey: 'settings:nav.tabs.security', body: () => <SecurityPanel /> },
  appearance: { titleKey: 'settings:nav.tabs.appearance', body: () => <AppearancePanel /> },
  accessibility: { titleKey: 'settings:nav.tabs.accessibility', body: () => <AccessibilityPanel /> },
  language: { titleKey: 'settings:nav.tabs.language', body: () => <LanguagePanel /> },
  notifications: { titleKey: 'settings:nav.tabs.notifications', body: () => <NotificationsPanel /> },
  voice: { titleKey: 'settings:nav.tabs.voice', body: () => <VoicePanel /> },
  games: { titleKey: 'settings:nav.tabs.games', body: () => <GamesPanel /> },
  emoji: { titleKey: 'settings:nav.tabs.emoji', body: () => <EmojiSettingsPanel /> },
  privacy: { titleKey: 'settings:nav.tabs.privacy', body: () => <PrivacyPanel /> },
  linkedAccounts: { titleKey: 'settings:nav.tabs.linkedAccounts', body: () => <LinkedAccountsPanel /> },
  connections: { titleKey: 'settings:nav.tabs.connections', body: () => <ConnectionsPanel /> },
  developers: { titleKey: 'settings:nav.tabs.developers', body: () => <DevelopersPanel /> },
  keybinds: { titleKey: 'settings:nav.tabs.keybinds', body: () => <KeybindsPanel /> },
  desktop: { titleKey: 'settings:nav.tabs.desktop', body: () => <DesktopPanel /> },
};

const sectionIcons: Record<string, IconName> = {
  account: 'user',
  decorations: 'sparkle',
  security: 'lock',
  appearance: 'palette',
  accessibility: 'info',
  language: 'globe',
  notifications: 'bell',
  voice: 'mic',
  games: 'play',
  emoji: 'smile',
  privacy: 'shield',
  linkedAccounts: 'check',
  connections: 'link',
  keybinds: 'grid',
  developers: 'link',
  desktop: 'monitor',
};

/** The way to the admin console, which is a page of its own and not a screen of the settings. */
function AdminConsoleNavRow() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  return <MobileNavRow icon={<Icon name="shield" size={18} />} label={t('nav.tabs.instance')} onClick={() => navigate('/admin')} />;
}

export function MobileSettingsScreen({ initialPanel }: MobileSettingsScreenProps) {
  const { t } = useTranslation(['mobile', 'settings', 'common']);
  const pushMobileScreen = useUIStore((s) => s.pushMobileScreen);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const federation = useFederationEnabled() === true;
  // As in the settings modal: while the home links accounts elsewhere, or one is still linked.
  const linkable = (useHomeInstanceInfo()?.linkedAccounts?.length ?? 0) > 0;
  const stillLinked = (useLinkedAccountsStore((s) => s.accounts)?.length ?? 0) > 0;
  const showsLinked = (useAuthStore((s) => s.user?.linkedAccounts)?.length ?? 0) > 0;
  const linkedAccounts = linkable || stillLinked || showsLinked;

  // If initialPanel is set, render that panel directly
  if (initialPanel) {
    const panel = panelConfig[initialPanel];
    if (!panel) return null;
    if (initialPanel === 'connections' && !federation) return null;
    if (initialPanel === 'desktop' && !isElectron()) return null;

    return (
      <div className="flex flex-col h-full bg-surface-base">
        <MobileScreenHeader title={t(panel.titleKey)} rightActions={<TransferIndicator />} />
        <div className={PANEL_BODY}>
          <SettingsPanelSuspense key={initialPanel}>{panel.body()}</SettingsPanelSuspense>
        </div>
      </div>
    );
  }

  // Settings section list, mirroring the settings modal. Connections only where
  // the instance federates; Keybinds and Desktop only inside the desktop app: a
  // keybind recorded in a browser tab would never fire, and the Desktop panel
  // is that app's own settings.
  const sections = [
    { id: 'account', label: t('settings:nav.tabs.account') },
    { id: 'decorations', label: t('settings:nav.tabs.decorations') },
    { id: 'security', label: t('settings:nav.tabs.security') },
    { id: 'privacy', label: t('settings:nav.tabs.privacy') },
    ...(linkedAccounts ? [{ id: 'linkedAccounts', label: t('settings:nav.tabs.linkedAccounts') }] : []),
    { id: 'notifications', label: t('settings:nav.tabs.notifications') },
    { id: 'appearance', label: t('settings:nav.tabs.appearance') },
    { id: 'accessibility', label: t('settings:nav.tabs.accessibility') },
    { id: 'language', label: t('settings:nav.tabs.language') },
    { id: 'voice', label: t('settings:nav.tabs.voice') },
    { id: 'emoji', label: t('settings:nav.tabs.emoji') },
    { id: 'games', label: t('settings:nav.tabs.games') },
    { id: 'developers', label: t('settings:nav.tabs.developers') },
    ...(federation ? [{ id: 'connections', label: t('settings:nav.tabs.connections') }] : []),
    ...(isElectron() ? [{ id: 'keybinds', label: t('settings:nav.tabs.keybinds') }] : []),
    ...(isElectron() ? [{ id: 'desktop', label: t('settings:nav.tabs.desktop') }] : []),
  ];

  return (
    <div className="flex flex-col h-full bg-surface-channel">
      <MobileScreenHeader title={t('common:labels.settings')} rightActions={<TransferIndicator />} />
      <div className="flex-1 overflow-y-auto py-1">
        {sections.map((section) => (
          <MobileNavRow
            key={section.id}
            icon={<Icon name={sectionIcons[section.id] ?? 'settings'} size={18} />}
            label={section.label}
            onClick={() => pushMobileScreen(`settings-${section.id}`)}
          />
        ))}
        {isAdmin && <AdminConsoleNavRow />}
      </div>
    </div>
  );
}
