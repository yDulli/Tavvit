import { isElectron } from './platform';

export interface NotificationOptions {
  channelId?: string;
  spaceId?: string;
  userId?: string;
}

const clicks = new EventTarget();

/** One subscription per mounted controller, including older desktop bridges. */
export function onNotificationClick(callback: (options: NotificationOptions) => void): () => void {
  const handler = (event: Event) => callback((event as CustomEvent<NotificationOptions>).detail);
  clicks.addEventListener('click', handler);
  const unsubscribe = window.backspace?.onNotificationClick?.(callback);
  return () => {
    clicks.removeEventListener('click', handler);
    unsubscribe?.();
  };
}

/** The words every notification shows instead of its own, while set (streamer mode). */
let mask: { title: string; body: string } | null = null;

/**
 * While set, a notification says only this (`StreamerModeController` sets it
 * while streamer mode is on): a stream captures the whole screen, the
 * notifications of other conversations included. A tap still leads to the
 * conversation, which is not shown until the person goes there.
 */
export function maskNotifications(text: { title: string; body: string } | null): void {
  mask = text;
}

export function sendNotification(title: string, body: string, options?: NotificationOptions): void {
  if (mask) {
    title = mask.title;
    body = mask.body;
  }
  if (isElectron()) {
    window.backspace!.showNotification(title, body, options);
  } else if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, { body, icon: '/icons/icon-192.png' });
    notification.onclick = () => {
      window.focus();
      notification.close();
      if (options) clicks.dispatchEvent(new CustomEvent('click', { detail: options }));
    };
  }
}

export type NotificationPermissionState = 'app' | 'granted' | 'denied' | 'default' | 'unsupported';

/** Whether notifications can be shown here: the desktop app always can, a browser asks once. */
export function notificationPermission(): NotificationPermissionState {
  if (isElectron()) return 'app';
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function requestNotificationPermission(): Promise<boolean> {
  if (isElectron()) return Promise.resolve(true);
  if (!('Notification' in window)) return Promise.resolve(false);
  return Notification.requestPermission().then((p) => p === 'granted');
}

export function updateBadgeCount(count: number): void {
  if (isElectron()) {
    window.backspace!.setBadgeCount(count);
  }
}
