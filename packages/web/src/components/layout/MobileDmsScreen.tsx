import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';
import { useSocialStore } from '../../stores/socialStore';
import { useContextMenuStore } from '../../stores/contextMenuStore';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
import { DecoratedName, NameplateLayer } from '../ui/Decorations';
import { personDecorations } from '../../utils/decorations';
import { resolveAssetUrl } from '../../utils/assetUrls';
import { useNavigate } from 'react-router-dom';
import { useFriendBuckets } from '../../hooks/useFriendBuckets';
import { useInboxCount } from '../../hooks/useInboxCount';
import { friendRowKey } from '../../utils/homeSummary';
import { Icon } from '../ui/Icon';
import { CountBadge } from '../ui/CountBadge';
import { DmRowUnreadBadge } from './DmUnreadBadge';
import { BAR_BUTTON, BAR_TITLE } from './mobileClasses';
import { useQuickSwitcherStore } from '../../stores/quickSwitcherStore';
import { describeError } from '../../i18n/errors';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { parseFederatedUsername, isFederationGlobeApplicable, isMine, userDisplayName } from '../../utils/identity';
import { useDmViewer } from '../../hooks/useDmViewer';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { formatDmSidebarPreview, formatDmHeaderName } from '../../utils/dmFormatters';
import type { DmChannel, User } from '@backspace/shared';
import type { TaggedFriend } from '../../stores/socialStore';

const FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;

