import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelfIdentity } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useSocialStore, type TaggedFriend } from '../stores/socialStore';
import { useSpaceStore } from '../stores/spaceStore';
import { formatDmHeaderName } from '../utils/dmFormatters';
import { friendRowKey } from '../utils/homeSummary';
import { isMine, parseFederatedUsername, userDisplayName } from '../utils/identity';
import { hasPermissionBit, PermissionBits } from '../utils/permissions';
import { HOME_ROUTES } from '../utils/homeNav';
import type { SwitcherItem } from '../utils/quickSwitcher';

export interface SwitcherSource {
  items: SwitcherItem[];
  /** The friend rows behind the `friend` targets, by `friendRowKey`. */
  friends: Map<string, TaggedFriend>;
}

/**
 * Everything the quick switcher can jump to, gathered from what the client
 * already holds: conversations, friends who have no conversation yet, spaces,
 * the channels of every space the user can see, and the app's own pages.
 */
export function useSwitcherItems(): SwitcherSource {
  const { t } = useTranslation(['common', 'home', 'spaces', 'dm']);
  const self = useSelfIdentity();
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const channelOriginMap = useSpaceStore((s) => s.channelOriginMap);
  const channelToSpaceMap = useSpaceStore((s) => s.channelToSpaceMap);
  const spaces = useSpaceStore((s) => s.spaces);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const spaceChannelIndex = useSpaceStore((s) => s.spaceChannelIndex);
  const channelPermissions = useSpaceStore((s) => s.channelPermissions);
  const findExistingDmForUser = useSpaceStore((s) => s.findExistingDmForUser);
  const friends = useSocialStore((s) => s.friends);
  const unreadChannels = useChatStore((s) => s.unreadChannels);

  return useMemo(() => {
    const items: SwitcherItem[] = [];
    const friendRows = new Map<string, TaggedFriend>();

    for (const dm of dmChannels) {
      const origin = channelOriginMap.get(dm.id) ?? '';
      const others = dm.members.filter((m) => !isMine(m, origin, self));
      const isGroup = !!dm.ownerId;
      if (!isGroup && others.length === 0) continue;
      const partner = others[0];
      items.push({
        id: `dm:${dm.id}`,
        kind: 'dm',
        label: isGroup ? formatDmHeaderName(dm, { self, origin }) : userDisplayName(partner!),
        detail: !isGroup && partner ? `@${parseFederatedUsername(partner.username).baseName}` : undefined,
        keywords: others.map((m) => `${m.username} ${m.displayName ?? ''}`).join(' '),
        unread: unreadChannels.has(dm.id),
        recency: dm.lastMessage?.createdAt ?? dm.createdAt,
        target: { type: 'route', path: `/channels/@me/${dm.id}` },
      });
    }

    for (const friend of friends) {
      // A friend you already have a conversation with is that conversation, above.
      if (findExistingDmForUser(friend, friend._instanceOrigin)) continue;
      const key = friendRowKey(friend);
      friendRows.set(key, friend);
      items.push({
        id: `friend:${key}`,
        kind: 'friend',
        label: userDisplayName(friend),
        detail: `@${parseFederatedUsername(friend.username).baseName}`,
        keywords: friend.username,
        target: { type: 'friend', key },
      });
    }

    for (const space of spaces) {
      let unread = false;
      for (const channelId of unreadChannels) {
        if (channelToSpaceMap.get(channelId) === space.id) { unread = true; break; }
      }
      items.push({
        id: `space:${space.id}`,
        kind: 'space',
        label: space.name,
        unread,
        target: { type: 'route', path: `/channels/${space.id}` },
      });
    }

    // Every channel the user can see, in every space: the index carries their
    // names (stores/spaceChannels.ts), so a channel of a space that is not
    // open is one keystroke away too.
    const spaceNames = new Map(spaces.map((space) => [`${space._instanceOrigin ?? ''}:${space.id}`, space.name]));
    for (const [channelId, entry] of spaceChannelIndex) {
      if (entry.type === 'thread') continue;
      if (!hasPermissionBit(channelPermissions.get(channelId), PermissionBits.VIEW_CHANNEL)) continue;
      items.push({
        id: `channel:${channelId}`,
        kind: 'channel',
        label: entry.name,
        detail: spaceNames.get(`${entry.origin}:${entry.spaceId}`) ?? '',
        keywords: entry.type,
        unread: unreadChannels.has(channelId),
        recency: entry.spaceId === currentSpaceId ? 1 : undefined,
        target: { type: 'route', path: `/channels/${entry.spaceId}/${channelId}` },
        channel: { type: entry.type, icon: entry.icon ?? null },
      });
    }

    const pages: Array<[string, string, string]> = [
      ['home', t('home:nav.home'), HOME_ROUTES.home],
      ['inbox', t('home:nav.inbox'), HOME_ROUTES.inbox],
      ['friends', t('common:labels.friends'), HOME_ROUTES.friends],
      ['explore', t('spaces:sidebar.dmList.explore'), HOME_ROUTES.explore],
      ['about', t('home:nav.about'), HOME_ROUTES.about],
    ];
    for (const [id, label, path] of pages) {
      items.push({ id: `page:${id}`, kind: 'page', label, target: { type: 'route', path } });
    }
    items.push({ id: 'page:settings', kind: 'page', label: t('common:labels.settings'), target: { type: 'settings' } });

    return { items, friends: friendRows };
  }, [
    t, self, dmChannels, channelOriginMap, channelToSpaceMap, spaces, currentSpaceId, spaceChannelIndex,
    channelPermissions, findExistingDmForUser, friends, unreadChannels,
  ]);
}
