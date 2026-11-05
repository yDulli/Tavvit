import { cardImageIds, cardsSummary } from '@backspace/shared/src/cards';
import { MessageCards } from './MessageCards';
import { matchesKeyword } from '@backspace/shared/src/notificationRules';
import { useKeywordStore } from '../../stores/keywordStore';
import { savedKey, useSavedStore } from '../../stores/savedStore';
import { useTranslationStore } from '../../stores/translationStore';
import { MessageTranslation } from './MessageTranslation';
import { reminderMoment, type ReminderPreset } from '../../utils/reminderTimes';
import { isStickerMessage } from '../../utils/stickerMessages';
import { StickerMessage } from './StickerMessage';
import { useAuthorMenu } from './useAuthorMenu';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatters, useFormatters } from '../../i18n/formatters';
import type { MessageWithUser, Embed, Reaction, User } from '@backspace/shared';
import { MarkdownRenderer } from './MarkdownRenderer';
import { InlineMessageText } from './InlineMessageText';
import { Avatar } from '../ui/Avatar';
import { ProfileAvatar } from '../ui/ProfileAvatar';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { menuPositionFor, useContextMenuStore } from '../../stores/contextMenuStore';
import { buildMessageMenuItems } from './messageMenuItems';
import { ExternalImage } from '../ui/ExternalMedia';
import { useAuthStore, useSelfIdentity } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useMessageSelection } from '../../stores/messageSelectionStore';
import { getApiForOrigin, selectMyRoleIdsInChannel, useSpaceStore } from '../../stores/spaceStore';
import { describeError } from '../../i18n/errors';
import { useUIStore } from '../../stores/uiStore';
import { AttachmentList, AttachmentRenderer, attUrlOf } from './AttachmentRenderer';
import { AttachmentProgress } from './AttachmentProgress';
import { EmbedRenderer } from './EmbedRenderer';
import { FederationGlobeIcon } from '../ui/Username';
import { Tooltip } from '../ui/Tooltip';
import { EmojiPicker } from './EmojiPicker';
import { toWireText } from '../../utils/emojiWire';
import { MessageEditBox } from './MessageEditBox';
import { ThreadChip } from './ThreadChip';
import { openThreadView } from '../../utils/openThread';
import { PollCard } from './PollCard';
import { MobilePickerSheet } from './MobilePickerSheet';
import { ReactionPickerPopover } from './ReactionPickerPopover';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { isDeletedPartnerDm } from '../../utils/dmFormatters';
import { isFederationGlobeApplicable, isMine, spaceMemberName } from '../../utils/identity';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { useSelfIdInChannel } from '../../utils/channelUser';
import { mentionsReader } from '../../utils/notificationFilters';
import {
  isPendingMessage,
  usePendingMessageStore,
  type PendingMessageView,
  type PendingAttachmentView,
} from '../../stores/pendingMessageStore';
import { useTransferStore } from '../../stores/transferStore';
import { useMessageJump } from './messageJumpContext';
import { ReactionPill } from './ReactionPill';
import { memberNameStyle } from '../../utils/memberGroups';
import { resolveAssetUrl } from '../../utils/assetUrls';
import { Icon } from '../ui/Icon';
import { channelTakesThreads } from '../../utils/channelKinds';

interface MessageProps {
  message: MessageWithUser | PendingMessageView;
  isCompact: boolean;
  isFirstInGroup: boolean;
  previousMessageId: string | null;
}

interface PendingAttachmentTileProps {
  transferId: string;
}

function PendingAttachmentTile({ transferId }: PendingAttachmentTileProps) {
  const transfer = useTransferStore((s) => s.transfers.get(transferId));
  const pauseUpload = useTransferStore((s) => s.pauseUpload);
  const resumeUpload = useTransferStore((s) => s.resumeUpload);
  const abortUpload = useTransferStore((s) => s.abortUpload);
  if (!transfer) {
    return <div className="surface-card h-[104px] w-[168px] rounded-lg" />;
  }
  return (
    <div className="surface-card relative h-[104px] w-[168px] overflow-hidden rounded-lg">
      <AttachmentProgress
        loaded={transfer.progress.loaded}
        total={transfer.progress.total}
        state={transfer.state}
        filename={transfer.file.name}
        error={transfer.error?.message}
        onPause={transfer.state === 'active' ? () => pauseUpload(transfer.id) : undefined}
        onResume={transfer.state === 'paused' ? () => resumeUpload(transfer.id) : undefined}
        onAbort={() => abortUpload(transfer.id)}
        size="tile"
      />
    </div>
  );
}

/**
 * A person's name in a message row (author, reply preview): the name as
 * plain text, followed by the federation globe exactly when the person is
 * from another instance (`isFederationGlobeApplicable`), with the full
 * username as its tooltip. The same rule as the DM list and header.
 */
