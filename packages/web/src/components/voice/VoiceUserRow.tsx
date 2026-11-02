import { useTranslation } from 'react-i18next';
import { Avatar, avatarRadius } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { LiveBadge } from './LiveBadge';
import { VoiceIcon } from './voiceIcons';

export interface VoiceUserRowProps {
  userId: string;
  displayName: string;
  avatar: string | null;
  avatarColor?: string;
  isMuted?: boolean;
  isDeafened?: boolean;
  isCameraOn?: boolean;
  isUnwatchedCamera?: boolean;
  isScreenSharing?: boolean;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  isPermissionMuted?: boolean;
  isLocallyMuted?: boolean;
  isSpeaking?: boolean;
  connectionWarning?: string | null;
  size?: 'compact' | 'default';
  className?: string;
}

export function VoiceUserRow({
  userId,
  displayName,
  avatar,
  avatarColor,
  isMuted,
  isDeafened,
  isCameraOn,
  isUnwatchedCamera,
  isScreenSharing,
  isServerMuted,
  isServerDeafened,
  isPermissionMuted,
  isLocallyMuted,
  isSpeaking,
  connectionWarning,
  size = 'default',
  className = '',
}: VoiceUserRowProps) {
  const { t } = useTranslation(['voice', 'common']);
  const avatarSize = size === 'compact' ? 20 : 24;

  // Mic icon priority: server muted/deafened/permission muted (amber) > self-muted (danger)
  const showServerMicIcon = isServerMuted || isServerDeafened || isPermissionMuted;
  const showSelfMicIcon = !showServerMicIcon && isMuted;

  // Deafen icon priority: server deafened (amber) > self-deafened (danger)
  const showServerDeafIcon = isServerDeafened;
  const showSelfDeafIcon = !isServerDeafened && isDeafened;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="relative flex flex-shrink-0">
        <Avatar
          src={avatar}
          name={displayName}
          size={avatarSize}
          userId={userId}
          avatarColor={avatarColor}
        />
        {/* Follows the avatar's own corner, whatever the appearance setting makes it. */}
        {isSpeaking && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 ring-2 ring-status-online"
            style={{ borderRadius: avatarRadius(avatarSize) }}
          />
        )}
      </span>
      <span className={`text-ui truncate flex-1 min-w-0 ${isSpeaking ? 'text-txt-primary' : 'text-txt-secondary'}`}>
        {displayName}
      </span>
      {/* Status badges */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {connectionWarning && (
          <span
            className="w-4 h-4 text-status-idle flex items-center justify-center"
            title={connectionWarning}
            aria-label={connectionWarning}
          >
            <Icon name="alert" size={14} />
          </span>
        )}
        {/* Server muted / space deafened / permission muted — amber mic with slash */}
        {showServerMicIcon && (
          <span
            title={
              isPermissionMuted
                ? t('voice:badges.mutedNoPermission')
                : isServerMuted
                  ? t('voice:badges.spaceMuted')
                  : t('voice:badges.mutedSpaceDeafened')
            }
          >
            <Icon name="mic-off" size={14} className="text-accent-amber" />
          </span>
        )}
        {/* Server deafened — amber headphone with slash */}
        {showServerDeafIcon && (
          <span title={t('voice:badges.spaceDeafened')}>
            <Icon name="headphones-off" size={14} className="text-accent-amber" />
          </span>
        )}
        {/* Self-muted — danger mic with slash */}
        {showSelfMicIcon && (
          <Icon name="mic-off" size={14} className="text-txt-danger" />
        )}
        {/* Self-deafened — danger headphone with slash */}
        {showSelfDeafIcon && (
          <Icon name="headphones-off" size={14} className="text-txt-danger" />
        )}
        {/* Camera active */}
        {isCameraOn && (isUnwatchedCamera
          ? <VoiceIcon name="video-off" size={14} className="text-txt-tertiary" />
          : <Icon name="video" size={14} className="text-txt-tertiary" />
        )}
        {/* Screen sharing LIVE badge */}
        {isScreenSharing && <LiveBadge />}
        {/* Locally muted — volume X icon */}
        {isLocallyMuted && (
          <span title={t('voice:badges.locallyMuted')}>
            <Icon name="volume-off" size={14} className="text-txt-tertiary" />
          </span>
        )}
      </div>
    </div>
  );
}
