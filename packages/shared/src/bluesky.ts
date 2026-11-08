/**
 * Posts on Bluesky in a message (docs/systems/embeds.md, "Bluesky posts"). When a message links to
 * a post, the server reads it from Bluesky's public interface and keeps what its card shows, as
 * `Embed.post`. Every address in it is one of Bluesky's own hosts, checked where it is made and
 * again by `blueskyPostOf` wherever one arrives (from the database, or from another instance), so
 * neither a post nor a peer can make a client fetch from anywhere else.
 */

/** Bluesky's public interface for reading posts without an account. Only the server asks it. */
export const BLUESKY_API_ORIGIN = 'https://public.api.bsky.app';
/** Where Bluesky serves pictures: a person's avatar, a post's images, a link's thumbnail. */
export const BLUESKY_IMAGE_ORIGIN = 'https://cdn.bsky.app';
/** Where Bluesky serves videos, as HLS playlists with their parts beside them. */
export const BLUESKY_VIDEO_ORIGIN = 'https://video.bsky.app';
/** Bluesky's video CDN, which the video host hands a player on to for the same playlists and parts. */
export const BLUESKY_VIDEO_CDN_ORIGIN = 'https://video.cdn.bsky.app';
/** Every host a Bluesky video plays from: what the CSP lets a player reach, and what its consent covers. */
export const BLUESKY_VIDEO_ORIGINS = [BLUESKY_VIDEO_ORIGIN, BLUESKY_VIDEO_CDN_ORIGIN] as const;
/** Bluesky's web app: the addresses of posts that are recognised, and where "Open on Bluesky" leads. */
export const BLUESKY_WEB_ORIGIN = 'https://bsky.app';

export const BLUESKY_LIMITS = {
  /** A post holds at most 300 graphemes; this leaves room for long ones. */
  TEXT_MAX: 3000,
  TEXT_PARTS_MAX: 200,
  NAME_MAX: 200,
  HANDLE_MAX: 253,
  ALT_MAX: 2000,
  IMAGES_MAX: 4,
  LINK_TITLE_MAX: 300,
  LINK_DESCRIPTION_MAX: 1000,
  ADDRESS_MAX: 2048,
} as const;

export interface BlueskyAuthor {
  did: string;
  handle: string;
  displayName: string | null;
  /** On `BLUESKY_IMAGE_ORIGIN`, or null. */
  avatar: string | null;
}

/** A run of a post's text; `href` makes it a link: a web address, or a mention or hashtag on Bluesky. */
export interface BlueskyTextPart {
  text: string;
  href?: string;
}

export interface BlueskyImage {
  /** The smaller picture, for the card. */
  thumb: string;
  /** The whole picture, for the viewer. */
  fullsize: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface BlueskyVideo {
  /** The HLS playlist. */
  playlist: string;
  thumbnail: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  /** Posted as a GIF: it plays in a loop, without sound. */
  loops: boolean;
}

/** A link the post carries as a card. */
export interface BlueskyLinkCard {
  url: string;
  title: string;
  description: string;
  thumb: string | null;
}

/** A post this one quotes: its text and pictures, not its own quote or video. */
export interface BlueskyQuote {
  url: string;
  author: BlueskyAuthor;
  text: BlueskyTextPart[];
  createdAt: number | null;
  images: BlueskyImage[];
}

export interface BlueskyPost {
  /** The post on Bluesky's web app. */
  url: string;
  author: BlueskyAuthor;
  text: BlueskyTextPart[];
  createdAt: number | null;
  images: BlueskyImage[];
  video: BlueskyVideo | null;
  link: BlueskyLinkCard | null;
  quote: BlueskyQuote | null;
  /** As they stood when the server read the post. */
  replies: number;
  reposts: number;
  likes: number;
  /** Labelled as sexual, nude or graphic, by its author or by Bluesky: its pictures and video wait behind a click. */
  sensitive: boolean;
}

// ─── Addresses ───────────────────────────────────────────────────────────

const HANDLE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DID = /^did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.%:-]{1,253})$/;
const RECORD_KEY = /^[A-Za-z0-9._~:-]{1,512}$/;

