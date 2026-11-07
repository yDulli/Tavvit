import { channelTakesWebhooks } from '../../utils/channelKinds';
import { ChannelIcon } from '../ui/ChannelIcon';
import { SpaceEventsRow } from '../events/SpaceEventsRow';
import { FollowedThreadRows } from './FollowedThreadRows';
import { useInboxCount } from '../../hooks/useInboxCount';
import React, { useState, useRef, useCallback, useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Channel } from '@backspace/shared';
import { useSpaceStore, getChannelOrigin, type TaggedSpace } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useInstanceStore } from '../../stores/instanceStore';
import { isIncomingRequest, useSocialStore } from '../../stores/socialStore';
import { VoiceChannel } from '../voice/VoiceChannel';
import { VoiceControls } from '../voice/VoiceControls';
import { useVoiceStore } from '../../stores/voiceStore';
import { CountBadge } from '../ui/CountBadge';
import { SlidingMark } from '../ui/SlidingMark';
import { Icon, type IconName } from '../ui/Icon';
import { BadgeList } from '../../badges/BadgeList';
import { wsSend } from '../../hooks/useWebSocket';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { viewerCanActOn } from '../../utils/roleHierarchy';
import { joinVoiceChannel } from '../../utils/voice';
import { useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { useConversationContextMenu } from './conversationMenu/useConversationContextMenu';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DmSearchBar } from './DmSearchBar';
import { DmListItem } from './DmListItem';
import { useDragManager, type DropTarget, type LayoutItem } from '../../hooks/useDragManager';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { activeHomeNavItem, HOME_ROUTES, isHomeNavMoreItem } from '../../utils/homeNav';
import { useSpaceBanner } from '../../hooks/useSpaceBanner';
import { SpaceBannerHeader } from './SpaceBannerHeader';
import { ChannelMutedIndicator } from '../notifications/ChannelMutedIndicator';

/**
 * One item of the home block: a navigation row with its glyph. `aria-current`
 * marks the selected page for assistive technology; `data-active` draws the
 * selected mark for eyes.
 */
