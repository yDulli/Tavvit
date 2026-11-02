import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { schema } from '../db/index.js';
import { generateSnowflake } from './snowflake.js';
import { thumbFilename } from './thumbnail.js';

export type AttachmentRow = typeof schema.attachments.$inferSelect;
export type CopiedAttachment = Pick<AttachmentRow, 'filename' | 'thumbnailFilename' | 'originalName' | 'mimetype' | 'size' | 'width' | 'height' | 'duration' | 'playable' | 'spoiler' | 'voiceWaveform'>;

const uploadPath = (filename: string): string => path.join(config.uploadDir, path.basename(filename));

/**
 * One more name for a file on this disk. A hard link when `share` says so and the disk can make
 * one, which takes no room however often it is made: deleting one name leaves the others, and
 * nothing here writes to a file once it is stored. Otherwise a copy.
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
  await fsp.copyFile(from, to, fsConstants.COPYFILE_FICLONE);
}

/**
 * A copy of each file on this disk, because deleting a message deletes its files. A file from a
 * peer still on its way has no local file to copy and is left out; the caller refuses when that
 * leaves nothing to send. If a copy fails, those already made are removed and the error goes up.
 */
export async function copyAttachments(rows: readonly AttachmentRow[], options: { share?: boolean } = {}): Promise<CopiedAttachment[]> {
  const share = options.share === true;
  const copies: CopiedAttachment[] = [];
  const written: string[] = [];
  try {
    for (const row of rows) {
      if (/^https?:/.test(row.filename)) continue;
      const filename = `${generateSnowflake()}${path.extname(row.filename)}`;
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
