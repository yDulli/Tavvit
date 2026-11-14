import { messagePath } from '../../utils/openThread';
import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { DmChannel, User } from '@backspace/shared';
import { getMyUserIdForOrigin, useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { isIncomingRequest, useSocialStore, type TaggedFriend } from '../../stores/socialStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { selectRecentPlaces, useRecentPlacesStore, type RecentPlace } from '../../stores/recentPlacesStore';
import { useInstanceStore } from '../../stores/instanceStore';
import { useUnreadCountStore } from '../../stores/unreadCountStore';
import { useCanOpenSpace } from '../../hooks/useCanOpenSpace';
import { useFriendBuckets } from '../../hooks/useFriendBuckets';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { WhatsNewNote } from './WhatsNewNote';
import { useDmViewer } from '../../hooks/useDmViewer';
import { useInbox, type UnreadConversation } from '../../hooks/useInbox';
import { describeError } from '../../i18n/errors';
import { dayPartOf, friendRowKey, groupByVoiceChannel, type HomeFriend, type VoiceGroup } from '../../utils/homeSummary';
import { formatDmHeaderName, formatDmSidebarPreview } from '../../utils/dmFormatters';
import { isMine, userDisplayName } from '../../utils/identity';
import { joinVoiceChannel } from '../../utils/voice';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { markConversationRead } from '../../utils/markConversationRead';
import { resolveSpaceLayout, spacesInLayoutOrder } from '../../utils/spaceLayout';
import { FRIENDS_ADD_PATH, FRIENDS_PENDING_PATH, HOME_ROUTES } from '../../utils/homeNav';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
import { ChannelIcon } from '../ui/ChannelIcon';
import { Icon, type IconName } from '../ui/Icon';
import { PageBody, Panel } from '../ui/PageHeader';
import { useFormatters } from '../../i18n/formatters';
import { useUserContextMenu } from '../layout/userMenu/useUserContextMenu';
import { useConversationContextMenu } from '../layout/conversationMenu/useConversationContextMenu';
import { useSpaceContextMenu } from '../layout/spaceMenu/useSpaceContextMenu';
import { ChannelConversationRow, ConversationTime, DmConversationRow, MentionRow, SpaceChannelMark } from '../inbox/InboxPage';
import { friendProfileUser, useFriendDoing } from './friendDoing';
import { GoChip, HomeHero, type HomeStat } from './HomeHero';
import { HomeSpaceCard, SpaceSuggestTile } from './HomeSpaceCard';

/** How many waiting conversations and mentions Home lists before pointing at the inbox. */
const ATTENTION_LIMIT = 5;
const MENTION_LIMIT = 3;
/** How many places "Recent conversations" offers: four rows of two on a wide screen. */
const RECENT_LIMIT = 8;
/** How many online friends the side column lists before pointing at the Friends page. */
const ONLINE_LIMIT = 8;
/** Below this many spaces, the space grid offers to create or join one. */
const SUGGEST_SPACE_BELOW = 3;
/** How many space cards Home shows before "Show all": two rows of four on a wide window, more rows on a narrower one. */
const SPACE_CARD_LIMIT = 8;

const FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;

/** A space's key across instances: two instances can issue the same id. */
function spaceKey(origin: string, spaceId: string): string {
  return `${origin}\u0000${spaceId}`;
}

/** One block of the page as a frame: its title and count in the head row, an action at its end, its rows. */
function Section({ label, count, action, children, flush = false }: {
  label: string;
  /** Shown beside the title when above zero. */
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** The rows run to the panel's edges and bring their own padding (a table). */
  flush?: boolean;
}) {
  return (
    <Panel
      title={label}
      meta={count !== undefined && count > 0 ? count : undefined}
      actions={action || undefined}
      bodyClassName={flush ? '' : 'p-1.5'}
    >
      {children}
    </Panel>
  );
}

/** Where a list would be when it has nothing to show, with the one thing to do about it. */
function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-body">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * A block of the page that stands open on the canvas rather than in a frame (its cards are frames
 * themselves): its name behind the spark with its count, a hairline running to its action, and what
 * it holds. A region named by its title, as a panel is.
 */
