import {
  BLUESKY_API_ORIGIN,
  BLUESKY_LIMITS,
  blueskyHashtagAddress,
  blueskyLinkAddress,
  blueskyPostOf,
  blueskyPostUrl,
  blueskyProfileAddress,
  isBlueskyDid,
  type BlueskyPost,
  type BlueskyPostLink,
  type BlueskyTextPart,
} from '@backspace/shared/src/bluesky.js';
import { safeFetch } from './ssrf.js';

/**
 * Reading a post on Bluesky for its card in a message (docs/systems/embeds.md, "Bluesky posts").
 * The server asks Bluesky's public interface (`BLUESKY_API_ORIGIN`, no account) for the post a link
 * names, and keeps what the card shows. The person who posted the link is not involved, and the
 * people who see the card fetch its pictures and video from Bluesky only after their yes, like any
 * other link preview. What comes back is read as `blueskyPostOf` reads it, so an address on any
 * host but Bluesky's own never reaches a client.
 */

const FETCH_TIMEOUT_MS = 5_000;
/** A post with its quote and thumbnails is a few kilobytes; anything near this is not one. */
const BODY_MAX_BYTES = 1_000_000;
/** A picture fetched for someone copying or saving it (`fetchBlueskyPicture`). */
const PICTURE_TIMEOUT_MS = 10_000;
const PICTURE_MAX_BYTES = 20 * 1024 * 1024;
const PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/**
 * Labels that cover a post's pictures and video until someone chooses to see them: adult content
 * and graphic media, as Bluesky's moderation and authors set them, and a moderator's "warn".
 */
const SENSITIVE_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore', '!warn']);
/** Labels that withdraw a post: Bluesky does not show it, and neither does a card. */
const HIDING_LABELS = new Set(['!hide', '!takedown', '!suspend']);

type Json = Record<string, unknown>;

