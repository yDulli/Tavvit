import { useMemo } from 'react';
import type { ChannelType, DmChannel } from '@backspace/shared';
import { useChatStore } from '../stores/chatStore';
import { selectAllMentions, useInboxStore, type InboxMention } from '../stores/inboxStore';
import { useNotificationSettingsStore, selectChannelNotificationPolicy } from '../stores/notificationSettingsStore';
import { isDmChannel, useSpaceStore } from '../stores/spaceStore';
import { useUnreadCountStore } from '../stores/unreadCountStore';
import { isNewerId } from '../utils/messageIds';

/** A conversation with something unread in it: a DM or a space channel. */
export type UnreadConversation =
  | { kind: 'dm'; id: string; origin: string; count: number | null; dm: DmChannel; lastAt: number }
  | { kind: 'channel'; id: string; origin: string; count: number | null; spaceId: string; name: string; type: ChannelType; icon: string | null };

export interface InboxMentionView extends InboxMention {
  /** Newer than the channel's read position: not yet seen. */
  unread: boolean;
}

export interface InboxSummary {
  conversations: UnreadConversation[];
  /** Unread channels left out because they, or their space, are muted. */
  mutedCount: number;
  mentions: InboxMentionView[];
  unreadMentionCount: number;
}

/**
 * Everything the inbox, the Home page and the nav badges say about what needs
 * attention, from the stores that already hold it: the unread set and read
 * positions (chatStore), exact counts (unreadCountStore), mentions
 * (inboxStore) and notification settings. Nothing is fetched here and nothing
 * is kept twice, so the inbox can never disagree with the unread dots.
 *
 * Voice channels have no text to read and never appear. A muted channel is
 * counted, not listed: muting means "do not bring this to my attention".
 */
export function useInbox(): InboxSummary {
  const unreadChannels = useChatStore((s) => s.unreadChannels);
  const readStates = useChatStore((s) => s.readStates);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const counts = useUnreadCountStore((s) => s.counts);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const index = useSpaceStore((s) => s.spaceChannelIndex);
  const channelOriginMap = useSpaceStore((s) => s.channelOriginMap);
  const settings = useNotificationSettingsStore((s) => s.settings);
  // Subscribed so that the end of a timed mute re-renders.
  const clock = useNotificationSettingsStore((s) => s.clock);
  const allMentions = useInboxStore(selectAllMentions);

  return useMemo(() => {
    const dmById = new Map(dmChannels.map((dm) => [dm.id, dm]));
    const conversations: UnreadConversation[] = [];
    let mutedCount = 0;
    for (const id of unreadChannels) {
      if (id === currentChannelId) continue;
      const origin = channelOriginMap.get(id) ?? '';
      const count = counts[origin]?.[id] ?? null;
      if (isDmChannel(id)) {
        const dm = dmById.get(id);
        if (!dm) continue;
        conversations.push({ kind: 'dm', id, origin, count, dm, lastAt: dm.lastMessage?.createdAt ?? dm.createdAt });
        continue;
      }
      const entry = index.get(id);
      if (!entry || entry.type === 'voice') continue;
      const policy = selectChannelNotificationPolicy({ settings }, entry.origin, entry.spaceId, id, Date.now());
      if (policy.muted) {
        mutedCount += 1;
        continue;
      }
      conversations.push({ kind: 'channel', id, origin, count, spaceId: entry.spaceId, name: entry.name, type: entry.type, icon: entry.icon ?? null });
    }
    // DMs first, newest first; channels after, grouped by space in index order.
    conversations.sort((a, b) => {
      if (a.kind === 'dm' && b.kind === 'dm') return b.lastAt - a.lastAt;
      if (a.kind === 'dm') return -1;
      if (b.kind === 'dm') return 1;
      return a.spaceId === b.spaceId ? 0 : a.spaceId < b.spaceId ? -1 : 1;
    });

    const mentions: InboxMentionView[] = allMentions.map((item) => ({
      ...item,
      unread: isNewerId(item.message.id, readStates.get(item.channelId)),
    }));
    const unreadMentionCount = mentions.reduce((n, item) => n + (item.unread ? 1 : 0), 0);
    return { conversations, mutedCount, mentions, unreadMentionCount };
    // `clock` is a dependency on purpose: a timed mute that ends changes the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadChannels, currentChannelId, counts, dmChannels, index, channelOriginMap, settings, clock, allMentions, readStates]);
}
