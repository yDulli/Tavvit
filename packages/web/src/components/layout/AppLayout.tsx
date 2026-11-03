import { SpaceEventsPage } from '../events/SpaceEventsView';
import { SpaceWelcomeGate } from '../modals/SpaceWelcomeGate';
import { useRecentPlacesStore } from '../../stores/recentPlacesStore';
import { useAuthStore } from '../../stores/authStore';
import React, { useEffect } from 'react';
import { isCompactViewport, isMobileViewport } from '../../platform/interfaceScale';
import { useMatch, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { TopBar } from './TopBar';
import { ChannelSidebar } from './ChannelSidebar';
import { MainContent } from './MainContent';
import { AdminConsole, SettingsPanelSuspense } from '../modals/lazySettingsPanels';
import { AnnouncementBar } from '../ui/AnnouncementBar';
import { AmbientLight } from './AmbientLight';
import { PlaceStage } from './PlaceStage';
import { RightPanel } from './RightPanel';
import { ThreadPanel } from '../chat/ThreadPanel';
import { useThreadStore } from '../../stores/threadStore';
import { MobileShell } from './MobileShell';
import { ImagePreview } from '../chat/ImagePreview';
import { CreateSpaceModal } from '../modals/CreateSpace';
import { DiscordImportModal } from '../modals/DiscordImportModal';
import { SpaceProfileModal } from '../modals/SpaceProfileModal';
import { JoinSpaceModal } from '../modals/JoinSpace';
import { CreateChannelModal } from '../modals/CreateChannel';
import { CreateCategoryModal } from '../modals/CreateCategory';
import { InviteModal } from '../modals/InviteModal';
import { ReportModal } from '../legal/ReportForm';
import { ForwardMessageModal } from '../modals/ForwardMessageModal';
import { CreatePollModal } from '../modals/CreatePollModal';
import { UserSettingsModal } from '../modals/UserSettings';
import { SpaceSettingsModal } from '../modals/SpaceSettings';
import { ChannelSettingsModal } from '../modals/ChannelSettingsModal';
import { CategorySettingsModal } from '../modals/CategorySettingsModal';
import { NewDmModal } from '../modals/NewDmModal';
import { AddDmMemberModal } from '../modals/AddDmMemberModal';
import { GroupDmSettings } from '../modals/GroupDmSettings';
import { UserProfileModal } from '../modals/UserProfileModal';
import { ConnectAndJoinModal } from '../modals/ConnectAndJoinModal';
import { MemberRolesModal } from '../modals/MemberRolesModal';
import { IncomingCallModal } from '../voice/IncomingCallModal';
import { PictureInPicture } from '../voice/PictureInPicture';
import { SoundController } from '../voice/SoundController';
import { GlobalAudioRenderer } from '../voice/GlobalAudioRenderer';
import { WatchPlayerHost } from '../voice/WatchPlayerHost';
import { NotificationController } from '../NotificationController';
import { PushController } from '../PushController';
import { UserProfilePopoutLayer } from '../ui/UserProfilePopoutLayer';
import { ToastContainer } from '../ui/ToastContainer';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { EmailPromptBar } from '../ui/EmailPromptBar';
import { QuickSwitcher } from '../ui/QuickSwitcher';
import { UpdateToast } from '../ui/UpdateToast';
import { useAuth } from '../../hooks/useAuth';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useFederationToasts } from '../../hooks/useFederationToasts';
import { useLiveKit } from '../../hooks/useLiveKit';
import { useKeybinds } from '../../hooks/useKeybinds';
import { useDeepLinkHandler } from '../../platform/deepLink';
import { initActivityBridge, teardownActivityBridge } from '../../platform/activityBridge';
import { initCallStateBridge, teardownCallStateBridge } from '../../platform/callStateBridge';
import { useSpaceStore } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { AudioManager } from '../../audio/AudioManager';
import { isAppSystemAudioSource, userDevicesSignature } from '../../utils/systemAudioSource';

