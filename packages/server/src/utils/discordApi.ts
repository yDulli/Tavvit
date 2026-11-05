import {
  DISCORD_CDN_HOSTS,
  DISCORD_EXPRESSION_LIMITS,
  DISCORD_SNOWFLAKE,
  readDiscordEmojiList,
  readDiscordStickerList,
  type DiscordExpressionListing,
} from '@backspace/shared/src/discordExpressionImport.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { config } from '../config.js';
import { readCapped, readCappedBytes } from './cappedBody.js';
import { publicOnlyDispatcher } from './ssrf.js';

/**
 * Discord's API and content servers, for bringing a server's emoji and stickers into a space
 * (routes/discordExpressionImport.ts, docs/systems/spaces.md).
 *
 * The bot token is someone's credential and is treated as one. Its shape is checked before anything
 * is sent, so no header validation can ever quote it back. It goes only into the Authorization
 * header of the two list requests, to fixed addresses on discord.com that may not redirect, so it
 * cannot follow a redirect anywhere else. Nothing here logs, and no failure carries it or Discord's
 * own message. Pictures come only from Discord's two content hosts, with no token, again without
 * redirects, and only when Discord answers with a picture.
 */

const API = 'https://discord.com/api/v10';
/** The form Discord asks a bot's requests to name themselves in. */
const USER_AGENT = `DiscordBot (https://github.com/yDulli/Tavvit, ${config.version})`;
const LIST_TIMEOUT_MS = 10_000;
/** The longest a picture's fetch may take; an import's batch may give it less. */
export const ASSET_TIMEOUT_MS = 8_000;

export type DiscordFailure = { ok: false; status: number; code: ErrorCode; details?: ErrorDetails };

const fail = (status: number, code: ErrorCode, details?: ErrorDetails): DiscordFailure =>
  ({ ok: false, status, code, ...(details ? { details } : {}) });

/**
 * A bot token in the form Discord issues them (three dot-separated parts of letters, digits, `-` and
 * `_`), with a pasted `Bot ` in front forgiven, or null when the input is not one.
 */
export function parseBotToken(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 220) return null;
  const token = input.trim().replace(/^Bot\s+/i, '');
  if (token.length > 200) return null;
  return /^[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/.test(token) ? token : null;
}

/** Discord's own wait, in whole seconds, from a 429's body or header; 5 when it names none. */
export function retryAfterOf(body: unknown, header: string | null): number {
  const fromBody = typeof body === 'object' && body !== null ? (body as { retry_after?: unknown }).retry_after : undefined;
  const seconds = typeof fromBody === 'number' ? fromBody : header !== null ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 5;
}

function jsonCodeOf(body: unknown): number | null {
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  return typeof code === 'number' ? code : null;
}

async function getList(path: string, token: string): Promise<{ ok: true; body: unknown } | DiscordFailure> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: 'GET',
      // A redirect would carry the token to an address this code did not choose.
      redirect: 'error',
      dispatcher: publicOnlyDispatcher,
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      headers: { Authorization: `Bot ${token}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
  } catch {
    return fail(502, 'discord_unreachable');
  }
  let read: Awaited<ReturnType<typeof readCapped>>;
  try {
    read = await readCapped(response, DISCORD_EXPRESSION_LIMITS.MAX_LIST_BYTES);
  } catch {
    return fail(502, 'discord_unreachable');
  }
  if ('tooLarge' in read) return fail(502, 'discord_unreachable');
  let body: unknown = null;
  try {
    body = read.text.length > 0 ? JSON.parse(read.text) : null;
  } catch {
    body = null;
  }
  const code = jsonCodeOf(body);
  // Never passed on as a 401: the web client takes any 401 as its own session ending.
  if (response.status === 401 || code === 40001) return fail(400, 'discord_bot_token_invalid');
  if (response.status === 403 || response.status === 404 || code === 50001 || code === 10004) return fail(400, 'discord_bot_not_in_server');
  if (response.status === 429) {
    return fail(429, 'discord_rate_limited', { retryAfterSeconds: retryAfterOf(body, response.headers.get('retry-after')) });
  }
  if (!response.ok || body === null) return fail(502, 'discord_unreachable');
  return { ok: true, body };
}

/**
 * A server's emoji and stickers: two requests with the token, the second only after the first
 * succeeded (Discord counts refused requests from an address, and this server's address is shared
 * by everyone who imports). Nothing is retried by itself.
 */
export async function listGuildExpressions(guildId: string, token: string): Promise<{ ok: true; listing: DiscordExpressionListing } | DiscordFailure> {
  if (!DISCORD_SNOWFLAKE.test(guildId)) return fail(400, 'discord_server_id_invalid');
  const emojis = await getList(`/guilds/${guildId}/emojis`, token);
  if (!emojis.ok) return emojis;
  const emojiList = readDiscordEmojiList(emojis.body);
  if (!emojiList) return fail(502, 'discord_unreachable');
  const stickers = await getList(`/guilds/${guildId}/stickers`, token);
  if (!stickers.ok) return stickers;
  const stickerList = readDiscordStickerList(stickers.body);
  if (!stickerList) return fail(502, 'discord_unreachable');
  return { ok: true, listing: { emojis: emojiList, stickers: stickerList } };
}

/**
 * A picture from Discord's content servers, at most `maxBytes`, within `timeoutMs`, or null when it
 * could not be had: another host, a redirect, an error, something that is not a picture, too large,
 * or too slow.
 */
export async function fetchDiscordAsset(url: string, maxBytes: number, timeoutMs: number = ASSET_TIMEOUT_MS): Promise<Buffer | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !(DISCORD_CDN_HOSTS as readonly string[]).includes(parsed.hostname)) return null;
  let response: Response;
  try {
    response = await fetch(parsed.href, {
      method: 'GET',
      redirect: 'error',
      dispatcher: publicOnlyDispatcher,
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, ASSET_TIMEOUT_MS))),
      headers: { Accept: 'image/*', 'User-Agent': USER_AGENT },
    });
  } catch {
    return null;
  }
  if (response.status !== 200 || !(response.headers.get('content-type') ?? '').startsWith('image/')) {
    try { await response.body?.cancel(); } catch { /* the answer is not wanted either way */ }
    return null;
  }
  try {
    const read = await readCappedBytes(response, maxBytes);
    return 'tooLarge' in read ? null : read.bytes;
  } catch {
    return null;
  }
}
