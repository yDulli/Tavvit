import type { FastifyInstance } from 'fastify';
import { count, eq, asc } from 'drizzle-orm';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  CUSTOM_EMOJI_LIMITS,
  CUSTOM_EMOJI_NAME_MAX,
  CUSTOM_EMOJI_NAME_MIN,
  EMOJI_ID_PATTERN,
  normalizeEmojiName,
  type CustomEmoji,
} from '@backspace/shared/src/customEmoji.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { EmojiImageError, emojiDir, emojiFilePath, encodeEmoji } from '../utils/emojiImage.js';
import { MediaBusyError } from '../utils/thumbnail.js';
import { connectionManager } from '../ws/handler.js';

/**
 * The instance's custom emoji (shared/src/customEmoji.ts): anyone may add one,
 * the person who added it and the administrators may rename or remove it, and
 * every client is told when the library changes.
 */

const uploadLimit = createFixedWindowLimit({ max: CUSTOM_EMOJI_LIMITS.UPLOADS_PER_MINUTE, windowMs: 60_000 });

/** Tests only: forget every account's upload window. */
export function _resetEmojiUploadLimit(): void {
  uploadLimit.reset();
}

type EmojiRow = typeof schema.customEmojis.$inferSelect;

function toEmoji(row: EmojiRow): CustomEmoji {
  return { id: row.id, name: row.name, animated: row.animated === 1, createdBy: row.createdBy, createdAt: row.createdAt };
}

function isAdmin(userId: string): boolean {
  return getDb().select({ isAdmin: schema.users.isAdmin }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.isAdmin === 1;
}

/** Whether `userId` may change `row`: whoever added it, or an administrator. */
function mayChange(row: EmojiRow, userId: string): boolean {
  return row.createdBy === userId || isAdmin(userId);
}

function isUniqueNameError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: custom_emojis\.name/.test(err.message);
}

const nameDetails = { min: CUSTOM_EMOJI_NAME_MIN, max: CUSTOM_EMOJI_NAME_MAX } as const;

