import type { FastifyInstance } from 'fastify';
import { blueskyImageAddress } from '@backspace/shared/src/bluesky.js';
import { authenticate } from '../utils/auth.js';
import { fetchBlueskyPicture } from '../utils/bluesky.js';
import { sendError } from '../utils/httpErrors.js';
import { fetchUrlMetadata } from '../utils/metadataFetcher.js';

export async function utilRoutes(app: FastifyInstance): Promise<void> {
  // One picture of a Bluesky post, for someone copying or saving it from the viewer: Bluesky's
  // picture host sends no CORS headers, so the page cannot read it itself (docs/systems/embeds.md,
  // "Bluesky posts"). Only that host, only images, only signed in, and at the pace of a person clicking.
  app.get<{ Querystring: { url?: string } }>('/api/embeds/bluesky-picture', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const address = blueskyImageAddress(request.query.url);
    if (!address) return sendError(reply, 400, 'validation_failed', { field: 'url' });
    const picture = await fetchBlueskyPicture(address);
    if (!picture) return sendError(reply, 404, 'file_not_found');
    return reply
      .header('Content-Type', picture.type)
      .header('Cache-Control', 'private, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox")
      .send(picture.bytes);
  });

  app.get<{ Querystring: { url: string } }>('/api/utils/metadata', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { url } = request.query;

    if (!url) {
      return sendError(reply, 400, 'validation_failed');
    }

    const metadata = await fetchUrlMetadata(url);
    if (!metadata) {
      return reply.code(200).send({});
    }

    return reply.code(200).send(metadata);
  });
}
