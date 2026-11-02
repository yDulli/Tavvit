import { AnnouncementBar } from '../ui/AnnouncementBar';
import { EmailPromptBar } from '../ui/EmailPromptBar';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useMobileRouteSync } from '../../hooks/useMobileRouteSync';
import { MobileScreenStack } from './MobileScreenStack';
import { MobileBottomNav } from './MobileBottomNav';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { useVisualViewportInset } from '../../hooks/useVisualViewportInset';

import { MobileSpacesScreen } from './MobileSpacesScreen';
import { MobileDmsScreen } from './MobileDmsScreen';
import { MobileYouScreen } from './MobileYouScreen';
import { MobileChatScreen } from './MobileChatScreen';
import { MobileSettingsScreen } from './MobileSettingsScreen';
import { MobileScreenHeader } from './MobileScreenHeader';
import { MobileVoiceMiniBar } from './MobileVoiceMiniBar';
import { MobileVoiceFullScreen } from './MobileVoiceFullScreen';
import { MobileMembersScreen } from './MobileMembersScreen';
import { MobileGroupDmInfo } from './MobileGroupDmInfo';
import { FriendsPage } from '../chat/FriendsPage';
import { AboutPage } from '../about/AboutPage';
import { ExplorePage } from '../chat/ExplorePage';
import { InboxPage } from '../inbox/InboxPage';
import { MobileThreadScreen } from './MobileThreadScreen';
import { MobileEventsScreen } from './MobileEventsScreen';
import { UserProfileModal } from '../modals/UserProfileModal';
import { HOME_ROUTES } from '../../utils/homeNav';

/**
 * The About page as a pushed screen: the screen header in place of the page's
 * own top bar.
 */
export function MobileAboutScreen() {
  const { t } = useTranslation('home');
  return (
    <div className="flex flex-col h-full bg-surface-base">
      <MobileScreenHeader title={t('nav.about')} />
      {/* min-h-0 lets this fill only what the header leaves: the page's root
          is h-full, which as a direct flex item would floor its height at the
          whole screen and push its last 48px under the stack's clip. */}
      <div className="flex-1 min-h-0 flex flex-col"><AboutPage showTopBar={false} /></div>
    </div>
  );
}

/**
 * The inbox as a pushed screen: the screen header names it, and the page
 * keeps only its tabs and its bulk action in the bar below.
 */
export function MobileInboxScreen() {
  const { t } = useTranslation('home');
  return (
    <div className="flex flex-col h-full bg-surface-base">
      <MobileScreenHeader title={t('nav.inbox')} />
      {/* As for About: min-h-0 keeps the page's h-full root to the room the header leaves. */}
      <div className="flex-1 min-h-0 flex flex-col"><InboxPage showTopBar={false} /></div>
    </div>
  );
}

/**
 * A person's profile as a pushed screen: the profile dialog, opened once when
 * the screen mounts. `origin` is the instance whose id `userId` is; a profile
 * opened for a space member carries that member, so the dialog can show their
 * roles and read their user from the space rather than the home instance.
 * Opening it from an effect, not while rendering, keeps a re-render or the
 * screen's slide-out from reopening it over a dialog that replaced it.
 */
function MobileUserProfileScreen({ params }: { params?: Record<string, string> }) {
  const userId = params?.userId;
  const origin = params?.origin ?? '';
  const spaceId = params?.spaceId;
  const memberUserId = params?.memberUserId;

  useEffect(() => {
    if (!userId) return;
    const member = spaceId && memberUserId ? { spaceId, userId: memberUserId } : null;
    useUIStore.getState().openModal('userProfile', { userId, origin, member });
  }, [userId, origin, spaceId, memberUserId]);

  return <UserProfileModal />;
}

/**
 * The pages of the home area that are screens of their own on the phone. An
 * address that names one (a deep link, a reload, the quick switcher's Inbox,
 * a desktop window narrowed into the phone layout) opens its screen.
 */
const HOME_PAGE_SCREENS: Readonly<Record<string, string>> = {
  [HOME_ROUTES.inbox]: 'inbox',
  [HOME_ROUTES.friends]: 'friends',
  [HOME_ROUTES.explore]: 'explore',
  [HOME_ROUTES.about]: 'about',
};

