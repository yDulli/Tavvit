import { openDB, type IDBPDatabase } from 'idb';

/**
 * What a push may say on this device while streamer mode is on. The service
 * worker shows pushes when no window of the app is in front (docs/systems/push.md),
 * which is exactly while someone streams another program, and a stream
 * captures the screen, not a window. `public/sw-push.js` reads this before it
 * shows one and, while it is set, shows these words instead of the message's.
 *
 * Kept in IndexedDB, the one store a service worker can read; this device only,
 * like the mode itself.
 */

export const PUSH_MASK_DB = 'tavvit-device';
export const PUSH_MASK_STORE = 'flags';
export const PUSH_MASK_KEY = 'streamerMode';

export interface PushMask {
  title: string;
  body: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(PUSH_MASK_DB, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PUSH_MASK_STORE)) db.createObjectStore(PUSH_MASK_STORE);
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Sets the words pushes show while streamer mode is on, or clears them (null). */
export async function writePushMask(mask: PushMask | null): Promise<void> {
  const db = await database();
  if (mask) await db.put(PUSH_MASK_STORE, mask, PUSH_MASK_KEY);
  else await db.delete(PUSH_MASK_STORE, PUSH_MASK_KEY);
}
