import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageWithUser } from '@backspace/shared';
import { THREAD_LIMITS, type ThreadOpened } from '@backspace/shared/src/threads';
import { wsSend } from '../../hooks/useWebSocket';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useChatStore } from '../../stores/chatStore';
import { getApiForOrigin, getChannelOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useThreadStore } from '../../stores/threadStore';
import { useUIStore } from '../../stores/uiStore';
import { useSelfIdInChannel } from '../../utils/channelUser';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { AttachmentList } from './AttachmentRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ForumPostHead, ForumPostTagsButton } from './ForumView';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';

/** The message a thread grew from, at the head of the thread. */
function ThreadStarter({ message, channelId }: { message: MessageWithUser | null; channelId: string }) {
  const { t } = useTranslation('chat');
  const { formatDateTime } = useFormatters();
  if (!message) {
    return <p className="mx-4 mt-4 border-b border-border-hard pb-4 text-meta text-txt-tertiary">{t('thread.noStarter')}</p>;
  }
  const name = message.user.displayName || message.user.username;
  return (
    <div className="mx-4 mt-4 border-b border-border-hard pb-4">
      <div className="flex items-center gap-2">
        <Avatar src={message.user.avatar} name={name} size={24} user={message.user} />
        <span className="min-w-0 truncate text-ui font-medium text-txt-primary">{name}</span>
        <time className="tabular flex-shrink-0 font-mono text-label text-txt-tertiary">{formatDateTime(message.createdAt)}</time>
      </div>
      {message.content && (
        <div className="message-text mt-1.5 text-ui leading-[1.5] text-txt-message [overflow-wrap:anywhere]">
          <MarkdownRenderer content={message.content} channelId={channelId} />
        </div>
      )}
      {message.attachments.length > 0 && <div className="mt-2"><AttachmentList attachments={message.attachments} /></div>}
    </div>
  );
}

/**
 * A thread itself, on either surface: it asks the instance holding it, hears its events while
 * it is open, and reads and writes as any channel does (`MessageList`, `MessageInput`).
 */
