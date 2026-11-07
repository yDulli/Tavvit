/**
 * What this server asks Twitch, and how it reads the answers (docs/systems/linked-accounts.md,
 * activity-presence.md "Live on Twitch"). Two kinds of question:
 *
 * - As the application (client credentials): which linked accounts are live. The token for this
 *   is the application's own and is kept in memory (utils/twitchLive.ts asks).
 * - As the person, once, while they link their account: who signed in. Twitch gives a code on the
 *   way back, the code buys a token, the token names the account, and the token is revoked at
 *   once (utils/linkedAccounts.ts asks). None is kept.
 *
 * Off unless the operator set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (config.ts). Only fixed
 * addresses of Twitch are asked, with a timeout and without following redirects.
 */
import type { Activity } from '@backspace/shared';
import { ACTIVITY_LIMITS } from '@backspace/shared/src/activities.js';
import { linkedAccountName } from '@backspace/shared/src/linkedAccounts.js';
import { withoutUnsafeCharacters } from '@backspace/shared/src/profileFields.js';
import { isTwitchLogin, twitchChannelUrl } from '@backspace/shared/src/twitch.js';
import { config } from '../config.js';

const TWITCH_TIMEOUT_MS = 10_000;
/** Twitch answers about at most 100 accounts per question. */
export const ACCOUNTS_PER_QUESTION = 100;
/** The application's token is renewed this long before Twitch says it ends. */
const TOKEN_MARGIN_MS = 60 * 60_000;

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const USERS_URL = 'https://api.twitch.tv/helix/users';

/** A Twitch account's id: digits. */
const ACCOUNT_ID = /^[0-9]{1,32}$/;

/** Whether this server works with Twitch at all. */
export function twitchAvailable(): boolean {
  return config.twitch.clientId !== '' && config.twitch.clientSecret !== '';
}

/** The part of a live stream Twitch describes that is used here. */
export interface TwitchStream {
  /** The account's id, what a linked account is asked about by. */
  userId: string;
  login: string;
  shownName: string;
  title: string;
  game: string;
  startedAt: number | null;
}

/** Who signed in at Twitch. */
export interface TwitchIdentity {
  id: string;
  login: string;
  name: string;
}

/** Twitch did not answer, or not in a way that can be read. `credentials`: it refused this server's application. */
export class TwitchUnavailable extends Error {
  constructor(readonly reason: string, readonly credentials: boolean) {
    super(reason);
    this.name = 'TwitchUnavailable';
  }
}

/** Twitch refused the code it gave on the way back: used already, too old, or not for this application. */
export class TwitchCodeRefused extends Error {
  constructor(readonly twitchMessage: string) {
    super('Twitch refused the code');
    this.name = 'TwitchCodeRefused';
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
 * The activity a live stream is shown as. Its name is the stream's title, so a
 * client that knows nothing of the mark still reads "Streaming <title>", with
 * the game below it. Nothing in it loads from Twitch: the address is a link to
 * follow, built from the login Twitch answered, and there is no picture.
 */
export function liveActivityOf(stream: TwitchStream, now = Date.now()): Activity {
  const title = cleanText(stream.title, ACTIVITY_LIMITS.MAX_NAME_LENGTH);
  const shownName = cleanText(stream.shownName, ACTIVITY_LIMITS.MAX_NAME_LENGTH);
  const game = cleanText(stream.game, ACTIVITY_LIMITS.MAX_DETAILS_LENGTH);
  const activity: Activity = {
    type: 'streaming',
    name: title || shownName || (isTwitchLogin(stream.login) ? stream.login : 'Twitch'),
    source: 'twitch',
  };
  if (isTwitchLogin(stream.login)) activity.url = twitchChannelUrl(stream.login);
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
    if (entry.type !== 'live' || typeof entry.user_id !== 'string' || !ACCOUNT_ID.test(entry.user_id)) continue;
    const startedAt = typeof entry.started_at === 'string' ? Date.parse(entry.started_at) : Number.NaN;
    streams.push({
      userId: entry.user_id,
      login: typeof entry.user_login === 'string' ? entry.user_login.toLowerCase() : '',
      shownName: typeof entry.user_name === 'string' ? entry.user_name : '',
      title: typeof entry.title === 'string' ? entry.title : '',
      game: typeof entry.game_name === 'string' ? entry.game_name : '',
      startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
    });
  }
  return streams;
}

/** Read Twitch's answer naming the account a person's token belongs to. */
export function readIdentity(body: unknown): TwitchIdentity {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
  const entry = Array.isArray(data) && data[0] && typeof data[0] === 'object' ? data[0] as Record<string, unknown> : null;
  const id = entry?.id;
  const login = typeof entry?.login === 'string' ? entry.login.toLowerCase() : null;
  if (typeof id !== 'string' || !ACCOUNT_ID.test(id) || !isTwitchLogin(login)) {
    throw new TwitchUnavailable('an answer without the account', false);
  }
  return { id, login, name: linkedAccountName(entry?.display_name) ?? login };
}

async function postForm(url: string, fields: Record<string, string>, what: string): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(TWITCH_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new TwitchUnavailable(`no answer ${what}`, false);
  }
}

async function getJson(url: string, token: string, what: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { 'Client-Id': config.twitch.clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TWITCH_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new TwitchUnavailable(`no answer ${what}`, false);
  }
}