export async function emojiRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/emojis - the whole library
  app.get('/api/emojis', { preHandler: authenticate }, async (_request, reply) => {
    const rows = getDb().select().from(schema.customEmojis).orderBy(asc(schema.customEmojis.name)).all();
    return reply.code(200).send({ emojis: rows.map(toEmoji) });
  });

  // GET /api/emojis/:id.webp - the picture, of the instance's emoji or of a space's (both take their
  // ids from one generator, so an id names one of them). Public like an upload: an <img> cannot send
  // a token, and a message that uses a space's emoji is read outside the space too.
  app.get<{ Params: { file: string } }>('/api/emojis/:file', async (request, reply) => {
    const id = request.params.file.replace(/\.webp$/, '');
    if (!EMOJI_ID_PATTERN.test(id) || request.params.file !== `${id}.webp`) return sendError(reply, 404, 'emoji_not_found');
    const db = getDb();
    const row = db.select({ id: schema.customEmojis.id }).from(schema.customEmojis).where(eq(schema.customEmojis.id, id)).get()
      ?? db.select({ id: schema.spaceEmojis.id }).from(schema.spaceEmojis).where(eq(schema.spaceEmojis.id, id)).get();
    if (!row) return sendError(reply, 404, 'emoji_not_found');
    let bytes: Buffer;
    try {
      bytes = await readFile(emojiFilePath(row.id));
    } catch (err) {
      // A row whose file is gone (removed by hand, lost with a restore) is a missing emoji, not a server fault.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return sendError(reply, 404, 'emoji_not_found');
      throw err;
    }
    // The same sandbox as a served upload: the bytes are always an image this code wrote, but the response never runs as a document.
    return reply.type('image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'")
      .header('X-Frame-Options', 'DENY')
      .send(bytes);
  });

  // POST /api/emojis - add one
  app.post<{ Body: { name: string; image: string } }>('/api/emojis', {
    preHandler: authenticate,
    // Base64 is a third larger than the bytes it carries; the rest is the name.
    bodyLimit: Math.ceil(CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES / 3) * 4 + 4096,
    schema: {
      body: {
        type: 'object', required: ['name', 'image'], additionalProperties: false,
        properties: { name: { type: 'string', maxLength: 64 }, image: { type: 'string', minLength: 4 } },
      },
    },
  }, async (request, reply) => {
    const settings = getDb().select({ emojiPolicy: schema.instanceSettings.emojiPolicy })
      .from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (settings?.emojiPolicy !== 'everyone' && !isAdmin(request.userId)) {
      return sendError(reply, 403, 'emoji_admins_only');
    }
    const name = normalizeEmojiName(request.body.name);
    if (name === null) return sendError(reply, 400, 'emoji_name_invalid', nameDetails);
    if (!uploadLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const db = getDb();
    const total = db.select({ n: count() }).from(schema.customEmojis).get()?.n ?? 0;
    if (total >= CUSTOM_EMOJI_LIMITS.MAX_TOTAL) {
      return sendError(reply, 409, 'emoji_limit_reached', { max: CUSTOM_EMOJI_LIMITS.MAX_TOTAL });
    }
    if (!isAdmin(request.userId)) {
      const own = db.select({ n: count() }).from(schema.customEmojis).where(eq(schema.customEmojis.createdBy, request.userId)).get()?.n ?? 0;
      if (own >= CUSTOM_EMOJI_LIMITS.MAX_PER_USER) {
        return sendError(reply, 409, 'emoji_limit_reached', { max: CUSTOM_EMOJI_LIMITS.MAX_PER_USER });
      }
    }
    if (db.select({ id: schema.customEmojis.id }).from(schema.customEmojis).where(eq(schema.customEmojis.name, name)).get()) {
      return sendError(reply, 409, 'emoji_name_taken');
    }

    const image = request.body.image;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image)) return sendError(reply, 400, 'emoji_image_invalid');
    const source = Buffer.from(image, 'base64');
    if (source.toString('base64') !== image) return sendError(reply, 400, 'emoji_image_invalid');

    let encoded: Awaited<ReturnType<typeof encodeEmoji>>;
    try {
      encoded = await encodeEmoji(source, request.userId);
    } catch (err) {
      // Only what is wrong with the picture is the client's to hear; anything else stays a server error.
      if (err instanceof EmojiImageError) return sendError(reply, err.code === 'emoji_image_too_large' ? 413 : 400, err.code);
      // This account's last picture is still being worked on, or the queue is full: later.
      if (err instanceof MediaBusyError) return sendError(reply, 429, 'rate_limited');
      throw err;
    }

    const id = generateSnowflake();
    await mkdir(emojiDir(), { recursive: true });
    // Published atomically, so a request for the picture never reads a half-written file.
    const temporary = `${emojiFilePath(id)}.${randomUUID()}.tmp`;
    await writeFile(temporary, encoded.data);
    await rename(temporary, emojiFilePath(id));

    let row: EmojiRow;
    try {
      row = db.insert(schema.customEmojis).values({
        id, name, animated: encoded.animated ? 1 : 0, size: encoded.data.length, createdBy: request.userId, createdAt: Date.now(),
      }).returning().get();
    } catch (err) {
      // No row, no way to find the file again: take it back. The name check above is not a lock, so a race ends here.
      await rm(emojiFilePath(id), { force: true });
      if (isUniqueNameError(err)) return sendError(reply, 409, 'emoji_name_taken');
      throw err;
    }

    const emoji = toEmoji(row);
    connectionManager.sendToAll({ type: 'emoji_upserted', emoji });
    return reply.code(201).send(emoji);
  });

  // PATCH /api/emojis/:id - rename
  app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/emojis/:id', {
    preHandler: authenticate,
    schema: {
      body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', maxLength: 64 } } },
    },
  }, async (request, reply) => {
    const db = getDb();
    const row = EMOJI_ID_PATTERN.test(request.params.id)
      ? db.select().from(schema.customEmojis).where(eq(schema.customEmojis.id, request.params.id)).get()
      : undefined;
    if (!row) return sendError(reply, 404, 'emoji_not_found');
    if (!mayChange(row, request.userId)) return sendError(reply, 403, 'forbidden');
    const name = normalizeEmojiName(request.body.name);
    if (name === null) return sendError(reply, 400, 'emoji_name_invalid', nameDetails);

    let updated: EmojiRow;
    try {
      updated = db.update(schema.customEmojis).set({ name }).where(eq(schema.customEmojis.id, row.id)).returning().get();
    } catch (err) {
      if (isUniqueNameError(err)) return sendError(reply, 409, 'emoji_name_taken');
      throw err;
    }
    const emoji = toEmoji(updated);
    connectionManager.sendToAll({ type: 'emoji_upserted', emoji });
    return reply.code(200).send(emoji);
  });

  // DELETE /api/emojis/:id - remove
  app.delete<{ Params: { id: string } }>('/api/emojis/:id', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const row = EMOJI_ID_PATTERN.test(request.params.id)
      ? db.select().from(schema.customEmojis).where(eq(schema.customEmojis.id, request.params.id)).get()
      : undefined;
    if (!row) return sendError(reply, 404, 'emoji_not_found');
    if (!mayChange(row, request.userId)) return sendError(reply, 403, 'forbidden');

    db.delete(schema.customEmojis).where(eq(schema.customEmojis.id, row.id)).run();
    await rm(emojiFilePath(row.id), { force: true });
    connectionManager.sendToAll({ type: 'emoji_removed', emojiId: row.id });
    return reply.code(200).send({ success: true });
  });
}
