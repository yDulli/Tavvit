import type { FastifyInstance, FastifyReply } from 'fastify';
import { asc, eq, inArray } from 'drizzle-orm';
import type { AuditLogChange } from '@backspace/shared';
import {
  CUSTOM_EMOJI_LIMITS,
  CUSTOM_EMOJI_NAME_MAX,
  CUSTOM_EMOJI_NAME_MIN,
  normalizeEmojiName,
} from '@backspace/shared/src/customEmoji.js';
import { MAX_STICKER_BYTES, MAX_STICKER_NAME_LENGTH, normalizeStickerName } from '@backspace/shared/src/stickers.js';
import {
  SPACE_EXPRESSION_LIMITS,
  normalizeStickerDescription,
  type AvailableExpressionsResponse,
  type AvailableSpaceExpressions,
  type SpaceEmojiRequest,
  type SpaceStickerRequest,
  type SpaceStickerUpdate,
} from '@backspace/shared/src/spaceExpressions.js';
import { getDb, schema } from '../db/index.js';
import { recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { removeSpaceEmoji, removeSpaceSticker, spaceEmojiRow, spaceStickerRow } from '../utils/spaceExpressionRemoval.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { sendError } from '../utils/httpErrors.js';
import { getMember, hasPermission, PermissionBits } from '../utils/permissions.js';
import {
  addSpaceEmoji,
  addSpaceSticker,
  expressionManagerRefusal,
  listSpaceEmojis,
  listSpaceStickers,
  spaceEmojiNameTaken,
  spaceStickerNameTaken,
  toSpaceEmoji,
  toSpaceSticker,
  type SpaceEmojiRow,
  type SpaceStickerRow,
} from '../utils/spaceExpressions.js';
import { connectionManager } from '../ws/handler.js';

/**
 * A space's own emoji and stickers (docs/systems/emoji.md): its members list them, whoever holds
 * MANAGE_EMOJIS adds, renames and removes them. Every change goes into the space's audit log and
 * tells the space's members to load the list again. Bots have no way in (docs/systems/bots.md).
 */

/** Pictures one account adds per minute, emoji and stickers together: each is a full decode and re-encode. */
const uploadLimit = createFixedWindowLimit({ max: SPACE_EXPRESSION_LIMITS.UPLOADS_PER_MINUTE, windowMs: 60_000 });
/** Stickers one account uploads to spaces in a day (shared/src/spaceExpressions.ts says why). */
const dailyStickerLimit = createFixedWindowLimit({ max: SPACE_EXPRESSION_LIMITS.STICKER_UPLOADS_PER_DAY, windowMs: 24 * 60 * 60 * 1000 });

/** Tests only: forget every account's upload windows. */
export function _resetSpaceExpressionLimits(): void {
  uploadLimit.reset();
  dailyStickerLimit.reset();
}

const emojiNameDetails = { min: CUSTOM_EMOJI_NAME_MIN, max: CUSTOM_EMOJI_NAME_MAX } as const;
const MAX_STICKER_MB = MAX_STICKER_BYTES / (1024 * 1024);

/** The bytes of a base64 picture, or null when the text is not canonical base64 or carries nothing. */
function decodeImage(image: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image)) return null;
  const bytes = Buffer.from(image, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === image ? bytes : null;
}

const emojiOf = spaceEmojiRow;
const stickerOf = spaceStickerRow;

/**
 * Sends the refusal and answers true unless `userId` may change the space's emoji and stickers now
 * (expressionManagerRefusal). Checked here, never only by a hidden button; an add checks again right
 * before its row goes in.
 */
function refusedManager(reply: FastifyReply, spaceId: string, userId: string): boolean {
  const refusal = expressionManagerRefusal(spaceId, userId);
  if (!refusal) return false;
  sendError(reply, refusal.status, refusal.code, refusal.details);
  return true;
}

/** Whether `userId` may see the lists: a member, or someone who may manage them (an instance admin). */
function mayList(spaceId: string, userId: string): boolean {
  return getMember(spaceId, userId) !== undefined || hasPermission(userId, spaceId, PermissionBits.MANAGE_EMOJIS);
}

function isUniqueError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

/** SQLite takes this many bound values in one statement and more; queries go in chunks of it. */
const IDS_PER_QUERY = 500;

/**
 * Everything `userId` may pick on this instance: the library, and the emoji and stickers of each
 * space they are a member of, in the order of joining. A space with nothing yet is listed too.
 */
