import { DISCORD_IMPORT_LIMITS } from '@backspace/shared/src/discordImport.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { readCapped } from './cappedBody.js';
import { retryAfterOf } from './discordApi.js';

// Reads a server template from Discord (docs/systems/spaces.md, "Importing a
// Discord template"). The one request this instance makes for an import goes
// to Discord's public template endpoint, `GET /api/v10/guilds/templates/{code}`,
// which answers without an account: no token, no cookie, nothing of the
// person's. The host and path are fixed and the code is checked by the caller
// (`parseDiscordTemplateCode`), so no URL a client names is ever fetched.

const TEMPLATE_ENDPOINT = 'https://discord.com/api/v10/guilds/templates/';
const CODE = /^[A-Za-z0-9_-]{2,64}$/;
const TIMEOUT_MS = 10_000;
/** A preview and the import that follows read the same template; one answer serves both. */
const CACHE_MS = 5 * 60_000;
const CACHE_ENTRIES = 50;

export type TemplateFetchResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: ErrorCode; details?: ErrorDetails };

const cache = new Map<string, { at: number; data: unknown }>();

function remember(code: string, data: unknown, now: number): void {
  cache.delete(code);
  cache.set(code, { at: now, data });
  while (cache.size > CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}


export async function fetchDiscordTemplate(code: string, now: number = Date.now()): Promise<TemplateFetchResult> {
  if (!CODE.test(code)) return { ok: false, status: 400, code: 'discord_template_code_invalid' };
  const cached = cache.get(code);
  if (cached && now - cached.at < CACHE_MS) return { ok: true, data: cached.data };

  let response: Response;
  try {
    response = await fetch(`${TEMPLATE_ENDPOINT}${encodeURIComponent(code)}`, {
      method: 'GET',
      // A redirect would leave the one address this request may go to.
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'Tavvit (Discord template import)' },
    });
  } catch {
    return { ok: false, status: 502, code: 'discord_unreachable' };
  }

  let read: Awaited<ReturnType<typeof readCapped>>;
  try {
    read = await readCapped(response, DISCORD_IMPORT_LIMITS.MAX_TEMPLATE_BYTES);
  } catch {
    // The time ran out while the body arrived, or the connection broke.
    return { ok: false, status: 502, code: 'discord_unreachable' };
  }
  if ('tooLarge' in read) {
    return { ok: false, status: 413, code: 'discord_template_too_large', details: { max: DISCORD_IMPORT_LIMITS.MAX_TEMPLATE_BYTES / 1_000_000 } };
  }
  const text = read.text;
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (response.status === 404) return { ok: false, status: 404, code: 'discord_template_not_found' };
  if (response.status === 429) {
    return { ok: false, status: 429, code: 'discord_rate_limited', details: { retryAfterSeconds: retryAfterOf(body, response.headers.get('retry-after')) } };
  }
  if (!response.ok || body === null) return { ok: false, status: 502, code: 'discord_unreachable' };
  // Discord answers an unknown template code with its error object.
  if (typeof body === 'object' && body !== null && (body as { code?: unknown }).code === 10057) {
    return { ok: false, status: 404, code: 'discord_template_not_found' };
  }
  remember(code, body, now);
  return { ok: true, data: body };
}
