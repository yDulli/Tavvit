import { stickerUrl } from '@backspace/shared/src/stickers.js';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { canonicalizeHomeInstance, getOurOrigin } from './federationAuth.js';

// Pictures and stickers that other people's clients fetch by themselves, before anyone clicks:
// an account's picture and banner, a space's icon and banner, a group's icon, a sticker in a
// message or a reaction (docs/systems/legal.md, "Content from other servers"). A file of this
// instance is fetched from this instance. One named by an address is fetched from wherever the
// address points, and that server learns the reader's address and when they read. So such an
// address may name a file on this instance, or on the instance an account lives on, since
// federation keeps a person's pictures and stickers at home: never a file anywhere else.

/** A file in the upload directory, by the path this instance and every other serves it at. */
const UPLOAD_PATH = /^\/api\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
/** What a picture field may hold when it names a file of this instance: its bare name, or its path. */
const UPLOAD_REFERENCE = /^(?:\/api\/uploads\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
/** A path on the server the page came from: one slash, then neither a second one nor a backslash anywhere. */
const ROOT_PATH = /^\/(?![/\\])[^\\\s]*$/;

/** The origin of an instance as `home_instance` or the configuration names it ("host" or "https://host"), or null. */
export function instanceOrigin(value: string | null | undefined): string | null {
  const canonical = canonicalizeHomeInstance(value);
  if (!canonical) return null;
  try {
    const url = new URL(canonical);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

let oursFor: { configured: string; origin: string } | null = null;

/** This instance's origin, parsed once for each value the configuration gives. */
function ourOrigin(): string {
  const configured = getOurOrigin();
  if (oursFor?.configured !== configured) oursFor = { configured, origin: instanceOrigin(configured) ?? configured };
  return oursFor.origin;
}

/** Where an account's pictures and stickers may live: this instance, and its home when it lives elsewhere. */
export function mediaOriginsFor(homeInstance?: string | null): string[] {
  const ours = ourOrigin();
  const home = instanceOrigin(homeInstance);
  return home && home !== ours ? [ours, home] : [ours];
}

/** `mediaOriginsFor` the account `userId` on this instance; this instance alone when there is no such row. */
export function mediaOriginsOfUser(userId: string): string[] {
  const row = getDb().select({ homeInstance: schema.users.homeInstance }).from(schema.users)
    .where(eq(schema.users.id, userId)).get();
  return mediaOriginsFor(row?.homeInstance);
}

/** The origin an http(s) address points at, or null for anything else or an address that carries credentials. */
function addressOrigin(address: string): string | null {
  try {
    const url = new URL(address);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Whether `address` is an uploaded file on one of `origins`, named by its full address. */
export function isUploadOn(address: string, origins: readonly string[]): boolean {
  const origin = addressOrigin(address);
  if (!origin || !origins.includes(origin)) return false;
  const { pathname, search, hash } = new URL(address);
  return !search && !hash && UPLOAD_PATH.test(pathname) && !pathname.includes('..');
}

/**
 * What a picture field shows anyone: nothing, a file of this instance, or an address of a file on
 * one of `origins`. Anything else, such as an address stored before this rule held, shows as no
 * picture. The stored value itself is left as it is.
 */
export function shownPicture(value: string | null | undefined, origins: readonly string[]): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return isUploadOn(value, origins) ? value : null;
  // A path on this instance. Not "//host" or "/\host": a browser reads either as another server.
  if (ROOT_PATH.test(value)) return value;
  return UPLOAD_REFERENCE.test(value) && !value.includes('..') ? value : null;
}

/** `shownPicture` for one of an account's fields: its origins are only worked out for an address, which few are. */
export function shownAccountPicture(value: string | null | undefined, homeInstance: string | null | undefined): string | null {
  if (!value) return null;
  return shownPicture(value, /^https?:\/\//i.test(value) ? mediaOriginsFor(homeInstance) : []);
}

/** Whether `content` is no sticker at all, or a sticker whose file lives on one of `origins`. */
export function isStickerFrom(content: string, origins: readonly string[]): boolean {
  const url = stickerUrl(content);
  if (url === null) return true;
  const origin = addressOrigin(url);
  return origin !== null && origins.includes(origin);
}

/**
 * Whether `userId` may post `content` (a message, or a reaction's emoji): anything that is not a
 * sticker, or a sticker from this instance or from the instance the account lives on. A person's
 * collection only ever holds stickers of their home (`POST /api/stickers/:id/collect` takes no
 * other), so a sticker from anywhere else was written by hand to make readers fetch it.
 */
export function mayPostSticker(content: string | null | undefined, userId: string): boolean {
  if (!content || stickerUrl(content) === null) return true;
  return isStickerFrom(content, mediaOriginsOfUser(userId));
}
