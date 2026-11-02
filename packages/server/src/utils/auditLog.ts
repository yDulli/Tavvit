import { and, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import {
  isAuditLogAction,
  type AuditLogAction,
  type AuditLogChange,
  type AuditLogEntry,
  type AuditLogResponse,
  type AuditLogTargetType,
  type AuditLogValue,
} from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { dmSystemName } from './dmSystemMessages.js';
import { sanitizeUser } from './sanitize.js';
import { generateSnowflake } from './snowflake.js';

// A space's audit log (docs/systems/spaces.md, "Audit log"): what was changed,
// by whom, in which space. Stored by the instance that hosts the space and
// read through `GET /api/spaces/:id/audit-log`; never relayed.

/** How long an entry is kept: 180 days. */
export const AUDIT_LOG_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/** How often one space's old entries are swept, at most: once an hour, from `recordAudit`. */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** When each space's entries were last swept (in memory: a restart sweeps again on the next entry). */
const lastSweepAt = new Map<string, number>();

/** Tests only: forget when spaces were last swept. */
export function _resetAuditRetentionSweep(): void {
  lastSweepAt.clear();
}

/** One change to record. `actorId` is the acting user's row id on this instance. */
export interface AuditRecord {
  spaceId: string;
  actorId: string;
  action: AuditLogAction;
  targetType?: AuditLogTargetType | null;
  targetId?: string | null;
  targetLabel?: string | null;
  changes?: AuditLogChange[] | null;
  reason?: string | null;
}

/** Drop `spaceId`'s entries older than the retention, unless that was done within the last hour. */
function sweepExpiredEntries(spaceId: string, now: number): void {
  const last = lastSweepAt.get(spaceId);
  if (last !== undefined && now - last < RETENTION_SWEEP_INTERVAL_MS) return;
  lastSweepAt.set(spaceId, now);
  getDb().delete(schema.spaceAuditLog).where(and(
    eq(schema.spaceAuditLog.spaceId, spaceId),
    lt(schema.spaceAuditLog.createdAt, now - AUDIT_LOG_RETENTION_MS),
  )).run();
}

/**
 * Add an entry to a space's audit log. Never throws: the change it records
 * has already been made, so a failure here is logged and the request goes on.
 * An entry with no changes stores `changes` as null.
 */
export function recordAudit(record: AuditRecord, now: number = Date.now()): void {
  try {
    getDb().insert(schema.spaceAuditLog).values({
      id: generateSnowflake(),
      spaceId: record.spaceId,
      actorId: record.actorId,
      action: record.action,
      targetType: record.targetType ?? null,
      targetId: record.targetId ?? null,
      targetLabel: record.targetLabel ?? null,
      changes: record.changes && record.changes.length > 0 ? JSON.stringify(record.changes) : null,
      reason: record.reason ?? null,
      createdAt: now,
    }).run();
    sweepExpiredEntries(record.spaceId, now);
  } catch (err) {
    console.error(`[audit] could not record ${record.action} in space ${record.spaceId}:`, err);
  }
}

/** One field as it changed: added (`from` undefined), removed (`to` undefined) or changed. */
export function auditChange(key: string, from: AuditLogValue | undefined, to: AuditLogValue | undefined): AuditLogChange {
  const entry: AuditLogChange = { key };
  if (from !== undefined) entry.from = from;
  if (to !== undefined) entry.to = to;
  return entry;
}

/** The fields of something created, each as added (no `from`). */
export function addedFields(after: Readonly<Record<string, AuditLogValue>>): AuditLogChange[] {
  return Object.entries(after).map(([key, to]) => ({ key, to }));
}

/** The fields of something deleted, each as removed (no `to`). */
export function removedFields(before: Readonly<Record<string, AuditLogValue>>): AuditLogChange[] {
  return Object.entries(before).map(([key, from]) => ({ key, from }));
}

/** The fields of `after` whose value differs from `before`, each as a change from the old value to the new. */
export function changedFields(
  before: Readonly<Record<string, AuditLogValue>>,
  after: Readonly<Record<string, AuditLogValue>>,
): AuditLogChange[] {
  const changes: AuditLogChange[] = [];
  for (const [key, to] of Object.entries(after)) {
    const from = before[key] ?? null;
    if (from !== to) changes.push({ key, from, to });
  }
  return changes;
}

/**
 * The name to record for a user in a space: their nickname there, else their
 * display name, else their handle without the instance (`dmSystemName`); null
 * for a deleted account or one this instance does not hold. Like
 * `recordAudit`, it never throws: a label it cannot read is null.
 */
export function auditUserLabel(spaceId: string, userId: string): string | null {
  try {
    const db = getDb();
    const user = db.select({ displayName: schema.users.displayName, username: schema.users.username, isDeleted: schema.users.isDeleted })
      .from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user || user.isDeleted === 1) return null;
    const member = db.select({ nickname: schema.spaceMembers.nickname }).from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.spaceMembers.userId, userId))).get();
    return member?.nickname || dmSystemName(user);
  } catch (err) {
    console.error(`[audit] could not read the name of ${userId} in space ${spaceId}:`, err);
    return null;
  }
}