function objectOf(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Reads at most `max` bytes of a body; null when it is longer. */
async function readBody(body: ReadableStream<Uint8Array>, max: number): Promise<Buffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function getJson(method: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`/xrpc/${method}`, BLUESKY_API_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await safeFetch(url.href, {
      headers: { 'User-Agent': 'TavvitBot/1.0', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;
    const body = await readBody(response.body, BODY_MAX_BYTES);
    return body ? JSON.parse(body.toString('utf8')) as unknown : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function didOf(actor: string): Promise<string | null> {
  if (actor.startsWith('did:')) return isBlueskyDid(actor) ? actor : null;
  const answer = objectOf(await getJson('com.atproto.identity.resolveHandle', { handle: actor }));
  return answer && isBlueskyDid(answer.did) ? answer.did : null;
}

// ─── The post's text ──────────────────────────────────────────────────────

function isBoundary(bytes: Buffer, index: number): boolean {
  return index === bytes.length || ((bytes[index] ?? 0) & 0xc0) !== 0x80;
}

/** Where a facet's feature leads: a link as it is, a mention to the profile, a hashtag to its page. */
function facetHref(features: unknown): string | null {
  for (const feature of arrayOf(features)) {
    const record = objectOf(feature);
    if (!record) continue;
    switch (record.$type) {
      case 'app.bsky.richtext.facet#link': {
        const href = blueskyLinkAddress(record.uri);
        if (href) return href;
        break;
      }
      case 'app.bsky.richtext.facet#mention':
        if (isBlueskyDid(record.did)) return blueskyProfileAddress(record.did);
        break;
      case 'app.bsky.richtext.facet#tag':
        if (typeof record.tag === 'string' && record.tag.length > 0 && record.tag.length <= 64) return blueskyHashtagAddress(record.tag);
        break;
    }
  }
  return null;
}

/**
 * A post's text in runs, its links, mentions and hashtags among them. Facets count UTF-8 bytes, so
 * the text is cut as bytes; a facet that does not fall on a character's edge, overlaps another or
 * runs past the end is left as plain text.
 */
export function textParts(text: unknown, facets: unknown): BlueskyTextPart[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const bytes = Buffer.from(text.slice(0, BLUESKY_LIMITS.TEXT_MAX), 'utf8');
  const links: Array<{ start: number; end: number; href: string }> = [];
  for (const facet of arrayOf(facets)) {
    const record = objectOf(facet);
    const index = objectOf(record?.index);
    const start = index?.byteStart;
    const end = index?.byteEnd;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 0 || end <= start || end > bytes.length || !isBoundary(bytes, start) || !isBoundary(bytes, end)) continue;
    const href = facetHref(record?.features);
    if (href) links.push({ start, end, href });
  }
  links.sort((a, b) => a.start - b.start);
  const parts: BlueskyTextPart[] = [];
  let at = 0;
  for (const link of links) {
    if (link.start < at) continue;
    if (link.start > at) parts.push({ text: bytes.subarray(at, link.start).toString('utf8') });
    parts.push({ text: bytes.subarray(link.start, link.end).toString('utf8'), href: link.href });
    at = link.end;
  }
  if (at < bytes.length) parts.push({ text: bytes.subarray(at).toString('utf8') });
  return parts.slice(0, BLUESKY_LIMITS.TEXT_PARTS_MAX);
}

// ─── The post ─────────────────────────────────────────────────────────────

function timeOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function aspectOf(value: unknown): { width: unknown; height: unknown } {
  const ratio = objectOf(value);
  return { width: ratio?.width ?? null, height: ratio?.height ?? null };
}

function authorOf(value: unknown): Json | null {
  const author = objectOf(value);
  if (!author) return null;
  return { did: author.did, handle: author.handle, displayName: author.displayName ?? null, avatar: author.avatar ?? null };
}

function rkeyOf(uri: unknown): string | null {
  if (typeof uri !== 'string') return null;
  const match = uri.match(/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]{1,512})$/);
  return match?.[1] ?? null;
}

function imagesOf(view: Json | null): Json[] {
  if (view?.$type !== 'app.bsky.embed.images#view') return [];
  return arrayOf(view.images).map((image) => {
    const record = objectOf(image) ?? {};
    return { thumb: record.thumb, fullsize: record.fullsize, alt: record.alt ?? '', ...aspectOf(record.aspectRatio) };
  });
}

/** The pictures, video or link card a post's embed view carries (not a quote: `quoteOf`). */
function mediaOf(view: Json | null): { images: Json[]; video: Json | null; link: Json | null } {
  const images = imagesOf(view);
  let video: Json | null = null;
  let link: Json | null = null;
  if (view?.$type === 'app.bsky.embed.video#view') {
    video = {
      playlist: view.playlist,
      thumbnail: view.thumbnail ?? null,
      alt: view.alt ?? '',
      ...aspectOf(view.aspectRatio),
      loops: view.presentation === 'gif',
    };
  } else if (view?.$type === 'app.bsky.embed.external#view') {
    const external = objectOf(view.external);
    if (external) link = { url: external.uri, title: external.title ?? '', description: external.description ?? '', thumb: external.thumb ?? null };
  }
  return { images, video, link };
}

function labelsOf(value: unknown): string[] {
  return arrayOf(value).map((label) => objectOf(label)?.val).filter((val): val is string => typeof val === 'string');
}

/** A quoted post, when the quote is one that can be shown: not withdrawn, blocked or missing. */
function quoteOf(view: Json | null): { quote: Json; labels: string[] } | null {
  if (view?.$type !== 'app.bsky.embed.record#viewRecord') return null;
  const author = authorOf(view.author);
  const rkey = rkeyOf(view.uri);
  const value = objectOf(view.value);
  if (!author || !rkey || !value || typeof author.did !== 'string' || typeof author.handle !== 'string') return null;
  const labels = labelsOf(view.labels);
  if (labels.some((label) => HIDING_LABELS.has(label))) return null;
  // Its own pictures, as the embed views beside it carry them.
  const embeds = arrayOf(view.embeds).map(objectOf);
  const images = embeds.flatMap((embed) => (
    embed?.$type === 'app.bsky.embed.recordWithMedia#view' ? imagesOf(objectOf(embed.media)) : imagesOf(embed)
  ));
  return {
    quote: {
      url: blueskyPostUrl({ did: author.did, handle: author.handle }, rkey),
      author,
      text: textParts(value.text, value.facets),
      createdAt: timeOf(value.createdAt),
      images,
    },
    labels,
  };
}

/** Bluesky's view of a post as the card keeps it; null when it is not one, `'hidden'` when it is withdrawn. */
export function postFromView(view: unknown): BlueskyPost | 'hidden' | null {
  const post = objectOf(view);
  const record = objectOf(post?.record);
  const author = authorOf(post?.author);
  const rkey = rkeyOf(post?.uri);
  if (!post || !record || !author || !rkey || typeof author.did !== 'string' || typeof author.handle !== 'string') return null;
  const labels = [...labelsOf(post.labels), ...labelsOf(objectOf(post.author)?.labels)];
  if (labels.some((label) => HIDING_LABELS.has(label))) return 'hidden';

  const embed = objectOf(post.embed);
  let media = mediaOf(embed);
  let quoted: ReturnType<typeof quoteOf> = null;
  if (embed?.$type === 'app.bsky.embed.record#view') {
    quoted = quoteOf(objectOf(embed.record));
  } else if (embed?.$type === 'app.bsky.embed.recordWithMedia#view') {
    media = mediaOf(objectOf(embed.media));
    quoted = quoteOf(objectOf(objectOf(embed.record)?.record));
  }
  const sensitive = [...labels, ...(quoted?.labels ?? [])].some((label) => SENSITIVE_LABELS.has(label));

  return blueskyPostOf({
    url: blueskyPostUrl({ did: author.did, handle: author.handle }, rkey),
    author,
    text: textParts(record.text, record.facets),
    createdAt: timeOf(record.createdAt),
    images: media.images,
    video: media.video,
    link: media.link,
    quote: quoted?.quote ?? null,
    replies: post.replyCount,
    reposts: post.repostCount,
    likes: post.likeCount,
    sensitive,
  });
}

/**
 * The post a link names, read from Bluesky's public interface: null when it cannot be read (gone,
 * private to logged-in people, Bluesky unreachable), `'hidden'` when Bluesky withdrew it.
 */
export async function readBlueskyPost(link: BlueskyPostLink): Promise<BlueskyPost | 'hidden' | null> {
  const did = await didOf(link.actor);
  if (!did) return null;
  const answer = objectOf(await getJson('app.bsky.feed.getPosts', { uris: `at://${did}/app.bsky.feed.post/${link.rkey}` }));
  const view = arrayOf(answer?.posts)[0];
  return view === undefined ? null : postFromView(view);
}

/**
 * One of a post's pictures, fetched by this server for someone who copies or saves it: the
 * picture host sends no CORS headers, so a page cannot read it itself. Only Bluesky's picture
 * host is asked (the route checks the address), only for an image, and only up to a size.
 */
export async function fetchBlueskyPicture(address: string): Promise<{ type: string; bytes: Buffer } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PICTURE_TIMEOUT_MS);
  try {
    const response = await safeFetch(address, {
      headers: { 'User-Agent': 'TavvitBot/1.0', Accept: 'image/*' },
      signal: controller.signal,
    });
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!response.ok || !response.body || !PICTURE_TYPES.has(type)) return null;
    const bytes = await readBody(response.body, PICTURE_MAX_BYTES);
    return bytes ? { type, bytes } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