/** A person on Bluesky as an address names them: a handle (`name.bsky.social`) or a DID. */
export function isBlueskyActor(value: string): boolean {
  return HANDLE.test(value) || DID.test(value);
}

export function isBlueskyDid(value: unknown): value is string {
  return typeof value === 'string' && DID.test(value);
}

export interface BlueskyPostLink {
  /** A handle in lower case, or a DID. */
  actor: string;
  /** The post's record key. */
  rkey: string;
}

/** The post a link names, when it is `https://bsky.app/profile/<handle or DID>/post/<key>`; else null. */
export function parseBlueskyPostUrl(raw: string): BlueskyPostLink | null {
  if (raw.length > BLUESKY_LIMITS.ADDRESS_MAX) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'bsky.app') return null;
  const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/);
  if (!match) return null;
  let actor: string;
  let rkey: string;
  try {
    actor = decodeURIComponent(match[1]!).toLowerCase();
    rkey = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  if (!isBlueskyActor(actor) || !RECORD_KEY.test(rkey) || rkey === '.' || rkey === '..') return null;
  return { actor, rkey };
}

/** The address of a post on Bluesky's web app, by the handle when it is a real one, else by the DID. */
export function blueskyPostUrl(author: { did: string; handle: string }, rkey: string): string {
  const actor = author.handle && author.handle !== 'handle.invalid' && HANDLE.test(author.handle) ? author.handle : author.did;
  return `${BLUESKY_WEB_ORIGIN}/profile/${actor}/post/${encodeURIComponent(rkey)}`;
}

function onOrigin(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || value.length > BLUESKY_LIMITS.ADDRESS_MAX) return null;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** A picture on Bluesky's picture host, or null for anything else. */
export function blueskyImageAddress(value: unknown): string | null {
  return onOrigin(value, BLUESKY_IMAGE_ORIGIN);
}

/** A video, or its still, on one of Bluesky's video hosts, or null for anything else. */
export function blueskyVideoAddress(value: unknown): string | null {
  return onOrigin(value, BLUESKY_VIDEO_ORIGIN) ?? onOrigin(value, BLUESKY_VIDEO_CDN_ORIGIN);
}

/** A post's address on Bluesky's web app, or null for anything else. */
export function blueskyPostAddress(value: unknown): string | null {
  const href = onOrigin(value, BLUESKY_WEB_ORIGIN);
  return href && parseBlueskyPostUrl(href) ? href : null;
}

/**
 * A link a post's text or its card points to: any web address. It opens in a new tab when clicked
 * and never loads by itself, so it may lead anywhere a link in a message may.
 */
export function blueskyLinkAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > BLUESKY_LIMITS.ADDRESS_MAX) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** A mention's address on Bluesky's web app. */
export function blueskyProfileAddress(did: string): string {
  return `${BLUESKY_WEB_ORIGIN}/profile/${did}`;
}

/** A hashtag's address on Bluesky's web app. */
export function blueskyHashtagAddress(tag: string): string {
  return `${BLUESKY_WEB_ORIGIN}/hashtag/${encodeURIComponent(tag)}`;
}

// ─── Reading one back ─────────────────────────────────────────────────────

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  return value.length > max ? value.slice(0, max) : value;
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sizeOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000 ? value : null;
}

function timeOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e15 ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function authorOf(value: unknown): BlueskyAuthor | null {
  const record = recordOf(value);
  if (!record || !isBlueskyDid(record.did)) return null;
  const handle = textOf(record.handle, BLUESKY_LIMITS.HANDLE_MAX);
  if (!handle) return null;
  const displayName = textOf(record.displayName, BLUESKY_LIMITS.NAME_MAX)?.trim() || null;
  return { did: record.did, handle, displayName, avatar: blueskyImageAddress(record.avatar) };
}

