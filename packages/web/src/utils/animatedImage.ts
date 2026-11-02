/**
 * Whether a file is an animation: a GIF with more than one frame or a WebP
 * flagged as animated. A still image is cropped in the browser and an animated
 * one on the server (shared/src/profileImage.ts), so the picture picker needs
 * to tell them apart before anything is drawn on a canvas.
 */

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = '';
  for (let i = start; i < start + length && i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return text;
}

/** Steps over a run of data sub-blocks (a size byte, that many bytes, ending at a zero size). */
function skipSubBlocks(bytes: Uint8Array, from: number): number {
  let pos = from;
  while (pos < bytes.length) {
    const size = bytes[pos]!;
    pos += 1;
    if (size === 0) return pos;
    pos += size;
  }
  return pos;
}

function gifFrameCountAtLeastTwo(bytes: Uint8Array): boolean {
  const header = ascii(bytes, 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return false;
  if (bytes.length < 13) return false;
  let pos = 13;
  const screenFlags = bytes[10]!;
  if (screenFlags & 0x80) pos += 3 * (1 << ((screenFlags & 0x07) + 1));

  let frames = 0;
  while (pos < bytes.length) {
    const block = bytes[pos]!;
    if (block === 0x3b) return false; // trailer: the file ended with fewer than two frames
    if (block === 0x21) {
      // Extension: introducer, label, then sub-blocks.
      pos = skipSubBlocks(bytes, pos + 2);
    } else if (block === 0x2c) {
      frames += 1;
      if (frames >= 2) return true;
      // Image descriptor: 9 bytes after the separator, then an optional local colour table.
      const flags = bytes[pos + 9] ?? 0;
      pos += 10;
      if (flags & 0x80) pos += 3 * (1 << ((flags & 0x07) + 1));
      pos += 1; // LZW minimum code size
      pos = skipSubBlocks(bytes, pos);
    } else {
      return false; // not a block this format has: stop rather than guess
    }
  }
  return false;
}

function webpIsAnimated(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return false;
  // Only the extended format (VP8X) can carry an animation; bit 1 of its flags says it does.
  return ascii(bytes, 12, 4) === 'VP8X' && ((bytes[20] ?? 0) & 0x02) !== 0;
}

export function isAnimatedImage(bytes: Uint8Array): boolean {
  return gifFrameCountAtLeastTwo(bytes) || webpIsAnimated(bytes);
}

/** The bytes of a `data:` URL's payload. */
export function bytesOfDataUrl(dataUrl: string): Uint8Array {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The base64 payload of a `data:` URL, as the server takes it. */
export function base64OfDataUrl(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