/**
 * The entry for a message someone other than its author deleted
 * (`message_delete`): the author's name as the target, and the channel it was
 * in. The REST route and the WebSocket event both record it this way.
 */
export function recordMessageDeleteAudit(
  spaceId: string,
  actorId: string,
  message: { id: string; channelId: string; userId: string },
): void {
  let channelName: string | null = null;
  try {
    channelName = getDb().select({ name: schema.channels.name }).from(schema.channels)
      .where(eq(schema.channels.id, message.channelId)).get()?.name ?? null;
  } catch (err) {
    console.error(`[audit] could not read channel ${message.channelId}:`, err);
  }
  recordAudit({
    spaceId,
    actorId,
    action: 'message_delete',
    targetType: 'message',
    targetId: message.id,
    targetLabel: auditUserLabel(spaceId, message.userId),
    changes: channelName !== null ? [auditChange('channel', undefined, channelName)] : null,
  });
}

/** A moderator deleting many of a channel's messages at once: how many, in which channel. */
export function recordMessagesBulkDeleteAudit(spaceId: string, actorId: string, channelId: string, count: number): void {
  let channelName: string | null = null;
  try {
    channelName = getDb().select({ name: schema.channels.name }).from(schema.channels)
      .where(eq(schema.channels.id, channelId)).get()?.name ?? null;
  } catch (err) {
    console.error(`[audit] could not read channel ${channelId}:`, err);
  }
  recordAudit({
    spaceId,
    actorId,
    action: 'channel_messages_delete',
    targetType: 'channel',
    targetId: channelId,
    targetLabel: channelName,
    changes: [auditChange('messages', null, String(count))],
  });
}

/** A channel's message being pinned or unpinned, under the channel's name at the time. */
export function recordMessagePinAudit(
  spaceId: string,
  actorId: string,
  message: { id: string; channelId: string; userId: string },
  pinned: boolean,
): void {
  let channelName: string | null = null;
  try {
    channelName = getDb().select({ name: schema.channels.name }).from(schema.channels)
      .where(eq(schema.channels.id, message.channelId)).get()?.name ?? null;
  } catch (err) {
    console.error(`[audit] could not read channel ${message.channelId}:`, err);
  }
  recordAudit({
    spaceId,
    actorId,
    action: pinned ? 'message_pin' : 'message_unpin',
    targetType: 'message',
    targetId: message.id,
    targetLabel: auditUserLabel(spaceId, message.userId),
    changes: channelName !== null ? [auditChange('channel', undefined, channelName)] : null,
  });
}

/**
 * The entry for a change of a member's roles (`member_roles_update`): each
 * role added (`role_added`) or removed (`role_removed`), by its name. Nothing
 * is recorded when neither list holds a role.
 */