function HomeNavRow({ active, label, icon, onClick, count = 0, countLabel }: {
  active: boolean;
  label: string;
  icon: IconName;
  onClick: () => void;
  /** Something waiting there (the inbox, friend requests): a count at the row's end. */
  count?: number;
  /** What the count means, read instead of the bare number. */
  countLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : undefined}
      className="nav-item group w-full text-left"
    >
      <Icon name={icon} size={16} className={`flex-shrink-0 ${active ? 'text-txt-primary' : 'text-txt-tertiary group-hover:text-txt-secondary'}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <CountBadge count={count} label={countLabel} />}
    </button>
  );
}

/**
 * The column's bar in a space: its name with its badges and instance, which opens the space's
 * settings, and the invite button. Over the space's banner every word and mark is drawn in the
 * primary colour, the one that keeps its contrast on a picture under the bar's shade.
 */
function SpaceHeaderRow({ space, instanceLabel, canCreateInvite, overBanner }: {
  space: TaggedSpace;
  instanceLabel: string | null;
  canCreateInvite: boolean;
  overBanner: boolean;
}) {
  const { t } = useTranslation(['spaces', 'common']);
  const openModal = useUIStore((s) => s.openModal);
  const quiet = overBanner ? 'text-txt-primary' : 'text-txt-tertiary';
  return (
    <>
      <button
        type="button"
        onClick={() => openModal('spaceSettings')}
        className="flex-1 h-9 px-2 flex items-center justify-between gap-2 rounded-md hover:bg-interactive-hover active:bg-interactive-active transition-colors min-w-0"
      >
        <div className="min-w-0 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 font-semibold text-lead tracking-[-0.01em] text-txt-primary truncate leading-tight">{space.name}</span>
            <BadgeList badges={space.badges ?? []} size="sm" />
          </span>
          {instanceLabel && (
            <span className={`font-mono text-label ${quiet} truncate block leading-tight`}>
              {instanceLabel}
            </span>
          )}
        </div>
        <Icon name="chevron-down" size={16} className={`${quiet} flex-shrink-0`} />
      </button>
      {canCreateInvite && (
        <button
          type="button"
          onClick={() => openModal('invite')}
          className={`icon-btn icon-btn-lg flex-shrink-0 ${overBanner ? 'text-txt-primary' : ''}`}
          aria-label={t('common:actions.invitePeople')}
        >
          <Icon name="user-plus" size={17} />
        </button>
      )}
    </>
  );
}

/** The mark of a category in a menu: an outlined folder. */
function FolderGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 18a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h4.5l2 3H19a2 2 0 012 2z" />
    </svg>
  );
}

type DmFilter = 'all' | 'unread';

export function ChannelSidebar() {
  const { t } = useTranslation(['spaces', 'common', 'home', 'dm']);
  const inboxCount = useInboxCount();
  const friendRequests = useSocialStore((s) => s.requests);
  const pendingRequestCount = useMemo(
    () => friendRequests.filter((request) => request.status === 'pending' && isIncomingRequest(request)).length,
    [friendRequests],
  );
  // Which direct messages the list shows. Local on purpose: a filter is a
  // glance, and the list opens on every conversation again next time.
  const [dmFilter, setDmFilter] = useState<DmFilter>('all');
  const spaces = useSpaceStore((s) => s.spaces);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const loadingSpaceId = useSpaceStore((s) => s.loadingSpaceId);
  const channels = useSpaceStore((s) => s.channels);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const setCurrentChannel = useChatStore((s) => s.setCurrentChannel);
  const unreadChannels = useChatStore((s) => s.unreadChannels);
  const openModal = useUIStore((s) => s.openModal);
  const user = useAuthStore((s) => s.user);
  const members = useSpaceStore((s) => s.members);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const navigate = useNavigate();
  const location = useLocation();
  const activeHomeItem = activeHomeNavItem(location.pathname, currentChannelId);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const spacePermissions = useSpaceStore((s) => s.spacePermissions);
  const space = spaces.find(s => s.id === currentSpaceId);
  // The space's banner heads its column when it has one the page may show (docs/systems/spaces.md).
  const banner = useSpaceBanner(space?.banner);
  const mySpacePerms = currentSpaceId ? spacePermissions.get(currentSpaceId) : undefined;
  const isLoadingSpace = !!loadingSpaceId && loadingSpaceId === currentSpaceId;
  const showChannelSkeleton = useDelayedLoading(isLoadingSpace);

  const federationInstances = useInstanceStore((s) => s.instances);
  const instanceLabel = useMemo(() => {
    const origin = space?._instanceOrigin;
    if (!origin) return null;
    const inst = federationInstances.find(i => i.origin === origin);
    if (inst) return inst.label;
    try { return new URL(origin).host; } catch { return origin; }
  }, [space, federationInstances]);
  const channelPermissions = useSpaceStore((s) => s.channelPermissions);
  const canManageChannels = hasPermissionBit(mySpacePerms, PermissionBits.MANAGE_CHANNELS);
  const canCreateInvite = hasPermissionBit(mySpacePerms, PermissionBits.CREATE_INVITE);
  const categories = useSpaceStore((s) => s.categories);

  // Delete category confirmation state
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [deleteCategoryLoading, setDeleteCategoryLoading] = useState(false);
  // Right-click menus of the DM rows and channel rows, with the dialogs they open.
  const conversationMenu = useConversationContextMenu();

  // Centralized context menu
  const openContextMenu = useContextMenuStore((s) => s.open);

  // Each space opens at the top of its column, where its banner and its first channels are.
  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [currentSpaceId]);

  // Home's rows that are seldom needed and reachable elsewhere (Explore is also the top bar's
  // compass, both are in Ctrl K) fold under "More", open or closed as this device last left it.
  // Arriving at one of them some other way opens the group, so the selected row is in sight.
  const homeMoreOpen = useUIStore((s) => s.homeNavMoreOpen);
  const setHomeMoreOpen = useUIStore((s) => s.setHomeNavMoreOpen);
  const homeMoreId = useId();
  useEffect(() => {
    if (isHomeNavMoreItem(activeHomeItem)) setHomeMoreOpen(true);
  }, [activeHomeItem, setHomeMoreOpen]);

  // What can be made in a space, in one menu: the column's Create row opens it, and the right-click
  // menu of the column starts with the same two, so the two can never drift apart.
  const createItems = useMemo<ContextMenuItem[]>(() => [
    {
      key: 'create-channel',
      type: 'action',
      label: t('spaces:channels.create'),
      icon: <Icon name="hash" size={16} />,
      onClick: () => openModal('createChannel'),
    },
    {
      key: 'create-category',
      type: 'action',
      label: t('spaces:channels.createCategory'),
      icon: <FolderGlyph />,
      onClick: () => openModal('createCategory'),
    },
  ], [openModal, t]);
  const createMenuOpen = useContextMenuStore((s) => s.menu?.items === createItems);
  const openCreateMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    openContextMenu({ x: box.left, y: box.bottom + 4 }, createItems);
  };

  // Collapse state — persisted in localStorage
  const collapseKey = `backspace:collapsed-categories:${currentSpaceId}`;
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(collapseKey);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const toggleCollapse = useCallback((categoryId: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      try { localStorage.setItem(collapseKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [collapseKey]);

  // Filter channels by VIEW_CHANNEL (defense-in-depth — server already filters,
  // but this catches transient races where channels and permissions are briefly out of sync)
  const visibleChannels = useMemo(() =>
    channels.filter(ch => hasPermissionBit(channelPermissions.get(ch.id), PermissionBits.VIEW_CHANNEL)),
    [channels, channelPermissions]);

  // Group channels by category
  const sortedCategories = useMemo(() =>
    [...categories].sort((a, b) => a.position - b.position), [categories]);
  const uncategorizedChannels = useMemo(() =>
    visibleChannels.filter(c => !c.categoryId).sort((a, b) => a.position - b.position), [visibleChannels]);
  const channelsByCategory = useMemo(() => {
    const map = new Map<string, typeof channels>();
    for (const ch of visibleChannels) {
      if (!ch.categoryId) continue;
      let arr = map.get(ch.categoryId);
      if (!arr) { arr = []; map.set(ch.categoryId, arr); }
      arr.push(ch);
    }
    for (const [key, arr] of map) {
      map.set(key, arr.sort((a, b) => a.position - b.position));
    }
    return map;
  }, [visibleChannels]);

  // Check if a collapsed category has unread channels
  const categoryHasUnread = useCallback((categoryId: string) => {
    const chs = channelsByCategory.get(categoryId) ?? [];
    return chs.some(ch => unreadChannels.has(ch.id));
  }, [channelsByCategory, unreadChannels]);

  // --- Centralized drag-and-drop ---

  // Flat ordered list matching visual sidebar order — used by useDragManager
  // to normalize 'before B' into 'after A' for a single drop indicator line
  const orderedItems = useMemo<LayoutItem[]>(() => {
    const items: LayoutItem[] = [];
    for (const ch of uncategorizedChannels) {
      items.push({ id: ch.id, type: 'channel' });
    }
    for (const cat of sortedCategories) {
      items.push({ id: cat.id, type: 'category' });
      const catChs = channelsByCategory.get(cat.id) ?? [];
      if (!collapsedCategories.has(cat.id)) {
        for (const ch of catChs) {
          items.push({ id: ch.id, type: 'channel' });
        }
      }
    }
    return items;
  }, [uncategorizedChannels, sortedCategories, channelsByCategory, collapsedCategories]);

  // MOVE_MEMBERS on the channel the user is leaving, and a user ranked below
  // the viewer (permissions.md, "Role hierarchy"); the server checks both.
  const canMoveMember = useCallback(
    (userId: string, channelId: string) => {
      if (!hasPermissionBit(channelPermissions.get(channelId), PermissionBits.MOVE_MEMBERS)) return false;
      const target = members.find((m) => m.userId === userId);
      return !space || !target || viewerCanActOn(space, members, target);
    },
    [channelPermissions, members, space],
  );

  const handleChannelDrop = useCallback((dragId: string, target: DropTarget) => {
    if (!currentSpaceId) return;

    const allChannelsCopy = channels.map(ch => ({
      id: ch.id,
      position: ch.position,
      categoryId: ch.categoryId,
    }));

    if (target.targetType === 'channel') {
      const targetCh = channels.find(c => c.id === target.targetId);
      if (targetCh) {
        const dragCh = allChannelsCopy.find(c => c.id === dragId);
        if (dragCh) dragCh.categoryId = targetCh.categoryId;
      }
    } else if (target.targetType === 'category') {
      const dragCh = allChannelsCopy.find(c => c.id === dragId);
      if (dragCh) dragCh.categoryId = target.targetId;
    }

    const grouped = new Map<string | null, typeof allChannelsCopy>();
    for (const ch of allChannelsCopy) {
      let arr = grouped.get(ch.categoryId);
      if (!arr) { arr = []; grouped.set(ch.categoryId, arr); }
      arr.push(ch);
    }

    for (const [, arr] of grouped) {
      arr.sort((a, b) => a.position - b.position);
      const dragIdx = arr.findIndex(c => c.id === dragId);
      if (dragIdx === -1) continue;
      const dragItem = arr[dragIdx]!;
      arr.splice(dragIdx, 1);

      if (target.targetType === 'channel') {
        const targetIdx = arr.findIndex(c => c.id === target.targetId);
        if (targetIdx !== -1) {
          const insertIdx = target.position === 'before' ? targetIdx : targetIdx + 1;
          arr.splice(insertIdx, 0, dragItem);
        } else {
          arr.push(dragItem);
        }
      } else {
        arr.unshift(dragItem);
      }
      arr.forEach((ch, i) => { ch.position = i; });
    }

    const channelUpdates = allChannelsCopy.map(ch => ({
      id: ch.id,
      position: ch.position,
      categoryId: ch.categoryId,
    }));
    const categoryUpdates = sortedCategories.map(c => ({
      id: c.id,
      position: c.position,
    }));

    useSpaceStore.getState().setChannels(
      channels.map(ch => {
        const update = channelUpdates.find(u => u.id === ch.id);
        if (update) return { ...ch, position: update.position, categoryId: update.categoryId };
        return ch;
      }).sort((a, b) => a.position - b.position)
    );
    useSpaceStore.getState().updateChannelLayout(currentSpaceId, { channels: channelUpdates, categories: categoryUpdates });
  }, [channels, sortedCategories, currentSpaceId]);

  const handleCategoryDrop = useCallback((dragId: string, target: DropTarget) => {
    if (!currentSpaceId) return;

    const catsCopy = sortedCategories.map(c => ({ id: c.id, position: c.position }));
    const dragIdx = catsCopy.findIndex(c => c.id === dragId);
    if (dragIdx === -1) return;

    const dragItem = catsCopy[dragIdx]!;
    catsCopy.splice(dragIdx, 1);
    const targetIdx = catsCopy.findIndex(c => c.id === target.targetId);
    if (targetIdx !== -1) {
      const insertIdx = target.position === 'before' ? targetIdx : targetIdx + 1;
      catsCopy.splice(insertIdx, 0, dragItem);
    } else {
      catsCopy.push(dragItem);
    }
    catsCopy.forEach((c, i) => { c.position = i; });

    const channelUpdates = channels.map(ch => ({
      id: ch.id,
      position: ch.position,
      categoryId: ch.categoryId,
    }));

    useSpaceStore.getState().setCategories(
      categories.map(cat => {
        const update = catsCopy.find(u => u.id === cat.id);
        if (update) return { ...cat, position: update.position };
        return cat;
      }).sort((a, b) => a.position - b.position)
    );
    useSpaceStore.getState().updateChannelLayout(currentSpaceId, { channels: channelUpdates, categories: catsCopy });
  }, [sortedCategories, categories, channels, currentSpaceId]);

  const handleVoiceUserDrop = useCallback((userId: string, fromChannelId: string, toChannelId: string) => {
    const voiceOrigin = getChannelOrigin(fromChannelId);
    wsSend({ type: 'voice_move', userId, targetChannelId: toChannelId }, voiceOrigin);
  }, []);

  const {
    activeDrag, dropTarget,
    channelHandlers, categoryHandlers,
    voiceUserHandlers, voiceChannelDropZone,
    containerHandlers,
  } = useDragManager({
    scrollContainerRef,
    canManage: canManageChannels,
    canMoveMember,
    orderedItems,
    onChannelDrop: handleChannelDrop,
    onCategoryDrop: handleCategoryDrop,
    onVoiceUserDrop: handleVoiceUserDrop,
  });

  const handleSidebarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [];
    if (canManageChannels) items.push(...createItems);
    if (canCreateInvite) {
      items.push({
        key: 'invite',
        type: 'action',
        label: t('common:actions.invitePeople'),
        icon: <Icon name="user-plus" size={16} />,
        onClick: () => openModal('invite'),
      });
    }
    if (currentSpaceId) {
      items.push({
        key: 'space-profile',
        type: 'action',
        label: t('spaces:members.menu.spaceProfile'),
        icon: <Icon name="user" size={16} />,
        onClick: () => openModal('spaceProfile', { spaceId: currentSpaceId }),
      });
    }
    items.push({
      key: 'settings',
      type: 'action',
      label: t('spaces:sidebar.space.settings'),
      icon: <Icon name="settings" size={16} />,
      onClick: () => openModal('spaceSettings'),
    });
    openContextMenu({ x: e.clientX, y: e.clientY }, items);
  }, [canManageChannels, canCreateInvite, createItems, currentSpaceId, openModal, openContextMenu, t]);

  const handleChannelClick = (channelId: string) => {
    setCurrentChannel(channelId);
    navigate(`/channels/${currentSpaceId || '@me'}/${channelId}`);
  };

  const handleHomeClick = () => {
    setCurrentChannel(null);
    navigate('/channels/@me');
  };

  const handleVoiceJoin = (channelId: string) => {
    // Don't re-join the same channel — prevents duplicate LiveKit connections.
    // A dropped session is the exception: the channel ID is kept so the user
    // can resume, so this click has to reach joinVoiceChannel to reconnect.
    if (currentVoiceChannelId === channelId
        && useVoiceStore.getState().voiceConnectionStatus !== 'disconnected') {
      navigate(`/channels/${currentSpaceId}/${channelId}`);
      return;
    }
    const connectFn = useVoiceStore.getState().connectFn;
    joinVoiceChannel(channelId, connectFn ?? undefined);
    navigate(`/channels/${currentSpaceId}/${channelId}`);
  };

  // The call you are in, at the foot of the column, in both the Home and the space view.
  const voicePanel = user && (currentVoiceChannelId || activeDmCall) ? (
    <div data-pip-obstacle="bottom" className="flex-shrink-0 border-t border-border-hard bg-surface-base/60">
      <VoiceControls />
    </div>
  ) : null;

  if (!space) {
    const isUnreadDm = (dmId: string) => unreadChannels.has(dmId) && currentChannelId !== dmId;
    const unreadDmCount = dmChannels.reduce((n, dm) => n + (isUnreadDm(dm.id) ? 1 : 0), 0);
    // The open conversation stays in the unread view while it is being read,
    // so opening one from the filtered list does not make it vanish.
    const shownDms = dmFilter === 'unread'
      ? dmChannels.filter((dm) => isUnreadDm(dm.id) || dm.id === currentChannelId)
      : dmChannels;
    const filterButton = (value: DmFilter, label: string, count: number) => (
      <button
        key={value}
        type="button"
        aria-pressed={dmFilter === value}
        onClick={() => setDmFilter(value)}
        className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-meta font-medium transition-colors active:bg-interactive-active ${
          dmFilter === value
            ? 'bg-interactive-selected text-txt-primary'
            : 'text-txt-tertiary hover:bg-interactive-hover hover:text-txt-secondary'
        }`}
      >
        {label}
        {count > 0 && <span className="font-mono text-label tabular text-txt-secondary">{count > 99 ? '99+' : count}</span>}
      </button>
    );

    return (
      <>
      <div className="lit relative w-[var(--sidebar-width)] flex flex-col flex-shrink-0 select-none border-r border-border-hard bg-surface-channel">
        <div className="panel-bar px-2.5 flex items-center">
          <DmSearchBar />
        </div>
        <div className="sliding-list flex-1 overflow-y-auto pt-2.5 pb-4 px-2 no-scrollbar">
          <SlidingMark variant="row" />
          <nav aria-label={t('home:nav.home')} className="space-y-px">
            <HomeNavRow active={activeHomeItem === 'home'} label={t('home:nav.home')} icon="home" onClick={handleHomeClick} />

            <HomeNavRow
              active={activeHomeItem === 'inbox'}
              label={t('home:nav.inbox')}
              icon="bell"
              count={inboxCount}
              countLabel={t('home:inbox.navLabel', { count: inboxCount })}
              onClick={() => navigate(HOME_ROUTES.inbox)}
            />

            <HomeNavRow
              active={activeHomeItem === 'friends'}
              label={t('common:labels.friends')}
              icon="users"
              count={pendingRequestCount}
              countLabel={t('home:nav.requestsLabel', { count: pendingRequestCount })}
              onClick={() => navigate(HOME_ROUTES.friends)}
            />

            <button
              type="button"
              onClick={() => setHomeMoreOpen(!homeMoreOpen)}
              aria-expanded={homeMoreOpen}
              aria-controls={homeMoreOpen ? homeMoreId : undefined}
              className="nav-item group w-full text-left"
            >
              <Icon name="more" size={16} className="flex-shrink-0 text-txt-tertiary group-hover:text-txt-secondary" />
              <span className="min-w-0 flex-1 truncate">{t('home:nav.more')}</span>
              <Icon
                name="chevron-down"
                size={12}
                strokeWidth={2.4}
                className={`flex-shrink-0 text-txt-tertiary transition-transform duration-150 ${homeMoreOpen ? '' : '-rotate-90'}`}
              />
            </button>

            {/* Rendered only when open: the sliding mark measures rows again when rows come and go. */}
            {homeMoreOpen && (
              <div id={homeMoreId} className="space-y-px">
                <HomeNavRow
                  active={activeHomeItem === 'explore'}
                  label={t('spaces:sidebar.dmList.explore')}
                  icon="compass"
                  onClick={() => navigate(HOME_ROUTES.explore)}
                />

                <HomeNavRow
                  active={activeHomeItem === 'about'}
                  label={t('home:nav.about')}
                  icon="info"
                  onClick={() => navigate(HOME_ROUTES.about)}
                />
              </div>
            )}
          </nav>

          <section aria-label={t('spaces:sidebar.directMessages')} className="mt-3 border-t border-border-hard pt-3">
            <div className="flex h-7 items-center justify-between gap-2 pl-2.5">
              <h2 className="label-mono min-w-0 truncate">{t('spaces:sidebar.directMessages')}</h2>
              <button
                type="button"
                onClick={() => openModal('newDm')}
                className="icon-btn flex-shrink-0"
                aria-label={t('spaces:sidebar.dmList.newDm')}
              >
                <Icon name="plus" size={15} strokeWidth={2} />
              </button>
            </div>

            {dmChannels.length > 0 && (
              <div role="group" aria-label={t('dm:list.filterLabel')} className="mb-1.5 mt-0.5 flex items-center gap-0.5 px-0.5">
                {filterButton('all', t('dm:list.filterAll'), 0)}
                {filterButton('unread', t('dm:list.filterUnread'), unreadDmCount)}
              </div>
            )}

            <div className="space-y-px">
              {shownDms.map((dm) => (
                <DmListItem
                  key={dm.id}
                  dm={dm}
                  isActive={currentChannelId === dm.id}
                  isUnread={isUnreadDm(dm.id)}
                  user={user!}
                  onSelect={handleChannelClick}
                  onClose={(id) => {
                    if (currentChannelId === id) {
                      navigate('/channels/@me');
                      setCurrentChannel(null);
                    }
                    useSpaceStore.getState().closeDm(id);
                  }}
                  onLeave={(id) => conversationMenu.askLeaveGroup(id)}
                  onContextMenu={(e, id) => conversationMenu.openDm(e, id)}
                />
              ))}
              {dmChannels.length === 0 && (
                <div className="empty-state px-2">
                  <span className="empty-state-icon" aria-hidden="true">
                    <Icon name="message" size={18} />
                  </span>
                  <p className="empty-state-title">{t('spaces:sidebar.dmList.empty')}</p>
                  <p className="empty-state-body">{t('dm:list.emptyBody')}</p>
                  <button type="button" onClick={() => openModal('newDm')} className="btn-outline btn-sm mt-2">
                    {t('home:actions.newMessage')}
                  </button>
                </div>
              )}
              {dmChannels.length > 0 && shownDms.length === 0 && (
                <p className="px-2.5 py-2 text-meta text-txt-tertiary">{t('dm:list.emptyUnread')}</p>
              )}
            </div>
          </section>
        </div>
        {voicePanel}
      </div>
      {conversationMenu.dialogs}
      </>
    );
  }

  return (
    <>
    <div className="lit relative w-[var(--sidebar-width)] flex flex-col flex-shrink-0 select-none border-r border-border-hard bg-surface-channel">
      {/* The column's bar. With a banner it lies over the picture, inside what scrolls (below). */}
      {!banner.src && (
        <div className="panel-bar flex items-center gap-1 px-2 group/header">
          <SpaceHeaderRow space={space} instanceLabel={instanceLabel} canCreateInvite={canCreateInvite} overBanner={false} />
        </div>
      )}

      {/* Channels — dynamic category layout */}
      <div ref={scrollContainerRef} className={`sliding-list flex-1 overflow-y-auto pb-4 px-2 no-scrollbar ${banner.src ? 'scroll-pt-[var(--topbar-height)]' : 'pt-2.5'}`} onDrop={containerHandlers.onDrop} onDragOver={containerHandlers.onDragOver} onContextMenu={handleSidebarContextMenu}>
        <SlidingMark variant="row" />
        {banner.src && (
          <SpaceBannerHeader
            key={space.id}
            src={banner.src}
            onError={banner.onError}
            scrollRef={scrollContainerRef}
            barClassName="lit -mx-2 flex items-center gap-1 px-2 group/header"
            bandClassName="-mx-2 mb-2.5"
          >
            {(over) => <SpaceHeaderRow space={space} instanceLabel={instanceLabel} canCreateInvite={canCreateInvite} overBanner={over} />}
          </SpaceBannerHeader>
        )}
        {showChannelSkeleton ? (
          <div role="status" aria-label={t('spaces:channels.loading')}>
            {/* The real rows' geometry, so nothing moves when the channels arrive. */}
            {[3, 4].map((rows, group) => (
              <div key={group} className="mb-4">
                <div className="mb-0.5 flex h-7 items-center pl-1.5">
                  <div className="skeleton skeleton-bar" style={{ height: 10, width: group === 0 ? '45%' : '55%', animationDelay: `${group * 0.3}s` }} />
                </div>
                <div className="space-y-px">
                  {Array.from({ length: rows }, (_, i) => {
                    const delay = `${(group * 3 + i) * 0.1}s`;
                    return (
                      <div key={i} className="flex h-8 items-center gap-2.5 px-2.5">
                        <div className="skeleton h-4 w-4 flex-shrink-0" style={{ animationDelay: delay }} />
                        <div className="skeleton skeleton-bar" style={{ width: `${50 + ((group + i) * 17) % 30}%`, animationDelay: delay }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (<>
        {currentSpaceId && <div className="mb-3"><SpaceEventsRow spaceId={currentSpaceId} /></div>}
        {/* Uncategorized channels */}
        {uncategorizedChannels.length > 0 && (
          <div className="mb-4">
            <div className="space-y-px">
              {uncategorizedChannels.map((channel) => (
                <ChannelItem
                  key={channel.id}
                  channel={channel}
                  isActive={currentChannelId === channel.id}
                  isUnread={unreadChannels.has(channel.id) && currentChannelId !== channel.id}
                  isDragging={activeDrag?.type === 'channel' && activeDrag.dragId === channel.id}
                  dropIndicator={dropTarget?.targetId === channel.id ? dropTarget.position : null}
                  onChannelClick={channel.type === 'voice' ? (() => {
                    const chPerms = channelPermissions.get(channel.id);
                    const canConnect = hasPermissionBit(chPerms, PermissionBits.CONNECT);
                    if (canConnect) handleVoiceJoin(channel.id);
                  }) : (() => handleChannelClick(channel.id))}
                  onSettingsClick={() => openModal('channelSettings', { channelId: channel.id })}
                  onChannelContextMenu={(e) => conversationMenu.openChannel(e, channel.id)}
                  channelDragHandlers={channelHandlers(channel.id)}
                  voiceUserHandlers={voiceUserHandlers}
                  voiceChannelDropZone={voiceChannelDropZone(channel.id)}
                  channelPermissions={channelPermissions}
                  handleVoiceJoin={handleVoiceJoin}
                />
              ))}
            </div>
          </div>
        )}

        {/* Categories with their channels */}
        {sortedCategories.map((category) => {
          const catChannels = channelsByCategory.get(category.id) ?? [];

          // Hide empty categories for users without MANAGE_CHANNELS permission
          if (!canManageChannels && catChannels.length === 0) return null;

          const isCollapsed = collapsedCategories.has(category.id);
          const hasUnread = isCollapsed && categoryHasUnread(category.id);

          const categoryHeader = (
                <div
                  className={`group mb-0.5 flex h-7 cursor-pointer items-center justify-between rounded-md pl-1.5 ${
                    activeDrag?.type === 'category' && activeDrag.dragId === category.id ? 'opacity-50' : ''
                  } ${dropTarget?.targetId === category.id && dropTarget.targetType === 'category' ? 'ring-1 ring-accent-primary/60' : ''}`}
                  {...categoryHandlers(category.id)}
                  onClick={() => toggleCollapse(category.id)}
                >
                  {/* A div and not a button: Firefox will not start a drag from a button, and the whole row drags. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      toggleCollapse(category.id);
                    }}
                    className="flex min-w-0 items-center gap-1 rounded-sm text-txt-tertiary transition-colors group-hover:text-txt-secondary"
                  >
                    <Icon name="chevron-down" size={12} strokeWidth={2.4} className={`flex-shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <span className="label-mono truncate !text-inherit">{category.name}</span>
                    {category.isPrivate && (
                      <Icon name="lock" size={11} strokeWidth={2.2} className="flex-shrink-0" />
                    )}
                    {hasUnread && (
                      <span aria-hidden="true" className="ml-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-txt-primary" />
                    )}
                  </div>
                  {canManageChannels && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openModal('createChannel', { categoryId: category.id });
                      }}
                      className="icon-btn h-6 w-6 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={t('spaces:channels.create')}
                    >
                      <Icon name="plus" size={14} strokeWidth={2.2} />
                    </button>
                  )}
                </div>
          );

          return (
            <div key={category.id} className="mb-4">
              {/* Category header */}
              {canManageChannels ? (
                <div onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openContextMenu({ x: e.clientX, y: e.clientY }, [
                    {
                      key: 'category-settings',
                      type: 'action',
                      label: t('spaces:channels.categorySettings'),
                      icon: <Icon name="settings" size={16} />,
                      onClick: () => openModal('categorySettings', { categoryId: category.id }),
                    },
                    {
                      key: 'delete-category',
                      type: 'action',
                      label: t('spaces:channels.deleteCategory'),
                      danger: true,
                      icon: <Icon name="trash" size={16} />,
                      onClick: () => setDeleteCategoryId(category.id),
                    },
                  ]);
                }}>
                  {categoryHeader}
                </div>
              ) : categoryHeader}

              {/* Category channels (hidden when collapsed, unless active) */}
              {!isCollapsed && (
                <div className="space-y-px">
                  {catChannels.map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      isActive={currentChannelId === channel.id}
                      isUnread={unreadChannels.has(channel.id) && currentChannelId !== channel.id}
                      isDragging={activeDrag?.type === 'channel' && activeDrag.dragId === channel.id}
                      dropIndicator={dropTarget?.targetId === channel.id ? dropTarget.position : null}
                      onChannelClick={channel.type === 'voice' ? (() => {
                        const chPerms = channelPermissions.get(channel.id);
                        const canConnect = hasPermissionBit(chPerms, PermissionBits.CONNECT);
                        if (canConnect) handleVoiceJoin(channel.id);
                      }) : (() => handleChannelClick(channel.id))}
                      onSettingsClick={() => openModal('channelSettings', { channelId: channel.id })}
                      onChannelContextMenu={(e) => conversationMenu.openChannel(e, channel.id)}
                      channelDragHandlers={channelHandlers(channel.id)}
                      voiceUserHandlers={voiceUserHandlers}
                      voiceChannelDropZone={voiceChannelDropZone(channel.id)}
                      channelPermissions={channelPermissions}
                      handleVoiceJoin={handleVoiceJoin}
                    />
                  ))}
                  {catChannels.length === 0 && (
                    <div className="px-2.5 py-1.5 text-meta text-txt-tertiary">{t('spaces:channels.emptyCategory')}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* One row for everything that can be made here: it opens the menu of the two. */}
        {canManageChannels && (
          <div className="mt-4 border-t border-border-hard pt-3">
            <button
              type="button"
              onClick={openCreateMenu}
              aria-haspopup="menu"
              aria-expanded={createMenuOpen}
              aria-label={t('spaces:channels.createMenuLabel')}
              className="nav-item h-7 w-full text-left text-meta text-txt-tertiary hover:text-txt-primary"
            >
              <Icon name="plus" size={14} className="flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('spaces:channels.createMenu')}</span>
              <Icon name="chevron-down" size={12} className="flex-shrink-0" />
            </button>
          </div>
        )}
        </>)}

      </div>

      {voicePanel}
    </div>
    <ConfirmDialog
      isOpen={deleteCategoryId !== null}
      onClose={() => setDeleteCategoryId(null)}
      onConfirm={async () => {
        if (!deleteCategoryId) return;
        setDeleteCategoryLoading(true);
        try {
          await useSpaceStore.getState().deleteCategory(deleteCategoryId);
          setDeleteCategoryId(null);
        } catch {
          // deleteCategory already shows a toast on error
        } finally {
          setDeleteCategoryLoading(false);
        }
      }}
      title={t('spaces:channels.deleteCategoryConfirm.title')}
      description={t('spaces:channels.deleteCategoryConfirm.description')}
      confirmLabel={t('common:actions.delete')}
      variant="danger"
      loading={deleteCategoryLoading}
    />
    {conversationMenu.dialogs}
    </>
  );
}

/* ─── Channel Item (unified text + voice) ──────────────────────────────────── */

function ChannelItem({
  channel,
  isActive,
  isUnread,
  isDragging,
  dropIndicator,
  onChannelClick,
  onSettingsClick,
  onChannelContextMenu,
  channelDragHandlers,
  voiceUserHandlers,
  voiceChannelDropZone,
  channelPermissions,
  handleVoiceJoin,
}: {
  channel: Channel;
  isActive: boolean;
  isUnread: boolean;
  isDragging: boolean;
  dropIndicator: 'before' | 'after' | null;
  onChannelClick: () => void;
  onSettingsClick: () => void;
  /** The channel's right-click menu (conversationMenu). */
  onChannelContextMenu: (e: React.MouseEvent) => void;
  channelDragHandlers: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  voiceUserHandlers: (userId: string, channelId: string) => {
    draggable: boolean;
    isBeingDragged: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
  };
  voiceChannelDropZone: {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    isDragOver: boolean;
    isValidTarget: boolean;
  };
  channelPermissions: ReadonlyMap<string, string>;
  handleVoiceJoin: (channelId: string) => void;
}) {
  const { t } = useTranslation(['home', 'spaces']);
  const chPerms = channelPermissions.get(channel.id);
  // Editing and deleting a channel check MANAGE_CHANNELS with its overrides,
  // so the settings gear reads this channel's permissions, not the space's.
  const canManage = hasPermissionBit(chPerms, PermissionBits.MANAGE_CHANNELS)
    || (channelTakesWebhooks(channel.type) && hasPermissionBit(chPerms, PermissionBits.MANAGE_WEBHOOKS));
  if (channel.type === 'voice') {
    const canConnect = hasPermissionBit(chPerms, PermissionBits.CONNECT);
    return (
      <div
        className={`relative ${isDragging ? 'opacity-50' : ''}`}
        {...channelDragHandlers}
        onContextMenu={onChannelContextMenu}
      >
        {dropIndicator === 'before' && <div className="absolute -top-[1px] left-2 right-2 z-10 h-[2px] rounded-sm bg-accent-primary" />}
        <VoiceChannel
          channelId={channel.id}
          channelName={channel.name}
          channelIcon={channel.icon}
          streamOverlay={channel.streamOverlay === true}
          onClick={() => canConnect && handleVoiceJoin(channel.id)}
          locked={!canConnect}
          canManage={canManage}
          onSettingsClick={onSettingsClick}
          voiceUserHandlers={voiceUserHandlers}
          dropZone={voiceChannelDropZone}
        />
        {dropIndicator === 'after' && <div className="absolute -bottom-[1px] left-2 right-2 z-10 h-[2px] rounded-sm bg-accent-primary" />}
      </div>
    );
  }

  // The gear takes the place of the marks at the row's end while the pointer is
  // on the row, as a DM row's close button does with its time. It floats, so a
  // row at rest gives its full width to the name and its marks end at its edge.
  const markClass = canManage ? 'group-hover:invisible' : '';

  return (
    <div
      className={`relative ${isDragging ? 'opacity-50' : ''}`}
      {...channelDragHandlers}
    >
      {dropIndicator === 'before' && <div className="absolute -top-[1px] left-2 right-2 z-10 h-[2px] rounded-sm bg-accent-primary" />}
      <button
        type="button"
        onClick={onChannelClick}
        onContextMenu={onChannelContextMenu}
        data-active={isActive ? 'true' : undefined}
        data-unread={isUnread && !isActive ? 'true' : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={`nav-item group relative w-full text-left ${canManage ? 'hover:pr-8' : ''}`}
      >
        <ChannelIcon
          type={channel.type}
          icon={channel.icon}
          size={16}
          className={`flex-shrink-0 transition-colors ${
            isActive ? 'text-txt-primary' : isUnread ? 'text-txt-secondary' : 'text-txt-tertiary group-hover:text-txt-secondary'
          }`}
        />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {isUnread && !isActive && (
          <>
            <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 rounded-full bg-txt-primary ${markClass}`} />
            <span className="sr-only">{t('unread.dot')}</span>
          </>
        )}
        <ChannelMutedIndicator channelId={channel.id} className={`text-txt-tertiary ${markClass}`} />
        {canManage && (
          <span
            aria-hidden="true"
            data-tooltip={t('spaces:channels.settings')}
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md text-txt-tertiary opacity-0 transition-opacity hover:bg-interactive-hover hover:text-txt-primary group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onSettingsClick();
            }}
          >
            <Icon name="settings" size={15} />
          </span>
        )}
      </button>
      <FollowedThreadRows channelId={channel.id} spaceId={channel.spaceId} />
      {dropIndicator === 'after' && <div className="absolute -bottom-[1px] left-2 right-2 z-10 h-[2px] rounded-sm bg-accent-primary" />}
    </div>
  );
}