async function bodyOf(response: Response, what: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TwitchUnavailable(`an unreadable answer ${what}`, false);
  }
}

// ─── As the application ─────────────────────────────────────────────────────

let appToken: { value: string; renewAt: number } | null = null;

async function requestAppToken(): Promise<string> {
  const response = await postForm(TOKEN_URL, {
    client_id: config.twitch.clientId,
    client_secret: config.twitch.clientSecret,
    grant_type: 'client_credentials',
  }, 'when signing in');
  // Twitch refuses an unknown application or a wrong secret with a 4xx.
  if (!response.ok) throw new TwitchUnavailable(`HTTP ${response.status} when signing in`, response.status >= 400 && response.status < 500);
  const body = await bodyOf(response, 'when signing in');
  const token = body && typeof body === 'object' ? (body as { access_token?: unknown; expires_in?: unknown }) : {};
  if (typeof token.access_token !== 'string' || token.access_token === '') throw new TwitchUnavailable('no token when signing in', false);
  const lifetimeMs = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in * 1000 : 2 * TOKEN_MARGIN_MS;
  appToken = { value: token.access_token, renewAt: Date.now() + Math.max(lifetimeMs - TOKEN_MARGIN_MS, lifetimeMs / 2) };
  return token.access_token;
}

async function currentAppToken(): Promise<string> {
  if (appToken && Date.now() < appToken.renewAt) return appToken.value;
  appToken = null;
  return requestAppToken();
}

async function askAboutStreams(accountIds: readonly string[], token: string): Promise<Response> {
  const query = new URLSearchParams({ first: String(ACCOUNTS_PER_QUESTION) });
  for (const id of accountIds) query.append('user_id', id);
  return getJson(`${STREAMS_URL}?${query.toString()}`, token, 'about streams');
}

/**
 * Which of the Twitch accounts `accountIds` are live, keyed by account id. One
 * question per hundred accounts; a token Twitch no longer takes is renewed
 * once. Throws `TwitchUnavailable` when any question goes unanswered, so that
 * a partial answer never reads as "not live".
 */
export async function askTwitch(accountIds: readonly string[]): Promise<Map<string, TwitchStream>> {
  const live = new Map<string, TwitchStream>();
  for (let start = 0; start < accountIds.length; start += ACCOUNTS_PER_QUESTION) {
    const part = accountIds.slice(start, start + ACCOUNTS_PER_QUESTION);
    let response = await askAboutStreams(part, await currentAppToken());
    if (response.status === 401) {
      appToken = null;
      response = await askAboutStreams(part, await currentAppToken());
    }
    if (!response.ok) throw new TwitchUnavailable(`HTTP ${response.status} about streams`, response.status === 401 || response.status === 403);
    for (const stream of readStreams(await bodyOf(response, 'about streams'))) {
      if (part.includes(stream.userId)) live.set(stream.userId, stream);
    }
  }
  return live;
}

// ─── As the person, while they link their account ──────────────────────────

/**
 * Where a person signs in at Twitch to link their account. It asks for no
 * permission (no scope): who signed in is all this server learns. Twitch asks
 * every time (`force_verify`), so the person sees which account they link.
 */
export function twitchAuthorizeUrl(state: string): string {
  const query = new URLSearchParams({
    client_id: config.twitch.clientId,
    redirect_uri: config.twitch.redirectUri,
    response_type: 'code',
    scope: '',
    state,
    force_verify: 'true',
  });
  return `${AUTHORIZE_URL}?${query.toString()}`;
}

/** Give a person's token back to Twitch. Best effort: a token nobody holds any more ends by itself. */
async function revokeToken(token: string): Promise<void> {
  try {
    const response = await postForm(REVOKE_URL, { client_id: config.twitch.clientId, token }, 'when revoking');
    if (!response.ok) console.warn(`[twitch] Revoking a linking token answered HTTP ${response.status}.`);
  } catch {
    console.warn('[twitch] Revoking a linking token got no answer; it ends by itself.');
  }
}

/**
 * Who signed in at Twitch, from the code Twitch gave on the way back. The
 * code buys a token, the token names the account, and the token is revoked
 * before this returns, whatever the answer was.
 */
export async function twitchIdentityOfCode(code: string): Promise<TwitchIdentity> {
  const response = await postForm(TOKEN_URL, {
    client_id: config.twitch.clientId,
    client_secret: config.twitch.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.twitch.redirectUri,
  }, 'for the code');
  if (response.status === 400) {
    const refusal = await response.json().catch(() => null) as { message?: unknown } | null;
    throw new TwitchCodeRefused(typeof refusal?.message === 'string' ? refusal.message.slice(0, 200) : '');
  }
  if (!response.ok) throw new TwitchUnavailable(`HTTP ${response.status} for the code`, response.status === 401 || response.status === 403);
  const body = await bodyOf(response, 'for the code');
  const token = body && typeof body === 'object' ? (body as { access_token?: unknown }).access_token : undefined;
  if (typeof token !== 'string' || token === '') throw new TwitchUnavailable('no token for the code', false);
  try {
    const answer = await getJson(USERS_URL, token, 'about the account');
    if (!answer.ok) throw new TwitchUnavailable(`HTTP ${answer.status} about the account`, false);
    return readIdentity(await bodyOf(answer, 'about the account'));
  } finally {
    await revokeToken(token);
  }
}

/** Forget the application's token (tests). */
export function resetTwitchToken(): void {
  appToken = null;
}
