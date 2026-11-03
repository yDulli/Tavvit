import { SoundboardButton } from './SoundboardButton';
import { WatchButton } from './WatchButton';
import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore, getChannelOrigin, getMyUserIdForOrigin } from '../../stores/spaceStore';
import { ScreenShareSettingsPopover } from './ScreenShareSettingsPopover';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { handleMuteAction, handleDeafenAction, handleCameraAction, handleScreenShareAction, handleDisconnectAction } from '../../utils/voiceActions';
import { VOICE_CHROME_ATTR } from '../../hooks/usePointerReveal';
import { Icon } from '../ui/Icon';
import { VoiceIcon } from './voiceIcons';

// One 40px geometry, `.icon-btn`'s states. What a toggle means is told by its
// tint: rose for a microphone or headphones you switched off, amber for what a
// moderator switched off, violet for what is on and going out.
const btnBase = 'icon-btn h-10 w-10';
const btnDefault = `${btnBase} text-txt-secondary`;
const btnOff = `${btnBase} bg-accent-rose/15 text-txt-danger hover:bg-accent-rose/25 hover:text-txt-danger active:bg-accent-rose/30`;
const btnLocked = `${btnBase} cursor-not-allowed bg-accent-amber/15 text-accent-amber hover:bg-accent-amber/15 hover:text-accent-amber active:bg-accent-amber/15`;
const btnOn = `${btnBase} bg-accent-primary/20 text-accent-soft hover:bg-accent-primary/30 hover:text-accent-soft active:bg-accent-primary/35`;

/**
 * `revealed` is the fullscreen idle state, owned by MainContent because it
 * watches the voice container the pointer actually moves over. It is ignored
 * while docked, where plain hover on the voice panel is the right model.
 */
