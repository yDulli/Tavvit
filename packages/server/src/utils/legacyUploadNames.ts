import fs from 'node:fs';
import path from 'node:path';
import { createHmac, hkdfSync } from 'node:crypto';
import { and, eq, isNotNull, lt, notLike, or } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { profileImageInUse } from './profileImageRefs.js';
import { thumbFilename } from './thumbnail.js';

// Files of messages stored before 1.32.4 are named by their snowflake alone, which anyone can count
// through, and `/api/uploads/<name>` answers without a session (utils/uploadNames.ts). This gives
// each such file a name that cannot be guessed: the hourly janitor renames a batch at a time
// until none is left (docs/systems/uploads.md, "The name is the key").
//
// The new name is derived from the old one with a key of this server, so a run cut off half way
// finds the same name again and finishes the job; nothing needs remembering in between. Each file
// is done without a pause: a second name for the file (a hard link), the rows that name it, then
// the old name goes. Nothing else of the server runs in between, the storage janitor included.

/** A name of the snowflake alone, with an extension or none (a file replicated from a peer keeps its extension's case). */
const LEGACY_NAME = /^\d{15,20}(\.[A-Za-z0-9]{1,10})?$/;

/** A file newer than this may still be on its way to a peer (federation file replication): it waits. */
export const LEGACY_RENAME_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** At most this many files a run, so a large instance spreads the work over hours. */
export const LEGACY_RENAME_BATCH = 500;

let renameKey: Buffer | null = null;

/** The name a legacy file gets: its snowflake, a hyphen, 128 bits only this server can work out, its extension. */
export function renamedUploadName(oldName: string): string {
  renameKey ??= Buffer.from(hkdfSync('sha256', config.jwtSecret, '', 'tavvit-upload-renames', 32));
  const ext = path.extname(oldName);
  const base = oldName.slice(0, oldName.length - ext.length);
  const secret = createHmac('sha256', renameKey).update(oldName).digest('hex').slice(0, 32);
  return `${base}-${secret}${ext}`;
}

export function isLegacyUploadName(name: string): boolean {
  return LEGACY_NAME.test(name);
}

/** Give `oldName` the name `newName` on disk: a second name first, so the file is never missing. */
function relink(oldName: string, newName: string): 'moved' | 'missing' {
  const from = path.join(config.uploadDir, oldName);
  const to = path.join(config.uploadDir, newName);
  if (fs.existsSync(to)) return 'moved';
  if (!fs.existsSync(from)) return 'missing';
  fs.linkSync(from, to);
  return 'moved';
}

function unlinkQuietly(name: string): void {
  try {
    fs.unlinkSync(path.join(config.uploadDir, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export interface LegacyRenameResult {
  renamed: number;
  /** Files whose rows name them but that are not on disk: left as they are. */
  missing: number;
  /** Legacy files still to do after this run. */
  left: boolean;
}

/**
 * Rename up to `LEGACY_RENAME_BATCH` legacy files of messages and DM messages older than
 * `LEGACY_RENAME_MIN_AGE_MS`, with their thumbnails. A file a picture field also shows is left
 * alone: it is shown to everyone anyway, and its field would lose it.
 */
export function renameLegacyUploads(now: number = Date.now()): LegacyRenameResult {
  const db = getDb();
  const rows = db.select({
    filename: schema.attachments.filename,
    thumbnailFilename: schema.attachments.thumbnailFilename,
  }).from(schema.attachments)
    .where(and(
      or(isNotNull(schema.attachments.messageId), isNotNull(schema.attachments.dmMessageId)),
      lt(schema.attachments.createdAt, now - LEGACY_RENAME_MIN_AGE_MS),
      // Every name given since has a hyphen: once the work is done, this finds nothing to read.
      notLike(schema.attachments.filename, '%-%'),
    ))
    .all()
    .filter((row) => isLegacyUploadName(row.filename));

  const result: LegacyRenameResult = { renamed: 0, missing: 0, left: false };
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.filename)) continue;
    seen.add(row.filename);
    if (result.renamed + result.missing >= LEGACY_RENAME_BATCH) {
      result.left = true;
      break;
    }
    if (profileImageInUse(row.filename)) continue;

    const oldName = row.filename;
    const newName = renamedUploadName(oldName);
    if (relink(oldName, newName) === 'missing') {
      result.missing += 1;
      continue;
    }
    // The thumbnail follows the file's new name, by the rule every thumbnail has.
    const oldThumb = row.thumbnailFilename;
    const newThumb = oldThumb ? thumbFilename(newName) : null;
    const thumbMoved = oldThumb && newThumb ? relink(oldThumb, newThumb) === 'moved' : false;

    db.transaction((tx) => {
      tx.update(schema.attachments).set({ filename: newName }).where(eq(schema.attachments.filename, oldName)).run();
      if (oldThumb && newThumb) {
        tx.update(schema.attachments)
          .set({ thumbnailFilename: thumbMoved ? newThumb : null })
          .where(eq(schema.attachments.thumbnailFilename, oldThumb)).run();
      }
    });
    unlinkQuietly(oldName);
    if (oldThumb && thumbMoved) unlinkQuietly(oldThumb);
    result.renamed += 1;
  }
  return result;
}
