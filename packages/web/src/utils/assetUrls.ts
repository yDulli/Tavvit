import { PICTURE_PATH, type WornCustomDecorations } from '@backspace/shared/src/customDecorations';
import { getApiForOrigin } from '../stores/spaceStore';

/**
 * The address a stored picture (an icon, a banner) is fetched from: an absolute address or a path as
 * it is, a bare upload name under this page's own `/api/uploads/`. A space or person from another
 * instance already carries an absolute address on that instance (the stores rewrite it on arrival),
 * so no origin is needed here.
 */
export function uploadAddress(value: string): string {
  return value.startsWith('http') || value.startsWith('/') ? value : `/api/uploads/${value}`;
}

/** Strip /api/uploads/ prefix to get bare filename. No-op for bare filenames and absolute URLs. */
export function stripUploadPrefix(filename: string): string {
  return filename.startsWith('/api/uploads/') ? filename.slice('/api/uploads/'.length) : filename;
}

/**
 * Resolve a relative asset filename to an absolute URL for remote origins.
 * Home-origin filenames are returned as-is (components handle the /api/uploads/ prefix).
 * Already-absolute URLs (starting with 'http') pass through unchanged.
 */
export function resolveAssetUrl(filename: string | null | undefined, origin: string): typeof filename {
  if (!filename || !origin || filename.startsWith('http')) return filename;
  return getApiForOrigin(origin).uploads.url(stripUploadPrefix(filename));
}

/** A made design's picture as its instance sends it (a path there), made absolute on that instance. */
function madePictureOn(address: string | null, origin: string): string | null {
  return address !== null && PICTURE_PATH.test(address) ? `${origin}${address}` : address;
}

/**
 * Rewrite the avatar field on a user-like object for remote origins, and the pictures of the
 * decorations it made itself and wears.
 * Mutates in-place for efficiency (called on arrays of members/messages).
 */
export function normalizeUserAssets<T extends { avatar?: string | null; banner?: string | null; customDecorations?: WornCustomDecorations | null }>(user: T, origin: string): T {
  if (!origin) return user;
  if (user.avatar) {
    user.avatar = resolveAssetUrl(user.avatar, origin) ?? user.avatar;
  }
  if (user.banner) {
    user.banner = resolveAssetUrl(user.banner, origin) ?? user.banner;
  }
  if (user.customDecorations) {
    for (const view of Object.values(user.customDecorations)) {
      if (!view) continue;
      view.image = madePictureOn(view.image, origin);
      view.still = madePictureOn(view.still, origin);
    }
  }
  // Qualify users local to the remote instance with their origin domain.
  // These users have no homeInstance (they're native there), so the client
  // can't distinguish them from its own local users without this step.
  const u = user as Record<string, unknown>;
  if (typeof u.username === 'string' && typeof u.id === 'string' && !u.homeInstance) {
    try {
      const host = new URL(origin).host;
      u.homeInstance = host;
      if (!u.homeUserId) u.homeUserId = u.id;
      if (!(u.username as string).includes('@')) {
        u.username = `${u.username}@${host}`;
      }
    } catch {}
  }
  return user;
}

/**
 * Rewrite user.avatar and attachment filenames on a message for remote origins.
 * Also normalizes nested replyTo message assets. Mutates in-place.
 */
export function normalizeMessageAssets<T extends { user: { avatar?: string | null }; attachments?: { filename: string; thumbnailFilename?: string | null }[]; replyTo?: { user: { avatar?: string | null }; attachments?: { filename: string; thumbnailFilename?: string | null }[] } | null }>(
  message: T,
  origin: string,
): T {
  if (!origin) return message;
  normalizeUserAssets(message.user, origin);
  if (message.attachments) {
    for (const att of message.attachments) {
      att.filename = resolveAssetUrl(att.filename, origin) ?? att.filename;
      if (att.thumbnailFilename) {
        att.thumbnailFilename = resolveAssetUrl(att.thumbnailFilename, origin) ?? att.thumbnailFilename;
      }
    }
  }
  // Normalize reply-to message assets (remote replies have relative URLs)
  if (message.replyTo) {
    normalizeUserAssets(message.replyTo.user, origin);
    if (message.replyTo.attachments) {
      for (const att of message.replyTo.attachments) {
        att.filename = resolveAssetUrl(att.filename, origin) ?? att.filename;
        if (att.thumbnailFilename) {
          att.thumbnailFilename = resolveAssetUrl(att.thumbnailFilename, origin) ?? att.thumbnailFilename;
        }
      }
    }
  }
  return message;
}