export function VoiceControlBar({ revealed = false }: { revealed?: boolean }) {
  const { t } = useTranslation(['voice', 'common']);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const isCameraOn = useVoiceStore((s) => s.isCameraOn);
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const voiceChatOpen = useUIStore((s) => s.voiceChatOpen);
  const toggleVoiceChat = useUIStore((s) => s.toggleVoiceChat);
  const voiceFullscreen = useUIStore((s) => s.voiceFullscreen);
  const toggleVoiceFullscreen = useUIStore((s) => s.toggleVoiceFullscreen);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const myUser = useAuthStore((s) => s.user);
  const spaceId = useSpaceStore((s) => currentVoiceChannelId ? s.channelToSpaceMap.get(currentVoiceChannelId) : null);
  const myOriginId = useSpaceStore((s) => currentVoiceChannelId ? getMyUserIdForOrigin(getChannelOrigin(currentVoiceChannelId)) : s.members.find(m => m.userId === myUser?.id)?.userId ?? myUser?.id);
  const spaceMutedUserIds = useVoiceStore((s) => s.spaceMutedUserIds);
  const spaceDeafenedUserIds = useVoiceStore((s) => s.spaceDeafenedUserIds);
  const isSpaceMuted = !!(myOriginId && spaceId && spaceMutedUserIds.has(`${spaceId}:${myOriginId}`));
  const isSpaceDeafened = !!(myOriginId && spaceId && spaceDeafenedUserIds.has(`${spaceId}:${myOriginId}`));
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const channelPerms = useSpaceStore((s) => currentVoiceChannelId ? s.channelPermissions.get(currentVoiceChannelId) : undefined);
  const isDmCall = !!activeDmCall;
  const canSpeak = isDmCall || hasPermissionBit(channelPerms, PermissionBits.SPEAK);
  const canStream = isDmCall || hasPermissionBit(channelPerms, PermissionBits.STREAM);
  // The screen-share button is the single entry point to stream settings:
  // idle → opens the OS/Electron source picker; live → opens the settings
  // popover (quality controls + the red stop action).
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareBtnRef = useRef<HTMLButtonElement>(null);

  // An open share menu pins the bar: the popover hangs off it, so letting the
  // idle timer pull it away would take the menu with it.
  const fullscreenVisibility = revealed || shareMenuOpen
    ? 'opacity-100'
    : 'opacity-0 focus-within:opacity-100 [@media(hover:none)]:opacity-100 [@media(any-pointer:coarse)]:opacity-100';
  const containerClassName = voiceFullscreen
    ? `pointer-events-none absolute inset-x-0 bottom-0 z-20 h-24 flex items-end justify-center pb-6 transition-opacity duration-300 ease-out ${fullscreenVisibility}`
    // `focus-within` keeps the bar on screen for the keyboard, which never hovers.
    : 'absolute bottom-6 left-1/2 -translate-x-1/2 z-20 opacity-0 translate-y-2 group-hover/voice:opacity-100 group-hover/voice:translate-y-0 focus-within:opacity-100 focus-within:translate-y-0 [@media(hover:none)]:opacity-100 [@media(hover:none)]:translate-y-0 transition-[opacity,transform] duration-200 ease-out';

  const handleMute = React.useCallback(() => {
    handleMuteAction(isSpaceMuted, isSpaceDeafened);
  }, [isSpaceMuted, isSpaceDeafened]);

  const handleDeafen = React.useCallback(() => {
    handleDeafenAction(isSpaceDeafened);
  }, [isSpaceDeafened]);

  const handleCamera = () => handleCameraAction();

  const handleScreenShare = () => {
    if (isScreenSharing) {
      setShareMenuOpen((open) => !open);
      return;
    }
    handleScreenShareAction();
  };

  const handleStopSharing = () => {
    setShareMenuOpen(false);
    handleScreenShareAction();
  };

  // A share that ends outside the menu (OS "Stop sharing" bar, track loss,
  // keybind) must not leave a stale settings popover anchored to the button.
  useEffect(() => {
    if (!isScreenSharing) setShareMenuOpen(false);
  }, [isScreenSharing]);

  const handleDisconnect = () => handleDisconnectAction();

  const handleFullscreen = () => {
    toggleVoiceFullscreen();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && voiceFullscreen) {
        useUIStore.getState().setVoiceFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [voiceFullscreen]);

  const muteLabel = (isSpaceMuted || isSpaceDeafened)
    ? (isMuted ? t('voice:controls.spaceMutedSelfMuted') : t('voice:badges.spaceMuted'))
    : isMuted ? t('voice:controls.unmuteShortcut') : t('voice:controls.muteShortcut');
  const deafenLabel = isSpaceDeafened
    ? t('voice:badges.spaceDeafened')
    : isDeafened ? t('voice:controls.undeafenShortcut') : t('voice:controls.deafenShortcut');

  return (
    <div
      data-testid="voice-control-overlay"
      className={containerClassName}
      {...(voiceFullscreen ? { [VOICE_CHROME_ATTR]: '' } : {})}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg p-1.5 glass-bubble">
        {/* Mute */}
        <button
          onClick={handleMute}
          aria-pressed={isMuted || isDeafened || isSpaceMuted || isSpaceDeafened}
          aria-label={muteLabel}
          className={(isSpaceMuted || isSpaceDeafened)
            ? btnLocked
            : isMuted || isDeafened
              ? btnOff
              : btnDefault
          }
          title={muteLabel}
        >
          <Icon name={isMuted || isDeafened || isSpaceMuted || isSpaceDeafened ? 'mic-off' : 'mic'} size={20} />
        </button>

        {/* Deafen */}
        <button
          onClick={handleDeafen}
          aria-pressed={isDeafened || isSpaceDeafened}
          aria-label={deafenLabel}
          className={isSpaceDeafened
            ? btnLocked
            : isDeafened
              ? btnOff
              : btnDefault
          }
          title={deafenLabel}
        >
          <Icon name={isDeafened || isSpaceDeafened ? 'headphones-off' : 'headphones'} size={20} />
        </button>

        {/* Camera */}
        {canSpeak && (
          <button
            onClick={handleCamera}
            aria-pressed={isCameraOn}
            aria-label={isCameraOn ? t('voice:controls.cameraOff') : t('voice:controls.cameraOn')}
            className={isCameraOn ? btnOn : btnDefault}
            title={isCameraOn ? t('voice:controls.cameraOff') : t('voice:controls.cameraOn')}
          >
            {isCameraOn ? <Icon name="video" size={20} /> : <VoiceIcon name="video-off" size={20} />}
          </button>
        )}

        {/* Screen Share — picker when idle, settings + stop menu when live */}
        {canStream && (
          <>
            <button
              ref={shareBtnRef}
              onClick={handleScreenShare}
              // Idle the button starts a share; live it toggles a menu, so it
              // only claims a popup in the state where it actually opens one.
              aria-haspopup={isScreenSharing ? 'dialog' : undefined}
              aria-expanded={isScreenSharing ? shareMenuOpen : undefined}
              aria-label={isScreenSharing ? t('voice:controls.shareOptions') : t('voice:controls.shareScreen')}
              className={isScreenSharing ? btnOn : btnDefault}
              title={isScreenSharing ? t('voice:controls.shareOptions') : t('voice:controls.shareScreen')}
            >
              <VoiceIcon name="screen-share" size={20} />
            </button>
            <ScreenShareSettingsPopover
              open={shareMenuOpen && isScreenSharing}
              onClose={() => setShareMenuOpen(false)}
              anchorRef={shareBtnRef}
              onStopSharing={handleStopSharing}
            />
          </>
        )}

        {/* Separator */}
        <div aria-hidden="true" className="w-px h-6 bg-border-soft mx-0.5" />

        {/* Chat Toggle */}
        <button
          onClick={toggleVoiceChat}
          data-active={voiceChatOpen ? 'true' : undefined}
          aria-pressed={voiceChatOpen}
          aria-label={t('voice:controls.toggleChat')}
          className={btnDefault}
          title={t('voice:controls.toggleChat')}
        >
          <Icon name="message" size={20} />
        </button>

        {/* The soundboard belongs to a space: a call between two people has none. */}
        {!isDmCall && currentVoiceChannelId && <SoundboardButton channelId={currentVoiceChannelId} className={btnDefault} />}
        {!isDmCall && currentVoiceChannelId && <WatchButton channelId={currentVoiceChannelId} className={btnDefault} />}

        {/* Fullscreen Toggle */}
        <button
          onClick={handleFullscreen}
          data-active={voiceFullscreen ? 'true' : undefined}
          aria-label={voiceFullscreen ? t('voice:controls.exitFullscreen') : t('voice:controls.fullscreen')}
          className={btnDefault}
          title={voiceFullscreen ? t('voice:controls.exitFullscreen') : t('voice:controls.fullscreen')}
        >
          <VoiceIcon name={voiceFullscreen ? 'minimize' : 'maximize'} size={20} />
        </button>

        {/* Separator */}
        <div aria-hidden="true" className="w-px h-6 bg-border-soft mx-0.5" />

        {/* Disconnect */}
        <button
          onClick={handleDisconnect}
          aria-label={t('voice:controls.disconnect')}
          className="btn-danger h-10 w-10 p-0"
          title={t('voice:controls.disconnect')}
        >
          <Icon name="phone" size={20} className="rotate-[135deg]" />
        </button>
      </div>
    </div>
  );
}
