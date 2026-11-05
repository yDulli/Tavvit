import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { saveImage, copyImageToClipboard } from '../../utils/imageActions';
import { isElectron } from '../../platform/platform';
import { Icon } from '../ui/Icon';

export function ImagePreview() {
  const { t } = useTranslation(['chat', 'common']);
  const imageUrl = useUIStore((s) => s.imagePreviewUrl);
  const closeImagePreview = useUIStore((s) => s.closeImagePreview);
  const activeModal = useUIStore((s) => s.activeModal);

  if (activeModal !== 'imagePreview' || !imageUrl) return null;

  // Fixed positioning escapes App's 32px title bar and 1px divider. Keep the
  // preview below that native-control area without changing browser layout.
  const topInsetClass = isElectron() ? 'top-[var(--titlebar-inset)]' : 'top-0';

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[200] flex items-center justify-center bg-black/80 animate-fade-in cursor-pointer ${topInsetClass}`}
      onClick={closeImagePreview}
    >
      {/* Toolbar: download, copy, close */}
      <div className="glass absolute top-3 right-3 z-10 flex items-center gap-px rounded-lg p-0.5 cursor-default" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-btn icon-btn-lg text-txt-secondary"
          onClick={() => saveImage(imageUrl)}
          aria-label={t('chat:preview.save')}
        >
          <Icon name="download" size={18} />
        </button>
        <button
          className="icon-btn icon-btn-lg text-txt-secondary"
          onClick={() => copyImageToClipboard(imageUrl)}
          aria-label={t('chat:preview.copy')}
        >
          <Icon name="copy" size={18} />
        </button>
        <button
          className="icon-btn icon-btn-lg text-txt-secondary"
          onClick={closeImagePreview}
          aria-label={t('common:actions.close')}
        >
          <Icon name="x" size={18} />
        </button>
      </div>
      <img
        src={imageUrl}
        alt={t('chat:preview.alt')}
        className="max-w-[calc(90*var(--app-vw))] max-h-[calc(90*var(--app-vh))] object-contain rounded-lg cursor-default"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
