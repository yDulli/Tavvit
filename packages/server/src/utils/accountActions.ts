import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { recordPlatformAudit } from './platformAudit.js';
import { endOtherSessions } from './sessions.js';

type UserRow = typeof schema.users.$inferSelect;

/**
 * Suspend an account: its sessions end now, nothing of it is deleted. One way
 * in for every decision that leads here (an admin on the account's page, a
 * report), so each ends the sessions and writes the audit entry alike.
 * The caller has checked who may be suspended and for how long.
 */
export function applySuspension(
  target: Pick<UserRow, 'id' | 'username'>,
  actorId: string,
  reason: string,
  hours: number | null,
  now: number = Date.now(),
): number | null {
  const until = hours === null ? null : now + hours * 60 * 60 * 1000;
  getDb().update(schema.users)
    .set({ suspendedAt: now, suspendedUntil: until, suspensionReason: reason })
    .where(eq(schema.users.id, target.id)).run();
  // The rows go too: a token taken before the suspension must not work again when it ends.
  endOtherSessions(target.id, null);
  connectionManager.forceDisconnectUser(target.id, { reason: 'Account suspended', endPresence: true });
  recordPlatformAudit({
    actorId,
    action: 'user_suspend',
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.username,
    reason,
    details: { until, durationHours: hours },
  }, now);
  return until;
}
