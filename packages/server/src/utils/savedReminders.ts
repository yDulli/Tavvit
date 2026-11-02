import { dueSavedReminders, markSavedRemindersSent, savedItemOf } from '../routes/saved.js';
import { connectionManager } from '../ws/handler.js';
import { pushBodyOf, pushSavedReminder } from './pushDelivery.js';

const SWEEP_MS = 60_000;
const BATCH = 200;
let sweeper: ReturnType<typeof setInterval> | null = null;

/**
 * Tells people about the saved messages they asked to be reminded of: over the socket and by
 * push. Whether they can still see the message is asked again here: someone who left the space
 * since then hears nothing of it. Either way the reminder has been dealt with and stays quiet.
 */
export function sendDueSavedReminders(now: number = Date.now()): number {
  const due = dueSavedReminders(now, BATCH);
  markSavedRemindersSent(due.map((row) => row.id), now);
  let told = 0;
  for (const row of due) {
    const item = savedItemOf(row);
    if (!item) continue;
    told += 1;
    const { content, attachments } = item.message;
    const isVoice = (attachments ?? []).some((attachment) => Boolean(attachment.voiceWaveform));
    connectionManager.sendToUser(row.userId, {
      type: 'saved_reminder',
      item,
      preview: pushBodyOf(content, attachments?.length ?? 0, { showText: true, locale: null }, isVoice),
    });
    pushSavedReminder(row.userId, item, (id) => connectionManager.isUserFocused(id));
  }
  return told;
}

export function startSavedReminderSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    try {
      sendDueSavedReminders();
    } catch (err) {
      console.error('[saved] reminder sweep failed:', err);
    }
  }, SWEEP_MS);
  sweeper.unref();
}

export function stopSavedReminderSweeper(): void {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}
