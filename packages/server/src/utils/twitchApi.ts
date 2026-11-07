/**
 * What this server asks Twitch, and how it reads the answer (docs/systems/activity-presence.md,
 * "Live on Twitch"). The check that uses it, and shows people as live, is utils/twitchLive.ts.
 *
 * Off unless the operator set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (config.ts), from an
 * application registered at dev.twitch.tv. It signs in as that application, never as a person,
 * and asks about channel names, nothing else; the privacy draft says so (utils/legalTemplates.ts).
 */
import type { Activity } from '@backspace/shared';
import { ACTIVITY_LIMITS } from '@backspace/shared/src/activities.js';
import { withoutUnsafeCharacters } from '@backspace/shared/src/profileFields.js';
import { twitchChannelUrl } from '@backspace/shared/src/twitch.js';
import { config } from '../config.js';

const TWITCH_TIMEOUT_MS = 10_000;
/** Twitch answers about at most 100 channels per question. */
export const CHANNELS_PER_QUESTION = 100;
/** A token is renewed this long before Twitch says it ends. */
const TOKEN_MARGIN_MS = 60 * 60_000;

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';

/** Whether this server asks Twitch at all. */
export function twitchLiveAvailable(): boolean {
  return config.twitch.clientId !== '' && config.twitch.clientSecret !== '';
}

/** The part of a live stream Twitch describes that is used here. */
export interface TwitchStream {
  login: string;
  shownName: string;
  title: string;
  game: string;
  startedAt: number | null;
}

/** Twitch did not answer, or not in a way that can be read. `credentials`: it refused this server's application. */
export class TwitchUnavailable extends Error {
  constructor(readonly reason: string, readonly credentials: boolean) {
    super(reason);
    this.name = 'TwitchUnavailable';
  }
}

/** Cut a text to `max` code units without splitting a character, marking the cut. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const character of text) {
    if (out.length + character.length > max - 1) break;
    out += character;
  }
  return `${out.trimEnd()}…`;
}

/** A text from Twitch as an activity may hold it: without the characters that disguise a status, within the limit. */
function cleanText(value: string, max: number): string {
  return clipText(withoutUnsafeCharacters(value).trim(), max);
}

/**
 * The activity a live stream on `channel` is shown as. Its name is the
 * stream's title, so a client that knows nothing of the mark still reads
 * "Streaming <title>", with the game below it. Nothing in it loads from
 * Twitch: the address is a link to follow, and there is no picture.
 */
export function liveActivityOf(stream: TwitchStream, channel: string, now = Date.now()): Activity {
  const title = cleanText(stream.title, ACTIVITY_LIMITS.MAX_NAME_LENGTH);
  const shownName = cleanText(stream.shownName, ACTIVITY_LIMITS.MAX_NAME_LENGTH);
  const game = cleanText(stream.game, ACTIVITY_LIMITS.MAX_DETAILS_LENGTH);
  const activity: Activity = {
    type: 'streaming',
    name: title || shownName || channel,
    url: twitchChannelUrl(channel),
    source: 'twitch',
  };
  if (game) activity.details = game;
  if (stream.startedAt !== null) activity.timestamps = { start: Math.min(stream.startedAt, now) };
  return activity;
}

/** Read Twitch's answer about streams. An entry that is not a readable live stream is left out. */
export function readStreams(body: unknown): TwitchStream[] {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new TwitchUnavailable('an answer without data', false);
  const streams: TwitchStream[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (entry.type !== 'live' || typeof entry.user_login !== 'string') continue;
    const startedAt = typeof entry.started_at === 'string' ? Date.parse(entry.started_at) : Number.NaN;
    streams.push({
      login: entry.user_login.toLowerCase(),
      shownName: typeof entry.user_name === 'string' ? entry.user_name : '',
      title: typeof entry.title === 'string' ? entry.title : '',
      game: typeof entry.game_name === 'string' ? entry.game_name : '',
      startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
    });
  }
  return streams;
}

let appToken: { value: string; renewAt: number } | null = null;

async function requestToken(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
      signal: AbortSignal.timeout(TWITCH_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new TwitchUnavailable('no answer when signing in', false);
  }
  // Twitch refuses an unknown application or a wrong secret with a 4xx.
  if (!response.ok) throw new TwitchUnavailable(`HTTP ${response.status} when signing in`, response.status >= 400 && response.status < 500);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TwitchUnavailable('an unreadable answer when signing in', false);
  }
  const token = body && typeof body === 'object' ? (body as { access_token?: unknown; expires_in?: unknown }) : {};
  if (typeof token.access_token !== 'string' || token.access_token === '') throw new TwitchUnavailable('no token when signing in', false);
  const lifetimeMs = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in * 1000 : 2 * TOKEN_MARGIN_MS;
  appToken = { value: token.access_token, renewAt: Date.now() + Math.max(lifetimeMs - TOKEN_MARGIN_MS, lifetimeMs / 2) };
  return token.access_token;
}

async function currentToken(): Promise<string> {
  if (appToken && Date.now() < appToken.renewAt) return appToken.value;
  appToken = null;
  return requestToken();
}

async function askOnce(channels: readonly string[], token: string): Promise<Response> {
  const query = new URLSearchParams({ first: String(CHANNELS_PER_QUESTION) });
  for (const channel of channels) query.append('user_login', channel);
  try {
    return await fetch(`${STREAMS_URL}?${query.toString()}`, {
      headers: { 'Client-Id': config.twitch.clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TWITCH_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new TwitchUnavailable('no answer about streams', false);
  }
}

/**
 * Which of `channels` (lower case, as `twitchChannelOf` gives them) are live,
 * keyed by channel. One question per hundred channels; a token Twitch no
 * longer takes is renewed once. Throws `TwitchUnavailable` when any question
 * goes unanswered, so that a partial answer never reads as "not live".
 */
export async function askTwitch(channels: readonly string[]): Promise<Map<string, TwitchStream>> {
  const live = new Map<string, TwitchStream>();
  for (let start = 0; start < channels.length; start += CHANNELS_PER_QUESTION) {
    const part = channels.slice(start, start + CHANNELS_PER_QUESTION);
    let response = await askOnce(part, await currentToken());
    if (response.status === 401) {
      appToken = null;
      response = await askOnce(part, await currentToken());
    }
    if (!response.ok) throw new TwitchUnavailable(`HTTP ${response.status} about streams`, response.status === 401 || response.status === 403);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TwitchUnavailable('an unreadable answer about streams', false);
    }
    for (const stream of readStreams(body)) {
      if (part.includes(stream.login)) live.set(stream.login, stream);
    }
  }
  return live;
}

/** Forget the token (tests). */
export function resetTwitchToken(): void {
  appToken = null;
}
