import { eq } from 'drizzle-orm';
import { getDb, getRawDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { markDirectoryDirty } from '../directory/state.js';
import { sanitizeUser } from './sanitize.js';
import { spaceToWire } from './spaceWire.js';
import { collectProfileBroadcastTargetIds } from './userDeletion.js';
import { openReviewCounts, type ReviewStep } from './spaceReview.js';

// Who hears of a platform decision (docs/systems/admin.md): the space's owner
// of a step in one of its reviews, the instance's admins of the queue's size,
// a space's members of a badge it gained or lost, and the people who see a
// person of that person's badges.

/** The admins' count of open requests, after anything that may have changed it. */
export function announceReviewQueue(): void {
  connectionManager.sendToAdmins({ type: 'review_queue_count', ...openReviewCounts() });
}

/** Everyone in the space sees its badges as they are now. */
export function announceSpaceUpdate(spaceId: string): void {
  const row = getDb().select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!row) return;
  connectionManager.sendToSpace(spaceId, { type: 'space_updated', space: spaceToWire(row) });
}

/**
 * A step in one of a space's reviews: the owner is told (their status
 * message), the admins' queue count follows, a verification that started or
 * ended shows on the space at once, and a listing that changed reaches the
 * directory's next ping.
 */
export function announceReviewStep(
  space: { id: string; name: string; ownerId: string; directoryListed: number },
  step: ReviewStep,
  options: { spaceUpdate?: boolean } = {},
): void {
  connectionManager.sendToUser(space.ownerId, {
    type: 'space_review_updated',
    spaceId: space.id,
    spaceName: space.name,
    process: step.process,
    action: step.action,
    status: step.status,
    note: step.note,
  });
  announceReviewQueue();
  // A caller that broadcasts the space itself (the PATCH route) says so.
  if (step.process === 'verification' && options.spaceUpdate !== false) announceSpaceUpdate(space.id);
  if (step.process === 'discovery' && space.directoryListed === 1) markDirectoryDirty(getRawDb());
}

/** A person's badges changed: they and everyone who sees them get the account as it is now. */
export function announceUserUpdate(userId: string): void {
  const row = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!row) return;
  // The account's own fields (its activity switch, its federation state, when
  // its status ends) go to the account alone.
  const own = sanitizeUser(row, true);
  const publicView = sanitizeUser(row);
  const targets = collectProfileBroadcastTargetIds(userId);
  targets.add(userId);
  for (const uid of targets) {
    connectionManager.sendToUser(uid, { type: 'user_updated', user: uid === userId ? own : publicView });
  }
}
