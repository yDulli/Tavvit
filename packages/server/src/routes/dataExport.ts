import { refuseWithoutSecondFactor } from './twoFactor.js';
import { checkPassword, refusePasswordCheck } from '../utils/passwordConfirm.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { dataExportFile, dataExportStatus, requestDataExport } from '../utils/dataExport.js';
import { sendError } from '../utils/httpErrors.js';

/** A person's copy of their own data (utils/dataExport.ts). No route here can reach anyone else's. */
export async function dataExportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users/@me/data-export', { preHandler: authenticate }, async (request, reply) => {
    return reply.code(200).send(dataExportStatus(request.userId));
  });

  // The password again: whoever has a session open on someone's computer has no
  // business walking off with everything they ever wrote.
  app.post<{ Body: { password?: unknown; twoFactorCode?: unknown } }>('/api/users/@me/data-export', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const password = request.body?.password;
    if (!password || typeof password !== 'string') return sendError(reply, 400, 'password_required');
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) return sendError(reply, 404, 'user_not_found');
    const check = await checkPassword(user, password, request);
    if (check !== 'valid') return refusePasswordCheck(reply, check);
    const refused = refuseWithoutSecondFactor(user, request.body?.twoFactorCode, request, reply);
    if (refused) return refused;

    const result = requestDataExport(request.userId);
    if ('refused' in result) return sendError(reply, 429, 'data_export_too_soon', { hours: result.refused.hours });
    return reply.code(202).send(dataExportStatus(request.userId));
  });

  app.get('/api/users/@me/data-export/download', { preHandler: authenticate }, async (request, reply) => {
    const file = dataExportFile(request.userId);
    if (!file) return sendError(reply, 404, 'data_export_not_ready');
    const { size } = await stat(file);
    return reply
      .type('application/zip')
      .header('content-length', size)
      .header('content-disposition', 'attachment; filename="tavvit-data.zip"')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(file));
  });
}
