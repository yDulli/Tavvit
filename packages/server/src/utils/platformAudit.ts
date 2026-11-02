import type { PeerTrustChange } from '@backspace/shared/src/platform.js';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  PlatformActor,
  PlatformAuditAction,
  PlatformAuditEntry,
  PlatformAuditResponse,
  PlatformAuditTargetType,
  PlatformAuditValue,
} from '@backspace/shared/src/platform.js';
import { getDb, schema } from '../db/index.js';
import { generateSnowflake } from './snowflake.js';

// The platform audit log (docs/systems/admin.md, "Platform audit log"): what
// the instance's administrators did to accounts, spaces and the instance.
// Unlike a space's audit log it has no retention window: these are the
// records an admin team answers for, and there are few of them.

export interface PlatformAuditRecord {
  actorId: string;
  action: PlatformAuditAction;
  targetType: PlatformAuditTargetType;
  targetId: string;
  targetLabel?: string | null;
  reason?: string | null;
  details?: Record<string, PlatformAuditValue> | null;
}

/**
 * Add an entry. Never throws: the action it records has already been taken,
 * so a failure here is logged and the request goes on.
 */
/** An administrator changed what this instance trusts of another one. */
export function recordPeerTrust(actorId: string, peer: { id: string; origin: string }, change: PeerTrustChange): void {
  recordPlatformAudit({ actorId, action: 'peer_trust', targetType: 'instance', targetId: peer.id, targetLabel: peer.origin, details: { change } });
}

export function recordPlatformAudit(record: PlatformAuditRecord, now: number = Date.now()): void {
  try {
    getDb().insert(schema.platformAuditLog).values({
      id: generateSnowflake(),
      actorId: record.actorId,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      targetLabel: record.targetLabel ?? null,
      reason: record.reason ?? null,
      details: record.details && Object.keys(record.details).length > 0 ? JSON.stringify(record.details) : null,
      createdAt: now,
    }).run();
  } catch (err) {
    console.error(`[platform-audit] could not record ${record.action} on ${record.targetType} ${record.targetId}:`, err);
  }
}

/** The people `ids` name, as the admin area shows them; an id without a row is left out. */
export function platformActors(ids: Iterable<string>): Map<string, PlatformActor> {
  const wanted = [...new Set(ids)];
  const actors = new Map<string, PlatformActor>();
  if (wanted.length === 0) return actors;
  const rows = getDb().select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, isDeleted: schema.users.isDeleted })
    .from(schema.users).where(inArray(schema.users.id, wanted)).all();
  for (const row of rows) if (row.isDeleted !== 1) actors.set(row.id, { id: row.id, username: row.username, displayName: row.displayName });
  return actors;
}

function parseDetails(stored: string | null): Record<string, PlatformAuditValue> | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, PlatformAuditValue>
      : null;
  } catch {
    return null;
  }
}

function isTargetType(value: string): value is PlatformAuditTargetType {
  return value === 'user' || value === 'space' || value === 'instance';
}

export interface PlatformAuditQuery {
  /** Entries older than this id. */
  before?: string;
  limit: number;
  targetType?: PlatformAuditTargetType;
  targetId?: string;
  action?: string;
}

/** A page of the log, newest first; ids are snowflakes, compared as numbers like the paging index. */
export function readPlatformAudit(query: PlatformAuditQuery): PlatformAuditResponse {
  const conditions: SQL[] = [];
  if (query.before !== undefined) {
    conditions.push(sql`CAST(${schema.platformAuditLog.id} AS INTEGER) < CAST(${query.before} AS INTEGER)`);
  }
  if (query.targetType !== undefined) conditions.push(eq(schema.platformAuditLog.targetType, query.targetType));
  if (query.targetId !== undefined) conditions.push(eq(schema.platformAuditLog.targetId, query.targetId));
  if (query.action !== undefined) conditions.push(eq(schema.platformAuditLog.action, query.action));

  const rows = getDb().select().from(schema.platformAuditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`CAST(${schema.platformAuditLog.id} AS INTEGER) DESC`)
    .limit(query.limit + 1)
    .all();
  const page = rows.slice(0, query.limit);
  const actors = platformActors(page.map((row) => row.actorId));
  const entries: PlatformAuditEntry[] = page
    .filter((row) => isTargetType(row.targetType))
    .map((row) => ({
      id: row.id,
      action: row.action,
      actor: actors.get(row.actorId) ?? null,
      targetType: row.targetType as PlatformAuditTargetType,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      reason: row.reason,
      details: parseDetails(row.details),
      createdAt: row.createdAt,
    }));
  return { entries, hasMore: rows.length > query.limit };
}
