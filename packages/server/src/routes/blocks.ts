import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { BlockedUser } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { addBlock, listBlockedIds, listBlocks, removeBlock } from '../utils/blocks.js';
import { connectionManager } from '../ws/handler.js';

/**
 * The people the signed-in user has blocked. See utils/blocks.ts for what a
 * block does. The blocked person is never told: nothing here sends them anything
 * beyond the ordinary "friend removed" / "request declined" an unfriending would.
 */
export async function blockRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users/@me/blocks - who I have blocked
  app.get('/api/users/@me/blocks', { preHandler: authenticate }, async (request, reply) => {
    return reply.code(200).send({ blocks: listBlocks(request.userId) });
  });

  // PUT /api/users/@me/blocks/:userId - block someone (idempotent)
  app.put<{ Params: { userId: string } }>('/api/users/@me/blocks/:userId', { preHandler: authenticate }, async (request, reply) => {
    const { userId } = request.params;
    if (userId === request.userId) return sendError(reply, 400, 'cannot_block_self');

    const db = getDb();
    const target = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!target || target.isDeleted === 1) return sendError(reply, 404, 'user_not_found');

    const result = addBlock(request.userId, userId, db);

    // The other person's friend list and request lists follow, exactly as they
    // would after an unfriending or a declined request; nothing says "blocked".
    if (result.removedFriendship) {
      connectionManager.sendToUser(userId, { type: 'friend_removed', userId: request.userId });
      connectionManager.sendToUser(request.userId, { type: 'friend_removed', userId });
    }
    for (const withdrawn of result.removedRequests) {
      if (withdrawn.fromId === userId) {
        connectionManager.sendToUser(userId, { type: 'friend_request_declined', requestId: withdrawn.id, userId: request.userId });
        connectionManager.sendToUser(request.userId, { type: 'friend_request_declined', requestId: withdrawn.id, userId });
      } else {
        connectionManager.sendToUser(userId, { type: 'friend_request_cancelled', requestId: withdrawn.id, userId: request.userId });
        connectionManager.sendToUser(request.userId, { type: 'friend_request_cancelled', requestId: withdrawn.id, userId });
      }
    }
    connectionManager.sendToUser(request.userId, { type: 'blocks_updated', blockedUserIds: listBlockedIds(request.userId, db) });

    const entry: BlockedUser = {
      user: sanitizeUser(target),
      blockedAt: listBlocks(request.userId, db).find((b) => b.user.id === userId)?.blockedAt ?? Date.now(),
    };
    return reply.code(result.created ? 201 : 200).send(entry);
  });

  // DELETE /api/users/@me/blocks/:userId - unblock (idempotent)
  app.delete<{ Params: { userId: string } }>('/api/users/@me/blocks/:userId', { preHandler: authenticate }, async (request, reply) => {
    const { userId } = request.params;
    const removed = removeBlock(request.userId, userId);
    if (removed) {
      connectionManager.sendToUser(request.userId, { type: 'blocks_updated', blockedUserIds: listBlockedIds(request.userId) });
    }
    return reply.code(200).send({ success: true });
  });
}
