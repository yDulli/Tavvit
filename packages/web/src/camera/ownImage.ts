import { openDB, type IDBPDatabase } from 'idb';
import { create } from 'zustand';

/**
 * The picture a person lays behind themselves on camera. It stays on this
 * device: it is kept in this browser's IndexedDB, used from there, and never
 * sent anywhere. Only the finished camera picture leaves, in a call. Signing
 * out deletes it (`forgetOwnImage`), so the next person on a shared device
 * does not find it.
 *
 * The file is decoded, scaled down and written again as a JPEG before it is
 * kept, which also drops whatever metadata it carried (where and when a photo
 * was taken).
 */

const DB_NAME = 'tavvit-camera';
const STORE = 'backgrounds';
const OWN_KEY = 'own';

/** The longest side a picture is kept at: the camera sends 1280x720, a phone 720x1280. */
export const OWN_IMAGE_MAX_SIDE = 2560;

/** The largest file taken, before it is scaled down. */
export const OWN_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

/** What shows through where a picture is transparent: the app's content surface. */
const BACKDROP_FILL = '#15161b';

export type OwnImageProblem = 'tooLarge' | 'notAnImage' | 'notKept';

/** Why a file could not become the background, for the picker to say. */
export class OwnImageRejected extends Error {
  constructor(readonly problem: OwnImageProblem) {
    super(`own background image rejected: ${problem}`);
    this.name = 'OwnImageRejected';
  }
}

interface OwnImageState {
  /** `unknown` until this device's store has been read once in this page. */
  status: 'unknown' | 'none' | 'ready';
  /** The picture's address in this page (an object URL), while there is one. */
  url: string | null;
}

export const useOwnImage = create<OwnImageState>(() => ({ status: 'unknown', url: null }));

let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
    // A failed open (storage blocked, a private window) is tried again next time.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function show(blob: Blob | null): void {
  const previous = useOwnImage.getState().url;
  if (previous) URL.revokeObjectURL(previous);
  useOwnImage.setState(blob ? { status: 'ready', url: URL.createObjectURL(blob) } : { status: 'none', url: null });
}

let reading: Promise<void> | null = null;

/** The picture's address, reading this device's store the first time. Null when there is none. */
export async function loadOwnImage(): Promise<string | null> {
  if (useOwnImage.getState().status === 'unknown') {
    reading ??= (async () => {
      try {
        const kept: unknown = await (await database()).get(STORE, OWN_KEY);
        show(kept instanceof Blob ? kept : null);
      } catch {
        show(null);
      }
    })().finally(() => {
      reading = null;
    });
    await reading;
  }
  return useOwnImage.getState().url;
}

async function encode(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new OwnImageRejected('notAnImage');
  }
  try {
    const scale = Math.min(1, OWN_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new OwnImageRejected('notAnImage');
    context.fillStyle = BACKDROP_FILL;
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new OwnImageRejected('notAnImage');
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Makes `file` the own background, replacing the one kept before. */
export async function saveOwnImage(file: File): Promise<void> {
  if (file.size > OWN_IMAGE_MAX_BYTES) throw new OwnImageRejected('tooLarge');
  const blob = await encode(file);
  try {
    await (await database()).put(STORE, blob, OWN_KEY);
  } catch {
    throw new OwnImageRejected('notKept');
  }
  show(blob);
}

/** Deletes the own background from this device. */
export async function forgetOwnImage(): Promise<void> {
  try {
    await (await database()).delete(STORE, OWN_KEY);
  } catch {
    // Nothing kept, or storage unavailable: either way there is no picture left to show.
  } finally {
    show(null);
  }
}
