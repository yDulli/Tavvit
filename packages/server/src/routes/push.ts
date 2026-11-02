import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { isPushServiceAddress, PUSH_LIMITS, type PushKeyResponse, type PushSubscribeRequest } from '@backspace/shared/src/push.js';
import { getDb, schema } from '../db/index.js';
import { authenticate, requireLocalUser } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { getVapidKeys } from '../utils/pushDelivery.js';
import { generateSnowflake } from '../utils/snowflake.js';

const KNOWN_LOCALES = new Set(['en', 'de', 'pt', 'ru', 'zh']);

/** A receiver's key: an uncompressed P-256 point. Anything else cannot be encrypted for. */
function isReceiverKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 65 && bytes[0] === 4;
}

function isAuthSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Buffer.from(value, 'base64url').length === 16;
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/push/key - What a browser subscribes with
  app.get('/api/push/key', { preHandler: authenticate }, async (_request, reply) => {
    const response: PushKeyResponse = { publicKey: getVapidKeys().publicKey };
    return reply.code(200).send(response);
  });

  // POST /api/push/subscriptions - This device wants pushes for this account
  app.post<{ Body: PushSubscribeRequest }>('/api/push/subscriptions', {
    preHandler: [authenticate, requireLocalUser],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { endpoint, keys, showText, directMessages, locale } = request.body ?? {};
    if (!isPushServiceAddress(endpoint)) return sendError(reply, 400, 'validation_failed', { field: 'endpoint' });
    if (!isReceiverKey(keys?.p256dh) || !isAuthSecret(keys?.auth)) return sendError(reply, 400, 'validation_failed', { field: 'keys' });

    const db = getDb();
    const now = Date.now();
    const fields = {
      userId: request.userId,
      sessionId: request.sessionId ?? null,
      p256dh: keys.p256dh,
      auth: keys.auth,
      showText: showText !== false,
      directMessages: directMessages !== false,
      locale: typeof locale === 'string' && KNOWN_LOCALES.has(locale) ? locale : null,
      failures: 0,
    };
    // One address is one browser: whoever signed in there last is who it is for now.
    db.insert(schema.pushSubscriptions)
      .values({ id: generateSnowflake(), endpoint, createdAt: now, ...fields })
      .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: fields })
      .run();

    const owned = db.select({ count: sql<number>`count(*)` }).from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, request.userId)).get()?.count ?? 0;
    if (owned > PUSH_LIMITS.DEVICES_MAX) {
      const oldest = db.select({ id: schema.pushSubscriptions.id }).from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.userId, request.userId))
        .orderBy(asc(schema.pushSubscriptions.createdAt))
        .limit(owned - PUSH_LIMITS.DEVICES_MAX)
        .all();
      for (const row of oldest) db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, row.id)).run();
    }
    return reply.code(201).send({ success: true });
  });

  // DELETE /api/push/subscriptions - This device wants no more of them
  app.delete<{ Body: { endpoint?: unknown } }>('/api/push/subscriptions', { preHandler: authenticate }, async (request, reply) => {
    const endpoint = request.body?.endpoint;
    if (typeof endpoint !== 'string') return sendError(reply, 400, 'validation_failed', { field: 'endpoint' });
    getDb().delete(schema.pushSubscriptions)
      .where(and(eq(schema.pushSubscriptions.endpoint, endpoint), eq(schema.pushSubscriptions.userId, request.userId)))
      .run();
    return reply.code(200).send({ success: true });
  });
}
