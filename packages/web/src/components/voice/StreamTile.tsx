import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { LiveBadge } from './LiveBadge';
import { VoiceIcon } from './voiceIcons';
import { useVoiceStore } from '../../stores/voiceStore';
import { useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { getActiveRoom, setStreamSubscription } from '../../hooks/useLiveKit';
import { stopScreenShare, changeScreenShare, effectiveScreenShareConfig } from '../../utils/screenShare';
import { useStreamHostLimits } from '../../utils/streamHostLimits';
import { DEFAULT_STREAMING_LIMITS } from '../../stores/settingsStore';
import { encodeStreamWatch, streamWatchFor, type StreamWatchTarget } from '../../utils/streamWatchProtocol';
import { AudioManager } from '../../audio/AudioManager';
import { getSfxVolume } from '../../utils/sfx';
import { ScreenShareSettingsPopover } from './ScreenShareSettingsPopover';
import { useVoiceParticipantMeta } from '../../hooks/useVoiceParticipantMeta';
import type { StreamTile as StreamTileType } from '../../hooks/useLiveKit';
import type { TrackStatsSnapshot } from '../../hooks/useTrackStats';
import {
  classifyStreamHealth,
  useStreamHealthWarning,
} from '../../hooks/useStreamHealthWarning';

interface StreamTileProps {
  tile: StreamTileType;
  large?: boolean;
  /** A tile too short for the full placeholder: the focus strip, a crowded grid, a phone. */
  compact?: boolean;
  stats: TrackStatsSnapshot | null;
}

const STREAM_HEALTH_KEYS = {
  publisherNetwork: 'voice:streamDiagnostics.publisherNetwork',
  publisherCpu: 'voice:streamDiagnostics.publisherCpu',
  viewerNetwork: 'voice:streamDiagnostics.viewerNetwork',
  reconnecting: 'voice:streamDiagnostics.reconnecting',
  unknown: 'voice:streamDiagnostics.unknown',
} as const;

function finitePositiveRounded(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/** Wrapper component for stream quality settings — needs its own state + close guard. */
function StreamQualityItem() {
  const { t } = useTranslation(['voice', 'common']);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const setCloseGuard = useContextMenuStore((s) => s.setCloseGuard);
  const savedConfig = useVoiceStore((s) => s.screenShareConfig);
  const { limits } = useStreamHostLimits();
  // The label names what the stream uses, not the saved choice a host may cap.
  const screenShareConfig = effectiveScreenShareConfig(savedConfig, limits ?? DEFAULT_STREAMING_LIMITS);

  return (
    <div className="p-3">
      <div className="label-mono mb-2">
        {t('voice:stream.quality')}
      </div>
      <div className="relative">
        <button
          ref={btnRef}
          onClick={() => {
            const n = !open;
            setOpen(n);
            setCloseGuard(n);
          }}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-2 py-1.5 font-mono text-meta text-txt-secondary hover:bg-interactive-hover hover:text-txt-primary active:bg-interactive-active rounded-md transition-colors duration-100"
        >
          <span>{t('voice:stream.qualityValue', { height: screenShareConfig.height, fps: screenShareConfig.fps })}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {open && (
          <ScreenShareSettingsPopover
            open={open}
            onClose={() => {
              setOpen(false);
              setCloseGuard(false);
            }}
            anchorRef={btnRef}
          />
        )}
      </div>
    </div>
  );
}

/** Wrapper component for stream volume slider — needs store subscription. */
function StreamVolumeItem({ userId }: { userId: string }) {
  const { t } = useTranslation(['voice', 'common']);
  const f = useFormatters();
  const streamVolume = useVoiceStore((s) => s.streamVolumes.get(userId) ?? 100);
  const setStreamVolume = useVoiceStore((s) => s.setStreamVolume);

  return (
    <div className="p-3">
      <div className="label-mono mb-2">
        {t('voice:stream.volume')}
      </div>
      <div className="flex items-center gap-2">
        <Icon name="volume" size={16} className="text-txt-tertiary flex-shrink-0" />
        <input
          type="range"
          min="0"
          max="200"
          value={streamVolume}
          onChange={(e) => setStreamVolume(userId, parseInt(e.target.value))}
          aria-label={t('voice:stream.volume')}
          className="flex-1 min-w-0 cursor-pointer accent-accent-primary h-1"
        />
        <span className="tabular font-mono text-label text-txt-secondary min-w-[36px] flex-shrink-0 text-right">
          {f.formatPercent(streamVolume)}
        </span>
      </div>
    </div>
  );
}

/** Wrapper component for stream attenuation controls — needs store subscription. */
function StreamAttenuationItem() {
  const { t } = useTranslation(['voice', 'common']);
  const f = useFormatters();
  const streamAttenuationEnabled = useVoiceStore((s) => s.streamAttenuationEnabled);
  const streamAttenuationStrength = useVoiceStore((s) => s.streamAttenuationStrength);
  const setAttenuationEnabled = useVoiceStore((s) => s.setStreamAttenuationEnabled);
  const setAttenuationStrength = useVoiceStore((s) => s.setStreamAttenuationStrength);

  return (
    <div>
      <div className="py-1">
        {/* The geometry of ContextMenuRenderer's rows: this is one more row of that menu. */}
        <button
          onClick={() => setAttenuationEnabled(!streamAttenuationEnabled)}
          role="menuitemcheckbox"
          aria-checked={streamAttenuationEnabled}
          className="min-h-8 text-left px-2 py-1.5 mx-1 text-ui font-medium leading-snug rounded-md flex items-center gap-2.5 text-txt-secondary transition-colors hover:bg-interactive-selected hover:text-txt-primary"
          style={{ width: 'calc(100% - 8px)' }}
        >
          {/* The stream menu's rows have icons, so this label starts at their x too. */}
          <span aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{t('voice:stream.attenuation')}</span>
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              streamAttenuationEnabled
                ? 'bg-accent-primary border-accent-primary'
                : 'border-txt-tertiary'
            }`}
          >
            {streamAttenuationEnabled && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            )}
          </div>
        </button>
      </div>
      {streamAttenuationEnabled && (
        <div className="p-3 pt-0">
          <div className="label-mono mb-2">
            {t('voice:stream.attenuationStrength')}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              value={streamAttenuationStrength}
              onChange={(e) => setAttenuationStrength(parseInt(e.target.value))}
              aria-label={t('voice:stream.attenuationStrength')}
              className="flex-1 min-w-0 cursor-pointer accent-accent-primary h-1"
            />
            <span className="tabular font-mono text-label text-txt-secondary min-w-[36px] flex-shrink-0 text-right">
              {f.formatPercent(streamAttenuationStrength)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Handles a deliberate viewer watch / stop-watch action: plays the local
 * feedback cue on the viewer's OWN machine and notifies the streamer so their
 * streamer-side watcher set updates.
 *
 * Called only from explicit user-action sites (the "Watch Stream" button and
 * the watch/stop context-menu items) — never from automatic teardown paths
 * (streamer stops sharing, participant disconnect), which must stay silent on
 * the viewer side. The local cue is played directly rather than derived from a
 * `watchingStreams` diff precisely so those teardown paths don't trigger it.
 *
 * The cue plays unconditionally (independent of the data-channel round-trip to
 * the streamer), so the viewer gets identical feedback on every platform —
 * Safari and the Electron desktop app alike.
 */
function handleViewerWatchToggle(sharer: StreamWatchTarget, watching: boolean): void {
  AudioManager.getInstance().playSound(
    watching ? 'stream_user_joined' : 'stream_user_left',
    { volume: getSfxVolume() },
  );
  const room = getActiveRoom();
  if (!room) return;
  const payload = encodeStreamWatch(streamWatchFor(sharer, watching));
  // Reliable delivery; data channels are room-scoped and small (under 1KB).
  void room.localParticipant.publishData(payload, { reliable: true });
}

export function StreamTile({ tile, large, compact, stats }: StreamTileProps) {
  const { t } = useTranslation(['voice', 'common']);
  const videoRef = useRef<HTMLVideoElement>(null);

  const watchingStreams = useVoiceStore((s) => s.watchingStreams);

  const { participant } = tile;
  const isLocal = participant.isLocal;
  const userId = participant.userId;
  const avatarUserId = participant.homeUserId ?? userId;
  const { displayName, avatar, user } = useVoiceParticipantMeta(participant);

  const isWatching = watchingStreams.has(userId);
  const voiceConnectionStatus = useVoiceStore((s) => s.voiceConnectionStatus);
  const localConnectionQuality = useVoiceStore((s) => s.connectionQuality);
  const publisherConnectionQuality = useVoiceStore((s) => s.connectionQualities.get(participant.identity) ?? 'unknown');

  const liveScreenTrack = tile.screenTrack?.readyState === 'live' ? tile.screenTrack : null;
  const liveLkScreenTrack = liveScreenTrack ? tile.lkScreenTrack : null;

  // Quality badge state: the raw dimensions, rendered through the catalog so a language switch relabels them.
  const [qualityBadge, setQualityBadge] = useState<{ height: number; fps: number | null } | null>(null);

  const openContextMenu = useContextMenuStore((s) => s.open);

  const screenStat = stats?.videoTracks.find((track) =>
    track.source === 'screen_share'
    && (isLocal
      ? track.direction === 'send'
      // Matched on LiveKit identity, never on username: a replicated federated
      // user can share a username with a local one, and matching by name would
      // attribute one participant's degradation to the other.
      : track.direction === 'recv' && track.participantIdentity === participant.identity),
  );
  const healthCandidate = classifyStreamHealth({
    reconnecting: voiceConnectionStatus === 'reconnecting',
    isLocal,
    publisherConnectionQuality,
    localConnectionQuality,
    outboundReason: isLocal ? screenStat?.qualityLimitation ?? null : null,
    packetLoss: screenStat?.packetLoss ?? null,
    jitter: screenStat?.jitter ?? null,
    freezeCountDelta: screenStat?.freezeCountDelta ?? null,
  });
  const healthWarning = useStreamHealthWarning(healthCandidate, stats);

  // --- VIDEO --- use LiveKit's track.attach() to register the element
  // with the adaptive stream observer (enables SFU layer switching by viewport size)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (liveLkScreenTrack) {
      liveLkScreenTrack.attach(videoEl);
      return () => { liveLkScreenTrack.detach(videoEl); };
    } else {
      videoEl.srcObject = null;
    }
  }, [liveLkScreenTrack]);

  // Quality badge (poll every 3s)
  useEffect(() => {
    if (!liveScreenTrack) {
      setQualityBadge(null);
      return;
    }
    const update = () => {
      const settings = liveScreenTrack.getSettings();
      const h = finitePositiveRounded(settings.height);
      const fps = finitePositiveRounded(settings.frameRate);
      if (h !== null && fps !== null) {
        setQualityBadge({ height: h, fps });
      } else if (h !== null) {
        setQualityBadge({ height: h, fps: null });
      } else {
        setQualityBadge(null);
      }
    };
    update();
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, [liveScreenTrack]);

  // Force re-render on track end
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!tile.screenTrack) return;
    const onEnded = () => forceUpdate((n) => n + 1);
    tile.screenTrack.addEventListener('ended', onEnded);
    return () => tile.screenTrack?.removeEventListener('ended', onEnded);
  }, [tile.screenTrack]);

  // --- CONTEXT MENU ---
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [];

      if (isLocal) {
        // Local stream: stop, change, quality
        items.push({
          key: 'stop-streaming',
          type: 'action',
          label: t('voice:stream.stop'),
          danger: true,
          icon: <VoiceIcon name="screen-off" size={16} />,
          onClick: async () => {
            const room = getActiveRoom();
            if (room) {
              await stopScreenShare(room);
            }
          },
        });
        items.push({
          key: 'change-stream',
          type: 'action',
          label: t('voice:stream.change'),
          icon: <Icon name="refresh" size={16} />,
          onClick: async () => {
            const room = getActiveRoom();
            if (room) {
              await changeScreenShare(room);
            }
          },
        });
        items.push({ key: 'quality-sep', type: 'separator' });
        items.push({
          key: 'stream-quality',
          type: 'custom',
          render: () => React.createElement(StreamQualityItem),
        });
      } else {
        // Remote stream: watch/unwatch, mute, volume, attenuation
        const currentIsWatching = useVoiceStore.getState().watchingStreams.has(userId);
        const identity = participant.identity;

        if (currentIsWatching) {
          items.push({
            key: 'stop-watching',
            type: 'action',
            label: t('voice:stream.stopWatching'),
            icon: <VoiceIcon name="eye-off" size={16} />,
            onClick: () => {
              useVoiceStore.getState().unwatchStream(userId);
              setStreamSubscription(getActiveRoom(), identity, false);
              handleViewerWatchToggle({ userId, identity }, false);
            },
          });
        } else {
          items.push({
            key: 'watch-stream',
            type: 'action',
            label: t('voice:stream.watch'),
            icon: <VoiceIcon name="eye" size={16} />,
            onClick: () => {
              useVoiceStore.getState().watchStream(userId);
              setStreamSubscription(getActiveRoom(), identity, true);
              handleViewerWatchToggle({ userId, identity }, true);
            },
          });
        }

        items.push({ key: 'watch-sep', type: 'separator' });

        // Mute Stream checkbox
        items.push({
          key: 'mute-stream',
          type: 'checkbox',
          label: t('voice:stream.mute'),
          subscribe: useVoiceStore.subscribe,
          getChecked: () => useVoiceStore.getState().streamMutes.get(userId) ?? false,
          onChange: (checked) => useVoiceStore.getState().setStreamMute(userId, checked),
        });

        items.push({ key: 'vol-sep', type: 'separator' });

        // Stream volume slider
        items.push({
          key: 'stream-volume',
          type: 'custom',
          render: () => React.createElement(StreamVolumeItem, { userId }),
        });

        items.push({ key: 'attenuation-sep', type: 'separator' });

        // Stream attenuation controls
        items.push({
          key: 'stream-attenuation',
          type: 'custom',
          render: () => React.createElement(StreamAttenuationItem),
        });
      }

      openContextMenu({ x: e.clientX, y: e.clientY }, items);
    },
    [isLocal, userId, participant.identity, openContextMenu, t],
  );

  const handleWatch = useCallback(() => {
    useVoiceStore.getState().watchStream(userId);
    setStreamSubscription(getActiveRoom(), participant.identity, true);
    handleViewerWatchToggle({ userId, identity: participant.identity }, true);
  }, [userId, participant.identity]);

  const hasVideo = liveScreenTrack !== null;

  return (
    <div
      data-context-menu
      className="relative bg-surface-channel rounded-lg overflow-hidden flex items-center justify-center group transition-shadow duration-100 ring-1 ring-border-hard hover:ring-interactive-muted h-full w-full"
      onContextMenu={handleContextMenu}
    >
      {hasVideo && isWatching ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain bg-black"
        />
      ) : (
        <div data-testid="stream-tile-placeholder" className={`w-full h-full min-h-0 flex items-center justify-center ${large ? 'px-4 py-6' : compact ? 'px-2 pt-7 pb-1.5' : 'px-4 pt-9 pb-3'}`}>
          <div className={large ? 'flex flex-col items-center gap-3 min-w-0' : `flex w-full max-w-[280px] min-w-0 items-center ${compact ? 'gap-2' : 'gap-3'}`}>
            <div className="relative flex-shrink-0">
              <Avatar src={avatar} name={displayName} size={large ? 80 : compact ? 28 : 44} userId={avatarUserId} user={user ?? undefined} />
            </div>
            <div className={`${large ? 'text-center' : 'text-left flex-1'} min-w-0`}>
              <p className={`text-txt-primary font-medium ${large ? 'text-body' : compact ? 'text-label leading-tight line-clamp-1' : 'text-meta leading-tight line-clamp-2'}`}>
                {t('voice:stream.isStreaming', { name: displayName })}
              </p>
              {!isLocal && (
                <button
                  onClick={handleWatch}
                  aria-label={t('voice:stream.watch')}
                  className={`btn-primary whitespace-nowrap ${large ? 'mt-3' : compact ? 'btn-sm mt-1 !h-6 w-full' : 'btn-sm mt-2 w-full'}`}
                >
                  {t(large ? 'voice:stream.watch' : 'voice:stream.watchShort')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LIVE badge — top left */}
      <LiveBadge className="absolute top-2 left-2 h-5" />

      {/* Stream status — in focus mode this is the visual peer of the Grid
          action: same top edge, height, radius, and surface treatment. */}
      {(healthWarning || (qualityBadge && hasVideo)) && (
        <div className={`absolute top-2 left-20 ${large ? 'right-24' : 'right-2'} flex items-start justify-end gap-1.5 pointer-events-none`}>
          {healthWarning && (
            <div className={`${large ? 'h-7 rounded-md' : 'h-5 rounded'} min-w-0 max-w-full px-2 bg-black/75 border border-status-idle/40 flex items-center text-2xs text-white/90 truncate`}>
              {t(STREAM_HEALTH_KEYS[healthWarning])}
            </div>
          )}
          {qualityBadge && hasVideo && (
            <div data-testid="stream-quality-badge" className={`${large ? 'h-7 px-2.5 rounded-md text-label' : 'h-5 px-1.5 rounded text-2xs'} tabular flex-shrink-0 bg-black/60 flex items-center font-mono font-medium text-white/80 uppercase`}>
              {qualityBadge.fps !== null
                ? t('voice:stream.qualityValue', { height: qualityBadge.height, fps: qualityBadge.fps })
                // i18n-check: allow-literal "720p" is the format's name and reads the same in every language
                : <>{qualityBadge.height}p</>}
            </div>
          )}
        </div>
      )}

      {/* Bottom overlay */}
      {hasVideo && isWatching && <div data-testid="stream-tile-caption" className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent ${compact ? 'px-2 py-1' : 'px-3 py-2'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon name="monitor" size={14} className="text-white/70 flex-shrink-0" />
          <span
            className={`font-medium text-white truncate ${large ? 'text-lead' : compact ? 'text-meta' : 'text-ui'}`}
          >
            {displayName}
          </span>
          {isLocal && (
            <span className="flex-shrink-0 text-label text-white/70">{t('voice:badges.you')}</span>
          )}
        </div>
      </div>}
    </div>
  );
}
