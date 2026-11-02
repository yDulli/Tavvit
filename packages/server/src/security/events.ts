/**
 * What happened to an account's security, for its owner to read (docs/systems/auth.md,
 * "Security activity"). Device and address as a session has them, cut short; no location.
 * Bounded twice: by age and per account, so that strangers failing to sign in cannot fill it.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { SecurityEventInfo, SecurityEventKind } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { describeClient, maskAddress } from '../utils/sessions.js';

const DAY = 24 * 60 * 60_000;
const KEPT_FOR_MS = 90 * DAY;
const KEPT_PER_ACCOUNT = 200;
const SHOWN = 50;
/** Failures from one place inside this window are one line with a count. */
const COALESCE_MS = 15 * 60_000;

const DEVICES_KEPT_PER_ACCOUNT = 20;
const DEVICE_KEPT_FOR_MS = 180 * DAY;

interface EventSource {
  headers: { 'user-agent'?: string };
  ip?: string;
}

export function recordSecurityEvent(userId: string, kind: SecurityEventKind, source: EventSource | null = null, now: number = Date.now()): void {
  const db = getDb();
  const clientLabel = source ? describeClient(source.headers['user-agent']) : null;
  const addressHint = source ? maskAddress(source.ip) : null;
  db.transaction(() => {
    if (kind === 'login_failed' || kind === 'mfa_failed') {
      const last = db.select().from(schema.securityEvents)
        .where(and(eq(schema.securityEvents.userId, userId), eq(schema.securityEvents.kind, kind), sql`${schema.securityEvents.createdAt} > ${now - COALESCE_MS}`))
        .orderBy(desc(schema.securityEvents.createdAt)).limit(1).get();
      if (last && last.addressHint === addressHint) {
        db.update(schema.securityEvents).set({ count: last.count + 1, createdAt: now }).where(eq(schema.securityEvents.id, last.id)).run();
        return;
      }
    }
    db.insert(schema.securityEvents).values({ id: randomUUID(), userId, kind, clientLabel, addressHint, count: 1, createdAt: now }).run();
    db.run(sql`DELETE FROM security_events WHERE user_id = ${userId} AND id NOT IN (
      SELECT id FROM security_events WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${KEPT_PER_ACCOUNT})`);
  });
}

export function listSecurityEvents(userId: string, limit: number = SHOWN): SecurityEventInfo[] {
  return getDb().select().from(schema.securityEvents).where(eq(schema.securityEvents.userId, userId))
    .orderBy(desc(schema.securityEvents.createdAt)).limit(limit).all()
    .map((row) => ({
      id: row.id,
      kind: row.kind as SecurityEventKind,
      clientLabel: row.clientLabel,
      addressHint: row.addressHint,
      count: row.count,
      createdAt: row.createdAt,
    }));
}

/** How many failures of this kind this account had lately, from anywhere. */
export function recentFailures(userId: string, kind: 'login_failed' | 'mfa_failed', now: number = Date.now()): number {
  return getDb().select({ total: sql<number>`COALESCE(SUM(${schema.securityEvents.count}), 0)` }).from(schema.securityEvents)
    .where(and(eq(schema.securityEvents.userId, userId), eq(schema.securityEvents.kind, kind), sql`${schema.securityEvents.createdAt} > ${now - COALESCE_MS}`))
    .get()?.total ?? 0;
}

// ─── Devices ───────────────────────────────────────────────────────────────

/** A random id the client keeps, and only its hash with the account here. It identifies a browser for this account and nothing else. */
function deviceHash(userId: string, deviceId: string): string {
  return createHash('sha256').update(`${userId}:${deviceId}`).digest('hex');
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

/**
 * Remembers this device for the account. `first`: the account has no device on record, as
 * with everyone after the update, so there is nothing to compare with. `new`: there are others,
 * and this is not one of them; a request with no id counts, or leaving it out would hide a sign-in.
 */
export function noteDevice(userId: string, deviceId: string | null, now: number = Date.now()): 'known' | 'new' | 'first' {
  const db = getDb();
  return db.transaction(() => {
    const devices = db.select().from(schema.knownDevices).where(eq(schema.knownDevices.userId, userId)).all();
    if (!deviceId) return devices.length === 0 ? 'first' : 'new';
    const hash = deviceHash(userId, deviceId);
    if (devices.some((device) => device.deviceHash === hash)) {
      db.update(schema.knownDevices).set({ lastSeenAt: now }).where(and(eq(schema.knownDevices.userId, userId), eq(schema.knownDevices.deviceHash, hash))).run();
      return 'known';
    }
    db.insert(schema.knownDevices).values({ userId, deviceHash: hash, firstSeenAt: now, lastSeenAt: now }).run();
    if (devices.length >= DEVICES_KEPT_PER_ACCOUNT) {
      const oldest = [...devices].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0]!;
      db.delete(schema.knownDevices).where(and(eq(schema.knownDevices.userId, userId), eq(schema.knownDevices.deviceHash, oldest.deviceHash))).run();
    }
    return devices.length === 0 ? 'first' : 'new';
  });
}

export function sweepSecurityRecords(now: number = Date.now()): void {
  const db = getDb();
  db.delete(schema.securityEvents).where(lt(schema.securityEvents.createdAt, now - KEPT_FOR_MS)).run();
  db.delete(schema.knownDevices).where(lt(schema.knownDevices.lastSeenAt, now - DEVICE_KEPT_FOR_MS)).run();
  db.delete(schema.mfaTickets).where(lt(schema.mfaTickets.expiresAt, now)).run();
}

let sweeper: ReturnType<typeof setInterval> | null = null;

export function startSecuritySweeper(): void {
  if (sweeper) return;
  sweepSecurityRecords();
  sweeper = setInterval(() => {
    try {
      sweepSecurityRecords();
    } catch (error) {
      console.error('[security] sweep failed:', error instanceof Error ? error.name : 'unknown error');
    }
  }, 60 * 60_000);
  sweeper.unref();
}

export function stopSecuritySweeper(): void {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}
