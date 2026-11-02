import { useTranslation } from 'react-i18next';
import { useUnreadCountStore } from '../../stores/unreadCountStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { CountBadge } from '../ui/CountBadge';
import { UnreadCountBadge } from './UnreadCountBadge';

/**
 * One conversation's unread count, from the instance that serves its pinned
 * copy (`channelOriginMap`), the same place the sum below reads it from; null
 * when that instance sent no count (an older instance).
 */
export function useDmConversationUnreadCount(dmId: string): number | null {
  const origin = useSpaceStore(s => s.channelOriginMap.get(dmId) ?? '');
  return useUnreadCountStore(s => s.counts[origin]?.[dmId] ?? null);
}

/**
 * A DM row's unread badge: the number of unread messages, or the neutral dot
 * (design-system.md, "Unread and attention indicators") when the instance does
 * not count them. Only rendered for a conversation the client holds as unread.
 */
export function DmRowUnreadBadge({ dmId }: { dmId: string }) {
  const { t } = useTranslation(['spaces', 'home']);
  const count = useDmConversationUnreadCount(dmId);
  if (count === null || count <= 0) {
    return (
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-txt-primary" />
        <span className="sr-only">{t('home:unread.dot')}</span>
      </span>
    );
  }
  const label = count > 99 ? t('spaces:sidebar.dmUnreadMessagesOver99') : t('spaces:sidebar.dmUnreadMessages', { count });
  return <CountBadge count={count} label={label} />;
}

/**
 * The sum of unread direct messages. `dmChannels` holds one pinned copy per
 * conversation, and each copy is counted by the instance it came from
 * (`channelOriginMap`), so a conversation mirrored on several instances is
 * counted once (client-federation.md, "DM Origin Failover").
 */
export function useDmUnreadCount(): number {
  const dms = useSpaceStore(s => s.dmChannels);
  const origins = useSpaceStore(s => s.channelOriginMap);
  const unread = useChatStore(s => s.unreadChannels);
  const counts = useUnreadCountStore(s => s.counts);
  let total = 0;
  for (const dm of dms) {
    if (unread.has(dm.id)) total += counts[origins.get(dm.id) ?? '']?.[dm.id] ?? 0;
  }
  return total;
}

/** The unread direct messages as a badge; nothing when there are none. */
export function DmUnreadBadge({ placement = 'corner' }: { placement?: 'corner' | 'inline' }) {
  const { t } = useTranslation('spaces');
  const total = useDmUnreadCount();
  if (total === 0) return null;
  const label = total > 99 ? t('sidebar.dmUnreadMessagesOver99') : t('sidebar.dmUnreadMessages', { count: total });
  return <UnreadCountBadge count={total} label={label} placement={placement} />;
}