function OpenSection({ label, count, action, children }: {
  label: string;
  /** Shown beside the title when above zero. */
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="min-w-0">
      <div className="mb-3.5 flex min-h-[28px] items-center gap-3">
        <h2 className="eyebrow">{label}</h2>
        {count !== undefined && count > 0 && <span aria-hidden="true" className="count-badge count-badge-muted tabular">{count}</span>}
        <span aria-hidden="true" className="h-px min-w-[24px] flex-1 bg-border-faint" />
        {action}
      </div>
      {children}
    </section>
  );
}

/** What you can start from Home: the one thing most people came for is the white button with the arrow. */
function QuickAction({ icon, label, onClick, main = false }: { icon: IconName; label: string; onClick: () => void; main?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={main ? 'btn-hero btn-lg go-host' : 'btn-outline btn-lg'}>
      {!main && <Icon name={icon} size={15} className="opacity-70" />}
      {label}
      {main && <GoChip />}
    </button>
  );
}

/** A DM in "Recent conversations": who, what was said last, when. */
function RecentDmRow({ dm, onOpen, onContextMenu }: { dm: DmChannel; onOpen: () => void; onContextMenu: (event: React.MouseEvent) => void }) {
  const viewer = useDmViewer(dm.id);
  const others = dm.members.filter((member) => !isMine(member, viewer.origin, viewer.self));
  const isGroup = !!dm.ownerId;
  const rawMain = isGroup ? null : others[0] ?? null;
  const canonical = useCanonicalUserView(rawMain ?? FALLBACK_USER, viewer.origin);
  const main = rawMain ? canonical : null;
  const name = isGroup ? formatDmHeaderName(dm, viewer) : (main && userDisplayName(main)) || '';
  const preview = formatDmSidebarPreview(dm, viewer);
  return (
    <li className="min-w-0">
      <button type="button" onClick={onOpen} onContextMenu={onContextMenu} className="list-row w-full text-left">
        {isGroup ? (
          <AvatarStack members={others} origin={viewer.origin} size={32} border="chat" iconUrl={dm.icon} />
        ) : (
          <Avatar src={main?.avatar} name={name || '?'} size={32} status={main?.status} user={main ?? undefined} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-body font-medium text-txt-primary">{name}</span>
            {dm.lastMessage && <ConversationTime at={dm.lastMessage.createdAt} />}
          </span>
          <span className="mt-0.5 block truncate text-meta text-txt-tertiary">{preview ?? ''}</span>
        </span>
      </button>
    </li>
  );
}

/** A space channel in "Recent conversations": the channel, and the space it is in. */
function RecentChannelRow({ channelId, spaceId, onOpen, onContextMenu }: {
  channelId: string;
  spaceId: string;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const entry = useSpaceStore((s) => s.spaceChannelIndex.get(channelId));
  const space = useSpaceStore((s) => s.spaces.find((candidate) => candidate.id === spaceId && (candidate._instanceOrigin ?? '') === (entry?.origin ?? '')));
  if (!entry) return null;
  return (
    <li className="min-w-0">
      <button type="button" onClick={onOpen} onContextMenu={onContextMenu} className="list-row w-full text-left">
        <SpaceChannelMark space={space} spaceId={spaceId} type={entry.type} icon={entry.icon} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-txt-primary">{entry.name}</span>
          <span className="mt-0.5 block truncate text-meta text-txt-tertiary">{space?.name ?? ''}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * An online friend: who and what they are doing in words (never colour
 * alone). The row opens their profile card; the button beside it opens the
 * conversation with them.
 */
function OnlineFriendRow({ row, onOpen, onMessage, onContextMenu }: {
  row: HomeFriend;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>, friend: TaggedFriend) => void;
  onMessage: (row: HomeFriend) => void;
  onContextMenu: (event: React.MouseEvent, friend: TaggedFriend) => void;
}) {
  const { t } = useTranslation('home');
  const canonical = useCanonicalUserView(row.friend as unknown as User, row.friend._instanceOrigin);
  const name = userDisplayName(canonical);
  const doing = useFriendDoing(row, canonical);
  return (
    <li className="list-row group p-0" onContextMenu={(event) => onContextMenu(event, row.friend)}>
      <button type="button" onClick={(event) => onOpen(event, row.friend)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-1.5 text-left">
        <Avatar src={canonical.avatar} name={name} size={32} status={canonical.status} user={canonical} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-txt-primary">{name}</span>
          <span className={`block truncate text-meta ${doing.busy ? 'text-txt-secondary' : 'text-txt-tertiary'}`}>{doing.line}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onMessage(row)}
        aria-label={t('online.message', { name })}
        className="icon-btn mr-1.5 flex-shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Icon name="message" size={15} />
      </button>
    </li>
  );
}

function VoiceGroupRow({ group, onJoin, onContextMenu }: {
  group: VoiceGroup;
  onJoin: (group: VoiceGroup) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const { t } = useTranslation('home');
  const space = useSpaceStore((s) =>
    s.spaces.find((candidate) => candidate.id === group.spaceId && (candidate._instanceOrigin ?? '') === group.origin),
  );
  const channel = useSpaceStore((s) => s.spaceChannelIndex.get(group.channelId));
  const channelName = channel?.name ?? '';
  const spaceName = space?.name ?? '';
  const members = group.friends.map((row) => row.friend as unknown as User);
  return (
    <li className="list-row" onContextMenu={onContextMenu}>
      <AvatarStack members={members} origin={group.origin} size={32} border="chat" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-ui font-medium text-txt-primary">
          <ChannelIcon type="voice" icon={channel?.icon} size={14} className="flex-shrink-0 text-txt-tertiary" />
          <span className="truncate">{channelName}</span>
        </span>
        <span className="block truncate text-meta text-txt-tertiary">{t('voice.inSpace', { space: spaceName })}</span>
      </span>
      <button type="button" onClick={() => onJoin(group)} aria-label={t('voice.joinLabel', { space: spaceName })} className="btn-outline btn-sm flex-shrink-0">
        {t('voice.join')}
      </button>
    </li>
  );
}

/** For an account with nothing yet: the three ways in, each a real action, numbered like the steps they are. */
function FirstSteps({ onAddFriend, onCreateSpace, onJoinSpace }: { onAddFriend: () => void; onCreateSpace: () => void; onJoinSpace: () => void }) {
  const { t } = useTranslation('home');
  const steps: Array<{ key: string; icon: IconName; title: string; body: string; action: string; onClick: () => void; primary: boolean }> = [
    { key: 'friends', icon: 'user-plus', title: t('onboarding.friends.title'), body: t('onboarding.friends.body'), action: t('empty.addFriend'), onClick: onAddFriend, primary: true },
    { key: 'space', icon: 'grid', title: t('onboarding.space.title'), body: t('onboarding.space.body'), action: t('spaces.create'), onClick: onCreateSpace, primary: false },
    { key: 'invite', icon: 'link', title: t('onboarding.invite.title'), body: t('onboarding.invite.body'), action: t('spaces.join'), onClick: onJoinSpace, primary: false },
  ];
  return (
    <section aria-label={t('empty.title')} className="pt-2">
      <h2 className="display-title ink">{t('empty.title')}</h2>
      <p className="mt-3 max-w-[620px] text-lead leading-[1.5] text-txt-secondary">{t('empty.body')}</p>
      <ul className="stagger mt-7 grid gap-3.5 desktop:grid-cols-3 compact:grid-cols-1">
        {steps.map((step, at) => (
          <li key={step.key} className="surface-card spotlight flex min-h-[230px] flex-col rounded-lg p-5">
            <span className="flex items-center justify-between">
              <span aria-hidden="true" className="label-mono">{String(at + 1).padStart(2, '0')}</span>
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full border border-border-hard text-txt-secondary">
                <Icon name={step.icon} size={16} />
              </span>
            </span>
            <h3 className="mt-auto pt-8 text-title font-semibold tracking-[-0.03em] text-txt-primary">{step.title}</h3>
            <p className="mt-1.5 text-ui leading-[1.45] text-txt-secondary">{step.body}</p>
            <button type="button" onClick={step.onClick} className={`${step.primary ? 'btn-primary' : 'btn-outline'} mt-5 self-start`}>
              {step.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The places in `recent` the client can still show, in order, leaving out the ones in `skip`. */
function useVisibleRecentPlaces(recent: readonly RecentPlace[], dmChannels: readonly DmChannel[], skip: ReadonlySet<string>): Array<RecentPlace & { dm?: DmChannel }> {
  const index = useSpaceStore((s) => s.spaceChannelIndex);
  return useMemo(() => {
    const dmById = new Map(dmChannels.map((dm) => [dm.id, dm]));
    const out: Array<RecentPlace & { dm?: DmChannel }> = [];
    for (const place of recent) {
      if (skip.has(place.channelId)) continue;
      if (place.spaceId === null) {
        const dm = dmById.get(place.channelId);
        if (dm) out.push({ ...place, dm });
      } else if (index.get(place.channelId)?.spaceId === place.spaceId) {
        out.push(place);
      }
      if (out.length === RECENT_LIMIT) break;
    }
    return out;
  }, [recent, dmChannels, index, skip]);
}

/**
 * The page behind the Home tab: where to pick up.
 *
 * It opens with the greeting and the page's figures (HomeHero): what is unread,
 * how many mentions wait, who is online, how many spaces there are, each a way
 * to what it counts. Then the spaces as cards, across the whole width: they are
 * the places people come back to. Under them the main column answers what needs
 * me (the mentions and the conversations with something unread, the same facts
 * as the inbox) and where was I (the conversations opened last on this device,
 * or the latest DMs on a new one, minus the ones already listed above). The side
 * column answers who is around: friend requests, friends in voice, friends
 * online. Everything is read from the client's own stores; nothing is
 * invented, and a section with nothing to show says so in one line, or offers
 * the one action that would fill it.
 *
 * On a wide window the two columns sit side by side and the recent
 * conversations run in two columns; in a compact one everything is one column.
 */
export function HomePage({ now }: { now?: Date }) {
  const { t } = useTranslation(['home', 'common', 'spaces']);
  const { formatFullDate } = useFormatters();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const info = useHomeInstanceInfo();
  const openModal = useUIStore((s) => s.openModal);
  const addToast = useUIStore((s) => s.addToast);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const loadFriends = useSocialStore((s) => s.loadFriends);
  const loadRequests = useSocialStore((s) => s.loadRequests);
  const requests = useSocialStore((s) => s.requests);
  const friends = useSocialStore((s) => s.friends);
  const spaces = useSpaceStore((s) => s.spaces);
  const spaceLayout = useSpaceStore((s) => s.spaceLayout);
  const folders = useSpaceStore((s) => s.folders);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const channelIndex = useSpaceStore((s) => s.spaceChannelIndex);
  const unreadChannels = useChatStore((s) => s.unreadChannels);
  const unreadCounts = useUnreadCountStore((s) => s.counts);
  const voiceUsers = useVoiceStore((s) => s.voiceUsers);
  const instances = useInstanceStore((s) => s.instances);
  const canOpenSpace = useCanOpenSpace();
  const spacesListId = useId();
  const [showAllSpaces, setShowAllSpaces] = useState(false);
  const recent = useRecentPlacesStore((s) => selectRecentPlaces(s, user?.id));
  const buckets = useFriendBuckets();
  const { conversations, mentions, unreadMentionCount } = useInbox();
  // Right-click menus of every row on the page, with the dialogs they open.
  const userMenu = useUserContextMenu();
  const conversationMenu = useConversationContextMenu();
  const spaceMenu = useSpaceContextMenu();

  useEffect(() => {
    void loadFriends();
    void loadRequests();
  }, [loadFriends, loadRequests]);

  const groups = useMemo(() => groupByVoiceChannel(buckets.inVoice), [buckets.inVoice]);
  const incoming = useMemo(
    () => requests.filter((request) => request.status === 'pending' && isIncomingRequest(request)),
    [requests],
  );
  const online = useMemo(() => [...buckets.inVoice, ...buckets.active, ...buckets.around], [buckets]);
  const unreadMentions = useMemo(() => mentions.filter((m) => m.unread).slice(0, MENTION_LIMIT), [mentions]);
  const attention = useMemo(() => conversations.slice(0, ATTENTION_LIMIT), [conversations]);
  const attentionTotal = conversations.length + unreadMentionCount;

  // What the attention list shows is not offered again under recent conversations.
  const shownAbove = useMemo(
    () => new Set([...attention.map((item) => item.id), ...unreadMentions.map((item) => item.channelId)]),
    [attention, unreadMentions],
  );
  const visibleRecent = useVisibleRecentPlaces(recent, dmChannels, shownAbove);
  // No visit on this device yet (or none that is still there): the latest conversations stand in.
  const latestDms = useMemo(
    () => [...dmChannels]
      .filter((dm) => !shownAbove.has(dm.id))
      .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt) - (a.lastMessage?.createdAt ?? a.createdAt))
      .slice(0, RECENT_LIMIT),
    [dmChannels, shownAbove],
  );

  // The spaces in the order of the top bar's tabs, and what is going on in each.
  const orderedSpaces = useMemo(() => spacesInLayoutOrder(resolveSpaceLayout(spaces, spaceLayout, folders)), [spaces, spaceLayout, folders]);
  const mentionsBySpace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of mentions) {
      if (!item.unread) continue;
      const key = spaceKey(item.origin, item.spaceId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [mentions]);
  const unreadSpaces = useMemo(() => {
    const keys = new Set<string>();
    for (const channelId of unreadChannels) {
      const entry = channelIndex.get(channelId);
      if (entry && entry.type !== 'voice') keys.add(spaceKey(entry.origin, entry.spaceId));
    }
    return keys;
  }, [unreadChannels, channelIndex]);
  const voiceBySpace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups) {
      const key = spaceKey(group.origin, group.spaceId);
      counts.set(key, (counts.get(key) ?? 0) + group.friends.length);
    }
    return counts;
  }, [groups]);
  // The unread messages of each space, from the counts its own instance sent, so two spaces with one
  // id on two instances never share a number.
  const unreadTotalBySpace = useMemo(() => {
    const totals = new Map<string, number>();
    for (const channelId of unreadChannels) {
      const entry = channelIndex.get(channelId);
      if (!entry || entry.type === 'voice') continue;
      const count = unreadCounts[entry.origin]?.[channelId] ?? 0;
      if (count <= 0) continue;
      const key = spaceKey(entry.origin, entry.spaceId);
      totals.set(key, (totals.get(key) ?? 0) + count);
    }
    return totals;
  }, [unreadChannels, channelIndex, unreadCounts]);
  // Everyone in each space's voice channels but the viewer, as the instance of the space knows them.
  const peopleInVoiceBySpace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [channelId, userIds] of voiceUsers) {
      const entry = channelIndex.get(channelId);
      if (!entry || entry.type !== 'voice') continue;
      const self = getMyUserIdForOrigin(entry.origin);
      const others = userIds.filter((userId) => userId !== self).length;
      if (others === 0) continue;
      const key = spaceKey(entry.origin, entry.spaceId);
      counts.set(key, (counts.get(key) ?? 0) + others);
    }
    return counts;
  }, [voiceUsers, channelIndex]);
  // The instances the connection to is out, each by the name the person knows it by.
  const reconnectingByOrigin = useMemo(() => {
    const names = new Map<string, string>();
    for (const instance of instances) {
      if (instance.status === 'disconnected' || instance.status === 'error') {
        names.set(instance.origin, instance.label || t('spaces:sidebar.space.remoteInstance'));
      }
    }
    return names;
  }, [instances, t]);
  const shownSpaces = showAllSpaces ? orderedSpaces : orderedSpaces.slice(0, SPACE_CARD_LIMIT);

  const name = user?.displayName || user?.username || '';
  const instance = info?.name ?? window.location.host;
  const part = dayPartOf((now ?? new Date()).getHours());
  const nothingYet = friends.length === 0 && spaces.length === 0 && dmChannels.length === 0;

  const addFriend = () => navigate(FRIENDS_ADD_PATH);
  const createSpace = () => openModal('createSpace');
  const joinSpace = () => openModal('joinSpace');
  const openConversation = (item: UnreadConversation) => {
    navigate(item.kind === 'dm' ? `/channels/@me/${item.id}` : `/channels/${item.spaceId}/${item.id}`);
  };
  const mark = async (channelId: string) => {
    if (!(await markConversationRead(channelId))) addToast(t('home:inbox.markFailed'), 'warning');
  };
  const handleJoinVoice = (group: VoiceGroup) => {
    // The same two steps as clicking a voice channel in the sidebar.
    joinVoiceChannel(group.channelId, useVoiceStore.getState().connectFn ?? undefined);
    navigate(`/channels/${group.spaceId}/${group.channelId}`);
  };
  const handleMessage = async (row: HomeFriend) => {
    try {
      const dmId = await openDirectMessage(row.friend, row.friend._instanceOrigin);
      navigate(`/channels/@me/${dmId}`);
    } catch (err) {
      addToast(describeError(err), 'warning');
    }
  };
  const handleOpenProfile = (event: React.MouseEvent<HTMLButtonElement>, friend: TaggedFriend) => {
    // The side column is on the right, so the card opens to its left, as from the activity column.
    openUserProfile(friendProfileUser(friend), friend._instanceOrigin, event.currentTarget.getBoundingClientRect(), 'left');
  };

  // The page's figures, each from the same facts as the section it leads to.
  const stats: HomeStat[] = [
    { key: 'unread', icon: 'message', label: t('home:inbox.tabs.unread'), value: conversations.length, onOpen: () => navigate(HOME_ROUTES.inbox) },
    { key: 'mentions', icon: 'at', label: t('home:inbox.tabs.mentions'), value: unreadMentionCount, onOpen: () => navigate(HOME_ROUTES.inbox) },
    { key: 'online', icon: 'users', label: t('home:online.title'), value: online.length, onOpen: () => navigate(HOME_ROUTES.friends) },
    { key: 'spaces', icon: 'grid', label: t('home:inbox.sections.spaces'), value: orderedSpaces.length, onOpen: () => navigate(HOME_ROUTES.explore) },
  ];

  return (
    <div className="lit-phone flex h-full min-w-0 flex-1 flex-col bg-surface-chat desktop:bg-transparent">
      <div className="panel-bar flex items-center gap-2 px-4 desktop:hidden">
        <Icon name="home" size={17} className="text-txt-tertiary" />
        <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('home:nav.home')}</span>
      </div>

      <div className="relative isolate min-h-0 flex-1 overflow-y-auto">
        <HomeHero
          eyebrow={<><span>{t('home:nav.home')}</span><span aria-hidden="true">·</span><span>{formatFullDate(Date.now())}</span></>}
          greeting={t(`home:greeting.${part}`, { name })}
          name={name}
          description={(
            <>
              <p>
                {online.length > 0
                  ? t('home:subtitle.online', { instance, n: online.length })
                  : t('home:subtitle.quiet', { instance })}
              </p>
              <WhatsNewNote />
            </>
          )}
          // The search is the sidebar's, on every page: Home has no second one.
          actions={!nothingYet && (
            <>
              <QuickAction main icon="message" label={t('home:actions.newMessage')} onClick={() => openModal('newDm')} />
              <QuickAction icon="user-plus" label={t('home:actions.addFriend')} onClick={addFriend} />
              <QuickAction icon="plus" label={t('home:actions.createSpace')} onClick={createSpace} />
              <QuickAction icon="login" label={t('home:actions.joinSpace')} onClick={joinSpace} />
            </>
          )}
          // The first steps say what to do with an account that has nothing yet; its figures would all be zero.
          stats={nothingYet ? [] : stats}
        />
        <PageBody>
          {nothingYet ? (
            <FirstSteps onAddFriend={addFriend} onCreateSpace={createSpace} onJoinSpace={joinSpace} />
          ) : (
            <>
              {/* The spaces come first and across the whole width: they are the places people come back to. */}
              <OpenSection
                label={t('home:spaces.title')}
                count={orderedSpaces.length}
                action={orderedSpaces.length > SPACE_CARD_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllSpaces((all) => !all)}
                    aria-expanded={showAllSpaces}
                    aria-controls={spacesListId}
                    className="btn-quiet btn-sm"
                  >
                    {showAllSpaces ? t('home:spaces.showFewer') : t('home:spaces.showAll')}
                  </button>
                )}
              >
                <ul id={spacesListId} className="home-spaces stagger">
                  {shownSpaces.map((space) => {
                    const origin = space._instanceOrigin ?? '';
                    const key = spaceKey(origin, space.id);
                    return (
                      <HomeSpaceCard
                        key={key}
                        space={space}
                        mentions={mentionsBySpace.get(key) ?? 0}
                        unreadTotal={unreadTotalBySpace.get(key) ?? 0}
                        unread={unreadSpaces.has(key)}
                        friendsInVoice={voiceBySpace.get(key) ?? 0}
                        peopleInVoice={peopleInVoiceBySpace.get(key) ?? 0}
                        reconnecting={origin ? reconnectingByOrigin.get(origin) ?? null : null}
                        onOpen={() => { if (canOpenSpace(space)) navigate(`/channels/${space.id}`); }}
                        onContextMenu={(event) => spaceMenu.open(space.id, event)}
                      />
                    );
                  })}
                  {orderedSpaces.length < SUGGEST_SPACE_BELOW && (
                    <SpaceSuggestTile alone={orderedSpaces.length === 0} onCreate={createSpace} onJoin={joinSpace} />
                  )}
                </ul>
              </OpenSection>

              <div className="stagger mt-8 grid grid-cols-1 gap-4 desktop:grid-cols-[minmax(0,1fr)_340px] compact:grid-cols-1">
                <div className="min-w-0 space-y-4">
                  <Section
                    label={t('home:attention.title')}
                    action={attentionTotal > 0 && (
                      <button type="button" onClick={() => navigate(HOME_ROUTES.inbox)} className="btn-quiet btn-sm">
                        {t('home:attention.openInbox', { count: attentionTotal })}
                      </button>
                    )}
                  >
                    {attentionTotal === 0 ? (
                      <p className="flex items-center gap-2 px-2.5 py-1.5 text-ui text-txt-tertiary">
                        <Icon name="check" size={15} />
                        {t('home:messages.caughtUp')}
                      </p>
                    ) : (
                      <ul className="space-y-px">
                        {unreadMentions.map((item) => (
                          <MentionRow
                            key={`${item.origin}:${item.message.id}`}
                            item={item}
                            onOpen={() => navigate(messagePath(item.spaceId, item.channelId, item.message.id))}
                            onMark={() => mark(item.channelId)}
                            onContextMenu={(event) => conversationMenu.openMention(event, { origin: item.origin, spaceId: item.spaceId, channelId: item.channelId, messageId: item.message.id })}
                          />
                        ))}
                        {attention.map((item) => (item.kind === 'dm'
                          ? <DmConversationRow key={item.id} item={item} onOpen={() => openConversation(item)} onMark={() => mark(item.id)} onContextMenu={(event) => conversationMenu.openDm(event, item.id)} />
                          : <ChannelConversationRow key={item.id} item={item} withSpace onOpen={() => openConversation(item)} onMark={() => mark(item.id)} onContextMenu={(event) => conversationMenu.openChannel(event, item.id)} />))}
                      </ul>
                    )}
                  </Section>

                  <Section label={t('home:recent.title')}>
                    {visibleRecent.length > 0 ? (
                      <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-2 gap-y-px">
                        {visibleRecent.map((place) => (place.dm
                          ? <RecentDmRow key={place.channelId} dm={place.dm} onOpen={() => navigate(`/channels/@me/${place.channelId}`)} onContextMenu={(event) => conversationMenu.openDm(event, place.channelId)} />
                          : <RecentChannelRow key={place.channelId} channelId={place.channelId} spaceId={place.spaceId ?? ''} onOpen={() => navigate(`/channels/${place.spaceId}/${place.channelId}`)} onContextMenu={(event) => conversationMenu.openChannel(event, place.channelId)} />))}
                      </ul>
                    ) : latestDms.length > 0 ? (
                      <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-2 gap-y-px">
                        {latestDms.map((dm) => <RecentDmRow key={dm.id} dm={dm} onOpen={() => navigate(`/channels/@me/${dm.id}`)} onContextMenu={(event) => conversationMenu.openDm(event, dm.id)} />)}
                      </ul>
                    ) : (
                      <p className="px-2.5 py-1.5 text-ui text-txt-tertiary">{t('home:recent.empty')}</p>
                    )}
                  </Section>

                </div>

                <aside className="min-w-0 space-y-4">
                  {incoming.length > 0 && (
                    <Section label={t('home:requests.title')}>
                      <div className="list-row">
                        <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border-hard text-txt-secondary">
                          <Icon name="user-plus" size={16} />
                        </span>
                        <span className="min-w-0 flex-1 text-ui text-txt-primary">{t('home:requests.waiting', { n: incoming.length })}</span>
                        <button type="button" onClick={() => navigate(FRIENDS_PENDING_PATH)} className="btn-outline btn-sm flex-shrink-0">
                          {t('home:requests.review')}
                        </button>
                      </div>
                    </Section>
                  )}

                  {groups.length > 0 && (
                    <Section label={t('home:voice.title')}>
                      <ul className="space-y-px">
                        {groups.map((group) => (
                          <VoiceGroupRow
                            key={`${group.origin}:${group.channelId}`}
                            group={group}
                            onJoin={handleJoinVoice}
                            onContextMenu={(event) => conversationMenu.openChannel(event, group.channelId)}
                          />
                        ))}
                      </ul>
                    </Section>
                  )}

                  <Section
                    label={t('home:online.title')}
                    count={online.length}
                    action={online.length > ONLINE_LIMIT && (
                      <button type="button" onClick={() => navigate(HOME_ROUTES.friends)} className="btn-quiet btn-sm">
                        {t('home:online.viewAll')}
                      </button>
                    )}
                  >
                    {online.length > 0 ? (
                      <ul className="space-y-px">
                        {online.slice(0, ONLINE_LIMIT).map((row) => (
                          <OnlineFriendRow
                            key={friendRowKey(row.friend)}
                            row={row}
                            onOpen={handleOpenProfile}
                            onMessage={(r) => { void handleMessage(r); }}
                            // The side column is on the right, so the profile card opens to its left.
                            onContextMenu={(event, friend) => userMenu.open(event, friendProfileUser(friend), friend._instanceOrigin, 'left')}
                          />
                        ))}
                      </ul>
                    ) : friends.length > 0 ? (
                      <EmptyState
                        icon="moon"
                        title={t('home:online.nobodyTitle')}
                        body={t('home:online.nobody', { count: buckets.offline })}
                        action={<button type="button" onClick={addFriend} className="btn-outline btn-sm">{t('home:actions.addFriend')}</button>}
                      />
                    ) : (
                      <EmptyState
                        icon="users"
                        title={t('home:online.noFriendsTitle')}
                        body={t('home:online.noFriends')}
                        action={<button type="button" onClick={addFriend} className="btn-outline btn-sm">{t('home:actions.addFriend')}</button>}
                      />
                    )}
                  </Section>
                </aside>
              </div>
            </>
          )}
        </PageBody>
      </div>
      {userMenu.dialogs}
      {conversationMenu.dialogs}
      {spaceMenu.dialogs}
    </div>
  );
}
