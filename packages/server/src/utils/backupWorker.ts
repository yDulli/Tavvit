import { config } from '../config.js';
import { getRawDb } from '../db/index.js';
import { createSnapshot, pruneSnapshots } from './backup.js';
import { clearAlert, raiseAlert } from './operatorAlerts.js';

let timer: ReturnType<typeof setInterval> | null = null;

export function startBackupWorker(): void {
  if (config.backup.disabled) {
    console.log('[backup] scheduled worker disabled via BACKUP_DISABLED');
    return;
  }
  if (timer) return;
  const intervalMs = config.backup.intervalHours * 60 * 60 * 1000;
  timer = setInterval(() => {
    try {
      const snap = createSnapshot(getRawDb(), 'scheduled');
      pruneSnapshots();
      clearAlert('backup_failed');
      console.log(`[backup] scheduled snapshot written: ${snap}`);
    } catch (err) {
      console.error(`[backup] scheduled snapshot failed: ${(err as Error).message}`);
      raiseAlert('backup_failed', (err as Error).message);
    }
  }, intervalMs);
  // Do not keep the event loop alive solely for backups.
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[backup] scheduled worker started (every ${config.backup.intervalHours}h)`);
}

export function stopBackupWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
