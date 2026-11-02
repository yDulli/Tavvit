import React from 'react';
import type { Embed } from '@backspace/shared';
import { GenericEmbed } from './embeds/GenericEmbed';
import { VideoEmbed } from './embeds/VideoEmbed';
import { ImageEmbed } from './embeds/ImageEmbed';
import { RichEmbed } from './embeds/RichEmbed';
import { ExternalGate } from '../ui/ExternalMedia';
import { webAddress } from '../../utils/webAddress';

interface EmbedRendererProps {
  embed: Embed;
}

export function EmbedRenderer({ embed }: EmbedRendererProps) {
  switch (embed.embedType) {
    case 'video':
      // i18n-check: allow-literal (switch/case punctuation between JSX returns, not text)
      return <VideoEmbed embed={embed} />;

    case 'image':
      // i18n-check: allow-literal (switch/case punctuation between JSX returns, not text)
      return <ImageEmbed embed={embed} />;

    case 'audio':
      return (
        <div className="surface-card max-w-[400px] rounded-lg p-2.5">
          {embed.title && (
            <a
              href={webAddress(embed.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2 block truncate text-body font-medium text-txt-primary hover:underline"
            >
              {embed.title}
            </a>
          )}
          <ExternalGate url={embed.url}>
            <audio
              src={webAddress(embed.url)}
              controls
              preload="metadata"
              className="h-8 w-full"
            />
          </ExternalGate>
        </div>
      );

    case 'rich':
      // i18n-check: allow-literal (switch/case punctuation between JSX returns, not text)
      return <RichEmbed embed={embed} />;

    case 'generic':
    default:
      return <GenericEmbed embed={embed} />;
  }
}
