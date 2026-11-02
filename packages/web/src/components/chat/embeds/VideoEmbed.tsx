import { ExternalGate, ExternalImage } from '../../ui/ExternalMedia';
import { externalHostOf } from '../../../stores/externalMediaStore';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Embed } from '@backspace/shared';
import { Icon } from '../../ui/Icon';
import { providerLabel as labelOf } from './providerLabel';

interface VideoEmbedProps {
  embed: Embed;
}

export function VideoEmbed({ embed }: VideoEmbedProps) {
  const { t } = useTranslation(['chat', 'legal']);
  const [isPlaying, setIsPlaying] = useState(false);

  // Direct video URL — no provider, no embedUrl
  if (!embed.provider && !embed.embedUrl) {
    return (
      <ExternalGate url={embed.url}>
        <div
          className="max-w-[400px] overflow-hidden rounded-lg border border-border-hard bg-surface-input"
          style={{ aspectRatio: '16/9' }}
        >
          <video
            src={embed.url}
            controls
            preload="none"
            className="h-full w-full"
          />
        </div>
      </ExternalGate>
    );
  }

  // Provider iframe (YouTube / Vimeo)
  const providerLabel = labelOf(embed.provider);

  return (
    <div className="surface-card max-w-[400px] overflow-hidden rounded-lg">
      {/* 16:9 video area */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        {isPlaying && embed.embedUrl ? (
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`${embed.embedUrl}?autoplay=1&origin=${encodeURIComponent(window.location.origin)}`}
            title={embed.title ?? t('embed.videoTitle')}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            data-embed-thumbnail
            onClick={() => setIsPlaying(true)}
            className="group absolute inset-0 flex h-full w-full items-center justify-center -outline-offset-2"
            aria-label={embed.title ? t('embed.playNamed', { title: embed.title }) : t('embed.playUnnamed')}
          >
            {embed.image ? (
              <ExternalImage
                whileBlocked={(
                  <>
                    <span className="absolute inset-0 bg-black/60" />
                    <span className="absolute inset-x-2 bottom-2 text-center text-label text-white/80">
                      {t('legal:external.playLoads', { name: providerLabel ?? externalHostOf(embed.embedUrl) ?? '' })}
                    </span>
                  </>
                )}
                src={embed.image}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="absolute inset-0 bg-black/60" />
            )}
            {/* Play button */}
            <span className="glass-bubble relative z-10 flex h-11 w-11 items-center justify-center rounded-lg text-txt-primary transition-colors group-hover:border-interactive-muted group-hover:bg-surface-chat">
              <Icon name="play" size={18} strokeWidth={1.75} />
            </span>
          </button>
        )}
      </div>

      {/* Title / provider footer */}
      {(embed.title || providerLabel) && (
        <div className="border-t border-border-hard px-3 py-2">
          {providerLabel && (
            <div className="mb-0.5 truncate font-mono text-label text-txt-tertiary">
              {providerLabel}
            </div>
          )}
          {embed.title && (
            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="line-clamp-2 text-body font-medium leading-snug text-txt-primary hover:underline"
            >
              {embed.title}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
