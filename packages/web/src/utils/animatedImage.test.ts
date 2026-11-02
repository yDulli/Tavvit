import { describe, it, expect } from 'vitest';
import { base64OfDataUrl, bytesOfDataUrl, isAnimatedImage } from './animatedImage';

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A GIF header (with a 2-colour global table) followed by `frames` tiny frames and the trailer. */
function gif(frames: number, { localTable = false }: { localTable?: boolean } = {}): Uint8Array {
  const bytes: number[] = [
    ...text('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, // 1x1, global colour table of 2 entries
    0, 0, 0, 255, 255, 255,
  ];
  for (let i = 0; i < frames; i++) {
    // Graphic control extension (an animation's per-frame delay).
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    // Image descriptor.
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, localTable ? 0x80 : 0);
    if (localTable) bytes.push(0, 0, 0, 255, 255, 255);
    bytes.push(2, 2, 0x44, 0x01, 0); // LZW size, one data sub-block, terminator
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

function webp(chunk: string, flags: number): Uint8Array {
  const bytes = new Array<number>(30).fill(0);
  text('RIFF').forEach((b, i) => { bytes[i] = b; });
  text('WEBP').forEach((b, i) => { bytes[8 + i] = b; });
  text(chunk).forEach((b, i) => { bytes[12 + i] = b; });
  bytes[20] = flags;
  return Uint8Array.from(bytes);
}

describe('isAnimatedImage', () => {
  it('is true for a GIF with two or more frames', () => {
    expect(isAnimatedImage(gif(2))).toBe(true);
    expect(isAnimatedImage(gif(5))).toBe(true);
    expect(isAnimatedImage(gif(3, { localTable: true }))).toBe(true);
  });

  it('is false for a GIF with one frame: it is a still picture', () => {
    expect(isAnimatedImage(gif(1))).toBe(false);
    expect(isAnimatedImage(gif(1, { localTable: true }))).toBe(false);
    expect(isAnimatedImage(gif(0))).toBe(false);
  });

  it('is true for an animated WebP and false for a still one', () => {
    expect(isAnimatedImage(webp('VP8X', 0x02))).toBe(true);
    expect(isAnimatedImage(webp('VP8X', 0x10))).toBe(false); // extended, flagged for something else
    expect(isAnimatedImage(webp('VP8 ', 0x02))).toBe(false); // lossy still: no extended header
    expect(isAnimatedImage(webp('VP8L', 0x02))).toBe(false); // lossless still
  });

  it('is false for other files and for damaged ones, without throwing', () => {
    expect(isAnimatedImage(Uint8Array.from(text('\u0089PNG\r\n\u001a\n')))).toBe(false);
    expect(isAnimatedImage(Uint8Array.from(text('GIF89a')))).toBe(false);
    expect(isAnimatedImage(Uint8Array.from([...gif(2)].slice(0, 20)))).toBe(false);
    expect(isAnimatedImage(new Uint8Array())).toBe(false);
    expect(isAnimatedImage(Uint8Array.from([...gif(1)].slice(0, 25).concat([0x99, 0x99])))).toBe(false);
  });
});

describe('data URL helpers', () => {
  it('reads the payload as bytes and as base64', () => {
    const dataUrl = `data:image/gif;base64,${btoa('GIF89a')}`;
    expect(base64OfDataUrl(dataUrl)).toBe(btoa('GIF89a'));
    expect(Array.from(bytesOfDataUrl(dataUrl))).toEqual(text('GIF89a'));
  });
});
