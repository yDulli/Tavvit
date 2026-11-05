import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import {
  MAX_PERSONAL_STICKERS, MAX_STICKER_BYTES, MAX_STICKER_NAME_LENGTH, STICKER_ID_PATTERN,
  STICKER_UPLOADS_PER_MINUTE, normalizeStickerName, type PersonalSticker,
} from '@backspace/shared/src/stickers.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { stickerAssetPath as assetPath } from '../utils/stickerAssets.js';
import { sendError } from '../utils/httpErrors.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { diskWouldFill } from '../utils/accountLimits.js';
import { StickerImageError, encodeSticker, stickerTokenFor, storeStickerAsset } from '../utils/stickerImage.js';
import { MediaBusyError } from '../utils/thumbnail.js';

const tokenFor = stickerTokenFor;
const MAX_STICKER_MB = MAX_STICKER_BYTES / (1024 * 1024);
const nameSchema = { type: 'string', minLength: 1, maxLength: MAX_STICKER_NAME_LENGTH } as const;
const idParamsSchema = {
  type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: STICKER_ID_PATTERN.source } },
} as const;

/**
 * Uploads per account (the row id on this instance, so each federated account
 * counts on its own). Every upload is a full decode and re-encode, so the
 * budget is per account and not only the per-address HTTP limit.
 */
const uploadLimit = createFixedWindowLimit({ max: STICKER_UPLOADS_PER_MINUTE, windowMs: 60_000 });
/**
 * New stickers one account may make in a day. A sticker taken out of a collection stays on disk
 * until the janitor's grace has passed (utils/stickerAssets.ts), so making and removing them over
 * and over would otherwise fill the disk at the speed of the per-minute limit.
 */
const dailyUploadLimit = createFixedWindowLimit({ max: 50, windowMs: 24 * 60 * 60 * 1000 });

/** Tests only: forget every account's upload window. */
export function _resetStickerUploadLimit(): void {
  uploadLimit.reset();
  dailyUploadLimit.reset();
}

function collectionSize(userId: string): number {
  return getDb().select({ count: count() }).from(schema.personalStickers)
    .where(eq(schema.personalStickers.userId, userId)).get()?.count ?? 0;
}

/**
 * Add an asset to a collection, or return the entry that is already there.
 * Null when the collection is full. Synchronous from the size check to the
 * insert, so two requests from one account cannot both take the last place.
 */
function collectSticker(input: { userId: string; id: string; name: string }): PersonalSticker | null {
  const db = getDb();
  const existing = () => db.select().from(schema.personalStickers).where(and(
    eq(schema.personalStickers.userId, input.userId), eq(schema.personalStickers.stickerId, input.id),
  )).get();
  const found = existing();
  if (found) return { id: input.id, name: found.name, token: tokenFor(input.id) };
  if (collectionSize(input.userId) >= MAX_PERSONAL_STICKERS) return null;
  db.insert(schema.personalStickers).values({
    userId: input.userId, stickerId: input.id, name: input.name, createdAt: Date.now(),
  }).onConflictDoNothing().run();
  return { id: input.id, name: existing()!.name, token: tokenFor(input.id) };
}

