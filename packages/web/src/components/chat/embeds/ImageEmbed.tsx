import { ExternalGate } from '../../ui/ExternalMedia';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Embed } from '@backspace/shared';
import { useUIStore } from '../../../stores/uiStore';
import { mediaBox } from '../mediaBox';

interface ImageEmbedProps {
  embed: Embed;
}

export function ImageEmbed({ embed }: ImageEmbedProps) {
  const { t } = useTranslation('chat');
  const openImagePreview = useUIStore((s) => s.openImagePreview);
  const imageUrl = embed.image ?? embed.url;
  const box = mediaBox(embed.width, embed.height);

  return (
    <div className="max-w-fit">
      <ExternalGate url={imageUrl}>
      <button
        type="button"
        onClick={() => openImagePreview(imageUrl)}
        aria-label={embed.title ?? t('preview.alt')}
        className="block max-w-[min(100%,400px)] overflow-hidden rounded-lg border border-border-hard bg-surface-input transition-colors -outline-offset-2 hover:border-interactive-muted"
        style={box}
      >
        <img
          src={imageUrl}
          alt={embed.title ?? ''}
          className={box ? 'h-full w-full object-contain' : 'max-h-[300px] object-contain'}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </button>
      </ExternalGate>
    </div>
  );
}
