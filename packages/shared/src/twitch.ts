import type { Activity, ProfileLink } from './types.js';

/**
 * A Twitch channel as a profile names it (docs/systems/activity-presence.md,
 * "Live on Twitch"): a link to `twitch.tv/<channel>` among the profile's
 * links. Twitch's own rule for a channel's name: 4 to 25 letters, digits or
 * underscores. Read the same way by the instance that asks Twitch and by the
 * client that offers the way to the stream.
 */

const TWITCH_HOSTS: ReadonlySet<string> = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
const CHANNEL_NAME = /^[a-z0-9_]{4,25}$/;

/** Pages of Twitch that are not a channel, though their address looks like one. */
const NOT_CHANNELS: ReadonlySet<string> = new Set([
  'directory', 'downloads', 'jobs', 'login', 'messages', 'p', 'payments', 'prime', 'search', 'settings', 'signup',
  'store', 'subscriptions', 'turbo', 'videos', 'wallet', 'friends', 'inventory', 'drops',
]);

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
  if (!first || !CHANNEL_NAME.test(first) || NOT_CHANNELS.has(first)) return null;
  return first;
}

/** The first Twitch channel among a profile's links, or null. */
export function twitchChannelOfLinks(links: readonly ProfileLink[] | null | undefined): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const channel = link && typeof link.url === 'string' ? twitchChannelOf(link.url) : null;
    if (channel) return channel;
  }
  return null;
}

/** The address of a channel's stream, the one way to it the app offers. */
export function twitchChannelUrl(channel: string): string {
  return `https://www.twitch.tv/${channel}`;
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