export const mobileScreenMap: Readonly<Record<string, (params?: Record<string, string>) => React.ReactNode>> = {
  'channel-chat': (params) => <MobileChatScreen params={params} />,
  'friends': () => <FriendsPage mobile />,
  'settings': () => <MobileSettingsScreen />,
  'settings-account': () => <MobileSettingsScreen initialPanel="account" />,
  'settings-security': () => <MobileSettingsScreen initialPanel="security" />,
  'settings-appearance': () => <MobileSettingsScreen initialPanel="appearance" />,
  'settings-accessibility': () => <MobileSettingsScreen initialPanel="accessibility" />,
  'settings-language': () => <MobileSettingsScreen initialPanel="language" />,
  'settings-notifications': () => <MobileSettingsScreen initialPanel="notifications" />,
  'settings-voice': () => <MobileSettingsScreen initialPanel="voice" />,
  'settings-games': () => <MobileSettingsScreen initialPanel="games" />,
  'settings-emoji': () => <MobileSettingsScreen initialPanel="emoji" />,
  'settings-privacy': () => <MobileSettingsScreen initialPanel="privacy" />,
  'settings-connections': () => <MobileSettingsScreen initialPanel="connections" />,
  'settings-keybinds': () => <MobileSettingsScreen initialPanel="keybinds" />,
  'settings-developers': () => <MobileSettingsScreen initialPanel="developers" />,
  'settings-desktop': () => <MobileSettingsScreen initialPanel="desktop" />,
  'members': (params) => <MobileMembersScreen params={params} />,
  'group-dm-info': (params) => <MobileGroupDmInfo params={params} />,
  'thread': (params) => <MobileThreadScreen params={params} />,
  'space-events': (params) => <MobileEventsScreen params={params} />,
  'voice-full': () => <MobileVoiceFullScreen />,
  'explore': () => <ExplorePage />,
  'about': () => <MobileAboutScreen />,
  'inbox': () => <MobileInboxScreen />,
  'user-profile': (params) => <MobileUserProfileScreen params={params} />,
};

export function MobileShell() {
  const mobileScreen = useUIStore((s) => s.mobileScreen);
  const popMobileScreen = useUIStore((s) => s.popMobileScreen);
  const mobileStack = useUIStore((s) => s.mobileStack);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const location = useLocation();

  // Edge swipe back gesture
  useSwipeGesture({
    onSwipeRight: () => {
      if (mobileStack.length > 0) {
        popMobileScreen();
      }
    },
    enabled: mobileStack.length > 0,
  });

  useMobileRouteSync(location.pathname);

  // A home page's address opens its screen. The stack is read when the
  // address changes, not subscribed to, so pushing another screen on top
  // never brings this one back; one already on top is not pushed twice. Going
  // back to such an address (a POP after the first render) is leaving the
  // screen that was above it, so it does not open the page's screen again.
  const navigationType = useNavigationType();
  const routedOnceRef = useRef(false);
  useEffect(() => {
    const firstRoute = !routedOnceRef.current;
    routedOnceRef.current = true;
    if (!firstRoute && navigationType === 'POP') return;
    const screen = HOME_PAGE_SCREENS[location.pathname];
    if (!screen) return;
    const { mobileStack: stack, pushMobileScreen } = useUIStore.getState();
    if (stack.at(-1)?.screen === screen) return;
    pushMobileScreen(screen);
  }, [location.pathname, navigationType]);

  // Sync browser back button with mobile stack
  useEffect(() => {
    const handlePopState = () => {
      if (useUIStore.getState().mobileStack.length > 0) {
        popMobileScreen();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [popMobileScreen]);

  const rootScreens: Record<string, React.ReactNode> = {
    spaces: <MobileSpacesScreen />, // i18n-check: allow-literal (object keys, not JSX text)
    dms: <MobileDmsScreen />, // i18n-check: allow-literal (object keys, not JSX text)
    you: <MobileYouScreen />,
  };

  // Size the shell to the visual viewport when the iOS soft keyboard is open
  // so a `position: absolute; bottom: 0` child (the chat composer) lands on
  // the keyboard's top edge — independent of how reliably the
  // `visualViewport.resize` event fires in standalone PWA mode. When the
  // keyboard is closed we use `100dvh` so the shell extends through the
  // home-indicator safe area as designed. See `useVisualViewportInset` for
  // the iOS-PWA-specific fallback (focusin polling) that updates `height`
  // even when no `resize` event ever lands.
  const { keyboardOpen, height: vvHeight } = useVisualViewportInset();
  const shellHeight = keyboardOpen && vvHeight !== null ? `${vvHeight}px` : 'calc(100*var(--app-dvh))';

  return (
    <div className="flex flex-col" style={{ height: shellHeight }}>
      <EmailPromptBar />
      <AnnouncementBar />
      <MobileScreenStack
        rootScreen={rootScreens[mobileScreen]}
        screenMap={mobileScreenMap}
      />

      {/* Voice mini-bar: shown in a voice channel or a DM call */}
      {(currentVoiceChannelId || activeDmCall) && <MobileVoiceMiniBar />}

      {/* Bottom nav — MobileBottomNav hides itself when stack is non-empty */}
      <MobileBottomNav />
    </div>
  );
}
