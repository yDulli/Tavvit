import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { finishedUploadExceedsLimit, releaseUpload, reserveUpload, uploadRefusal, type UploadRefusal } from '../utils/accountLimits.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { finalizeUpload } from '../utils/uploadFinalize.js';

function refused(reply: FastifyReply, code: UploadRefusal): FastifyReply {
  return sendError(reply, code === 'disk_full' ? 507 : 413, code);
}

/**
 * A file from a bot, in the form every HTTP library can send (`multipart/form-data`). A person's
 * upload is resumable (tus) because a person's connection may drop; a program can simply send
 * again. Past this point it is the same pipeline, and it counts on the owner's storage. The answer
 * is an attachment to name in the next message; unused, it goes like any upload nobody sent.
 */
export async function botFileRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart);

  app.post('/api/bots/@me/files', {
    preHandler: authenticate,
    config: { botAllowed: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const db = getDb();
    const bot = db.select({ id: schema.bots.id }).from(schema.bots).where(eq(schema.bots.id, request.userId)).get();
    if (!bot) return sendError(reply, 403, 'bot_route_forbidden');

    const settings = db.select({ max: schema.instanceSettings.maxUploadSizeBytes })
      .from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    const maxSize = settings?.max ?? config.maxUploadSize;

    if (!request.isMultipart()) return sendError(reply, 400, 'validation_failed', { field: 'file' });

    // The room it may take is held before a byte is written, as for any upload (utils/accountLimits.ts):
    // what the request says it is, or the largest file when it says nothing, and never more.
    // Uploads sent side by side then cannot all pass the same check.
    const announced = Number(request.headers['content-length']);
    const held = Number.isFinite(announced) && announced > 0 ? Math.min(announced, maxSize) : maxSize;
    const early = uploadRefusal(bot.id, held);
    if (early) return refused(reply, early);
    const uploadId = `bot-${generateSnowflake()}`;
    reserveUpload(uploadId, bot.id, held);
    try {
      const part = await request.file({ limits: { files: 1, fileSize: held } });
      if (!part) return sendError(reply, 400, 'validation_failed', { field: 'file' });

      fs.mkdirSync(config.tusUploadDir, { recursive: true });
      const stagedPath = path.join(config.tusUploadDir, uploadId);
      const forget = () => fs.rmSync(stagedPath, { force: true });
      try {
        await pipeline(part.file, fs.createWriteStream(stagedPath));
      } catch (err) {
        forget();
        throw err;
      }
      if (part.file.truncated) {
        forget();
        return sendError(reply, 413, 'upload_too_large', { max: maxSize });
      }

      const size = fs.statSync(stagedPath).size;
      if (size === 0) {
        forget();
        return sendError(reply, 400, 'validation_failed', { field: 'file' });
      }
      // Checked again as written: a restart forgot what was held, or the limit went down.
      if (finishedUploadExceedsLimit(bot.id, size)) {
        forget();
        return refused(reply, 'storage_limit_reached');
      }

      const attachment = await finalizeUpload({
        srcPath: stagedPath,
        snowflakeId: generateSnowflake(),
        uploaderId: bot.id,
        originalName: part.filename || 'upload',
        size,
      });
      return reply.code(201).send(attachment);
    } finally {
      releaseUpload(uploadId);
    }
  });
}