export function ThreadConversation({ threadId, parentChannelId, jumpToMessageId, onJumpHandled, onHeader }: {
  threadId: string;
  parentChannelId: string;
  jumpToMessageId: string | null;
  onJumpHandled: () => void;
  /** What the surface's own header shows of it. */
  onHeader: (opened: ThreadOpened | null) => void;
}) {
  const { t } = useTranslation('chat');
  const gone = useThreadStore((s) => s.gone.has(threadId));
  const loadMessages = useChatStore((s) => s.loadMessages);
  const [opened, setOpened] = useState<ThreadOpened | null>(null);
  const [error, setError] = useState('');
  const origin = getChannelOrigin(parentChannelId);
  // A forum's post has no message it grew from: its first message is the post.
  const isForumPost = useSpaceStore((s) => s.spaceChannelIndex.get(parentChannelId)?.type === 'forum');

  useEffect(() => {
    let stale = false;
    setOpened(null);
    setError('');
    onHeader(null);
    getApiForOrigin(origin).threads.open(threadId)
      .then((response) => {
        if (stale) return;
        useSpaceStore.getState().registerThreads(origin, [response.thread]);
        setOpened(response);
        onHeader(response);
        void loadMessages(threadId);
      })
      .catch((err: unknown) => {
        if (!stale) setError(describeError(err));
      });
    wsSend({ type: 'thread_watch', threadId }, origin);
    useThreadStore.getState().setWatching({ threadId, origin });
    return () => {
      stale = true;
      wsSend({ type: 'thread_watch', threadId: null }, origin);
      if (useThreadStore.getState().watching?.threadId === threadId) useThreadStore.getState().setWatching(null);
    };
    // onHeader is the surface's setter, stable for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, origin, loadMessages]);

  if (gone) return <div className="empty-state flex-1"><p className="empty-state-body">{t('thread.gone')}</p></div>;
  if (error) return <div className="empty-state flex-1"><p role="alert" className="empty-state-body">{error}</p></div>;
  if (!opened) return <div className="flex flex-1 items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-txt-tertiary border-r-transparent" /></div>;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <MessageList
        channelId={threadId}
        top={isForumPost ? <ForumPostHead thread={opened.thread} /> : <ThreadStarter message={opened.starter} channelId={parentChannelId} />}
        jumpToMessageId={jumpToMessageId}
        onJumpHandled={onJumpHandled}
      />
      <MessageInput channelId={threadId} channelName={opened.thread.name} placeholder={t('thread.composer')} />
    </div>
  );
}

/** Follow, rename, delete: the same for the panel and the phone's screen. */
export function ThreadActions({ opened, onRenamed, onDeleted }: {
  opened: ThreadOpened;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation(['chat', 'common']);
  const { thread } = opened;
  const following = useThreadStore((s) => s.followed.has(thread.id));
  const permissions = useSpaceStore((s) => s.channelPermissions.get(thread.id));
  const selfId = useSelfIdInChannel(thread.parentChannelId);
  const client = () => getApiForOrigin(getChannelOrigin(thread.parentChannelId));
  const canManage = hasPermissionBit(permissions, PermissionBits.MANAGE_MESSAGES) || (selfId !== undefined && thread.createdBy === selfId);
  const isForumPost = useSpaceStore((s) => s.spaceChannelIndex.get(thread.parentChannelId)?.type === 'forum');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(thread.name);

  const toast = useCallback((err: unknown) => useUIStore.getState().addToast(describeError(err), 'warning'), []);

  const toggleFollow = async () => {
    try {
      await (following ? client().threads.unfollow(thread.id) : client().threads.follow(thread.id));
    } catch (err) {
      toast(err);
    }
  };

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === thread.name) {
      setEditing(false);
      return;
    }
    try {
      await client().threads.rename(thread.id, next);
      onRenamed(next);
      setEditing(false);
    } catch (err) {
      toast(err);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await client().threads.remove(thread.id);
      onDeleted();
    } catch (err) {
      toast(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={(event) => void rename(event)} className="flex min-w-0 flex-1 items-center gap-1">
        <input
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, THREAD_LIMITS.NAME_MAX_LENGTH))}
          onBlur={() => setEditing(false)}
          aria-label={t('chat:thread.rename')}
          autoFocus
          className="input-standard h-8 min-w-0 flex-1 py-0"
        />
      </form>
    );
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => void toggleFollow()}
        aria-pressed={following}
        aria-label={following ? t('chat:thread.unfollow') : t('chat:thread.follow')}
        data-active={following ? 'true' : undefined}
        className="icon-btn"
      >
        <Icon name="bell" size={16} />
      </button>
      {canManage && isForumPost && <ForumPostTagsButton thread={thread} />}
      {canManage && (
        <>
          <button type="button" onClick={() => setEditing(true)} aria-label={t('chat:thread.rename')} className="icon-btn">
            <Icon name="edit" size={15} />
          </button>
          <button type="button" onClick={() => setConfirming(true)} aria-label={t('chat:thread.delete')} className="icon-btn">
            <Icon name="trash" size={15} />
          </button>
        </>
      )}
      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        title={t('chat:thread.deleteTitle')}
        description={t('chat:thread.deleteBody')}
        confirmLabel={t('chat:thread.delete')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}

/** The thread in the column beside a channel, on a window. */
export function ThreadPanel() {
  const { t } = useTranslation('chat');
  const open = useThreadStore((s) => s.open);
  const closeThread = useThreadStore((s) => s.closeThread);
  const clearJump = useThreadStore((s) => s.clearJump);
  const [opened, setOpened] = useState<ThreadOpened | null>(null);
  const [title, setTitle] = useState('');

  const onHeader = useCallback((value: ThreadOpened | null) => {
    setOpened(value);
    if (value) setTitle(value.thread.name);
  }, []);

  if (!open) return null;

  return (
    <aside
      aria-label={t('thread.panel')}
      className="relative flex w-[400px] min-w-[300px] max-w-[45%] min-h-0 flex-shrink-0 flex-col overflow-hidden border-l border-border-hard bg-surface-chat"
    >
      <div className="panel-bar flex items-center gap-2 pl-4 pr-2">
        <Icon name="thread" size={16} className="flex-shrink-0 text-txt-tertiary" />
        <span className="min-w-0 flex-1 truncate text-ui font-semibold text-txt-primary">{title}</span>
        {opened && <ThreadActions opened={opened} onRenamed={setTitle} onDeleted={closeThread} />}
        <button type="button" onClick={closeThread} aria-label={t('thread.close')} className="icon-btn flex-shrink-0">
          <Icon name="x" size={16} />
        </button>
      </div>
      <ThreadConversation
        key={open.threadId}
        threadId={open.threadId}
        parentChannelId={open.parentChannelId}
        jumpToMessageId={open.jumpToMessageId}
        onJumpHandled={clearJump}
        onHeader={onHeader}
      />
    </aside>
  );
}
