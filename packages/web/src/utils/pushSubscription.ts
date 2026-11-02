import { api } from '../api/client';
import i18n from '../i18n';
import { isElectron } from '../platform/platform';
import { useNotificationPrefsStore } from '../stores/notificationPrefsStore';

/**
 * This device's push (docs/systems/push.md). Whether it is on for an account is kept with
 * the device, by account: someone else signing in here does not inherit it.
 *
 * - `unsupported`: this browser cannot, or it is the desktop app, which has its own notifications.
 * - `install-first`: an iPhone or iPad, where only an app on the Home Screen can.
 * - `denied`: the browser was told no; only its own settings can change that.
 */
export type PushState = 'unsupported' | 'install-first' | 'denied' | 'off' | 'on';

const WAIT_FOR_WORKER_MS = 4_000;
const flagFor = (userId: string): string => `tavvit-push:${userId}`;

function readFlag(userId: string): boolean {
  try {
    return localStorage.getItem(flagFor(userId)) === '1';
  } catch {
    return false;
  }
}

function writeFlag(userId: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(flagFor(userId), '1');
    else localStorage.removeItem(flagFor(userId));
  } catch {
    // A browser that keeps nothing asks again next time.
  }
}

function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function canPush(): boolean {
  return !isElectron() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The app's worker, or null when there is none to wait for (a development server). */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const timeout = new Promise<null>((resolve) => { setTimeout(() => resolve(null), WAIT_FOR_WORKER_MS); });
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const standard = key.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Tell the server about this browser's address, with what this device chose. */
async function register(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const prefs = useNotificationPrefsStore.getState();
  await api.push.subscribe({
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    showText: prefs.showMessageText,
    directMessages: prefs.directMessages,
    locale: i18n.language,
  });
}

export async function readPushState(userId: string): Promise<PushState> {
  if (isElectron()) return 'unsupported';
  if (!canPush()) return isAppleMobile() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await worker();
  if (!registration) return 'unsupported';
  const subscription = await registration.pushManager.getSubscription();
  return subscription && readFlag(userId) ? 'on' : 'off';
}

/** Asks the browser, subscribes and tells the server. Answers what the state is afterwards. */
export async function enablePush(userId: string): Promise<PushState> {
  if (!canPush()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const registration = await worker();
  if (!registration) return 'unsupported';
  const { publicKey } = await api.push.key();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
  await register(subscription);
  writeFlag(userId, true);
  return 'on';
}

export async function disablePush(userId: string): Promise<PushState> {
  writeFlag(userId, false);
  const registration = await worker();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api.push.unsubscribe(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return 'off';
}

/**
 * At every start and when a choice changes: the server hears the current address (a browser
 * can change it) and this device's choices. A subscription this account did not turn on here
 * is someone else's, left behind, and goes.
 */
export async function syncPushSubscription(userId: string): Promise<void> {
  if (!canPush() || Notification.permission !== 'granted') return;
  const registration = await worker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  if (readFlag(userId)) await register(subscription);
  else await subscription.unsubscribe();
}

/** Signing out: this browser stops getting anything. The server's row went with the session. */
export async function dropThisDevicesPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(async (registration) => {
    const subscription = await registration.pushManager?.getSubscription();
    await subscription?.unsubscribe();
  }));
}
