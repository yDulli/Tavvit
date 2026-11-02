import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { uploadRefusal, type UploadRefusal } from '../utils/accountLimits.js';
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

    // Said early when the request says how long it is, so nothing is written for nothing.
    const announced = Number(request.headers['content-length']);
    if (Number.isFinite(announced) && announced > 0) {
      const early = uploadRefusal(bot.id, Math.min(announced, maxSize));
      if (early) return refused(reply, early);
    }

    if (!request.isMultipart()) return sendError(reply, 400, 'validation_failed', { field: 'file' });
    const part = await request.file({ limits: { files: 1, fileSize: maxSize } });
    if (!part) return sendError(reply, 400, 'validation_failed', { field: 'file' });

    fs.mkdirSync(config.tusUploadDir, { recursive: true });
    const stagedPath = path.join(config.tusUploadDir, `bot-${generateSnowflake()}`);
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
    const refusal = uploadRefusal(bot.id, size);
    if (refusal) {
      forget();
      return refused(reply, refusal);
    }

    const attachment = await finalizeUpload({
      srcPath: stagedPath,
      snowflakeId: generateSnowflake(),
      uploaderId: bot.id,
      originalName: part.filename || 'upload',
      size,
    });
    return reply.code(201).send(attachment);
  });
}
