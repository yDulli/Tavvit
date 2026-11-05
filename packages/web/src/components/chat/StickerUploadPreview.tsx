import { useId, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { MAX_STICKER_NAME_LENGTH } from '@backspace/shared/src/stickers';
import { Icon } from '../ui/Icon';

export interface UploadItem {
  id: string;
  file: File;
  preview: string;
  name: string;
  ready: boolean;
  /** Why the server refused this image on the last submit, already in the reader's language. */
  error: string | null;
}


interface StickerUploadPreviewProps {
  items: UploadItem[];
  busy: boolean;
  dragging: boolean;
  chooseRef: RefObject<HTMLButtonElement>;
  openPicker: (mode: 'replace' | 'append') => void;
  choose: (files: File[], mode: 'replace' | 'append') => void;
  setDragging: (dragging: boolean) => void;
  markReady: (id: string, ready: boolean) => void;
  updateName: (id: string, name: string) => void;
  removeItem: (id: string) => void;
  setError: (error: string) => void;
}

/** Preview-only controls never upload bytes; confirmation belongs to the parent form. */
export function StickerUploadPreview({
  items, busy, dragging, chooseRef, openPicker, choose,
  setDragging, markReady, updateName, removeItem, setError,
}: StickerUploadPreviewProps) {
  const { t } = useTranslation('chat');
  const { formatBytes } = useFormatters();
  const nameId = useId();
  const singleItem = items.length === 1 ? items[0] : null;
  return <>
        {items.length === 0 && (
          <button
            ref={chooseRef}
            type="button"
            disabled={busy}
            onClick={() => openPicker('replace')}
            aria-label={t('stickers.chooseImage')}
            onDragOver={event => {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) setDragging(true);
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={event => {
              event.preventDefault();
              event.stopPropagation();
              choose(Array.from(event.dataTransfer.files), 'replace');
            }}
            className={`sticker-dropzone ${dragging ? 'sticker-dropzone-active' : ''}`}
          >
            <span className="empty-state-icon mb-0" aria-hidden="true">
              <Icon name="image" size={18} />
            </span>
            <span className="text-ui font-medium">{t('stickers.dropImage')}</span>
            <span className="text-meta text-txt-tertiary">{t('stickers.pasteHint')}</span>
          </button>
        )}

        {singleItem && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => openPicker('replace')}
              aria-label={t('stickers.replace')}
              onDragOver={event => {
                event.preventDefault();
                event.stopPropagation();
                if (!busy) setDragging(true);
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
              }}
              onDrop={event => {
                event.preventDefault();
                event.stopPropagation();
                choose(Array.from(event.dataTransfer.files), 'replace');
              }}
              className={`sticker-dropzone ${dragging ? 'sticker-dropzone-active' : ''} sticker-checkerboard`}
            >
              <img
                key={singleItem.preview}
                src={singleItem.preview}
                alt={t('stickers.preview')}
                className="h-36 w-full object-contain"
                onLoad={() => markReady(singleItem.id, true)}
                onError={() => {
                  markReady(singleItem.id, false);
                  setError(t('stickers.invalidImage'));
                }}
              />
            </button>
            <div className="flex items-center justify-between gap-3 text-meta text-txt-tertiary">
              <span className="truncate" title={singleItem.file.name}>{singleItem.file.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="text-txt-link hover:underline"
                  onClick={() => openPicker('append')}
                >
                  + {t('stickers.addMore')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="text-txt-link hover:underline"
                  onClick={() => openPicker('replace')}
                >
                  {t('stickers.replace')}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor={nameId} className="field-label">
                {t('stickers.name')}
              </label>
              <input
                id={nameId}
                value={singleItem.name}
                disabled={busy}
                maxLength={MAX_STICKER_NAME_LENGTH}
                onChange={event => updateName(singleItem.id, event.target.value)}
                className="input-search w-full"
                placeholder={t('stickers.name')}
              />
            </div>
          </>
        )}

        {items.length > 1 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-meta">
              <span className="font-medium text-txt-secondary">
                {t('stickers.selectedCount', { count: items.length })}
              </span>
              <button
                type="button"
                disabled={busy}
                className="text-meta text-txt-link hover:underline font-medium"
                onClick={() => openPicker('append')}
              >
                + {t('stickers.addMore')}
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
              {items.map((item, index) => (
                <div key={item.id} className="surface-card flex items-center gap-2.5 rounded-lg p-2">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-hard bg-surface-input sticker-checkerboard">
                    <img
                      src={item.preview}
                      alt={t('stickers.preview')}
                      className="h-full w-full object-contain"
                      onLoad={() => markReady(item.id, true)}
                      onError={() => {
                        markReady(item.id, false);
                        setError(t('stickers.invalidImage'));
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-1 text-label text-txt-tertiary">
                      <span className="truncate" title={item.file.name}>{item.file.name}</span>
                      <span className="tabular shrink-0 font-mono">{formatBytes(item.file.size)}</span>
                    </div>
                    <input
                      value={item.name}
                      disabled={busy}
                      maxLength={MAX_STICKER_NAME_LENGTH}
                      placeholder={t('stickers.name')}
                      aria-label={`${t('stickers.name')} #${index + 1}`}
                      onChange={event => updateName(item.id, event.target.value)}
                      className="input-search h-7 w-full px-2 py-0 text-meta"
                    />
                    {item.error && <p className="mt-1 text-label leading-4 text-txt-danger">{item.error}</p>}
                  </div>
                  <button
                    data-tooltip=""
                    type="button"
                    disabled={busy}
                    onClick={() => removeItem(item.id)}
                    className="sticker-icon-button shrink-0 text-txt-tertiary hover:text-txt-danger"
                    aria-label={t('stickers.removeNamed', { name: item.name || item.file.name })}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => openPicker('append')}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openPicker('append');
                }
              }}
              onDragOver={event => {
                event.preventDefault();
                event.stopPropagation();
                if (!busy) setDragging(true);
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
              }}
              onDrop={event => {
                event.preventDefault();
                event.stopPropagation();
                choose(Array.from(event.dataTransfer.files), 'append');
              }}
              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-meta text-txt-tertiary transition-colors hover:border-interactive-muted hover:text-txt-primary ${
                dragging ? 'border-accent-primary bg-accent-primary/10 text-txt-primary' : 'border-border-soft'
              }`}
            >
              <Icon name="plus" size={14} />
              <span>{t('stickers.dropMore')}</span>
            </div>
          </div>
        )}


  </>;
}