function PersonName({ name, person, className, style }: {
  name: string;
  person: Pick<User, 'username'>;
  className: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-0.5 ${className}`} style={style}>
      <span className="min-w-0 truncate">{name}</span>
      {isFederationGlobeApplicable(person) && (
        <Tooltip content={person.username} position="top">
          <FederationGlobeIcon />
        </Tooltip>
      )}
    </span>
  );
}

function formatMessageTimestamp(t: TFunction<['chat', 'common']>, fmt: typeof formatters, timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = fmt.formatTime(timestamp);

  if (isToday) return t('common:time.today', { time });
  if (isYesterday) return t('common:time.yesterday', { time });
  return fmt.formatDateTime(timestamp);
}

function formatHoverTime(timestamp: number): string {
  return formatters.formatTime(timestamp);
}

const GIF_URL_REGEX = /^https:\/\/(?:media\.tenor\.com|static\.klipy\.com)\/.+$/;

function isGifOnlyMessage(content: string | null): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  return GIF_URL_REGEX.test(trimmed);
}

/**
 * Returns the original posted URL when a message is a single URL that resolved
 * to an image embed, or null if the message should render normally.
 */
function getImageEmbedSourceUrl(content: string | null, embeds: Embed[]): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  // Must be a single URL with no surrounding text
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;
  if (/\s/.test(trimmed)) return null;
  // Must have at least one image embed whose URL matches the posted content
  const hasMatchingImageEmbed = embeds.some(
    (e) => e.embedType === 'image' && e.url === trimmed
  );
  return hasMatchingImageEmbed ? trimmed : null;
}

/** How far the hover bar rises above its row (`-top-4`), and a little to spare. */
const TOOLBAR_OVERHANG_PX = 20;

/** A row mounting this soon after its message's time has just arrived. */
const JUST_ARRIVED_MS = 4000;

/** The name of someone with no role colour (and of everyone in a DM). */
const AUTHOR_DEFAULT_COLOR: React.CSSProperties = { color: 'rgb(var(--text-primary))' };

export function Message({ message, isCompact, isFirstInGroup, previousMessageId }: MessageProps) {
  const { t } = useTranslation(['chat', 'common']);
  const fmt = useFormatters();
  const [isHovered, setIsHovered] = useState(false);
  // The hover bar hangs over the row above; a row at the very top of the list
  // has nothing above it to hang over, and the bar would be cut in half.
  const [toolbarInside, setToolbarInside] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The reaction picker, and what opened it: the "+" of the hover bar, or the
  // message menu ('row'). On desktop it hangs off that button or the message
  // row; on mobile it is a bottom sheet whatever opened it.
  const [reactionPicker, setReactionPicker] = useState<'button' | 'row' | null>(null);
  const showReactionPicker = reactionPicker !== null;
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout>>();
  const reactionPickerBtnRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const currentUser = useAuthStore((s) => s.user);
  const editMessage = useChatStore((s) => s.editMessage);
  const editingMessageId = useChatStore((s) => s.editingMessageId);
  const setEditingMessage = useChatStore((s) => s.setEditingMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const members = useSpaceStore((s) => s.members);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const isMobile = useUIStore((s) => s.isMobile);
  const jumpToMessage = useMessageJump();

  const pending = isPendingMessage(message) ? message.__pending : null;
  // Decided once, on the first render: a row that mounts this close to its message's
  // time has just arrived, not come into view. What is there when the row mounts is
  // not new either, so only a reaction added later gives its small jump.
  const [justArrived] = useState(() => Date.now() - message.createdAt < JUST_ARRIVED_MS);
  const [reactionsAtStart] = useState(() => new Set((message.reactions ?? []).map((reaction) => reaction.emoji)));
  const showInteractions = !pending;
  const isEditing = !pending && editingMessageId === message.id;

  const transfersForRow = useTransferStore((s) => s.transfers);
  const inMemoryFiles = useTransferStore((s) => s.hasInMemoryFile);
  const anyTransferTerminallyBad = !!pending && pending.transferIds.some((tid) => {
    const t = transfersForRow.get(tid);
    return t && (t.state === 'failed' || t.state === 'aborted');
  });
  const showRetryDiscardRow = pending?.state === 'failed' || anyTransferTerminallyBad;
  // Retry is only feasible when we can re-source the bytes for every transfer in the
  // pending row — either the in-memory File ref still exists (same-session retry)
  // or a persisted FileSystemFileHandle can reacquire the bytes (Chrome/Edge drag-drop).
  // After a reload (or post-redeploy refresh) without a handle, both are gone, and
  // showing a Retry button that silently no-ops would strand the user. Hide it instead.
  const canRetry = !!pending && pending.transferIds.every((tid) => {
    const t = transfersForRow.get(tid);
    if (!t || t.type !== 'upload') return false;
    return inMemoryFiles.has(tid) || !!t.fileHandleId;
  });

  const channelKey: string = isPendingMessage(message)
    ? message.channelId || message.dmChannelId || ''
    : message.channelId || (message as MessageWithUser & { dmChannelId?: string }).dmChannelId || '';
  // The instance that issued this message and its rows.
  const messageOrigin = useSpaceStore((s) => s.channelOriginMap.get(channelKey) ?? '');
  const self = useSelfIdentity();
  const isAuthor = isMine(message.user, messageOrigin, self);
  // The channel whose origin issued this message's ids; mentions resolve there.
  const mentionChannelId = channelKey || null;
  const selfIdHere = useSelfIdInChannel(mentionChannelId);
  const messageStyle = useAppearanceStore((s) => s.messageStyle);
  const myRoleIdsHere = useSpaceStore((s) => (mentionChannelId ? selectMyRoleIdsInChannel(s, mentionChannelId) : undefined));
  const startEditing = () => {
    setEditingMessage(message.id);
  };
  const stopEditing = () => {
    setEditingMessage(null);
  };
  const channelPermissions = useSpaceStore((s) => s.channelPermissions);
  const myChPerms = channelPermissions.get(message.channelId);
  const isDmMessage = isPendingMessage(message)
    ? !!message.dmChannelId || !message.channelId
    : !!(message as MessageWithUser & { dmChannelId?: string }).dmChannelId || !message.channelId;
  const dmChannelId = isPendingMessage(message)
    ? message.dmChannelId
    : (message as MessageWithUser & { dmChannelId?: string }).dmChannelId;
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  // Read-only enforcement (client mirror of the server guard): a dead 1-on-1 DM
  // (partner tombstoned) accepts no reaction mutations. Existing reactions still
  // DISPLAY, but the add/toggle affordances are withdrawn since the server drops them.
  const isDeadDmThread = !!dmChannelId && (() => {
    const dm = dmChannels.find(d => d.id === dmChannelId);
    return dm ? isDeletedPartnerDm(dm, { self, origin: messageOrigin }) : false;
  })();
  const canManageMessages = hasPermissionBit(myChPerms, PermissionBits.MANAGE_MESSAGES);
  const canSendMessages = isDmMessage || hasPermissionBit(myChPerms, PermissionBits.SEND_MESSAGES);
  // A webhook or a followed channel writes here: there is no person behind the name to open.
  const writesForChannel = message.user?.accountKind === 'webhook' || message.user?.accountKind === 'follow';
  const canDelete = isAuthor || canManageMessages;
  const channelType = useSpaceStore((s) => s.spaceChannelIndex.get(channelKey)?.type);
  const canThread = !isPendingMessage(message) && !isDmMessage && channelTakesThreads(channelType)
    && (message.thread !== undefined || hasPermissionBit(myChPerms, PermissionBits.CREATE_THREADS));
  const openOrStartThread = async () => {
    if (isPendingMessage(message)) return;
    try {
      const id = message.thread?.id ?? (await getApiForOrigin(messageOrigin).threads.start(message.id)).id;
      openThreadView(id, message.channelId);
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    }
  };
  const selecting = useMessageSelection((s) => s.channelId !== null && s.channelId === channelKey);
  const selected = useMessageSelection((s) => s.channelId === channelKey && s.ids.has(message.id));
  const canPin = isDmMessage
    ? !isDeadDmThread
    : canManageMessages || hasPermissionBit(myChPerms, PermissionBits.PIN_MESSAGES);
  const togglePin = async () => {
    const client = getApiForOrigin(messageOrigin);
    const pinned = message.pinnedAt != null;
    try {
      if (isDmMessage) await (pinned ? client.dm.unpinMessage(message.id) : client.dm.pinMessage(message.id));
      else await (pinned ? client.messages.unpin(message.id) : client.messages.pin(message.id));
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    }
  };
  const canAddReactions = (isDmMessage || hasPermissionBit(myChPerms, PermissionBits.ADD_REACTIONS)) && !isDeadDmThread;

  const addReaction = useChatStore((s) => s.addReaction);
  const removeReaction = useChatStore((s) => s.removeReaction);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const markUnread = useChatStore((s) => s.markUnread);

  // The reply belongs to the channel this message is in; its composer shows it.
  const startReply = (): void => {
    if (channelKey) setReplyTo(channelKey, message);
  };

  const _FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;
  const _rawMsgUser = message.user ?? null;
  const _canonicalMsgUser = useCanonicalUserView(_rawMsgUser ?? _FALLBACK_USER, messageOrigin);
  const _rawReplyUser = (!isPendingMessage(message) && message.replyTo?.user) ? message.replyTo.user : null;
  const _canonicalReplyUser = useCanonicalUserView(_rawReplyUser ?? _FALLBACK_USER, messageOrigin);

  const toggleReaction = (emoji: string) => {
    // Read-only: a dead 1-on-1 DM accepts no reaction mutations (add OR remove).
    if (isDeadDmThread) return;
    // Read from the store at call time: the context menu keeps the handlers
    // of the render that opened it, whose `message` is older than a reaction
    // added since. Only stored reactions count, the ones the pills show: a
    // tap during an add's round trip is an add, which addReaction does not
    // send a second time.
    const hasReacted = useChatStore.getState().hasOwnReaction(message.id, emoji);
    if (hasReacted) {
      removeReaction(message.id, emoji);
    } else if (canAddReactions) {
      addReaction(message.id, emoji);
    }
  };

  // Reactions grouped by emoji, in the order each emoji first appeared.
  const reactionGroups = new Map<string, Reaction[]>();
  for (const r of message.reactions || []) {
    const group = reactionGroups.get(r.emoji);
    if (group) group.push(r);
    else reactionGroups.set(r.emoji, [r]);
  }

  // Auto-cancel delete confirmation after timeout
  const startDeleteConfirm = useCallback(() => {
    setConfirmingDelete(true);
    clearTimeout(confirmDeleteTimeout.current);
    confirmDeleteTimeout.current = setTimeout(() => setConfirmingDelete(false), 3000);
  }, []);

  const cancelDeleteConfirm = useCallback(() => {
    setConfirmingDelete(false);
    clearTimeout(confirmDeleteTimeout.current);
  }, []);

  useEffect(() => {
    return () => clearTimeout(confirmDeleteTimeout.current);
  }, []);

  const isGifOnly = isGifOnlyMessage(message.content);
  // A sticker draws its own image: no edit (its content is a token, not
  // text), and no embed (an older instance unfurls the asset URL into one).
  const isSticker = isStickerMessage(message.content);
  // What a bot or a webhook showed besides text. When it wrote none, the content only stands for them
  // where words are all that fit (shared/src/cards.ts), and here it would say the same thing twice.
  const cards = (message as MessageWithUser).cards;
  const showsOnlyCards = cards !== undefined && message.content === cardsSummary(cards);
  const imagesInCards = cardImageIds(cards);
  const persistedAttachments = (message as MessageWithUser).attachments ?? [];
  const canEdit = isAuthor && !isSticker;
  const imageEmbedSourceUrl = isGifOnly ? null : getImageEmbedSourceUrl(message.content, message.embeds || []);
  // sourceUrl: the original URL for context menu Copy/Open Link actions
  const sourceUrl = isGifOnly
    ? (message.content?.trim() ?? null)
    : imageEmbedSourceUrl;

  const closeReactionPicker = useCallback(() => setReactionPicker(null), []);

  const handleReactionEmojiSelect = useCallback((emoji: { native: string }) => {
    addReaction(message.id, emoji.native);
    setReactionPicker(null);
  }, [addReaction, message.id]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (pending) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // A right click in the edit box is about its text: the app-wide menu
    // (globalContextMenu.ts) offers cut, copy and paste there.
    if ((e.target as HTMLElement).closest('textarea, input, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    const selectedText = window.getSelection()?.toString() ?? '';

    // Detect if the right-click target is a content image (not an avatar or embed thumbnail)
    const imgEl = (e.target as HTMLElement).closest('img') as HTMLImageElement | null;
    const isContentImage = imgEl && !imgEl.closest('[data-avatar]') && !imgEl.closest('[data-embed-thumbnail]');
    const imageUrl = isContentImage ? imgEl.src : null;
    // Attachment previews may be thumbnails; collection always uses the original source.
    const stickerSource = isContentImage ? imgEl.dataset.stickerSource : null;
    // An attachment's alt is its file name; the collection keeps it without the extension.
    const stickerName = isContentImage ? imgEl.alt.replace(/\.[^.]+$/, '').slice(0, 100) : undefined;

    // Detect right-click on a video/audio element and resolve its underlying attachment.
    // `message` is the persisted form here — pending messages return early above.
    const persistedAttachments = (message as MessageWithUser).attachments ?? [];
    const videoEl = (e.target as HTMLElement).closest('video') as HTMLVideoElement | null;
    const audioEl = (e.target as HTMLElement).closest('audio') as HTMLAudioElement | null;
    const matchAttByUrl = (mediaSrc: string, kind: 'video' | 'audio') => {
      // currentSrc is absolute; attUrlOf may be relative — compare via URL parse.
      let mediaPath: string;
      try {
        mediaPath = new URL(mediaSrc, window.location.origin).pathname;
      } catch { mediaPath = mediaSrc; }
      return persistedAttachments.find((att) => {
        if (!att.mimetype.startsWith(`${kind}/`)) return false;
        const attRaw = attUrlOf(att.filename);
        let attPath: string;
        try { attPath = new URL(attRaw, window.location.origin).pathname; } catch { attPath = attRaw; }
        return attPath === mediaPath;
      }) ?? null;
    };
    const videoAtt = videoEl?.currentSrc ? matchAttByUrl(videoEl.currentSrc, 'video') : null;
    const audioAtt = audioEl?.currentSrc ? matchAttByUrl(audioEl.currentSrc, 'audio') : null;

    const items = buildMessageMenuItems({
      message,
      selectedText,
      previousMessageId,
      imageUrl,
      stickerSource,
      stickerName,
      sourceUrl,
      videoUrl: videoAtt ? attUrlOf(videoAtt.filename) : null,
      videoFilename: videoAtt ? videoAtt.originalName : null,
      videoSize: videoAtt ? videoAtt.size : null,
      audioUrl: audioAtt ? attUrlOf(audioAtt.filename) : null,
      audioFilename: audioAtt ? audioAtt.originalName : null,
      audioSize: audioAtt ? audioAtt.size : null,
      isAuthor,
      isDm: isDmMessage,
      canAddReactions,
      canSendMessages,
      canManageMessages,
      onReply: startReply,
      onEdit: startEditing,
      onTogglePin: canPin && !isPendingMessage(message) ? () => void togglePin() : undefined,
      onThread: canThread ? () => void openOrStartThread() : undefined,
      isSaved: useSavedStore.getState().ids.has(savedKey(messageOrigin, message.id)),
      onToggleSaved: isPendingMessage(message) || message.type === 'system' ? undefined : () => void toggleSaved(),
      onRemind: isPendingMessage(message) || message.type === 'system' ? undefined : (preset) => void remindAbout(preset),
      isTranslated: useTranslationStore.getState().entries[message.id] !== undefined,
      onTranslate: isPendingMessage(message) || message.poll || message.type === 'system' || showsOnlyCards ? undefined : () => {
        const translations = useTranslationStore.getState();
        if (translations.entries[message.id]) translations.hide(message.id);
        else void translations.translate(message.id, message.content ?? '', channelKey);
      },
      onForward: isPendingMessage(message) || message.poll ? undefined : () => useUIStore.getState().openModal('forwardMessage', {
        target: { messageId: message.id, isDm: isDmMessage, origin: messageOrigin },
      }),
      onSelect: canManageMessages && !isDmMessage && !isPendingMessage(message)
        ? () => useMessageSelection.getState().start(channelKey, message.id)
        : undefined,
      onReport: isAuthor || isPendingMessage(message) ? undefined : () => useUIStore.getState().openModal('report', {
        target: { type: isDmMessage ? 'dm_message' : 'message', id: message.id, origin: messageOrigin, label: message.content?.slice(0, 200) ?? null },
      }),
      onDelete: () => deleteMessage(message.id, channelKey),
      onReaction: (emoji: string) => toggleReaction(emoji),
      onOpenEmojiPicker: () => {
        // Close the context menu, then show the reaction picker at the row
        useContextMenuStore.getState().close();
        setReactionPicker('row');
      },
      onMarkUnread: (msgId: string) => markUnread(channelKey, msgId),
    });

    if (items.length === 0) return;
    useContextMenuStore.getState().open(menuPositionFor(e), items);
  };

  const saveEdit = async (draft: string) => {
    await editMessage(message.id, toWireText(draft, channelKey), channelKey);
    setEditingMessage(null);
  };

  // Display identity: the user's own messages, from any instance, show their
  // session row; anyone else's go through the userViews cache so a stale copy
  // shows the best-known profile. `displayOrigin` issued the row shown.
  const displayIdentity = isAuthor && currentUser
    ? currentUser
    : (_rawMsgUser ? _canonicalMsgUser : message.user);
  const displayOrigin = isAuthor && currentUser ? '' : messageOrigin;

  const spaces = useSpaceStore((s) => s.spaces);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const currentSpace = spaces.find(s => s.id === currentSpaceId);
  const ownerId = currentSpace?.ownerId;

  // The author's row in the space's roster: it gives the name colour and the
  // nickname. message.userId is the id on the space's instance, the id the
  // loaded member list carries. A DM has no roster.
  const spaceMemberOf = (userId: string) => (isDmMessage ? undefined : members.find(m => m.userId === userId));
  const displayName = spaceMemberName(spaceMemberOf(message.userId), displayIdentity);
  // The picture a member set for this space stands in for their account's;
  // it is a file on the space's instance.
  const spaceAvatarOf = (userId: string): string | null => {
    const avatar = spaceMemberOf(userId)?.avatar;
    return avatar ? resolveAssetUrl(avatar, currentSpace?._instanceOrigin ?? '') ?? null : null;
  };

  const getMemberDisplayColor = (userId: string): React.CSSProperties => {
    if (isDmMessage) return AUTHOR_DEFAULT_COLOR;
    const member = spaceMemberOf(userId);
    return memberNameStyle(member ?? { userId, roles: [] }, ownerId) ?? AUTHOR_DEFAULT_COLOR;
  };

  const roleColor = getMemberDisplayColor(message.userId);

  // A space message's author is a member of the space it was posted in; the
  // profile opened from it shows their roles there. message.userId is the id
  // on the space's instance, the same id the loaded member list carries.
  const authorMember = !isDmMessage && currentSpaceId
    ? { spaceId: currentSpaceId, userId: message.userId }
    : undefined;

  const savedKind = isDmMessage ? 'dm' : 'channel';
  const toggleSaved = async () => {
    const saved = useSavedStore.getState();
    try {
      if (saved.ids.has(savedKey(messageOrigin, message.id))) await saved.remove(messageOrigin, savedKind, message.id);
      else await saved.save(messageOrigin, savedKind, message.id);
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    }
  };
  const remindAbout = async (preset: ReminderPreset) => {
    const at = reminderMoment(preset);
    try {
      await useSavedStore.getState().save(messageOrigin, savedKind, message.id, at);
      useUIStore.getState().addToast(t('chat:menu.remindSet', { time: fmt.formatDateTime(at) }), 'success');
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    }
  };

  const handleAuthorMenu = useAuthorMenu({
    channelId: channelKey,
    authorId: message.userId,
    origin: messageOrigin,
    isDm: isDmMessage,
    canSend: canSendMessages && !isDeadDmThread && !pending && !writesForChannel,
    isAuthor,
  });

  const handleUsernameClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    // An account that is not a person has no profile to show.
    if (!message.user || writesForChannel) return;
    e.stopPropagation();
    openUserProfile(message.user, messageOrigin, e.currentTarget.getBoundingClientRect(), undefined, authorMember);
  };

  // The name is the author's keyboard stop (the avatar beside it opens the
  // same card and menu, so it stays out of the tab order): Enter and Space
  // open the profile card like a click, and the menu key or Shift+F10 open
  // the author menu like a right click.
  const handleUsernameKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleUsernameClick(e);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      handleAuthorMenu(e);
    }
  };

  const replyRoleColor = (msg: { userId: string }) => getMemberDisplayColor(msg.userId);

  // Mention highlighting, by the rule the alert uses (`messageMentions`): a
  // `<@id>` token for my id on the channel's origin, not my home id (#332),
  // or a mass mention the space's instance stamped that reaches me
  // (`@everyone`, `@here`, a role I hold there). Tokens inside code are not
  // mentions (the shared scan in utils/mentionTokens.ts). A pending message
  // has no stamps yet.
  const isOwnMessage = !!selfIdHere && message.userId === selfIdHere;
  // Rows put a small picture on the name's line; bubbles and the log keep a column for it.
  const avatarSize = messageStyle === 'rows' ? 20 : 28;
  const stamped = isPendingMessage(message) ? undefined : message;
  const keywords = useKeywordStore((s) => s.words);
  const isKeywordHit = useMemo(() => !isAuthor && matchesKeyword(message.content, keywords), [isAuthor, message.content, keywords]);
  const isMentioned = mentionsReader({
    myId: selfIdHere,
    myRoleIds: myRoleIdsHere,
    content: message.content,
    mentionEveryone: stamped?.mentionEveryone,
    mentionRoleIds: stamped?.mentionRoleIds,
  });

  const content = (
    <div
      ref={rowRef}
      id={`msg-${message.id}`}
      role="article"
      aria-label={t('chat:message.rowLabel', { author: displayName, time: formatMessageTimestamp(t, fmt, message.createdAt) })}
      data-own={isOwnMessage ? 'true' : 'false'}
      data-first={isFirstInGroup || message.replyTo ? 'true' : 'false'}
      data-mentioned={isMentioned || isKeywordHit ? 'true' : 'false'}
      data-selecting={selecting ? 'true' : undefined}
      data-picked={selected ? 'true' : undefined}
      onClickCapture={selecting ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        useMessageSelection.getState().toggle(message.id);
      } : undefined}
      // Mine came up when I sent it; the row the server's copy replaces it with stays put.
      className={`msg-row ${justArrived && (pending || !isOwnMessage) ? 'msg-new ' : ''}group relative flex gap-3 mx-2 px-3 rounded-md transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary/60 ${isFirstInGroup || message.replyTo ? 'msg-first' : ''}`}
      onMouseEnter={(e) => {
        const list = e.currentTarget.closest('.overflow-y-auto');
        setToolbarInside(!!list && e.currentTarget.getBoundingClientRect().top - list.getBoundingClientRect().top < TOOLBAR_OVERHANG_PX);
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (confirmingDelete) {
          clearTimeout(confirmDeleteTimeout.current);
          confirmDeleteTimeout.current = setTimeout(() => setConfirmingDelete(false), 2000);
        }
      }}
    >
      {message.pinnedAt != null && (
        <span className="pointer-events-none absolute right-3 top-1.5 text-txt-tertiary" title={t('chat:pins.pinned')}>
          <Icon name="pin" size={13} />
        </span>
      )}

      {selecting && (
        <span
          role="checkbox"
          aria-checked={selected}
          aria-label={t('chat:selection.pick')}
          className="msg-pick"
          data-picked={selected ? 'true' : undefined}
        >
          {selected && <Icon name="check" size={12} />}
        </span>
      )}

      {/* Reply Line */}
      {message.replyTo && (
        <div className="msg-reply-line absolute left-[27px] top-[-12px] w-[26px] h-[20px] border-l-2 border-t-2 border-interactive-muted rounded-tl-md opacity-60" />
      )}

      {/* Avatar or timestamp column */}
      <div className="msg-avatar flex-shrink-0 flex items-start justify-start">
        {isFirstInGroup || message.replyTo ? (
          <div className="relative" data-poke-user={message.userId} onContextMenu={handleAuthorMenu}>
            <ProfileAvatar
              src={spaceAvatarOf(message.userId) ?? displayIdentity.avatar}
              name={displayName}
              size={avatarSize}
              user={displayIdentity}
              origin={displayOrigin}
              member={authorMember}
              className="transition-transform active:translate-y-[1px]"
            />
          </div>
        ) : (
          <span className="msg-hover-time tabular font-mono text-label text-txt-tertiary opacity-0 group-hover:opacity-100 select-none w-full text-right whitespace-nowrap leading-[1.45rem]">
            {formatHoverTime(message.createdAt)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="msg-body flex-1 min-w-0">
        {message.replyTo && (() => {
          const replyTo = message.replyTo;
          const replyIdentity = isMine(replyTo.user, messageOrigin, self) && currentUser
            ? currentUser
            : (_rawReplyUser ? _canonicalReplyUser : replyTo.user);
          const replyDisplayName = spaceMemberName(spaceMemberOf(replyTo.userId), replyIdentity);
          const preview = (
            <>
              <Icon name="reply" size={12} className="msg-reply-icon flex-shrink-0 text-txt-tertiary" />
              <Avatar src={spaceAvatarOf(replyTo.userId) ?? replyIdentity.avatar} name={replyDisplayName} size={14} user={replyIdentity} />
              <PersonName
                name={replyDisplayName}
                person={replyIdentity}
                className="max-w-[60%] flex-shrink-0 text-meta font-medium text-txt-primary"
                style={replyRoleColor(replyTo)}
              />
              <span className="text-meta text-txt-tertiary truncate max-w-[480px] group-hover/reply:text-txt-secondary transition-colors">
                {replyTo.content ? <InlineMessageText content={replyTo.content} channelId={mentionChannelId} /> : ''}
              </span>
            </>
          );
          // Outside a message list (no jump handle) the preview stays inert.
          if (!jumpToMessage) {
            return <div className="msg-reply flex items-center gap-1.5 min-w-0 pl-1.5">{preview}</div>;
          }
          return (
            <button
              type="button"
              onClick={() => jumpToMessage(replyTo.id)}
              className="msg-reply group/reply flex items-center gap-1.5 max-w-full min-w-0 pl-1.5 pr-2 py-0.5 rounded-md text-left hover:bg-interactive-hover active:bg-interactive-active transition-colors duration-100 cursor-pointer"
            >
              <span className="sr-only">{t('chat:message.reply.jump')}</span>
              {preview}
            </button>
          );
        })()}

        {(isFirstInGroup || message.replyTo) && (
          <div className="msg-head flex items-baseline gap-2 mb-0.5">
            <span
              role={writesForChannel ? undefined : 'button'}
              tabIndex={writesForChannel ? undefined : 0}
              className="msg-name flex min-w-0 rounded-sm"
              onClick={handleUsernameClick}
              onContextMenu={handleAuthorMenu}
              onKeyDown={handleUsernameKeyDown}
            >
              <PersonName
                name={displayName}
                person={displayIdentity}
                className={`font-medium text-body leading-tight ${writesForChannel ? '' : 'cursor-pointer hover:underline'}`}
                style={roleColor}
              />
            </span>
            {message.user?.accountKind && (
              <span className="label-mono flex-shrink-0 self-center rounded-sm border border-border-soft px-1 leading-none">
                {message.user.accountKind === 'webhook' ? t('chat:message.webhookTag') : message.user.accountKind === 'follow' ? t('chat:message.followTag') : t('chat:message.botTag')}
              </span>
            )}
            {/* The day is in the divider above; the line carries the time, the whole date is its tooltip. */}
            <time
              className="msg-time tabular flex-shrink-0 whitespace-nowrap font-mono text-label text-txt-tertiary leading-tight hover:cursor-default"
              dateTime={new Date(message.createdAt).toISOString()}
              title={formatMessageTimestamp(t, fmt, message.createdAt)}
            >
              {fmt.formatTime(message.createdAt)}
            </time>
          </div>
        )}

        {isEditing ? (
          <MessageEditBox channelId={channelKey} content={message.content ?? ''} onSave={saveEdit} onCancel={stopEditing} />
        ) : (
          <div className="msg-content flex flex-col gap-1.5">
            {isGifOnly ? (
              <div className="max-w-[400px]">
                <ExternalImage
                  src={message.content!.trim()}
                  alt={t('chat:message.gifAlt')}
                  className="max-w-full max-h-[300px] rounded-lg"
                  loading="lazy"
                />
              </div>
            ) : imageEmbedSourceUrl ? (
              <>
                {/* URL text suppressed — embeds render the image */}
                {message.embeds && message.embeds.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {message.embeds.map((embed) => (
                      <EmbedRenderer key={embed.id} embed={embed} />
                    ))}
                  </div>
                )}
                {message.editedAt && (
                  <span className="text-label text-txt-tertiary select-none">{t('chat:message.edited')}</span>
                )}
              </>
            ) : (
              <>
                {message.forwarded && (
                  <span className="mb-0.5 flex items-center gap-1 text-label text-txt-tertiary select-none">
                    <Icon name="forward" size={12} />
                    {t('chat:forward.mark')}
                  </span>
                )}
                {!isPendingMessage(message) && message.poll && <PollCard message={message} canEnd={isAuthor || canManageMessages} />}
                {message.content && !showsOnlyCards && !('poll' in message && message.poll) && (
                  <div
                    data-edited={message.editedAt ? 'true' : undefined}
                    className="message-text text-txt-message leading-[1.5] break-words whitespace-pre-wrap selection:bg-accent-primary/30"
                  >
                    {isSticker
                      ? <StickerMessage token={message.content} />
                      : <MarkdownRenderer content={message.content} channelId={mentionChannelId} />}
                    {message.editedAt && (
                      <span className="text-label text-txt-tertiary ml-1.5 select-none">{t('chat:message.edited')}</span>
                    )}
                  </div>
                )}
                {message.content && !isSticker && <MessageTranslation messageId={message.id} content={message.content} channelId={mentionChannelId} />}

                {/* Embeds */}
                {!isEditing && !isSticker && message.embeds && message.embeds.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {message.embeds.map((embed) => (
                      <EmbedRenderer key={embed.id} embed={embed} />
                    ))}
                  </div>
                )}
              </>
            )}

            {cards && cards.length > 0 && <MessageCards cards={cards} attachments={persistedAttachments} channelId={mentionChannelId} />}

            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (pending
              ? (
                <div className="flex flex-wrap gap-1.5">
                  {message.attachments.map((att) => {
                    const transferId = (att as PendingAttachmentView).__transferId;
                    return transferId
                      ? <PendingAttachmentTile key={att.id} transferId={transferId} />
                      : <AttachmentRenderer key={att.id} attachment={att} />;
                  })}
                </div>
              )
              : <AttachmentList attachments={imagesInCards.size > 0 ? message.attachments.filter((attachment) => !imagesInCards.has(attachment.id)) : message.attachments} />
            )}

            {/* Failed-state retry/discard row */}
            {showRetryDiscardRow && pending && (
              <div className="inline-flex items-center self-start gap-1.5 rounded-lg border border-accent-rose/25 bg-accent-rose/10 py-1 pl-2.5 pr-1">
                <span className="flex items-center gap-1.5 pr-1 text-meta font-medium text-txt-danger">
                  <Icon name="alert" size={14} />
                  {t('chat:message.upload.failed')}
                </span>
                {canRetry && (
                  <button
                    onClick={async () => {
                      const transfers = useTransferStore.getState().transfers;
                      const retryIds = pending.transferIds.filter((tid) => {
                        const s = transfers.get(tid)?.state;
                        return s === 'failed' || s === 'aborted';
                      });
                      // Flip the bubble back to 'sending' first so the orchestrator
                      // re-evaluates after the resumed transfers complete.
                      usePendingMessageStore.getState().markSending(pending.clientId);
                      for (const tid of retryIds) {
                        await useTransferStore.getState().resumeUpload(tid);
                      }
                    }}
                    className="btn-outline btn-sm h-6"
                  >
                    {t('common:actions.retry')}
                  </button>
                )}
                <button
                  onClick={() => {
                    const transfers = useTransferStore.getState().transfers;
                    for (const tid of pending.transferIds) {
                      const t = transfers.get(tid);
                      if (!t) continue;
                      // Route anything with potential server-side state (active/paused/
                      // queued/failed) through abortUpload — it sends DELETE so the
                      // .tus session doesn't sit on disk for the janitor to sweep.
                      // 'aborted' already cleaned itself; 'completed' has a finalized
                      // attachment row that the unlinked-attachment janitor handles (1h grace).
                      if (t.state !== 'aborted' && t.state !== 'completed') {
                        useTransferStore.getState().abortUpload(tid);
                      }
                      useTransferStore.getState().remove(tid);
                    }
                    if (channelKey) {
                      usePendingMessageStore.getState().removeByClientId(channelKey, pending.clientId);
                    }
                  }}
                  className="btn-quiet btn-sm h-6"
                >
                  {t('chat:message.upload.discard')}
                </button>
              </div>
            )}

            {!isPendingMessage(message) && message.thread && (
              <ThreadChip thread={message.thread} parentChannelId={message.channelId} />
            )}
            {/* Reactions */}
            {showInteractions && reactionGroups.size > 0 && (
              <div className="flex flex-wrap gap-1">
                {[...reactionGroups].map(([emoji, reactions]) => (
                  <ReactionPill
                    key={emoji}
                    emoji={emoji}
                    reactions={reactions}
                    origin={messageOrigin}
                    added={!reactionsAtStart.has(emoji)}
                    onToggle={() => toggleReaction(emoji)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reactions retain the upstream mobile sheet and row/button anchor semantics. */}
      {showInteractions && reactionPicker && canAddReactions && isMobile && (
        <MobilePickerSheet onClose={closeReactionPicker} label={t('common:actions.addReaction')}>
          <EmojiPicker onEmojiSelect={handleReactionEmojiSelect} customAs="reaction" mobile />
        </MobilePickerSheet>
      )}
      {showInteractions && reactionPicker && canAddReactions && !isMobile && (
        <ReactionPickerPopover
          anchorEl={reactionPicker === 'button' ? reactionPickerBtnRef.current : rowRef.current}
          onEmojiSelect={handleReactionEmojiSelect}
          onClose={closeReactionPicker}
        />
      )}

      {/* Action buttons on hover */}
      {showInteractions && !selecting && (isHovered || reactionPicker === 'button' || confirmingDelete) && !isEditing && (
        <div className={`msg-toolbar absolute right-3 z-10 flex h-8 w-max items-center gap-px rounded-md p-0.5 glass ${toolbarInside ? 'top-1' : '-top-4'}`}>
          <time className="tabular px-1.5 font-mono text-label text-txt-tertiary" dateTime={new Date(message.createdAt).toISOString()}>
            {formatHoverTime(message.createdAt)}
          </time>
          {canAddReactions && (
            <div className="flex h-full items-center gap-px border-r border-border-soft pr-0.5 mr-0.5">
              {['👍', '❤️', '😂', '😮'].map(emoji => (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(emoji)}
                  aria-label={t('chat:message.actions.reactWith', { emoji })}
                  data-tooltip=""
                  className="h-7 w-7 rounded-md text-lead leading-none transition-colors duration-100 hover:bg-interactive-hover active:bg-interactive-active"
                >
                  {emoji}
                </button>
              ))}
              <button
                ref={reactionPickerBtnRef}
                onClick={() => setReactionPicker((v) => (v ? null : 'button'))}
                data-active={showReactionPicker ? 'true' : undefined}
                className="icon-btn"
                aria-label={t('common:actions.addReaction')}
              >
                <Icon name="smile" size={16} />
              </button>
            </div>
          )}
          <button
            onClick={startReply}
            className="icon-btn"
            aria-label={t('common:actions.reply')}
          >
            <Icon name="reply" size={16} />
          </button>
          {canThread && (
            <button
              type="button"
              onClick={() => void openOrStartThread()}
              className="icon-btn"
              aria-label={!isPendingMessage(message) && message.thread ? t('chat:menu.openThread') : t('chat:menu.startThread')}
            >
              <Icon name="thread" size={16} />
            </button>
          )}
          {canEdit && (
            <button
              onClick={startEditing}
              className="icon-btn"
              aria-label={t('common:actions.edit')}
            >
              <Icon name="edit" size={16} />
            </button>
          )}
          {canDelete && (
            <button
              data-tooltip=""
              onClick={() => {
                if (confirmingDelete) {
                  cancelDeleteConfirm();
                  deleteMessage(message.id, channelKey);
                } else {
                  startDeleteConfirm();
                }
              }}
              className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 ${
                confirmingDelete
                  ? 'bg-accent-rose/20 text-txt-danger'
                  : 'text-txt-tertiary hover:text-txt-danger hover:bg-interactive-hover active:bg-interactive-active'
              }`}
              aria-label={confirmingDelete ? t('chat:message.actions.confirmDelete') : t('common:actions.delete')}
            >
              <Icon
                name="trash"
                size={16}
                className={`absolute transition-all duration-150 ${confirmingDelete ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}
              />
              <Icon
                name="check"
                size={16}
                className={`absolute transition-all duration-150 ${confirmingDelete ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`}
              />
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div data-context-menu onContextMenu={handleContextMenu}>
      {content}
    </div>
  );
}
