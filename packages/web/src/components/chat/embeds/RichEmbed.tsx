import { ExternalImage } from '../../ui/ExternalMedia';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Embed } from '@backspace/shared';
import { Icon } from '../../ui/Icon';
import { providerLabel as labelOf } from './providerLabel';

interface RichEmbedProps {
  embed: Embed;
}

const PROVIDER_HEIGHTS: Record<string, number> = {
  spotify: 152,
};

function getIframeHeight(embed: Embed): number {
  if (embed.height != null) return embed.height;
  if (embed.provider != null) {
    const providerHeight = PROVIDER_HEIGHTS[embed.provider];
    if (providerHeight != null) return providerHeight;
  }
  return 200;
}

export function RichEmbed({ embed }: RichEmbedProps) {
  const { t } = useTranslation('chat');
  const [isLoaded, setIsLoaded] = useState(false);
  const iframeHeight = getIframeHeight(embed);

  const providerLabel = labelOf(embed.provider);

  if (!embed.embedUrl) return null;

  return (
    <div className="surface-card max-w-[400px] overflow-hidden rounded-lg">
      {isLoaded ? (
        <iframe
          src={embed.embedUrl}
          title={embed.title ?? providerLabel ?? t('embed.frameTitle')}
          height={iframeHeight}
          className="w-full block"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsLoaded(true)}
          className="group w-full text-left transition-colors -outline-offset-2 hover:bg-interactive-hover active:bg-interactive-active"
          aria-label={providerLabel ? t('embed.loadNamed', { name: providerLabel }) : t('embed.loadUnnamed')}
        >
          <div className="flex items-start gap-2.5 p-2.5">
            {embed.image && (
              <div data-embed-thumbnail className="h-20 w-20 flex-shrink-0">
                <ExternalImage
                  whileBlocked={(
                    <span className="flex h-full w-full items-center justify-center rounded-md border border-border-hard bg-surface-input text-txt-tertiary">
                      <Icon name="music" size={20} />
                    </span>
                  )}
                  src={embed.image}
                  alt=""
                  className="h-full w-full rounded-md object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {providerLabel && (
                <div className="mb-0.5 truncate font-mono text-label text-txt-tertiary">
                  {providerLabel}
                </div>
              )}
              {embed.title && (
                <div className="line-clamp-2 text-body font-medium leading-snug text-txt-primary group-hover:underline">
                  {embed.title}
                </div>
              )}
              {embed.description && (
                <div className="mt-1 line-clamp-2 text-ui leading-snug text-txt-secondary">
                  {embed.description}
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-1.5 text-meta text-txt-secondary transition-colors group-hover:text-txt-primary">
                <Icon name="play" size={12} strokeWidth={2} />
                {t('embed.loadAction')}
              </div>
            </div>
          </div>
        </button>
      )}
    </div>
  );
}