function availableExpressions(userId: string): AvailableExpressionsResponse {
  const db = getDb();
  const library = db.select().from(schema.customEmojis).orderBy(asc(schema.customEmojis.name)).all()
    .map((row) => ({ id: row.id, name: row.name, animated: row.animated === 1, createdBy: row.createdBy, createdAt: row.createdAt }));
  const spaceIds = db.select({ spaceId: schema.spaceMembers.spaceId }).from(schema.spaceMembers)
    .where(eq(schema.spaceMembers.userId, userId)).orderBy(asc(schema.spaceMembers.joinedAt)).all().map((row) => row.spaceId);
  const bySpace = new Map<string, AvailableSpaceExpressions>(spaceIds.map((spaceId) => [spaceId, { spaceId, emojis: [], stickers: [] }]));
  for (let start = 0; start < spaceIds.length; start += IDS_PER_QUERY) {
    const chunk = spaceIds.slice(start, start + IDS_PER_QUERY);
    for (const row of db.select().from(schema.spaceEmojis).where(inArray(schema.spaceEmojis.spaceId, chunk)).orderBy(asc(schema.spaceEmojis.name)).all()) {
      bySpace.get(row.spaceId)?.emojis.push(toSpaceEmoji(row));
    }
    for (const row of db.select().from(schema.spaceStickers).where(inArray(schema.spaceStickers.spaceId, chunk)).orderBy(asc(schema.spaceStickers.createdAt)).all()) {
      bySpace.get(row.spaceId)?.stickers.push(toSpaceSticker(row));
    }
  }
  return { library, spaces: [...bySpace.values()] };
}

