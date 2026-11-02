import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { OperatorAlert, OperatorAlertCause } from '@backspace/shared/src/adminConsole.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { emailEnabled, enqueueEmail } from '../email/service.js';
import { isMailLocale, type EmailKind } from '../email/copy.js';
import { listSnapshots, setOffsiteListener } from './backup.js';

/**
 * What the operator of an instance has to hear about before anyone else notices
 * (docs/systems/operations.md, "Warnings"). Looked at every five minutes, and shown in the admin
 * console for as long as it holds. It reaches the administrators' mail at most once a day for each
 * cause, so that a disk that stays full does not become a flood of its own.
 */

const CHECK_EVERY_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
/** So many starts within the window is no update: something keeps it from staying up. */
const STARTS_IN_A_LOOP = 4;
const LOOP_WINDOW_MS = 15 * 60_000;
const STARTS_KEPT = 20;
/** A scheduled backup may be this many intervals behind before it counts as missing. */
const INTERVALS_LATE = 2;
/** How long a copy off this machine may be away, for someone whose cron runs once a night. */
const OFFSITE_DAYS_LATE = 3;
/** Where `backup.sh --to` leaves word of how its copy went, since it runs outside this process. */
export const OFFSITE_STATUS_FILE = 'offsite-status.json';

const MAIL_KIND: Record<OperatorAlertCause, EmailKind> = {
  disk_high: 'operator_disk_high',
  backup_failed: 'operator_backup_failed',
  backup_old: 'operator_backup_old',
  offsite_failed: 'operator_offsite_failed',
  restart_loop: 'operator_restart_loop',
};

/** Tells the administrators, unless they were told about this today. */
function mailOnceADay(cause: OperatorAlertCause, detail: string | null, lastMailedAt: number | null, now: number): void {
  if (!emailEnabled()) return;
  if (lastMailedAt !== null && now - lastMailedAt < DAY_MS) return;
  const db = getDb();
  const admins = db.select({ id: schema.users.id, email: schema.users.email, locale: schema.users.locale }).from(schema.users)
    .where(and(eq(schema.users.isAdmin, 1), eq(schema.users.isDeleted, 0), eq(schema.users.accountKind, 'person'), isNotNull(schema.users.email), isNotNull(schema.users.emailVerifiedAt)))
    .all();
  let told = false;
  for (const admin of admins) {
    if (!admin.email) continue;
    const decision = enqueueEmail({
      kind: MAIL_KIND[cause],
      userId: admin.id,
      to: admin.email,
      locale: isMailLocale(admin.locale) ? admin.locale : 'en',
      params: { detail: detail ?? '' },
    }, now);
    if (decision === 'ok') told = true;
  }
  if (told) db.update(schema.operatorAlerts).set({ lastMailedAt: now }).where(eq(schema.operatorAlerts.cause, cause)).run();
}

/** This holds now. Nothing here may stop what found out: the database may be what is failing. */
export function raiseAlert(cause: OperatorAlertCause, detail: string | null, now: number = Date.now()): void {
  try {
    const db = getDb();
    const row = db.select().from(schema.operatorAlerts).where(eq(schema.operatorAlerts.cause, cause)).get();
    db.insert(schema.operatorAlerts)
      .values({ cause, active: 1, detail, since: now, lastMailedAt: null })
      .onConflictDoUpdate({
        target: schema.operatorAlerts.cause,
        set: { active: 1, detail, since: row?.active === 1 ? row.since : now },
      })
      .run();
    mailOnceADay(cause, detail, row?.lastMailedAt ?? null, now);
  } catch (err) {
    console.error(`[alerts] Could not note ${cause}: ${(err as Error).message}`);
  }
}

/** This no longer holds. The day's mail stays counted, so that something flapping tells once. */
export function clearAlert(cause: OperatorAlertCause): void {
  try {
    getDb().update(schema.operatorAlerts).set({ active: 0 }).where(eq(schema.operatorAlerts.cause, cause)).run();
  } catch (err) {
    console.error(`[alerts] Could not clear ${cause}: ${(err as Error).message}`);
  }
}

