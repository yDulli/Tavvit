import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { MAX_PROFILE_IMAGE_FRAMES, PROFILE_IMAGE_SPECS } from '@backspace/shared/src/profileImage.js';
import { fitCrop, ProfileImageError, renderAnimatedProfileImage } from './profileImage.js';

type Rgb = [number, number, number];

/** A frame whose left half is `left` and right half is `right`. */
async function splitFrame(width: number, height: number, left: Rgb, right: Rgb): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = x < width / 2 ? left : right;
      const i = (y * width + x) * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** An animation with one left/right colour pair per frame. */
async function animation(
  format: 'gif' | 'webp',
  width: number,
  height: number,
  pairs: Array<[Rgb, Rgb]>,
  delay = 70,
): Promise<Buffer> {
  const frames = await Promise.all(pairs.map(([l, r]) => splitFrame(width, height, l, r)));
  const joined = sharp(frames, { join: { animated: true } });
  const delays = new Array<number>(pairs.length).fill(delay);
  return format === 'gif'
    ? joined.gif({ delay: delays, loop: 0 }).toBuffer()
    : joined.webp({ delay: delays, loop: 0, lossless: true }).toBuffer();
}

/** The colour at the middle of frame `page` of an animation. */
async function centre(image: Buffer, page: number): Promise<Rgb> {
  const { data, info } = await sharp(image, { page }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 3;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

function near(actual: Rgb, expected: Rgb, tolerance = 24): void {
  for (let c = 0; c < 3; c++) expect(Math.abs(actual[c]! - expected[c]!)).toBeLessThanOrEqual(tolerance);
}

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const YELLOW: Rgb = [255, 255, 0];

describe('renderAnimatedProfileImage', () => {
  it('keeps every frame and its timing, at the size of a still avatar', async () => {
    const gif = await animation('gif', 100, 100, [[RED, GREEN], [BLUE, YELLOW], [GREEN, RED]], 90);
    const out = await renderAnimatedProfileImage(gif, 'avatar', { x: 0, y: 0, width: 100, height: 100 });
    const meta = await sharp(out, { animated: true }).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(PROFILE_IMAGE_SPECS.avatar.width);
    expect(meta.pageHeight).toBe(PROFILE_IMAGE_SPECS.avatar.height);
    expect(meta.pages).toBe(3);
    expect(meta.delay).toEqual([90, 90, 90]);
    expect(meta.loop).toBe(0);
  });

  it('cuts the chosen part out of every frame', async () => {
    const gif = await animation('gif', 100, 100, [[RED, GREEN], [BLUE, YELLOW]]);
    // The right half only.
    const right = await renderAnimatedProfileImage(gif, 'avatar', { x: 60, y: 10, width: 30, height: 30 });
    near(await centre(right, 0), GREEN);
    near(await centre(right, 1), YELLOW);
    // The left half only.
    const left = await renderAnimatedProfileImage(gif, 'avatar', { x: 10, y: 10, width: 30, height: 30 });
    near(await centre(left, 0), RED);
    near(await centre(left, 1), BLUE);
  });

  it('reads an animated WebP as well as a GIF', async () => {
    const webp = await animation('webp', 80, 80, [[RED, GREEN], [BLUE, YELLOW]]);
    const out = await renderAnimatedProfileImage(webp, 'avatar', { x: 45, y: 0, width: 35, height: 35 });
    expect((await sharp(out, { animated: true }).metadata()).pages).toBe(2);
    near(await centre(out, 0), GREEN);
  });

  it('makes a banner at the banner size', async () => {
    const gif = await animation('gif', 300, 100, [[RED, GREEN], [BLUE, YELLOW]]);
    const out = await renderAnimatedProfileImage(gif, 'banner', { x: 0, y: 0, width: 300, height: 100 });
    const meta = await sharp(out, { animated: true }).metadata();
    expect([meta.width, meta.pageHeight]).toEqual([PROFILE_IMAGE_SPECS.banner.width, PROFILE_IMAGE_SPECS.banner.height]);
    expect(meta.pages).toBe(2);
  });

  it('trims a pixel of overshoot that rounding in the browser can cause', async () => {
    const gif = await animation('gif', 100, 100, [[RED, GREEN], [BLUE, YELLOW]]);
    const out = await renderAnimatedProfileImage(gif, 'avatar', { x: 1, y: 1, width: 100, height: 100 });
    expect((await sharp(out, { animated: true }).metadata()).pageHeight).toBe(PROFILE_IMAGE_SPECS.avatar.height);
  });

  it.each([
    ['a negative start', { x: -1, y: 0, width: 50, height: 50 }],
    ['an empty crop', { x: 0, y: 0, width: 0, height: 50 }],
    ['a crop that is not whole pixels', { x: 0.5, y: 0, width: 50, height: 50 }],
    ['a crop far outside the image', { x: 90, y: 90, width: 50, height: 50 }],
    ['a crop larger than the image', { x: 0, y: 0, width: 500, height: 500 }],
  ])('refuses %s', async (_label, crop) => {
    const gif = await animation('gif', 100, 100, [[RED, GREEN], [BLUE, YELLOW]]);
    await expect(renderAnimatedProfileImage(gif, 'avatar', crop)).rejects.toMatchObject({ code: 'profile_image_invalid' });
  });

  it('refuses files that are not animations it can cut', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'red' } }).png().toBuffer();
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'red' } }).jpeg().toBuffer();
    for (const file of [png, jpeg, Buffer.from('not an image at all'), Buffer.alloc(0)]) {
      const rejected = renderAnimatedProfileImage(file, 'avatar', { x: 0, y: 0, width: 40, height: 40 });
      await expect(rejected).rejects.toBeInstanceOf(ProfileImageError);
      await expect(rejected).rejects.toMatchObject({ code: 'profile_image_invalid' });
    }
  });

  it('refuses an animation with more frames than it will cut', async () => {
    // Every frame differs, or the encoder folds equal neighbours into one.
    const frames: Buffer[] = [];
    for (let i = 0; i < MAX_PROFILE_IMAGE_FRAMES + 1; i++) {
      frames.push(await splitFrame(4, 4, [i % 256, (i >> 8) * 40, 0], [0, i % 256, 255]));
    }
    // WebP, because the GIF encoder itself drops frames that barely differ.
    const webp = await sharp(frames, { join: { animated: true } })
      .webp({ delay: new Array<number>(frames.length).fill(20), loop: 0, lossless: true }).toBuffer();
    await expect(renderAnimatedProfileImage(webp, 'avatar', { x: 0, y: 0, width: 4, height: 4 }))
      .rejects.toMatchObject({ code: 'profile_image_too_large' });
  }, 60_000);

  it('refuses a result that stays too heavy at the lowest quality', async () => {
    // Frames of noise cannot be compressed, so even the lowest quality is over the limit.
    const frames: Buffer[] = [];
    for (let i = 0; i < 120; i++) {
      const raw = Buffer.alloc(300 * 300 * 3);
      for (let j = 0; j < raw.length; j++) raw[j] = ((j * 2654435761) >>> (i % 7)) & 255;
      frames.push(await sharp(raw, { raw: { width: 300, height: 300, channels: 3 } }).png().toBuffer());
    }
    const gif = await sharp(frames, { join: { animated: true } })
      .gif({ delay: new Array<number>(frames.length).fill(40), loop: 0 }).toBuffer();
    await expect(renderAnimatedProfileImage(gif, 'avatar', { x: 0, y: 0, width: 300, height: 300 }))
      .rejects.toMatchObject({ code: 'profile_image_too_large' });
  }, 120_000);
});

describe('fitCrop', () => {
  it('passes a crop inside the image through unchanged', () => {
    expect(fitCrop({ x: 5, y: 6, width: 20, height: 30 }, 100, 100)).toEqual({ x: 5, y: 6, width: 20, height: 30 });
  });

  it('trims one pixel of overshoot and no more', () => {
    expect(fitCrop({ x: 0, y: 0, width: 101, height: 100 }, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(fitCrop({ x: 0, y: 0, width: 102, height: 100 }, 100, 100)).toBeNull();
  });
});
