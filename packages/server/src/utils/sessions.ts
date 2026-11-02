/**
 * Sessions: one row per signed-in device (docs/systems/auth.md, "Sessions").
 *
 * The token stays a bearer JWT, and it names its row (`sid`). Deleting the row is
 * what ending a session means: the next request is refused, and the socket closes.
 * A token with no `sid`, from before this existed, opens nothing (`verifyAccessToken`).
 */
import crypto from 'node:crypto';
import net from 'node:net';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import type { SessionInfo } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';

type Db = ReturnType<typeof getDb>;

/** How often "last active" is written: a request is common, a device's activity needs no second-by-second record. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** A browser and a system, from a User-Agent. Nothing else of it is kept. */
export function describeClient(userAgent: string | undefined): string | null {
  const ua = userAgent ?? '';
  const app = /Tavvit|Electron/.test(ua) ? 'Tavvit Desktop'
    : /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
              : null;
  const system = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : null;
  return [app, system].filter(Boolean).join(' · ') || null;
}

/** The address cut short: the last part of an IPv4 address, all but the first three groups of an IPv6 one. */
export function maskAddress(address: string | undefined): string | null {
  if (!address) return null;
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (net.isIPv4(plain)) return `${plain.split('.').slice(0, 3).join('.')}.0`;
  if (net.isIPv6(plain)) return `${plain.split('::')[0]!.split(':').slice(0, 3).join(':')}::`;
  return null;
}

interface SessionSource {
  headers: { 'user-agent'?: string };
  ip?: string;
}

/**
 * A new session and the token that names it. `sign` is passed in because it lives
 * with the verifier (utils/auth.ts), which reads this module's rows.
 */
export function openSession(
  user: { id: string; username: string },
  source: SessionSource,
  sign: (payload: { userId: string; username: string; sid: string }) => string,
  now: number = Date.now(),
  db: Db = getDb(),
): { token: string; sessionId: string } {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const token = sign({ userId: user.id, username: user.username, sid: sessionId });
  const { exp } = jwt.decode(token) as { exp: number };
  db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    createdAt: now,
    lastActiveAt: now,
    expiresAt: exp * 1000,
    clientLabel: describeClient(source.headers['user-agent']),
    addressHint: maskAddress(source.ip),
  }).run();
  return { token, sessionId };
}

/** Whether the session is live for this account, and a note that it was used. */
export function useSession(sessionId: string, userId: string, now: number = Date.now(), db: Db = getDb()): boolean {
  const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!row || row.userId !== userId || row.expiresAt <= now) return false;
  if (now - row.lastActiveAt >= TOUCH_INTERVAL_MS) {
    db.update(schema.sessions).set({ lastActiveAt: now }).where(eq(schema.sessions.id, sessionId)).run();
  }
  return true;
}

/** Which of these sessions are still live, for checking open sockets in one go. */
export function liveSessionIds(sessionIds: readonly string[], now: number = Date.now(), db: Db = getDb()): Set<string> {
  const live = new Set<string>();
  for (let start = 0; start < sessionIds.length; start += 500) {
    for (const row of db.select({ id: schema.sessions.id, expiresAt: schema.sessions.expiresAt }).from(schema.sessions)
      .where(inArray(schema.sessions.id, sessionIds.slice(start, start + 500))).all()) {
      if (row.expiresAt > now) live.add(row.id);
    }
  }
  return live;
}

export function listSessions(userId: string, currentSessionId: string | null, now: number = Date.now(), db: Db = getDb()): SessionInfo[] {
  return db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)).all()
    .filter((row) => row.expiresAt > now)
    .map((row) => ({
      id: row.id,
      current: row.id === currentSessionId,
      clientLabel: row.clientLabel,
      addressHint: row.addressHint,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt);
}

/** Ends one of this account's sessions. False when it has none by that id. */
export function endSession(userId: string, sessionId: string, db: Db = getDb()): boolean {
  return db.delete(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId))).run().changes === 1;
}

/** Ends every session of this account but one, and says which ended. */
export function endOtherSessions(userId: string, keepSessionId: string | null, db: Db = getDb()): string[] {
  const where = keepSessionId === null
    ? eq(schema.sessions.userId, userId)
    : and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, keepSessionId));
  const ended = db.select({ id: schema.sessions.id }).from(schema.sessions).where(where).all().map((row) => row.id);
  db.delete(schema.sessions).where(where).run();
  return ended;
}

export function purgeExpiredSessions(now: number = Date.now(), db: Db = getDb()): void {
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).run();
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSessionSweeper(): void {
  if (timer) return;
  purgeExpiredSessions();
  timer = setInterval(() => {
    try {
      purgeExpiredSessions();
    } catch (error) {
      console.error('[sessions] sweep failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref();
}

export function stopSessionSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