export function activeAlerts(): OperatorAlert[] {
  return getDb().select().from(schema.operatorAlerts).where(eq(schema.operatorAlerts.active, 1)).all()
    .map((row) => ({ cause: row.cause as OperatorAlertCause, detail: row.detail, since: row.since }));
}

function checkDisk(now: number): void {
  let usedPercent: number;
  try {
    const stats = fs.statfsSync(path.dirname(config.dbPath));
    if (stats.blocks === 0) return;
    usedPercent = Math.round(((stats.blocks - stats.bavail) / stats.blocks) * 100);
  } catch {
    return;
  }
  if (usedPercent >= config.alerts.diskPercent) raiseAlert('disk_high', String(usedPercent), now);
  else clearAlert('disk_high');
}

function checkBackupAge(now: number): void {
  if (config.backup.disabled || config.backup.intervalHours <= 0) {
    clearAlert('backup_old');
    return;
  }
  const allowedMs = config.backup.intervalHours * HOUR_MS * INTERVALS_LATE;
  const installed = getDb().select({ installedAt: schema.instanceSettings.installedAt }).from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get()?.installedAt ?? now;
  // Any copy will do, and an instance younger than that has had no time for one.
  const newest = listSnapshots()[0]?.mtimeMs ?? installed;
  if (now - newest > allowedMs) raiseAlert('backup_old', String(Math.round((now - newest) / HOUR_MS)), now);
  else clearAlert('backup_old');
}

/** How `backup.sh --to` last went. It writes nothing for someone who does not use it. */
function checkOffsiteCopy(now: number): void {
  let status: { ok?: unknown; at?: unknown; reason?: unknown };
  try {
    status = JSON.parse(fs.readFileSync(path.join(config.backup.dir, OFFSITE_STATUS_FILE), 'utf8')) as typeof status;
  } catch {
    return;
  }
  if (status.ok !== true) {
    raiseAlert('offsite_failed', typeof status.reason === 'string' ? status.reason : null, now);
  } else if (typeof status.at === 'number' && now - status.at > OFFSITE_DAYS_LATE * DAY_MS) {
    raiseAlert('offsite_failed', `The last copy is ${Math.round((now - status.at) / DAY_MS)} days old.`, now);
  } else {
    clearAlert('offsite_failed');
  }
}

function checkRestarts(now: number): void {
  const row = getDb().select({ recentStarts: schema.instanceSettings.recentStarts }).from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
  const starts = parseStarts(row?.recentStarts).filter((at) => now - at <= LOOP_WINDOW_MS);
  if (starts.length >= STARTS_IN_A_LOOP) raiseAlert('restart_loop', String(starts.length), now);
  else clearAlert('restart_loop');
}

function parseStarts(stored: string | null | undefined): number[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((at): at is number => typeof at === 'number') : [];
  } catch {
    return [];
  }
}

/** Kept in the database, since the process that crashed remembers nothing. */
export function recordServerStart(now: number = Date.now()): void {
  const db = getDb();
  const row = db.select({ recentStarts: schema.instanceSettings.recentStarts }).from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
  const starts = [...parseStarts(row?.recentStarts), now].slice(-STARTS_KEPT);
  db.update(schema.instanceSettings).set({ recentStarts: JSON.stringify(starts) }).where(eq(schema.instanceSettings.id, 1)).run();
}

export function checkOperatorAlerts(now: number = Date.now()): void {
  try {
    checkDisk(now);
    checkBackupAge(now);
    checkOffsiteCopy(now);
    checkRestarts(now);
  } catch (err) {
    console.error(`[alerts] The check failed: ${(err as Error).message}`);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startOperatorAlerts(): void {
  if (timer) return;
  setOffsiteListener((failure) => {
    if (failure) raiseAlert('offsite_failed', failure);
    else clearAlert('offsite_failed');
  });
  recordServerStart();
  checkOperatorAlerts();
  timer = setInterval(() => checkOperatorAlerts(), CHECK_EVERY_MS);
  timer.unref();
}

export function stopOperatorAlerts(): void {
  if (timer) clearInterval(timer);
  timer = null;
  setOffsiteListener(null);
}
