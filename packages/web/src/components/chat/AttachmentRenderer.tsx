import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '@backspace/shared';
import { useUIStore } from '../../stores/uiStore';
import { useTransferStore } from '../../stores/transferStore';
import { Icon, type IconName } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { ExternalGate, useBlockedHost } from '../ui/ExternalMedia';
import { useConnectedOrigins } from '../../hooks/useConnectedOrigins';
import { useFormatters } from '../../i18n/formatters';
import { mediaBox } from './mediaBox';

interface AttachmentRendererProps {
  attachment: Attachment;
  /**
   * A picture as a cell of a gallery (`AttachmentList`): it fills a box of this
   * shape, cut to fit, instead of keeping its own proportions.
   */
  tile?: 'wide' | 'square';
}

/** The square a file's kind is drawn in, in a file tile. */
function FileGlyph({ name }: { name: IconName }) {
  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border-hard bg-surface-input text-txt-tertiary transition-colors group-hover/att:text-txt-primary">
      <Icon name={name} size={16} />
    </span>
  );
}

/**
 * A picture or video the sender marked as a spoiler, until a reader asks for it. It takes
 * the box the real one will, so opening it does not move the list
 * (message-list.md, "Embed renderer dimension contract").
 */
function SpoilerCover({ attachment, previewUrl, tile, onReveal }: {
  attachment: Attachment;
  previewUrl: string | null;
  tile: AttachmentRendererProps['tile'];
  onReveal: () => void;
}) {
  const { t } = useTranslation(['chat']);
  const box = tile ? undefined : mediaBox(attachment.width, attachment.height, { enlarge: attachment.mimetype.startsWith('video/') });
  const shape = tile === 'wide' ? 'aspect-[4/3] w-full' : tile === 'square' ? 'aspect-square w-full' : 'max-w-[min(100%,400px)]';
  return (
    <div className={tile ? 'min-w-0' : 'max-w-fit'}>
      <button
        type="button"
        onClick={onReveal}
        aria-label={t('chat:spoiler.revealAttachment', { name: attachment.originalName })}
        className={`spoiler-cover ${shape}`}
        style={box}
      >
        {previewUrl && <img src={previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
        <span className="spoiler-cover-label">{t('chat:spoiler.label')}</span>
      </button>
    </div>
  );
}

/** Format a duration in seconds as `m:ss` (or `h:mm:ss` for long clips). */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Whether *this* browser can decode HEVC (H.265) in a <video> element.
 *
 * Web-playability of HEVC is browser-dependent, so the server's `playable`
 * flag (computed Chromium-first) can't be authoritative for every client:
 * WebKit (Safari on macOS/iOS) decodes HEVC via the OS, while Chromium,
 * Firefox and stock Electron cannot. HEVC is the codec that the server's
 * "unplayable" verdict effectively hinges on, so we probe for it here and let
 * capable browsers attempt playback rather than blindly showing the fallback.
 *
 * Computed once at module load. `canPlayType` returns '' when unsupported and
 * 'maybe'/'probably' otherwise; Safari reports support for the hvc1/hev1 tags.
 */
const BROWSER_SUPPORTS_HEVC: boolean = (() => {
  if (typeof document === 'undefined') return false;
  const v = document.createElement('video');
  return v.canPlayType('video/mp4; codecs="hvc1"') !== '' ||
    v.canPlayType('video/mp4; codecs="hev1"') !== '';
})();

/**
 * Resolves the displayable URL for an attachment. Same logic used by inline
 * `<img>`/`<video>`/`<audio>` rendering and the file-card download button —
 * exported so right-click menus can use it without duplicating the rule.
 */
export function attUrlOf(filename: string): string {
  if (filename.startsWith('http') || filename.startsWith('/')) return filename;
  return `/api/uploads/${filename}`;
}

interface VideoAttachmentProps {
  attachment: Attachment;
  attUrl: string;
  thumbUrl: string | null;
  federationInlineBadge: React.ReactNode;
}

/**
 * Video attachment with a graceful fallback for formats the browser can't
 * decode. The dominant case is a macOS screen recording (HEVC inside a .mov):
 * the upload succeeds and a server-side poster is generated, but inline
 * `<video>` playback silently fails (stuck at 0:00). We resolve this two ways:
 *
 *   1. Proactive — the server classifies web-playability from the probed codec
 *      (`attachment.playable === false`), so we render the download card
 *      directly with no flash of a dead player. This is honoured only when the
 *      current browser also can't decode the format: the server flag is
 *      Chromium-first, but WebKit (Safari/iOS) decodes HEVC, so a Safari user
 *      still gets inline playback (see `BROWSER_SUPPORTS_HEVC`).
 *   2. Reactive — for the optimistic/unknown cases, and for capable browsers
 *      attempting a flagged file, the `<video>` `onError` handler flips to the
 *      same card if playback actually fails at runtime.
 *
 * The fallback card surfaces the poster (still a useful preview), filename,
 * duration and size, and a one-tap download — never a silently broken player.
 */
function VideoAttachment({ attachment, attUrl, thumbUrl, federationInlineBadge }: VideoAttachmentProps) {
  const { t } = useTranslation(['chat']);
  const { formatBytes } = useFormatters();
  const startDownload = useTransferStore((s) => s.startDownload);
  // Pre-fail only when the server flagged it unplayable AND this browser can't
  // decode it anyway. Capable browsers (Safari/WebKit ⇒ HEVC) attempt playback
  // and fall back via onError if it genuinely fails.
  const [failed, setFailed] = useState(attachment.playable === false && !BROWSER_SUPPORTS_HEVC);

  const { width, height, originalName, mimetype, size, duration } = attachment;
  const hasDimensions = !!(width && height);
  const sizing = mediaBox(width, height, { enlarge: true });

  if (failed) {
    const meta = [duration ? formatDuration(duration) : null, formatBytes(size)]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="max-w-[400px]">
        <button
          type="button"
          onClick={() => {
            void startDownload(attUrl, { filename: originalName, size, mimetype, tray: true });
          }}
          className="surface-card group/att block w-full overflow-hidden rounded-lg text-left transition-colors -outline-offset-2 hover:border-border-soft hover:bg-interactive-hover active:bg-interactive-active"
        >
          {thumbUrl && (
            <div className="relative mx-auto max-w-full" style={sizing}>
              <img
                src={thumbUrl}
                alt={originalName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 text-white">
                <Icon name="download" size={24} />
                <span className="text-meta font-medium">{t('chat:attachment.video.cannotPlayDownload')}</span>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            {!thumbUrl && <FileGlyph name="video" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-ui font-medium text-txt-primary group-hover/att:underline">{originalName}</p>
              <p className="truncate text-meta text-txt-tertiary">
                {meta ? <span className="tabular font-mono text-label">{meta} · </span> : null}{t('chat:attachment.video.unsupportedFormat')}
              </p>
            </div>
            <Icon name="download" size={16} className="flex-shrink-0 text-txt-tertiary transition-colors group-hover/att:text-txt-primary" />
          </div>
        </button>
        {federationInlineBadge && <div className="mt-1">{federationInlineBadge}</div>}
      </div>
    );
  }

  return (
    <div className="max-w-[400px]">
      <div
        className="relative max-w-full overflow-hidden rounded-lg border border-border-hard bg-surface-input"
        style={sizing}
      >
        <video
          controls
          preload={hasDimensions ? 'none' : 'metadata'}
          poster={thumbUrl ?? undefined}
          src={attUrl}
          onError={() => setFailed(true)}
          className="h-full w-full"
        >
          {t('chat:attachment.video.unsupportedBrowser')}
        </video>
      </div>
      {federationInlineBadge && <div className="mt-1">{federationInlineBadge}</div>}
    </div>
  );
}

/**
 * Whether a cell of a gallery of `count` pictures sits in a row of two rather
 * than three. Rows of two come first and take the larger pictures, so a gallery
 * never ends on a lone one: five is two over three, seven is two, two and three.
 */
function inRowOfTwo(index: number, count: number): boolean {
  const rowsOfTwo = count % 3 === 1 ? 2 : count % 3 === 2 ? 1 : 0;
  return index < rowsOfTwo * 2;
}

/**
 * The attachments of a message, in their order. A run of two or more pictures
 * is a gallery; everything else stands on its own line.
 */
export function AttachmentList({ attachments }: { attachments: readonly Attachment[] }) {
  const runs: Attachment[][] = [];
  for (const attachment of attachments) {
    const isImage = attachment.mimetype.startsWith('image/');
    const last = runs[runs.length - 1];
    if (isImage && last?.[0]?.mimetype.startsWith('image/')) last.push(attachment);
    else runs.push([attachment]);
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      {runs.map((run) => (run.length === 1
        ? <AttachmentRenderer key={run[0]!.id} attachment={run[0]!} />
        : (
          <div key={run[0]!.id} className="grid w-[400px] max-w-full grid-cols-6 gap-1">
            {run.map((attachment, index) => {
              const wide = inRowOfTwo(index, run.length);
              return (
                <div key={attachment.id} className={wide ? 'col-span-3' : 'col-span-2'}>
                  <AttachmentRenderer attachment={attachment} tile={wide ? 'wide' : 'square'} />
                </div>
              );
            })}
          </div>
        )))}
    </div>
  );
}

export function AttachmentRenderer({ attachment, tile }: AttachmentRendererProps) {
  const { t } = useTranslation(['chat']);
  const { formatBytes } = useFormatters();
  const openImagePreview = useUIStore((s) => s.openImagePreview);
  const startDownload = useTransferStore((s) => s.startDownload);

  const attUrl = attUrlOf(attachment.filename);

  const thumbUrl = attachment.thumbnailFilename
    ? attachment.thumbnailFilename.startsWith('http') || attachment.thumbnailFilename.startsWith('/')
      ? attachment.thumbnailFilename
      : `/api/uploads/${attachment.thumbnailFilename}`
    : null;

  const { mimetype, originalName, size } = attachment;
  const [revealed, setRevealed] = useState(false);

  // A file from a peer that has not arrived here yet is an address on that peer's server: fetched
  // only after a yes, as anything from another server is (docs/systems/legal.md), unless this
  // client talks to that server anyway. Downloading it stays a click of its own.
  const trustedOrigins = useConnectedOrigins();
  const attBlocked = useBlockedHost(attUrl, trustedOrigins);
  const thumbBlocked = useBlockedHost(thumbUrl, trustedOrigins);
  const gateUrl = attBlocked ? attUrl : thumbBlocked ? thumbUrl : null;
  const gated = (node: React.ReactElement): React.ReactElement => (
    gateUrl ? <ExternalGate url={gateUrl} trustedOrigins={trustedOrigins}>{node}</ExternalGate> : node
  );

  if (attachment.spoiler && !revealed && (mimetype.startsWith('image/') || mimetype.startsWith('video/'))) {
    return (
      <SpoilerCover
        attachment={attachment}
        previewUrl={gateUrl ? null : thumbUrl ?? (mimetype.startsWith('image/') ? attUrl : null)}
        tile={tile}
        onReveal={() => setRevealed(true)}
      />
    );
  }

  // Federation status — build tooltip text
  const federationTooltip = (() => {
    if (!attachment.federationStatus) return null;

    if (attachment.federationStatus === 'remote') {
      let senderName: string | null = null;
      if (attachment.federationMeta) {
        try {
          const meta = JSON.parse(attachment.federationMeta);
          if (meta.sourceUsername) senderName = meta.sourceUsername;
        } catch { /* ignore */ }
      }
      const text = senderName
        ? t('chat:attachment.federation.remoteNamed', { sender: senderName })
        : t('chat:attachment.federation.remoteUnknown');
      return { text, type: 'remote' as const };
    }

    if (attachment.federationStatus === 'remote_partial') {
      let text = t('chat:attachment.federation.partialGeneric');
      if (attachment.federationMeta) {
        try {
          const meta: Array<{ username: string; limit: number }> = JSON.parse(attachment.federationMeta);
          if (meta.length > 0) {
            const parts = meta.map(u =>
              t('chat:attachment.federation.partialInstance', { username: u.username, limit: formatBytes(u.limit) }),
            );
            const instances = parts.reduce((first, second) =>
              t('chat:attachment.federation.listPair', { first, second }),
            );
            text = t('chat:attachment.federation.partialList', { instances });
          }
        } catch { /* ignore */ }
      }
      return { text, type: 'remote_partial' as const };
    }

    return null;
  })();

  // Inline badge — sits next to file size or below media, never absolute-positioned
  const federationInlineBadge = federationTooltip ? (
    <Tooltip content={federationTooltip.text} position="top">
      <div className={`inline-flex items-center gap-1 px-1 py-px rounded glass-pill text-meta cursor-default ${federationTooltip.type === 'remote' ? 'text-txt-tertiary' : 'text-accent-amber'}`}>
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {federationTooltip.type === 'remote'
            ? <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            : <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
          }
        </svg>
      </div>
    </Tooltip>
  ) : null;

  if (mimetype.startsWith('image/')) {
    const box = tile ? undefined : mediaBox(attachment.width, attachment.height);
    const shape = tile === 'wide' ? 'aspect-[4/3] w-full' : tile === 'square' ? 'aspect-square w-full' : 'max-w-[min(100%,400px)]';
    return gated(
      <div className={tile ? 'min-w-0' : 'max-w-fit'}>
        <button
          type="button"
          onClick={() => openImagePreview(attUrl)}
          aria-label={originalName}
          className={`block overflow-hidden rounded-lg border border-border-hard bg-surface-input transition-colors -outline-offset-2 hover:border-interactive-muted ${shape}`}
          style={box}
        >
          <img
            src={thumbUrl ?? attUrl}
            data-sticker-source={attUrl}
            alt={originalName}
            // A box from the file's own size is its shape already, less the hairline.
            className={tile || box ? 'h-full w-full object-cover' : 'max-h-[300px] object-contain'}
            loading="lazy"
          />
        </button>
        {federationInlineBadge && <div className="mt-1">{federationInlineBadge}</div>}
      </div>,
    );
  }

  if (mimetype.startsWith('video/')) {
    return gated(
      <VideoAttachment
        attachment={attachment}
        attUrl={attUrl}
        thumbUrl={thumbUrl}
        federationInlineBadge={federationInlineBadge}
      />,
    );
  }

  if (mimetype.startsWith('audio/') && attachment.voiceWaveform) {
    return gated(<VoiceMessagePlayer url={attUrl} bars={attachment.voiceWaveform} duration={attachment.duration} />);
  }

  if (mimetype.startsWith('audio/')) {
    return gated(
      <div className="surface-card flex max-w-[400px] flex-col gap-2 rounded-lg p-2.5">
        <div className="flex items-center gap-2.5">
          <FileGlyph name="music" />
          <div className="min-w-0">
            <p className="truncate text-ui font-medium text-txt-primary">{originalName}</p>
            <div className="flex items-center gap-2">
              <p className="tabular font-mono text-label text-txt-tertiary">{formatBytes(size)}</p>
              {federationInlineBadge}
            </div>
          </div>
        </div>
        <audio controls preload="metadata" className="h-8 w-full">
          <source src={attUrl} type={mimetype} />
          {t('chat:attachment.audio.unsupportedBrowser')}
        </audio>
      </div>,
    );
  }

  // Generic-file chip (PDF / .zip / .exe / unknown mimetypes).
  //
  // Width contract: the chip must fit inside the message column on every
  // viewport. We cap at 400 px on roomy layouts but `max-w-full` keeps it
  // inside narrow columns (mobile, narrow desktop window, threaded reply
  // contexts). `min-w-0` is the critical bit on the inner flex children — the
  // outer button is a flex container with a fixed-size icon and a flexible
  // text block; without `min-w-0` the long-filename child would refuse to
  // shrink (flex children's min-content size defaults to their intrinsic
  // content) and would push the entire chip past the parent's right edge.
  return (
    <button
      type="button"
      onClick={() => {
        void startDownload(attUrl, {
          filename: originalName,
          size,
          mimetype,
          tray: true,
        });
      }}
      className="surface-card group/att flex w-full min-w-0 max-w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors -outline-offset-2 hover:border-border-soft hover:bg-interactive-hover active:bg-interactive-active desktop:max-w-[400px]"
    >
      <FileGlyph name="file" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-medium text-txt-primary group-hover/att:underline">{originalName}</p>
        <div className="flex flex-wrap items-center gap-2">
          <p className="tabular font-mono text-label text-txt-tertiary">{formatBytes(size)}</p>
          {federationInlineBadge}
        </div>
      </div>
      <Icon name="download" size={16} className="flex-shrink-0 text-txt-tertiary transition-colors group-hover/att:text-txt-primary" />
    </button>
  );
}
