import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Embed } from '@backspace/shared';
import {
  BLUESKY_IMAGE_ORIGIN,
  BLUESKY_VIDEO_CDN_ORIGIN,
  BLUESKY_WEB_ORIGIN,
  blueskyPlainText,
  blueskyPostOf,
  type BlueskyAuthor,
  type BlueskyImage,
  type BlueskyLinkCard,
  type BlueskyPost,
  type BlueskyQuote,
  type BlueskyTextPart,
} from '@backspace/shared/src/bluesky';
import { api } from '../../../api/client';
import { useFormatters } from '../../../i18n/formatters';
import { useUIStore } from '../../../stores/uiStore';
import { webAddress } from '../../../utils/webAddress';
import { Avatar } from '../../ui/Avatar';
import { ExternalHostsNotice, useBlockedHost } from '../../ui/ExternalMedia';
import { Icon, type IconName } from '../../ui/Icon';
import { mediaBox } from '../mediaBox';
import { BlueskyVideo } from './BlueskyVideo';
import { GenericEmbed } from './GenericEmbed';

interface BlueskyEmbedProps {
  embed: Embed;
  /** The message's Reply and Forward, offered beside its pictures in the viewer. */
  onReply?: () => void;
  onForward?: () => void;
}

/**
 * A post on Bluesky in a message (docs/systems/embeds.md, "Bluesky posts"): who wrote it, its text
 * with its links, its pictures, video or link card, the post it quotes, and its counts. The text
 * comes from this server and shows at once; the pictures and the video come from Bluesky's own
 * servers and wait for the person's yes like any other preview's. A post labelled sensitive keeps
 * them covered, and fetches nothing, until it is asked to show them. What arrives is read again
 * (`blueskyPostOf`): a post another instance sent cannot name another host.
 */
export function BlueskyEmbed({ embed, onReply, onForward }: BlueskyEmbedProps) {
  const post = useMemo(() => blueskyPostOf(embed.post), [embed.post]);
  if (!post) return <GenericEmbed embed={embed} />;
  return <BlueskyCard post={post} onReply={onReply} onForward={onForward} />;
}

function authorName(author: BlueskyAuthor): string {
  return author.displayName || `@${author.handle}`;
}

function profileAddress(author: BlueskyAuthor): string {
  return `${BLUESKY_WEB_ORIGIN}/profile/${author.handle && author.handle !== 'handle.invalid' ? author.handle : author.did}`;
}

