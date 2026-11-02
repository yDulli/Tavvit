import { ExternalImage } from '../../ui/ExternalMedia';
import { webAddress } from '../../../utils/webAddress';
import React from 'react';
import type { Embed } from '@backspace/shared';

interface GenericEmbedProps {
  embed: Embed;
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function GenericEmbed({ embed }: GenericEmbedProps) {
  if (!embed.title) return null;

  const providerName = embed.provider ?? hostnameFromUrl(embed.url);

  return (
    <div className="surface-card flex max-w-[400px] overflow-hidden rounded-lg">
      <div className="min-w-0 flex-1 px-3 py-2.5">
        {providerName && (
          <div className="mb-0.5 truncate font-mono text-label text-txt-tertiary">
            {providerName}
          </div>
        )}
        <a
          href={webAddress(embed.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-body font-medium leading-snug text-txt-primary hover:underline"
        >
          {embed.title}
        </a>
        {embed.description && (
          <div className="mt-1 line-clamp-2 text-ui leading-snug text-txt-secondary">
            {embed.description}
          </div>
        )}
      </div>
      {embed.image && (
        <div data-embed-thumbnail className="my-2.5 mr-2.5 h-20 w-20 flex-shrink-0">
          <ExternalImage
            compact
            placeholderClassName="h-full w-full"
            src={embed.image}
            alt=""
            className="h-full w-full rounded-md object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}
