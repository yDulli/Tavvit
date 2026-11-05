import { parseCommandText, type ChannelCommand, type CommandOptionValue } from '@backspace/shared/src/bots';
import { CommandOptionsForm } from './CommandOptionsForm';
import { CommandPopover } from './CommandPopover';
import { CommandReplies } from './CommandReplies';
import { VoiceRecorderBar } from './VoiceRecorderBar';
import { voiceRecordingSupported, type VoiceRecording } from '../../utils/voiceRecorder';
import { useMentionComposer } from './useMentionComposer';
import { useComposerMention } from './useComposerMention';
import { MentionTextarea } from './MentionTextarea';
import { layoutRect } from '../../platform/interfaceScale';
import React, { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chatStore';
import { isDmChannel, useIsDmChannel, getApiForOrigin, getChannelOrigin, useSpaceStore } from '../../stores/spaceStore';
import { wsSend } from '../../hooks/useWebSocket';
import { MentionPopover } from './MentionPopover';
import { TypingIndicator } from './TypingIndicator';
import { InputPopover, type InputPopoverTab } from './InputPopover';
import { StagedTransferTiles } from './StagedTransferTiles';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { MAX_MESSAGE_LENGTH, type User } from '@backspace/shared';
import { toWireText } from '../../utils/emojiWire';
import { useEmojiContextOfChannel } from '../../utils/emojiSets';
import { useEmojiStore } from '../../stores/emojiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useComposerStore } from '../../stores/composerStore';
import { useTransferStore, type Transfer } from '../../stores/transferStore';
import { usePendingMessageStore } from '../../stores/pendingMessageStore';
import { putHandle, supportsFsHandles, supportsDnDHandles } from '../../utils/idbHandles';
import { useVisualViewportInset } from '../../hooks/useVisualViewportInset';
import { useAuthStore } from '../../stores/authStore';
import { selfIdentityOf, spaceMemberName } from '../../utils/identity';
import { useChannelUser } from '../../utils/channelUser';
import { findLastOwnEditableMessage } from './messageEditing';
import { describeError, describeCodedError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { Icon } from '../ui/Icon';
import { useComposerModeration } from './composerModeration';

interface MessageInputProps {
  channelId: string;
  channelName: string;
  /**
   * Optional override for the textarea placeholder. When omitted the
   * placeholder is derived from `channelName` (`'Message @user'` for DMs,
   * `'Message #channel'` otherwise). DM call sites pass the resolved
   * placeholder directly so they can collapse the unreadable joined-names
   * form ("Message #Alice, Bob, Charlie, Dave") to "Message the group"
   * when the group has no `dm.name` set.
   */
  placeholder?: string;
}

// Default tus expiration window if a transfer doesn't yet have one (24h).
const DEFAULT_TUS_TTL_MS = 24 * 60 * 60 * 1000;

function makeFileHandleKey(): string {
  return `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Who is being answered, by the name their message shows: the space nickname where there is one. */
function ReplyTargetName({ channelId, author }: { channelId: string; author: User }) {
  const resolved = useChannelUser(channelId, author.id);
  return (
    <span className="min-w-0 truncate font-medium text-txt-primary">
      {resolved ? spaceMemberName(resolved.member, resolved.user) : (author.displayName ?? author.username)}
    </span>
  );
}

export function MessageInput({ channelId, channelName, placeholder }: MessageInputProps) {
  const { t } = useTranslation(['chat', 'common']);
  // Composer state lives in composerStore (per-channel, persisted)
  const composerState = useComposerStore((s) => s.states.get(channelId)) ?? {
    draftText: '',
    replyTo: null,
    stagedTransferIds: [] as string[],
  };
  const setDraft = useComposerStore((s) => s.setDraft);
  const composerSetReplyTo = useComposerStore((s) => s.setReplyTo);
  const attachToComposer = useComposerStore((s) => s.attach);
  const removeStaged = useComposerStore((s) => s.removeStaged);
  const clearComposer = useComposerStore((s) => s.clear);

  // Transfer state — subscribe to the whole map so progress/state updates re-render
  const transfers = useTransferStore((s) => s.transfers);
  const startUpload = useTransferStore((s) => s.startUpload);
  const abortUpload = useTransferStore((s) => s.abortUpload);

  // UI-only state stays local
  const [activePopover, setActivePopover] = useState<InputPopoverTab | null>(null);
  // What the text names its emoji by (utils/emojiSets.ts). Loaded with the composer, so a
  // `:name:` typed without opening the picker still becomes its emoji when sent.
  const emojiContext = useEmojiContextOfChannel(channelId);
  useEffect(() => {
    useEmojiStore.getState().ensureOrigin(emojiContext.origin);
  }, [emojiContext.origin]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useComposerMention(channelId, textareaRef);
  const mentionAnchorRef = useRef<HTMLSpanElement>(null);
  // Note: this ref is intentionally typed `HTMLDivElement | null` (mutable
  // ref shape) rather than the more restrictive `RefObject<HTMLDivElement>`
  // because we assign to `.current` from a callback ref below — the
  // callback ref bridges the imperative `popoverAnchorRef` consumers
  // (InputPopover anchoring) and the state-backed
  // `composerEl` slot used by the clearance-measuring effect.
  const popoverAnchorRef = useRef<HTMLDivElement | null>(null);

  // Object URLs for current-session image previews. transferStore doesn't hold
  // the raw File, so previews only exist for files picked in this session
  // (after reload, persisted transfers fall back to the icon placeholder).
  const previewUrlsRef = useRef<Map<string, string>>(new Map());

  const sendMessage = useChatStore((s) => s.sendMessage);
  const returnToPresent = useChatStore((s) => s.returnToPresent);
  // This channel's reply only: reply state is per channel (#390).
  const chatReplyTo = useChatStore((s) => s.replyTargets.get(channelId) ?? null);
  const chatSetReplyTo = useChatStore((s) => s.setReplyTo);
  const editingMessageId = useChatStore((s) => s.editingMessageId);
  const setEditingMessage = useChatStore((s) => s.setEditingMessage);

  const addToast = useUIStore((s) => s.addToast);
  const appendBubble = usePendingMessageStore((s) => s.append);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Feature flags
  const gifEnabled = useSettingsStore((s) => s.gifEnabled);

  // Permission gating: DM channels always allow sending; space channels check SEND_MESSAGES
  const channelPerms = useSpaceStore((s) => s.channelPermissions.get(channelId));
  // Undefined until the ready that lists the channel: nothing can be routed yet, so the composer stays locked.
  const isDm = useIsDmChannel(channelId);
  const canSendMessages = isDm === true || hasPermissionBit(channelPerms, PermissionBits.SEND_MESSAGES);
  const canAttachFiles = isDm === true || hasPermissionBit(channelPerms, PermissionBits.ATTACH_FILES);

  // Slow mode and the viewer's timeout in this channel's space.
  const moderation = useComposerModeration(channelId, isDm);
  const [voiceMode, setVoiceMode] = useState<'clicked' | 'held' | null>(null);
  const closeVoiceRecorder = useCallback(() => setVoiceMode(null), []);
  const slowmodeWaiting = moderation.waitSeconds > 0;
  const { formatDuration, formatInterval, formatTime, formatDateTime } = useFormatters();

  // Derive staged transfers from composerStore staged ids + transferStore map
  const stagedTransfers: Transfer[] = useMemo(() => {
    const out: Transfer[] = [];
    for (const tid of composerState.stagedTransferIds) {
      const t = transfers.get(tid);
      if (t) out.push(t);
    }
    return out;
  }, [composerState.stagedTransferIds, transfers]);

  const draftText = composerState.draftText;
  // The commands of this channel's bots, asked for once someone starts one.
  const [channelCommands, setChannelCommands] = useState<readonly ChannelCommand[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  // A command that asks for things, while someone fills them in.
  const [askingCommand, setAskingCommand] = useState<ChannelCommand | null>(null);
  const [askingBusy, setAskingBusy] = useState(false);
  useEffect(() => setAskingCommand(null), [channelId]);
  const typingCommand = !isDm && draftText.startsWith('/');
  useEffect(() => {
    if (!typingCommand) return undefined;
    let cancelled = false;
    getApiForOrigin(getChannelOrigin(channelId)).commands.list(channelId).then((response) => {
      if (!cancelled) setChannelCommands(response.commands);
    }).catch(() => {
      // Without the list a slash is a message, as it is where no bot answers.
    });
    return () => {
      cancelled = true;
    };
  }, [typingCommand, channelId]);
  const commandQuery = /^\/([a-z0-9_-]*)$/.exec(draftText)?.[1] ?? null;
  const commandMatches = useMemo(() => (commandQuery === null
    ? []
    : channelCommands.filter((item) => item.name.startsWith(commandQuery)).slice(0, 8)), [commandQuery, channelCommands]);
  const setChannelDraft = useCallback((value: string) => setDraft(channelId, value), [setDraft, channelId]);
  const { mentionState, setMentionState, mentionMatches, mentionModel, modelFor,
    selectMention, handleMentionKey, updateMention } = useMentionComposer({ channelId, draftText, textareaRef, onDraftChange: setChannelDraft });

  const remaining = MAX_MESSAGE_LENGTH - draftText.length;
  const isOverLimit = remaining < 0;

  // Auto-focus textarea on channel navigation
  useEffect(() => {
    textareaRef.current?.focus();
  }, [channelId]);

  // Auto-focus textarea when replying (chatStore is the live source of truth)
  useEffect(() => {
    if (chatReplyTo) {
      textareaRef.current?.focus();
    }
  }, [chatReplyTo]);

  // Return focus to the composer after inline editing is saved or cancelled.
  useEffect(() => {
    if (!editingMessageId) textareaRef.current?.focus();
  }, [editingMessageId]);

  // Close popover on channel change
  useEffect(() => {
    setActivePopover(null);
    setMentionState(null);
  }, [channelId, setMentionState]);

  // Sync this channel's chatStore reply target into composerStore so reload restores it.
  // chatStore holds the live MessageWithUser; composerStore stores a flat snapshot.
  //
  // First-mirror-per-channel guard: chatStore is not persisted, so on a fresh
  // mount `chatReplyTo` is always null. Without this guard the mirror would
  // clobber whatever replyTo was persisted in composerStore. Reverse hydration
  // (composer→chat on reload) is not yet implemented; deferred to a future pass
  // (it requires the original message to be present in chatStore.messages,
  // which may not be loaded at mount).
  const mirroredChannelsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const isFirstMirrorForChannel = !mirroredChannelsRef.current.has(channelId);
    mirroredChannelsRef.current.add(channelId);

    if (isFirstMirrorForChannel) {
      if (chatReplyTo) {
        composerSetReplyTo(channelId, {
          id: chatReplyTo.id,
          userId: chatReplyTo.userId,
          content: chatReplyTo.content ?? null,
        });
      }
      return;
    }
    // Already mirrored once for this channel — propagate updates including null.
    if (chatReplyTo) {
      composerSetReplyTo(channelId, {
        id: chatReplyTo.id,
        userId: chatReplyTo.userId,
        content: chatReplyTo.content ?? null,
      });
    } else {
      composerSetReplyTo(channelId, null);
    }
  }, [channelId, chatReplyTo, composerSetReplyTo]);

  // Surface permanent transfer failures as toasts (one toast per id, latched). What had
  // already failed when this composer opened (a reload, another channel) is on its tile.
  const toastedFailuresRef = useRef<Set<string>>(new Set(stagedTransfers.filter((transfer) => transfer.state === 'failed').map((transfer) => transfer.id)));
  useEffect(() => {
    for (const transfer of stagedTransfers) {
      if (transfer.state === 'failed' && !toastedFailuresRef.current.has(transfer.id)) {
        toastedFailuresRef.current.add(transfer.id);
        const reason = transfer.error?.message ?? t('chat:composer.uploadFailedReason');
        addToast(t('chat:composer.uploadFailed', { file: transfer.file.name, reason }), 'warning');
      }
    }
  }, [stagedTransfers, addToast, t]);

  const handleTyping = useCallback(() => {
    if (typingTimeoutRef.current) return;
    const dm = isDmChannel(channelId);
    if (dm) {
      wsSend({ type: 'dm_typing_start', dmChannelId: channelId }, getChannelOrigin(channelId));
    } else {
      wsSend({ type: 'typing_start', channelId }, getChannelOrigin(channelId));
    }
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = undefined;
    }, 3000);
  }, [channelId]);

  /**
   * Eagerly upload a file and stage the resulting transfer in composerStore.
   * If a FileSystemFileHandle is provided (drag-drop via getAsFileSystemHandle,
   * or FS Access pick), it's persisted in IDB so the upload is resumable
   * across reload.
   */
  const enqueueFile = useCallback(
    async (
      input: { file: File; handle?: FileSystemFileHandle | undefined },
    ): Promise<void> => {
      const { file, handle } = input;
      let fileHandleId: string | undefined;
      if (handle && supportsFsHandles()) {
        try {
          fileHandleId = makeFileHandleKey();
          await putHandle(fileHandleId, handle);
        } catch (err) {
          // Persistence failed — proceed without resume capability.
          fileHandleId = undefined;
          const msg = err instanceof Error ? err.message : 'unknown error';
          console.warn('[MessageInput] putHandle failed:', msg);
        }
      }

      try {
        const id = await startUpload(file, {
          channelId,
          tray: true,
          origin: getChannelOrigin(channelId),
          fileHandleId,
        });
        attachToComposer(channelId, id);
        // Best-effort image preview for the current session. transferStore
        // doesn't retain the File, so this URL only exists in-memory.
        if (file.type.startsWith('image/')) {
          try {
            const url = URL.createObjectURL(file);
            previewUrlsRef.current.set(id, url);
          } catch {
            // ignore — preview is optional
          }
        }
      } catch (err) {
        const reason = describeCodedError(err, t('chat:composer.uploadFailedReason'));
        addToast(t('chat:composer.uploadFailed', { file: file.name, reason }), 'warning');
      }
    },
    [channelId, startUpload, attachToComposer, addToast, t],
  );

  const removeStagedTransfer = useCallback(
    (transferId: string) => {
      // Revoke any in-session image preview URL.
      const previewUrl = previewUrlsRef.current.get(transferId);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrlsRef.current.delete(transferId);
      }

      const t = useTransferStore.getState().transfers.get(transferId);
      if (t?.state === 'completed') {
        // Fully-uploaded attachment with a finalized DB row. Server-side bytes
        // get cleaned by the unlinked-attachment janitor (1h grace).
        useTransferStore.getState().remove(transferId);
      } else if (t && t.state !== 'aborted') {
        // active/paused/queued/failed: abortUpload tears down any live tus
        // instance AND sends DELETE for orphaned server-side .tus sessions.
        // Then drop the transfer + free the retained File reference.
        abortUpload(transferId);
        useTransferStore.getState().remove(transferId);
      } else {
        // Already 'aborted' (server already cleaned); just drop the record.
        useTransferStore.getState().remove(transferId);
      }
      removeStaged(channelId, transferId);
    },
    [abortUpload, removeStaged, channelId],
  );

  // Revoke all preview object URLs on unmount.
  useEffect(() => {
    const map = previewUrlsRef.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  // A voice message goes the way of a message with a file: a pending bubble that ships once uploaded.
  const sendVoiceMessage = async (recording: VoiceRecording): Promise<void> => {
    setVoiceMode(null);
    const file = new File([recording.blob], recording.fileName, { type: recording.blob.type });
    try {
      const transferId = await startUpload(file, {
        channelId,
        tray: true,
        origin: getChannelOrigin(channelId),
        voice: { bars: recording.bars, durationSeconds: recording.durationSeconds },
      });
      const now = Date.now();
      void returnToPresent(channelId);
      appendBubble({
        clientId: crypto.randomUUID(),
        channelId,
        content: '',
        replyToId: chatReplyTo?.id ?? null,
        transferIds: [transferId],
        createdAtLocal: now,
        state: 'sending',
        tusExpiresAt: now + DEFAULT_TUS_TTL_MS,
        retryCount: 0,
      });
      chatSetReplyTo(channelId, null);
    } catch (err) {
      const reason = describeCodedError(err, t('chat:composer.uploadFailedReason'));
      addToast(t('chat:composer.uploadFailed', { file: file.name, reason }), 'warning');
    }
  };

  const onVoiceUnavailable = (reason: 'denied' | 'unsupported'): void => {
    setVoiceMode(null);
    addToast(t(reason === 'denied' ? 'chat:voiceMessage.denied' : 'chat:voiceMessage.unsupported'), 'warning');
  };

  const handleSubmit = async (): Promise<void> => {
    // Read the live draft: another Enter may arrive before React re-renders.
    const composer = useComposerStore.getState().get(channelId);
    const submittedDraft = composer.draftText;
    const trimmed = submittedDraft.trim();
    if (!trimmed && composer.stagedTransferIds.length === 0) return;
    if (submittedDraft.length > MAX_MESSAGE_LENGTH) return;
    // A command a bot here answers to goes to the bot; anything else with a slash is a message.
    const asked = composer.stagedTransferIds.length === 0 ? parseCommandText(trimmed) : null;
    const command = asked && channelCommands.find((item) => item.name === asked.name);
    if (asked && command) {
      if (command.options && command.options.length > 0) {
        setDraft(channelId, '');
        setAskingCommand(command);
        return;
      }
      clearComposer(channelId);
      try {
        await getApiForOrigin(getChannelOrigin(channelId)).commands.invoke(channelId, command.botId, command.name, asked.args);
      } catch (err) {
        setDraft(channelId, submittedDraft);
        addToast(describeError(err), 'warning');
      }
      return;
    }
    // Slow mode: the draft waits in the composer until the countdown ends.
    if (slowmodeWaiting) return;

    // Block submission when ANY staged transfer is in a non-shippable state
    // (failed/aborted) — those would prevent the bubble from ever resolving.
    const hasUnshippable = stagedTransfers.some(
      (t) => t.state === 'failed' || t.state === 'aborted',
    );
    if (hasUnshippable) return;

    setMentionState(null);
    setActivePopover(null);

    // Clear typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = undefined;
    }

    // What the person sees is `:name:`; what is sent names the emoji by id.
    const wire = toWireText(trimmed, channelId);

    if (stagedTransfers.length === 0) {
      // Consume the draft synchronously; network completion must not erase newer typing.
      clearComposer(channelId);
      try {
        const sending = sendMessage(channelId, wire);
        // Reset textarea height + focus
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.focus();
        }
        await sending;
        moderation.noteSent();
      } catch (err) {
        // Keep both the failed text and anything typed while the request was pending.
        const currentDraft = useComposerStore.getState().get(channelId).draftText;
        setDraft(channelId, submittedDraft + (currentDraft ? '\n' + currentDraft : ''));
        // A slow-mode refusal shows as the countdown; every other refusal
        // (a filtered word, a timeout, an account too new) is said once here.
        if (!moderation.noteRefused(err)) addToast(describeError(err), 'warning');
      }
      return;
    }

    // Attachment path — stage a pending bubble. The orchestrator dispatches the
    // actual API call when every transfer reaches state='completed'.
    const clientId = crypto.randomUUID();
    const replyToId = chatReplyTo?.id ?? null;

    // tusExpiresAt: min across staged transfers, default to 24h from now if absent.
    const now = Date.now();
    const fallbackExpires = now + DEFAULT_TUS_TTL_MS;
    const expirations = stagedTransfers
      .map((t) => t.tusExpiresAt)
      .filter((x): x is number => typeof x === 'number' && x > 0);
    const tusExpiresAt = expirations.length > 0 ? Math.min(...expirations) : fallbackExpires;

    // As for a text send (chatStore.sendMessage): sending from a window of
    // older history goes back to the present, where the message will appear.
    void returnToPresent(channelId);
    appendBubble({
      clientId,
      channelId,
      content: wire,
      replyToId,
      transferIds: stagedTransfers.map((t) => t.id),
      createdAtLocal: now,
      state: 'sending',
      tusExpiresAt,
      retryCount: 0,
    });

    // Detach the staged transfers from the composer (they're now owned by the bubble)
    // and clear the draft + reply for this channel.
    clearComposer(channelId);
    chatSetReplyTo(channelId, null);

    // Reset textarea height + focus
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  };

  const pickCommand = (picked: ChannelCommand): void => {
    setCommandIndex(0);
    if (picked.options && picked.options.length > 0) {
      setDraft(channelId, '');
      setAskingCommand(picked);
      return;
    }
    setDraft(channelId, `/${picked.name} `);
    textareaRef.current?.focus();
  };

  const sendFilledCommand = async (command: ChannelCommand, options: Record<string, CommandOptionValue>): Promise<void> => {
    setAskingBusy(true);
    try {
      await getApiForOrigin(getChannelOrigin(channelId)).commands.invoke(channelId, command.botId, command.name, '', options);
      setAskingCommand(null);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setAskingBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // IME confirmation must not select a candidate or send the message.
    if (e.nativeEvent.isComposing) return;
    if (commandMatches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setCommandIndex((index) => (index + step + commandMatches.length) % commandMatches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        const picked = commandMatches[Math.min(commandIndex, commandMatches.length - 1)];
        if (picked) {
          e.preventDefault();
          pickCommand(picked);
          return;
        }
      }
    }
    if (handleMentionKey(e)) return;

    const isPlainArrowUp = e.key === 'ArrowUp'
      && !e.altKey
      && !e.ctrlKey
      && !e.metaKey
      && !e.shiftKey
      && !e.nativeEvent.isComposing;
    const composerIsEmpty = draftText.length === 0
      && composerState.stagedTransferIds.length === 0
      && !chatReplyTo
      && !composerState.replyTo;

    if (isPlainArrowUp && composerIsEmpty && !editingMessageId) {
      // Read the list on demand: subscribing to it would re-render the composer
      // on every incoming message, and the shortcut only needs it at keypress time.
      const channelMessages = useChatStore.getState().messages.get(channelId) ?? [];
      const { user, myRowIds } = useAuthStore.getState();
      const message = findLastOwnEditableMessage(channelMessages, getChannelOrigin(channelId), selfIdentityOf(user, myRowIds));
      if (message) {
        e.preventDefault();
        setActivePopover(null);
        setEditingMessage(message.id);
        return;
      }
    }

    // Default: Enter to submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent): void => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) void enqueueFile({ file });
      }
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    const useDndHandles = supportsDnDHandles();

    if (useDndHandles && items && items.length > 0) {
      // Chrome/Edge: upgrade to FileSystemFileHandle for resume-across-reload.
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.kind !== 'file') continue;
        // @ts-ignore — getAsFileSystemHandle is non-standard
        const maybeHandle: Promise<FileSystemHandle | null> | undefined = item.getAsFileSystemHandle?.();
        const file = item.getAsFile();
        if (maybeHandle) {
          void maybeHandle.then(async (handle) => {
            if (handle && handle.kind === 'file') {
              const fh = handle as FileSystemFileHandle;
              const handleAny = fh as unknown as { getFile?: () => Promise<File> };
              if (typeof handleAny.getFile === 'function') {
                try {
                  const f = await handleAny.getFile();
                  void enqueueFile({ file: f, handle: fh });
                  return;
                } catch {
                  // fall through to plain-file path
                }
              }
            }
            if (file) void enqueueFile({ file });
          });
        } else if (file) {
          void enqueueFile({ file });
        }
      }
      return;
    }

    // Fallback: plain Files list (Firefox/Safari)
    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      void enqueueFile({ file });
    }
  };

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    updateMention(e);

    handleTyping();

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
  };

  const handleEmojiSelect = useCallback(
    (emoji: { native: string }) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        setDraft(channelId, draftText + emoji.native);
        return;
      }
      // A selection that touches a mention replaces its whole token.
      const { value: newContent, wireCursor } = mentionModel.replace({
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        text: emoji.native,
      });
      setDraft(channelId, newContent);

      // Restore cursor position after the emoji
      const newCursorPos = modelFor(newContent).toDisplay(wireCursor);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = newCursorPos;
        textarea.selectionEnd = newCursorPos;
      });
    },
    [draftText, setDraft, channelId, mentionModel, modelFor],
  );

  const { noteSent, noteRefused } = moderation;
  const handleGifSelect = useCallback(
    (url: string) => {
      // GIF picks bypass the staged-transfer pipeline — they're remote URLs,
      // not local files, and ship as plain content.
      setActivePopover(null);
      // Under slow mode a GIF or sticker is a message like any other.
      if (slowmodeWaiting) return;
      void sendMessage(channelId, url).then(noteSent, (error: unknown) => {
        if (!noteRefused(error)) addToast(describeError(error), 'warning');
      });
    },
    [channelId, sendMessage, addToast, slowmodeWaiting, noteSent, noteRefused],
  );

  const togglePopover = useCallback((tab: InputPopoverTab) => {
    setActivePopover((prev) => (prev === tab ? null : tab));
  }, []);

  // anyActiveOrQueued: a visual indicator something is in flight; pending/paused
  // bubbles are still allowed to ship (orchestrator handles them).
  const anyActiveOrQueued = stagedTransfers.some(
    (t) => t.state === 'active' || t.state === 'queued',
  );
  const anyUnshippable = stagedTransfers.some(
    (t) => t.state === 'failed' || t.state === 'aborted',
  );
  const failedCount = stagedTransfers.filter((t) => t.state === 'failed').length;

  const canSend =
    (draftText.trim().length > 0 || stagedTransfers.length > 0) &&
    !isOverLimit &&
    !anyUnshippable &&
    !slowmodeWaiting;

  // Composer positioning model — IDENTICAL across desktop and mobile.
  // ─────────────────────────────────────────────────────────────────
  // The composer is a floating bubble (`glass-bubble rounded-lg`)
  // pinned to the bottom of the chat region with `position: absolute`. The
  // MessageList sibling fills the entire chat area; the last messages scroll
  // *behind* the translucent bubble. MessageList content carries a dynamic
  // `paddingBottom` (CSS variable `--composer-clearance`, set by the
  // ResizeObserver effect below) so the last message clears the bubble's
  // top edge with a 12 px breathing gap regardless of bubble height.
  //
  // Vertical positioning differs only in the `bottom` value:
  // - Desktop: `bottom: 16px` (the `desktop:bottom-4` constant).
  // - Mobile, keyboard closed: `bottom: var(--safe-bottom) + 6px`
  //   so the bubble clears the iOS home indicator with a small breathing gap.
  // - Mobile, keyboard open: `bottom: 0`. `MobileShell` shrinks its container
  //   to `visualViewport.height` (see `MobileShell.tsx`), so the chat region's
  //   bottom edge already sits on the keyboard's top edge. The composer then
  //   lands flush with the keyboard regardless of how reliably
  //   `visualViewport` event delivery is on iOS PWA — the shell's height
  //   shrinking is the load-bearing mechanism, not the inset arithmetic
  //   here. This dodges the long-standing iOS-standalone bug where
  //   `visualViewport.resize` fires late or not at all when the soft
  //   keyboard opens. The hook's `focusin` polling fallback covers the
  //   remaining gap by re-reading `vv.height` for ~600 ms after a text
  //   input gains focus, even when no resize event ever lands.
  //
  // The horizontal inset is symmetric: `left-2 right-2` on mobile (matches
  // `MobileVoiceMiniBar`'s `mx-2` and the `MobileBottomNav` spacing tier);
  // `desktop:left-5 desktop:right-5` on desktop (20 px, the edge the header and the messages keep).
  //
  // `z-[110]` keeps the bubble above any in-chat overlays (mention popover,
  // staged-attachment tiles) but below modals (`z-[300]+`).
  const isMobile = useUIStore((s) => s.isMobile);
  const { keyboardOpen, textInputFocused } = useVisualViewportInset();
  // iOS PWA standalone shrinks the *layout viewport* itself for the keyboard
  // (interactive-widget=resizes-content / native standalone behavior), so
  // `vv.height` matches `innerHeight` and the height-delta-inferred
  // `keyboardOpen` stays false even though the keyboard IS up. Focus state is
  // the robust fallback: a text input being focused means the keyboard is up.
  // - keyboardOpen true (Android Chrome): MobileShell already shrunk to
  //   `vv.height`; composer at `bottom: 0` lands on the keyboard top.
  // - keyboardOpen false but textInputFocused true (iOS PWA): layout viewport
  //   already shrunk by iOS; composer at `bottom: 4px` lands ~4 px above the
  //   keyboard top — the tight visual gap the user wants.
  // - both false: composer 6 px above the home indicator, the rest state.
  const composerStyle: React.CSSProperties | undefined = isMobile
    ? {
        bottom: keyboardOpen
          ? '0px'
          : textInputFocused
            ? '4px'
            : 'calc(var(--safe-bottom) + 6px)',
      }
    : undefined;
  const composerClass =
    'composer-capsule absolute left-2 right-2 z-[110] glass-bubble rounded-lg' +
    ' desktop:left-5 desktop:right-5 desktop:bottom-4';

  // Dynamic message-list bottom padding ("composer clearance"):
  //
  // The composer is `position: absolute` and overlays the bottom of the
  // chat region. The MessageList scroll content needs enough bottom padding
  // that the last message can be scrolled fully into view above the bubble
  // with a visible gap — otherwise the last message sticks flush to the
  // bubble's top edge (the bug user reported on iOS PWA: a static `pb-20`
  // = 80 px is smaller than `composer-bottom-offset (env safe-area + 6) +
  // composer-height (~50–100 px depending on staged attachments / multi-
  // line text)` on iPhone).
  //
  // Strategy: a single CSS custom property `--composer-clearance` is
  // written to the nearest scrollable ancestor on every composer-size or
  // composer-bottom-offset change. `MessageList` reads that variable as
  // its content's `paddingBottom`, falling back to a static 80 px when
  // unset (e.g. when no composer is mounted, or before the first measure).
  // The 12 px constant below is the desired breathing-room gap between the
  // last message's bottom edge and the composer's top edge.
  //
  // Why a CSS variable on the parent rather than a global:
  //   - One MessageInput per chat region; the variable scopes to that
  //     region so multi-pane layouts (DM list + chat in a future split
  //     view, voice channel side-panel, etc.) don't cross-talk.
  //   - The MessageList content already lives inside the same parent
  //     subtree, so a CSS variable inheritance just works.
  // We track the live composer DOM element via a state-backed ref. A plain
  // ref isn't enough because the component renders different JSX when
  // `canSendMessages` flips (the early-return permission-denied path doesn't
  // attach the ref), and a useEffect on the ref's value would not re-fire on
  // those re-renders. Channel permissions arrive asynchronously, so the
  // initial mount renders the no-permission JSX first, then re-renders with
  // the full composer once permissions resolve — we need to (re-)attach the
  // ResizeObserver at that moment.
  const [composerEl, setComposerEl] = useState<HTMLDivElement | null>(null);
  // The clearance for the live composer element. The variable is written on
  // every change and removed only when the composer element goes away: the
  // message list holds its view against it, and a removal, even one undone in
  // the same task, lets the browser lay the list out at the 80 px fallback and
  // clamp its scroll offset, which leaves the newest messages under the
  // composer (issue #361, docs/systems/message-list.md "Bottom clearance").
  const syncClearance = useCallback((el: HTMLDivElement) => {
    const target = el.parentElement;
    if (!target) return;
    // Total clearance = composer height + bottom offset + 12 px gap.
    // We measure the bubble's visual height (including replyTo banner +
    // staged-attachment tiles + textarea autosize) plus the distance from
    // the parent's bottom edge to the bubble's bottom edge (which folds
    // in `var(--safe-bottom) + 6` on mobile or `16 px` on
    // desktop, whichever the composer's `bottom` resolves to).
    const composerRect = layoutRect(el.getBoundingClientRect());
    const parentRect = layoutRect(target.getBoundingClientRect());
    const bottomOffset = Math.max(0, parentRect.bottom - composerRect.bottom);
    const clearance = `${Math.round(composerRect.height + bottomOffset + 12)}px`;
    if (target.style.getPropertyValue('--composer-clearance') !== clearance) {
      target.style.setProperty('--composer-clearance', clearance);
    }
  }, []);

  // The region the variable was last written to. It is cleared only when the
  // composer leaves that region (another region, or unmount), never between
  // two elements of the same composer (the permission-denied bubble and the
  // full one swap when channel permissions resolve).
  const clearanceTargetRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!composerEl) return;
    const target = composerEl.parentElement;
    if (!target) return;
    const previousTarget = clearanceTargetRef.current;
    if (previousTarget && previousTarget !== target) previousTarget.style.removeProperty('--composer-clearance');
    clearanceTargetRef.current = target;
    const el = composerEl;
    const sync = () => syncClearance(el);

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    // Also re-sync when the parent itself resizes (keyboard open/close
    // collapses the chat region's height; MobileShell drives this via
    // visualViewport.height).
    ro.observe(target);

    // Re-sync on visual viewport changes — the parent's `getBoundingClientRect`
    // updates with the layout, but if `MobileShell`'s height attribute
    // updates between paints, we want a same-frame re-measure.
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', sync);
      vv.addEventListener('scroll', sync);
    }

    return () => {
      ro.disconnect();
      if (vv) {
        vv.removeEventListener('resize', sync);
        vv.removeEventListener('scroll', sync);
      }
    };
  }, [composerEl, syncClearance]);

  useLayoutEffect(() => () => {
    clearanceTargetRef.current?.style.removeProperty('--composer-clearance');
    clearanceTargetRef.current = null;
  }, []);

  // The composer's `bottom` style and its content (reply banner, staged
  // files) change between renders without necessarily resizing the element
  // or its parent, so the observers above may not fire. Re-measure after
  // each such render, before paint, without touching the observers.
  useLayoutEffect(() => {
    if (composerEl) syncClearance(composerEl);
  }, [composerEl, syncClearance, isMobile, keyboardOpen, textInputFocused, chatReplyTo, stagedTransfers.length]);

  // Combined ref: keep `popoverAnchorRef` populated (InputPopover anchor +
  // scroll-into-view targets) AND notify the
  // `composerEl` state slot so the clearance-measuring effect can re-run
  // when the element materializes / changes between conditional render
  // branches.
  const setComposerRef = useCallback((node: HTMLDivElement | null) => {
    popoverAnchorRef.current = node;
    setComposerEl(node);
  }, []);

  if (!canSendMessages) {
    return (
      <div ref={setComposerRef} data-pip-obstacle="bottom" className={composerClass} style={composerStyle}>
        <div className="flex min-h-11 items-center justify-center gap-2 px-4 py-1.5">
          {/* While the channel is unknown (before its ready) nothing is refused yet:
              the shell alone, a non-breaking space keeping its height. */}
          {isDm !== undefined && <Icon name="lock" size={15} className="flex-shrink-0 text-txt-tertiary" />}
          <span className="text-txt-tertiary text-ui">
            {isDm === undefined ? '\u00a0' : t('chat:composer.noPermission')}
          </span>
        </div>
      </div>
    );
  }

  // Timed out: a calm notice in place of the input until the timeout ends,
  // when the composer comes back by itself.
  if (moderation.timedOutUntil !== null) {
    const until = moderation.timedOutUntil;
    const sameDay = new Date(until).toDateString() === new Date().toDateString();
    return (
      <div ref={setComposerRef} data-pip-obstacle="bottom" className={composerClass} style={composerStyle}>
        <div className="flex min-h-11 items-center justify-center gap-2 px-4 py-1.5">
          <Icon name="hourglass" size={15} className="flex-shrink-0 text-txt-tertiary" />
          <span className="text-txt-secondary text-ui">
            {t('chat:composer.timedOut', { time: sameDay ? formatTime(until) : formatDateTime(until) })}
          </span>
        </div>
      </div>
    );
  }

  // Rules still wait for an answer: the way to them in place of the input.
  if (moderation.mustAcceptRules) {
    return (
      <div ref={setComposerRef} data-pip-obstacle="bottom" className={composerClass} style={composerStyle}>
        <div className="flex min-h-11 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5">
          <span className="text-txt-secondary text-ui">{t('chat:composer.rulesRequired')}</span>
          <button type="button" onClick={moderation.openRules} className="btn-primary btn-sm">{t('chat:composer.readRules')}</button>
        </div>
      </div>
    );
  }

  const slowmodeLabel = slowmodeWaiting
    ? t('chat:composer.slowmode.wait', { time: formatDuration(moderation.waitSeconds) })
    : t('chat:composer.slowmode.active', { interval: formatInterval(moderation.slowmodeSeconds) });

  return (
    <div
      ref={setComposerRef}
      data-pip-obstacle="bottom"
      className={composerClass}
      style={composerStyle}
    >
      <TypingIndicator channelId={channelId} />
      <CommandReplies channelId={channelId} />

      {/* Input popover (emoji / gif) */}
      {activePopover && (
        <InputPopover
          activeTab={activePopover}
          onClose={() => setActivePopover(null)}
          onEmojiSelect={handleEmojiSelect}
          onGifSelect={handleGifSelect}
          anchorRef={popoverAnchorRef}
          gifEnabled={gifEnabled}
          onTabChange={setActivePopover}
          context={emojiContext}
        />
      )}

      {chatReplyTo && (
        <div className="flex h-8 items-center justify-between gap-2 rounded-t-lg border-b border-border-hard bg-interactive-hover pl-3 pr-1">
          <div className="flex min-w-0 items-center gap-1.5 text-meta text-txt-secondary">
            <Icon name="reply" size={14} className="flex-shrink-0 text-txt-tertiary" />
            <span className="flex min-w-0 items-center gap-1">
              <span className="flex-shrink-0">{t('chat:composer.replyingTo')}</span>
              <ReplyTargetName channelId={channelId} author={chatReplyTo.user} />
            </span>
          </div>
          <button
            onClick={() => chatSetReplyTo(channelId, null)}
            className="icon-btn h-6 w-6"
            aria-label={t('chat:composer.cancelReply')}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      <div
        className="relative overflow-visible"
        onDrop={canAttachFiles ? handleDrop : undefined}
        onDragOver={canAttachFiles ? handleDragOver : undefined}
      >
        {/* Mention autocomplete popover */}
        {mentionState && mentionMatches.length > 0 && (
          <MentionPopover
            candidates={mentionMatches}
            selectedIndex={mentionState.selectedIndex}
            onSelect={selectMention}
            anchorRef={mentionAnchorRef}
          />
        )}

        <StagedTransferTiles
          stagedTransfers={stagedTransfers}
          previewUrls={previewUrlsRef.current}
          onRemove={removeStagedTransfer}
        />

        {commandMatches.length > 0 && (
          <CommandPopover
            commands={commandMatches}
            selected={Math.min(commandIndex, commandMatches.length - 1)}
            onPick={pickCommand}
          />
        )}

        {askingCommand && (
          <CommandOptionsForm
            key={`${askingCommand.botId}:${askingCommand.name}`}
            command={askingCommand}
            busy={askingBusy}
            onSubmit={(options) => void sendFilledCommand(askingCommand, options)}
            onCancel={() => setAskingCommand(null)}
          />
        )}

        {voiceMode !== null && (
          <VoiceRecorderBar
            held={voiceMode === 'held'}
            onSend={(recording) => void sendVoiceMessage(recording)}
            onClose={closeVoiceRecorder}
            onUnavailable={onVoiceUnavailable}
          />
        )}

        {/* The controls hold the height of one line at the foot of the row, so
            they stay beside the caret's last line while a long draft grows up. */}
        <div className={`items-end gap-1 px-1 desktop:px-1.5 ${voiceMode !== null ? 'hidden' : 'flex'}`}>
          {/* File attach button */}
          {canAttachFiles && (
            <div className="flex h-11 flex-shrink-0 items-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="icon-btn h-10 w-10 desktop:h-8 desktop:w-8"
                aria-label={t('chat:composer.attachFile')}
              >
                <Icon name="paperclip" size={18} />
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              for (const f of selected) {
                void enqueueFile({ file: f });
              }
              e.target.value = '';
            }}
          />

          {/* Text input */}
          <MentionTextarea
            textareaRef={textareaRef}
            mentionAnchorRef={mentionAnchorRef}
            mentionStart={mentionState?.startIndex}
            model={mentionModel}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={canAttachFiles ? handlePaste : undefined}
            placeholder={
              placeholder ??
              (channelName.startsWith('@')
                ? t('chat:composer.placeholder.dm', { name: channelName.slice(1) })
                : t('chat:composer.placeholder.channel', { name: channelName }))
            }
            className="input-embedded relative block w-full py-[11px] px-1 resize-none text-lead leading-[1.375rem] max-h-[calc(50*var(--app-vh))] scrollbar-thin"
            rows={1}
          />

          <div className="flex h-11 flex-shrink-0 items-center gap-1">
            {/* Active-upload indicator */}
            {anyActiveOrQueued && (
              <span
                className="flex h-8 w-8 items-center justify-center text-txt-tertiary"
                title={t('chat:composer.uploading')}
                aria-label={t('chat:composer.uploadingLabel')}
              >
                <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
              </span>
            )}

            {/* Failed-upload hint (gates send button) */}
            {failedCount > 0 && (
              <span
                className="text-meta font-medium text-txt-danger px-1"
                title={t('chat:composer.failedHint')}
              >
                {t('chat:composer.failedCount', { count: failedCount })}
              </span>
            )}

            {/* Character counter (shows when near or over limit) */}
            {draftText.length > MAX_MESSAGE_LENGTH - 200 && (
              <span
                className={`tabular font-mono text-meta px-1 ${isOverLimit ? 'text-txt-danger' : 'text-txt-tertiary'}`}
              >
                {remaining}
              </span>
            )}

            {/* Slow mode: the interval, or the time left until the next message */}
            {moderation.slowmodeSeconds > 0 && (
              <span
                className={`flex items-center gap-1.5 px-1 text-meta select-none ${slowmodeWaiting ? 'text-txt-secondary' : 'text-txt-tertiary'}`}
                title={slowmodeLabel}
              >
                <Icon name="hourglass" size={14} className="flex-shrink-0" />
                <span className="hidden desktop:inline">{t('chat:composer.slowmode.label')}</span>
                <span className="tabular font-mono">
                  {slowmodeWaiting
                    ? formatDuration(moderation.waitSeconds)
                    : formatInterval(moderation.slowmodeSeconds, 'short')}
                </span>
              </span>
            )}

            {/* A poll: a space channel's, for someone who may write there */}
            {!isDm && (
              <button
                type="button"
                onClick={() => useUIStore.getState().openModal('createPoll', { channelId })}
                className="icon-btn h-10 w-10 desktop:h-8 desktop:w-8"
                aria-label={t('chat:poll.create.open')}
              >
                <Icon name="poll" size={20} />
              </button>
            )}

            {/* GIF button */}
            {gifEnabled && (
              <button
                onClick={() => togglePopover('gif')}
                data-active={activePopover === 'gif' ? 'true' : undefined}
                className="icon-btn h-10 w-10 desktop:h-8 desktop:w-8"
                aria-label={t('chat:composer.gifPicker')}
              >
                <Icon name="gif" size={20} />
              </button>
            )}

            {/* Emoji button */}
            <button
              onClick={() => togglePopover('emoji')}
              data-active={activePopover === 'emoji' ? 'true' : undefined}
              className="icon-btn h-10 w-10 desktop:h-8 desktop:w-8"
              aria-label={t('chat:composer.emojiPicker')}
            >
              <Icon name="smile" size={20} />
            </button>

            {/* A voice message, when there is nothing written to send: a phone holds the button, a window clicks it. */}
            {!canSend && canAttachFiles && !editingMessageId && voiceRecordingSupported() && (
              <button
                type="button"
                onClick={() => {
                  if (!isMobile) setVoiceMode('clicked');
                }}
                onPointerDown={(event) => {
                  if (!isMobile) return;
                  event.preventDefault();
                  setVoiceMode('held');
                }}
                onContextMenu={(event) => {
                  if (isMobile) event.preventDefault();
                }}
                style={isMobile ? { touchAction: 'none' } : undefined}
                className="icon-btn h-10 w-10 desktop:h-8 desktop:w-8"
                aria-label={isMobile ? t('chat:voiceMessage.holdToRecord') : t('chat:voiceMessage.record')}
              >
                <Icon name="mic" size={18} />
              </button>
            )}

            {/* Send button — appears when there's content/attachments to send */}
            {canSend && (
              <button
                data-tooltip=""
                onClick={() => void handleSubmit()}
                disabled={anyUnshippable}
                className="btn-primary h-10 w-10 p-0 desktop:h-8 desktop:w-8"
                aria-label={t('chat:composer.sendMessage')}
              >
                <Icon name="send" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
