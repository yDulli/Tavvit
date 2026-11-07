import { Component, lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';

// The settings panels (user, instance administration and space settings) are
// loaded on demand: none of them is needed to draw the first screen, and
// together they are a large part of what would otherwise be the main chunk,
// which has to stay under the service worker's precache limit (see
// `src/build/precache.ts`). Each import below becomes its own chunk. The
// chunks are still precached, so an installed app opens them offline.
//
// Every surface that shows a panel imports it from here, the desktop modals
// and the mobile screens alike. A static import of a panel anywhere else in
// the main chunk's import graph would pull it back into that chunk.

/**
 * A panel chunk that could not be fetched: after a redeploy removed the old
 * build's files, on a page no service worker serves, or offline before the
 * chunk was cached. Tagged so the panel boundary can tell it apart from a bug
 * in a panel, which must still reach the app's own error boundary.
 */
export class PanelLoadError extends Error {
  constructor(cause: unknown) {
    super('A settings panel failed to load', { cause });
    this.name = 'PanelLoadError';
  }
}

/**
 * `React.lazy` for a named export. A rejected import is rethrown as a
 * {@link PanelLoadError}.
 */
export function lazyPanel<M, P extends object>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => load().then(
    (module) => ({ default: pick(module) }),
    (error: unknown) => { throw new PanelLoadError(error); },
  ));
}

export const AccountPanel = lazyPanel(() => import('./settingsPanels/AccountPanel'), (m) => m.AccountPanel);
export const AppearancePanel = lazyPanel(() => import('./settingsPanels/AppearancePanel'), (m) => m.AppearancePanel);
export const SecurityPanel = lazyPanel(() => import('./settingsPanels/SecurityPanel'), (m) => m.SecurityPanel);
export const AccessibilityPanel = lazyPanel(() => import('./settingsPanels/AccessibilityPanel'), (m) => m.AccessibilityPanel);
export const LanguagePanel = lazyPanel(() => import('./settingsPanels/LanguagePanel'), (m) => m.LanguagePanel);
export const NotificationsPanel = lazyPanel(() => import('./settingsPanels/NotificationsPanel'), (m) => m.NotificationsPanel);
export const YourSpacePanel = lazyPanel(() => import('./spaceSettingsPanels/YourSpacePanel'), (m) => m.YourSpacePanel);
export const VoicePanel = lazyPanel(() => import('./settingsPanels/VoicePanel'), (m) => m.VoicePanel);
export const GamesPanel = lazyPanel(() => import('./settingsPanels/GamesPanel'), (m) => m.GamesPanel);
export const EmojiSettingsPanel = lazyPanel(() => import('./settingsPanels/EmojiSettingsPanel'), (m) => m.EmojiSettingsPanel);
export const PrivacyPanel = lazyPanel(() => import('./settingsPanels/PrivacyPanel'), (m) => m.PrivacyPanel);
export const LinkedAccountsPanel = lazyPanel(() => import('./settingsPanels/LinkedAccountsPanel'), (m) => m.LinkedAccountsPanel);
export const ConnectionsPanel = lazyPanel(() => import('./settingsPanels/ConnectionsPanel'), (m) => m.ConnectionsPanel);
export const KeybindsPanel = lazyPanel(() => import('./settingsPanels/KeybindsPanel'), (m) => m.KeybindsPanel);
export const DesktopPanel = lazyPanel(() => import('./settingsPanels/DesktopPanel'), (m) => m.DesktopPanel);

export const GeneralPanel = lazyPanel(() => import('./instanceSettingsPanels/GeneralPanel'), (m) => m.GeneralPanel);
export const RegistrationPanel = lazyPanel(() => import('./instanceSettingsPanels/RegistrationPanel'), (m) => m.RegistrationPanel);
export const FederationPanel = lazyPanel(() => import('./instanceSettingsPanels/FederationPanel'), (m) => m.FederationPanel);
export const StreamingPanel = lazyPanel(() => import('./instanceSettingsPanels/StreamingPanel'), (m) => m.StreamingPanel);
export const StoragePanel = lazyPanel(() => import('./instanceSettingsPanels/StoragePanel'), (m) => m.StoragePanel);
export const UsersPanel = lazyPanel(() => import('./instanceSettingsPanels/UsersPanel'), (m) => m.UsersPanel);
export const ReviewQueuePanel = lazyPanel(() => import('./instanceSettingsPanels/ReviewQueuePanel'), (m) => m.ReviewQueuePanel);
export const PlatformSpacesPanel = lazyPanel(() => import('./instanceSettingsPanels/PlatformSpacesPanel'), (m) => m.PlatformSpacesPanel);
export const PlatformAuditPanel = lazyPanel(() => import('./instanceSettingsPanels/PlatformAuditPanel'), (m) => m.PlatformAuditPanel);
export const ReportsPanel = lazyPanel(() => import('./instanceSettingsPanels/ReportsPanel'), (m) => m.ReportsPanel);
export const LegalPanel = lazyPanel(() => import('./instanceSettingsPanels/LegalPanel'), (m) => m.LegalPanel);
export const EmailPanel = lazyPanel(() => import('./instanceSettingsPanels/EmailPanel'), (m) => m.EmailPanel);
export const AdminConsole = lazyPanel(() => import('../admin/AdminConsole'), (m) => m.AdminConsole);

