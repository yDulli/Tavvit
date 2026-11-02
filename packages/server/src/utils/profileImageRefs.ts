import path from 'node:path';
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { PICTURE_UPLOAD_MAX_BYTES, PICTURE_UPLOAD_MIME_PREFIX } from '@backspace/shared/src/constants.js';
import { getDb, schema } from '../db/index.js';
import { deleteUploadFile } from './fileCleanup.js';
import { isUploadOn, mediaOriginsFor } from './remoteMedia.js';

// The pictures accounts, space profiles, spaces and group DMs show
// (docs/systems/uploads.md, "Profile pictures"). Each is a file in the upload
// directory that no message holds, so the storage janitor and every route that
// sets or replaces one read the same rules here: which files are still shown,
// and which file a person may put in such a field.

/** A stored upload name: a bare name, no directory, nothing that climbs out. */
const UPLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const UPLOAD_PREFIX = '/api/uploads/';

/** The bare upload name a picture field holds or a request names; null for none or another site's address. */
export function uploadNameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
  const name = trimmed.startsWith(UPLOAD_PREFIX) ? trimmed.slice(UPLOAD_PREFIX.length) : trimmed;
  return UPLOAD_NAME.test(name) && !name.includes('..') ? name : null;
}

/** Every file a picture field names: account pictures and banners, space profiles, space icons and banners, group DM icons. */
export function profileImageFilenames(): Set<string> {
  const db = getDb();
  const referenced = new Set<string>();
  const add = (value: string | null) => {
    if (value) referenced.add(path.basename(value));
  };
  for (const row of db.select({ avatar: schema.users.avatar, banner: schema.users.banner }).from(schema.users)
    .where(or(isNotNull(schema.users.avatar), isNotNull(schema.users.banner))).all()) {
    add(row.avatar);
    add(row.banner);
  }
  for (const row of db.select({ avatar: schema.spaceMembers.avatar, banner: schema.spaceMembers.banner }).from(schema.spaceMembers)
    .where(or(isNotNull(schema.spaceMembers.avatar), isNotNull(schema.spaceMembers.banner))).all()) {
    add(row.avatar);
    add(row.banner);
  }
  for (const row of db.select({ icon: schema.spaces.icon, banner: schema.spaces.banner }).from(schema.spaces)
    .where(or(isNotNull(schema.spaces.icon), isNotNull(schema.spaces.banner))).all()) {
    add(row.icon);
    add(row.banner);
  }
  // A soft-deleted DM's files go with its purge (cleanupSoftDeletedDmChannels);
  // an absolute URL is a file on another instance.
  for (const row of db.select({ icon: schema.dmChannels.icon }).from(schema.dmChannels)
    .where(and(isNotNull(schema.dmChannels.icon), isNull(schema.dmChannels.deletedAt))).all()) {
    if (row.icon && !row.icon.startsWith('http')) add(row.icon);
  }
  return referenced;
}

/** Whether any account, space profile, space or group DM still shows `filename` (a bare upload name). */
export function profileImageInUse(filename: string): boolean {
  const db = getDb();
  const forms = [filename, `${UPLOAD_PREFIX}${filename}`];
  const matches = (column: SQLiteColumn) => or(...forms.map((form) => eq(column, form)));
  if (db.select({ id: schema.users.id }).from(schema.users)
    .where(or(matches(schema.users.avatar), matches(schema.users.banner))).get()) return true;
  if (db.select({ userId: schema.spaceMembers.userId }).from(schema.spaceMembers)
    .where(or(matches(schema.spaceMembers.avatar), matches(schema.spaceMembers.banner))).get()) return true;
  if (db.select({ id: schema.spaces.id }).from(schema.spaces)
    .where(or(matches(schema.spaces.icon), matches(schema.spaces.banner))).get()) return true;
  return !!db.select({ id: schema.dmChannels.id }).from(schema.dmChannels)
    .where(and(matches(schema.dmChannels.icon), isNull(schema.dmChannels.deletedAt))).get();
}

/**
 * Whether a message or DM message holds `filename` as its attachment. A
 * picture field written before the ownership rule could name such a file;
 * replacing or clearing that field must not delete it.
 */
