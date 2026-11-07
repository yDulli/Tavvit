import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import {
  CUSTOM_DECORATION_KINDS,
  CUSTOM_DECORATION_LIMITS,
  EFFECT_MOTIONS,
  PICTURE_DECORATION_KINDS,
  isEffectMotion,
  normalizeDecorationName,
  normalizeNameStyle,
  type CreateCustomDecorationRequest,
  type CustomDecorationKind,
  type CustomDecorationPage,
  type CustomDecorationSort,
  type UpdateCustomDecorationRequest,
} from '@backspace/shared/src/customDecorations.js';
import { isReportGround } from '@backspace/shared/src/legal.js';
import { getDb, schema } from '../db/index.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { uploadRefusal } from '../utils/accountLimits.js';
import { DecorationImageError, encodeDecorationImage, type EncodedDecoration } from '../utils/decorationImage.js';
import {
  announceWearers,
  decorationFilePath,
  decorationFor,
  deleteDecorationFiles,
  forgetCustomDecoration,
  galleryPage,
  ownDecorationCount,
  ownDecorations,
  removeCustomDecoration,
  wearersOfDesign,
  writeDecorationFile,
} from '../utils/customDecorations.js';
import { MediaBusyError } from '../utils/thumbnail.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { recordPlatformAudit } from '../utils/platformAudit.js';
import { sendNotice } from '../utils/reports.js';

/**
 * Decorations people make, and the community's gallery of them (docs/systems/decorations.md,
 * "Made by people"). Closed to bots like every route that does not open itself (bots.md).
 */

const MAX_MB = CUSTOM_DECORATION_LIMITS.MAX_BYTES / (1024 * 1024);

/** Pictures per account and minute: each is a full decode and re-encode. */
const uploadLimit = createFixedWindowLimit({ max: CUSTOM_DECORATION_LIMITS.UPLOADS_PER_MINUTE, windowMs: 60_000 });
/** New designs per account and day, so making and deleting them over and over cannot churn the disk. */
const dailyLimit = createFixedWindowLimit({ max: CUSTOM_DECORATION_LIMITS.CREATED_PER_DAY, windowMs: 24 * 60 * 60 * 1000 });

/** Tests only: forget every account's windows. */
export function _resetDecorationLimits(): void {
  uploadLimit.reset();
  dailyLimit.reset();
}

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^\\d{1,20}$' } } } as const;

function isAdmin(userId: string): boolean {
  return getDb().select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId)).get()?.isAdmin === 1;
}

