import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileAvatar } from '../ui/ProfileAvatar';
import { Icon, type IconName } from '../ui/Icon';
import { VoiceIcon } from './voiceIcons';
import { useVoiceStore } from '../../stores/voiceStore';
import { useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { buildVoiceModMenuItems, VolumeSliderItem } from './voiceMenuItems';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceParticipantMeta } from '../../hooks/useVoiceParticipantMeta';
import { getActiveRoom, setCameraSubscription } from '../../hooks/useLiveKit';
import type { UserTile } from '../../hooks/useLiveKit';

interface VoiceUserProps {
  tile: UserTile;
  large?: boolean;
  /** A tile too short for the full picture and caption: the focus strip, a crowded grid, a phone. */
  compact?: boolean;
}

/** One mark in the tile's corner: a dark chip, so it reads over the avatar tile and over a video alike. */
function TileBadge({ icon, tone, title, compact }: {
  icon: IconName;
  tone: 'danger' | 'warning' | 'neutral';
  title?: string;
  compact?: boolean;
}) {
  const color = tone === 'danger' ? 'text-txt-danger' : tone === 'warning' ? 'text-accent-amber' : 'text-white/80';
  return (
    <span title={title} className={`flex items-center justify-center rounded bg-black/60 ${compact ? 'h-4 w-4' : 'h-5 w-5'} ${color}`}>
      <Icon name={icon} size={compact ? 11 : 13} strokeWidth={2} />
    </span>
  );
}

