import sharp, { type Sharp } from 'sharp';
import { CUSTOM_DECORATION_BOX, CUSTOM_DECORATION_LIMITS, type CustomDecorationKind } from '@backspace/shared/src/customDecorations.js';
import { PICTURE_ENCODE_SECONDS, runMediaJob } from './thumbnail.js';

/**
 * The one stored form of a decoration's picture (docs/systems/decorations.md, "Made by people"): a
 * WebP within its kind's box (a frame square, an effect's piece small, a nameplate wide), animated
 * when the original is, and for an animated one its first frame beside it, for where it stands still.
 * The original is decoded and written again rather than trusted, so what is stored is always an
 * image this code produced.
 */

/**
 * Decoded pixels over all frames. A moving picture may have hundreds of frames and a nameplate is
 * wide, so the bound is higher than a sticker's, and still low enough that two decodes at once fit
 * a small machine.
 */
const MAX_DECODED_PIXELS = 40_000_000;

/** Thrown for bytes that are not an accepted picture. */
export class DecorationImageError extends Error {
  constructor() {
    super('Not an accepted decoration picture');
    this.name = 'DecorationImageError';
  }
}

export interface EncodedDecoration {
  data: Buffer;
  /** The first frame, for an animated picture; null for one that does not move. */
  still: Buffer | null;
  animated: boolean;
  width: number;
  height: number;
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** The picture of one kind, resized to its box. A frame is set in the middle of a transparent square. */
function shaped(image: Sharp, kind: Exclude<CustomDecorationKind, 'name'>, width: number, height: number): Sharp {
  const box = CUSTOM_DECORATION_BOX[kind];
  if (box.square) {
    const side = Math.min(box.width, Math.max(width, height));
    return image.resize(side, side, { fit: 'contain', background: TRANSPARENT });
  }
  return image.resize(box.width, box.height, { fit: 'inside', withoutEnlargement: true });
}

/**
 * Re-encode instead of trusting the type a client named; decode every frame so an animation stays
 * one. Only PNG, WebP and GIF: a decoration lies over a picture or a card and needs transparency,
 * which JPEG has not. An animation with more than MAX_FRAMES frames is refused before anything is
 * encoded. The result is refused when the picture and its still frame together are larger than an
 * upload may be (MAX_BYTES), so what is stored stays within that bound. Takes its turn with the other media work
 * (utils/thumbnail.ts); `account` may have one such job under way at a time, and is refused with
 * MediaBusyError when that cannot start now.
 */
export function encodeDecorationImage(bytes: Buffer, kind: Exclude<CustomDecorationKind, 'name'>, account: string): Promise<EncodedDecoration> {
  return runMediaJob(async () => {
    if (!bytes.length || bytes.length > CUSTOM_DECORATION_LIMITS.MAX_BYTES) throw new DecorationImageError();
    try {
      const image = sharp(bytes, { animated: true, limitInputPixels: MAX_DECODED_PIXELS });
      const metadata = await image.metadata();
      if (!metadata.format || !['png', 'webp', 'gif'].includes(metadata.format)) throw new DecorationImageError();
      const frames = metadata.pages ?? 1;
      if (frames > CUSTOM_DECORATION_LIMITS.MAX_FRAMES) throw new DecorationImageError();
      const width = metadata.width ?? 0;
      const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
      if (width < 1 || frameHeight < 1) throw new DecorationImageError();
      const animated = frames > 1;
      const data = await shaped(image, kind, width, frameHeight)
        .webp({ quality: 85 })
        .timeout({ seconds: PICTURE_ENCODE_SECONDS })
        .toBuffer();
      const still = animated
        ? await shaped(sharp(bytes, { pages: 1, limitInputPixels: MAX_DECODED_PIXELS }), kind, width, frameHeight)
          .webp({ quality: 85 })
          .timeout({ seconds: PICTURE_ENCODE_SECONDS })
          .toBuffer()
        : null;
      const stored = await sharp(data, { animated: true }).metadata();
      if (data.length + (still?.length ?? 0) > CUSTOM_DECORATION_LIMITS.MAX_BYTES) throw new DecorationImageError();
      return {
        data,
        still,
        animated,
        width: stored.width ?? width,
        height: stored.pageHeight ?? stored.height ?? frameHeight,
      };
    } catch (error) {
      // Sharp's own messages name decoder internals; the caller only needs to know the picture was refused.
      if (error instanceof DecorationImageError) throw error;
      throw new DecorationImageError();
    }
  }, account);
}
