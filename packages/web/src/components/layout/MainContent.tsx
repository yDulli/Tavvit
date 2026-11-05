import { ForumView } from '../chat/ForumView';
import { FollowChannelButton } from '../chat/FollowChannelButton';
import { ChannelIcon } from '../ui/ChannelIcon';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams, useParams } from 'react-router-dom';
import { useSpaceStore } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { VoiceGrid } from '../voice/VoiceGrid';
import { VoiceControlBar } from '../voice/VoiceControlBar';
import { VoiceChatPanel } from '../voice/VoiceChatPanel';
import { FriendsPage } from '../chat/FriendsPage';
import { ExplorePage } from '../chat/ExplorePage';
import { HomePage } from '../home/HomePage';
import { AboutPage } from '../about/AboutPage';
import { InboxPage } from '../inbox/InboxPage';
import { HOME_ROUTES, showsHomeDashboard } from '../../utils/homeNav';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
import { useVoiceStore } from '../../stores/voiceStore';
import { canStartDmCall, startDmCall, cancelOutgoingDmCall, isDmCallRunning, joinDmCall } from '../../utils/voiceActions';
import { useActiveDmCall } from '../../hooks/useActiveDmCall';
import { MemberListToggleButton } from './MemberListToggleButton';
import { TransferIndicator } from './TransferIndicator';
import { isMine, isFederationGlobeApplicable, userDisplayName } from '../../utils/identity';
import { useDmViewer } from '../../hooks/useDmViewer';
import { formatDmHeaderName, formatDmInputLabel, isDeletedPartnerDm } from '../../utils/dmFormatters';
import { DmDeletedNotice } from '../chat/DmDeletedNotice';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import type { User } from '@backspace/shared';
import { Tooltip } from '../ui/Tooltip';
import { joinVoiceChannel } from '../../utils/voice';
import { SearchPopover } from '../chat/SearchPopover';
import { PinsPopover } from '../chat/PinsPopover';
import { ThreadsPopover } from '../chat/ThreadsPopover';
import { useThreadStore } from '../../stores/threadStore';
import { openThreadView } from '../../utils/openThread';
import { ChannelNotificationButton } from '../notifications/ChannelNotificationButton';
import { ChannelHeaderTopic } from './ChannelHeaderTopic';
import { useConversationContextMenu } from './conversationMenu/useConversationContextMenu';
import { isDmChannel } from '../../stores/spaceStore';
import { usePointerReveal, VOICE_CHROME_ATTR } from '../../hooks/usePointerReveal';
import { Icon } from '../ui/Icon';
import { useCanPinInChannel } from '../../utils/pinPermission';

/**
 * Voice channel header, in both of its shapes.
 *
 * Docked it is a real row that reserves its own height. In fullscreen it
 * becomes a band floating over the video, so it must not reserve height and
 * must not swallow clicks: the band is `pointer-events-none` and only the
 * action buttons inside it opt back in. Visibility is driven by `revealed`
 * rather than `group-hover`, because the group fills the viewport in
 * fullscreen and would hold hover forever. `focus-within` keeps it reachable
 * by keyboard, and pointers that cannot hover keep it up permanently.
 */
function voiceHeaderClassName(fullscreen: boolean, revealed: boolean): string {
  const base = 'min-h-[var(--topbar-height)] px-5 flex items-center justify-between bg-surface-base transition-opacity duration-300';
  if (!fullscreen) {
    return `${base} border-b border-border-hard flex-shrink-0`;
  }
  const overlay =
    'pointer-events-none absolute inset-x-0 top-0 z-30 border-b border-white/5 bg-gradient-to-b from-black/90 via-black/70 to-transparent';
  const visibility = revealed
    ? 'opacity-100'
    : 'opacity-0 focus-within:opacity-100 [@media(hover:none)]:opacity-100 [@media(any-pointer:coarse)]:opacity-100';
  return `${base} ${overlay} ${visibility}`;
}