export async function spaceExpressionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/emojis/available - What this person may pick here, for the pickers. A static path, so
  // it goes before the picture route `/api/emojis/:file` whatever the order of registration.
  app.get('/api/emojis/available', { preHandler: authenticate }, async (request, reply) => {
    return reply.code(200).send(availableExpressions(request.userId));
  });

  // GET /api/spaces/:id/emojis - The space's emoji
  app.get<{ Params: { id: string } }>('/api/spaces/:id/emojis', { preHandler: authenticate }, async (request, reply) => {
    const spaceId = request.params.id;
    if (!mayList(spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
    return reply.code(200).send({
      emojis: listSpaceEmojis(spaceId).map(toSpaceEmoji),
      // The limit of the instance the space lives on, which a client of another version may not know.
      max: SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE,
    });
  });

  // POST /api/spaces/:id/emojis - Add one
  app.post<{ Params: { id: string }; Body: SpaceEmojiRequest }>('/api/spaces/:id/emojis', {
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
    const spaceId = request.params.id;
    if (refusedManager(reply, spaceId, request.userId)) return reply;
    const name = normalizeEmojiName(request.body.name);
    if (name === null) return sendError(reply, 400, 'emoji_name_invalid', emojiNameDetails);
    if (!uploadLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
    const source = decodeImage(request.body.image);
    if (!source) return sendError(reply, 400, 'emoji_image_invalid');

    const added = await addSpaceEmoji({ spaceId, actorId: request.userId, name, source });
    if (!added.ok) return sendError(reply, added.refusal.status, added.refusal.code, added.refusal.details);
    recordAudit({ spaceId, actorId: request.userId, action: 'emoji_create', targetType: 'space', targetId: added.value.id, targetLabel: added.value.name });
    connectionManager.sendToSpace(spaceId, { type: 'space_emojis_changed', spaceId });
    return reply.code(201).send(toSpaceEmoji(added.value));
  });

  // PATCH /api/space-emojis/:id - Rename one
  app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/space-emojis/:id', {
    preHandler: authenticate,
    schema: {
      body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', maxLength: 64 } } },
    },
  }, async (request, reply) => {
    const row = emojiOf(request.params.id);
    if (!row) return sendError(reply, 404, 'space_emoji_not_found');
    if (refusedManager(reply, row.spaceId, request.userId)) return reply;
    const name = normalizeEmojiName(request.body.name);
    if (name === null) return sendError(reply, 400, 'emoji_name_invalid', emojiNameDetails);
    if (name === row.name) return reply.code(200).send(toSpaceEmoji(row));
    if (spaceEmojiNameTaken(row.spaceId, name, row.id)) return sendError(reply, 409, 'space_emoji_name_taken');

    let updated: SpaceEmojiRow | undefined;
    try {
      updated = getDb().update(schema.spaceEmojis).set({ name }).where(eq(schema.spaceEmojis.id, row.id)).returning().get();
    } catch (err) {
      // The check above is not a lock: a rename side by side ends here.
      if (isUniqueError(err)) return sendError(reply, 409, 'space_emoji_name_taken');
      throw err;
    }
    if (!updated) return sendError(reply, 404, 'space_emoji_not_found');
    recordAudit({
      spaceId: row.spaceId, actorId: request.userId, action: 'emoji_update', targetType: 'space', targetId: row.id, targetLabel: name,
      changes: [{ key: 'name', from: row.name, to: name }],
    });
    connectionManager.sendToSpace(row.spaceId, { type: 'space_emojis_changed', spaceId: row.spaceId });
    return reply.code(200).send(toSpaceEmoji(updated));
  });

  // DELETE /api/space-emojis/:id - Take one out. Messages that used it show its name from then on.
  app.delete<{ Params: { id: string } }>('/api/space-emojis/:id', { preHandler: authenticate }, async (request, reply) => {
    const row = emojiOf(request.params.id);
    if (!row) return sendError(reply, 404, 'space_emoji_not_found');
    if (refusedManager(reply, row.spaceId, request.userId)) return reply;
    await removeSpaceEmoji(row, request.userId);
    return reply.code(200).send({ success: true });
  });

  // GET /api/spaces/:id/stickers - The space's stickers
  app.get<{ Params: { id: string } }>('/api/spaces/:id/stickers', { preHandler: authenticate }, async (request, reply) => {
    const spaceId = request.params.id;
    if (!mayList(spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
    return reply.code(200).send({
      stickers: listSpaceStickers(spaceId).map(toSpaceSticker),
      max: SPACE_EXPRESSION_LIMITS.STICKERS_PER_SPACE,
    });
  });

  // POST /api/spaces/:id/stickers - Add one
  app.post<{ Params: { id: string }; Body: SpaceStickerRequest }>('/api/spaces/:id/stickers', {
    preHandler: authenticate,
    bodyLimit: Math.ceil(MAX_STICKER_BYTES / 3) * 4 + 4096,
    schema: {
      body: {
        type: 'object', required: ['name', 'image'], additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: MAX_STICKER_NAME_LENGTH },
          // Bounded loosely here; normalizeStickerDescription holds the exact rule.
          description: { type: ['string', 'null'], maxLength: 1000 },
          image: { type: 'string', minLength: 4 },
        },
      },
    },
  }, async (request, reply) => {
    const spaceId = request.params.id;
    if (refusedManager(reply, spaceId, request.userId)) return reply;
    const name = normalizeStickerName(request.body.name);
    if (name === undefined) return sendError(reply, 400, 'sticker_name_invalid', { max: MAX_STICKER_NAME_LENGTH });
    const description = normalizeStickerDescription(request.body.description);
    if (description === undefined) return sendError(reply, 400, 'validation_failed', { field: 'description' });
    if (!uploadLimit.consume(request.userId) || !dailyStickerLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
    const source = decodeImage(request.body.image);
    if (!source) return sendError(reply, 400, 'sticker_invalid_image', { max: MAX_STICKER_MB });

    const added = await addSpaceSticker({ spaceId, actorId: request.userId, name, description, source });
    if (!added.ok) return sendError(reply, added.refusal.status, added.refusal.code, added.refusal.details);
    recordAudit({ spaceId, actorId: request.userId, action: 'sticker_create', targetType: 'space', targetId: added.value.id, targetLabel: added.value.name });
    connectionManager.sendToSpace(spaceId, { type: 'space_stickers_changed', spaceId });
    return reply.code(201).send(toSpaceSticker(added.value));
  });

  // PATCH /api/space-stickers/:id - Rename one, or change what a screen reader says for it
  app.patch<{ Params: { id: string }; Body: SpaceStickerUpdate }>('/api/space-stickers/:id', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: MAX_STICKER_NAME_LENGTH },
          description: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const row = stickerOf(request.params.id);
    if (!row) return sendError(reply, 404, 'space_sticker_not_found');
    if (refusedManager(reply, row.spaceId, request.userId)) return reply;

    const set: { name?: string; description?: string | null } = {};
    const changes: AuditLogChange[] = [];
    if (request.body.name !== undefined) {
      const name = normalizeStickerName(request.body.name);
      if (name === undefined) return sendError(reply, 400, 'sticker_name_invalid', { max: MAX_STICKER_NAME_LENGTH });
      if (name !== row.name) {
        if (spaceStickerNameTaken(row.spaceId, name, row.id)) return sendError(reply, 409, 'space_sticker_name_taken');
        set.name = name;
        changes.push({ key: 'name', from: row.name, to: name });
      }
    }
    if (request.body.description !== undefined) {
      const description = normalizeStickerDescription(request.body.description);
      if (description === undefined) return sendError(reply, 400, 'validation_failed', { field: 'description' });
      if (description !== row.description) {
        set.description = description;
        changes.push({ key: 'description', from: row.description, to: description });
      }
    }
    if (changes.length === 0) return reply.code(200).send(toSpaceSticker(row));

    let updated: SpaceStickerRow | undefined;
    try {
      updated = getDb().update(schema.spaceStickers).set(set).where(eq(schema.spaceStickers.id, row.id)).returning().get();
    } catch (err) {
      if (isUniqueError(err)) return sendError(reply, 409, 'space_sticker_name_taken');
      throw err;
    }
    if (!updated) return sendError(reply, 404, 'space_sticker_not_found');
    recordAudit({
      spaceId: row.spaceId, actorId: request.userId, action: 'sticker_update', targetType: 'space', targetId: row.id, targetLabel: updated.name, changes,
    });
    connectionManager.sendToSpace(row.spaceId, { type: 'space_stickers_changed', spaceId: row.spaceId });
    return reply.code(200).send(toSpaceSticker(updated));
  });

  // DELETE /api/space-stickers/:id - Take one out. Its picture stays while a message, a reaction or
  // someone's collection still names it (utils/stickerAssets.ts).
  app.delete<{ Params: { id: string } }>('/api/space-stickers/:id', { preHandler: authenticate }, async (request, reply) => {
    const row = stickerOf(request.params.id);
    if (!row) return sendError(reply, 404, 'space_sticker_not_found');
    if (refusedManager(reply, row.spaceId, request.userId)) return reply;
    removeSpaceSticker(row, request.userId);
    return reply.code(200).send({ success: true });
  });
}
