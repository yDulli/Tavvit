import sharp, { type Metadata } from 'sharp';
import path from 'node:path';
import { CUSTOM_EMOJI_LIMITS } from '@backspace/shared/src/customEmoji.js';
import { config } from '../config.js';
import { PICTURE_ENCODE_SECONDS, runMediaJob } from './thumbnail.js';

/**
 * Turns an uploaded picture into the one stored form of an emoji: a WebP no
 * larger than 128 by 128 pixels and 256 KB, animated when the original is. The
 * original is decoded and written again rather than trusted, so what is stored
 * is always an image this code produced.
 */

export type EmojiImageErrorCode = 'emoji_image_invalid' | 'emoji_image_too_large';

export class EmojiImageError extends Error {
  constructor(readonly code: EmojiImageErrorCode, message: string) {
    super(message);
    this.name = 'EmojiImageError';
  }
}

/** Width times height times frames the decoder is asked to handle. */
const MAX_DECODED_PIXELS = 16_777_216;

/** The encoder's quality, tried from the first until the picture fits. */
const QUALITY_STEPS = [85, 65, 45] as const;

const ACCEPTED_FORMATS = ['png', 'jpeg', 'webp', 'gif'];

export interface EncodedEmoji {
  data: Buffer;
  animated: boolean;
}

/**
 * Takes its turn with the other media work (utils/thumbnail.ts), so many at once cannot take the
 * machine; `account` is who sent the picture, who may have one such job under way at a time.
 * Rejects with MediaBusyError when that cannot start now.
 */
export function encodeEmoji(source: Buffer, account: string): Promise<EncodedEmoji> {
  return runMediaJob(() => encodeEmojiNow(source), account);
}

async function encodeEmojiNow(source: Buffer): Promise<EncodedEmoji> {
  if (source.length === 0) throw new EmojiImageError('emoji_image_invalid', 'Empty file');
  if (source.length > CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES) {
    throw new EmojiImageError('emoji_image_too_large', 'The original is too large');
  }

  let meta: Metadata;
  try {
    meta = await sharp(source, { animated: true, limitInputPixels: MAX_DECODED_PIXELS }).metadata();
  } catch {
    // The decoder's own messages name its internals; the caller only needs to know the file was refused.
    throw new EmojiImageError('emoji_image_invalid', 'The file is not an image');
  }
  if (!meta.format || !ACCEPTED_FORMATS.includes(meta.format)) {
    throw new EmojiImageError('emoji_image_invalid', 'Only PNG, JPEG, WebP and GIF are accepted');
  }
  const frames = meta.pages ?? 1;
  if (frames > CUSTOM_EMOJI_LIMITS.MAX_FRAMES) {
    throw new EmojiImageError('emoji_image_too_large', 'The animation has too many frames');
  }
  const animated = frames > 1;

  // One limit for every quality pass together: a picture that takes longer is too heavy to keep.
  const deadline = Date.now() + PICTURE_ENCODE_SECONDS * 1000;
  for (const quality of QUALITY_STEPS) {
    const seconds = Math.ceil((deadline - Date.now()) / 1000);
    if (seconds <= 0) throw new EmojiImageError('emoji_image_too_large', 'The picture takes too long to encode');
    let data: Buffer;
    try {
      data = await sharp(source, { animated: true, limitInputPixels: MAX_DECODED_PIXELS })
        .rotate()
        .resize(CUSTOM_EMOJI_LIMITS.SIZE, CUSTOM_EMOJI_LIMITS.SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .timeout({ seconds })
        .toBuffer();
    } catch (err) {
      if (err instanceof Error && /timeout/i.test(err.message)) {
        throw new EmojiImageError('emoji_image_too_large', 'The picture takes too long to encode');
      }
      throw new EmojiImageError('emoji_image_invalid', 'The image could not be processed');
    }
    if (data.length <= CUSTOM_EMOJI_LIMITS.MAX_STORED_BYTES) return { data, animated };
  }
  throw new EmojiImageError('emoji_image_too_large', 'The picture is too heavy even at low quality');
}

/** The directory the pictures live in; the attachment janitor reads only the top level of the upload directory, so it never sees it. */
export function emojiDir(): string {
  return path.join(config.uploadDir, 'emoji');
}

export function emojiFilePath(id: string): string {
  return path.join(emojiDir(), `${id}.webp`);
}
