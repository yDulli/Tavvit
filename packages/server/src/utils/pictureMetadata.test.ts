import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { exifOrientation, jpegHeadWithoutMetadata, orientationSegment, stripJpegMetadata } from './pictureMetadata.js';

// A photo from a phone says where it was taken. An upload was served as it came, so anyone who
// could open the picture could read that (security audit, 2026-11-14).

let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-exif-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A small photo as a phone writes one: a maker, a place, a comment, and stored on its side. */
async function phonePhoto(orientation = 6): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation })
    .withExifMerge({
      IFD0: { Make: 'AuditPhone', Model: 'Model X1', ImageDescription: 'at home' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 18/1' },
    })
    .toBuffer();
}

const pixels = (bytes: Buffer): Promise<Buffer> => sharp(bytes, { autoOrient: false }).raw().toBuffer();

describe('a photo on its way in', () => {
  it('loses the place, the device and the words, and keeps every pixel and which way up it is', async () => {
    const before = await phonePhoto(6);
    expect(before.includes(Buffer.from('AuditPhone'))).toBe(true);
    expect((await sharp(before).metadata()).orientation).toBe(6);
    const file = path.join(dir, 'photo.jpg');
    fs.writeFileSync(file, before);

    expect(await stripJpegMetadata(file)).toBe(true);

    const after = fs.readFileSync(file);
    for (const word of ['AuditPhone', 'Model X1', 'at home']) expect(after.includes(Buffer.from(word))).toBe(false);
    const meta = await sharp(after).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.width).toBe(64);
    // What is left of Exif is the one value: the header, one entry, nothing of a place.
    expect(meta.exif?.length ?? 0).toBeLessThan(40);
    expect((await pixels(after)).equals(await pixels(before))).toBe(true);
    expect(after.length).toBeLessThan(before.length);
    expect(fs.existsSync(`${file}.clean`)).toBe(false);
  });

  it('says nothing about orientation where there was nothing to say', async () => {
    const before = await phonePhoto(1);
    const stripped = jpegHeadWithoutMetadata(before);
    expect(stripped).not.toBeNull();
    const after = Buffer.concat([stripped!.head, before.subarray(stripped!.replaces)]);
    expect((await sharp(after).metadata()).exif).toBeUndefined();
    expect((await pixels(after)).equals(await pixels(before))).toBe(true);
  });

  it('leaves a picture with nothing to take out exactly as it is', async () => {
    const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const file = path.join(dir, 'plain.jpg');
    fs.writeFileSync(file, plain);
    expect(await stripJpegMetadata(file)).toBe(false);
    expect(fs.readFileSync(file).equals(plain)).toBe(true);
  });

  it('leaves alone what is not a JPEG, or is cut short, rather than breaking it', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer();
    const photo = await phonePhoto();
    for (const bytes of [png, Buffer.from('<html>'), Buffer.alloc(0), photo.subarray(0, 40), Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00])]) {
      expect(jpegHeadWithoutMetadata(bytes)).toBeNull();
      const file = path.join(dir, 'other.bin');
      fs.writeFileSync(file, bytes);
      expect(await stripJpegMetadata(file)).toBe(false);
      expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    }
  });

  it('reads and writes the one value in both byte orders', () => {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      expect(exifOrientation(orientationSegment(orientation).subarray(4))).toBe(orientation);
    }
    const little = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0])]);
    expect(exifOrientation(little)).toBe(8);
    expect(exifOrientation(Buffer.from('Exif\0\0II*\0', 'latin1'))).toBeNull();
    expect(exifOrientation(Buffer.from('http://ns.adobe.com/xap/1.0/\0<x/>', 'latin1'))).toBeNull();
  });
});
