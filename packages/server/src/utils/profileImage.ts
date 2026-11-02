import sharp, { type Metadata } from 'sharp';
import {
  MAX_PROFILE_IMAGE_FRAMES,
  PROFILE_IMAGE_SPECS,
  type ProfileImageCrop,
  type ProfileImageKind,
} from '@backspace/shared/src/profileImage.js';

/**
 * Cuts an animated GIF or WebP to a profile picture or banner, keeping every
 * frame and its timing. See shared/src/profileImage.ts for why this runs here.
 */

export type ProfileImageErrorCode = 'profile_image_invalid' | 'profile_image_too_large';

export class ProfileImageError extends Error {
  constructor(readonly code: ProfileImageErrorCode, message: string) {
    super(message);
    this.name = 'ProfileImageError';
  }
}

/** Width times height times frames, as the decoder is asked to handle. */
const MAX_SOURCE_PIXELS = 400_000_000;

/** The encoder's quality, tried from the first to the last until the file fits. */
const QUALITY_STEPS = [80, 60, 40] as const;

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** A crop that is a rectangle of whole pixels; a pixel of overshoot from rounding is trimmed. */
export function fitCrop(crop: ProfileImageCrop, imageWidth: number, imageHeight: number): ProfileImageCrop | null {
  if (![crop.x, crop.y, crop.width, crop.height].every(integer)) return null;
  if (crop.width < 1 || crop.height < 1 || crop.x < 0 || crop.y < 0) return null;
  const width = Math.min(crop.width, imageWidth - crop.x);
  const height = Math.min(crop.height, imageHeight - crop.y);
  // More than a pixel of overshoot is a crop that does not belong to this image.
  if (width < crop.width - 1 || height < crop.height - 1 || width < 1 || height < 1) return null;
  return { x: crop.x, y: crop.y, width, height };
}

/**
 * The cropped, resized animation as an animated WebP. Throws `ProfileImageError`
 * for a file that is not an animated GIF or WebP the server can read, a crop that
 * does not fit it, or a result that stays too heavy at the lowest quality.
 */
export async function renderAnimatedProfileImage(
  source: Buffer,
  kind: ProfileImageKind,
  crop: ProfileImageCrop,
): Promise<Buffer> {
  const spec = PROFILE_IMAGE_SPECS[kind];

  let meta: Metadata;
  try {
    meta = await sharp(source, { animated: true, limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
  } catch {
    throw new ProfileImageError('profile_image_invalid', 'The file is not an image');
  }
  if (meta.format !== 'gif' && meta.format !== 'webp') {
    throw new ProfileImageError('profile_image_invalid', 'Only GIF and WebP animations are cropped here');
  }
  const width = meta.width ?? 0;
  const frameHeight = meta.pageHeight ?? meta.height ?? 0;
  const frames = meta.pages ?? 1;
  if (width < 1 || frameHeight < 1) throw new ProfileImageError('profile_image_invalid', 'The image has no size');
  if (frames > MAX_PROFILE_IMAGE_FRAMES || width * frameHeight * frames > MAX_SOURCE_PIXELS) {
    throw new ProfileImageError('profile_image_too_large', 'The animation has too many frames or pixels');
  }

  const area = fitCrop(crop, width, frameHeight);
  if (!area) throw new ProfileImageError('profile_image_invalid', 'The crop does not fit the image');

  // Scale the whole frame so the crop becomes exactly the output size, then
  // take the crop out of the scaled frame. Every frame goes through one pass,
  // which keeps cutting a long animation fast.
  const scaleX = spec.width / area.width;
  const scaleY = spec.height / area.height;
  const scaledWidth = Math.max(spec.width, Math.round(width * scaleX));
  const scaledHeight = Math.max(spec.height, Math.round(frameHeight * scaleY));
  const left = Math.min(Math.round(area.x * scaleX), scaledWidth - spec.width);
  const top = Math.min(Math.round(area.y * scaleY), scaledHeight - spec.height);

  let lastError: unknown;
  for (const quality of QUALITY_STEPS) {
    let output: Buffer;
    try {
      output = await sharp(source, { animated: true, limitInputPixels: MAX_SOURCE_PIXELS })
        .resize({ width: scaledWidth, height: scaledHeight, fit: 'fill' })
        .extract({ left, top, width: spec.width, height: spec.height })
        .webp({ quality, effort: 4, loop: meta.loop ?? 0 })
        .toBuffer();
    } catch (err) {
      lastError = err;
      break;
    }
    if (output.length <= spec.maxBytes) return output;
  }
  if (lastError) throw new ProfileImageError('profile_image_invalid', 'The animation could not be processed');
  throw new ProfileImageError('profile_image_too_large', 'The animation is too heavy even at low quality');
}