function MobileFriendBubble({
  friend,
  inVoice,
  onOpen,
}: {
  friend: TaggedFriend;
  /** The friend is connected to a voice channel; the avatar gets a green ring. */
  inVoice: boolean;
  onOpen: (friend: TaggedFriend) => void;
}) {
  const canonical = useCanonicalUserView(friend as unknown as User, friend._instanceOrigin);
  // _instanceOrigin lives on TaggedFriend, not on the canonical User. Use the
  // canonical avatar value but source the origin from the original friend.
  const avatarUrl = canonical.avatar
    ? resolveAssetUrl(canonical.avatar, friend._instanceOrigin) ?? `/api/uploads/${canonical.avatar}`
    : null;
  const displayName = userDisplayName(canonical);

  return (
    <button
      onClick={() => onOpen(friend)}
      className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-md py-1 transition-colors hover:bg-interactive-hover active:bg-interactive-active"
    >
      <div className="relative">
        <Avatar
          src={avatarUrl}
          name={displayName}
          avatarColor={canonical.avatarColor}
          userId={canonical.homeUserId ?? canonical.id}
          size={inVoice ? 36 : 40}
          ring={inVoice ? { width: 2, color: 'rgb(var(--status-online))' } : undefined}
        />
        <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-surface-channel ${
          friend.status === 'online' ? 'bg-status-online' :
          friend.status === 'idle' ? 'bg-status-idle' :
          'bg-status-dnd'
        }`} />
      </div>
      <span className="w-full truncate px-0.5 text-center text-2xs text-txt-secondary">
        {displayName}
      </span>
    </button>
  );
}

function MobileDmRow({
  dm,
  readStates,
  onTap,
  onContextMenu,
  formatTimestamp,
}: {
  dm: DmChannel;
  readStates: Map<string, string>;
  onTap: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string, isGroup: boolean) => void;
  formatTimestamp: (ts: number) => string;
}) {
  const { t } = useTranslation(['dm', 'common']);
  const viewer = useDmViewer(dm.id);
  const otherMembers = dm.members.filter(m => !isMine(m, viewer.origin, viewer.self));
  const isGroup = !!dm.ownerId;
  const rawMainUser = otherMembers[0] ?? null;
  const canonicalMainUser = useCanonicalUserView(rawMainUser ?? FALLBACK_USER, viewer.origin);
  const mainUser = rawMainUser ? canonicalMainUser : null;

  // Group DMs → `formatDmHeaderName` (single source of truth shared with
  // `MobileChatScreen`, `MainContent`, `DmListItem`, welcome hero). 1:1 DMs
  // keep the canonical view of the single other member.
  const name = isGroup
    ? formatDmHeaderName(dm, viewer)
    : (mainUser && userDisplayName(mainUser)) || t('common:states.unknown');

  // Show a single federation globe next to the group name when any non-self
  // member is federated. No tooltip on mobile — the new `group-dm-info` screen
  // surfaces federation identity per-member.
  const groupHasFederatedMember = isGroup && otherMembers.some((m) => isFederationGlobeApplicable(m));

  const lastMsgId = dm.lastMessage?.id;
  const readState = readStates.get(dm.id);
  const isUnread = lastMsgId && (!readState || readState < lastMsgId);

  const preview = formatDmSidebarPreview(dm, viewer);
  const previewTime = dm.lastMessage?.createdAt;

  const avatarUrl = mainUser?.avatar ? `/api/uploads/${mainUser.avatar}` : null;
  // A conversation with one person shows their decorations (docs/systems/decorations.md), still on a phone.
  const decorations = personDecorations(isGroup ? null : mainUser, name);

  return (
    <button
      key={dm.id}
      data-context-menu
      onClick={() => onTap(dm.id)}
      onContextMenu={(e) => onContextMenu(e, dm.id, isGroup)}
      className="list-row deco-hover relative isolate w-full rounded-none px-4 py-2.5"
    >
      <NameplateLayer nameplate={decorations.nameplate} colors={decorations.colors} motion="hover" />
      <div className="relative shrink-0">
        {isGroup ? (
          // Reuse the shared AvatarStack so group rows match the rest of the
          // group-DM surface (chat header, DmListItem, GroupDmSettings hero).
          // size 40 matches the 1:1 Avatar above it; border="channel" is the
          // surface this list stands on.
          <AvatarStack
            members={otherMembers}
            origin={viewer.origin}
            size={40}
            border="channel"
            iconUrl={dm.icon}
          />
        ) : (
          <Avatar
            src={avatarUrl}
            name={name}
            avatarColor={mainUser?.avatarColor}
            size={40}
            user={mainUser ?? undefined}
            frame={decorations.avatarFrame}
            frameMotion="hover"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 min-w-0">
            <DecoratedName
              font={decorations.nameFont}
              effect={decorations.nameEffect}
              colors={decorations.colors}
              motion="hover"
              className={`truncate text-body text-txt-primary ${isUnread ? 'font-semibold' : ''}`}
            >
              {name}
            </DecoratedName>
            {groupHasFederatedMember && (
              <svg
                data-dm-row-globe
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-txt-tertiary/80 flex-shrink-0"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            )}
          </span>
          {previewTime && (
            <span className={`shrink-0 font-mono text-label tabular ${isUnread ? 'text-txt-secondary' : 'text-txt-tertiary'}`}>
              {formatTimestamp(previewTime)}
            </span>
          )}
        </div>
        {!isGroup && mainUser && isFederationGlobeApplicable(mainUser) && (
          <div className="text-2xs leading-[1.3] text-txt-tertiary truncate opacity-60">
            @{parseFederatedUsername(mainUser.username).domain}
          </div>
        )}
        {(preview || isUnread) && (
          <div className="mt-0.5 flex items-center gap-2">
            <p className={`min-w-0 flex-1 truncate text-meta ${isUnread ? 'font-medium text-txt-secondary' : 'text-txt-tertiary'}`}>
              {preview}
            </p>
            {isUnread && <DmRowUnreadBadge dmId={dm.id} />}
          </div>
        )}
      </div>
    </button>
  );
}

export function MobileDmsScreen() {
  const { t } = useTranslation(['dm', 'common', 'social', 'home']);
  const pushMobileScreen = useUIStore((s) => s.pushMobileScreen);
  const openModal = useUIStore((s) => s.openModal);
  const inboxCount = useInboxCount();

  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const readStates = useChatStore((s) => s.readStates);
  const friends = useSocialStore((s) => s.friends);
  const navigate = useNavigate();
  const f = useFormatters();
  const openContextMenu = useContextMenuStore((s) => s.open);
  const setCurrentChannel = useChatStore((s) => s.setCurrentChannel);
  const addToast = useUIStore((s) => s.addToast);
  const buckets = useFriendBuckets();
  const inVoiceIds = useMemo(
    () => new Set(buckets.inVoice.map((row) => friendRowKey(row.friend))),
    [buckets.inVoice],
  );

  // Online friends for the activity row
  const onlineFriends = useMemo(() =>
    friends.filter(f => f.status === 'online' || f.status === 'idle' || f.status === 'dnd'),
    [friends]
  );

  // Sort DMs by last message time (newest first)
  const sortedDms = useMemo(() =>
    [...dmChannels].sort((a, b) => {
      const aTime = a.lastMessage?.createdAt ?? a.createdAt;
      const bTime = b.lastMessage?.createdAt ?? b.createdAt;
      return bTime - aTime;
    }),
    [dmChannels]
  );

  const handleDmTap = (dmId: string) => {
    navigate(`/channels/@me/${dmId}`);
    pushMobileScreen('channel-chat', { channelId: dmId, spaceId: '@me' });
  };

  // Opens the conversation with a friend, creating it when there is none yet.
  const handleOpenFriend = async (friend: TaggedFriend) => {
    try {
      handleDmTap(await openDirectMessage(friend, friend._instanceOrigin));
    } catch (err) {
      addToast(t('social:sendMessage.failed', { reason: describeError(err) }), 'warning');
    }
  };

  const handleDmContextMenu = (e: React.MouseEvent, dmId: string, isGroup: boolean) => {
    if (!isGroup) return;
    e.preventDefault();
    e.stopPropagation();

    openContextMenu({ x: e.clientX, y: e.clientY }, [
      {
        key: 'leave-group',
        type: 'action',
        label: t('dm:list.leaveGroup'),
        danger: true,
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>,
        onClick: () => {
          const currentChId = useChatStore.getState().currentChannelId;
          if (currentChId === dmId) {
            navigate('/channels/@me');
            setCurrentChannel(null);
          }
          useSpaceStore.getState().leaveDm(dmId);
        },
      },
    ]);
  };

  const formatTimestamp = (ts: number): string => {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return t('dm:list.justNow');
    if (diff < 3600_000) return t('dm:list.minutesShort', { count: Math.floor(diff / 60_000) });
    if (diff < 86400_000) return t('dm:list.hoursShort', { count: Math.floor(diff / 3600_000) });
    if (diff < 604800_000) return t('dm:list.daysShort', { count: Math.floor(diff / 86400_000) });
    return f.formatShortDate(ts);
  };

  return (
    <div className="lit relative flex flex-col h-full bg-surface-channel">
      {/* Header */}
      <header className="panel-bar flex h-12 items-center gap-1 pl-4 pr-1">
        <h1 className={BAR_TITLE}>{t('dm:list.title')}</h1>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => useQuickSwitcherStore.getState().setOpen(true)}
            aria-label={t('common:actions.search')}
            className={BAR_BUTTON}
          >
            <Icon name="search" size={18} />
          </button>
          {/* The inbox is a screen of its own on the phone; its count is the one the desktop sidebar shows. */}
          <button
            type="button"
            onClick={() => pushMobileScreen('inbox')}
            aria-label={inboxCount > 0 ? t('home:inbox.navLabel', { count: inboxCount }) : t('home:nav.inbox')}
            className={BAR_BUTTON}
          >
            <span className="relative flex h-8 w-8 items-center justify-center">
              <Icon name="bell" size={18} />
              {inboxCount > 0 && <CountBadge count={inboxCount} placement="corner" />}
            </span>
          </button>
          <button
            type="button"
            onClick={() => pushMobileScreen('friends')}
            className="btn-quiet h-10 px-2.5"
          >
            <Icon name="users" size={15} />
            {t('common:labels.friends')}
          </button>
        </div>
      </header>

      {/* Activity row — online friends */}
      {onlineFriends.length > 0 && (
        <div className="shrink-0 border-b border-border-hard py-2">
          {/* The row runs to the screen's edges, so a cut-off friend reads as more
              to scroll to; the first avatar stands over the list's avatars. */}
          <div className="flex gap-1 overflow-x-auto px-1 no-scrollbar">
            {onlineFriends.map(friend => (
              <MobileFriendBubble
                key={friend.id}
                friend={friend}
                inVoice={inVoiceIds.has(friendRowKey(friend))}
                onOpen={handleOpenFriend}
              />
            ))}
          </div>
        </div>
      )}

      {/* DM list */}
      <div className="flex-1 overflow-y-auto pb-20">
        {sortedDms.map(dm => (
          <MobileDmRow
            key={dm.id}
            dm={dm}
            readStates={readStates}
            onTap={handleDmTap}
            onContextMenu={handleDmContextMenu}
            formatTimestamp={formatTimestamp}
          />
        ))}

        {sortedDms.length === 0 && (
          <div className="empty-state h-40">
            <span className="empty-state-icon" aria-hidden="true">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-8 8H4l2.2-3A8 8 0 1 1 21 12Z" />
              </svg>
            </span>
            <p className="empty-state-body">{t('dm:list.empty')}</p>
          </div>
        )}
      </div>

      {/* FAB — New DM. Anchored to this screen rather than the viewport, so it
          clears the bottom navigation, the safe area and the voice mini bar. */}
      <button
        data-tooltip=""
        type="button"
        onClick={() => openModal('newDm')}
        aria-label={t('dm:newDm.title')}
        className="btn-primary absolute bottom-4 right-4 z-20 h-12 w-12 p-0 shadow-elevation-high"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      </button>
    </div>
  );
}