export const OverviewPanel = lazyPanel(() => import('./spaceSettingsPanels/OverviewPanel'), (m) => m.OverviewPanel);
export const MembersPanel = lazyPanel(() => import('./spaceSettingsPanels/MembersPanel'), (m) => m.MembersPanel);
export const RolesPanel = lazyPanel(() => import('./spaceSettingsPanels/RolesPanel'), (m) => m.RolesPanel);
export const InvitesPanel = lazyPanel(() => import('./spaceSettingsPanels/InvitesPanel'), (m) => m.InvitesPanel);
export const BansPanel = lazyPanel(() => import('./spaceSettingsPanels/BansPanel'), (m) => m.BansPanel);
export const ModerationPanel = lazyPanel(() => import('./spaceSettingsPanels/ModerationPanel'), (m) => m.ModerationPanel);
export const AuditLogPanel = lazyPanel(() => import('./spaceSettingsPanels/AuditLogPanel'), (m) => m.AuditLogPanel);
export const VerificationPanel = lazyPanel(() => import('./spaceSettingsPanels/VerificationPanel'), (m) => m.VerificationPanel);
export const EmojiStickersPanel = lazyPanel(() => import('./spaceSettingsPanels/EmojiStickersPanel'), (m) => m.EmojiStickersPanel);
export const DiscordMovePanel = lazyPanel(() => import('./spaceSettingsPanels/DiscordMovePanel'), (m) => m.DiscordMovePanel);
export const SoundsPanel = lazyPanel(() => import('./spaceSettingsPanels/SoundsPanel'), (m) => m.SoundsPanel);
export const WelcomePanel = lazyPanel(() => import('./spaceSettingsPanels/WelcomePanel'), (m) => m.WelcomePanel);

/**
 * Holds the panel's place while its chunk loads. The block has a fixed height
 * whether or not the spinner shows, and the spinner only appears after the
 * usual loading delay, so a chunk served from the service worker's cache
 * swaps in without a flash.
 */
function SettingsPanelFallback() {
  const { t } = useTranslation('common');
  const showSpinner = useDelayedLoading(true);
  return (
    <div className="flex items-center justify-center h-64 text-txt-tertiary" role="status" aria-label={t('states.loading')}>
      {showSpinner && <LoadingSpinner size={28} />}
    </div>
  );
}

/**
 * What a panel shows when its chunk could not be fetched: the failed-load
 * treatment the settings panels already use. `React.lazy` keeps the rejected
 * import, so trying again in place cannot succeed; a reload fetches the
 * current build.
 */
function SettingsPanelLoadFailed() {
  const { t } = useTranslation('common');
  return (
    <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm flex flex-wrap items-center gap-3">
      <span>{t('states.loadSettingsFailed')}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="font-medium underline underline-offset-2 hover:no-underline transition-all"
      >
        {t('crash.reload')}
      </button>
    </div>
  );
}

/**
 * Keeps a failed panel chunk inside the panel area, so the rest of the app,
 * and a call in progress, stays up. Any other error is rethrown to the app's
 * error boundary.
 */
class PanelLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown): { failed: boolean } {
    if (error instanceof PanelLoadError) return { failed: true };
    throw error;
  }

  componentDidCatch(error: unknown): void {
    console.warn('[settings] panel failed to load:', error instanceof PanelLoadError ? error.cause : error);
  }

  render() {
    return this.state.failed ? <SettingsPanelLoadFailed /> : this.props.children;
  }
}

/**
 * The boundary every lazily loaded settings panel renders inside. Callers key
 * it by the open tab, so a failed tab does not block the others.
 */
export function SettingsPanelSuspense({ children }: { children: ReactNode }) {
  return (
    <PanelLoadBoundary>
      <Suspense fallback={<SettingsPanelFallback />}>{children}</Suspense>
    </PanelLoadBoundary>
  );
}
