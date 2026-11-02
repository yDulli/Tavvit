import { useDmUnreadCount } from './DmUnreadBadge';
import { useSpaceUnreadCount } from './SpaceUnreadBadge';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { CountBadge } from '../ui/CountBadge';
import { Icon } from '../ui/Icon';
import { SlidingMark } from '../ui/SlidingMark';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSpaceStore } from '../../stores/spaceStore';
import type { TaggedSpace } from '../../stores/spaceStore';
import { resolveSpaceLayout, type ResolvedSpaceLayoutItem } from '../../utils/spaceLayout';
import { activeHomeNavItem } from '../../utils/homeNav';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useInstanceStore } from '../../stores/instanceStore';
import { useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { Tooltip } from '../ui/Tooltip';
import { useSpaceContextMenu } from './spaceMenu/useSpaceContextMenu';
import type { SpaceLayoutItem, SpaceFolder } from '@backspace/shared';

import { getSpaceGradient } from '../../utils/gradients';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { GatedPicture } from '../ui/ExternalMedia';

// ─── Resolved layout types ─────────────────────────────────────────────────


// ─── Folder color presets ─────────────────────────────────────────────────

const FOLDER_COLORS = [
  { name: 'mint', value: '#86efac', labelKey: 'common:colors.mint' },
  { name: 'peach', value: '#fbbf93', labelKey: 'common:colors.peach' },
  { name: 'lavender', value: '#c4b5fd', labelKey: 'common:colors.lavender' },
  { name: 'sky', value: '#7dd3fc', labelKey: 'common:colors.sky' },
  { name: 'amber', value: '#fcd34d', labelKey: 'common:colors.amber' },
  { name: 'rose', value: '#fda4af', labelKey: 'common:colors.rose' },
  { name: 'coral', value: '#fb7185', labelKey: 'common:colors.coral' },
] as const;

// ─── SidebarItem ─────────────────────────────────────────────────────────

interface SidebarItemProps {
  id: string;
  name: string;
  icon?: string | null;
  avatarColor?: string | null;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  type?: 'space' | 'dm' | 'action';
  actionType?: 'add' | 'join' | 'explore';
  hasUnread?: boolean;
  dimmed?: boolean;
  federationBadge?: boolean;
  federationDisconnected?: boolean;
  tooltipText?: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  dropIndicator?: 'before' | 'after' | 'merge' | null;
}

/**
 * The violet edge under the tab of the place (Home, a space, Explore) the
 * person is in. It sits on the bar's own hairline, where the tab meets the
 * page below it.
 */
function ActiveMark() {
  return <span aria-hidden="true" data-active-mark className="active-line pointer-events-none absolute inset-x-2 bottom-0 h-[2px]" />;
}

/** A small neutral marker for news in a space or in Home that has no count to show. */
function UnreadDot() {
  return <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-txt-primary" />;
}

/** A space's unread count, or the dot when it has news but no count. */
function SpaceTabUnread({ spaceId, hasUnread }: { spaceId: string; hasUnread: boolean }) {
  const { t } = useTranslation('spaces');
  const { total, muted } = useSpaceUnreadCount(spaceId);
  if (total > 0) {
    const label = total > 99 ? t('sidebar.space.unreadMessagesOver99') : t('sidebar.space.unreadMessages', { count: total });
    return <CountBadge count={total} muted={muted} label={label} />;
  }
  return hasUnread ? <UnreadDot /> : null;
}

/** Home's count of unread direct messages, or the dot. */
function HomeTabUnread({ hasUnread }: { hasUnread: boolean }) {
  const { t } = useTranslation('spaces');
  const total = useDmUnreadCount();
  if (total > 0) {
    const label = total > 99 ? t('sidebar.dmUnreadMessagesOver99') : t('sidebar.dmUnreadMessages', { count: total });
    return <CountBadge count={total} label={label} />;
  }
  return hasUnread ? <UnreadDot /> : null;
}

/** A space's picture in a tab: its icon, or its first letter on its colour. */
function SpaceGlyph({ id, name, icon, avatarColor, size = 20 }: { id: string; name: string; icon?: string | null; avatarColor?: string | null; size?: number }) {
  const tone = getSpaceGradient(id, name, avatarColor);
  const letter = (
    <span
      aria-hidden="true"
      className="flex flex-shrink-0 items-center justify-center rounded font-mono text-label font-semibold leading-none text-white"
      style={{ width: size, height: size, background: tone.gradient }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
  if (!icon) return letter;
  return (
    <GatedPicture
      src={icon.startsWith('http') || icon.startsWith('/') ? icon : `/api/uploads/${icon}`}
      alt=""
      className="flex-shrink-0 rounded object-cover"
      style={{ width: size, height: size }}
      whileBlocked={letter}
    />
  );
}

/**
 * A tab of the bar: 32px tall, a 5px corner, never a capsule. The one you are
 * in is a step lighter with the violet edge under it (ActiveMark); one with news
 * you have not seen is in the primary colour and a heavier weight.
 */
const TAB = 'relative flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-ui transition-colors duration-100 active:bg-interactive-active';
const TAB_ACTIVE = 'bg-interactive-selected font-medium text-txt-primary';
const TAB_UNREAD = 'font-semibold text-txt-primary hover:bg-interactive-hover';
const TAB_IDLE = 'font-medium text-txt-secondary hover:bg-interactive-hover hover:text-txt-primary';

function tabTone(active: boolean, unread: boolean): string {
  if (active) return TAB_ACTIVE;
  return unread ? TAB_UNREAD : TAB_IDLE;
}

function SidebarItem({ id, name, icon, avatarColor, active, onClick, onContextMenu, type = 'space', actionType, hasUnread, dimmed, federationBadge, federationDisconnected, tooltipText, draggable, onDragStart, onDragOver, onDragEnd, onDrop, isDragging, dropIndicator }: SidebarItemProps) {
  // The actions (create, join, explore) are quiet icon tiles; their name is the native tooltip.
  if (type === 'action') {
    return (
      <div className="relative flex h-full flex-shrink-0 items-center">
        <button
          type="button"
          onClick={onClick}
          title={name}
          aria-label={name}
          aria-current={active ? 'page' : undefined}
          data-active={active}
          className="icon-btn icon-btn-lg"
        >
          <Icon name={actionType === 'add' ? 'plus' : actionType === 'explore' ? 'compass' : 'login'} size={18} />
        </button>
        {active && <ActiveMark />}
      </div>
    );
  }

  const unread = !!hasUnread && !active;
  const tab = (
    <button
      type="button"
      onClick={onClick}
      title={type === 'dm' ? name : undefined}
      aria-current={active ? 'page' : undefined}
      className={`${TAB} ${tabTone(active, unread)} ${dimmed ? 'opacity-40 saturate-50' : ''} ${dropIndicator === 'merge' ? 'ring-1 ring-accent-primary' : ''}`}
    >
      {/* Home's glyph takes the tab's own colour, never the violet. */}
      {type === 'dm'
        ? <Icon name="home" size={16} className="flex-shrink-0" />
        : <SpaceGlyph id={id} name={name} icon={icon} avatarColor={avatarColor} />}
      <span className="max-w-[168px] truncate compact:max-w-[112px]">{name}</span>
      {federationBadge && (
        federationDisconnected
          ? <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-amber" />
          : <Icon name="globe" size={12} className="flex-shrink-0 text-txt-tertiary" />
      )}
      {type === 'space' && <SpaceTabUnread spaceId={id} hasUnread={unread} />}
      {type === 'dm' && <HomeTabUnread hasUnread={unread} />}
    </button>
  );

  return (
    <div
      className={`relative flex h-full flex-shrink-0 items-center ${isDragging ? 'opacity-50' : ''}`}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
    >
      {dropIndicator === 'before' && (
        <span className="absolute -left-[2px] top-2.5 bottom-2.5 z-10 w-[2px] rounded-[1px] bg-accent-primary" />
      )}
      {dropIndicator === 'after' && (
        <span className="absolute -right-[2px] top-2.5 bottom-2.5 z-10 w-[2px] rounded-[1px] bg-accent-primary" />
      )}
      {tooltipText && tooltipText !== name ? (
        <Tooltip content={tooltipText} position="bottom" delay={300}>
          {tab}
        </Tooltip>
      ) : (
        tab
      )}
      {active && <ActiveMark />}
    </div>
  );
}

// ─── Mini space icon for collapsed folder ──────────────────────────────────

function MiniSpaceIcon({ space }: { space: TaggedSpace }) {
  const icon = space.icon;
  const grad = getSpaceGradient(space.id, space.name, space.avatarColor);
  const colour = (
    <div
      className="w-full h-full rounded-[1px]"
      style={{ background: grad.gradient }}
    />
  );
  if (!icon) return colour;
  return (
    <GatedPicture
      src={icon.startsWith('http') || icon.startsWith('/') ? icon : `/api/uploads/${icon}`}
      alt=""
      className="w-full h-full object-cover rounded-[1px]"
      whileBlocked={colour}
    />
  );
}

// ─── Folder glyph (2×2 grid of its spaces) ───────────────────────────────

function FolderGlyph({ spaces, color }: { spaces: TaggedSpace[]; color: string | null }) {
  const display = spaces.slice(0, 4);
  return (
    <span
      aria-hidden="true"
      className="grid h-5 w-5 flex-shrink-0 grid-cols-2 gap-[2px] rounded p-[2px]"
      style={{ backgroundColor: color ? `${color}33` : 'rgb(255 255 255 / 0.06)' }}
    >
      {display.map((s) => (
        <span key={s.id} className="block h-full w-full overflow-hidden">
          <MiniSpaceIcon space={s} />
        </span>
      ))}
      {display.length < 4 && Array.from({ length: 4 - display.length }).map((_, i) => (
        <span key={`empty-${i}`} className="block h-full w-full rounded-[1px] bg-white/[0.06]" />
      ))}
    </span>
  );
}

// ─── FolderFlyout ─────────────────────────────────────────────────────────

function FolderFlyout({
  folder,
  spaces,
  anchorEl,
  currentSpaceId,
  unreadSpaceIds,
  disconnectedOrigins,
  renamingFolderId,
  onClose,
  onSpaceClick,
  onSpaceContextMenu,
  onRename,
  onDragStart,
  onReorder,
  onParentDragEnd,
}: {
  folder: SpaceFolder;
  spaces: TaggedSpace[];
  anchorEl: HTMLDivElement;
  currentSpaceId: string | null;
  unreadSpaceIds: Set<string>;
  disconnectedOrigins: Set<string>;
  renamingFolderId: string | null;
  onClose: () => void;
  onSpaceClick: (spaceId: string) => void;
  onSpaceContextMenu: (spaceId: string, e: React.MouseEvent) => void;
  onRename: (name: string) => void;
  onDragStart: (e: React.DragEvent, spaceId: string) => void;
  onReorder: (reorderedSpaceIds: string[]) => void;
  onParentDragEnd: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(anchorEl);
  anchorRef.current = anchorEl;
  const floatingRef = useRef<HTMLDivElement>(null);

  const { style } = useFloatingPosition(anchorRef, floatingRef, {
    placement: 'bottom',
    offset: 6,
  });

  // Intra-folder DnD state
  const [flyoutDrop, setFlyoutDrop] = useState<{
    targetSpaceId: string;
    position: 'before' | 'after';
  } | null>(null);
  const flyoutDropRef = useRef(flyoutDrop);
  flyoutDropRef.current = flyoutDrop;

  const handleFlyoutDragOver = useCallback((e: React.DragEvent, targetSpaceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const position: 'before' | 'after' = relY < rect.height * 0.5 ? 'before' : 'after';

    // Normalize 'before' to previous item's 'after' so a single indicator renders
    if (position === 'before') {
      const idx = spaces.findIndex(s => s.id === targetSpaceId);
      if (idx > 0) {
        const prevId = spaces[idx - 1]!.id;
        setFlyoutDrop({ targetSpaceId: prevId, position: 'after' });
        return;
      }
    }

    setFlyoutDrop({ targetSpaceId, position });
  }, [spaces]);

  const handleFlyoutDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const indicator = flyoutDropRef.current;
    const dragId = e.dataTransfer.getData('text/plain');
    if (!indicator || !dragId) {
      setFlyoutDrop(null);
      onParentDragEnd();
      return;
    }

    // Don't reorder if dropping on self in same position
    const currentIds = spaces.map(s => s.id);
    const dragIdx = currentIds.indexOf(dragId);
    if (dragIdx === -1) {
      // Dragged space is not in this folder — let parent handle it
      setFlyoutDrop(null);
      onParentDragEnd();
      return;
    }

    // Remove dragged space and re-insert at target position
    const without = currentIds.filter(id => id !== dragId);
    const targetIdx = without.indexOf(indicator.targetSpaceId);
    if (targetIdx === -1) {
      setFlyoutDrop(null);
      onParentDragEnd();
      return;
    }

    const insertIdx = indicator.position === 'before' ? targetIdx : targetIdx + 1;
    without.splice(insertIdx, 0, dragId);

    onReorder(without);
    setFlyoutDrop(null);
    onParentDragEnd();
  }, [spaces, onReorder, onParentDragEnd]);

  const handleFlyoutDragEnd = useCallback(() => {
    setFlyoutDrop(null);
    onParentDragEnd();
  }, [onParentDragEnd]);

  // Close on click-outside and Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        floatingRef.current && !floatingRef.current.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest?.('[data-flyout-safe]')
      ) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, anchorEl]);

  const isRenaming = renamingFolderId === folder.id;

  return ReactDOM.createPortal(
    <div
      ref={floatingRef}
      className="w-[240px] max-h-[360px] overflow-y-auto scrollbar-thin glass rounded-lg py-1 animate-slide-up"
      style={style}
    >
      {/* Folder header */}
      {(folder.name || isRenaming) && (
        <div className="px-3.5 pb-1 pt-1.5">
          {isRenaming ? (
            <input
              autoFocus
              className="input-search w-full px-1.5 py-0.5 label-mono"
              defaultValue={folder.name || ''}
              onBlur={(e) => onRename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRename(e.currentTarget.value);
                if (e.key === 'Escape') onClose();
              }}
            />
          ) : (
            <span className="label-mono">
              {folder.name}
            </span>
          )}
        </div>
      )}

      {/* Space rows */}
      {spaces.map((space, idx) => {
        const isActive = currentSpaceId === space.id;
        const hasUnread = unreadSpaceIds.has(space.id) && !isActive;
        const origin = space._instanceOrigin;
        const isFederated = !!origin;
        const isDimmed = isFederated && disconnectedOrigins.has(origin);
        const icon = space.icon;

        return (
          <React.Fragment key={space.id}>
            {/* Drop indicator: before first item */}
            {idx === 0 && flyoutDrop?.targetSpaceId === space.id && flyoutDrop.position === 'before' && (
              <div className="mx-2.5 my-0.5 h-0.5 rounded-[1px] bg-accent-primary" />
            )}

            <button
              type="button"
              aria-current={isActive ? 'page' : undefined}
              data-unread={hasUnread}
              className={`nav-item mx-1 ${isDimmed ? 'opacity-40 saturate-50' : ''}`}
              style={{ width: 'calc(100% - 8px)' }}
              draggable
              onDragStart={(e) => onDragStart(e, space.id)}
              onDragOver={(e) => handleFlyoutDragOver(e, space.id)}
              onDrop={handleFlyoutDrop}
              onDragEnd={handleFlyoutDragEnd}
              onClick={() => {
                onSpaceClick(space.id);
                onClose();
              }}
              onContextMenu={(e) => {
                onSpaceContextMenu(space.id, e);
              }}
            >
              {/* Space icon */}
              <SpaceGlyph id={space.id} name={space.name} icon={icon} avatarColor={space.avatarColor} />

              {/* Name */}
              <span className="min-w-0 flex-1 truncate text-left">{space.name}</span>

              {/* Federation badge */}
              {isFederated && !isDimmed && <Icon name="globe" size={12} className="text-txt-tertiary flex-shrink-0" />}

              <SpaceTabUnread spaceId={space.id} hasUnread={hasUnread} />
            </button>

            {/* Drop indicator: after item */}
            {flyoutDrop?.targetSpaceId === space.id && flyoutDrop.position === 'after' && (
              <div className="mx-2.5 my-0.5 h-0.5 rounded-[1px] bg-accent-primary" />
            )}
          </React.Fragment>
        );
      })}
    </div>,
    document.body,
  );
}

