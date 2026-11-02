import type { FastifyInstance } from 'fastify';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { asc, eq, sql } from 'drizzle-orm';
import { normalizeSoundName, SOUNDBOARD_LIMITS, type SpaceSound, type SpaceSoundRequest } from '@backspace/shared/src/soundboard.js';
import { getDb, schema } from '../db/index.js';
import { releaseUpload, reserveUpload, uploadRefusal } from '../utils/accountLimits.js';
import { recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { sendError } from '../utils/httpErrors.js';
import { getChannelSpaceId, getMember, hasPermission, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { memberActionRefusal } from '../utils/spaceModeration.js';
import { soundDir, soundFilePath } from '../utils/soundFiles.js';
import { probeMediaMeta } from '../utils/thumbnail.js';
import { connectionManager } from '../ws/handler.js';

type SoundRow = typeof schema.spaceSounds.$inferSelect;

const playLimit = createFixedWindowLimit({ max: SOUNDBOARD_LIMITS.PLAYS_PER_WINDOW, windowMs: SOUNDBOARD_LIMITS.WINDOW_MS });

export function _resetSoundboardLimitForTests(): void {
  playLimit.reset();
}

/**
 * What an upload is, from its first bytes, or null when it is no audio file this takes. The name
 * and type a client gives are not believed: the stored bytes are served as what is found here.
 */
export function sniffAudio(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'fLaC') return 'audio/flac';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

function toWire(row: SoundRow): SpaceSound {
  return { id: row.id, spaceId: row.spaceId, name: row.name, duration: row.duration, createdBy: row.createdBy, createdAt: row.createdAt };
}

const soundOf = (id: string): SoundRow | undefined =>
  getDb().select().from(schema.spaceSounds).where(eq(schema.spaceSounds.id, id)).get();

export async function soundboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/spaces/:id/sounds - The space's clips
  app.get<{ Params: { id: string } }>('/api/spaces/:id/sounds', { preHandler: authenticate }, async (request, reply) => {
    if (!getMember(request.params.id, request.userId)) return sendError(reply, 403, 'not_space_member');
    const rows = getDb().select().from(schema.spaceSounds).where(eq(schema.spaceSounds.spaceId, request.params.id))
      .orderBy(asc(schema.spaceSounds.createdAt)).all();
    return reply.code(200).send({ sounds: rows.map(toWire) });
  });

  // POST /api/spaces/:id/sounds - Add one
  app.post<{ Params: { id: string }; Body: SpaceSoundRequest }>('/api/spaces/:id/sounds', {
    preHandler: authenticate,
    bodyLimit: Math.ceil(SOUNDBOARD_LIMITS.MAX_BYTES / 3) * 4 + 4096,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SOUNDS)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SOUNDS' });
    // Everyone in the space can play it: a member action (utils/spaceModeration.ts).
    const held = memberActionRefusal(id, request.userId);
    if (held) return sendError(reply, held.status, held.code, held.details);
    const name = normalizeSoundName(request.body?.name);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    if (typeof request.body?.audio !== 'string') return sendError(reply, 400, 'validation_failed', { field: 'audio' });

    const db = getDb();
    const count = db.select({ count: sql<number>`count(*)` }).from(schema.spaceSounds).where(eq(schema.spaceSounds.spaceId, id)).get()?.count ?? 0;
    if (count >= SOUNDBOARD_LIMITS.PER_SPACE_MAX) return sendError(reply, 400, 'sound_limit_reached', { max: SOUNDBOARD_LIMITS.PER_SPACE_MAX });

    const bytes = Buffer.from(request.body.audio, 'base64');
    if (bytes.length === 0) return sendError(reply, 400, 'validation_failed', { field: 'audio' });
    if (bytes.length > SOUNDBOARD_LIMITS.MAX_BYTES) return sendError(reply, 400, 'sound_too_large', { max: SOUNDBOARD_LIMITS.MAX_BYTES });
    const mimetype = sniffAudio(bytes);
    if (!mimetype) return sendError(reply, 400, 'sound_invalid');

    // A clip is kept on its creator's storage, and the disk keeps its reserve: held from here until
    // its row is in, so that clips sent side by side cannot all pass the same check.
    const refusal = uploadRefusal(request.userId, bytes.length);
    if (refusal) return sendError(reply, refusal === 'disk_full' ? 507 : 413, refusal);
    const soundId = generateSnowflake();
    reserveUpload(soundId, request.userId, bytes.length);
    const file = soundFilePath(soundId);
    try {
      await mkdir(soundDir(), { recursive: true });
      await writeFile(file, bytes);
      const probed = await probeMediaMeta(file, mimetype).catch(() => null);
      const measured = Number(request.body.duration);
      const duration = probed?.duration ?? (Number.isFinite(measured) && measured > 0 ? measured : null);
      if (duration === null) throw new SoundRefused('sound_invalid');
      if (duration > SOUNDBOARD_LIMITS.MAX_SECONDS + 0.05) throw new SoundRefused('sound_too_long');
      // Counted again with nothing awaited before the insert: clips added side by side would
      // otherwise all pass the count made before the file was written.
      const countNow = db.select({ count: sql<number>`count(*)` }).from(schema.spaceSounds).where(eq(schema.spaceSounds.spaceId, id)).get()?.count ?? 0;
      if (countNow >= SOUNDBOARD_LIMITS.PER_SPACE_MAX) throw new SoundRefused('sound_limit_reached');
      const now = Date.now();
      db.insert(schema.spaceSounds).values({
        id: soundId, spaceId: id, name, mimetype, size: bytes.length, duration, createdBy: request.userId, createdAt: now,
      }).run();
    } catch (err) {
      await rm(file, { force: true });
      if (err instanceof SoundRefused) {
        if (err.code === 'sound_limit_reached') return sendError(reply, 400, 'sound_limit_reached', { max: SOUNDBOARD_LIMITS.PER_SPACE_MAX });
        return err.code === 'sound_too_long'
          ? sendError(reply, 400, 'sound_too_long', { max: SOUNDBOARD_LIMITS.MAX_SECONDS })
          : sendError(reply, 400, 'sound_invalid');
      }
      throw err;
    } finally {
      releaseUpload(soundId);
    }
    const row = soundOf(soundId);
    if (!row) return sendError(reply, 500, 'internal_error');
    recordAudit({ spaceId: id, actorId: request.userId, action: 'sound_create', targetType: 'space', targetId: soundId, targetLabel: name });
    connectionManager.sendToSpace(id, { type: 'space_sounds_changed', spaceId: id });
    return reply.code(201).send(toWire(row));
  });

  // PATCH /api/sounds/:id - Rename one
  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>('/api/sounds/:id', { preHandler: authenticate }, async (request, reply) => {
    const row = soundOf(request.params.id);
    if (!row) return sendError(reply, 404, 'sound_not_found');
    if (!hasPermission(request.userId, row.spaceId, PermissionBits.MANAGE_SOUNDS)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SOUNDS' });
    const held = memberActionRefusal(row.spaceId, request.userId);
    if (held) return sendError(reply, held.status, held.code, held.details);
    const name = normalizeSoundName(request.body?.name);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    getDb().update(schema.spaceSounds).set({ name }).where(eq(schema.spaceSounds.id, row.id)).run();
    recordAudit({ spaceId: row.spaceId, actorId: request.userId, action: 'sound_update', targetType: 'space', targetId: row.id, targetLabel: name });
    connectionManager.sendToSpace(row.spaceId, { type: 'space_sounds_changed', spaceId: row.spaceId });
    return reply.code(200).send(toWire({ ...row, name }));
  });

  // DELETE /api/sounds/:id - Take one out
  app.delete<{ Params: { id: string } }>('/api/sounds/:id', { preHandler: authenticate }, async (request, reply) => {
    const row = soundOf(request.params.id);
    if (!row) return sendError(reply, 404, 'sound_not_found');
    if (!hasPermission(request.userId, row.spaceId, PermissionBits.MANAGE_SOUNDS)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SOUNDS' });
    getDb().delete(schema.spaceSounds).where(eq(schema.spaceSounds.id, row.id)).run();
    await rm(soundFilePath(row.id), { force: true });
    recordAudit({ spaceId: row.spaceId, actorId: request.userId, action: 'sound_delete', targetType: 'space', targetId: row.id, targetLabel: row.name });
    connectionManager.sendToSpace(row.spaceId, { type: 'space_sounds_changed', spaceId: row.spaceId });
    return reply.code(200).send({ success: true });
  });

  // GET /api/sounds/:id/audio - The file, for those in the space
  app.get<{ Params: { id: string } }>('/api/sounds/:id/audio', { preHandler: authenticate }, async (request, reply) => {
    const row = soundOf(request.params.id);
    if (!row || !getMember(row.spaceId, request.userId)) return sendError(reply, 404, 'sound_not_found');
    let bytes: Buffer;
    try {
      bytes = await readFile(soundFilePath(row.id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return sendError(reply, 404, 'sound_not_found');
      throw err;
    }
    return reply.type(row.mimetype)
      .header('Cache-Control', 'private, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'")
      .send(bytes);
  });

  // POST /api/channels/:id/soundboard/:soundId/play - Everyone in the call plays it on their own device.
  // Nothing goes through the microphone or the room: each listener decides whether, and how loud.
  app.post<{ Params: { id: string; soundId: string } }>('/api/channels/:id/soundboard/:soundId/play', { preHandler: authenticate }, async (request, reply) => {
    const { id, soundId } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!connectionManager.getRoomParticipants(id).has(request.userId)) return sendError(reply, 403, 'sound_not_in_call');
    if (!hasPermission(request.userId, spaceId, PermissionBits.USE_SOUNDBOARD, id)) return sendError(reply, 403, 'missing_permission', { permission: 'USE_SOUNDBOARD' });
    const held = memberActionRefusal(spaceId, request.userId);
    if (held) return sendError(reply, held.status, held.code, held.details);
    const row = soundOf(soundId);
    if (!row || row.spaceId !== spaceId) return sendError(reply, 404, 'sound_not_found');
    if (!playLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
    for (const userId of connectionManager.getRoomParticipants(id)) {
      connectionManager.sendToUser(userId, { type: 'soundboard_play', channelId: id, spaceId, soundId, userId: request.userId });
    }
    return reply.code(200).send({ success: true });
  });
}

class SoundRefused extends Error {
  constructor(readonly code: 'sound_invalid' | 'sound_too_long' | 'sound_limit_reached') {
    super(code);
  }
}
