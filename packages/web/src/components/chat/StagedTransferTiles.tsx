import { useTranslation } from 'react-i18next';
import { useTransferStore, type Transfer } from '../../stores/transferStore';
import { useFormatters } from '../../i18n/formatters';
import { Icon } from '../ui/Icon';
import { AttachmentProgress } from './AttachmentProgress';

interface StagedTransferTilesProps {
  stagedTransfers: Transfer[];
  /** In-session image previews. MessageInput creates and revokes these URLs. */
  previewUrls: ReadonlyMap<string, string>;
  /** Unstages the transfer, cancelling its upload when it has not finished. */
  onRemove: (transferId: string) => void;
}

export function StagedTransferTiles({ stagedTransfers, previewUrls, onRemove }: StagedTransferTilesProps) {
  const { t } = useTranslation('chat');
  const { formatBytes } = useFormatters();
  const pauseUpload = useTransferStore((s) => s.pauseUpload);
  const resumeUpload = useTransferStore((s) => s.resumeUpload);
  const setSpoiler = useTransferStore((s) => s.setSpoiler);

  if (stagedTransfers.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2.5 border-b border-border-hard p-2.5">
      {stagedTransfers.map((transfer) => {
        const isImage = transfer.file.mimetype.startsWith('image/');
        const isFinal = transfer.state === 'completed';
        const showOverlay = transfer.state !== 'completed';
        const previewUrl = previewUrls.get(transfer.id);
        return (
          <div
            key={transfer.id}
            title={transfer.file.name}
            className="surface-card relative h-[104px] flex-shrink-0 rounded-lg"
          >
            {isImage ? (
              <div className="rounded-inherit flex h-full w-[120px] items-center justify-center overflow-hidden text-txt-tertiary">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={transfer.file.name}
                    className={`h-full w-full object-cover ${transfer.spoiler ? 'blur-md' : ''}`}
                  />
                ) : (
                  <Icon name="image" size={24} />
                )}
              </div>
            ) : (
              <div className="flex h-full w-[168px] flex-col justify-center gap-1.5 px-3">
                {/* While it uploads, the overlay says the same over this space. */}
                {isFinal && (
                  <>
                    <Icon name="file" size={20} className="flex-shrink-0 text-txt-tertiary" />
                    <span className="truncate text-ui font-medium text-txt-primary">{transfer.file.name}</span>
                    <span className="tabular truncate font-mono text-label text-txt-tertiary">{formatBytes(transfer.file.size)}</span>
                  </>
                )}
              </div>
            )}

            {/* Clip the overlay, not the remove chip that extends beyond the tile. */}
            {showOverlay && (
              <div className="absolute inset-0 overflow-hidden rounded-lg">
                <AttachmentProgress
                  loaded={transfer.progress.loaded}
                  total={transfer.progress.total}
                  state={transfer.state}
                  filename={transfer.file.name}
                  error={transfer.error?.message}
                  size="tile"
                  onPause={transfer.state === 'active' ? () => pauseUpload(transfer.id) : undefined}
                  onResume={transfer.state === 'paused' ? () => void resumeUpload(transfer.id) : undefined}
                  onAbort={() => onRemove(transfer.id)}
                />
              </div>
            )}

            {/* A picture or video can go out covered. */}
            {isFinal && (isImage || transfer.file.mimetype.startsWith('video/')) && (
              <button
                type="button"
                onClick={() => setSpoiler(transfer.id, transfer.spoiler !== true)}
                aria-pressed={transfer.spoiler === true}
                aria-label={t('spoiler.mark')}
                title={t('spoiler.mark')}
                className={`glass absolute -top-2 right-5 z-10 flex h-6 w-6 items-center justify-center rounded-md transition-colors ${transfer.spoiler ? 'text-accent-soft' : 'text-txt-tertiary hover:text-txt-primary'}`}
              >
                <Icon name="eye-off" size={14} />
              </button>
            )}

            {/* Remove chip, shown once the upload has completed. */}
            {isFinal && (
              <button
                onClick={() => onRemove(transfer.id)}
                className="glass absolute -top-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-md text-txt-secondary transition-colors hover:border-accent-rose/60 hover:text-txt-danger active:bg-accent-rose/20"
                aria-label={t('composer.removeAttachment')}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