// ─── FolderSlot (single icon slot for a folder) ──────────────────────────

function FolderSlot({
  folder,
  folderSpaces,
  isActive,
  hasUnread,
  isFlyoutOpen,
  isDragging,
  dropIndicator,
  onToggleFlyout,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  anchorRef,
}: {
  folder: SpaceFolder;
  folderSpaces: TaggedSpace[];
  isActive: boolean;
  hasUnread: boolean;
  isFlyoutOpen: boolean;
  isDragging: boolean;
  dropIndicator: 'before' | 'after' | 'merge' | null;
  onToggleFlyout: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  anchorRef: (el: HTMLDivElement | null) => void;
}) {
  const { t } = useTranslation(['spaces', 'common', 'home']);
  const label = folder.name || t('spaces:sidebar.folder.tooltip', { count: folderSpaces.length });

  return (
    <div
      ref={anchorRef}
      className={`relative flex h-full flex-shrink-0 items-center ${isDragging ? 'opacity-50' : ''}`}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
    >
      {dropIndicator === 'before' && (
        <span className="absolute -left-[2px] top-2.5 bottom-2.5 z-10 w-[2px] rounded-[1px] bg-accent-primary" />
      )}
      {dropIndicator === 'after' && (
        <span className="absolute -right-[2px] top-2.5 bottom-2.5 z-10 w-[2px] rounded-[1px] bg-accent-primary" />
      )}
      <button
        type="button"
        onClick={onToggleFlyout}
        aria-expanded={isFlyoutOpen}
        className={`${TAB} ${tabTone(isActive || isFlyoutOpen, hasUnread)} ${dropIndicator === 'merge' ? 'ring-1 ring-accent-primary' : ''}`}
      >
        <FolderGlyph spaces={folderSpaces} color={folder.color} />
        <span className="max-w-[140px] truncate compact:max-w-[96px]">{label}</span>
        {hasUnread && !isActive && <UnreadDot />}
        <Icon name="chevron-down" size={13} className={`flex-shrink-0 text-txt-tertiary transition-transform ${isFlyoutOpen ? 'rotate-180' : ''}`} />
      </button>
      {isActive && <ActiveMark />}
    </div>
  );
}

