import { randomBytes } from 'node:crypto';

/**
 * The name an uploaded file is stored and served under. `GET /api/uploads/<name>` answers anyone
 * who asks, without a session, because a picture in a page is fetched without one; so for a file
 * in a DM or a private channel the name is the only key. A snowflake alone is a reading of the
 * clock that anyone can count through, so 128 random bits follow it.
 */
export function storedUploadName(id: string, ext: string): string {
  return `${id}-${randomBytes(16).toString('hex')}${ext}`;
}
