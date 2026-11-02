import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransferStore, type Transfer } from '../../stores/transferStore';
import { useFormatters } from '../../i18n/formatters';
import { Icon } from '../ui/Icon';

export function TransferIndicator() {
  const { t } = useTranslation(['uploads', 'common']);
  // Subscribe to the Map directly. `listVisible()` returns a fresh array each call,
  // which would force a re-render on every store mutation. The Map reference only
  // changes when transfers are added/removed/updated, so useMemo recomputes only
  // when needed.
  const transfersMap = useTransferStore((s) => s.transfers);
  const visible = useMemo(
    () => Array.from(transfersMap.values()).filter((t) => t.tray),
    [transfersMap],
  );

  const pause = useTransferStore((s) => s.pauseUpload);
  const resume = useTransferStore((s) => s.resumeUpload);
  const abort = useTransferStore((s) => s.abortUpload);
  const pauseDl = useTransferStore((s) => s.pauseDownload);
  const resumeDl = useTransferStore((s) => s.resumeDownload);
  const abortDl = useTransferStore((s) => s.abortDownload);
  const remove = useTransferStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside-to-close. iOS Safari does not synthesize `mousedown` from
  // touch reliably, so we listen for `touchstart` alongside `mousedown` so the
  // panel dismisses on the first tap on touch devices. Mirrors the pattern
  // used in AudioInputSection.tsx.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  const active = visible.filter(
    (t) => t.state === 'active' || t.state === 'paused' || t.state === 'queued',
  );
  const failed = visible.some((t) => t.state === 'failed');

  const badgeColor = failed ? 'bg-accent-rose' : 'bg-accent-amber';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-active={open ? 'true' : undefined}
        className="icon-btn icon-btn-lg relative"
        title={t('uploads:transfers.title')}
        aria-label={t('uploads:transfers.title')}
      >
        <Icon name="download" size={18} />
        {active.length > 0 && (
          <span className={`count-badge absolute -top-0.5 -right-0.5 ${badgeColor} text-surface-base`}>
            {active.length}
          </span>
        )}
      </button>
      {open && (
        // Desktop: anchor below the trigger via `absolute right-0 top-full`.
        // Mobile (<768px): switch to `fixed` so the panel pins to the viewport
        // right edge with an 8px margin instead of inheriting the trigger's
        // x-position. This prevents left-edge clipping on narrow viewports
        // (e.g. 320px) where the trigger sits well to the left of the
        // viewport's right edge — `right-0` would otherwise anchor the
        // panel to the trigger's right and let the 300px panel extend off
        // the left of the viewport.
        <div className="fixed right-2 top-14 desktop:absolute desktop:right-0 desktop:top-full desktop:mt-2 w-[min(300px,calc(calc(100*var(--app-vw))-16px))] glass z-50 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border-hard px-3 py-2 text-meta">
            <span className="text-txt-secondary">
              {t('uploads:transfers.count', { count: visible.length })}
            </span>
            <button
              onClick={() =>
                visible
                  .filter((t) => t.state === 'completed' || t.state === 'aborted')
                  .forEach((t) => remove(t.id))
              }
              className="text-txt-tertiary hover:text-txt-primary transition-colors"
            >
              {t('uploads:transfers.clearCompleted')}
            </button>
          </div>
          {visible.length === 0 && (
            <div className="px-3 py-6 text-center text-ui text-txt-tertiary">
              {t('uploads:transfers.empty')}
            </div>
          )}
          <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
            {visible.map((t) => (
              <TransferRow
                key={t.id}
                transfer={t}
                onPause={() => (t.type === 'upload' ? pause(t.id) : pauseDl(t.id))}
                onResume={() => {
                  if (t.type === 'upload') void resume(t.id);
                  else void resumeDl(t.id);
                }}
                onAbort={() => (t.type === 'upload' ? abort(t.id) : abortDl(t.id))}
                onDismiss={() => remove(t.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TransferRowProps {
  transfer: Transfer;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onDismiss: () => void;
}

function TransferRow({ transfer, onPause, onResume, onAbort, onDismiss }: TransferRowProps) {
  const { t } = useTranslation(['uploads', 'common']);
  const { formatBytes } = useFormatters();
  const pct =
    transfer.progress.total > 0
      ? Math.min(100, Math.round((transfer.progress.loaded / transfer.progress.total) * 100))
      : 0;
  const barColor =
    transfer.state === 'failed'
      ? 'bg-accent-rose'
      : transfer.state === 'completed'
      ? 'bg-status-online'
      : 'bg-txt-secondary';
  return (
    <div className="px-3 py-2 border-b border-border-hard last:border-none">
      <div className="flex items-center gap-1.5 text-ui">
        <Icon name={transfer.type === 'upload' ? 'upload' : 'download'} size={13} className="flex-shrink-0 text-txt-tertiary" />
        <span className="text-txt-primary truncate flex-1">{transfer.file.name}</span>
      </div>
      <div className="mt-1.5 h-[3px] bg-interactive-hover rounded-sm overflow-hidden">
        <div className={`h-full ${barColor} transition-[width]`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between items-center text-label text-txt-tertiary gap-2">
        <span className="tabular truncate">
          {transfer.state === 'completed'
            ? t('uploads:transfers.status.done')
            : transfer.state === 'failed'
            ? t('uploads:transfers.status.failed', { reason: transfer.error?.message ?? t('common:states.unknown') })
            : transfer.state === 'aborted'
            ? t('uploads:transfers.status.aborted')
            : t('uploads:transfers.status.progress', {
                loaded: formatBytes(transfer.progress.loaded),
                total: formatBytes(transfer.progress.total),
              })}
        </span>
        <span className="flex gap-2 flex-shrink-0">
          {transfer.state === 'active' && (
            <button onClick={onPause} className="hover:text-txt-primary transition-colors">
              {t('common:actions.pause')}
            </button>
          )}
          {transfer.state === 'paused' && (
            <button onClick={onResume} className="hover:text-txt-primary transition-colors">
              {t('common:actions.resume')}
            </button>
          )}
          {(transfer.state === 'active' ||
            transfer.state === 'paused' ||
            transfer.state === 'queued') && (
            <button onClick={onAbort} className="hover:text-txt-danger transition-colors">
              {t('common:actions.abort')}
            </button>
          )}
          {(transfer.state === 'completed' ||
            transfer.state === 'failed' ||
            transfer.state === 'aborted') && (
            <button onClick={onDismiss} className="hover:text-txt-primary transition-colors">
              {t('common:actions.dismiss')}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