// ─── SpaceSidebar (main component) ────────────────────────────────────────

export function SpaceSidebar() {
  const { t } = useTranslation(['spaces', 'common', 'home']);
  const spaces = useSpaceStore((s) => s.spaces);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const setCurrentSpace = useSpaceStore((s) => s.setCurrentSpace);
  const channelToSpaceMap = useSpaceStore((s) => s.channelToSpaceMap);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const folders = useSpaceStore((s) => s.folders);
  const spaceLayout = useSpaceStore((s) => s.spaceLayout);
  const updateSpaceLayout = useSpaceStore((s) => s.updateSpaceLayout);
  const showDms = useUIStore((s) => s.showDms);
  const setShowDms = useUIStore((s) => s.setShowDms);
  const openModal = useUIStore((s) => s.openModal);
  const addToast = useUIStore((s) => s.addToast);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const setCurrentChannel = useChatStore((s) => s.setCurrentChannel);
  const unreadChannels = useChatStore((s) => s.unreadChannels);
  const instances = useInstanceStore((s) => s.instances);
  const navigate = useNavigate();
  const location = useLocation();

  // Flyout state
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const folderAnchorRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // The folder whose name is being edited in place
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  // DnD state
  const [dragState, setDragState] = useState<{ dragId: string; dragType: 'space' | 'folder'; sourceFolderId?: string } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: 'before' | 'after' | 'merge' } | null>(null);
  const dropIndicatorRef = useRef(dropIndicator);

  const openContextMenu = useContextMenuStore((s) => s.open);

  const spaceMenu = useSpaceContextMenu();
  const handleSpaceContextMenu = useCallback((spaceId: string, e: React.MouseEvent) => {
    spaceMenu.open(spaceId, e);
  }, [spaceMenu]);

  // Set of disconnected origins
  const disconnectedOrigins = useMemo(() => {
    const set = new Set<string>();
    for (const inst of instances) {
      if (inst.status === 'disconnected' || inst.status === 'error') {
        set.add(inst.origin);
      }
    }
    return set;
  }, [instances]);

  // Build space lookup map
  const spaceMap = useMemo(() => {
    const map = new Map<string, TaggedSpace>();
    for (const s of spaces) map.set(s.id, s);
    return map;
  }, [spaces]);

  // Reconciled layout: merge spaceLayout with actual spaces and folders
  const resolvedLayout = useMemo(
    () => resolveSpaceLayout(spaces, spaceLayout, folders),
    [spaces, spaceLayout, folders],
  );

  // Compute which spaces have unread channels
  const unreadSpaceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const channelId of unreadChannels) {
      const spaceId = channelToSpaceMap.get(channelId);
      if (spaceId) ids.add(spaceId);
    }
    return ids;
  }, [unreadChannels, channelToSpaceMap]);

  // Check if any DM channels are unread
  const hasDmUnread = useMemo(() => {
    for (const dm of dmChannels) {
      if (unreadChannels.has(dm.id)) return true;
    }
    return false;
  }, [unreadChannels, dmChannels]);

  const handleSpaceClick = useCallback((spaceId: string) => {
    const space = spaceMap.get(spaceId);
    const origin = space?._instanceOrigin;
    if (origin && disconnectedOrigins.has(origin)) {
      const inst = instances.find(i => i.origin === origin);
      addToast(t('spaces:sidebar.space.reconnecting', { instance: inst?.label || t('spaces:sidebar.space.remoteInstance') }), 'warning', 4000);
      return;
    }
    setCurrentSpace(spaceId);
    setShowDms(false);
    navigate(`/channels/${spaceId}`);
  }, [spaceMap, disconnectedOrigins, instances, addToast, setCurrentSpace, setShowDms, navigate, t]);

  const handleDmClick = () => {
    setShowDms(true);
    setCurrentSpace(null);
    setCurrentChannel(null);
    navigate('/channels/@me');
  };

  const handleExploreClick = () => {
    setCurrentSpace(null);
    setCurrentChannel(null);
    navigate('/explore');
  };

  // ─── DnD handlers ──────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, id: string, type: 'space' | 'folder', sourceFolderId?: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDragState({ dragId: id, dragType: type, sourceFolderId });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string, targetType: 'space' | 'folder') => {
    if (!dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const width = rect.width;

    let position: 'before' | 'after' | 'merge';
    if (targetType === 'folder' || dragState.dragType === 'space') {
      // Tabs: left 25% = before, middle 50% = merge, right 25% = after
      if (relX < width * 0.25) {
        position = 'before';
      } else if (relX > width * 0.75) {
        position = 'after';
      } else {
        // Merge zone: only if dragging a space onto another space or folder
        if (dragState.dragType === 'space' && dragState.dragId !== targetId) {
          position = 'merge';
        } else {
          position = relX < width * 0.5 ? 'before' : 'after';
        }
      }
    } else {
      // Folder dragging: only before/after, no merge
      position = relX < width * 0.5 ? 'before' : 'after';
    }

    // Normalize 'before' to previous item's 'after' so the drop indicator
    // always renders from a single DOM element, eliminating sub-pixel jump
    if (position === 'before') {
      const targetIdx = resolvedLayout.findIndex(item =>
        (item.type === 'space' && item.space.id === targetId) ||
        (item.type === 'folder' && item.folder.id === targetId)
      );
      if (targetIdx > 0) {
        const prevItem = resolvedLayout[targetIdx - 1]!;
        const prevId = prevItem.type === 'space' ? prevItem.space.id : prevItem.folder.id;
        dropIndicatorRef.current = { targetId: prevId, position: 'after' };
        setDropIndicator({ targetId: prevId, position: 'after' });
        return;
      }
    }

    dropIndicatorRef.current = { targetId, position };
    setDropIndicator({ targetId, position });
  }, [dragState, resolvedLayout]);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    dropIndicatorRef.current = null;
    setDropIndicator(null);
  }, []);

  // Build layout items and folder payload from resolvedLayout for persistence
  const buildLayoutPayload = useCallback((resolved: ResolvedSpaceLayoutItem[]) => {
    const items: SpaceLayoutItem[] = [];
    const folderPayload: Record<string, { name: string | null; color: string | null; spaceIds: string[] }> = {};

    for (const item of resolved) {
      if (item.type === 'space') {
        items.push({ t: 's', id: item.space.id });
      } else {
        items.push({ t: 'f', id: item.folder.id });
        folderPayload[item.folder.id] = {
          name: item.folder.name,
          color: item.folder.color,
          spaceIds: item.spaces.map(s => s.id),
        };
      }
    }

    return { items, folderPayload };
  }, []);

  const persistLayout = useCallback((resolved: ResolvedSpaceLayoutItem[]) => {
    const { items, folderPayload } = buildLayoutPayload(resolved);
    updateSpaceLayout(items, folderPayload);
  }, [buildLayoutPayload, updateSpaceLayout]);

  const handleReorderInFolder = useCallback((folderId: string, reorderedSpaceIds: string[]) => {
    const newLayout = resolvedLayout.map(item => {
      if (item.type === 'folder' && item.folder.id === folderId) {
        const reorderedSpaces = reorderedSpaceIds
          .map(id => item.spaces.find(s => s.id === id))
          .filter((s): s is TaggedSpace => !!s);
        return {
          ...item,
          spaces: reorderedSpaces,
          folder: { ...item.folder, spaceIds: reorderedSpaceIds },
        };
      }
      return item;
    }) as ResolvedSpaceLayoutItem[];
    persistLayout(newLayout);
  }, [resolvedLayout, persistLayout]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const indicator = dropIndicatorRef.current;
    if (!dragState || !indicator) {
      handleDragEnd();
      return;
    }

    const { dragId, dragType, sourceFolderId } = dragState;
    const { targetId, position } = indicator;

    // Don't drop on self
    if (dragId === targetId && position !== 'merge') {
      handleDragEnd();
      return;
    }

    // Work with a mutable copy of the resolved layout
    let newLayout = resolvedLayout.map(item => {
      if (item.type === 'folder') {
        return { ...item, spaces: [...item.spaces], folder: { ...item.folder } };
      }
      return { ...item };
    }) as ResolvedSpaceLayoutItem[];

    if (dragType === 'space') {
      const dragSpace = spaceMap.get(dragId);
      if (!dragSpace) { handleDragEnd(); return; }

      // Remove from source
      if (sourceFolderId) {
        // Remove from folder
        const folderItem = newLayout.find(i => i.type === 'folder' && i.folder.id === sourceFolderId) as (ResolvedSpaceLayoutItem & { type: 'folder' }) | undefined;
        if (folderItem) {
          folderItem.spaces = folderItem.spaces.filter(s => s.id !== dragId);
          folderItem.folder = { ...folderItem.folder, spaceIds: folderItem.spaces.map(s => s.id) };
        }
      } else {
        // Remove standalone
        newLayout = newLayout.filter(item => !(item.type === 'space' && item.space.id === dragId));
      }

      if (position === 'merge') {
        // Find the target
        const targetIdx = newLayout.findIndex(item =>
          (item.type === 'space' && item.space.id === targetId) ||
          (item.type === 'folder' && item.folder.id === targetId)
        );
        if (targetIdx === -1) { handleDragEnd(); return; }

        const targetItem = newLayout[targetIdx];
        if (!targetItem) { handleDragEnd(); return; }

        if (targetItem.type === 'space') {
          // Create new folder with both spaces
          const tempId = `new:${Date.now()}`;
          const newFolder: ResolvedSpaceLayoutItem = {
            type: 'folder',
            folder: {
              id: tempId,
              userId: '',
              name: null,
              color: null,
              position: 0,
              spaceIds: [targetItem.space.id, dragSpace.id],
            },
            spaces: [targetItem.space, dragSpace],
          };
          newLayout[targetIdx] = newFolder;
        } else if (targetItem.type === 'folder') {
          // Add to existing folder
          targetItem.spaces.push(dragSpace);
          targetItem.folder = { ...targetItem.folder, spaceIds: targetItem.spaces.map(s => s.id) };
        }
      } else {
        // Reorder: insert before or after target
        const targetIdx = newLayout.findIndex(item =>
          (item.type === 'space' && item.space.id === targetId) ||
          (item.type === 'folder' && item.folder.id === targetId)
        );
        if (targetIdx === -1) { handleDragEnd(); return; }

        const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
        const newItem: ResolvedSpaceLayoutItem = { type: 'space', space: dragSpace };
        newLayout.splice(insertIdx, 0, newItem);
      }

      // Dissolve folders with < 2 members
      newLayout = newLayout.flatMap(item => {
        if (item.type === 'folder' && item.spaces.length < 2) {
          if (item.spaces.length === 1 && item.spaces[0]) {
            return [{ type: 'space' as const, space: item.spaces[0] }];
          }
          return []; // 0 members, remove entirely
        }
        return [item];
      });

    } else if (dragType === 'folder') {
      // Remove the folder from its current position
      const dragIdx = newLayout.findIndex(i => i.type === 'folder' && i.folder.id === dragId);
      if (dragIdx === -1) { handleDragEnd(); return; }
      const dragItem = newLayout.splice(dragIdx, 1)[0];
      if (!dragItem) { handleDragEnd(); return; }

      // Insert at target position
      const targetIdx = newLayout.findIndex(item =>
        (item.type === 'space' && item.space.id === targetId) ||
        (item.type === 'folder' && item.folder.id === targetId)
      );
      if (targetIdx === -1) {
        newLayout.push(dragItem);
      } else {
        const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
        newLayout.splice(insertIdx, 0, dragItem);
      }
    }

    persistLayout(newLayout);
    handleDragEnd();
  }, [dragState, resolvedLayout, spaceMap, handleDragEnd, persistLayout]);

  // ─── Folder actions ──────────────────────────────────────────────────

  const handleFolderRename = useCallback((folderId: string, name: string) => {
    const newLayout = resolvedLayout.map(item => {
      if (item.type === 'folder' && item.folder.id === folderId) {
        return { ...item, folder: { ...item.folder, name: name.trim() || null } };
      }
      return item;
    });
    persistLayout(newLayout);
    setRenamingFolderId(null);
  }, [resolvedLayout, persistLayout]);

  const handleFolderColorChange = useCallback((folderId: string, color: string | null) => {
    const newLayout = resolvedLayout.map(item => {
      if (item.type === 'folder' && item.folder.id === folderId) {
        return { ...item, folder: { ...item.folder, color } };
      }
      return item;
    });
    persistLayout(newLayout);
  }, [resolvedLayout, persistLayout]);

  const handleUngroup = useCallback((folderId: string) => {
    setOpenFolderId(null);
    const newLayout = resolvedLayout.flatMap(item => {
      if (item.type === 'folder' && item.folder.id === folderId) {
        return item.spaces.map(s => ({ type: 'space' as const, space: s }));
      }
      return [item];
    });
    persistLayout(newLayout);
  }, [resolvedLayout, persistLayout]);

  // ─── Helpers for rendering ──────────────────────────────────────────

  const getFederationInfo = useCallback((space: TaggedSpace) => {
    const origin = space._instanceOrigin;
    const isFederated = !!origin;
    const isDimmed = isFederated && disconnectedOrigins.has(origin);
    let tooltipText = space.name;
    if (isFederated) {
      try {
        const hostLabel = new URL(origin).host;
        tooltipText = `${space.name} \u00b7 ${hostLabel}`;
      } catch { /* ignore */ }
    }
    return { isFederated, isDimmed, tooltipText };
  }, [disconnectedOrigins]);

  // Check if a folder has any unread spaces
  const folderHasUnread = useCallback((folderSpaces: TaggedSpace[]) => {
    return folderSpaces.some(s => unreadSpaceIds.has(s.id));
  }, [unreadSpaceIds]);

  // Check if folder has any active space
  const folderHasActive = useCallback((folderSpaces: TaggedSpace[]) => {
    return currentSpaceId ? folderSpaces.some(s => s.id === currentSpaceId) : false;
  }, [currentSpaceId]);

  // Auto-close flyout when its folder dissolves
  useEffect(() => {
    if (openFolderId && !resolvedLayout.some(i => i.type === 'folder' && i.folder.id === openFolderId)) {
      setOpenFolderId(null);
    }
  }, [openFolderId, resolvedLayout]);

  // The tab of the place you are in is never left outside the strip, however
  // you got there (a link, the quick switcher, the folder flyout).
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector('[data-active-mark]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [currentSpaceId, showDms, resolvedLayout]);

  // The strip has no scrollbar, so a mouse wheel moves it sideways. A trackpad's
  // sideways swipe and Shift + wheel already do.
  const handleStripWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaX !== 0 || event.shiftKey) return;
    // Firefox reports a mouse wheel in lines, the others in pixels.
    event.currentTarget.scrollLeft += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
  };

  // Once scrolled, the strip's start fades out too (globals.css, `.tab-strip`).
  const [stripScrolled, setStripScrolled] = useState(false);

  return (
    <nav className="flex h-full min-w-0 flex-1 items-center select-none" onDragOver={(e) => { if (dragState) e.preventDefault(); }} onDrop={handleDrop}>
      {/* Home and the spaces scroll sideways when they outgrow the bar; the
          actions after them stay put, so they are never the ones cut off. */}
      <div
        ref={stripRef}
        onWheel={handleStripWheel}
        onScroll={(event) => setStripScrolled(event.currentTarget.scrollLeft > 0)}
        data-scrolled={stripScrolled}
        className="tab-strip sliding-list flex h-full min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden no-scrollbar scroll-px-4 pl-1"
      >
      <SlidingMark variant="line" selector="[data-active-mark]" />
      <SidebarItem
        id="@me"
        name={t('home:nav.home')}
        // Friends and About are reached from the home sidebar, so the tile stays
        // lit there; `showDms` alone is only set on the `@me` route. Explore is
        // not on this list: it has its own tile below.
        active={showDms || ['friends', 'about'].includes(activeHomeNavItem(location.pathname, currentChannelId) ?? '')}
        onClick={handleDmClick}
        type="dm"
        hasUnread={hasDmUnread}
      />

      <span aria-hidden="true" className="mx-1 h-5 w-px flex-shrink-0 bg-border-hard" />

      {/* Unified space list (ordered by user layout) */}
      {resolvedLayout.map((item) => {
        if (item.type === 'space') {
          const { isFederated, isDimmed, tooltipText } = getFederationInfo(item.space);
          return (
            <SidebarItem
              key={item.space.id}
              id={item.space.id}
              name={item.space.name}
              icon={item.space.icon}
              avatarColor={item.space.avatarColor}
              active={currentSpaceId === item.space.id}
              onClick={() => handleSpaceClick(item.space.id)}
              onContextMenu={(e) => handleSpaceContextMenu(item.space.id, e)}
              hasUnread={unreadSpaceIds.has(item.space.id)}
              dimmed={isDimmed}
              federationBadge={isFederated}
              federationDisconnected={isDimmed}
              tooltipText={tooltipText}
              draggable
              onDragStart={(e) => handleDragStart(e, item.space.id, 'space')}
              onDragOver={(e) => handleDragOver(e, item.space.id, 'space')}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              isDragging={dragState?.dragType === 'space' && dragState.dragId === item.space.id}
              dropIndicator={dropIndicator?.targetId === item.space.id ? dropIndicator.position : null}
            />
          );
        }

        // Folder — always a single icon slot
        const { folder, spaces: folderSpaces } = item;
        const isActive = folderHasActive(folderSpaces);
        const hasUnread = folderHasUnread(folderSpaces);
        const isFlyoutOpen = openFolderId === folder.id;

        return (
          <FolderSlot
            key={`folder-${folder.id}`}
            folder={folder}
            folderSpaces={folderSpaces}
            isActive={isActive}
            hasUnread={hasUnread}
            isFlyoutOpen={isFlyoutOpen}
            isDragging={dragState?.dragType === 'folder' && dragState.dragId === folder.id}
            dropIndicator={dropIndicator?.targetId === folder.id ? dropIndicator.position : null}
            onToggleFlyout={() => setOpenFolderId(isFlyoutOpen ? null : folder.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              const folderRef = folder;
              const items: ContextMenuItem[] = [
                {
                  key: 'rename',
                  type: 'action',
                  label: t('spaces:sidebar.folder.rename'),
                  icon: <Icon name="edit" size={16} />,
                  onClick: () => {
                    setRenamingFolderId(folderRef.id);
                    setOpenFolderId(folderRef.id);
                  },
                },
                {
                  key: 'color',
                  type: 'custom',
                  render: () => (
                    <div className="px-3 py-1.5">
                      <p className="label-mono mb-1.5">{t('spaces:sidebar.folder.color')}</p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          aria-pressed={!folderRef.color}
                          aria-label={t('common:states.default')}
                          className={`h-5 w-5 rounded border-2 bg-white/10 ${!folderRef.color ? 'border-txt-primary' : 'border-transparent hover:border-white/30'}`}
                          onClick={() => { handleFolderColorChange(folderRef.id, null); useContextMenuStore.getState().close(); }}
                          title={t('common:states.default')}
                        />
                        {FOLDER_COLORS.map((c) => (
                          <button
                            key={c.name}
                            type="button"
                            aria-pressed={folderRef.color === c.value}
                            aria-label={t(c.labelKey)}
                            className={`h-5 w-5 rounded border-2 ${folderRef.color === c.value ? 'border-txt-primary' : 'border-transparent hover:border-white/30'}`}
                            style={{ background: c.value }}
                            onClick={() => { handleFolderColorChange(folderRef.id, c.value); useContextMenuStore.getState().close(); }}
                            title={t(c.labelKey)}
                          />
                        ))}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'sep',
                  type: 'separator',
                },
                {
                  key: 'ungroup',
                  type: 'action',
                  label: t('spaces:sidebar.folder.ungroup'),
                  danger: true,
                  icon: <Icon name="grid" size={16} />,
                  onClick: () => handleUngroup(folderRef.id),
                },
              ];
              openContextMenu({ x: e.clientX, y: e.clientY }, items);
            }}
            onDragStart={(e) => handleDragStart(e, folder.id, 'folder')}
            onDragOver={(e) => handleDragOver(e, folder.id, 'folder')}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            anchorRef={(el) => {
              if (el) folderAnchorRefs.current.set(folder.id, el);
              else folderAnchorRefs.current.delete(folder.id);
            }}
          />
        );
      })}
      </div>

      <div className="flex h-full flex-shrink-0 items-center gap-0.5 pr-1">
      <span aria-hidden="true" className="mx-1 h-5 w-px flex-shrink-0 bg-border-hard" />

      <SidebarItem
        id="add-space"
        name={t('spaces:sidebar.addSpace')}
        active={false}
        onClick={() => openModal('createSpace')}
        type="action"
        actionType="add"
      />

      <SidebarItem
        id="join-space"
        name={t('spaces:sidebar.joinSpace')}
        active={false}
        onClick={() => openModal('joinSpace')}
        type="action"
        actionType="join"
      />

      <SidebarItem
        id="explore"
        name={t('spaces:sidebar.exploreSpaces')}
        active={location.pathname === '/explore'}
        onClick={handleExploreClick}
        type="action"
        actionType="explore"
      />
      </div>

      {spaceMenu.dialogs}

      {openFolderId && (() => {
        const folderItem = resolvedLayout.find(
          (i): i is ResolvedSpaceLayoutItem & { type: 'folder' } =>
            i.type === 'folder' && i.folder.id === openFolderId
        );
        const anchor = folderAnchorRefs.current.get(openFolderId);
        if (!folderItem || !anchor) return null;
        return (
          <FolderFlyout
            folder={folderItem.folder}
            spaces={folderItem.spaces}
            anchorEl={anchor}
            currentSpaceId={currentSpaceId}
            unreadSpaceIds={unreadSpaceIds}
            disconnectedOrigins={disconnectedOrigins}
            renamingFolderId={renamingFolderId}
            onClose={() => setOpenFolderId(null)}
            onSpaceClick={handleSpaceClick}
            onSpaceContextMenu={handleSpaceContextMenu}
            onRename={(name) => handleFolderRename(openFolderId, name)}
            onDragStart={(e, spaceId) => handleDragStart(e, spaceId, 'space', openFolderId)}
            onReorder={(ids) => handleReorderInFolder(openFolderId!, ids)}
            onParentDragEnd={handleDragEnd}
          />
        );
      })()}
    </nav>
  );
}
