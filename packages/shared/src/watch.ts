/**
 * Watching together in a voice channel (docs/systems/watch-together.md): one video for everyone in
 * the call, in step. The server holds each room's session; every client plays the video itself.
 */

export const WATCH_LIMITS = {
  /** Videos waiting after the one that plays. */
  QUEUE_MAX: 50,
  /** The longest title kept. */
  TITLE_MAX_LENGTH: 200,
  /** The longest link taken, as pasted and as kept: a file's address is kept as the parser writes it. */
  URL_MAX_LENGTH: 2048,
  /**
   * The most a session may be when sent (`JSON.stringify`): every change goes to everyone in the
   * call, so a queue of long links must not make each of those a large frame.
   */
  SESSION_MAX_BYTES: 64 * 1024,
  /** Videos one person may add in a minute. */
  ADDS_PER_MINUTE: 20,
  /** Plays, pauses, seeks and skips one person may send in a minute. */
  CONTROLS_PER_MINUTE: 60,
  /** Reactions one person may send in the window below. */
  REACTIONS_PER_WINDOW: 8,
  REACTION_WINDOW_MS: 10_000,
  /** How far a player may run from the room before it is moved back to it. */
  DRIFT_TOLERANCE_MS: 2_000,
  /** The latest a link may say to start, from its `t=`. */
  MAX_START_MS: 24 * 60 * 60 * 1000,
} as const;

/** What can fly over the picture: a fixed set, so nothing is fetched to show one. */
export const WATCH_REACTIONS = ['😂', '😮', '❤️', '🔥', '👏', '😢', '👀', '🎉'] as const;
export type WatchReaction = (typeof WATCH_REACTIONS)[number];

export function isWatchReaction(value: unknown): value is WatchReaction {
  return typeof value === 'string' && (WATCH_REACTIONS as readonly string[]).includes(value);
}

/** Which player shows it: YouTube's and Vimeo's own (the only frames a client draws), or a video file. */
export type WatchProvider = 'youtube' | 'vimeo' | 'file';

/** A link as a room plays it. */
export interface WatchSource {
  provider: WatchProvider;
  /**
   * What the player loads. YouTube: the video's id. Vimeo: the video's id, followed by `:` and the
   * key of an unlisted one. File: the https address of the file.
   */
  ref: string;
  /** Where to start, from a `t=` in the link. */
  startMs: number;
  /** The link in the form anyone can open. */
  url: string;
}

/**
 * One video of a session: the one that plays or one in the queue. Nothing says who added it: the
 * call needs only what plays, and the less a session names, the less goes to everyone in it.
 */
export interface WatchItem extends WatchSource {
  /** The server's id for it, so an entry of the queue is named by it. */
  id: string;
  /** From the provider; empty when it gave none, and the client names the video by its provider. */
  title: string;
}

/** Who may play, pause, seek and skip: everyone in the call, or only who started the session. */
export type WatchControl = 'everyone' | 'starter';

/** A room's session, as the server holds it and sends it to the call (`watch_state`). */
export interface WatchSession {
  channelId: string;
  spaceId: string;
  current: WatchItem | null;
  queue: WatchItem[];
  playing: boolean;
  /** Where `current` stood at `stateAt`. */
  positionMs: number;
  /** The server's clock when `positionMs` was true. */
  stateAt: number;
  control: WatchControl;
  /** Who started the session. */
  starterId: string;
}

/** What the channel list shows of a room's session, to everyone who can see the channel. */
export interface WatchPresence {
  title: string;
  provider: WatchProvider;
}

/**
 * Where a session's video stands, sent alone (`watch_position`) when only that changed: a play,
 * pause or seek moves nothing else, and the whole session need not go out for it.
 */
export interface WatchPosition {
  /** The video it is about; a client whose session plays another ignores it. */
  itemId: string;
  playing: boolean;
  positionMs: number;
  stateAt: number;
}

/** A change to a session (`POST /api/channels/:id/watch/state`). */
export type WatchAction =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; positionMs: number }
  /** `itemId` names the video it skips: a player at its end sends it, and only the first such counts. */
  | { action: 'next'; itemId?: string }
  | { action: 'remove'; itemId: string }
  | { action: 'control'; control: WatchControl };

export interface WatchAddRequest {
  url: string;
}

export interface WatchReactRequest {
  reaction: WatchReaction;
}

/** Where a session's video stands at `serverNow` (the server's clock). */
export function watchPositionAt(session: Pick<WatchSession, 'playing' | 'positionMs' | 'stateAt'>, serverNow: number): number {
  if (!session.playing) return session.positionMs;
  return session.positionMs + Math.max(0, serverNow - session.stateAt);
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_KEY = /^[0-9a-f]{6,20}$/i;
const VIDEO_FILE = /\.(mp4|m4v|webm|mov|ogv)$/i;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);

