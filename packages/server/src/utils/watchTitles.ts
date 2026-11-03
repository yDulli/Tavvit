import { withoutUnsafeCharacters } from '@backspace/shared/src/profileFields.js';
import { fileTitleOf, WATCH_LIMITS, type WatchSource } from '@backspace/shared/src/watch.js';
import { readCapped } from './cappedBody.js';

/**
 * The title of a video a room is to watch (docs/systems/watch-together.md), asked from the
 * provider's oEmbed endpoint: two fixed addresses, so no address a client names is fetched by this
 * server. Only the video's public link goes there, nothing of the person's. A file has no endpoint
 * and is named by its path.
 */

const OEMBED_ENDPOINTS: Record<'youtube' | 'vimeo', string> = {
  youtube: 'https://www.youtube.com/oembed?format=json&url=',
  vimeo: 'https://vimeo.com/api/oembed.json?url=',
};
const TIMEOUT_MS = 4_000;
/** A real oEmbed answer is a few hundred bytes. */
const MAX_BYTES = 64 * 1024;

/** What the provider said of a video: its title, that it cannot be embedded here, or nothing (unreachable). */
export type WatchTitle = { kind: 'title'; title: string } | { kind: 'not_embeddable' } | { kind: 'unknown' };

/** A title as shown: one line, without characters that would disguise it, at most TITLE_MAX_LENGTH. */
export function cleanWatchTitle(text: string): string {
  return withoutUnsafeCharacters(text).replace(/\s+/g, ' ').trim().slice(0, WATCH_LIMITS.TITLE_MAX_LENGTH);
}

export async function lookUpWatchTitle(source: WatchSource): Promise<WatchTitle> {
  if (source.provider === 'file') return { kind: 'title', title: cleanWatchTitle(fileTitleOf(source.url)) };
  let response: Response;
  try {
    response = await fetch(`${OEMBED_ENDPOINTS[source.provider]}${encodeURIComponent(source.url)}`, {
      method: 'GET',
      // A redirect would leave the one address this request may go to.
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'Tavvit (watch together)' },
    });
  } catch {
    return { kind: 'unknown' };
  }
  // A private, removed or not embeddable video: its player would show an error to everyone.
  if (response.status === 401 || response.status === 403 || response.status === 404) return { kind: 'not_embeddable' };
  if (!response.ok) return { kind: 'unknown' };
  try {
    const read = await readCapped(response, MAX_BYTES);
    if ('tooLarge' in read) return { kind: 'unknown' };
    const body = JSON.parse(read.text) as { title?: unknown };
    const title = typeof body.title === 'string' ? cleanWatchTitle(body.title) : '';
    return title ? { kind: 'title', title } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}
