import React, { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { formatters } from '../../i18n/formatters';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Message } from './Message';
import { BlockedRunNotice } from './BlockedRunNotice';
import { useBlockStore } from '../../stores/blockStore';
import { EMPTY_BLOCKED_PLAN, planBlockedRuns } from '../../utils/blockedRuns';
import { noteListScroll } from '../../utils/listScroll';
import { ChannelIcon } from '../ui/ChannelIcon';
import { useChatStore, type LoadAroundResult, type LoadNewerResult } from '../../stores/chatStore';
import { useSpaceStore, useIsDmChannel, getChannelOrigin } from '../../stores/spaceStore';
import { isMe, useMyRowForOrigin } from '../../stores/authStore';
import { useSocialStore } from '../../stores/socialStore';
import {
  usePendingMessageStore,
  isPendingMessage,
  type PendingMessageView,
  type PendingAttachmentView,
  type PendingBubble,
} from '../../stores/pendingMessageStore';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { ProfileAvatar } from '../ui/ProfileAvatar';
import { AvatarStack } from '../ui/AvatarStack';
import { useUIStore } from '../../stores/uiStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { isMine, parseFederatedUsername, userKey } from '../../utils/identity';
import { useDmViewer } from '../../hooks/useDmViewer';
import { formatDmHeaderName } from '../../utils/dmFormatters';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { describeError } from '../../i18n/errors';
import type { MessageWithUser } from '@backspace/shared';
import { SystemMessage } from './SystemMessage';
import { ChannelSystemMessage } from './ChannelSystemMessage';
import { MessageSelectionBar } from './MessageSelectionBar';
import { MessageJumpContext } from './messageJumpContext';
import {
  BOTTOM_ANCHOR,
  firstUnreadMessageId,
  pageReachesReadPosition,
  resolveOpenTarget,
  type OpenTarget,
  type ScrollAnchor,
} from './scrollAnchor';
import { layoutPixels } from '../../platform/interfaceScale';

const EMPTY_MESSAGES: MessageWithUser[] = [];
const EMPTY_PENDING_BUBBLES: PendingBubble[] = [];

// Constant-height slot rendered above messages whenever hasMore === true.
// Value derived from the pagination skeleton's analytical rendered height
// (pt-4 + 3 × (h-10 row) + 2 × mb-5 = 176px after stripping the last row's
// mb-5), rounded UP to the nearest 4-pixel step for a buffer. See
// docs/systems/message-list.md "Top-of-list reservation slot".
const PAGINATION_SLOT_HEIGHT_PX = 200;

// Class that flashes the row a jump landed on (search result or reply
// preview). Defined in globals.css with the `message-jump-flash` keyframes.
const JUMP_HIGHLIGHT_CLASS = 'message-jump-highlight';
const JUMP_HIGHLIGHT_ANIMATION = 'message-jump-flash';

// The auto-scroll model's thresholds (see handleScroll): within AT_BOTTOM the
// list follows new messages, within NEAR_BOTTOM Jump to Present stays hidden.
const AT_BOTTOM_THRESHOLD_PX = 150;
const NEAR_BOTTOM_THRESHOLD_PX = 5000;

// A detached window pages forward once less than this is left below the
// view: the mirror of the load-more trigger at the top, so the next page is
// usually there before the user reaches the window's end.
const NEWER_PAGE_TRIGGER_PX = PAGINATION_SLOT_HEIGHT_PX + 50;

function isMessageLoaded(channelId: string, messageId: string): boolean {
  return (useChatStore.getState().messages.get(channelId) ?? []).some((m) => m.id === messageId);
}

/**
 * The scrollTop a `scrollIntoView({ block: 'center' })` of `el` lands on:
 * the row centred in the container, clamped to the scrollable range.
 */
function centredScrollTop(container: HTMLElement, el: HTMLElement): number {
  const height = layoutPixels(el.getBoundingClientRect().height);
  const unclamped = container.scrollTop + rowOffset(container, el) - (container.clientHeight - height) / 2;
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.min(max, Math.max(0, unclamped));
}

// Where a channel opened at its first unread message holds that row: far
// enough below the viewport top that the unread divider above it shows.
const UNREAD_ROW_OFFSET_PX = 64;

// A row's height before it is laid out, for anchoring a jump target that is
// still loading. The anchor is re-measured once the row renders.
const ROW_HEIGHT_ESTIMATE_PX = 40;

/** Rows with a server id; optimistic sends (`pending-…`, `temp_…`) are not anchors. */
const ANCHORABLE_ROW = /^msg-\d+$/;

