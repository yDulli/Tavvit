/**
 * Push to a device whose app is closed (docs/systems/push.md). The browser hands out an
 * address at a push service; the server sends there what only that browser can read.
 */

/**
 * The push services a server may send to. The address comes from the client and the server
 * posts to it, so this list is what keeps that from being a way to reach anything else.
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
/** Services that hand out a host of their own under this domain. */
export const PUSH_SERVICE_DOMAINS: readonly string[] = ['.push.apple.com', '.notify.windows.com'];

export const PUSH_LIMITS = {
  ENDPOINT_MAX_LENGTH: 2048,
  /** Devices one account can have. The oldest goes when another comes. */
  DEVICES_MAX: 10,
  /** What a notification shows of a message. */
  BODY_MAX_LENGTH: 180,
} as const;

/** Whether this address is at a push service, over https, with nothing odd in it. */
export function isPushServiceAddress(address: unknown): address is string {
  if (typeof address !== 'string' || address.length > PUSH_LIMITS.ENDPOINT_MAX_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.includes(host) || PUSH_SERVICE_DOMAINS.some((domain) => host.endsWith(domain));
}

/** What the client registers for this device. */
export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The device's own choices (notificationPrefsStore), which the server has to follow when the app is closed. */
  showText?: boolean;
  directMessages?: boolean;
  /** The language this device shows, for the few words a notification adds of its own. */
  locale?: string;
}

export interface PushKeyResponse {
  publicKey: string;
}

/** What arrives at the device, for `public/sw-push.js`. */
export interface PushPayload {
  title: string;
  body: string;
  /** A newer notification with the same tag replaces the older one. */
  tag: string;
  /** Where a tap on it goes, in this app. */
  url: string;
}