export function MainContent() {
  // 1. ALL HOOKS AT THE TOP
  const { t } = useTranslation(['spaces', 'common', 'chat']);
  const channels = useSpaceStore((s) => s.channels);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const voiceChatOpen = useUIStore((s) => s.voiceChatOpen);
  const voiceFullscreen = useUIStore((s) => s.voiceFullscreen);
  const setVoiceFullscreen = useUIStore((s) => s.setVoiceFullscreen);
  const participants = useVoiceStore((s) => s.participants);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const isLiveKitConnected = useVoiceStore((s) => s.isLiveKitConnected);
  const connectionError = useVoiceStore((s) => s.connectionError);
  const showDms = useUIStore((s) => s.showDms);
  const location = useLocation();
  const isExplorePage = location.pathname === HOME_ROUTES.explore;
  const isAboutPage = location.pathname === HOME_ROUTES.about;
  const isFriendsPage = location.pathname === HOME_ROUTES.friends;
  const isInboxPage = location.pathname === HOME_ROUTES.inbox;
  // The DM call's conversation as this client opens it (never the call's key).
  const { dmChannelId: dmCallChannel } = useActiveDmCall();
  const outgoingCall = useVoiceStore((s) => s.outgoingCall);
  const canStartCall = useVoiceStore(canStartDmCall);
  const dmCallRunning = useVoiceStore((s) => !!currentChannelId && isDmCallRunning(s, currentChannelId));
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const openModal = useUIStore((s) => s.openModal);

  const voiceContainerRef = useRef<HTMLDivElement>(null);
  // Fullscreen chrome is revealed by pointer movement and hidden once the
  // pointer goes still. It cannot be `group-hover`: fullscreen makes this
  // container the whole viewport, so hover is true wherever the pointer is
  // and the chrome would never leave. See usePointerReveal.
  const chromeRevealed = usePointerReveal(voiceContainerRef, voiceFullscreen);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const pinsButtonRef = useRef<HTMLButtonElement>(null);
  const closePins = useCallback(() => setPinsOpen(false), []);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threadsButtonRef = useRef<HTMLButtonElement>(null);
  const closeThreads = useCallback(() => setThreadsOpen(false), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const clearJumpRequest = useCallback(() => setJumpToMessageId(null), []);

  // `?message=<id>` opens the conversation at that message (the inbox's
  // mentions link this way). The parameter is consumed, so a reload or a
  // later visit opens the conversation normally.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedMessageId = searchParams.get('message');
  const linkedThreadId = searchParams.get('thread');
  const { channelId: addressedChannelId } = useParams();
  useEffect(() => {
    // `?thread=<id>` opens a thread of this channel, and `message` then means a message in it.
    if (!linkedThreadId || !currentChannelId || addressedChannelId !== currentChannelId) return;
    openThreadView(linkedThreadId, currentChannelId, linkedMessageId);
    const next = new URLSearchParams(searchParams);
    next.delete('thread');
    next.delete('message');
    setSearchParams(next, { replace: true });
  }, [linkedThreadId, linkedMessageId, addressedChannelId, currentChannelId, searchParams, setSearchParams]);
  useEffect(() => {
    if (!linkedMessageId || linkedThreadId || !currentChannelId) return;
    setJumpToMessageId(linkedMessageId);
    const next = new URLSearchParams(searchParams);
    next.delete('message');
    setSearchParams(next, { replace: true });
  }, [linkedMessageId, linkedThreadId, currentChannelId, searchParams, setSearchParams]);

  // Resolve the DM header's "first other" member through the canonical view
  // cache. The hook must be called unconditionally at the component top, so we
  // pass a fallback when there is no current DM channel or 1-on-1 partner.
  const _dmChannel = dmChannels.find(dm => dm.id === currentChannelId);
  const dmViewer = useDmViewer(_dmChannel?.id);
  const _rawFirstOther = _dmChannel?.members.filter(m => !isMine(m, dmViewer.origin, dmViewer.self))[0] ?? null;
  const _FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;
  const _canonicalFirstOther = useCanonicalUserView(_rawFirstOther ?? _FALLBACK_USER, dmViewer.origin);

  // Reset search and the pins when channel changes
  useEffect(() => {
    setSearchOpen(false);
    setPinsOpen(false);
    setThreadsOpen(false);
    const { open, closeThread } = useThreadStore.getState();
    if (open && open.parentChannelId !== currentChannelId) closeThread();
  }, [currentChannelId]);

  // Handle actual browser fullscreen API.
  //
  // iOS Safari (and iPadOS pre-16.4) does NOT implement the standard
  // `Element.requestFullscreen()` on generic elements. Older WebKit exposes a
  // `webkitRequestFullscreen` variant; pure iPhone has neither for a `<div>`
  // (only `HTMLVideoElement.webkitEnterFullscreen()` works, which we cannot use
  // for the multi-tile voice container). On those platforms we still want the
  // toggle to work as an in-page maximize: the `voiceFullscreen` flag flips the
  // container to `h-screen` so the call view fills the viewport — that's the
  // graceful fallback. Calling a missing API directly threw
  // `TypeError: requestFullscreen is not a function` on iPhone, taking down
  // the whole voice UI; the guards below contain the platform difference.
  type FullscreenCapableElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  type FullscreenCapableDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };

  const getFullscreenElement = useCallback((): Element | null => {
    const d = document as FullscreenCapableDocument;
    return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setVoiceFullscreen(!!getFullscreenElement());
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [setVoiceFullscreen, getFullscreenElement]);

  useEffect(() => {
    const el = voiceContainerRef.current as FullscreenCapableElement | null;
    const d = document as FullscreenCapableDocument;
    const inFullscreen = !!getFullscreenElement();

    const enter = async () => {
      if (!el) return;
      try {
        if (typeof el.requestFullscreen === 'function') {
          await el.requestFullscreen();
        } else if (typeof el.webkitRequestFullscreen === 'function') {
          await Promise.resolve(el.webkitRequestFullscreen());
        }
        // If neither API exists (iPhone Safari / PWA standalone for non-video
        // elements), fall through silently — the `voiceFullscreen` flag still
        // applies `h-screen` to give an in-page maximize, which is the
        // documented graceful fallback.
      } catch (err) {
        // Permission denied, user gesture missing, or platform refusal. Keep
        // the in-page fallback (h-screen) without surfacing a console error.
        console.warn('Native fullscreen unavailable, using in-page fallback:', err);
      }
    };

    const exit = async () => {
      try {
        if (typeof document.exitFullscreen === 'function') {
          await document.exitFullscreen();
        } else if (typeof d.webkitExitFullscreen === 'function') {
          await Promise.resolve(d.webkitExitFullscreen());
        }
      } catch {
        // best-effort
      }
    };

    if (voiceFullscreen && el && !inFullscreen) {
      void enter();
    } else if (!voiceFullscreen && inFullscreen) {
      void exit();
    }
  }, [voiceFullscreen, getFullscreenElement]);

  // The right-click menu of the conversation named in the header, with the dialogs it opens.
  const conversationMenu = useConversationContextMenu();

  const canPinHere = useCanPinInChannel(currentChannelId);

  // 2. LOGIC AND EARLY RETURNS
  const channel = channels.find(c => c.id === currentChannelId);
  const isVoiceChannel = channel?.type === 'voice';

  // The pages of the home area win over a channel id the route effect has not
  // cleared yet, so leaving a conversation for one never flashes the
  // conversation first (utils/homeNav.ts).
  if (isInboxPage) return <InboxPage />;
  if (isExplorePage) return <ExplorePage />;
  if (isAboutPage) return <AboutPage />;
  if (isFriendsPage) return <FriendsPage />;
  if (showsHomeDashboard({ pathname: location.pathname, showDms, currentSpaceId, currentChannelId })) return <HomePage />;

  // The DM side with a conversation open (the dashboard took the case without one).
  if ((showDms || !currentSpaceId) && currentChannelId) {
    const dmChannel = dmChannels.find(dm => dm.id === currentChannelId);
    const otherMembers = dmChannel?.members.filter(m => !isMine(m, dmViewer.origin, dmViewer.self)) ?? [];
    const isGroupDm = !!dmChannel?.ownerId;
    // Use the canonicalized view of the 1-on-1 partner (resolved above the
    // conditional so the hook is called unconditionally).
    const firstOther = _rawFirstOther ? _canonicalFirstOther : (otherMembers[0] ?? null);
    // Group DMs route through `formatDmHeaderName` (honors `dm.name`, falls
    // back to joined member names); 1-on-1 DMs keep the canonical-view path
    // so replicated aliases still surface the home-instance display name.
    const dmName = isGroupDm && dmChannel
      ? formatDmHeaderName(dmChannel, dmViewer)
      : ((firstOther && userDisplayName(firstOther)) || t('spaces:main.dm.fallbackName'));
    // Message-input placeholder — groups use `formatDmInputLabel` which
    // collapses unnamed groups to "the group" so the textarea doesn't render
    // "Message #Alice, Bob, Charlie, Dave". 1-on-1 reuses the canonical
    // `dmName` so the placeholder stays aligned with the header (the utility
    // resolves the raw partner; on replicated aliases the canonical view
    // can disagree).
    const dmInputPlaceholder = isGroupDm && dmChannel
      ? t('spaces:main.dm.composerPlaceholder', { target: formatDmInputLabel(dmChannel, dmViewer) })
      : dmChannel
        ? t('spaces:main.dm.composerPlaceholder', { target: `@${dmName}` })
        : undefined;
    const dmPartnerDeleted = dmChannel ? isDeletedPartnerDm(dmChannel, dmViewer) : false;

    const isInDmCall = !!currentChannelId && dmCallChannel === currentChannelId;
    const isCallingThisDm = outgoingCall?.dmChannelId === currentChannelId;

    // A DM whose call already has people in it gets a join button; starting
    // a second call there is what the server would refuse.
    // The video button does the same with the camera on once connected.
    const handleStartCall = (withCamera: boolean) => {
      if (!currentChannelId) return;
      if (dmCallRunning) joinDmCall(currentChannelId, { withCamera });
      else startDmCall(currentChannelId, { withCamera });
    };

    const handleCancelCall = () => {
      if (currentChannelId) cancelOutgoingDmCall(currentChannelId);
    };

    if (isInDmCall) {
      return (
        <div
          ref={voiceContainerRef}
          className={`lit flex-1 flex flex-col bg-surface-base min-w-0 group/voice relative overflow-hidden ${voiceFullscreen ? 'h-screen' : ''}`}
        >
          <div
            data-testid="voice-header-overlay"
            className={voiceHeaderClassName(voiceFullscreen, chromeRevealed)}
            {...(voiceFullscreen ? { [VOICE_CHROME_ATTR]: '' } : {})}
          >
            <div className="flex items-center gap-3">
              <Icon name="phone" size={18} className="text-txt-tertiary" />
              <span className="font-semibold text-lead tracking-[-0.01em] text-txt-primary">{dmName}</span>
              {connectionError ? (
                <span className="text-meta text-txt-danger font-medium ml-2">{t('spaces:main.voice.connectionFailed')}</span>
              ) : isLiveKitConnected ? (
                <>
                  <span className="text-meta text-status-online font-medium ml-2">{t('spaces:main.voice.connected')}</span>
                  <span className="text-meta text-txt-tertiary ml-1">{t('spaces:main.voice.inCall', { count: participants.length })}</span>
                </>
              ) : (
                <span className="text-meta text-status-idle font-medium ml-2">{t('spaces:main.voice.connecting')}</span>
              )}
            </div>
            <div className={`flex items-center gap-1 flex-shrink-0 ${voiceFullscreen ? 'pointer-events-auto mr-24' : ''}`}>
              <TransferIndicator />
              <MemberListToggleButton />
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className={`flex-1 min-w-0 flex relative ${voiceFullscreen ? '' : 'pb-20'}`}>
              <VoiceGrid participants={participants} />
              <VoiceControlBar revealed={chromeRevealed} />
            </div>
            {voiceChatOpen && !voiceFullscreen && (
              <VoiceChatPanel channelId={currentChannelId} channelName={`@${dmName}`} />
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col min-w-0 relative">
        {isCallingThisDm && (
          <div className="flex min-h-10 items-center justify-between gap-3 border-b border-status-online/25 bg-status-online/10 py-1 pl-5 pr-[22px]">
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon name="phone" size={15} className="call-ring-dot flex-shrink-0 text-txt-positive" />
              <span className="truncate text-ui font-medium text-txt-positive">{t('spaces:main.dm.calling', { name: dmName })}</span>
            </div>
            <button onClick={handleCancelCall} className="btn-danger btn-sm">
              {t('common:actions.cancel')}
            </button>
          </div>
        )}
        <div className="panel-bar px-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0" onContextMenu={(e) => conversationMenu.openDm(e, currentChannelId)}>
            {isGroupDm ? (
              <div
                onClick={() => openModal('groupDmSettings', { dmChannelId: currentChannelId, initialTab: 'overview' })}
                className="flex-shrink-0 cursor-pointer"
                aria-label={t('spaces:main.dm.openGroupSettings')}
              >
                <AvatarStack members={otherMembers} origin={dmViewer.origin} size={32} border="chat" iconUrl={dmChannel?.icon} />
              </div>
            ) : (
              <span className="flex flex-shrink-0 items-center justify-center text-txt-tertiary">
                <Icon name="user" size={18} />
              </span>
            )}
            {isGroupDm ? (
              <span
                onClick={() => openModal('groupDmSettings', { dmChannelId: currentChannelId, initialTab: 'overview' })}
                className="font-semibold text-lead tracking-[-0.01em] text-txt-primary truncate cursor-pointer"
              >
                {dmName}
              </span>
            ) : (
              <span className="font-semibold text-lead tracking-[-0.01em] text-txt-primary truncate">{dmName}</span>
            )}
            {!isGroupDm && firstOther && isFederationGlobeApplicable(firstOther) && (
              <Tooltip content={firstOther.username} position="bottom">
                <Icon name="globe" size={14} className="flex-shrink-0 text-txt-tertiary" />
              </Tooltip>
            )}
            {isGroupDm && (() => {
              const federatedMembers = (dmChannel?.members ?? []).filter(m => isFederationGlobeApplicable(m));
              if (federatedMembers.length === 0) return null;
              return (
                <Tooltip content={federatedMembers.map(m => m.username).join(', ')} position="bottom">
                  <Icon name="globe" size={14} className="flex-shrink-0 text-txt-tertiary" />
                </Tooltip>
              );
            })()}
            {isGroupDm && (
              <span
                onClick={() => openModal('groupDmSettings', { dmChannelId: currentChannelId, initialTab: 'members' })}
                className="tabular text-meta text-txt-tertiary flex-shrink-0 cursor-pointer hover:text-txt-secondary transition-colors"
              >
                {t('spaces:main.dm.memberCount', { count: dmChannel?.members.length ?? 0 })}
              </span>
            )}
            {isGroupDm && (
              <button
                onClick={() => openModal('groupDmSettings', { dmChannelId: currentChannelId, initialTab: 'overview' })}
                className="icon-btn flex-shrink-0"
                aria-label={t('spaces:main.dm.groupSettings')}
              >
                <Icon name="settings" size={16} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* A 1-on-1 whose partner was deleted has nobody to ring, as on mobile. */}
            {!dmPartnerDeleted && (
              <>
                <button
                  onClick={() => handleStartCall(false)}
                  disabled={!canStartCall}
                  className={`icon-btn icon-btn-lg ${dmCallRunning ? 'text-accent-mint hover:text-accent-mint/80' : ''}`}
                  aria-label={dmCallRunning ? t('spaces:main.dm.joinCall') : t('spaces:main.dm.startVoiceCall')}
                >
                  <Icon name="phone" size={18} />
                </button>
                <button
                  onClick={() => handleStartCall(true)}
                  disabled={!canStartCall}
                  className={`icon-btn icon-btn-lg ${dmCallRunning ? 'text-accent-mint hover:text-accent-mint/80' : ''}`}
                  aria-label={dmCallRunning ? t('spaces:main.dm.joinCall') : t('spaces:main.dm.startVideoCall')}
                >
                  <Icon name="video" size={18} />
                </button>
              </>
            )}
            <button
              onClick={() => openModal('addDmMember', { dmChannelId: currentChannelId })}
              className="icon-btn icon-btn-lg"
              aria-label={t('spaces:main.dm.addFriends')}
            >
              <Icon name="user-plus" size={18} />
            </button>
            <button
              ref={pinsButtonRef}
              onClick={() => setPinsOpen(!pinsOpen)}
              data-active={pinsOpen ? 'true' : undefined}
              className="icon-btn icon-btn-lg"
              aria-label={t('chat:pins.title')}
            >
              <Icon name="pin" size={18} />
            </button>
            <button
              ref={searchButtonRef}
              onClick={() => setSearchOpen(!searchOpen)}
              data-active={searchOpen ? 'true' : undefined}
              className="icon-btn icon-btn-lg"
              aria-label={t('common:actions.search')}
            >
              <Icon name="search" size={18} />
            </button>
            <TransferIndicator />
            <div className="w-px h-5 bg-border-hard mx-1.5" />
            <MemberListToggleButton />
          </div>
        </div>
        <MessageList channelId={currentChannelId} jumpToMessageId={jumpToMessageId} onJumpHandled={clearJumpRequest} />
        {dmPartnerDeleted
          ? <DmDeletedNotice />
          : <MessageInput channelId={currentChannelId} channelName={`@${dmName}`} placeholder={dmInputPlaceholder} />}
        <SearchPopover
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          anchorRef={searchButtonRef}
          channelId={currentChannelId}
          isDm={true}
          onJumpToMessage={(id) => { setJumpToMessageId(id); setSearchOpen(false); }}
        />
        <PinsPopover
          open={pinsOpen}
          onClose={closePins}
          anchorRef={pinsButtonRef}
          channelId={currentChannelId}
          isDm={true}
          canUnpin={!dmPartnerDeleted}
          onJumpToMessage={(id) => { setJumpToMessageId(id); setPinsOpen(false); }}
        />
        {conversationMenu.dialogs}
      </div>
    );
  }

  if (!currentChannelId || !channel) {
    return (
      <div className="flex-1 flex flex-col relative">
        <div className="panel-bar px-5 flex items-center justify-between">
          <span className="text-ui text-txt-tertiary">{t('spaces:main.selectChannel')}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <TransferIndicator />
            <MemberListToggleButton />
          </div>
        </div>
        <div className="empty-state flex-1">
          <p className="empty-state-body">{t('spaces:main.selectChannelHint')}</p>
        </div>
      </div>
    );
  }

  if (isVoiceChannel) {
    const isInThisChannel = currentVoiceChannelId === currentChannelId;

    if (!isInThisChannel) {
      return (
        <div className="flex-1 flex flex-col">
          {conversationMenu.dialogs}
          <div className="panel-bar px-5 flex items-center justify-between">
            <div className="flex items-center gap-3" onContextMenu={(e) => conversationMenu.openChannel(e, channel.id)}>
              <ChannelIcon type="voice" icon={channel.icon} size={18} className="text-txt-tertiary" />
              <span className="font-semibold text-lead tracking-[-0.01em] text-txt-primary">{channel.name}</span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <TransferIndicator />
              <MemberListToggleButton />
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="surface-card w-full max-w-[360px] rounded-md">
              <div className="flex items-center gap-2.5 border-b border-border-hard px-4 py-3">
                <ChannelIcon type="voice" icon={channel.icon} size={16} className="text-txt-tertiary" />
                <h2 className="min-w-0 truncate text-body font-semibold text-txt-primary">{channel.name}</h2>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <p className="text-ui text-txt-tertiary">{t('spaces:main.voice.empty')}</p>
                <button
                  onClick={() => joinVoiceChannel(currentChannelId, useVoiceStore.getState().connectFn ?? undefined)}
                  className="btn-primary flex-shrink-0"
                >
                  <Icon name="mic" size={15} />
                  {t('spaces:main.voice.join')}
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div 
        ref={voiceContainerRef}
        className={`lit flex-1 flex flex-col bg-surface-base min-w-0 group/voice relative overflow-hidden ${voiceFullscreen ? 'h-screen' : ''}`}
      >
        <div
          data-testid="voice-header-overlay"
          className={voiceHeaderClassName(voiceFullscreen, chromeRevealed)}
          {...(voiceFullscreen ? { [VOICE_CHROME_ATTR]: '' } : {})}
        >
          <div className="flex items-center gap-3">
            <ChannelIcon type="voice" icon={channel.icon} size={18} className="text-txt-tertiary" />
            <span className="font-semibold text-lead tracking-[-0.01em] text-txt-primary">{channel.name}</span>
            {connectionError ? (
              <span className="text-meta text-txt-danger font-medium ml-2">{t('spaces:main.voice.connectionFailed')}</span>
            ) : isLiveKitConnected ? (
              <>
                <span className="text-meta text-status-online font-medium ml-2">{t('spaces:main.voice.connected')}</span>
                <span className="text-meta text-txt-tertiary ml-1">{t('spaces:main.voice.participants', { count: participants.length })}</span>
              </>
            ) : (
              <span className="text-meta text-status-idle font-medium ml-2">{t('spaces:main.voice.connecting')}</span>
            )}
          </div>
          <div className={`flex items-center gap-1 flex-shrink-0 ${voiceFullscreen ? 'pointer-events-auto mr-24' : ''}`}>
            <TransferIndicator />
            <MemberListToggleButton />
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className={`flex-1 min-w-0 flex relative ${voiceFullscreen ? '' : 'pb-20'}`}>
            <VoiceGrid participants={participants} />
            <VoiceControlBar revealed={chromeRevealed} />
          </div>
          {voiceChatOpen && !voiceFullscreen && (
            <VoiceChatPanel channelId={currentChannelId} channelName={channel.name} />
          )}
        </div>
      </div>
    );
  }

  // A forum holds posts, not messages: its list stands where a channel's messages do.
  if (channel.type === 'forum') {
    return (
      <div className="flex-1 flex flex-col min-w-0 relative">
        {conversationMenu.dialogs}
        <div className="panel-bar px-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0" onContextMenu={(e) => conversationMenu.openChannel(e, channel.id)}>
            <span className="flex flex-shrink-0 items-center justify-center text-txt-tertiary">
              <Icon name="forum" size={18} />
            </span>
            <span className="font-semibold text-lead tracking-[-0.01em] text-txt-primary truncate leading-tight">{channel.name}</span>
            {channel.topic && <ChannelHeaderTopic key={channel.id} channelName={channel.name} topic={channel.topic} />}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <ChannelNotificationButton channelId={currentChannelId} channelName={channel.name} />
            <TransferIndicator />
            <div className="w-px h-5 bg-border-hard mx-1.5" />
            <MemberListToggleButton />
          </div>
        </div>
        <ForumView channel={channel} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 relative">
      {conversationMenu.dialogs}
      <div className="panel-bar px-5 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0" onContextMenu={(e) => conversationMenu.openChannel(e, channel.id)}>
          <span className="flex flex-shrink-0 items-center justify-center text-txt-tertiary">
            <ChannelIcon type={channel.type} icon={channel.icon} size={18} />
          </span>
          <span className="font-semibold text-lead tracking-[-0.01em] text-txt-primary truncate leading-tight">{channel.name}</span>
          {channel.topic && (
            <ChannelHeaderTopic key={channel.id} channelName={channel.name} topic={channel.topic} />
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {channel.type === 'announcement' && <FollowChannelButton channelId={channel.id} channelName={channel.name} />}
          <ChannelNotificationButton channelId={currentChannelId} channelName={channel.name} />
          <button
            ref={pinsButtonRef}
            onClick={() => setPinsOpen(!pinsOpen)}
            data-active={pinsOpen ? 'true' : undefined}
            className="icon-btn icon-btn-lg"
            aria-label={t('chat:pins.title')}
          >
            <Icon name="pin" size={18} />
          </button>
          <button
            ref={threadsButtonRef}
            onClick={() => setThreadsOpen(!threadsOpen)}
            data-active={threadsOpen ? 'true' : undefined}
            className="icon-btn icon-btn-lg"
            aria-label={t('chat:thread.listTitle')}
          >
            <Icon name="thread" size={18} />
          </button>
          <button
            ref={searchButtonRef}
            onClick={() => setSearchOpen(!searchOpen)}
            data-active={searchOpen ? 'true' : undefined}
            className="icon-btn icon-btn-lg"
            aria-label={t('common:actions.search')}
          >
            <Icon name="search" size={18} />
          </button>
          <TransferIndicator />
          <div className="w-px h-5 bg-border-hard mx-1.5" />
          <MemberListToggleButton />
        </div>
      </div>
      <MessageList channelId={currentChannelId} jumpToMessageId={jumpToMessageId} onJumpHandled={clearJumpRequest} />
      <MessageInput channelId={currentChannelId} channelName={channel.name} />
      <SearchPopover
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        anchorRef={searchButtonRef}
        channelId={currentChannelId}
        isDm={false}
        onJumpToMessage={(id) => { setJumpToMessageId(id); setSearchOpen(false); }}
      />
      <PinsPopover
        open={pinsOpen}
        onClose={closePins}
        anchorRef={pinsButtonRef}
        channelId={currentChannelId}
        isDm={false}
        canUnpin={canPinHere}
        onJumpToMessage={(id) => { setJumpToMessageId(id); setPinsOpen(false); }}
      />
      <ThreadsPopover open={threadsOpen} onClose={closeThreads} anchorRef={threadsButtonRef} channelId={currentChannelId} />
    </div>
  );
}
