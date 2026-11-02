import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { schema } from '../db/index.js';
import { diskWouldFill } from './accountLimits.js';
import { generateSnowflake } from './snowflake.js';
import { thumbFilename } from './thumbnail.js';
import { storedUploadName } from './uploadNames.js';

export type AttachmentRow = typeof schema.attachments.$inferSelect;
export type CopiedAttachment = Pick<AttachmentRow, 'filename' | 'thumbnailFilename' | 'originalName' | 'mimetype' | 'size' | 'width' | 'height' | 'duration' | 'playable' | 'spoiler' | 'voiceWaveform'>;

const uploadPath = (filename: string): string => path.join(config.uploadDir, path.basename(filename));

/** A copy would have left the disk without its reserve (utils/accountLimits.ts). */
export class DiskFullError extends Error {
  readonly code = 'disk_full' as const;

  constructor() {
    super('The disk has no room for a copy');
    this.name = 'DiskFullError';
  }
}

/** Whether a stored file is this disk's: one fetched from a peer and not yet here is only an address. */
export function isOnThisDisk(row: Pick<AttachmentRow, 'filename'>): boolean {
  return !/^https?:/.test(row.filename);
}

/**
 * One more name for a file on this disk. A hard link when `share` says so and the disk can make
 * one, which takes no room however often it is made: deleting one name leaves the others, and
 * nothing here writes to a file once it is stored. Otherwise a copy, and only while the disk keeps
 * its reserve.
 */
async function duplicate(from: string, to: string, share: boolean): Promise<void> {
  if (share) {
    try {
      await fsp.link(from, to);
      return;
    } catch {
      // Not on this disk, or not with these rights: an ordinary copy does it.
    }
  }
  const { size } = await fsp.stat(from);
  if (diskWouldFill(size)) throw new DiskFullError();
  await fsp.copyFile(from, to, fsConstants.COPYFILE_FICLONE);
}

/**
 * A copy of each file on this disk, because deleting a message deletes its files. Each copy gets a
 * name nobody can guess, as an upload does (utils/uploadNames.ts): files are served to whoever
 * names them. A file from a peer still on its way has no local file to copy and is left out; the
 * caller refuses when that leaves nothing to send. If a copy fails, those already made are
 * removed and the error goes up: a DiskFullError when the disk had no room.
 */
export async function copyAttachments(rows: readonly AttachmentRow[], options: { share?: boolean } = {}): Promise<CopiedAttachment[]> {
  const share = options.share === true;
  const copies: CopiedAttachment[] = [];
  const written: string[] = [];
  try {
    for (const row of rows) {
      if (!isOnThisDisk(row)) continue;
      const filename = storedUploadName(generateSnowflake(), path.extname(row.filename));
      await duplicate(uploadPath(row.filename), uploadPath(filename), share);
      written.push(filename);
      let thumbnailFilename: string | null = null;
      if (row.thumbnailFilename) {
        const thumbnail = thumbFilename(filename);
        await duplicate(uploadPath(row.thumbnailFilename), uploadPath(thumbnail), share);
        written.push(thumbnail);
        thumbnailFilename = thumbnail;
      }
      copies.push({
        filename,
        thumbnailFilename,
        originalName: row.originalName,
        mimetype: row.mimetype,
        size: row.size,
        width: row.width,
        height: row.height,
        duration: row.duration,
        playable: row.playable,
        spoiler: row.spoiler,
        voiceWaveform: row.voiceWaveform,
      });
    }
  } catch (err) {
    await Promise.all(written.map((filename) => fsp.unlink(uploadPath(filename)).catch(() => {})));
    throw err;
  }
  return copies;
}
