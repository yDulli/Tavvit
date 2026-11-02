import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TransferState } from '../../stores/transferStore';
import { useFormatters } from '../../i18n/formatters';
import { Icon } from '../ui/Icon';

interface Props {
  loaded: number;
  total: number;
  state: TransferState;
  filename: string;
  /** Optional human-readable error, shown in the tile and as a tooltip when state==='failed'. */
  error?: string;
  onPause?: () => void;
  onResume?: () => void;
  onAbort?: () => void;
  size?: 'tile' | 'pill';
}

/** A small button on a picture: legible over anything the picture holds. */
const OVERLAY_BUTTON = 'flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white transition-colors hover:bg-black/80 active:bg-black/90';

export function AttachmentProgress({ loaded, total, state, filename, error, onPause, onResume, onAbort, size = 'tile' }: Props) {
  const { t } = useTranslation(['chat', 'common']);
  const { formatBytes, formatPercent } = useFormatters();
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const failed = state === 'failed';
  const isFinal = state === 'completed' || state === 'aborted';
  // Paused is the same ring turned down, so it cannot be taken for progress.
  const ringColor = state === 'paused' ? 'rgb(var(--text-tertiary))' : 'rgb(var(--text-primary))';
  const ringTrack = 'rgb(255 255 255 / 0.15)';
  const ringTitle = failed
    ? error
    : state === 'paused'
      ? t('chat:attachment.progress.pausedTitle', { percent: formatPercent(pct) })
      : undefined;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/70 pointer-events-auto">
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${failed ? 'bg-accent-rose/30' : ''}`}
        style={failed ? undefined : { background: `conic-gradient(${ringColor} ${pct}%, ${ringTrack} ${pct}%)` }}
        title={ringTitle}
      >
        <div className="tabular flex h-7 w-7 items-center justify-center whitespace-nowrap rounded-full bg-surface-input font-mono text-2xs text-txt-primary">
          {state === 'paused' ? (
            <Icon name="pause" size={12} strokeWidth={2.25} />
          ) : failed ? (
            <Icon name="alert" size={16} className="text-txt-danger" />
          ) : (
            formatPercent(pct)
          )}
        </div>
      </div>
      {size === 'tile' && (
        <div className="w-full px-2 text-center text-2xs leading-tight text-txt-primary">
          <div className="truncate">{filename}</div>
          {failed
            ? <div className="line-clamp-2 text-txt-danger">{error ?? t('chat:message.upload.failed')}</div>
            : <div className="tabular truncate font-mono text-txt-secondary">{formatBytes(loaded)} / {formatBytes(total)}</div>}
        </div>
      )}
      {!isFinal && (
        <div className="absolute top-1 right-1 flex gap-1">
          {state === 'paused' && onResume && (
            <button onClick={onResume} className={OVERLAY_BUTTON} aria-label={t('common:actions.resume')}>
              <Icon name="play" size={12} strokeWidth={2} />
            </button>
          )}
          {state === 'active' && onPause && (
            <button onClick={onPause} className={OVERLAY_BUTTON} aria-label={t('common:actions.pause')}>
              <Icon name="pause" size={12} strokeWidth={2.25} />
            </button>
          )}
          {onAbort && (
            <button onClick={onAbort} className={OVERLAY_BUTTON} aria-label={t('common:actions.abort')}>
              <Icon name="x" size={12} strokeWidth={2.25} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
