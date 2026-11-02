import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  canRequestVerification,
  canWithdrawDiscovery,
  canWithdrawVerification,
} from '@backspace/shared/src/platform.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import {
  discoveryStatusOf,
  externalPicture,
  isReviewRefusal,
  listableSpace,
  parseDiscoveryCategory,
  parseVerificationRequest,
  reviewStateOf,
  submitDiscovery,
  submitVerification,
  verificationStatusOf,
  withdrawDiscovery,
  withdrawVerification,
  type ReviewRefusal,
} from '../utils/spaceReview.js';
import { announceReviewStep } from '../utils/reviewNotify.js';

// A space owner's side of the platform's reviews (docs/systems/admin.md,
// "Verification" and "Discovery approval"): asking, asking again, taking a
// request back, and reading where both stand. Only the space's owner, by
// `spaces.owner_id` on this instance, may ask: no role, owner group or
// permission bit stands in for owning the space. An instance admin may read
// the state; deciding is in routes/platformAdmin.ts.

type SpaceRow = typeof schema.spaces.$inferSelect;

/** Requests per owner account: enough to correct a request, not to flood the queue. */
const submitLimit = createFixedWindowLimit({ max: 10, windowMs: 60 * 60 * 1000 });

/** Tests reset the per-account budget between cases. */
export function _resetReviewSubmitLimit(): void {
  submitLimit.reset();
}

function refuse(reply: FastifyReply, refusal: ReviewRefusal): FastifyReply {
  return sendError(reply, refusal.status, refusal.code, refusal.details);
}

function spaceOf(id: string): SpaceRow | undefined {
  return getDb().select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
}

function isInstanceAdmin(userId: string): boolean {
  const row = getDb().select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return row?.isAdmin === 1;
}

export async function spaceReviewRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/spaces/:id/review — both reviews with their history: the owner's
  // status messages, and what an admin reads beside the queue.
  app.get<{ Params: { id: string } }>('/api/spaces/:id/review', { preHandler: authenticate }, async (request, reply) => {
    const space = spaceOf(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (space.ownerId !== request.userId && !isInstanceAdmin(request.userId)) {
      return sendError(reply, 403, 'space_owner_only');
    }
    return reply.code(200).send(reviewStateOf(space));
  });

  // PUT /api/spaces/:id/verification — ask for verification, or ask again.
  app.put<{ Params: { id: string }; Body: unknown }>('/api/spaces/:id/verification', { preHandler: authenticate }, async (request, reply) => {
    const space = spaceOf(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (space.ownerId !== request.userId) return sendError(reply, 403, 'space_owner_only');
    if (!canRequestVerification(verificationStatusOf(space))) return sendError(reply, 409, 'review_already_verified');
    const parsed = parseVerificationRequest(request.body);
    if (!parsed.ok) return refuse(reply, parsed.refusal);
    if (!submitLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const step = submitVerification(space, request.userId, parsed.value);
    announceReviewStep(space, step);
    return reply.code(200).send(reviewStateOf(spaceOf(space.id) ?? space));
  });

  // DELETE /api/spaces/:id/verification — take an open request back.
  app.delete<{ Params: { id: string } }>('/api/spaces/:id/verification', { preHandler: authenticate }, async (request, reply) => {
    const space = spaceOf(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (space.ownerId !== request.userId) return sendError(reply, 403, 'space_owner_only');
    if (!canWithdrawVerification(verificationStatusOf(space))) return sendError(reply, 409, 'review_status_conflict');

    const step = withdrawVerification(space, request.userId);
    announceReviewStep(space, step);
    return reply.code(200).send(reviewStateOf(spaceOf(space.id) ?? space));
  });

  // PUT /api/spaces/:id/discovery — ask for a Discovery listing, or ask again.
  // The listing shows the space's name, description, pictures and member
  // count; the request adds its category. It waits for an admin, hidden.
  app.put<{ Params: { id: string }; Body: unknown }>('/api/spaces/:id/discovery', { preHandler: authenticate }, async (request, reply) => {
    const space = spaceOf(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (space.ownerId !== request.userId) return sendError(reply, 403, 'space_owner_only');
    if (!listableSpace(space)) return sendError(reply, 409, 'discovery_requires_listable_visibility');
    if (!space.description || space.description.trim().length === 0) return sendError(reply, 409, 'discovery_requires_description');
    // A listing shows pictures this instance serves; another site's could change unseen.
    if (externalPicture(space.icon) || externalPicture(space.banner)) return sendError(reply, 409, 'discovery_requires_uploaded_pictures');
    const category = parseDiscoveryCategory(request.body);
    if (isReviewRefusal(category)) return refuse(reply, category);
    if (!submitLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const step = submitDiscovery(space, request.userId, category);
    announceReviewStep(space, step);
    return reply.code(200).send(reviewStateOf(spaceOf(space.id) ?? space));
  });

  // DELETE /api/spaces/:id/discovery — take a request or a listing back.
  app.delete<{ Params: { id: string } }>('/api/spaces/:id/discovery', { preHandler: authenticate }, async (request, reply) => {
    const space = spaceOf(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (space.ownerId !== request.userId) return sendError(reply, 403, 'space_owner_only');
    if (!canWithdrawDiscovery(discoveryStatusOf(space))) return sendError(reply, 409, 'review_status_conflict');

    const step = withdrawDiscovery(space, request.userId);
    announceReviewStep(space, step);
    return reply.code(200).send(reviewStateOf(spaceOf(space.id) ?? space));
  });
}