export function recordMemberRoleAudit(
  spaceId: string,
  actorId: string,
  targetId: string,
  addedRoleIds: readonly string[],
  removedRoleIds: readonly string[],
): void {
  if (addedRoleIds.length === 0 && removedRoleIds.length === 0) return;
  let names = new Map<string, string>();
  try {
    const rows = getDb().select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles)
      .where(and(eq(schema.roles.spaceId, spaceId), inArray(schema.roles.id, [...addedRoleIds, ...removedRoleIds])))
      .all();
    names = new Map(rows.map((row) => [row.id, row.name]));
  } catch (err) {
    console.error(`[audit] could not read role names in space ${spaceId}:`, err);
  }
  recordAudit({
    spaceId,
    actorId,
    action: 'member_roles_update',
    targetType: 'member',
    targetId,
    targetLabel: auditUserLabel(spaceId, targetId),
    changes: [
      ...addedRoleIds.map((roleId) => auditChange('role_added', undefined, names.get(roleId) ?? roleId)),
      ...removedRoleIds.map((roleId) => auditChange('role_removed', names.get(roleId) ?? roleId, undefined)),
    ],
  });
}

const TARGET_TYPES: ReadonlySet<string> = new Set<AuditLogTargetType>(['space', 'channel', 'category', 'role', 'member', 'message', 'invite', 'join_request']);

function isAuditLogValue(value: unknown): value is AuditLogValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** A stored `changes` column, read leniently: a malformed value or entry is left out rather than failing the page. */
function parseChanges(stored: string | null): AuditLogChange[] | null {
  if (stored === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const changes: AuditLogChange[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { key, from, to } = item as Record<string, unknown>;
    if (typeof key !== 'string') continue;
    const entry: AuditLogChange = { key };
    if (isAuditLogValue(from)) entry.from = from;
    if (isAuditLogValue(to)) entry.to = to;
    changes.push(entry);
  }
  return changes;
}

function rowToEntry(row: typeof schema.spaceAuditLog.$inferSelect): AuditLogEntry | null {
  if (!isAuditLogAction(row.action)) return null;
  return {
    id: row.id,
    spaceId: row.spaceId,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType !== null && TARGET_TYPES.has(row.targetType) ? row.targetType as AuditLogTargetType : null,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    changes: parseChanges(row.changes),
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

/** One page of a space's audit log, as `GET /api/spaces/:id/audit-log` asks for it (already validated). */
export interface AuditLogPageQuery {
  spaceId: string;
  /** Only entries older than this entry id (a decimal snowflake). */
  before?: string;
  limit: number;
  action?: AuditLogAction;
  actorId?: string;
}

/**
 * A page of the log, newest first, with the users the entries name (every
 * actor, and every target that is a member) and the cursor of the next older
 * page, null when there is none. Ids are compared as numbers, in the form the
 * paging index is defined with (`idx_space_audit_log_space_page`).
 */
export function readAuditLogPage(query: AuditLogPageQuery): AuditLogResponse {
  const db = getDb();
  const conditions: SQL[] = [eq(schema.spaceAuditLog.spaceId, query.spaceId)];
  if (query.before !== undefined) {
    conditions.push(sql`CAST(${schema.spaceAuditLog.id} AS INTEGER) < CAST(${query.before} AS INTEGER)`);
  }
  if (query.action !== undefined) conditions.push(eq(schema.spaceAuditLog.action, query.action));
  if (query.actorId !== undefined) conditions.push(eq(schema.spaceAuditLog.actorId, query.actorId));

  // One row more than the page, to know whether an older page exists.
  const rows = db.select().from(schema.spaceAuditLog)
    .where(and(...conditions))
    .orderBy(sql`CAST(${schema.spaceAuditLog.id} AS INTEGER) DESC`)
    .limit(query.limit + 1)
    .all();
  const pageRows = rows.slice(0, query.limit);
  const nextBefore = rows.length > query.limit ? pageRows[pageRows.length - 1]?.id ?? null : null;
  const entries = pageRows.map(rowToEntry).filter((entry): entry is AuditLogEntry => entry !== null);

  const userIds = new Set<string>();
  for (const entry of entries) {
    userIds.add(entry.actorId);
    if (entry.targetType === 'member' && entry.targetId) userIds.add(entry.targetId);
  }
  const users = userIds.size > 0
    ? db.select().from(schema.users).where(inArray(schema.users.id, [...userIds])).all().map((u) => sanitizeUser(u))
    : [];

  return { entries, users, nextBefore };
}
