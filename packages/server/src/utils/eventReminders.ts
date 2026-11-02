import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { EVENT_REMINDER_BEFORE_MS } from '@backspace/shared/src/events.js';
import { getDb, schema } from '../db/index.js';
import { pushEventReminder } from './pushDelivery.js';
import { connectionManager } from '../ws/handler.js';

const SWEEP_MS = 60_000;
let sweeper: ReturnType<typeof setInterval> | null = null;

/**
 * Those going hear of an event once, shortly before it starts: over the socket and by push.
 * Moving an event's time clears the mark, so they hear of the new one. A server that was
 * down through the moment says nothing afterwards: the condition is that it has not started.
 */
export function sendDueEventReminders(now: number = Date.now()): number {
  const db = getDb();
  const due = db.select().from(schema.spaceEvents).where(and(
    isNull(schema.spaceEvents.reminderSentAt),
    gt(schema.spaceEvents.startsAt, now),
    lte(schema.spaceEvents.startsAt, now + EVENT_REMINDER_BEFORE_MS),
  )).all();
  for (const event of due) {
    db.update(schema.spaceEvents).set({ reminderSentAt: now }).where(eq(schema.spaceEvents.id, event.id)).run();
    const going = db.select({ userId: schema.spaceEventRsvps.userId }).from(schema.spaceEventRsvps)
      .where(eq(schema.spaceEventRsvps.eventId, event.id)).all().map((row) => row.userId);
    for (const userId of going) {
      connectionManager.sendToUser(userId, {
        type: 'event_reminder',
        eventId: event.id,
        spaceId: event.spaceId,
        title: event.title,
        startsAt: event.startsAt,
      });
    }
    pushEventReminder(event, going, (id) => connectionManager.isUserFocused(id));
  }
  return due.length;
}

export function startEventReminderSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    try {
      sendDueEventReminders();
    } catch (err) {
      console.error('[events] reminder sweep failed:', err);
    }
  }, SWEEP_MS);
  sweeper.unref();
}

export function stopEventReminderSweeper(): void {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}