export function attachmentHeldByMessage(filename: string): boolean {
  return getDb().select({ id: schema.attachments.id }).from(schema.attachments)
    .where(and(
      eq(schema.attachments.filename, filename),
      or(isNotNull(schema.attachments.messageId), isNotNull(schema.attachments.dmMessageId)),
    ))
    .get() !== undefined;
}

/** Whether a picture's file may go once its field no longer shows it: nothing else shows it, and no message holds it. */
export function pictureFileReleasable(filename: string): boolean {
  return !profileImageInUse(filename) && !attachmentHeldByMessage(filename);
}

/**
 * Deletes the files member rows showed as their own picture and banner, once the rows are gone. A
 * member's picture is shown by that row alone, so left behind, joining a space, setting one and
 * leaving again would pile up files nobody pays for (utils/accountLimits.ts). The rows are read
 * before they are deleted, and this runs after.
 */
export function releaseMemberPictures(rows: ReadonlyArray<{ avatar: string | null; banner: string | null }>): void {
  for (const row of rows) {
    for (const name of [uploadNameOf(row.avatar), uploadNameOf(row.banner)]) {
      if (name && pictureFileReleasable(name)) deleteUploadFile(name);
    }
  }
}

/**
 * The bare upload name `userId` may put in a picture field that holds
 * `current`: an image they uploaded themselves, no larger than a picture field
 * takes, that no message holds; or the file the field already shows. Undefined
 * for anything else, so nobody points a field at someone else's file, which the
 * field would then resize and, once replaced, delete. Setting a field drops the
 * upload's record, and with it what the file counts on the account's storage:
 * without the type and the size, any upload of any size could be made to count
 * for nothing (utils/accountLimits.ts).
 */
export function ownProfileUploadOf(value: string, userId: string, current: string | null): string | undefined {
  const name = uploadNameOf(value);
  if (!name) return undefined;
  if (current !== null && uploadNameOf(current) === name) return name;
  // A file another picture field already shows belongs to that field, even
  // where its upload record survived (one set before records were dropped).
  if (profileImageInUse(name)) return undefined;
  const upload = getDb().select({ mimetype: schema.attachments.mimetype, size: schema.attachments.size }).from(schema.attachments)
    .where(and(
      eq(schema.attachments.filename, name),
      eq(schema.attachments.uploaderId, userId),
      isNull(schema.attachments.messageId),
      isNull(schema.attachments.dmMessageId),
    ))
    .get();
  if (!upload) return undefined;
  return upload.mimetype.startsWith(PICTURE_UPLOAD_MIME_PREFIX) && upload.size <= PICTURE_UPLOAD_MAX_BYTES ? name : undefined;
}

/** What a picture field keeps, and the file of this instance it newly shows. */
export interface ProfilePicture {
  /** A bare upload name, another site's http(s) address, or null for none. */
  stored: string | null;
  /**
   * The file of this instance the field shows from now on and did not
   * before: the only file the caller may resize or take the upload record
   * of. Null for an address elsewhere, a clear, or the picture already shown.
   */
  upload: string | null;
}

/**
 * A picture field's new value from a request, checked once: trimmed, an
 * address only of an upload on one of `origins` (this instance's, and for an
 * account that lives elsewhere its home's: utils/remoteMedia.ts), a file here
 * only as `userId`'s own upload or the picture the field already shows
 * (ownProfileUploadOf). Undefined for anything else. Every later step works on
 * the answer, never on the raw value, so no spelling of a value reaches a file
 * the check did not pass.
 */
export function profilePictureOf(
  value: unknown,
  userId: string,
  current: string | null,
  origins: readonly string[] = mediaOriginsFor(),
): ProfilePicture | undefined {
  if (value === null || value === undefined) return { stored: null, upload: null };
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return { stored: null, upload: null };
  // Everyone who sees the picture fetches it by themselves, so an address may not point anywhere else.
  if (/^https?:\/\//i.test(trimmed)) return isUploadOn(trimmed, origins) ? { stored: trimmed, upload: null } : undefined;
  const name = ownProfileUploadOf(trimmed, userId, current);
  if (!name) return undefined;
  return { stored: name, upload: name === uploadNameOf(current) ? null : name };
}
