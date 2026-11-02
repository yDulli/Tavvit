import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';

/** Where the soundboard's clips are kept (routes/soundboard.ts): one file per clip, named after its row. */
export function soundDir(): string {
  return path.join(config.uploadDir, 'sounds');
}

export function soundFilePath(id: string): string {
  return path.join(soundDir(), `${id}.audio`);
}

/** The files of clips whose rows are gone, as deleting a space leaves them. */
export function removeSoundFiles(ids: readonly string[]): void {
  for (const id of ids) {
    try {
      fs.rmSync(soundFilePath(id), { force: true });
    } catch (err) {
      console.warn('[soundboard] Could not remove a file:', err);
    }
  }
}

/**
 * Files whose clip is gone, from a deletion that stopped between the row and the file. At the start
 * every such file goes; the hourly sweep leaves those younger than `minAgeMs`, whose row may still be
 * on its way in.
 */
export function removeUnusedSoundFiles(minAgeMs = 0, now: number = Date.now()): number {
  let names: string[];
  try {
    names = fs.readdirSync(soundDir());
  } catch {
    return 0;
  }
  const known = new Set(getDb().select({ id: schema.spaceSounds.id }).from(schema.spaceSounds).all().map((row) => row.id));
  let removed = 0;
  for (const name of names) {
    if (known.has(name.replace(/\.audio$/, ''))) continue;
    const file = path.join(soundDir(), name);
    try {
      if (minAgeMs > 0 && now - fs.statSync(file).mtimeMs < minAgeMs) continue;
      fs.unlinkSync(file);
      removed += 1;
    } catch (err) {
      console.warn('[soundboard] Could not remove an unused file:', err);
    }
  }
  return removed;
}
