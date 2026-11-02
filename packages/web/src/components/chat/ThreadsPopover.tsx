import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ThreadInfo } from '@backspace/shared/src/threads';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { openThreadView } from '../../utils/openThread';
import { Icon } from '../ui/Icon';

interface ThreadsPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  channelId: string;
}

/** A channel's threads, the latest activity first. A thread that went quiet is under Archived. */
export function ThreadsPopover({ open, onClose, anchorRef, channelId }: ThreadsPopoverProps) {
  const { t } = useTranslation('chat');
  const { formatRelativeTime, formatNumber } = useFormatters();
  const popoverRef = useRef<HTMLDivElement>(null);
  const { style } = useFloatingPosition(anchorRef, popoverRef, { placement: 'bottom', offset: 8, enabled: open });
  const [archived, setArchived] = useState(false);
  const [threads, setThreads] = useState<ThreadInfo[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let stale = false;
    setThreads(null);
    setError('');
    getApiForOrigin(getChannelOrigin(channelId)).threads.list(channelId, archived)
      .then((response) => { if (!stale) setThreads(response.threads); })
      .catch((err: unknown) => { if (!stale) setError(describeError(err)); });
    return () => { stale = true; };
  }, [open, channelId, archived]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      role="dialog"
      aria-label={t('thread.listTitle')}
      className="w-[380px] max-w-[calc(100*var(--app-vw)-16px)] max-h-[min(460px,calc(100*var(--app-vh)-64px))] glass rounded-lg flex flex-col animate-fade-in"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-hard px-3 py-2">
        <h2 className="label-mono">{t('thread.listTitle')}</h2>
        <button type="button" onClick={() => setArchived(!archived)} aria-pressed={archived} className="btn-quiet btn-sm">
          {archived ? t('thread.showActive') : t('thread.showArchived')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {error && <p role="alert" className="px-3 py-2 text-meta text-txt-danger">{error}</p>}
        {threads === null && !error && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-txt-tertiary border-r-transparent" />
          </div>
        )}
        {threads?.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Icon name="thread" size={18} /></span>
            <p className="empty-state-title">{archived ? t('thread.emptyArchived') : t('thread.emptyTitle')}</p>
            {!archived && <p className="empty-state-body">{t('thread.emptyBody')}</p>}
          </div>
        )}
        {threads && threads.length > 0 && (
          <ul className="p-1.5">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => {
                    openThreadView(thread.id, channelId);
                    onClose();
                  }}
                  className="list-row w-full items-center gap-2.5 text-left"
                >
                  <Icon name="thread" size={15} className="flex-shrink-0 text-txt-tertiary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-txt-primary">{thread.name}</span>
                    <span className="block truncate text-meta text-txt-tertiary">
                      {t('thread.replies', { count: thread.messageCount, value: formatNumber(thread.messageCount) })}
                      {thread.lastMessageAt !== null ? ` · ${formatRelativeTime(thread.lastMessageAt)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