function findRow(container: HTMLElement, messageId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[id="msg-${messageId}"]`);
}

/** Distance in layout pixels from the scroll viewport's top edge to the row's top edge. */
function rowOffset(container: HTMLElement, row: HTMLElement): number {
  return layoutPixels(row.getBoundingClientRect().top - container.getBoundingClientRect().top);
}

/**
 * The first row with a server id whose bottom edge is below the viewport's top edge. Rows stand
 * top to bottom in document order, so this halves its way there: it runs on every scroll, and
 * measuring every row above the view, up to 200 of them, cost a frame's time on its own.
 */
function topmostVisibleRow(container: HTMLElement): HTMLElement | null {
  const top = container.getBoundingClientRect().top;
  const rows = [...container.querySelectorAll<HTMLElement>('[id^="msg-"]')].filter((row) => ANCHORABLE_ROW.test(row.id));
  let low = 0;
  let high = rows.length - 1;
  let found: HTMLElement | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const row = rows[middle]!;
    if (row.getBoundingClientRect().bottom > top) {
      found = row;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return found;
}


/** True when `id` falls between the oldest and newest server ids in `ids`. */
function idWithinRows(id: string, ids: readonly string[]): boolean {
  if (!/^\d+$/.test(id)) return false;
  const target = BigInt(id);
  let min: bigint | null = null;
  let max: bigint | null = null;
  for (const rowId of ids) {
    if (!/^\d+$/.test(rowId)) continue;
    const value = BigInt(rowId);
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  return min !== null && max !== null && target >= min && target <= max;
}

function sharesAnyId(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length === 0) return false;
  const seen = new Set(previous);
  return next.some((id) => seen.has(id));
}

interface MessageListProps {
  channelId: string;
  /** A jump requested from outside the list (search). Taken once, then `onJumpHandled` fires. */
  jumpToMessageId?: string | null;
  onJumpHandled?: () => void;
  /** What stands at the very start of the list instead of the channel's welcome: a thread's first message. */
  top?: React.ReactNode;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Restartable background flash on the row a jump landed on. */
function flashMessage(el: HTMLElement): void {
  el.classList.remove(JUMP_HIGHLIGHT_CLASS);
  // Force a style flush so a second jump to the same row restarts the animation.
  void el.offsetWidth;
  el.classList.add(JUMP_HIGHLIGHT_CLASS);
  const onEnd = (e: AnimationEvent) => {
    // animationend bubbles from the row's children (skeletons, typing dots);
    // only the flash's own end removes the class.
    if (e.target !== el || e.animationName !== JUMP_HIGHLIGHT_ANIMATION) return;
    el.classList.remove(JUMP_HIGHLIGHT_CLASS);
    el.removeEventListener('animationend', onEnd);
  };
  el.addEventListener('animationend', onEnd);
}

/**
 * Keyboard focus follows a jump to the row it landed on, so the next Tab
 * continues from there rather than from a control that may now be off screen.
 * The row is a tab stop only while it holds that focus. `preventScroll`: the
 * smooth scroll is already under way.
 */
function focusJumpTarget(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  }
  el.focus({ preventScroll: true });
}

function isSameGroup(prev: MessageWithUser, curr: MessageWithUser): boolean {
  if (prev.type === 'system' || curr.type === 'system') return false;
  if (prev.userId !== curr.userId) return false;
  const timeDiff = curr.createdAt - prev.createdAt;
  return timeDiff < 5 * 60 * 1000; // 5 minutes
}

function formatDateDivider(timestamp: number): string {
  return formatters.formatFullDate(timestamp);
}

function shouldShowDateDivider(prev: MessageWithUser | undefined, curr: MessageWithUser): boolean {
  if (!prev) return true;
  const prevDate = new Date(prev.createdAt).toDateString();
  const currDate = new Date(curr.createdAt).toDateString();
  return prevDate !== currDate;
}

export function MessageList({ channelId, jumpToMessageId, onJumpHandled, top }: MessageListProps) {
  const { t } = useTranslation(['chat', 'common']);
  const messages = useChatStore((s) => s.messages.get(channelId)) ?? EMPTY_MESSAGES;
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadMoreMessages = useChatStore((s) => s.loadMoreMessages);
  const loadNewerMessages = useChatStore((s) => s.loadNewerMessages);
  const presentReturn = useChatStore((s) => s.presentReturns.get(channelId) ?? 0);
  const loadMessagesAround = useChatStore((s) => s.loadMessagesAround);
  const isDetached = useChatStore((s) => s.detachedChannels.has(channelId));
  const addToast = useUIStore((s) => s.addToast);
  const loadState = useChatStore((s) => s.loadStates.get(channelId));
  // Waiting for the ready that lists the channel is a load the list cannot
  // start yet; it shows the same skeleton.
  const isLoading = loadState?.status === 'loading' || loadState?.status === 'waiting';
  const hasMore = useChatStore((s) => s.hasMore.get(channelId) ?? true);
  const ackChannel = useChatStore((s) => s.ackChannel);
  const saveScrollPosition = useChatStore((s) => s.saveScrollPosition);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // ─── Anchoring model ─────────────────────────────────────────────────────
  // One anchor says what the view is held to: the bottom, or a row at an
  // offset from the viewport top. Opening, remounting, a cache replaced under
  // the open view, jumps, Jump to Present and every size change go through it.
  // See docs/systems/message-list.md, "Anchoring model".
  const anchorRef = useRef<ScrollAnchor>(BOTTOM_ANCHOR);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // The offset and scroll geometry the list last set or measured. A scroll
  // event at that offset with that geometry is the list's own; one after the
  // geometry changed was caused by layout, not by the user.
  const appliedScrollTopRef = useRef<number | null>(null);
  const appliedGeometryRef = useRef<{ scrollHeight: number; clientHeight: number } | null>(null);
  // The channel whose open target has been taken. Until then nothing derives
  // or applies an anchor: the list has no rows to hold.
  const openedChannelRef = useRef<string | null>(null);
  const openTargetRef = useRef<OpenTarget>(BOTTOM_ANCHOR);
  // A load that will bring the anchored row (jump, restore) is in flight.
  const anchorLoadInFlightRef = useRef(false);
  // The rows the last render held, to tell a replaced cache from an edit.
  const renderedIdsRef = useRef<{ channelId: string; ids: string[] }>({ channelId, ids: [] });
  // The first unread message when the channel opened, shown with a divider
  // above it for the rest of the visit (a snapshot: acking does not move it).
  const [unreadMarker, setUnreadMarker] = useState<{ channelId: string; messageId: string } | null>(null);
  // The store's count of returns to the present for this channel that the
  // list has followed (`chatStore.presentReturns`).
  const presentReturnRef = useRef(0);
  // The channel whose detached window is paging forward, so one page is
  // asked for at a time.
  const loadingNewerRef = useRef<string | null>(null);

  // Smooth-scroll intent tracking. While a smooth scroll is animating toward the bottom,
  // intermediate `handleScroll` measurements would otherwise see a large distance from
  // the bottom and move the anchor off it. The smooth scroll would then land at its
  // originally computed (now stale) target while media loaded underneath.
  // 'bottom' = animating toward the bottom, the anchor stays at the bottom meanwhile.
  // 'message' = jump-to-message animation; nothing re-applies the anchor until it lands.
  // null = no animation in progress.
  const smoothScrollIntentRef = useRef<'bottom' | 'message' | null>(null);
  const smoothScrollDeadlineRef = useRef(0);
  const smoothScrollFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 5000px = same threshold as `nearBottom`. If the user wheels away mid-animation, their
  // distance jumps well past this, and we let the anchor move honestly so the
  // smooth scroll's terminal frames don't fight a deliberate user gesture.
  const SMOOTH_SCROLL_USER_INTENT_THRESHOLD = 5000;
  const SMOOTH_SCROLL_DEADLINE_MS = 800;
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const showInitialSkeleton = useDelayedLoading(isLoading && messages.length === 0);
  // 50 ms threshold (vs the 200 ms default on showInitialSkeleton above) is
  // safe here because the constant-height slot eliminated the layout
  // shift the 200 ms originally hid. 50 ms is below the ~100 ms visual
  // perception threshold so near-instant cache hits still complete without
  // ever rendering the skeleton, while slow loads see the skeleton appear
  // before the user's eye can register the slot as empty.
  const showPaginationSkeleton = useDelayedLoading(isLoadingMore, { threshold: 50 });
  const prevChannelIdRef = useRef<string>(channelId);
  const ackTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // Live mirror of the current `channelId` prop. Updated synchronously each render so
  // that async callbacks (the `loadMoreMessages` await in `handleScroll`, the jump and
  // restore loads) can compare a captured channel against the current channel and bail
  // if the user switched away mid-flight. We don't read the store's `currentChannelId`
  // because it lags one render behind a URL-driven channel switch (it's set in an
  // `AppLayout` effect that fires after MessageList renders with the new prop).
  const currentChannelIdRef = useRef(channelId);
  currentChannelIdRef.current = channelId;
  // Suppress the first scroll event after a channel switch from triggering
  // pagination. When the new channel's content is shorter than the outgoing
  // channel's, the browser clamps `scrollTop` to its new max and dispatches a
  // synthetic scroll event. That event lands in `handleScroll` near the top,
  // and for any channel where `hasMore` is `true` (default for unvisited
  // channels per the `?? true` fallback at the `hasMore` selector) it would
  // fire `loadMoreMessages` even though the user never scrolled. The flag is
  // armed on every channel change and consumed by the load-more block on the
  // next scroll event. A 250 ms setTimeout disarms it as a fallback in case no
  // clamp event fires, so a real user scroll-to-top shortly after a channel
  // switch isn't permanently suppressed.
  const suppressNextLoadMoreRef = useRef(false);
  const suppressNextLoadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (suppressNextLoadMoreTimerRef.current) {
      clearTimeout(suppressNextLoadMoreTimerRef.current);
      suppressNextLoadMoreTimerRef.current = null;
    }
  }, []);

  // Monotonic id of the latest request that moves the view on purpose (a
  // jump, Jump to Present, restoring a reading position). An older request
  // still awaiting its load compares against it and gives up, so the newest
  // one wins.
  const jumpSeqRef = useRef(0);

  const setAnchor = useCallback((anchor: ScrollAnchor) => {
    anchorRef.current = anchor;
    setIsAtBottom(anchor.kind === 'bottom');
  }, []);

  /**
   * The bottom anchor follows the newest message. The end of a detached
   * window is not the newest message, so a view there holds a row instead:
   * the next page appends below it without moving the view, and nothing is
   * marked read.
   */
  const bottomIsPresent = useCallback(
    () => !useChatStore.getState().detachedChannels.has(currentChannelIdRef.current),
    [],
  );

  const recordGeometry = useCallback((container: HTMLElement) => {
    appliedGeometryRef.current = { scrollHeight: container.scrollHeight, clientHeight: container.clientHeight };
    const near = container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
    setIsNearBottom(near);
  }, []);

  /** The anchor the view is at now: the bottom, or the topmost visible row. */
  const anchorFromLayout = useCallback((container: HTMLElement): ScrollAnchor => {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < AT_BOTTOM_THRESHOLD_PX && bottomIsPresent()) return BOTTOM_ANCHOR;
    const row = topmostVisibleRow(container);
    if (!row) return BOTTOM_ANCHOR;
    return { kind: 'message', messageId: row.id.slice(4), offsetPx: rowOffset(container, row) };
  }, [bottomIsPresent]);

  const deriveAnchorFromLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setAnchor(anchorFromLayout(container));
    appliedScrollTopRef.current = null;
    recordGeometry(container);
  }, [anchorFromLayout, recordGeometry, setAnchor]);

  /**
   * Page a detached window forward (`chatStore.loadNewerMessages`). The rows
   * append below the view and the anchor holds the row being read. A page
   * that reaches the newest message attaches the window: a view already at
   * its end then takes the bottom, so it follows new messages and the
   * channel is marked read. An origin without forward paging answers with
   * its newest page, which the store applies as a return to the present.
   */
  const pageForward = useCallback(async () => {
    const requestChannelId = channelId;
    if (loadingNewerRef.current === requestChannelId) return;
    loadingNewerRef.current = requestChannelId;
    const seq = jumpSeqRef.current;
    let result: LoadNewerResult;
    try {
      result = await loadNewerMessages(requestChannelId);
    } finally {
      if (loadingNewerRef.current === requestChannelId) loadingNewerRef.current = null;
    }
    if (result !== 'attached') return;
    await nextFrame();
    if (jumpSeqRef.current !== seq || currentChannelIdRef.current !== requestChannelId) return;
    if (anchorRef.current.kind === 'message') deriveAnchorFromLayout();
  }, [channelId, loadNewerMessages, deriveAnchorFromLayout]);

  /** Page forward when the view is close to the end of a detached window. */
  const loadNewerIfAtEnd = useCallback(() => {
    const container = containerRef.current;
    if (!container || openedChannelRef.current !== currentChannelIdRef.current) return;
    if (bottomIsPresent() || anchorLoadInFlightRef.current) return;
    // A bottom anchor on a detached window: Jump to Present is loading the
    // newest page, which replaces the window.
    if (anchorRef.current.kind === 'bottom') return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom >= NEWER_PAGE_TRIGGER_PX) return;
    void pageForward();
  }, [bottomIsPresent, pageForward]);

  /**
   * Hold the view to its anchor: the bottom, or the anchored row at its
   * offset. Idempotent, and it only writes scrollTop when the view is off
   * its anchor. A jump's smooth scroll is left to land.
   */
  const applyAnchor = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (smoothScrollIntentRef.current === 'message' && performance.now() < smoothScrollDeadlineRef.current) return;
    const anchor = anchorRef.current;
    if (anchor.kind === 'bottom') {
      container.scrollTop = container.scrollHeight;
    } else {
      const row = findRow(container, anchor.messageId);
      if (row) {
        const delta = rowOffset(container, row) - anchor.offsetPx;
        if (Math.abs(delta) >= 1) container.scrollTop = container.scrollTop + delta;
      }
    }
    appliedScrollTopRef.current = container.scrollTop;
    recordGeometry(container);
    loadNewerIfAtEnd();
  }, [recordGeometry, loadNewerIfAtEnd]);

  // Final defensive pin after a bottom-bound smooth scroll completes.
  // Runs from either the native `scrollend` handler (preferred) or the timeout fallback
  // (browsers without scrollend support). Whichever fires first clears the intent and
  // cancels its counterpart.
  const finalizeBottomSmoothScroll = useCallback(() => {
    if (smoothScrollIntentRef.current !== 'bottom') return;
    smoothScrollIntentRef.current = null;
    smoothScrollDeadlineRef.current = 0;
    if (smoothScrollFallbackTimerRef.current) {
      clearTimeout(smoothScrollFallbackTimerRef.current);
      smoothScrollFallbackTimerRef.current = null;
    }
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom >= SMOOTH_SCROLL_USER_INTENT_THRESHOLD) return;
    setAnchor(BOTTOM_ANCHOR);
    applyAnchor();
  }, [applyAnchor, setAnchor]);

  // Set the smooth-scroll intent and arm the final-pin path. Pick exactly one signal
  // (native scrollend if supported, timeout otherwise) — the scrollend listener itself
  // is registered persistently in a separate effect; here we only arm the timeout fallback
  // when scrollend is unavailable so they don't double-fire.
  const beginSmoothScrollIntent = useCallback((intent: 'bottom' | 'message') => {
    smoothScrollIntentRef.current = intent;
    smoothScrollDeadlineRef.current = performance.now() + SMOOTH_SCROLL_DEADLINE_MS;
    if (smoothScrollFallbackTimerRef.current) {
      clearTimeout(smoothScrollFallbackTimerRef.current);
      smoothScrollFallbackTimerRef.current = null;
    }
    const hasScrollend = typeof window !== 'undefined' && 'onscrollend' in window;
    if (intent === 'bottom' && !hasScrollend) {
      smoothScrollFallbackTimerRef.current = setTimeout(() => {
        smoothScrollFallbackTimerRef.current = null;
        finalizeBottomSmoothScroll();
      }, SMOOTH_SCROLL_DEADLINE_MS);
    }
    // For 'message' intent: there is no final pin (the target is not the bottom), but the
    // intent must still be cleared once the animation ends. Use a timeout in all cases for
    // 'message' — the scrollend listener also clears it, whichever fires first.
    if (intent === 'message') {
      smoothScrollFallbackTimerRef.current = setTimeout(() => {
        smoothScrollFallbackTimerRef.current = null;
        if (smoothScrollIntentRef.current === 'message') {
          smoothScrollIntentRef.current = null;
          smoothScrollDeadlineRef.current = 0;
        }
      }, SMOOTH_SCROLL_DEADLINE_MS);
    }
  }, [finalizeBottomSmoothScroll]);

  // A request that moves the view on purpose cancels everything that pins the
  // list to the bottom: a queued scroll event at the list's own offset would
  // re-apply the old anchor, and a pending bottom-bound smooth scroll would
  // finish at the bottom.
  const cancelBottomPinning = useCallback(() => {
    appliedScrollTopRef.current = null;
    if (smoothScrollIntentRef.current === 'bottom') {
      smoothScrollIntentRef.current = null;
      smoothScrollDeadlineRef.current = 0;
      if (smoothScrollFallbackTimerRef.current) {
        clearTimeout(smoothScrollFallbackTimerRef.current);
        smoothScrollFallbackTimerRef.current = null;
      }
    }
  }, []);

  /**
   * The anchored row is not in the cache: the cache was replaced under the
   * open view (a reconnect refetched the newest page, or Jump to Present
   * loaded it after a newer jump). Load the window around the row and hold
   * it again; if it is gone, keep whatever the view shows now.
   */
  const restoreAnchor = useCallback(async (anchor: Extract<ScrollAnchor, { kind: 'message' }>) => {
    const seq = ++jumpSeqRef.current;
    const requestChannelId = channelId;
    anchorLoadInFlightRef.current = true;
    let result: LoadAroundResult;
    try {
      result = await loadMessagesAround(requestChannelId, anchor.messageId);
    } finally {
      if (jumpSeqRef.current === seq) anchorLoadInFlightRef.current = false;
    }
    if (jumpSeqRef.current !== seq || currentChannelIdRef.current !== requestChannelId) return;
    await nextFrame();
    if (jumpSeqRef.current !== seq || currentChannelIdRef.current !== requestChannelId) return;
    const container = containerRef.current;
    if (result === 'loaded' && container && findRow(container, anchor.messageId)) {
      applyAnchor();
      return;
    }
    deriveAnchorFromLayout();
  }, [channelId, loadMessagesAround, applyAnchor, deriveAnchorFromLayout]);

  // Permission check: DM channels always allow history; space channels check READ_MESSAGE_HISTORY
  const channelPerms = useSpaceStore((s) => s.channelPermissions.get(channelId));
  // Undefined until the ready that lists the channel: not refused. The load
  // waits meanwhile (`loadStates` `waiting`, shown as loading).
  const isDm = useIsDmChannel(channelId);
  const channelKnown = isDm !== undefined;
  const canReadHistory = isDm !== false || hasPermissionBit(channelPerms, PermissionBits.READ_MESSAGE_HISTORY);

  // Channel-specific DM record (if applicable). Passed to SystemMessage so it
  // can resolve actor display names from the channel roster — needed for
  // events that don't embed the actor (name_changed, icon_changed, owner_changed).
  const currentDm = useSpaceStore((s) => isDm ? s.dmChannels.find(d => d.id === channelId) : undefined);

  // Pending bubble interleaving — synthetic MessageWithUser-shaped objects
  // representing optimistic sends. `Message.tsx` branches on the
  // `__pending` sentinel to render upload progress instead of confirmed state.
  // Note: per-byte transfer progress is intentionally NOT subscribed here.
  // Each attachment carries only `__transferId`; Message.tsx subscribes to a
  // single transfer in isolation so progress ticks don't re-render the list.
  const pendingBubbles = usePendingMessageStore((s) => s.bubbles.get(channelId)) ?? EMPTY_PENDING_BUBBLES;
  // Pending bubbles are the user's rows as the channel's instance issues them,
  // so they are checked against that origin like the rows it sends.
  const channelOrigin = useSpaceStore((s) => s.channelOriginMap.get(channelId) ?? '');
  const myRow = useMyRowForOrigin(channelOrigin);

  // Map for O(1) replyTo lookup when synthesizing pending bubbles. Built once
  // per `messages` change; per-bubble lookup is then constant-time.
  const messagesById = useMemo(() => {
    const m = new Map<string, MessageWithUser>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  const interleavedMessages: (MessageWithUser | PendingMessageView)[] = useMemo(() => {
    if (!myRow || pendingBubbles.length === 0) return messages;
    // Synthesized DM messages keep the chatStore convention of channelId === ''
    // (real DM messages have empty channelId — DM identity lives on dmChannelId).
    const synthChannelId = isDm ? '' : channelId;
    const synthesized: PendingMessageView[] = pendingBubbles.map((b) => {
      const synth: PendingMessageView = {
        id: `pending-${b.clientId}`,
        channelId: synthChannelId,
        userId: myRow.id,
        content: b.content,
        replyToId: b.replyToId,
        type: 'user',
        editedAt: null,
        createdAt: b.createdAtLocal,
        user: myRow,
        attachments: b.transferIds.map((tid): PendingAttachmentView => ({
          id: `tx-${tid}`,                         // synthetic — no real attachmentId yet
          messageId: '',
          filename: '',                            // unknown until Message.tsx looks up the transfer
          originalName: '',
          mimetype: 'application/octet-stream',
          size: 0,
          thumbnailFilename: null,
          width: null,
          height: null,
          duration: null,
          createdAt: b.createdAtLocal,
          __transferId: tid,
        })),
        embeds: [],
        reactions: [],
        replyTo: b.replyToId ? messagesById.get(b.replyToId) ?? null : null,
        __pending: b,
        ...(isDm ? { dmChannelId: channelId } : {}),
      };
      return synth;
    });
    return [...messages, ...synthesized].sort((a, b) => a.createdAt - b.createdAt);
  }, [messages, pendingBubbles, messagesById, channelId, myRow, isDm]);

  // People this user blocked: their messages collapse to one line per run
  // (utils/blockedRuns.ts). A block is the home instance's, so a channel that
  // another instance hosts is never filtered by it: its author ids name
  // different people.
  const blockedIds = useBlockStore((s) => s.blockedIds);
  const filtersBlocked = getChannelOrigin(channelId) === '';
  const blockedPlan = useMemo(
    () => (filtersBlocked && blockedIds.size > 0
      ? planBlockedRuns(interleavedMessages, (userId) => blockedIds.has(userId))
      : EMPTY_BLOCKED_PLAN),
    [filtersBlocked, blockedIds, interleavedMessages],
  );
  // Runs the reader chose to read, by the id of the run's first message.
  const [revealedRuns, setRevealedRuns] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRun = useCallback((startId: string) => {
    setRevealedRuns((current) => {
      const next = new Set(current);
      if (!next.delete(startId)) next.add(startId);
      return next;
    });
  }, []);

  // Load on open, and again when a listing names a channel that was unknown,
  // which ends its `waiting` state.
  useEffect(() => {
    if (canReadHistory) {
      loadMessages(channelId);
    }
  }, [channelId, loadMessages, canReadHistory, channelKnown]);

  // Track the last message ID so the ack re-fires when a temp message is replaced by its server-confirmed ID
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.id ?? '' : '';

  // The channel is read once the view is held at the newest message: the
  // anchor is the bottom and the cache is not a window short of the present.
  useEffect(() => {
    if (messages.length > 0 && isAtBottom && !isDetached) {
      clearTimeout(ackTimerRef.current);
      ackTimerRef.current = setTimeout(() => ackChannel(channelId), 200);
    }
    return () => clearTimeout(ackTimerRef.current);
  }, [channelId, messages.length, lastMessageId, isAtBottom, isDetached, ackChannel]);

  // Channel open and close. Opening picks the target the view will take once
  // the channel's rows are there; closing (a channel switch or an unmount)
  // saves the anchor, so a remount or a later visit comes back to it.
  useLayoutEffect(() => {
    const prevId = prevChannelIdRef.current;
    prevChannelIdRef.current = channelId;

    openedChannelRef.current = null;
    appliedScrollTopRef.current = null;
    appliedGeometryRef.current = null;
    anchorLoadInFlightRef.current = false;
    jumpSeqRef.current += 1;
    const { scrollPositions, readStates } = useChatStore.getState();
    openTargetRef.current = resolveOpenTarget(scrollPositions.get(channelId), readStates.get(channelId));
    setUnreadMarker(null);
    presentReturnRef.current = useChatStore.getState().presentReturns.get(channelId) ?? 0;
    // Nothing reads the anchor before the channel opens; the open sets it.
    anchorRef.current = BOTTOM_ANCHOR;
    const opensAtBottom = openTargetRef.current.kind === 'bottom';
    setIsAtBottom(opensAtBottom);
    setIsNearBottom(opensAtBottom);

    if (prevId !== channelId) {
      // Belt-and-suspenders: clear any in-flight pagination flag from the outgoing
      // channel. `handleScroll`'s try/finally normally clears it when the await
      // resolves; if the network hangs and it never resolves, the new channel would
      // inherit the flag and render a phantom pagination skeleton.
      setIsLoadingMore(false);
    }

    // Arm the clamp-scroll suppression flag. See `suppressNextLoadMoreRef`.
    suppressNextLoadMoreRef.current = true;
    if (suppressNextLoadMoreTimerRef.current) {
      clearTimeout(suppressNextLoadMoreTimerRef.current);
    }
    suppressNextLoadMoreTimerRef.current = setTimeout(() => {
      suppressNextLoadMoreRef.current = false;
      suppressNextLoadMoreTimerRef.current = null;
    }, 250);

    return () => {
      if (openedChannelRef.current === channelId) {
        saveScrollPosition(channelId, anchorRef.current);
      }
    };
  }, [channelId, saveScrollPosition]);

  // The channel's origin issued its message rows, so it says which author row is the user.
  const isOwnMessage = useCallback(
    (message: MessageWithUser) => isMe(message.user, getChannelOrigin(channelId)),
    [channelId],
  );

  /**
   * Hold the first unread row below the viewport top, with its divider. When
   * everything unread fits on screen the view is at the bottom anyway: hold
   * the bottom, so the list keeps following and the channel is marked read.
   */
  const anchorAtUnread = useCallback((messageId: string) => {
    const container = containerRef.current;
    if (!container) return;
    setUnreadMarker({ channelId, messageId });
    setAnchor({ kind: 'message', messageId, offsetPx: UNREAD_ROW_OFFSET_PX });
    applyAnchor();
    if (container.scrollHeight - container.scrollTop - container.clientHeight < AT_BOTTOM_THRESHOLD_PX && bottomIsPresent()) {
      setAnchor(BOTTOM_ANCHOR);
      applyAnchor();
    }
  }, [channelId, setAnchor, applyAnchor, bottomIsPresent]);

  /**
   * The unread messages start before the loaded page: load the window around
   * the read message on the channel's origin and open there. If that message
   * is gone or the load fails, open at the latest message.
   */
  const openAtUnreadWindow = useCallback(async (lastReadId: string) => {
    const seq = ++jumpSeqRef.current;
    const requestChannelId = channelId;
    const isCurrent = () => jumpSeqRef.current === seq && currentChannelIdRef.current === requestChannelId;
    // Hold the read message meanwhile: nothing follows the bottom or acks.
    setAnchor({ kind: 'message', messageId: lastReadId, offsetPx: 0 });
    anchorLoadInFlightRef.current = true;
    let result: LoadAroundResult;
    try {
      result = await loadMessagesAround(requestChannelId, lastReadId);
    } finally {
      if (jumpSeqRef.current === seq) anchorLoadInFlightRef.current = false;
    }
    if (!isCurrent()) return;
    await nextFrame();
    if (!isCurrent()) return;
    const rows = useChatStore.getState().messages.get(requestChannelId) ?? [];
    const first = result === 'loaded' ? firstUnreadMessageId(rows, lastReadId, isOwnMessage) : null;
    if (first) {
      anchorAtUnread(first);
      return;
    }
    setAnchor(BOTTOM_ANCHOR);
    applyAnchor();
  }, [channelId, setAnchor, loadMessagesAround, isOwnMessage, anchorAtUnread, applyAnchor]);

  /** Take the open target once the channel's rows are rendered. */
  const openChannel = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    openedChannelRef.current = channelId;
    const target = openTargetRef.current;
    if (target.kind === 'message') {
      setAnchor(target);
      if (findRow(container, target.messageId)) applyAnchor();
      else void restoreAnchor(target);
      return;
    }
    if (target.kind === 'unread') {
      const state = useChatStore.getState();
      const rows = state.messages.get(channelId) ?? [];
      const hasOlder = state.hasMore.get(channelId) ?? true;
      if (!pageReachesReadPosition(rows, target.lastReadId, hasOlder)) {
        void openAtUnreadWindow(target.lastReadId);
        return;
      }
      const first = firstUnreadMessageId(rows, target.lastReadId, isOwnMessage);
      if (first) {
        anchorAtUnread(first);
        return;
      }
    }
    setAnchor(BOTTOM_ANCHOR);
    applyAnchor();
  }, [channelId, setAnchor, applyAnchor, restoreAnchor, openAtUnreadWindow, isOwnMessage, anchorAtUnread]);

  // Mark Unread on a message of the open channel moves the divider to the
  // first unread message after it. Read positions otherwise only move forward.
  const readPosition = useChatStore((s) => s.readStates.get(channelId));
  const lastReadPositionRef = useRef<{ channelId: string; id: string | undefined }>({ channelId, id: readPosition });
  useEffect(() => {
    const previous = lastReadPositionRef.current;
    lastReadPositionRef.current = { channelId, id: readPosition };
    if (previous.channelId !== channelId || readPosition === undefined || previous.id === undefined) return;
    if (!/^\d+$/.test(readPosition) || !/^\d+$/.test(previous.id) || BigInt(readPosition) >= BigInt(previous.id)) return;
    const rows = useChatStore.getState().messages.get(channelId) ?? [];
    const first = firstUnreadMessageId(rows, readPosition, isOwnMessage);
    setUnreadMarker(first ? { channelId, messageId: first } : null);
  }, [channelId, readPosition, isOwnMessage]);

  // The rows changed. Before the channel is open, this is the moment to open
  // it. After, the anchor holds the view: new rows below a view at the bottom
  // are followed with a smooth scroll, and anything else (older rows loaded
  // above, a cache replaced under the view, a jump's window) is re-anchored
  // before paint.
  useLayoutEffect(() => {
    const prev = renderedIdsRef.current;
    const ids = interleavedMessages.map((m) => m.id);
    renderedIdsRef.current = { channelId, ids };
    if (ids.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    if (openedChannelRef.current !== channelId) {
      openChannel();
      return;
    }

    if (presentReturnRef.current !== presentReturn) {
      // The store replaced a detached window with the newest page (a message
      // sent from the window, an origin without forward paging): follow the
      // newest message, and drop any jump or restore still loading.
      presentReturnRef.current = presentReturn;
      jumpSeqRef.current += 1;
      anchorLoadInFlightRef.current = false;
      cancelBottomPinning();
      setAnchor(BOTTOM_ANCHOR);
      applyAnchor();
      return;
    }

    const anchor = anchorRef.current;
    if (anchor.kind === 'message' && !findRow(container, anchor.messageId)) {
      if (anchorLoadInFlightRef.current) return;
      // Outside the rows now loaded, the anchored row was dropped with the
      // cache (a reload, a replaced window): load it back. Inside them, it was
      // deleted: hold what is on screen now.
      if (idWithinRows(anchor.messageId, ids)) deriveAnchorFromLayout();
      else void restoreAnchor(anchor);
      return;
    }
    const sameChannel = prev.channelId === channelId;
    const appended = sameChannel
      && sharesAnyId(prev.ids, ids)
      && ids.length > prev.ids.length
      && ids[ids.length - 1] !== prev.ids[prev.ids.length - 1];
    if (anchor.kind === 'bottom' && appended) {
      // New messages arrived while at the bottom — smooth scroll to them.
      beginSmoothScrollIntent('bottom');
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    applyAnchor();
  }, [interleavedMessages, channelId, presentReturn, openChannel, restoreAnchor, deriveAnchorFromLayout, beginSmoothScrollIntent, cancelBottomPinning, setAnchor, applyAnchor]);

  // Every size change re-applies the anchor: the content (rows laying out,
  // embeds loading, and the composer clearance, which is the content's
  // bottom padding and so only visible in its border box) and the scroll
  // viewport itself (the mobile keyboard, window resizes).
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const content = contentRef.current;
    const container = containerRef.current;
    if (!content || !container) return;

    const observer = new ResizeObserver(() => {
      if (openedChannelRef.current !== currentChannelIdRef.current) return;
      applyAnchor();
    });
    observer.observe(content, { box: 'border-box' });
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasMessages, channelId, applyAnchor]);

  // Re-apply the anchor when any image/media inside the list finishes loading.
  // The `load` event doesn't bubble, but capture-phase listeners on ancestors still fire.
  // This handles the case ResizeObserver misses due to its own layout-loop suppression.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const handleMediaLoad = () => {
      if (openedChannelRef.current !== currentChannelIdRef.current) return;
      applyAnchor();
    };

    content.addEventListener('load', handleMediaLoad, true);
    return () => content.removeEventListener('load', handleMediaLoad, true);
  }, [hasMessages, channelId, applyAnchor]);

  // `scrollend` listener (Chrome 114+, Safari 18+).
  // Fires once per smooth-scroll animation completion. When a 'bottom' intent is in
  // flight, do a final defensive pin: layout may have grown between the smooth-scroll
  // command and its terminal frame (lazy-loaded media, late embeds), and the smooth
  // animation will have stopped at the originally computed target. For browsers without
  // scrollend, the timeout fallback armed in `beginSmoothScrollIntent` does the same.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof window === 'undefined' || !('onscrollend' in window)) return;

    const handleScrollEnd = () => {
      const intent = smoothScrollIntentRef.current;
      if (intent === 'bottom') {
        finalizeBottomSmoothScroll();
      } else if (intent === 'message') {
        // No pin (the target is not the bottom), but clear the intent so the anchor is
        // applied again and the next bottom-bound smooth scroll's suppression works.
        smoothScrollIntentRef.current = null;
        smoothScrollDeadlineRef.current = 0;
        if (smoothScrollFallbackTimerRef.current) {
          clearTimeout(smoothScrollFallbackTimerRef.current);
          smoothScrollFallbackTimerRef.current = null;
        }
      }
    };

    container.addEventListener('scrollend', handleScrollEnd);
    return () => container.removeEventListener('scrollend', handleScrollEnd);
  }, [hasMessages, channelId, finalizeBottomSmoothScroll]);

  // Cleanup: on channel switch / unmount, clear any in-flight smooth-scroll intent
  // (we don't want a 'bottom' intent armed on the previous channel to suppress the
  // first user scroll on the new channel).
  useEffect(() => {
    return () => {
      smoothScrollIntentRef.current = null;
      smoothScrollDeadlineRef.current = 0;
      if (smoothScrollFallbackTimerRef.current) {
        clearTimeout(smoothScrollFallbackTimerRef.current);
        smoothScrollFallbackTimerRef.current = null;
      }
    };
  }, [channelId]);

  // ─── Jump to message ─────────────────────────────────────────────────────
  // One path for every jump: search results (the `jumpToMessageId` prop) and
  // reply previews (through MessageJumpContext). See docs/systems/message-list.md,
  // "Jump to message".

  // The anchor is set from where the jump will land, before the list moves:
  // a far jump holds the row (messages arriving afterwards do not pull the
  // view back); a jump that lands near the bottom keeps following. A target
  // already on screen near the bottom may not move the list at all, and no
  // scroll event follows, so the anchor cannot wait for one.
  // Returns the row it scrolled to, or null when the row is not rendered.
  const scrollToRenderedMessage = useCallback((messageId: string): HTMLElement | null => {
    const container = containerRef.current;
    const el = container ? findRow(container, messageId) : null;
    if (!container || !el) return null;
    cancelBottomPinning();
    const destination = centredScrollTop(container, el);
    const distanceFromBottom = container.scrollHeight - container.clientHeight - destination;
    setAnchor(distanceFromBottom < AT_BOTTOM_THRESHOLD_PX && bottomIsPresent()
      ? BOTTOM_ANCHOR
      : { kind: 'message', messageId, offsetPx: rowOffset(container, el) - (destination - container.scrollTop) });
    setIsNearBottom(distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX);
    beginSmoothScrollIntent('message');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashMessage(el);
    return el;
  }, [cancelBottomPinning, setAnchor, beginSmoothScrollIntent, bottomIsPresent]);

  const jumpToMessage = useCallback(async (messageId: string): Promise<void> => {
    const seq = ++jumpSeqRef.current;
    const requestChannelId = channelId;
    const isCurrent = () => jumpSeqRef.current === seq && currentChannelIdRef.current === requestChannelId;
    // A jump is where the channel opens, if it has not opened yet.
    openedChannelRef.current = requestChannelId;
    // Focus follows the jump only if nobody moved it meanwhile: a jump that
    // waits on the network must not pull focus out of the composer the user
    // clicked into while it loaded.
    const focusAtStart = document.activeElement;
    const land = (): boolean => {
      const el = isMessageLoaded(requestChannelId, messageId) ? scrollToRenderedMessage(messageId) : null;
      if (!el) return false;
      const active = document.activeElement;
      if (active === focusAtStart || active === null || active === document.body) focusJumpTarget(el);
      return true;
    };

    if (land()) return;

    // Not loaded: replace the cache with the window around the target on the
    // channel's origin. Anchor to the target first, so the window lays out
    // around it instead of being followed to its bottom.
    cancelBottomPinning();
    const container = containerRef.current;
    setAnchor({ kind: 'message', messageId, offsetPx: container ? Math.max(0, (container.clientHeight - ROW_HEIGHT_ESTIMATE_PX) / 2) : 0 });
    anchorLoadInFlightRef.current = true;
    let result: LoadAroundResult;
    try {
      result = await loadMessagesAround(requestChannelId, messageId);
    } finally {
      if (jumpSeqRef.current === seq) anchorLoadInFlightRef.current = false;
    }
    if (!isCurrent()) return;

    if (result === 'loaded') {
      // Two frames: React commits the new window, then lays it out.
      await nextFrame();
      await nextFrame();
      if (!isCurrent()) return;
      if (land()) return;
    }

    deriveAnchorFromLayout();
    addToast(
      result === 'failed' ? t('chat:list.jump.failed') : t('chat:list.jump.unavailable'),
      'info',
      4000,
    );
  }, [channelId, scrollToRenderedMessage, cancelBottomPinning, setAnchor, loadMessagesAround, deriveAnchorFromLayout, addToast, t]);

  // Rows get a fire-and-forget handle; the jump reports its own failures.
  const requestJump = useCallback((messageId: string) => {
    void jumpToMessage(messageId);
  }, [jumpToMessage]);

  // A jump requested from outside the list (search result). Each request is
  // taken once: a parent that re-renders before clearing it (or passes a new
  // callback each render) must not start the load again.
  const handledJumpRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!jumpToMessageId) {
      handledJumpRequestRef.current = null;
      return;
    }
    if (handledJumpRequestRef.current === jumpToMessageId) return;
    handledJumpRequestRef.current = jumpToMessageId;
    onJumpHandled?.();
    requestJump(jumpToMessageId);
  }, [jumpToMessageId, onJumpHandled, requestJump]);

  // Jump to Present. The cache can be a window that stops short of the newest
  // message (`detachedChannels`); scrolling to its bottom would not be the
  // present, so reload the newest page first and pin to it.
  const jumpToPresent = useCallback(async () => {
    const seq = ++jumpSeqRef.current;
    const requestChannelId = channelId;
    const isCurrent = () => jumpSeqRef.current === seq && currentChannelIdRef.current === requestChannelId;
    anchorLoadInFlightRef.current = false;
    if (!useChatStore.getState().detachedChannels.has(channelId)) {
      setAnchor(BOTTOM_ANCHOR);
      beginSmoothScrollIntent('bottom');
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    // The fresh page is laid out at the bottom as it arrives.
    cancelBottomPinning();
    setAnchor(BOTTOM_ANCHOR);
    const loaded = await loadMessages(requestChannelId, true);
    if (!isCurrent()) return;
    if (!loaded) {
      // The window is still the cache. Its bottom is not the present, so
      // stay where the user is, take the anchor from the layout, and say so.
      deriveAnchorFromLayout();
      addToast(t('chat:list.jump.presentFailed'), 'info', 4000);
      return;
    }
    requestAnimationFrame(() => {
      if (!isCurrent()) return;
      setAnchor(BOTTOM_ANCHOR);
      applyAnchor();
    });
  }, [channelId, setAnchor, beginSmoothScrollIntent, cancelBottomPinning, loadMessages, deriveAnchorFromLayout, applyAnchor, addToast, t]);

  const handleScroll = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    // Before the channel has opened there is nothing to hold: the first
    // events are the browser clamping the previous channel's offset.
    if (openedChannelRef.current !== channelId) return;

    // The list's own scroll, or one caused by a layout change since the list
    // last measured (the browser clamping the offset when content shrank):
    // hold the anchor. See docs/systems/message-list.md, "Anchoring model".
    const geometry = appliedGeometryRef.current;
    const geometryChanged = !geometry
      || geometry.scrollHeight !== container.scrollHeight
      || geometry.clientHeight !== container.clientHeight;
    if (container.scrollTop === appliedScrollTopRef.current || geometryChanged) {
      applyAnchor();
      return;
    }

    // The user moved the view. An event at the list's last offset from here
    // on is a coincidence, not the list's own.
    appliedScrollTopRef.current = null;
    noteListScroll();
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    // While a smooth scroll we started animates toward the bottom, its frames
    // report large distances. Keep the anchor at the bottom through them, so
    // media that finishes loading mid-animation is still followed, unless the
    // user has wheeled well away (a deliberate gesture overriding the animation).
    const intent = smoothScrollIntentRef.current;
    const holdingBottom = intent === 'bottom'
      && performance.now() < smoothScrollDeadlineRef.current
      && distanceFromBottom < SMOOTH_SCROLL_USER_INTENT_THRESHOLD;
    if (!holdingBottom) setAnchor(anchorFromLayout(container));
    recordGeometry(container);
    loadNewerIfAtEnd();

    // Load more when scrolled to top. The rows loaded above the view are held
    // in place by the anchor (the layout effect re-applies it before paint).
    // Capture the channelId so a channel switch that races the await is detected;
    // the try/finally guarantees `setIsLoadingMore(false)` runs even if the load
    // throws. The channel-switch reset is the safety net for an await that never
    // resolves.
    // Consume the post-channel-switch suppression flag. The first scroll event
    // after a channel change is almost always the browser-clamp event and must
    // NOT be treated as a user scroll-to-top.
    let suppressLoadMore = false;
    if (suppressNextLoadMoreRef.current) {
      suppressNextLoadMoreRef.current = false;
      if (suppressNextLoadMoreTimerRef.current) {
        clearTimeout(suppressNextLoadMoreTimerRef.current);
        suppressNextLoadMoreTimerRef.current = null;
      }
      suppressLoadMore = true;
    }

    // scrollTop >= 0 guards against iOS Safari rubber-band overscroll producing
    // briefly-negative scrollTop values, which would otherwise satisfy the
    // upper bound and fire a spurious load during a rubber-band gesture.
    if (
      !suppressLoadMore &&
      container.scrollTop >= 0 &&
      container.scrollTop < PAGINATION_SLOT_HEIGHT_PX + 50 &&
      hasMore &&
      !isLoadingMore
    ) {
      setIsLoadingMore(true);
      try {
        await loadMoreMessages(channelId);
      } finally {
        setIsLoadingMore(false);
      }
    }
  }, [channelId, hasMore, isLoadingMore, loadMoreMessages, applyAnchor, setAnchor, anchorFromLayout, recordGeometry, loadNewerIfAtEnd]);

  if (!canReadHistory) {
    return (
      <div className="empty-state flex-1">
        <span className="empty-state-icon" aria-hidden="true">
          <Icon name="lock" size={18} />
        </span>
        <p className="empty-state-body">{t('chat:list.noHistoryPermission')}</p>
      </div>
    );
  }

  // The initial-load skeleton is rendered as an absolutely-positioned overlay
  // (NOT an early return) so that the scroll container below — and its
  // `containerRef` / `contentRef` — stay mounted across the loading transition.
  // Auto-scroll effects (initial snap, ResizeObserver, load-handler, scrollend)
  // are keyed on `[messages.length, channelId]` / `[hasMessages, channelId]`,
  // and each commits its only re-fire signal during the load window. If the
  // refs were null at that moment (which they are if the skeleton replaces the
  // container via early-return), every effect bails on its null guard and never
  // re-attaches once the skeleton clears, leaving the user scrolled to the top.
  // See docs/systems/message-list.md "ContainerRef invariant".

  return (
    <MessageJumpContext.Provider value={requestJump}>
    <div className="flex-1 relative min-h-0">
      <MessageSelectionBar channelId={channelId} />
      <div
        ref={containerRef}
        className="h-full overflow-y-auto overflow-x-hidden no-scrollbar"
        onScroll={handleScroll}
      >
        {hasMore && (
          <div style={{ height: PAGINATION_SLOT_HEIGHT_PX }}>
            {showPaginationSkeleton && (
              <div className="px-5 pt-4" role="status" aria-label={t('chat:list.loadingOlder')}>
                {Array.from({ length: 3 }, (_, i) => <MessageSkeleton key={i} index={i} />)}
              </div>
            )}
          </div>
        )}

        {!hasMore && (top ?? <WelcomeHeader channelId={channelId} />)}

        <div
          ref={contentRef}
          className="pt-4"
          style={{ paddingBottom: 'var(--composer-clearance, 80px)' }}
        >
          {interleavedMessages.map((msg, i) => {
            const prevMsg = interleavedMessages[i - 1];
            const showDate = shouldShowDateDivider(prevMsg, msg);
            const dateLabel = showDate ? formatDateDivider(msg.createdAt) : null;
            const isFirstInGroup = !prevMsg || showDate || !isSameGroup(prevMsg, msg);
            const isUnreadStart = unreadMarker?.channelId === channelId && unreadMarker.messageId === msg.id;
            // Where this message sits in a run of blocked people's messages, if it does.
            const blockedStartId = blockedPlan.startOf.get(msg.id);
            const startsBlockedRun = blockedStartId === msg.id;
            const blockedRunRevealed = blockedStartId !== undefined && revealedRuns.has(blockedStartId);
            const blockedRunHidden = blockedStartId !== undefined && !blockedRunRevealed;

            // Walk back to find the nearest non-pending neighbor for "Mark Unread".
            // A `pending-${clientId}` ID would be rejected by the server, so we skip
            // any pending entries when computing the previous-message reference.
            let realPrevId: string | null = null;
            for (let j = i - 1; j >= 0; j--) {
              const candidate = interleavedMessages[j];
              if (candidate && !isPendingMessage(candidate)) {
                realPrevId = candidate.id;
                break;
              }
            }

            return (
              <React.Fragment key={msg.id}>
                {dateLabel && !isUnreadStart && (
                  <div className="flex items-center gap-3 px-5 my-4 select-none pointer-events-none">
                    <div className="divider-fade flex-1" />
                    <span className="label-mono">{dateLabel}</span>
                    <div className="divider-fade flex-1" />
                  </div>
                )}
                {isUnreadStart && (
                  <UnreadDivider
                    label={t('chat:list.unread.label')}
                    name={dateLabel
                      ? t('chat:list.unread.dividerWithDate', { date: dateLabel })
                      : t('chat:list.unread.divider')}
                    dateLabel={dateLabel}
                  />
                )}
                {msg.type === 'system' ? (
                  isDm === false
                    ? <ChannelSystemMessage message={msg} />
                    : <SystemMessage message={msg} dm={currentDm ?? null} />
                ) : (
                  <>
                    {startsBlockedRun && (
                      <BlockedRunNotice
                        count={blockedPlan.counts.get(msg.id) ?? 1}
                        revealed={blockedRunRevealed}
                        onToggle={() => toggleRun(msg.id)}
                      />
                    )}
                    {!blockedRunHidden && (
                      <Message
                        message={msg}
                        isCompact={!isFirstInGroup}
                        isFirstInGroup={isFirstInGroup}
                        previousMessageId={realPrevId}
                      />
                    )}
                  </>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div ref={bottomRef} />
      </div>

      {showInitialSkeleton && (
        <div
          className="lit absolute inset-0 z-10 bg-surface-chat flex flex-col justify-end px-5 pointer-events-none"
          style={{ paddingBottom: 'var(--composer-clearance, 80px)' }}
          role="status"
          aria-label={t('chat:list.loading')}
        >
          {Array.from({ length: 7 }, (_, i) => <MessageSkeleton key={i} index={i} />)}
        </div>
      )}

      {loadState?.status === 'failed' && messages.length === 0 && (
        <LoadFailedNotice
          title={t('chat:list.loadFailed')}
          detail={describeError(loadState.error)}
          retryLabel={t('common:actions.tryAgain')}
          onRetry={() => { void loadMessages(channelId, true); }}
        />
      )}

      {(!isNearBottom || isDetached) && messages.length > 0 && (
        <button
          onClick={() => { void jumpToPresent(); }}
          style={{ bottom: 'var(--composer-clearance, 80px)' }}
          className="glass absolute left-1/2 z-[120] flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-md pl-2 pr-3 text-ui font-medium text-txt-secondary transition-colors animate-fade-in hover:border-interactive-muted hover:text-txt-primary active:bg-surface-chat"
        >
          <Icon name="arrow-down" size={15} />
          {t('chat:list.jumpToPresent')}
        </button>
      )}
    </div>
    </MessageJumpContext.Provider>
  );
}

/**
 * The channel's messages could not be loaded. An overlay over the scroll
 * container, never a replacement for it (docs/systems/message-list.md,
 * "ContainerRef invariant"), so the list's effects stay attached for the retry.
 */
function LoadFailedNotice({ title, detail, retryLabel, onRetry }: {
  title: string;
  detail: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="lit absolute inset-0 z-10 flex items-center justify-center bg-surface-chat px-6">
      <div role="alert" className="empty-state">
        <span className="empty-state-icon" aria-hidden="true">
          <Icon name="alert" size={18} />
        </span>
        <p className="empty-state-title">{title}</p>
        <p className="empty-state-body break-words">{detail}</p>
        <button
          type="button"
          onClick={onRetry}
          className="btn-primary mt-2"
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * A row while a page loads, drawn like the default look of a message: a small
 * picture and a name on one line, the text under them.
 */
function MessageSkeleton({ index }: { index: number }) {
  const delay = { animationDelay: `${index * 0.15}s` };
  return (
    <div className="mb-[14px] last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        <div className="skeleton h-5 w-5 flex-shrink-0" style={delay} />
        <div className="skeleton skeleton-bar" style={{ ...delay, width: `${88 + (index * 37) % 64}px` }} />
      </div>
      <div className="skeleton skeleton-bar" style={{ ...delay, width: `${44 + (index * 13) % 40}%` }} />
    </div>
  );
}

/**
 * Where the unread messages start. A separator with its own name, so a
 * screen reader moving through the list hears it; the visible label is short.
 * When the first unread message also starts a new day, the date sits in the
 * same rule instead of a second divider right above it.
 */
function UnreadDivider({ label, name, dateLabel }: { label: string; name: string; dateLabel: string | null }) {
  return (
    <div
      role="separator"
      aria-label={name}
      className="flex items-center px-5 my-4 select-none pointer-events-none"
    >
      <div className="flex-1 h-px bg-accent-primary/60" />
      {dateLabel && (
        <>
          <span className="label-mono px-3">{dateLabel}</span>
          <div className="flex-1 h-px bg-accent-primary/60" />
        </>
      )}
      <span className="ml-2 rounded bg-accent-primary px-1.5 py-px font-mono text-2xs font-semibold uppercase leading-4 tracking-[0.06em] text-white">
        {label}
      </span>
    </div>
  );
}

function WelcomeHeader({ channelId }: { channelId: string }) {
  const { t } = useTranslation(['chat', 'common']);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const removeFriend = useSocialStore((s) => s.removeFriend);
  const friends = useSocialStore((s) => s.friends);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const openModal = useUIStore((s) => s.openModal);
  const isDm = useIsDmChannel(channelId);
  const navigate = useNavigate();
  const viewer = useDmViewer(isDm ? channelId : null);
  const channelType = useSpaceStore((s) => s.channels.find((c) => c.id === channelId)?.type);
  const channelIcon = useSpaceStore((s) => s.channels.find((c) => c.id === channelId)?.icon ?? null);

  if (isDm) {
    const dm = dmChannels.find(d => d.id === channelId);
    if (!dm) return null; // DM data not yet loaded (WebSocket ready pending)
    const otherMembers = dm.members.filter(m => !isMine(m, viewer.origin, viewer.self));
    const isGroupDm = !!dm.ownerId;

    if (isGroupDm) {
      const groupName = formatDmHeaderName(dm, viewer);
      const ownerMember = dm.members.find(m => m.id === dm.ownerId);
      const ownerName = ownerMember?.displayName ?? ownerMember?.username ?? t('common:states.unknown');
      const hasFederated = dm.members.some(m => m.homeInstance);

      const handleLeaveGroup = async () => {
        try {
          await api.dm.leave(channelId);
          navigate('/channels/@me');
        } catch (err) {
          console.error('Failed to leave group:', err);
        }
      };

      const handleOpenSettings = () => {
        openModal('groupDmSettings', { dmChannelId: channelId, initialTab: 'overview' });
      };

      const handleOwnerClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!ownerMember) return;
        openUserProfile(ownerMember, viewer.origin, e.currentTarget.getBoundingClientRect(), 'bottom');
      };

      return (
        <div className="mx-5 mt-8 flex items-start gap-3 border-b border-border-hard pb-5">
          <div className="flex-shrink-0">
            <AvatarStack members={otherMembers} origin={viewer.origin} size={44} border="chat" iconUrl={dm.icon} />
          </div>
          <div className="min-w-0">
          <h3 className="text-title font-semibold leading-tight text-txt-primary">{groupName}</h3>
          <p className="text-txt-secondary text-ui mt-1">
            {t('chat:list.welcome.group.intro')}
          </p>
          <p className="text-meta text-txt-tertiary mt-1">
            <Trans
              t={t}
              i18nKey="chat:list.welcome.group.owner"
              values={{ name: ownerName }}
              components={{
                owner: ownerMember ? (
                  <button
                    type="button"
                    onClick={handleOwnerClick}
                    className="font-semibold text-txt-secondary hover:text-txt-primary hover:underline transition-colors"
                  />
                ) : (
                  <strong />
                ),
              }}
            />
          </p>
          {hasFederated && (
            <p className="text-meta text-txt-tertiary mt-1">
              {t('chat:list.welcome.group.federatedNotice')}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleOpenSettings}
              className="btn-outline"
            >
              {t('chat:list.welcome.group.openSettings')}
            </button>
            <button
              onClick={handleLeaveGroup}
              className="btn-quiet"
            >
              {t('chat:list.welcome.group.leave')}
            </button>
          </div>
          </div>
        </div>
      );
    }

    // 1-on-1 DM welcome header
    const otherUser = otherMembers[0];
    const { baseName } = parseFederatedUsername(otherUser?.username ?? '');
    const displayName = otherUser?.displayName ?? (baseName || t('chat:list.welcome.dm.fallbackName'));
    const mentionName = otherUser?.displayName ?? baseName;
    // The same person (`userKey`), whichever instance's row each list holds.
    const friend = otherUser
      ? friends.find(f => userKey(f, f._instanceOrigin) === userKey(otherUser, viewer.origin))
      : undefined;
    const isFriend = !!friend;

    return (
      <div className="mx-5 mt-8 flex items-start gap-3 border-b border-border-hard pb-5">
        <div className="flex-shrink-0">
          <ProfileAvatar src={otherUser?.avatar} name={displayName} size={44} user={otherUser ?? undefined} origin={viewer.origin} />
        </div>
        <div className="min-w-0">
        <h3 className="text-title font-semibold leading-tight text-txt-primary">{displayName}</h3>
        <p className="text-txt-secondary text-ui mt-1">
          <Trans
            t={t}
            i18nKey="chat:list.welcome.dm.intro"
            values={{ name: mentionName }}
            components={{ strong: <strong /> }}
          />
        </p>
        {otherUser?.homeInstance && (
          <p className="text-meta text-txt-tertiary mt-1">
            {t('chat:list.welcome.dm.federatedNotice')}
          </p>
        )}
        {isFriend && otherUser && (
          <div className="mt-3">
            <button
              onClick={() => friend && removeFriend(friend, friend._instanceOrigin)}
              className="btn-outline"
            >
              {t('chat:list.welcome.dm.removeFriend')}
            </button>
          </div>
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-5 mt-8 flex items-start gap-3 border-b border-border-hard pb-5">
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border border-border-soft text-txt-tertiary">
        <ChannelIcon type={channelType} icon={channelIcon} size={22} />
      </div>
      <div className="min-w-0">
        <h3 className="text-title font-semibold leading-tight text-txt-primary">{t('chat:list.welcome.channel.title')}</h3>
        <p className="text-txt-secondary text-ui mt-1">{t('chat:list.welcome.channel.description')}</p>
      </div>
    </div>
  );
}