export async function stickerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stickers', { preHandler: authenticate }, async (request) => {
    const rows = getDb().select().from(schema.personalStickers)
      .where(eq(schema.personalStickers.userId, request.userId))
      .orderBy(desc(schema.personalStickers.createdAt)).all();
    return rows.map(row => ({ id: row.stickerId, name: row.name, token: tokenFor(row.stickerId) }));
  });

  // JSON uses the existing authenticated API client; the body limit accounts for base64 expansion.
  app.post<{ Body: { name: string; image: string } }>('/api/stickers', {
    preHandler: authenticate,
    bodyLimit: Math.ceil(MAX_STICKER_BYTES / 3) * 4 + 4096,
    schema: { body: { type: 'object', required: ['name', 'image'], additionalProperties: false,
      properties: { name: nameSchema, image: { type: 'string', minLength: 4 } } } },
  }, async (request, reply) => {
    const { image } = request.body;
    const name = normalizeStickerName(request.body.name);
    if (name === undefined) return sendError(reply, 400, 'sticker_name_invalid', { max: MAX_STICKER_NAME_LENGTH });
    if (!uploadLimit.consume(request.userId) || !dailyUploadLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
    // Refused before the decode; collectSticker checks again where the row is written.
    if (collectionSize(request.userId) >= MAX_PERSONAL_STICKERS) {
      return sendError(reply, 409, 'sticker_collection_full', { max: MAX_PERSONAL_STICKERS });
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image)) return sendError(reply, 400, 'validation_failed');
    const bytes = Buffer.from(image, 'base64');
    if (bytes.toString('base64') !== image) return sendError(reply, 400, 'validation_failed');
    // Only decode failures become validation errors; filesystem/database failures stay server errors.
    let encoded: Buffer;
    try { encoded = await encodeSticker(bytes, request.userId); }
    catch (error) {
      if (error instanceof StickerImageError) return sendError(reply, 400, 'sticker_invalid_image', { max: MAX_STICKER_MB });
      // This account's last picture is still being worked on, or the queue is full: later.
      if (error instanceof MediaBusyError) return sendError(reply, 429, 'rate_limited');
      throw error;
    }
    // The disk keeps its reserve for the database, as for any upload (utils/accountLimits.ts).
    if (diskWouldFill(encoded.length)) return sendError(reply, 507, 'disk_full');
    const id = await storeStickerAsset(encoded);
    const sticker = collectSticker({ userId: request.userId, id, name });
    if (!sticker) return sendError(reply, 409, 'sticker_collection_full', { max: MAX_PERSONAL_STICKERS });
    return sticker;
  });

  app.post<{ Params: { id: string }; Body: { token: string; name: string } }>('/api/stickers/:id/collect', {
    preHandler: authenticate,
    schema: { body: { type: 'object', required: ['token', 'name'], additionalProperties: false, properties: {
      token: { type: 'string', maxLength: 2048 },
      // The collecting client names the entry in its own language; the server stores no wording of its own.
      name: nameSchema,
    } },
      params: idParamsSchema },
  }, async (request, reply) => {
    if (request.body.token !== tokenFor(request.params.id)) return sendError(reply, 400, 'sticker_not_local');
    const asset = getDb().select().from(schema.stickerAssets).where(eq(schema.stickerAssets.id, request.params.id)).get();
    if (!asset) return sendError(reply, 404, 'sticker_not_found');
    const name = normalizeStickerName(request.body.name);
    if (name === undefined) return sendError(reply, 400, 'sticker_name_invalid', { max: MAX_STICKER_NAME_LENGTH });
    const sticker = collectSticker({ userId: request.userId, id: asset.id, name });
    if (!sticker) return sendError(reply, 409, 'sticker_collection_full', { max: MAX_PERSONAL_STICKERS });
    return sticker;
  });

  app.delete<{ Params: { id: string } }>('/api/stickers/:id', { preHandler: authenticate }, async (request) => {
    getDb().delete(schema.personalStickers).where(and(
      eq(schema.personalStickers.userId, request.userId), eq(schema.personalStickers.stickerId, request.params.id),
    )).run();
    return { success: true };
  });

  // Renames only the caller's own entry. Other entries for the same asset keep their names.
  app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/stickers/:id', {
    preHandler: authenticate,
    schema: {
      body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: nameSchema } },
      params: idParamsSchema,
    },
  }, async (request, reply) => {
    const name = normalizeStickerName(request.body.name);
    if (name === undefined) return sendError(reply, 400, 'sticker_name_invalid', { max: MAX_STICKER_NAME_LENGTH });
    const result = getDb().update(schema.personalStickers).set({ name }).where(and(
      eq(schema.personalStickers.userId, request.userId), eq(schema.personalStickers.stickerId, request.params.id),
    )).run();
    if (!result.changes) return sendError(reply, 404, 'sticker_not_found');
    return { id: request.params.id, name, token: tokenFor(request.params.id) } satisfies PersonalSticker;
  });

  // Same public-link access policy as existing uploads. Never accept a filesystem path or remote URL.
  app.get<{ Params: { filename: string } }>('/api/stickers/assets/:filename', async (request, reply) => {
    const id = request.params.filename.replace(/\.webp$/, '');
    if (!STICKER_ID_PATTERN.test(id) || request.params.filename !== `${id}.webp`) {
      return sendError(reply, 404, 'sticker_not_found');
    }
    const asset = getDb().select().from(schema.stickerAssets).where(eq(schema.stickerAssets.id, id)).get();
    // Resolve from the canonical stored key, never from the request path parameter.
    if (!asset || !STICKER_ID_PATTERN.test(asset.id)) return sendError(reply, 404, 'sticker_not_found');
    let bytes: Buffer;
    try {
      bytes = await readFile(assetPath(asset.id));
    } catch (error) {
      // A row whose file is gone (removed by hand, or lost with a restore) is a missing sticker, not a server fault.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return sendError(reply, 404, 'sticker_not_found');
      throw error;
    }
    // The same sandbox as a served upload (routes/uploads.ts): the bytes are
    // always a re-encoded WebP, but the response never runs as a document.
    return reply.type('image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'")
      .header('X-Frame-Options', 'DENY')
      .send(bytes);
  });
}
