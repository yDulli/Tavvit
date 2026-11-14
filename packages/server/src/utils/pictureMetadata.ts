import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

/**
 * What a photo says about where and with what it was taken (docs/systems/uploads.md, "What a
 * photo carries"). A phone writes the place (GPS), the time, the device and often a small copy of
 * the uncropped picture into a JPEG, and an upload is served as it came: anyone who could open the
 * picture could read where its sender lives. So a JPEG loses that on its way in.
 *
 * Without touching the picture: a JPEG is a row of segments before the image data, and only whole
 * segments are left out, so not one pixel is encoded again.
 *
 * - **Left out:** APP1 (Exif with the place, time and device; XMP), APP13 (IPTC, Photoshop's
 *   records) and comments.
 * - **Kept:** everything the picture needs to look right: JFIF, the colour profile (APP2), Adobe's
 *   colour marker (APP14) and the tables. And which way up it is: a phone stores a photo sideways
 *   and says so in Exif, so that one value comes back in an Exif segment that holds nothing else.
 *
 * Anything that does not read as a plain JPEG is left exactly as it is: better a file as it came
 * than one this broke.
 */

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const APP1 = 0xe1;
const APP13 = 0xed;
const COM = 0xfe;
const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const ORIENTATION_TAG = 0x0112;

/** How much of a file is read to find where its image data starts. A header is rarely a tenth of this. */
export const JPEG_HEADER_BYTES = 8 * 1024 * 1024;

/** The orientation (1 to 8) an Exif segment's first directory names, or null. `body` starts after the segment's length. */
export function exifOrientation(body: Buffer): number | null {
  if (body.length < EXIF_HEADER.length + 8 || !body.subarray(0, EXIF_HEADER.length).equals(EXIF_HEADER)) return null;
  const tiff = body.subarray(EXIF_HEADER.length);
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return null;
  const directory = u32(4);
  if (directory + 2 > tiff.length) return null;
  const entries = u16(directory);
  for (let entry = 0; entry < entries; entry += 1) {
    const at = directory + 2 + entry * 12;
    if (at + 12 > tiff.length) return null;
    if (u16(at) !== ORIENTATION_TAG) continue;
    const value = u16(at + 8);
    return u16(at + 2) === 3 && u32(at + 4) === 1 && value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/** An Exif segment, marker and all, that says which way up the picture is and nothing else. */
export function orientationSegment(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(ORIENTATION_TAG, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const body = Buffer.concat([EXIF_HEADER, tiff]);
  const head = Buffer.from([0xff, APP1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/**
 * The start of a JPEG without what it says about its taking. `head` is the file's beginning.
 * Answers the new beginning and how many bytes of the old one it stands for (up to the image
 * data, which follows unchanged), or null when there is nothing to leave out or the bytes are
 * not a JPEG read to that point.
 */
export function jpegHeadWithoutMetadata(head: Buffer): { head: Buffer; replaces: number } | null {
  if (head.length < 4 || head[0] !== 0xff || head[1] !== SOI) return null;
  const kept: Buffer[] = [head.subarray(0, 2)];
  let orientation: number | null = null;
  let removed = false;
  let at = 2;
  for (;;) {
    if (at + 4 > head.length || head[at] !== 0xff) return null;
    const marker = head[at + 1]!;
    // Fill bytes before a marker are allowed, and skipped as they are kept.
    if (marker === 0xff) {
      kept.push(head.subarray(at, at + 1));
      at += 1;
      continue;
    }
    // The image data starts: everything from here on is the picture, kept as it is.
    if (marker === SOS) break;
    // A marker that stands alone, or the end before any image data: not a file to take apart.
    if (marker === EOI || marker === SOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    const length = head.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > head.length) return null;
    const segment = head.subarray(at, at + 2 + length);
    if (marker === APP1 || marker === APP13 || marker === COM) {
      removed = true;
      if (marker === APP1 && orientation === null) orientation = exifOrientation(segment.subarray(4));
    } else {
      kept.push(segment);
    }
    at += 2 + length;
  }
  if (!removed) return null;
  // Right after the start marker and JFIF, where a reader looks for it. 1 is "as stored": nothing to say.
  if (orientation !== null && orientation !== 1) {
    const afterJfif = kept.length > 1 && kept[1]![1] === 0xe0 ? 2 : 1;
    kept.splice(afterJfif, 0, orientationSegment(orientation));
  }
  return { head: Buffer.concat(kept), replaces: at };
}

/**
 * Takes that out of the JPEG at `filePath`, in place. True when the file was written anew, false
 * when it was left as it is: nothing to take out, not a JPEG, or its image data starts further in
 * than `JPEG_HEADER_BYTES`. The new file is written beside the old and takes its place only whole.
 */
export async function stripJpegMetadata(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, 'r');
  let stripped: { head: Buffer; replaces: number } | null;
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, JPEG_HEADER_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    stripped = jpegHeadWithoutMetadata(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
  if (!stripped) return false;

  const tempPath = `${filePath}.clean`;
  try {
    await fs.promises.writeFile(tempPath, stripped.head);
    await pipeline(fs.createReadStream(filePath, { start: stripped.replaces }), fs.createWriteStream(tempPath, { flags: 'a' }));
    await fs.promises.rename(tempPath, filePath);
    return true;
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
