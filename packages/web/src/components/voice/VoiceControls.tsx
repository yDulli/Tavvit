import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { ScreenShareSettingsPopover } from './ScreenShareSettingsPopover';
import { ConnectionInfoPopover } from './ConnectionInfoPopover';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { handleCameraAction, handleDisconnectAction, handleScreenShareAction, reconnectVoice } from '../../utils/voiceActions';
import { Icon } from '../ui/Icon';
import { VoiceIcon } from './voiceIcons';

// The three toggles under the status: a hairline at rest, the violet of a control that is on.
const toggleBase = 'flex h-8 flex-1 items-center justify-center rounded-md border transition-colors duration-100';
const toggleOff = `${toggleBase} border-border-hard text-txt-secondary hover:bg-interactive-hover hover:text-txt-primary active:bg-interactive-active`;
const toggleOn = `${toggleBase} border-accent-primary/40 bg-accent-primary/15 text-accent-soft hover:bg-accent-primary/25 active:bg-accent-primary/30`;

/**
 * VoiceControls renders the voice status + button rows.
 * It has NO wrapper/card styling — the parent provides the container.
 */
export function VoiceControls() {
  const { t } = useTranslation(['voice', 'common']);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const isCameraOn = useVoiceStore((s) => s.isCameraOn);
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const rnnoiseEnabled = useVoiceStore((s) => s.rnnoiseEnabled);
  const setRnnoiseEnabled = useVoiceStore((s) => s.setRnnoiseEnabled);
  const connectionError = useVoiceStore((s) => s.connectionError);
  const isLiveKitConnected = useVoiceStore((s) => s.isLiveKitConnected);
  const voiceConnectionStatus = useVoiceStore((s) => s.voiceConnectionStatus);
  const connectionQuality = useVoiceStore((s) => s.connectionQuality);
  const channels = useSpaceStore((s) => s.channels);
  // Screen-share button: idle → source picker; live → settings + stop menu.
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showConnectionInfo, setShowConnectionInfo] = useState(false);
  const connectionBtnRef = useRef<HTMLButtonElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);

  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const channelPerms = useSpaceStore((s) => currentVoiceChannelId ? s.channelPermissions.get(currentVoiceChannelId) : undefined);

  // In DM calls, all permissions are granted; in space channels, check SPEAK and STREAM
  const isDmCall = !!activeDmCall;
  const canSpeak = isDmCall || hasPermissionBit(channelPerms, PermissionBits.SPEAK);
  const canStream = isDmCall || hasPermissionBit(channelPerms, PermissionBits.STREAM);

  // A share that ends outside the menu (OS "Stop sharing" bar, track loss,
  // keybind) must not leave a stale settings popover anchored to the button.
  useEffect(() => {
    if (!isScreenSharing) setShowShareMenu(false);
  }, [isScreenSharing]);

  if (!currentVoiceChannelId && !activeDmCall) return null;

  const channel = channels.find(c => c.id === currentVoiceChannelId);
  const channelName = channel?.name ?? (activeDmCall ? t('voice:status.dmCall') : t('voice:status.voiceChannel'));

  const handleScreenShare = () => {
    if (isScreenSharing) {
      const next = !showShareMenu;
      setShowShareMenu(next);
      if (next) setShowConnectionInfo(false);
      return;
    }
    handleScreenShareAction();
  };

  const handleStopSharing = () => {
    setShowShareMenu(false);
    handleScreenShareAction();
  };

  const handleDisconnect = handleDisconnectAction;
  const handleRetry = reconnectVoice;

  const connectionDetail = connectionError === 'network_disconnect'
    ? t('voice:status.connectionLost')
    : connectionError === 'connect_failed'
      ? t('voice:status.connectionFailed')
      : connectionError;

  const statusLabel = voiceConnectionStatus === 'reconnecting'
    ? t('voice:status.reconnecting')
    : connectionError === 'network_disconnect'
      ? t('voice:status.disconnected')
      : connectionError
        ? t('voice:status.connectionFailed')
        : isLiveKitConnected
          ? t('voice:status.connected')
          : t('voice:status.connecting');
  const detailLabel = connectionDetail ?? channelName;

  const statusColor = connectionError
    ? 'text-txt-danger'
    : isLiveKitConnected
      ? 'text-status-online'
      : 'text-status-idle';

  const qualityColor =
    connectionQuality === 'excellent' || connectionQuality === 'good'
      ? 'text-status-online'
      : connectionQuality === 'poor'
        ? 'text-status-idle'
        : connectionQuality === 'lost'
          ? 'text-txt-danger'
          : statusColor; // 'unknown' falls back to connection-state color

  return (
    <>
      {/* Row 1: Signal icon + status text + disconnect */}
      <div className="relative flex items-center gap-2 px-2 pt-2 pb-1.5">
        <button
          ref={connectionBtnRef}
          onClick={() => {
            setShowConnectionInfo(!showConnectionInfo);
            if (!showConnectionInfo) setShowShareMenu(false);
          }}
          data-active={showConnectionInfo ? 'true' : undefined}
          aria-haspopup="dialog"
          aria-expanded={showConnectionInfo}
          aria-label={t('voice:controls.connectionInfo')}
          className={`icon-btn icon-btn-lg ${qualityColor}`}
          title={t('voice:controls.connectionInfo')}
        >
          <VoiceIcon name="signal" size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <div title={statusLabel} className={`truncate text-ui font-medium leading-[18px] ${statusColor}`}>
            {statusLabel}
          </div>
          <div title={detailLabel} className="text-meta text-txt-tertiary truncate leading-4">
            {detailLabel}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {voiceConnectionStatus === 'disconnected' && connectionError && (
            <button onClick={handleRetry} className="btn-outline btn-sm">
              {t('voice:status.retry')}
            </button>
          )}
          <button
            onClick={handleDisconnect}
            aria-label={t('voice:controls.disconnect')}
            className="icon-btn icon-btn-lg text-txt-secondary hover:bg-accent-rose/15 hover:text-txt-danger active:bg-accent-rose/25"
            title={t('voice:controls.disconnect')}
          >
            <Icon name="phone" size={18} className="rotate-[135deg]" />
          </button>
        </div>

        {/* Connection Info Popover */}
        <ConnectionInfoPopover
          open={showConnectionInfo}
          onClose={() => setShowConnectionInfo(false)}
          anchorRef={connectionBtnRef}
        />
      </div>

      {/* Row 2: Camera, Screen Share, Noise Suppression */}
      <div className="relative flex items-center gap-1 px-2 pb-2">
        {canSpeak && (
          <button
            onClick={handleCameraAction}
            aria-pressed={isCameraOn}
            aria-label={isCameraOn ? t('voice:controls.cameraOff') : t('voice:controls.cameraOn')}
            className={isCameraOn ? toggleOn : toggleOff}
            title={isCameraOn ? t('voice:controls.cameraOff') : t('voice:controls.cameraOn')}
          >
            {isCameraOn ? <Icon name="video" size={18} /> : <VoiceIcon name="video-off" size={18} />}
          </button>
        )}

        {canStream && (
          <button
            ref={shareBtnRef}
            onClick={handleScreenShare}
            // Idle the button starts a share; live it toggles a menu, so it
            // only claims a popup in the state where it actually opens one.
            aria-haspopup={isScreenSharing ? 'dialog' : undefined}
            aria-expanded={isScreenSharing ? showShareMenu : undefined}
            aria-label={isScreenSharing ? t('voice:controls.shareOptions') : t('voice:controls.shareScreen')}
            className={isScreenSharing ? toggleOn : toggleOff}
            title={isScreenSharing ? t('voice:controls.shareOptions') : t('voice:controls.shareScreen')}
          >
            <VoiceIcon name="screen-share" size={18} />
          </button>
        )}

        {/* AI Noise Suppression (RNNoise) */}
        <button
          onClick={() => setRnnoiseEnabled(!rnnoiseEnabled)}
          aria-pressed={rnnoiseEnabled}
          aria-label={rnnoiseEnabled ? t('voice:controls.noiseSuppressionOff') : t('voice:controls.noiseSuppressionOn')}
          className={rnnoiseEnabled ? toggleOn : toggleOff}
          title={rnnoiseEnabled ? t('voice:controls.noiseSuppressionOff') : t('voice:controls.noiseSuppressionOn')}
        >
          <VoiceIcon name={rnnoiseEnabled ? 'waves' : 'waves-off'} size={18} />
        </button>

        {/* Screen share menu — quality settings + stop, anchored to the share button */}
        <ScreenShareSettingsPopover
          open={showShareMenu && isScreenSharing}
          onClose={() => setShowShareMenu(false)}
          anchorRef={shareBtnRef}
          onStopSharing={handleStopSharing}
        />
      </div>
    </>
  );
}
