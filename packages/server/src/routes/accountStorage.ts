import type { FastifyInstance } from 'fastify';
import { authenticate } from '../utils/auth.js';
import { storageUsage } from '../utils/accountLimits.js';

/** What a person's own files take up, and how much they may keep (utils/accountLimits.ts). */
export async function accountStorageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users/@me/storage', { preHandler: authenticate }, async (request, reply) => {
    return reply.code(200).send(storageUsage(request.userId));
  });
}
