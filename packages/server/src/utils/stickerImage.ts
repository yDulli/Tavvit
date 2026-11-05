import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_STICKER_BYTES, MAX_STICKER_FRAMES, STICKER_PREFIX } from '@backspace/shared/src/stickers.js';
import { getDb, schema } from '../db/index.js';
import { getOurOrigin } from './federationAuth.js';
import { stickerAssetPath } from './stickerAssets.js';
import { PICTURE_ENCODE_SECONDS, runMediaJob } from './thumbnail.js';

/**
 * The one stored form of a sticker, for a personal collection (routes/stickers.ts) and for a space
 * (utils/spaceExpressions.ts, the Discord import): a WebP within 512 pixels, animated when the
 * original is, named by the SHA-256 of its bytes. The original is decoded and written again rather
 * than trusted, so what is stored is always an image this code produced.
 */

/** Stored stickers fit this box; the largest place one is shown is a 240 px message row. */
const MAX_STICKER_DIMENSION = 512;
/** Bound decoded pixels across animation frames, not only the compressed upload size. */
const MAX_DECODED_PIXELS = 16_777_216;

/** Thrown for bytes that are not an accepted image. */
export class StickerImageError extends Error {
  constructor() {
    super('Not an accepted sticker image');
    this.name = 'StickerImageError';
  }
}

export interface EncodedSticker {
  data: Buffer;
  animated: boolean;
}

/**
 * Re-encode instead of trusting MIME/extension; decode all frames to preserve animations safely.
 * The result fits MAX_STICKER_DIMENSION and is refused when it is still larger than an upload may
 * be, so a stored asset is never bigger than the bytes the account sent. An animation with more
 * than MAX_STICKER_FRAMES frames is refused before anything is encoded: the pixel limit alone lets a
 * tiny picture with a huge number of frames through, and the encoder spends its time per frame.
 * Takes its turn with the other media work (utils/thumbnail.ts), so many at once cannot take the
 * machine; `account` is who sent the picture, who may have one such job under way at a time.
 * Rejects with MediaBusyError when that cannot start now.
 */
export function encodeStickerImage(bytes: Buffer, account: string): Promise<EncodedSticker> {
  return runMediaJob(async () => {
    if (!bytes.length || bytes.length > MAX_STICKER_BYTES) throw new StickerImageError();
    let encoded: Buffer;
    let animated = false;
    try {
      const image = sharp(bytes, { animated: true, limitInputPixels: MAX_DECODED_PIXELS });
      const metadata = await image.metadata();
      if (!metadata.format || !['png', 'jpeg', 'webp', 'gif'].includes(metadata.format)) {
        throw new StickerImageError();
      }
      const frames = metadata.pages ?? 1;
      if (frames > MAX_STICKER_FRAMES) throw new StickerImageError();
      animated = frames > 1;
      encoded = await image.rotate()
        .resize(MAX_STICKER_DIMENSION, MAX_STICKER_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .webp()
        .timeout({ seconds: PICTURE_ENCODE_SECONDS })
        .toBuffer();
    } catch (error) {
      // Sharp's own messages name decoder internals; the caller only needs to know the image was refused.
      if (error instanceof StickerImageError) throw error;
      throw new StickerImageError();
    }
    if (encoded.length > MAX_STICKER_BYTES) throw new StickerImageError();
    return { data: encoded, animated };
  }, account);
}

/** The stored bytes alone, as a personal sticker takes them. */
export async function encodeSticker(bytes: Buffer, account: string): Promise<Buffer> {
  return (await encodeStickerImage(bytes, account)).data;
}

/**
 * Keeps encoded sticker bytes as an asset and answers its id. The row is written, or made fresh
 * again, before the file: the janitor never removes an asset inside its grace period, so it cannot
 * delete this file between the write below and whatever names the asset after it. Published
 * atomically, so concurrent duplicates never expose a truncated image.
 */
export async function storeStickerAsset(encoded: Buffer): Promise<string> {
  const id = createHash('sha256').update(encoded).digest('hex');
  const now = Date.now();
  getDb().insert(schema.stickerAssets).values({ id, createdAt: now })
    .onConflictDoUpdate({ target: schema.stickerAssets.id, set: { createdAt: now } }).run();
  await mkdir(path.dirname(stickerAssetPath(id)), { recursive: true });
  const temporaryPath = `${stickerAssetPath(id)}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, encoded);
  await rename(temporaryPath, stickerAssetPath(id));
  return id;
}

/** The token a sticker of this instance is sent as. */
export function stickerTokenFor(id: string): string {
  return `${STICKER_PREFIX}${getOurOrigin()}/api/stickers/assets/${id}.webp`;
}
