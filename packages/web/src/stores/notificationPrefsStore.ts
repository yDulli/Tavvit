import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * What this device does when something alerts the user, kept on the device like
 * sounds and appearance: a phone and a desk at work want different things. What
 * alerts at all per space and channel is the account's (`notificationSettingsStore`).
 * `utils/alerts.ts` and `NotificationController` read these at alert time, so a
 * change applies to the next alert.
 */
export interface NotificationPrefs {
  /** A notification names who wrote and what they wrote; off, only who. */
  showMessageText: boolean;
  /** Direct messages and group chats raise a sound and a notification. They still count as unread when off. */
  directMessages: boolean;
  /** The cue for a message that alerts the user. */
  messageSound: boolean;
  /** The ring of an incoming call. */
  callSound: boolean;
  /** The unread count on the desktop app's icon. */
  appBadge: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  showMessageText: true,
  directMessages: true,
  messageSound: true,
  callSound: true,
  appBadge: true,
};

interface NotificationPrefsState extends NotificationPrefs {
  setPref: <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => void;
}

export const useNotificationPrefsStore = create<NotificationPrefsState>()(persist(
  (set) => ({
    ...DEFAULT_NOTIFICATION_PREFS,
    setPref: (key, value) => set({ [key]: value }),
  }),
  { name: 'tavvit-notification-prefs' },
));