export async function customDecorationRoutes(app: FastifyInstance): Promise<void> {
  // ─── The gallery ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { kind: CustomDecorationKind; sort?: CustomDecorationSort; q?: string; offset?: number } }>('/api/decorations', {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: 'object',
        required: ['kind'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: [...CUSTOM_DECORATION_KINDS] },
          sort: { type: 'string', enum: ['popular', 'new'] },
          q: { type: 'string', maxLength: CUSTOM_DECORATION_LIMITS.QUERY_MAX },
          offset: { type: 'integer', minimum: 0, maximum: 100_000 },
        },
      },
    },
  }, async (request) => {
    const page = galleryPage({
      kind: request.query.kind,
      sort: request.query.sort ?? 'popular',
      query: (request.query.q ?? '').trim(),
      offset: request.query.offset ?? 0,
      limit: CUSTOM_DECORATION_LIMITS.PAGE_SIZE,
      viewerId: request.userId,
    });
    return page satisfies CustomDecorationPage;
  });

  // ─── One's own ────────────────────────────────────────────────────────────
  app.get('/api/decorations/mine', { preHandler: authenticate }, async (request) => ({
    items: ownDecorations(request.userId),
    max: CUSTOM_DECORATION_LIMITS.PER_ACCOUNT,
  }));

  // The picture travels in base64 inside JSON, so the body limit allows for the expansion.
  app.post<{ Body: CreateCustomDecorationRequest }>('/api/decorations', {
    preHandler: authenticate,
    bodyLimit: Math.ceil(CUSTOM_DECORATION_LIMITS.MAX_BYTES / 3) * 4 + 8192,
    schema: {
      body: {
        type: 'object',
        required: ['kind', 'name'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: [...CUSTOM_DECORATION_KINDS] },
          name: { type: 'string', maxLength: 256 },
          image: { type: 'string', minLength: 4 },
          style: { type: 'object' },
          motion: { type: 'string', enum: [...EFFECT_MOTIONS] },
          shared: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { kind, image, style, motion, shared } = request.body;
    const name = normalizeDecorationName(request.body.name);
    if (name === undefined) return sendError(reply, 400, 'decoration_name_invalid', { max: CUSTOM_DECORATION_LIMITS.NAME_MAX });
    // An effect is pieces that move as one of Tavvit's effects does, never a picture over the profile.
    if (kind === 'effect' && !isEffectMotion(motion)) return sendError(reply, 400, 'decoration_style_invalid');
    const admin = isAdmin(request.userId);
    if (!admin && ownDecorationCount(request.userId) >= CUSTOM_DECORATION_LIMITS.PER_ACCOUNT) {
      return sendError(reply, 409, 'decoration_limit_reached', { max: CUSTOM_DECORATION_LIMITS.PER_ACCOUNT });
    }

    let encoded: EncodedDecoration | null = null;
    let storedStyle: string | null = kind === 'effect' ? JSON.stringify({ motion }) : null;
    if (PICTURE_DECORATION_KINDS.has(kind)) {
      if (kind === 'name' || typeof image !== 'string') return sendError(reply, 400, 'decoration_image_invalid', { max: MAX_MB });
      if (!uploadLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image)) return sendError(reply, 400, 'validation_failed');
      const bytes = Buffer.from(image, 'base64');
      if (bytes.toString('base64') !== image) return sendError(reply, 400, 'validation_failed');
      try {
        encoded = await encodeDecorationImage(bytes, kind, request.userId);
      } catch (error) {
        if (error instanceof DecorationImageError) return sendError(reply, 400, 'decoration_image_invalid', { max: MAX_MB });
        // This account's last picture is still being worked on, or the queue is full: later.
        if (error instanceof MediaBusyError) return sendError(reply, 429, 'rate_limited');
        throw error;
      }
    } else {
      const built = normalizeNameStyle(style);
      if (built === null) return sendError(reply, 400, 'decoration_style_invalid');
      storedStyle = JSON.stringify(built);
    }
    if (!dailyLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const id = generateSnowflake();
    const size = encoded ? encoded.data.length + (encoded.still?.length ?? 0) : 0;
    if (encoded) {
      await writeDecorationFile(id, false, encoded.data);
      if (encoded.still) await writeDecorationFile(id, true, encoded.still);
    }
    // From the room and the count to the row, nothing is awaited: two requests cannot both take the last place.
    const refusal = size > 0 ? uploadRefusal(request.userId, size) : null;
    const full = !admin && ownDecorationCount(request.userId) >= CUSTOM_DECORATION_LIMITS.PER_ACCOUNT;
    if (refusal || full) {
      await deleteDecorationFiles(id);
      if (full) return sendError(reply, 409, 'decoration_limit_reached', { max: CUSTOM_DECORATION_LIMITS.PER_ACCOUNT });
      return sendError(reply, refusal === 'disk_full' ? 507 : 413, refusal!);
    }
    const now = Date.now();
    getDb().insert(schema.customDecorations).values({
      id,
      kind,
      name,
      creatorId: request.userId,
      animated: encoded?.animated ? 1 : 0,
      size,
      width: encoded?.width ?? null,
      height: encoded?.height ?? null,
      style: storedStyle,
      shared: shared ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    forgetCustomDecoration(id);
    const row = getDb().select().from(schema.customDecorations).where(eq(schema.customDecorations.id, id)).get()!;
    return reply.code(201).send(decorationFor(row, request.userId));
  });

  app.patch<{ Params: { id: string }; Body: UpdateCustomDecorationRequest }>('/api/decorations/:id', {
    preHandler: authenticate,
    schema: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: { name: { type: 'string', maxLength: 256 }, shared: { type: 'boolean' } },
      },
    },
  }, async (request, reply) => {
    const db = getDb();
    const row = db.select().from(schema.customDecorations).where(eq(schema.customDecorations.id, request.params.id)).get();
    if (!row || row.creatorId !== request.userId) return sendError(reply, 404, 'decoration_not_found');
    const changes: Partial<typeof schema.customDecorations.$inferInsert> = { updatedAt: Date.now() };
    if (request.body.name !== undefined) {
      const name = normalizeDecorationName(request.body.name);
      if (name === undefined) return sendError(reply, 400, 'decoration_name_invalid', { max: CUSTOM_DECORATION_LIMITS.NAME_MAX });
      changes.name = name;
    }
    if (request.body.shared !== undefined) changes.shared = request.body.shared ? 1 : 0;
    db.update(schema.customDecorations).set(changes).where(eq(schema.customDecorations.id, row.id)).run();
    forgetCustomDecoration(row.id);
    const updated = db.select().from(schema.customDecorations).where(eq(schema.customDecorations.id, row.id)).get()!;
    // Sharing is what lets others wear it: taken out of the gallery, it goes from their profiles
    // (their reference stays, and it comes back if it is shared again).
    if (updated.shared !== row.shared) announceWearers(wearersOfDesign(updated).filter((id) => id !== updated.creatorId));
    return decorationFor(updated, request.userId);
  });

  // Its maker deletes it: it goes from everyone who wore it.
  app.delete<{ Params: { id: string } }>('/api/decorations/:id', {
    preHandler: authenticate,
    schema: { params: idParams },
  }, async (request, reply) => {
    const row = getDb().select({ creatorId: schema.customDecorations.creatorId }).from(schema.customDecorations)
      .where(eq(schema.customDecorations.id, request.params.id)).get();
    if (!row || row.creatorId !== request.userId) return sendError(reply, 404, 'decoration_not_found');
    await removeCustomDecoration(request.params.id);
    return { success: true };
  });

  // ─── An administrator takes one away ─────────────────────────────────────
  // Not a report's decision (that is POST /api/admin/reports/:id/decide), but the same notice to its
  // maker: what was removed, why, on which ground, and how to object (Art. 17).
  app.post<{ Params: { id: string }; Body: { reason: string; ground: unknown } }>('/api/admin/decorations/:id/remove', {
    preHandler: [authenticate, requireAdmin],
    schema: {
      params: idParams,
      body: {
        type: 'object',
        required: ['reason', 'ground'],
        additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 2000 }, ground: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const reason = request.body.reason.trim();
    if (reason.length < CUSTOM_DECORATION_LIMITS.REASON_MIN || reason.length > CUSTOM_DECORATION_LIMITS.REASON_MAX) {
      return sendError(reply, 400, 'decoration_reason_invalid', { min: CUSTOM_DECORATION_LIMITS.REASON_MIN, max: CUSTOM_DECORATION_LIMITS.REASON_MAX });
    }
    if (!isReportGround(request.body.ground)) return sendError(reply, 400, 'report_ground_required');
    const ground = request.body.ground;
    const removed = await removeCustomDecoration(request.params.id);
    if (!removed) return sendError(reply, 404, 'decoration_not_found');
    const now = Date.now();
    recordPlatformAudit({
      actorId: request.userId,
      action: 'decoration_remove',
      targetType: 'user',
      targetId: removed.creatorId,
      targetLabel: removed.name,
      reason,
      details: { decoration: removed.id, kind: removed.kind, ground },
    }, now);
    if (removed.creatorId !== request.userId) {
      sendNotice(removed.creatorId, { kind: 'content_removed', ground, note: reason, subject: removed.name }, now);
    }
    return { success: true };
  });

  // ─── The pictures ─────────────────────────────────────────────────────────
  // Public, like an upload or an emoji: an <img> cannot send a token. Never a path from the request.
  app.get<{ Params: { file: string } }>('/api/decorations/:file', async (request, reply) => {
    const match = /^(\d{1,20})(-still)?\.webp$/.exec(request.params.file);
    if (!match) return sendError(reply, 404, 'decoration_not_found');
    const id = match[1]!;
    const still = match[2] !== undefined;
    const row = getDb().select({ id: schema.customDecorations.id, kind: schema.customDecorations.kind, animated: schema.customDecorations.animated })
      .from(schema.customDecorations).where(eq(schema.customDecorations.id, id)).get();
    if (!row || !PICTURE_DECORATION_KINDS.has(row.kind as CustomDecorationKind) || (still && row.animated !== 1)) {
      return sendError(reply, 404, 'decoration_not_found');
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(decorationFilePath(row.id, still));
    } catch (error) {
      // A row whose file is gone (removed by hand, or lost with a restore) is a missing picture, not a server fault.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return sendError(reply, 404, 'decoration_not_found');
      throw error;
    }
    // A design's picture never changes under its id, so it is cached as immutable; the response
    // never runs as a document (the same sandbox as a served upload).
    return reply.type('image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'")
      .header('X-Frame-Options', 'DENY')
      .send(bytes);
  });
}
