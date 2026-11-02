import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { DmMessageWithUser, MessageWithUser } from '@backspace/shared';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { describeError } from '../../i18n/errors';
import { usePinRevision } from '../../stores/pinStore';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { Icon } from '../ui/Icon';
import { SearchResultRow } from './SearchPopover';

type AnyMessage = MessageWithUser | DmMessageWithUser;

interface PinsPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  channelId: string;
  isDm: boolean;
  /** May this person take a pin off here? The server decides; this only offers the button. */
  canUnpin: boolean;
  onJumpToMessage: (messageId: string) => void;
}

/**
 * The messages pinned in a channel or conversation, the latest pin first. It asks the
 * instance that holds the channel, and asks again while open when a pin changes or a
 * message goes (`usePinRevision`), so nobody reads a list from before.
 */
export function PinsPopover({ open, onClose, anchorRef, channelId, isDm, canUnpin, onJumpToMessage }: PinsPopoverProps) {
  const { t } = useTranslation(['chat', 'common']);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { style } = useFloatingPosition(anchorRef, popoverRef, { placement: 'bottom', offset: 8, enabled: open });
  const revision = usePinRevision((s) => s.revision);
  const [pins, setPins] = useState<AnyMessage[] | null>(null);
  const [error, setError] = useState('');
  const origin = getChannelOrigin(channelId);

  useEffect(() => {
    setPins(null);
    setError('');
  }, [open, channelId]);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    const client = getApiForOrigin(origin);
    const request: Promise<AnyMessage[]> = isDm ? client.dm.pins(channelId) : client.channels.pins(channelId);
    request
      .then((rows) => {
        if (stale) return;
        setPins(rows);
        setError('');
      })
      .catch((err: unknown) => {
        if (!stale) setError(describeError(err));
      });
    return () => { stale = true; };
  }, [open, channelId, isDm, origin, revision]);

  useEffect(() => {
    if (!open) return;
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

  const unpin = async (messageId: string) => {
    const client = getApiForOrigin(origin);
    try {
      await (isDm ? client.dm.unpinMessage(messageId) : client.messages.unpin(messageId));
      setPins((current) => current?.filter((message) => message.id !== messageId) ?? null);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      role="dialog"
      aria-label={t('chat:pins.title')}
      className="w-[420px] max-w-[calc(100*var(--app-vw)-16px)] max-h-[min(500px,calc(100*var(--app-vh)-64px))] glass rounded-lg flex flex-col animate-fade-in"
    >
      <h2 className="label-mono border-b border-border-hard px-3 py-2.5">{t('chat:pins.title')}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 scrollbar-thin">
        {error && <p role="alert" className="px-3 py-2 text-meta text-txt-danger">{error}</p>}
        {pins === null && !error && (
          <div className="flex items-center justify-center py-8" role="status" aria-label={t('common:states.loading')}>
            <div className="h-4 w-4 rounded-full border-[1.5px] border-txt-tertiary border-r-transparent animate-spin" />
          </div>
        )}
        {pins !== null && pins.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true">
              <Icon name="pin" size={18} />
            </span>
            <p className="empty-state-title">{t('chat:pins.emptyTitle')}</p>
            <p className="empty-state-body">{t('chat:pins.emptyBody')}</p>
          </div>
        )}
        {pins !== null && pins.length > 0 && (
          <ul className="p-1.5">
            {pins.map((message) => (
              <li key={message.id} className="group/pin relative">
                <SearchResultRow msg={message} origin={origin} query="" onJumpToMessage={onJumpToMessage} />
                {canUnpin && (
                  <button
                    type="button"
                    onClick={() => void unpin(message.id)}
                    aria-label={t('chat:pins.unpin')}
                    title={t('chat:pins.unpin')}
                    className="icon-btn absolute right-1 top-1 desktop:opacity-0 desktop:group-hover/pin:opacity-100 desktop:focus-visible:opacity-100"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
