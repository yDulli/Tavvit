import type { Activity } from '@backspace/shared';
import { useActivityStore } from '../stores/activityStore';

let unsubscribe: (() => void) | null = null;

export function initActivityBridge(): void {
  if (unsubscribe) return; // already initialized
  if (!window.backspace?.onActivityDetected) return; // not Electron

  // Subscribe to future activity changes from main process
  unsubscribe = window.backspace.onActivityDetected((activity) => {
    if (activity) {
      useActivityStore.getState().pushActivities([activity as Activity]);
    } else {
      useActivityStore.getState().pushActivities([]);
    }
  });

  // Request current state (handles instance-switch: game was already running).
  // No game is a state too: a game that ended while the page reloaded must
  // not stay on the profile until the next change.
  window.backspace.getCurrentActivity?.().then((activity: unknown) => {
    useActivityStore.getState().pushActivities(activity ? [activity as Activity] : []);
  }).catch(() => {});
}

export function teardownActivityBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}