export function AppLayout() {
  const { t } = useTranslation('common');
  const { spaceId, channelId } = useParams<{ spaceId?: string; channelId?: string }>();
  const eventsPage = useMatch('/channels/:spaceId/events') !== null;
  const navigate = useNavigate();
  const inAdminConsole = useMatch('/admin/*') !== null;
  const threadOpen = useThreadStore((s) => s.open !== null);
  
  // Global interaction handler to resume AudioContext
  useEffect(() => {
    const resume = () => {
      AudioManager.getInstance().resumeContext().then(() => {
        window.removeEventListener('click', resume);
        window.removeEventListener('keydown', resume);
        window.removeEventListener('touchstart', resume);
      });
    };
    window.addEventListener('click', resume);
    window.addEventListener('keydown', resume);
    window.addEventListener('touchstart', resume);
    return () => {
      window.removeEventListener('click', resume);
      window.removeEventListener('keydown', resume);
      window.removeEventListener('touchstart', resume);
    };
  }, []);

  // MutationObserver: neutralize rogue LiveKit <audio> elements that bypass our Web Audio pipeline.
  // LiveKit can re-attach hidden <audio> elements after .detach(), causing full-volume playback
  // that ignores our volume/mute controls. Any <audio> without data-backspace is immediately killed.
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLAudioElement && !node.dataset.backspace) {
            node.muted = true;
            node.volume = 0;
            node.pause();
            node.srcObject = null;
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Sync persisted output device preference to AudioManager.
  // AudioManager defers setSinkId until the AudioContext is actually created,
  // so this is safe to call before any user interaction.
  const outputDeviceId = useVoiceStore((s) => s.outputDeviceId);
  useEffect(() => {
    AudioManager.getInstance().setOutputDevice(outputDeviceId);
  }, [outputDeviceId]);

  // Audio device hot-plug handler.
  //
  // Three jobs on every devicechange event:
  //   (1) Prune persisted IDs that no longer exist (delegated to voiceStore).
  //   (2) Force re-acquire the live mic stream when the user's chosen input is
  //       'default' AND a stream is already live. Chromium does NOT migrate an
  //       existing getUserMedia track to the new OS-default — it stays bound to
  //       the device that was default at acquisition time. Setting the input
  //       again with 'default' triggers a fresh getUserMedia, which picks up
  //       the new OS default. The downstream syncMic effect republishes.
  //   (3) Force re-apply setSinkId('') for output when 'default' is selected,
  //       for the same reason on the output side.
  //   (4) Toast on a *new* audioinput appearance (debounced + dedupe by groupId).
  //       Removals do not toast — the user already knows they unplugged it.
  useEffect(() => {
    const prune = useVoiceStore.getState().pruneStaleDevices;
    let lastInputGroupIds = new Set<string>();
    const recentToastByGroup = new Map<string, number>(); // groupId -> timestamp ms
    const TOAST_DEBOUNCE_MS = 1000;
    const TOAST_DEDUPE_WINDOW_MS = 30_000;
    let pendingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    // Handler-level debounce: collapses devicechange storms (BT re-pair, USB
    // hub enumeration can fire 5-10x/sec) into a single prune + reacquire pass.
    // The toast logic has its own longer debounce (TOAST_DEBOUNCE_MS) layered
    // on top so user-visible toasts collapse storms even more aggressively.
    let pendingHandlerTimer: ReturnType<typeof setTimeout> | null = null;
    const HANDLER_DEBOUNCE_MS = 250;

    // The system-audio source of a share appears and disappears with the share. It is not a
    // device change the user made, so it must not toast or re-acquire the microphone.
    let lastRealDevices: string | null = null;

    const seedBaseline = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        lastInputGroupIds = new Set(
          devices.filter(d => d.kind === 'audioinput' && d.groupId && !isAppSystemAudioSource(d)).map(d => d.groupId)
        );
        lastRealDevices = userDevicesSignature(devices);
      } catch { /* enumeration may be blocked pre-permission; baseline is empty */ }
    };

    const handleNewDeviceToasts = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const currentInputGroupIds = new Set(
          devices.filter(d => d.kind === 'audioinput' && d.groupId && !isAppSystemAudioSource(d)).map(d => d.groupId)
        );
        const now = Date.now();
        const newGroups: string[] = [];
        for (const gid of currentInputGroupIds) {
          if (lastInputGroupIds.has(gid)) continue;
          const lastToast = recentToastByGroup.get(gid) ?? 0;
          if (now - lastToast < TOAST_DEDUPE_WINDOW_MS) continue;
          newGroups.push(gid);
          recentToastByGroup.set(gid, now);
        }
        // GC dedupe map entries older than the window so it doesn't leak.
        for (const [gid, ts] of recentToastByGroup) {
          if (now - ts > TOAST_DEDUPE_WINDOW_MS) recentToastByGroup.delete(gid);
        }
        lastInputGroupIds = currentInputGroupIds;

        if (newGroups.length > 0) {
          const newest = devices.find(d =>
            d.kind === 'audioinput' && d.groupId && newGroups.includes(d.groupId) && d.label,
          );
          // `i18n.t` rather than the hook's `t`: this closure lives for the
          // component's lifetime and must follow later language changes.
          const label = newest?.label || i18n.t('common:devices.unnamedAudioInput');
          useUIStore.getState().addToast(
            i18n.t('common:devices.newAudioInput', { label }),
            'info',
            6000,
          );
        }
      } catch { /* enumeration failure is non-fatal */ }
    };

    const reacquireLiveStream = async () => {
      const am = AudioManager.getInstance();
      const inputId = useVoiceStore.getState().inputDeviceId;
      const outputId = useVoiceStore.getState().outputDeviceId;
      // Re-acquire input only if user is on 'default' AND a stream is live.
      // Anything else: persisted ID is concrete, stream stays bound correctly.
      if (inputId === 'default' && am.hasActiveStream()) {
        try { await am.setInputDevice('default'); } catch { /* serialized chain handles errors */ }
      }
      if (outputId === 'default') {
        try { await am.setOutputDevice('default'); } catch { /* setSinkId may not exist on Safari */ }
      }
    };

    const handler = () => {
      if (pendingHandlerTimer) clearTimeout(pendingHandlerTimer);
      pendingHandlerTimer = setTimeout(async () => {
        try {
          const signature = userDevicesSignature(await navigator.mediaDevices.enumerateDevices());
          if (signature === lastRealDevices) return;
          lastRealDevices = signature;
        } catch { /* enumeration failure: treat as a change, as before */ }
        await prune();
        await reacquireLiveStream();
        if (pendingDebounceTimer) clearTimeout(pendingDebounceTimer);
        pendingDebounceTimer = setTimeout(() => { handleNewDeviceToasts(); }, TOAST_DEBOUNCE_MS);
      }, HANDLER_DEBOUNCE_MS);
    };

    // Seed baseline so the first event after mount doesn't false-positive every
    // existing device as "new". Register the listener only AFTER baseline is
    // seeded so the first real event compares against a populated set.
    let listenerRegistered = false;
    let cancelled = false;
    seedBaseline()
      .then(() => prune())
      .then(() => {
        if (cancelled) return;
        navigator.mediaDevices.addEventListener('devicechange', handler);
        listenerRegistered = true;
      });
    return () => {
      cancelled = true;
      if (pendingHandlerTimer) clearTimeout(pendingHandlerTimer);
      if (pendingDebounceTimer) clearTimeout(pendingDebounceTimer);
      if (listenerRegistered) {
        navigator.mediaDevices.removeEventListener('devicechange', handler);
      }
    };
  }, []);

  const { user, isLoading } = useAuth();
  const showBootSkeleton = useDelayedLoading(isLoading);
  const setCurrentSpace = useSpaceStore((s) => s.setCurrentSpace);
  const loadSpaceDetail = useSpaceStore((s) => s.loadSpaceDetail);
  const setCurrentChannel = useChatStore((s) => s.setCurrentChannel);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const setIsMobile = useUIStore((s) => s.setIsMobile);
  const setIsCompact = useUIStore((s) => s.setIsCompact);
  const setShowDms = useUIStore((s) => s.setShowDms);

  const isMobile = useUIStore((s) => s.isMobile);
  
  const channels = useSpaceStore((s) => s.channels);

  const {
    connect: connectVoice,
    disconnect: disconnectVoice,
  } = useLiveKit();

  // Register connect/disconnect refs in voiceStore so click handlers can access them
  // without calling useLiveKit() (which would create duplicate Room instances).
  useEffect(() => {
    useVoiceStore.getState().setConnectFn(connectVoice);
    useVoiceStore.getState().setDisconnectFn(disconnectVoice);
    return () => {
      useVoiceStore.getState().setConnectFn(null);
      useVoiceStore.getState().setDisconnectFn(null);
    };
  }, [connectVoice, disconnectVoice]);

  // Initialize WebSocket
  const { isConnected: homeConnected } = useWebSocket();

  // Federation toast notifications for remote instance connection state changes
  useFederationToasts();

  // Keybinds handler
  useKeybinds();

  // Deep link handler for Electron (tavvit:// protocol)
  useDeepLinkHandler();

  // Electron activity detection bridge (game/app process scanning → activityStore)
  useEffect(() => {
    initActivityBridge();
    return () => teardownActivityBridge();
  }, []);

  // Electron update timing: the desktop app installs a downloaded update by
  // itself, never while a voice session is open (platform/callStateBridge.ts).
  useEffect(() => {
    initCallStateBridge();
    return () => teardownCallStateBridge();
  }, []);

  // Responsive detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(isMobileViewport());
      setIsCompact(isCompactViewport());
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setIsMobile, setIsCompact]);

  // Handle route params
  useEffect(() => {
    if (spaceId === '@me') {
      setShowDms(true);
      setCurrentSpace(null);
    } else if (spaceId) {
      setShowDms(false);
      setCurrentSpace(spaceId);
      loadSpaceDetail(spaceId);
    } else {
      setShowDms(false);
      setCurrentSpace(null);
    }
  }, [spaceId, setCurrentSpace, loadSpaceDetail, setShowDms]);

  useEffect(() => {
    if (channelId) {
      setCurrentChannel(channelId);
      loadMessages(channelId);
      if (spaceId && spaceId !== '@me') {
        useUIStore.getState().setLastChannel(spaceId, channelId);
      }
    } else {
      setCurrentChannel(null);
    }
  }, [channelId, spaceId, setCurrentChannel, loadMessages]);

  useEffect(() => {
    if (eventsPage) useThreadStore.getState().closeThread();
  }, [eventsPage]);

  // Remember where the user was, for Home's "Pick up where you left off".
  const signedInUserId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!signedInUserId || !spaceId || !channelId) return;
    useRecentPlacesStore.getState().visit(signedInUserId, { channelId, spaceId: spaceId === '@me' ? null : spaceId });
  }, [signedInUserId, spaceId, channelId]);

  // Auto-select last visited (or first) channel when opening a server without a channelId.
  // Desktop-only: on mobile, `/channels/<spaceId>` should leave the user at the channel
  // sidebar overview (MobileSpacesScreen), not auto-jump into a text channel — otherwise
  // joining a space via SpaceInviteCard or tapping the Spaces bottom-nav tab catapults the
  // user past the sidebar straight into a chat screen, with no clean back path.
  useEffect(() => {
    if (useUIStore.getState().isMobile) return;
    if (!spaceId || spaceId === '@me' || channelId || eventsPage) return;
    if (channels.length === 0) return;

    const firstChannel = channels[0];
    if (!firstChannel) return;

    // Guard: only redirect when channels belong to the target server.
    // `channels` is shared per-view state set by loadSpaceDetail (async).
    // Without this check, stale channels from a previously viewed server
    // would cause a wrong redirect during the fetch window.
    const { channelToSpaceMap } = useSpaceStore.getState();
    if (channelToSpaceMap.get(firstChannel.id) !== spaceId) return;

    const lastId = useUIStore.getState().lastChannelPerSpace[spaceId];
    const target = (lastId && channels.find((c) => c.id === lastId)) || firstChannel;
    if (target) {
      navigate(`/channels/${spaceId}/${target.id}`, { replace: true });
    }
  }, [spaceId, channelId, channels, navigate, eventsPage]);

  // Guard: redirect when URL channelId no longer exists (deleted, permission revoked, etc.)
  useEffect(() => {
    if (!spaceId || spaceId === '@me' || !channelId) return;
    if (channels.length === 0) return;

    const { channelToSpaceMap } = useSpaceStore.getState();
    const firstCh = channels[0];
    if (!firstCh || channelToSpaceMap.get(firstCh.id) !== spaceId) return;

    if (!channels.some(c => c.id === channelId)) {
      navigate(`/channels/${spaceId}`, { replace: true });
    }
  }, [spaceId, channelId, channels, navigate]);

  if (!user || showBootSkeleton) {
    return (
      <div className="h-full flex flex-col bg-surface-base" role="status" aria-label={t('app.loading')}>
        {/* Top bar */}
        <div className="hidden desktop:flex h-[var(--topbar-height)] flex-shrink-0 items-center gap-3 border-b border-border-hard px-4">
          <div className="skeleton w-5 h-5 rounded" />
          <div className="skeleton skeleton-bar w-16 h-3" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton skeleton-bar h-3" style={{ width: `${64 + (i * 23) % 40}px`, animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[var(--sidebar-width)] hidden desktop:flex flex-shrink-0 flex-col border-r border-border-hard bg-surface-channel pt-4 px-3">
            <div className="skeleton skeleton-bar w-[55%] h-3.5 mb-6 ml-1" />
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-2 px-1 py-2" style={{ animationDelay: `${i * 0.08}s` }}>
                <div className="skeleton w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ animationDelay: `${i * 0.08}s` }} />
                <div className="skeleton skeleton-bar flex-1" style={{ width: `${45 + (i * 11) % 35}%`, animationDelay: `${i * 0.08}s` }} />
              </div>
            ))}
          </div>

          {/* Main chat area */}
          <div className="flex-1 flex flex-col bg-surface-chat">
            <div className="h-[var(--topbar-height)] flex items-center px-5 border-b border-border-hard">
              <div className="skeleton skeleton-bar w-32 h-3.5" />
            </div>

            {/* Messages area, bottom-aligned */}
            <div className="flex-1 flex flex-col justify-end px-5 pb-6">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex gap-3 mb-5" style={{ animationDelay: `${i * 0.12}s` }}>
                  <div className="skeleton w-8 h-8 rounded flex-shrink-0" style={{ animationDelay: `${i * 0.12}s` }} />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="skeleton skeleton-bar" style={{ width: `${20 + (i * 7) % 20}%`, animationDelay: `${i * 0.12}s` }} />
                    <div className="skeleton skeleton-bar h-2.5" style={{ width: `${50 + (i * 13) % 40}%`, animationDelay: `${i * 0.12}s` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Mobile layout ──
  if (isMobile) {
    return (
      <>
        <AmbientLight />
        <ConnectionBanner connected={homeConnected} />
        <QuickSwitcher />
        {inAdminConsole ? <SettingsPanelSuspense><AdminConsole /></SettingsPanelSuspense> : <MobileShell />}
        {/* Modals still render globally for both mobile and desktop */}
        <CreateSpaceModal />
        <DiscordImportModal />
        <SpaceProfileModal />
        <JoinSpaceModal />
        <CreateChannelModal />
        <CreateCategoryModal />
        <InviteModal />
        <ReportModal />
      <ForwardMessageModal />
      <CreatePollModal />
        <ForwardMessageModal />
      <CreatePollModal />
        <CreatePollModal />
        {/* UserSettings is a pushed screen on mobile (MobileSettingsScreen), not a modal */}
        <SpaceSettingsModal />
        <ChannelSettingsModal />
        <CategorySettingsModal />
        <NewDmModal />
        <AddDmMemberModal />
        <GroupDmSettings />
        <UserProfileModal />
        <ConnectAndJoinModal />
        {/* MemberRolesModal is desktop-only: it opens from the profile card's
            Edit Roles, and its two-pane layout has no mobile form. */}
        <IncomingCallModal />
        <ImagePreview />
        {/* PictureInPicture is desktop-only. Mobile has its own purpose-built
            voice chrome (MobileVoiceMiniBar + MobileVoiceFullScreen) mounted
            inside MobileShell. Mounting PiP here too caused a "PiP-style grey
            view" to appear on top of the mobile shell whenever a voice call
            was connected but the voice-full screen was not on the stack
            (e.g. immediately after Join, or after popping voice-full back to
            the root). */}
        <SoundController />
        <GlobalAudioRenderer />
        <WatchPlayerHost />
        <NotificationController />
        <PushController />
        <SpaceWelcomeGate />
        <UpdateToast />
        <ToastContainer />
      </>
    );
  }

  // ── Desktop layout ──
  // The top bar holds every place (Home and the spaces, as tabs) and the
  // person's own controls; under it sit the channel column, the conversation
  // and the people on the right, parted by hairlines, with one light across them.
  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-base">
      <AmbientLight />
      <ConnectionBanner connected={homeConnected} />
      <EmailPromptBar />
      <AnnouncementBar />
      <QuickSwitcher />
      <TopBar />

      <div className="relative flex min-h-0 flex-1">
        {inAdminConsole ? (
          <SettingsPanelSuspense><AdminConsole /></SettingsPanelSuspense>
        ) : (
          <>
            <ChannelSidebar />
            <main className="lit flex min-w-0 min-h-0 flex-1 bg-surface-chat">
              <PlaceStage>
                {eventsPage && spaceId ? <SpaceEventsPage spaceId={spaceId} /> : <MainContent />}
              </PlaceStage>
            </main>
            {threadOpen && !eventsPage ? <ThreadPanel /> : <RightPanel />}
          </>
        )}
      </div>

      {/* Modals */}
      <CreateSpaceModal />
      <DiscordImportModal />
      <SpaceProfileModal />
      <JoinSpaceModal />
      <CreateChannelModal />
      <CreateCategoryModal />
      <InviteModal />
      <ReportModal />
      <ForwardMessageModal />
      <CreatePollModal />
      <UserSettingsModal />
      <SpaceSettingsModal />
      <ChannelSettingsModal />
      <CategorySettingsModal />
      <NewDmModal />
      <AddDmMemberModal />
      <GroupDmSettings />
      <UserProfileModal />
      <ConnectAndJoinModal />
      <MemberRolesModal />
      <IncomingCallModal />
      <ImagePreview />
      <PictureInPicture />
      <SoundController />
      <GlobalAudioRenderer />
      <WatchPlayerHost />
      <NotificationController />
      <PushController />
      <SpaceWelcomeGate />
      <UpdateToast />

      <UserProfilePopoutLayer />

      {/* Federation toasts render through ToastContainer below (raised by the
          useFederationToasts() hook above); this also mounts the instance
          update toast. */}
      <ToastContainer />
    </div>
  );
}
