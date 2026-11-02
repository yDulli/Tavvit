import { useTranslation } from 'react-i18next';
import { isMuteActive } from '@backspace/shared';
import { useUnreadCountStore } from '../../stores/unreadCountStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useStoredNotificationSetting } from '../../hooks/useNotificationSettings';
import { useNotificationSettingsStore } from '../../stores/notificationSettingsStore';
import { CountBadge } from '../ui/CountBadge';

/**
 * The sum of a space's unread messages, from the counts its own instance sent,
 * and whether the space is muted. Only channels the client also holds as unread
 * are summed, so the count and the unread dot agree; a host without counts
 * gives 0.
 */
export function useSpaceUnreadCount(spaceId: string): { total: number; muted: boolean } {
  const origin = useSpaceStore(s => s.spaces.find(space => space.id === spaceId)?._instanceOrigin ?? '');
  const channelSpaces = useSpaceStore(s => s.channelToSpaceMap);
  const unread = useChatStore(s => s.unreadChannels);
  const counts = useUnreadCountStore(s => s.counts[origin]);
  const setting = useStoredNotificationSetting(origin, spaceId, null);
  // Subscribed so that the end of a timed mute re-renders the badge.
  useNotificationSettingsStore(s => s.clock);
  const muted = isMuteActive(setting, Date.now());
  let total = 0;
  for (const [channelId, count] of Object.entries(counts ?? {})) {
    if (channelSpaces.get(channelId) === spaceId && unread.has(channelId)) total += count;
  }
  return { total, muted };
}

/**
 * A space's unread count as a `.count-badge` (the neutral one while the space
 * is muted); nothing when there is none. `corner` sits on the corner of a
 * tile, `inline` runs in a row.
 */
export function SpaceUnreadBadge({ spaceId, placement = 'corner' }: { spaceId: string; placement?: 'corner' | 'inline' }) {
  const { t } = useTranslation('spaces');
  const { total, muted } = useSpaceUnreadCount(spaceId);
  if (total === 0) return null;
  const label = total > 99 ? t('sidebar.space.unreadMessagesOver99') : t('sidebar.space.unreadMessages', { count: total });
  return <CountBadge count={total} muted={muted} label={label} placement={placement} />;
}