function partsOf(value: unknown): BlueskyTextPart[] {
  if (!Array.isArray(value)) return [];
  const parts: BlueskyTextPart[] = [];
  let left: number = BLUESKY_LIMITS.TEXT_MAX;
  for (const item of value.slice(0, BLUESKY_LIMITS.TEXT_PARTS_MAX)) {
    const record = recordOf(item);
    const text = record ? textOf(record.text, left) : null;
    if (!text) continue;
    const href = record && record.href !== undefined ? blueskyLinkAddress(record.href) : null;
    parts.push(href ? { text, href } : { text });
    left -= text.length;
    if (left <= 0) break;
  }
  return parts;
}

function imagesOf(value: unknown): BlueskyImage[] {
  if (!Array.isArray(value)) return [];
  const images: BlueskyImage[] = [];
  for (const item of value.slice(0, BLUESKY_LIMITS.IMAGES_MAX)) {
    const record = recordOf(item);
    const thumb = record ? blueskyImageAddress(record.thumb) : null;
    const fullsize = record ? blueskyImageAddress(record.fullsize) : null;
    if (!record || !thumb || !fullsize) continue;
    images.push({
      thumb,
      fullsize,
      alt: textOf(record.alt, BLUESKY_LIMITS.ALT_MAX) ?? '',
      width: sizeOf(record.width),
      height: sizeOf(record.height),
    });
  }
  return images;
}

function videoOf(value: unknown): BlueskyVideo | null {
  const record = recordOf(value);
  const playlist = record ? blueskyVideoAddress(record.playlist) : null;
  if (!record || !playlist) return null;
  return {
    playlist,
    thumbnail: blueskyVideoAddress(record.thumbnail) ?? blueskyImageAddress(record.thumbnail),
    alt: textOf(record.alt, BLUESKY_LIMITS.ALT_MAX) ?? '',
    width: sizeOf(record.width),
    height: sizeOf(record.height),
    loops: record.loops === true,
  };
}

function linkOf(value: unknown): BlueskyLinkCard | null {
  const record = recordOf(value);
  const url = record ? blueskyLinkAddress(record.url) : null;
  if (!record || !url) return null;
  return {
    url,
    title: textOf(record.title, BLUESKY_LIMITS.LINK_TITLE_MAX) ?? '',
    description: textOf(record.description, BLUESKY_LIMITS.LINK_DESCRIPTION_MAX) ?? '',
    thumb: blueskyImageAddress(record.thumb),
  };
}

function quoteOf(value: unknown): BlueskyQuote | null {
  const record = recordOf(value);
  const url = record ? blueskyPostAddress(record.url) : null;
  const author = record ? authorOf(record.author) : null;
  if (!record || !url || !author) return null;
  return { url, author, text: partsOf(record.text), createdAt: timeOf(record.createdAt), images: imagesOf(record.images) };
}

/**
 * A post as the card may show it, or null when `value` is not one. What does not hold is dropped:
 * an address on any host but Bluesky's own, a part of the text beyond the limits, a count that is
 * not one. Read wherever a post arrives: from the database, from this server, from another instance.
 */
export function blueskyPostOf(value: unknown): BlueskyPost | null {
  const record = recordOf(value);
  const url = record ? blueskyPostAddress(record.url) : null;
  const author = record ? authorOf(record.author) : null;
  if (!record || !url || !author) return null;
  return {
    url,
    author,
    text: partsOf(record.text),
    createdAt: timeOf(record.createdAt),
    images: imagesOf(record.images),
    video: videoOf(record.video),
    link: linkOf(record.link),
    quote: quoteOf(record.quote),
    replies: countOf(record.replies),
    reposts: countOf(record.reposts),
    likes: countOf(record.likes),
    sensitive: record.sensitive === true,
  };
}

/** A post's text without its links, for a plain preview (an older client's card, a notification). */
export function blueskyPlainText(parts: readonly BlueskyTextPart[]): string {
  return parts.map((part) => part.text).join('');
}
