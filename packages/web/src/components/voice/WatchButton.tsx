import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { useSpaceStore } from '../../stores/spaceStore';
import { useWatchStore } from '../../stores/watchStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { Icon } from '../ui/Icon';
import { WatchLinkForm } from './WatchLinkForm';

/**
 * Watching together from the call's controls (docs/systems/watch-together.md): a link for everyone in
 * the call, or for the queue when something plays. Showing a video takes the right to show one's
 * screen in the channel (STREAM); the server checks it, this only says so beforehand.
 */
export function WatchButton({ channelId, className }: { channelId: string; className: string }) {
  const { t } = useTranslation(['voice']);
  const mayShow = useSpaceStore((state) => hasPermissionBit(state.channelPermissions.get(channelId), PermissionBits.STREAM));
  const running = useWatchStore((state) => state.sessions.get(channelId)?.session.current != null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { style } = useFloatingPosition(anchorRef, popoverRef, { placement: 'top', offset: 10, enabled: open });

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        data-tooltip=""
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('voice:watch.button')}
        className={className}
      >
        <Icon name="watch" size={20} />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          style={style}
          role="dialog"
          aria-label={t('voice:watch.title')}
          className="glass z-50 flex w-[340px] max-w-[calc(100*var(--app-vw)-16px)] flex-col rounded-lg"
        >
          <h2 className="label-mono border-b border-border-hard px-3 py-2">{t('voice:watch.title')}</h2>
          <div className="p-3">
            {mayShow
              ? <WatchLinkForm channelId={channelId} running={running} onDone={() => setOpen(false)} autoFocus />
              : <p className="text-ui text-txt-tertiary">{t('voice:watch.noRight')}</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
