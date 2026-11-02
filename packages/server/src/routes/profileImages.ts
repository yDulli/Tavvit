import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_PROFILE_IMAGE_SOURCE_BYTES,
  PROFILE_IMAGE_SPECS,
  isProfileImageKind,
  type ProfileImageRequest,
  type ProfileImageResponse,
} from '@backspace/shared/src/profileImage.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { authenticate, requireLocalUser } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { ProfileImageError, renderAnimatedProfileImage } from '../utils/profileImage.js';

/**
 * Animated profile pictures and banners (shared/src/profileImage.ts).
 *
 * The client sends the original animation and the crop it chose, as it sends a
 * sticker: JSON with base64, so the existing authenticated client is all it
 * needs. The finished file is stored like any other upload and is used by
 * naming it in the next profile update, which also removes the upload record,
 * so replaced and abandoned files go through the same cleanup as still images.
 */
export async function profileImageRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/users/@me/profile-image - cut an animation to an avatar or a banner
  app.post<{ Body: ProfileImageRequest }>('/api/users/@me/profile-image', {
    preHandler: [authenticate, requireLocalUser],
    // Base64 is a third larger than the bytes it carries; the rest is the crop.
    bodyLimit: Math.ceil(MAX_PROFILE_IMAGE_SOURCE_BYTES / 3) * 4 + 4096,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['kind', 'image', 'crop'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          image: { type: 'string', minLength: 4 },
          crop: {
            type: 'object',
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false,
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { kind, image, crop } = request.body;
    if (!isProfileImageKind(kind)) return sendError(reply, 400, 'validation_failed');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image)) return sendError(reply, 400, 'profile_image_invalid');
    const source = Buffer.from(image, 'base64');
    if (source.toString('base64') !== image) return sendError(reply, 400, 'profile_image_invalid');
    if (source.length > MAX_PROFILE_IMAGE_SOURCE_BYTES) return sendError(reply, 413, 'profile_image_too_large');

    let output: Buffer;
    try {
      output = await renderAnimatedProfileImage(source, kind, crop);
    } catch (err) {
      // Only what is wrong with the image is the client's to hear; anything
      // else (the decoder itself failing) is a server error and stays one.
      if (err instanceof ProfileImageError) {
        return sendError(reply, err.code === 'profile_image_too_large' ? 413 : 400, err.code);
      }
      throw err;
    }

    const id = generateSnowflake();
    const filename = `${id}.webp`;
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const filepath = path.join(config.uploadDir, filename);
    fs.writeFileSync(filepath, output);
    try {
      const spec = PROFILE_IMAGE_SPECS[kind];
      getDb().insert(schema.attachments).values({
        id,
        uploaderId: request.userId,
        messageId: null,
        dmMessageId: null,
        filename,
        originalName: `${kind}.webp`,
        mimetype: 'image/webp',
        size: output.length,
        width: spec.width,
        height: spec.height,
        createdAt: Date.now(),
      }).run();
    } catch (err) {
      // No record, no way to find the file again: take it back.
      try { fs.unlinkSync(filepath); } catch { /* already gone */ }
      throw err;
    }

    const response: ProfileImageResponse = { filename };
    return reply.code(201).send(response);
  });
}
