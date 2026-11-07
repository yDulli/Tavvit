import type { Activity } from './types.js';

/**
 * Twitch accounts and the way to their streams (docs/systems/linked-accounts.md,
 * activity-presence.md "Live on Twitch"). An account is only ever named by what
 * Twitch itself answered when its owner linked it, and its stream only ever
 * reached at the channel's own page, built here from its login.
 */

const TWITCH_HOSTS: ReadonlySet<string> = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
/** A Twitch login: letters, digits and underscores, in lower case, at most 25. */
const LOGIN = /^[a-z0-9_]{1,25}$/;

/** Pages of Twitch that are not a channel, though their address looks like one. */
const NOT_CHANNELS: ReadonlySet<string> = new Set([
  'directory', 'downloads', 'jobs', 'login', 'messages', 'p', 'payments', 'prime', 'search', 'settings', 'signup',
  'store', 'subscriptions', 'turbo', 'videos', 'wallet', 'friends', 'inventory', 'drops',
]);

/** Whether a value is a Twitch login as Twitch writes one. */
export function isTwitchLogin(value: unknown): value is string {
  return typeof value === 'string' && LOGIN.test(value);
}

/** The channel a Twitch address names, in lower case, or null when it names no channel. */
export function twitchChannelOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!TWITCH_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  // A channel's own page, its about page or its videos: the first segment is the channel.
  const first = segments[0]?.toLowerCase();
  if (!first || !LOGIN.test(first) || NOT_CHANNELS.has(first)) return null;
  return first;
}

/** The address of a channel's stream, the one way to it the app offers. */
export function twitchChannelUrl(login: string): string {
  return `https://www.twitch.tv/${login}`;
}

/** Whether an address is exactly that of a channel's stream (what a live activity may link to). */
export function isTwitchStreamUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const channel = twitchChannelOf(url);
  return channel !== null && url === twitchChannelUrl(channel);
}

/**
 * The way to the stream a live activity offers, or null. Only an activity a
 * person's home found on Twitch has one, and only to the channel's own page:
 * whatever else an activity's address says is never offered as a link.
 */
export function twitchStreamOf(activity: Pick<Activity, 'source' | 'url'> | null | undefined): string | null {
  if (!activity || activity.source !== 'twitch') return null;
  return isTwitchStreamUrl(activity.url) ? activity.url : null;
}
