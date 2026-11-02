/**
 * Custom statuses that clear themselves.
 *
 * A person can set their status to last "30 minutes", "4 hours", "today"... The
 * server stores the moment it ends (`users.custom_status_expires_at`), and this
 * sweeper clears it then and tells the people who can see it. It runs once a
 * minute and once at boot, so a status that ended while the server was down is
 * gone as soon as it is back.
 *
 * The clock is the server's. The client sends a duration, never a time, so a
 * wrong clock on someone's phone cannot make a status last forever or vanish.
 */
import { and, isNotNull, lte, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { sanitizeUser } from './sanitize.js';
import { collectProfileBroadcastTargetIds } from './userDeletion.js';

export const SWEEP_INTERVAL_MS = 60_000;
export const MAX_CUSTOM_STATUS_MINUTES = 7 * 24 * 60;

/** A duration in minutes the API accepts: a whole number from 1 minute to 7 days. */
export function isValidExpiryMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_CUSTOM_STATUS_MINUTES;
}

/** Clears every status that has ended by `now`. Returns the ids of the people it cleared. */
export function clearExpiredCustomStatuses(now = Date.now()): string[] {
  const db = getDb();
  const due = db.select({ id: schema.users.id })
    .from(schema.users)
    .where(and(isNotNull(schema.users.customStatusExpiresAt), lte(schema.users.customStatusExpiresAt, now)))
    .all();

  const cleared: string[] = [];
  for (const { id } of due) {
    // Checked again in the update itself: the person may have saved a new status
    // between the select and here, and that one must stay.
    const result = db.update(schema.users)
      .set({ customStatus: null, customStatusExpiresAt: null })
      .where(and(eq(schema.users.id, id), isNotNull(schema.users.customStatusExpiresAt), lte(schema.users.customStatusExpiresAt, now)))
      .run();
    if (result.changes === 0) continue;
    cleared.push(id);

    const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!row) continue;
    const forOthers = sanitizeUser(row);
    const forSelf = sanitizeUser(row, true);
    const targets = collectProfileBroadcastTargetIds(id);
    targets.delete(id);
    for (const uid of targets) connectionManager.sendToUser(uid, { type: 'user_updated', user: forOthers });
    connectionManager.sendToUser(id, { type: 'user_updated', user: forSelf });
  }
  return cleared;
}

let timer: ReturnType<typeof setInterval> | null = null;

function sweepAndReport(): void {
  try {
    clearExpiredCustomStatuses();
  } catch (error) {
    // A failed sweep is retried a minute later; say so once per failure.
    console.error('[custom-status] could not clear ended statuses:', error);
  }
}

export function startCustomStatusSweeper(): void {
  if (timer) return;
  sweepAndReport();
  timer = setInterval(sweepAndReport, SWEEP_INTERVAL_MS);
  // The timer must never keep the process alive on its own.
  timer.unref();
}

export function stopCustomStatusSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