export function VoiceUser({ tile, large, compact }: VoiceUserProps) {
  const { t } = useTranslation(['voice', 'common']);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { participant } = tile;
  const avatarSize = large ? 96 : compact ? 36 : 64;
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const isSpeaking = useVoiceStore((s) => s.speakingParticipantIds.has(participant.identity));
  const spaceMutedUserIds = useVoiceStore((s) => s.spaceMutedUserIds);
  const spaceDeafenedUserIds = useVoiceStore((s) => s.spaceDeafenedUserIds);
  const permissionMutedUserIds = useVoiceStore((s) => s.permissionMutedUserIds);
  const unwatchedCameras = useVoiceStore((s) => s.unwatchedCameras);
  const participantMutes = useVoiceStore((s) => s.participantMutes);
  const spaceId = useSpaceStore((s) => currentVoiceChannelId ? s.channelToSpaceMap.get(currentVoiceChannelId) : null);

  const openContextMenu = useContextMenuStore((s) => s.open);

  const [, forceUpdate] = useState(0);

  const isLocal = participant.isLocal;
  const avatarUserId = participant.homeUserId ?? participant.userId;
  const { displayName, avatar, user, origin: userOrigin } = useVoiceParticipantMeta(participant);

  // --- VIDEO & UI ---

  const activeVideoTrack = tile.videoTrack;
  const hasVideo = activeVideoTrack !== null;

  // Force re-render when tracks end/mute
  useEffect(() => {
    if (!tile.videoTrack) return;
    const onEnded = () => forceUpdate((n) => n + 1);
    tile.videoTrack.addEventListener('ended', onEnded);
    return () => tile.videoTrack?.removeEventListener('ended', onEnded);
  }, [tile.videoTrack]);

  // Attach Video — use LiveKit's track.attach() to register the element
  // with the adaptive stream observer (enables SFU layer switching by viewport size)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const lkTrack = tile.lkVideoTrack;
    if (lkTrack) {
      lkTrack.attach(videoEl);
      return () => { lkTrack.detach(videoEl); };
    } else {
      videoEl.srcObject = null;
    }
  }, [tile.lkVideoTrack]);

  // Context Menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (isLocal || !currentVoiceChannelId) return;
      e.preventDefault();
      e.stopPropagation();

      const targetUserId = participant.userId;
      const channelId = currentVoiceChannelId;

      // Build moderation items
      const modItems = buildVoiceModMenuItems(targetUserId, channelId);

      const items: ContextMenuItem[] = [...modItems];

      // Separator after mod items
      if (modItems.length > 0) {
        items.push({ key: 'mod-end-sep', type: 'separator' });
      }

      // Camera watch/unwatch
      const targetParticipant = useVoiceStore.getState().participants.find((p) => p.userId === targetUserId);
      const targetHasCamera = targetParticipant?.isCameraOn ?? false;
      const isCameraUnwatched = useVoiceStore.getState().unwatchedCameras.has(targetUserId);

      if (targetHasCamera) {
        items.push({
          key: 'camera-toggle',
          type: 'action',
          label: isCameraUnwatched ? t('voice:participantMenu.watchCamera') : t('voice:participantMenu.stopWatchingCamera'),
          icon: isCameraUnwatched ? <Icon name="video" size={16} /> : <VoiceIcon name="video-off" size={16} />,
          onClick: () => {
            const room = getActiveRoom();
            const identity = targetParticipant?.identity;
            if (isCameraUnwatched) {
              useVoiceStore.getState().rewatchCamera(targetUserId);
              if (identity) setCameraSubscription(room, identity, true);
            } else {
              useVoiceStore.getState().unwatchCamera(targetUserId);
              if (identity) setCameraSubscription(room, identity, false);
            }
          },
        });
        items.push({ key: 'camera-sep', type: 'separator' });
      }

      // Mute User checkbox
      items.push({
        key: 'mute-user',
        type: 'checkbox',
        label: t('voice:participantMenu.muteUser'),
        subscribe: useVoiceStore.subscribe,
        getChecked: () => useVoiceStore.getState().participantMutes.get(targetUserId) ?? false,
        onChange: (checked) => useVoiceStore.getState().setParticipantMute(targetUserId, checked),
      });

      items.push({ key: 'vol-sep', type: 'separator' });

      // Volume slider (custom, needs store subscription via wrapper component)
      items.push({
        key: 'volume',
        type: 'custom',
        render: () => React.createElement(VolumeSliderItem, { userId: targetUserId }),
      });

      openContextMenu({ x: e.clientX, y: e.clientY }, items);
    },
    [isLocal, currentVoiceChannelId, participant.userId, openContextMenu, t],
  );

  return (
    <div
      data-context-menu
      className={`relative bg-surface-channel rounded-lg overflow-hidden flex items-center justify-center group transition-shadow duration-100 ${
        isSpeaking
          ? 'ring-2 ring-status-online'
          : 'ring-1 ring-border-hard hover:ring-interactive-muted'
      } h-full w-full`}
      onContextMenu={handleContextMenu}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full ${large ? 'object-contain bg-black' : 'object-cover'}`}
        />
      ) : (
        <div className="relative flex">
          <ProfileAvatar
            src={avatar}
            name={displayName}
            size={avatarSize}
            userId={avatarUserId}
            user={user ?? undefined}
            origin={userOrigin}
          />
        </div>
      )}

      {/* The scrim is there for the picture: on the plain tile the caption needs none. */}
      <div className={`absolute bottom-0 left-0 right-0 ${compact ? 'px-2 py-1' : 'px-3 py-2'} ${hasVideo ? 'bg-gradient-to-t from-black/70 to-transparent' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`font-medium truncate ${hasVideo ? 'text-white' : 'text-txt-primary'} ${large ? 'text-lead' : compact ? 'text-meta' : 'text-ui'}`}
            >
              {displayName}
            </span>
            {isLocal && (
              <span className={`flex-shrink-0 text-label ${hasVideo ? 'text-white/70' : 'text-txt-tertiary'}`}>
                {t('voice:badges.you')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {(() => {
              const isSpaceMutedUser = spaceId ? spaceMutedUserIds.has(`${spaceId}:${participant.userId}`) : false;
              const isSpaceDeafenedUser = spaceId ? spaceDeafenedUserIds.has(`${spaceId}:${participant.userId}`) : false;
              const isPermissionMutedUser = spaceId ? permissionMutedUserIds.has(`${spaceId}:${participant.userId}`) : false;
              const effectivelyMuted = participant.isMuted || isSpaceMutedUser || isSpaceDeafenedUser || isPermissionMutedUser;
              const effectivelyDeafened = (isLocal ? isDeafened : participant.isDeafened) || isSpaceDeafenedUser;
              return (
                <>
                  {effectivelyMuted && (
                    <TileBadge
                      icon="mic-off"
                      tone={(isSpaceMutedUser || isSpaceDeafenedUser || isPermissionMutedUser) ? 'warning' : 'danger'}
                      compact={compact}
                    />
                  )}
                  {effectivelyDeafened && (
                    <TileBadge icon="headphones-off" tone={isSpaceDeafenedUser ? 'warning' : 'danger'} compact={compact} />
                  )}
                  {!isLocal && participant.isCameraOn && (
                    <span className={`flex items-center justify-center rounded bg-black/60 text-white/80 ${compact ? 'h-4 w-4' : 'h-5 w-5'}`}>
                      {unwatchedCameras.has(participant.userId)
                        ? <VoiceIcon name="video-off" size={compact ? 11 : 13} strokeWidth={2} />
                        : <Icon name="video" size={compact ? 11 : 13} strokeWidth={2} />}
                    </span>
                  )}
                  {!isLocal && participantMutes.get(participant.userId) && (
                    <TileBadge icon="volume-off" tone="neutral" title={t('voice:badges.locallyMuted')} compact={compact} />
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
