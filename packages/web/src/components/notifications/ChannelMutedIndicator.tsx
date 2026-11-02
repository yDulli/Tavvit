import { useTranslation } from 'react-i18next';
import { useChannelNotificationPolicy } from '../../hooks/useNotificationSettings';
import { Icon } from '../ui/Icon';

/** A crossed-out bell. Shared by the indicator and the header bell's muted state. */
export function BellOffIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <Icon name="bell-off" size={size} className={className} />;
}

/**
 * Shown on a channel list row while the channel is muted, by its own mute or
 * its space's. Renders nothing otherwise, and disappears by itself when a
 * timed mute ends (the policy hook re-renders on the store's clock).
 */
export function ChannelMutedIndicator({ channelId, className }: { channelId: string; className?: string }) {
  const { t } = useTranslation(['spaces']);
  const policy = useChannelNotificationPolicy(channelId);
  if (!policy?.muted) return null;
  const label = t('spaces:notifications.mutedIndicator');
  return (
    <span role="img" aria-label={label} title={label} className={`flex-shrink-0 inline-flex ${className ?? ''}`}>
      <BellOffIcon size={14} />
    </span>
  );
}