/** A `t=`, `start=` or `#t=` in seconds or as `1h2m3s`, in milliseconds; 0 when there is none or it cannot be read. */
function startOf(url: URL): number {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start') ?? (url.hash.startsWith('#t=') ? url.hash.slice(3) : null);
  if (!raw) return 0;
  const match = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/.exec(raw);
  if (!match || (!match[1] && !match[2] && !match[3])) return 0;
  const ms = (Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1000;
  return ms > 0 && ms <= WATCH_LIMITS.MAX_START_MS ? ms : 0;
}

function youtube(id: string | null | undefined, startMs: number): WatchSource | null {
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { provider: 'youtube', ref: id, startMs, url: `https://www.youtube.com/watch?v=${id}` };
}

function vimeo(id: string | undefined, key: string | null | undefined, startMs: number): WatchSource | null {
  if (!id || !VIMEO_ID.test(id)) return null;
  if (key && !VIMEO_KEY.test(key)) return null;
  return {
    provider: 'vimeo',
    ref: key ? `${id}:${key.toLowerCase()}` : id,
    startMs,
    url: key ? `https://vimeo.com/${id}/${key.toLowerCase()}` : `https://vimeo.com/${id}`,
  };
}

/**
 * What a link a person pasted plays, or null when no player here can play it: a YouTube video
 * (watch, youtu.be, shorts, embed, live), a Vimeo video (with the key of an unlisted one), or an
 * https address of a video file. Nothing else is taken: the client embeds only the players its
 * frame-src allows (`EMBED_FRAME_ORIGINS`).
 */
export function parseWatchUrl(value: unknown): WatchSource | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > WATCH_LIMITS.URL_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const startMs = startOf(url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    if (parts[0] === 'watch' && parts.length === 1) return youtube(url.searchParams.get('v'), startMs);
    if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '') && parts.length === 2) return youtube(parts[1], startMs);
    return null;
  }
  if (host === 'youtu.be') return parts.length === 1 ? youtube(parts[0], startMs) : null;

  if (host === 'vimeo.com') {
    if (parts.length === 1 || parts.length === 2) return vimeo(parts[0], parts[1], startMs);
    return null;
  }
  if (host === 'player.vimeo.com') {
    return parts[0] === 'video' && parts.length === 2 ? vimeo(parts[1], url.searchParams.get('h'), startMs) : null;
  }

  // A video file is fetched by each player itself: only over https. The address is kept as the
  // parser writes it, which encodes what the person pasted (one character can become nine), so the
  // limit holds for that form too.
  if (url.protocol === 'https:' && VIDEO_FILE.test(url.pathname)) {
    url.hash = '';
    if (url.href.length > WATCH_LIMITS.URL_MAX_LENGTH) return null;
    return { provider: 'file', ref: url.href, startMs, url: url.href };
  }
  return null;
}

/**
 * A title for a file that has none of its own: the last part of its path, without its extension,
 * or the host when the path has none. Never the whole address: a title goes to everyone who can
 * see the channel, and an address may carry a query that only the call should see.
 */
export function fileTitleOf(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return '';
  }
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // Not valid percent-encoding: the segment as written is the name.
  }
  return name.replace(VIDEO_FILE, '').trim() || url.hostname;
}

const VIMEO_REF = /^\d{1,12}(:[0-9a-f]{6,20})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether `value` is an item a player here can play. A client checks what the network sends before
 * it keeps it: a session is a server's word, and a player made for an unknown provider would
 * load nothing a person agreed to, or nothing at all.
 */
export function isWatchItem(value: unknown): value is WatchItem {
  if (!isRecord(value)) return false;
  const { id, title, provider, ref, startMs, url } = value;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return false;
  if (typeof title !== 'string' || title.length > WATCH_LIMITS.TITLE_MAX_LENGTH) return false;
  if (typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) return false;
  if (typeof ref !== 'string' || typeof url !== 'string' || url.length > WATCH_LIMITS.URL_MAX_LENGTH) return false;
  switch (provider) {
    case 'youtube':
      return YOUTUBE_ID.test(ref);
    case 'vimeo':
      return VIMEO_REF.test(ref);
    case 'file':
      return parseWatchUrl(ref)?.ref === ref;
    default:
      return false;
  }
}

/** Whether `value` is a session as the server sends one. */
export function isWatchSession(value: unknown): value is WatchSession {
  if (!isRecord(value)) return false;
  const { channelId, spaceId, current, queue, playing, positionMs, stateAt, control, starterId } = value;
  return typeof channelId === 'string' && typeof spaceId === 'string'
    && (current === null || isWatchItem(current))
    && Array.isArray(queue) && queue.length <= WATCH_LIMITS.QUEUE_MAX && queue.every(isWatchItem)
    && typeof playing === 'boolean'
    && typeof positionMs === 'number' && Number.isFinite(positionMs) && positionMs >= 0
    && typeof stateAt === 'number' && Number.isFinite(stateAt)
    && (control === 'everyone' || control === 'starter')
    && typeof starterId === 'string';
}

/** Whether `value` is a position as the server sends one. */
export function isWatchPosition(value: unknown): value is WatchPosition {
  if (!isRecord(value)) return false;
  const { itemId, playing, positionMs, stateAt } = value;
  return typeof itemId === 'string' && typeof playing === 'boolean'
    && typeof positionMs === 'number' && Number.isFinite(positionMs) && positionMs >= 0
    && typeof stateAt === 'number' && Number.isFinite(stateAt);
}