function BlueskyCard({ post, onReply, onForward }: { post: BlueskyPost; onReply?: () => void; onForward?: () => void }) {
  const { t } = useTranslation('chat');
  const f = useFormatters();
  const [revealed, setRevealed] = useState(!post.sensitive);
  const name = authorName(post.author);
  // Bluesky's hosts, each asked only for what this post holds: a video plays from its video host
  // and from the CDN that host hands the player on to.
  const blockedImages = useBlockedHost(post.images.length > 0 ? post.images[0]!.thumb : null);
  const blockedVideo = useBlockedHost(post.video ? post.video.playlist : null);
  const blockedVideoCdn = useBlockedHost(post.video ? `${BLUESKY_VIDEO_CDN_ORIGIN}/` : null);
  const picturesAllowed = useBlockedHost(`${BLUESKY_IMAGE_ORIGIN}/`) === null;
  const blocked = [...new Set([blockedImages, blockedVideo, blockedVideoCdn].filter((host): host is string => host !== null))];
  const hasMedia = post.images.length > 0 || post.video !== null;

  const openPictures = (index: number) => {
    useUIStore.getState().openMediaViewer({
      items: post.images.map((image, at) => ({
        url: image.fullsize,
        thumb: image.thumb,
        alt: image.alt || null,
        pageUrl: post.url,
        loadFile: () => api.embeds.blueskyPicture(image.fullsize),
        filename: `bluesky-${post.author.handle}-${at + 1}`,
      })),
      index,
      onReply,
      onForward,
    });
  };

  return (
    <article className="surface-card max-w-[400px] overflow-hidden rounded-lg" aria-label={t('embed.bluesky.label', { name })}>
      <header className="flex items-start gap-2.5 px-3 pt-3">
        <Avatar src={post.author.avatar} name={name} size={32} userId={post.author.did} />
        <div className="min-w-0 flex-1">
          <a
            href={webAddress(profileAddress(post.author))}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-ui font-medium text-txt-primary hover:underline"
          >
            {name}
          </a>
          <div className="truncate font-mono text-label text-txt-tertiary">@{post.author.handle}</div>
        </div>
        <span className="flex-shrink-0 font-mono text-label text-txt-tertiary">{t('embed.bluesky.provider')}</span>
      </header>

      {post.text.length > 0 && (
        <p className="whitespace-pre-wrap break-words px-3 pt-2 text-ui leading-snug text-txt-primary">
          <PostText parts={post.text} />
        </p>
      )}

      {hasMedia && (
        <div className="px-3 pt-2.5">
          {!revealed ? (
            <SensitiveCover onShow={() => setRevealed(true)} />
          ) : blocked.length > 0 ? (
            <ExternalHostsNotice hosts={blocked} />
          ) : post.video ? (
            <BlueskyVideo video={post.video} postUrl={post.url} />
          ) : (
            <PostImages images={post.images} onOpen={openPictures} />
          )}
        </div>
      )}

      {post.link && <LinkCard link={post.link} showThumb={picturesAllowed && revealed} />}
      {post.quote && <QuoteCard quote={post.quote} showImages={picturesAllowed && revealed} />}

      <footer className="flex items-center gap-3 px-3 pb-2.5 pt-2.5 font-mono text-label text-txt-tertiary">
        <Count icon="message" value={post.replies} label={t('embed.bluesky.replies', { count: post.replies })} />
        <Count icon="repost" value={post.reposts} label={t('embed.bluesky.reposts', { count: post.reposts })} />
        <Count icon="heart" value={post.likes} label={t('embed.bluesky.likes', { count: post.likes })} />
        <a
          href={webAddress(post.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto truncate hover:text-txt-primary hover:underline"
        >
          {post.createdAt !== null ? f.formatDateTime(post.createdAt) : t('embed.bluesky.open')}
        </a>
      </footer>
    </article>
  );
}

/** A post's text: plain runs, and links, mentions and hashtags that open on their site. */
function PostText({ parts }: { parts: readonly BlueskyTextPart[] }) {
  return (
    <>
      {parts.map((part, at) => {
        const href = part.href ? webAddress(part.href) : undefined;
        return href
          ? <a key={at} href={href} target="_blank" rel="noopener noreferrer" className="text-accent-soft hover:underline">{part.text}</a>
          : <React.Fragment key={at}>{part.text}</React.Fragment>;
      })}
    </>
  );
}

function SensitiveCover({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-soft bg-surface-input px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-ui text-txt-secondary">
        <Icon name="eye-off" size={16} className="flex-shrink-0 text-txt-tertiary" />
        {t('embed.bluesky.sensitive')}
      </span>
      <button type="button" onClick={onShow} className="btn-outline btn-sm flex-shrink-0">{t('embed.bluesky.show')}</button>
    </div>
  );
}

/**
 * A post's one to four pictures: one at its own shape (`mediaBox`), several in a grid of the
 * shape Bluesky gives them, each opening the viewer on itself with the others beside it.
 */
function PostImages({ images, onOpen }: { images: readonly BlueskyImage[]; onOpen: (index: number) => void }) {
  const { t } = useTranslation('chat');
  const label = (image: BlueskyImage, at: number) => image.alt || t('embed.bluesky.picture', { index: at + 1, total: images.length });

  if (images.length === 1) {
    const image = images[0]!;
    return (
      <button
        type="button"
        onClick={() => onOpen(0)}
        aria-label={label(image, 0)}
        className="block max-w-full overflow-hidden rounded-md bg-surface-input"
        style={mediaBox(image.width, image.height)}
      >
        <img src={image.thumb} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" className="block h-full max-h-[300px] w-full object-cover" />
      </button>
    );
  }

  return (
    <div className="grid aspect-[16/9] w-full grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-md bg-surface-input">
      {images.map((image, at) => (
        <button
          key={image.fullsize}
          type="button"
          onClick={() => onOpen(at)}
          aria-label={label(image, at)}
          className={`relative min-h-0 overflow-hidden ${
            images.length === 2 || (images.length === 3 && at === 0) ? 'row-span-2' : ''
          }`}
        >
          <img src={image.thumb} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return address;
  }
}

/** A link the post carries as a card: its picture only once Bluesky's picture host is allowed. */
function LinkCard({ link, showThumb }: { link: BlueskyLinkCard; showThumb: boolean }) {
  return (
    <a
      href={webAddress(link.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="mx-3 mt-2.5 flex overflow-hidden rounded-md border border-border-soft transition-colors hover:border-interactive-muted"
    >
      <div className="min-w-0 flex-1 px-2.5 py-2">
        <div className="truncate font-mono text-label text-txt-tertiary">{hostOf(link.url)}</div>
        {link.title && <div className="line-clamp-2 text-ui font-medium leading-snug text-txt-primary">{link.title}</div>}
        {link.description && <div className="mt-0.5 line-clamp-2 text-meta leading-snug text-txt-secondary">{link.description}</div>}
      </div>
      {showThumb && link.thumb && (
        <img src={link.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-auto w-20 flex-shrink-0 object-cover" />
      )}
    </a>
  );
}

/** The post this one quotes, as a card that opens it on Bluesky. */
function QuoteCard({ quote, showImages }: { quote: BlueskyQuote; showImages: boolean }) {
  const { t } = useTranslation('chat');
  const f = useFormatters();
  const name = authorName(quote.author);
  const text = blueskyPlainText(quote.text);
  return (
    <a
      href={webAddress(quote.url)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('embed.bluesky.quoted', { name })}
      className="mx-3 mt-2.5 block rounded-md border border-border-soft p-2.5 transition-colors hover:border-interactive-muted"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Avatar src={quote.author.avatar} name={name} size={18} userId={quote.author.did} />
        <span className="truncate text-meta font-medium text-txt-primary">{name}</span>
        <span className="truncate font-mono text-label text-txt-tertiary">@{quote.author.handle}</span>
        {quote.createdAt !== null && (
          <span className="ml-auto flex-shrink-0 font-mono text-label text-txt-tertiary">{f.formatMediumDate(quote.createdAt)}</span>
        )}
      </div>
      {text && <p className="mt-1 line-clamp-5 whitespace-pre-wrap break-words text-meta leading-snug text-txt-secondary">{text}</p>}
      {showImages && quote.images.length > 0 && (
        <div className="mt-2 flex gap-0.5">
          {quote.images.map((image) => (
            <img
              key={image.thumb}
              src={image.thumb}
              alt={image.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-16 w-16 rounded object-cover"
            />
          ))}
        </div>
      )}
    </a>
  );
}

function Count({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  const { formatCompactNumber } = useFormatters();
  if (value <= 0) return null;
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1" title={label} aria-label={label}>
      <Icon name={icon} size={14} />
      <span aria-hidden="true">{formatCompactNumber(value)}</span>
    </span>
  );
}
