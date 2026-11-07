import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { customDecorationRef } from '@backspace/shared/src/customDecorations.js';
import { PermissionBits } from '@backspace/shared/src/permissions.js';
import {
  REPORT_LIMITS,
  isReportCategory,
  isReportTargetType,
  type AdminReport,
  type ReportCategory,
  type ReportDecision,
  type ReportGround,
  type ReportSnapshot,
  type ReportTargetType,
  type UserNotice,
  type UserNoticeKind,
} from '@backspace/shared/src/legal.js';
import { isDiscoveryStatus, type DiscoveryStatus } from '@backspace/shared/src/platform.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { deleteAttachmentFiles } from './fileCleanup.js';
import { dmMessageMutationTarget, queueDmMessageDeleteRelay } from './federationOutbox.js';
import { hasPermission } from './permissions.js';
import { platformActors } from './platformAudit.js';
import { openReportCount } from './reportCount.js';
import { generateSnowflake } from './snowflake.js';
import { viewOf as decorationViewOf } from './customDecorations.js';

// Reports of illegal content (DSA Art. 16) and what an instance's admins decide
// about them (docs/systems/legal.md). A report keeps what it pointed at as it
// was, because the content may be gone by the time an admin reads it.

type ReportRow = typeof schema.contentReports.$inferSelect;

/** How long a decided report and a read notice are kept; the privacy policy says so. */
export const LEGAL_RECORD_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/** How long the administrators' log is kept; the privacy policy says so. */
export const PLATFORM_AUDIT_RETENTION_MS = 2 * LEGAL_RECORD_RETENTION_MS;
const NOTICE_SUBJECT_MAX = 200;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ReportRefusal {
  refusal: { status: number; code: ErrorCode; details?: ErrorDetails };
}

export function isReportRefusal<T>(value: T | ReportRefusal): value is ReportRefusal {
  return typeof value === 'object' && value !== null && 'refusal' in value;
}

function refuse(status: number, code: ErrorCode, details?: ErrorDetails): ReportRefusal {
  return { refusal: { status, code, ...(details ? { details } : {}) } };
}

function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n/g, '\n').trim();
  return text.length >= min && text.length <= max && !CONTROL.test(text) ? text : null;
}

// ─── What was reported ──────────────────────────────────────────────────────

function authorName(userId: string): string | null {
  return getDb().select({ username: schema.users.username }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.username ?? null;
}

/**
 * What the reporter sees of the target, as it is now. Undefined when there is
 * no such thing or the reporter cannot see it: both answer alike, so a report
 * cannot tell whether a message exists in a channel the reporter cannot read.
 */
function snapshotOf(type: ReportTargetType, id: string, reporterId: string): ReportSnapshot | undefined {
  const db = getDb();
  if (type === 'message') {
    const message = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    if (!message) return undefined;
    const channel = db.select({ name: schema.channels.name, spaceId: schema.channels.spaceId })
      .from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
    if (!channel || !hasPermission(reporterId, channel.spaceId, PermissionBits.VIEW_CHANNEL, message.channelId)) return undefined;
    const space = db.select({ name: schema.spaces.name }).from(schema.spaces).where(eq(schema.spaces.id, channel.spaceId)).get();
    const attachments = db.select({ originalName: schema.attachments.originalName }).from(schema.attachments)
      .where(eq(schema.attachments.messageId, id)).all();
    return {
      authorId: message.userId,
      authorName: authorName(message.userId),
      content: message.content,
      attachments: attachments.map((row) => row.originalName),
      place: `${space?.name ?? ''} / #${channel.name}`,
      createdAt: message.createdAt,
    };
  }
  if (type === 'dm_message') {
    const message = db.select().from(schema.dmMessages).where(eq(schema.dmMessages.id, id)).get();
    if (!message) return undefined;
    const member = db.select({ userId: schema.dmMembers.userId }).from(schema.dmMembers)
      .where(and(eq(schema.dmMembers.dmChannelId, message.dmChannelId), eq(schema.dmMembers.userId, reporterId))).get();
    if (!member) return undefined;
    const attachments = db.select({ originalName: schema.attachments.originalName }).from(schema.attachments)
      .where(eq(schema.attachments.dmMessageId, id)).all();
    return {
      authorId: message.userId,
      authorName: authorName(message.userId),
      content: message.content,
      attachments: attachments.map((row) => row.originalName),
      place: null,
      createdAt: message.createdAt,
    };
  }
  if (type === 'user') {
    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!user || user.isDeleted === 1) return undefined;
    return { authorId: user.id, authorName: user.username, content: user.bio, attachments: [], place: null, createdAt: null };
  }
  if (type === 'space') {
    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) return undefined;
    return { authorId: space.ownerId, authorName: authorName(space.ownerId), content: space.description, attachments: [], place: space.name, createdAt: null };
  }
  if (type === 'decoration') {
    // A design someone made (utils/customDecorations.ts), as anyone can see it: in the gallery, or
    // on a profile that wears it. Its name, kind and maker, and the address of its picture, which
    // goes with it if it is removed.
    const design = db.select().from(schema.customDecorations).where(eq(schema.customDecorations.id, id)).get();
    if (!design) return undefined;
    const ref = customDecorationRef(design.id);
    const worn = design.shared === 1 || design.creatorId === reporterId || db.select({ id: schema.users.id }).from(schema.users).where(or(
      eq(schema.users.avatarFrame, ref), eq(schema.users.profileEffect, ref), eq(schema.users.nameplate, ref), eq(schema.users.nameEffect, ref),
    )).get() !== undefined;
    if (!worn) return undefined;
    const view = decorationViewOf(design);
    return {
      authorId: design.creatorId,
      authorName: authorName(design.creatorId),
      content: design.name,
      attachments: view.image ? [view.image] : [],
      place: design.kind,
      createdAt: design.createdAt,
    };
  }
  return undefined;
}

// ─── A new report ───────────────────────────────────────────────────────────

/**
 * Check and store a report. Art. 16(2) asks for an explanation, the exact
 * place, the reporter's name and address and a statement of good faith; only
 * a report of child sexual abuse material may be left unsigned. Someone signed
 * in has named themselves through their account.
 */
export function createReport(body: unknown, reporterId: string | null, now: number = Date.now()): { id: string; receivedAt: number } | ReportRefusal {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const { category, targetType, targetId, goodFaith } = input;
  if (!isReportCategory(category)) return refuse(400, 'report_category_invalid');
  const explanation = boundedText(input.explanation, REPORT_LIMITS.EXPLANATION_MIN, REPORT_LIMITS.EXPLANATION_MAX);
  if (explanation === null) {
    return refuse(400, 'report_explanation_invalid', { min: REPORT_LIMITS.EXPLANATION_MIN, max: REPORT_LIMITS.EXPLANATION_MAX });
  }
  if (goodFaith !== true) return refuse(400, 'report_good_faith_required');
  if (!isReportTargetType(targetType)) return refuse(400, 'report_target_invalid');

  let snapshot: ReportSnapshot | null = null;
  let storedTargetId: string | null = null;
  let targetUrl: string | null = null;
  if (targetType === 'link') {
    targetUrl = boundedText(input.targetUrl, 3, REPORT_LIMITS.URL_MAX);
    if (targetUrl === null) return refuse(400, 'report_target_invalid');
  } else {
    // Only a signed-in person can point at something inside the app.
    if (!reporterId || typeof targetId !== 'string' || targetId.length === 0) return refuse(400, 'report_target_invalid');
    const found = snapshotOf(targetType, targetId, reporterId);
    if (!found) return refuse(404, 'report_target_not_found');
    snapshot = found;
    storedTargetId = targetId;
  }

  const reporterName = boundedText(input.reporterName, 2, REPORT_LIMITS.NAME_MAX);
  const reporterEmail = boundedText(input.reporterEmail, 3, REPORT_LIMITS.EMAIL_MAX);
  if (!reporterId && category !== 'child_safety' && (reporterName === null || reporterEmail === null || !EMAIL.test(reporterEmail))) {
    return refuse(400, 'report_contact_required');
  }
  if (reporterEmail !== null && !EMAIL.test(reporterEmail)) return refuse(400, 'report_contact_required');

  const db = getDb();
  if (reporterId && storedTargetId) {
    const open = db.select({ id: schema.contentReports.id }).from(schema.contentReports)
      .where(and(
        eq(schema.contentReports.reporterUserId, reporterId),
        eq(schema.contentReports.targetId, storedTargetId),
        eq(schema.contentReports.status, 'open'),
      )).get();
    if (open) return refuse(409, 'report_duplicate');
  }

  const id = generateSnowflake();
  db.insert(schema.contentReports).values({
    id,
    status: 'open',
    category,
    explanation,
    targetType,
    targetId: storedTargetId,
    targetUrl,
    snapshot: snapshot ? JSON.stringify(snapshot) : null,
    reporterUserId: reporterId,
    reporterName,
    reporterEmail,
    createdAt: now,
  }).run();
  announceReportQueue();
  return { id, receivedAt: now };
}

// ─── The admins' queue ──────────────────────────────────────────────────────

export function announceReportQueue(): void {
  connectionManager.sendToAdmins({ type: 'report_queue_count', open: openReportCount() });
}

export function snapshotFromRow(row: Pick<ReportRow, 'snapshot'>): ReportSnapshot | null {
  if (!row.snapshot) return null;
  try {
    return JSON.parse(row.snapshot) as ReportSnapshot;
  } catch {
    return null;
  }
}

function adminReportOf(
  row: ReportRow,
  actors: ReadonlyMap<string, AdminReport['decidedBy']>,
  listings: ReadonlyMap<string, DiscoveryStatus | null>,
): AdminReport {
  return {
    id: row.id,
    status: row.status as AdminReport['status'],
    category: row.category as ReportCategory,
    explanation: row.explanation,
    targetType: row.targetType as ReportTargetType,
    targetId: row.targetId,
    targetUrl: row.targetUrl,
    snapshot: snapshotFromRow(row),
    listingStatus: row.targetType === 'space' && row.targetId ? listings.get(row.targetId) ?? null : null,
    reporterUser: row.reporterUserId ? actors.get(row.reporterUserId) ?? null : null,
    reporterName: row.reporterName,
    reporterEmail: row.reporterEmail,
    createdAt: row.createdAt,
    decision: row.decision as ReportDecision | null,
    ground: row.ground as ReportGround | null,
    note: row.decisionNote,
    decidedBy: row.decidedBy ? actors.get(row.decidedBy) ?? null : null,
    decidedAt: row.decidedAt,
  };
}

export function adminReports(rows: ReportRow[]): AdminReport[] {
  const ids = rows.flatMap((row) => [row.reporterUserId, row.decidedBy]).filter((id): id is string => id !== null);
  const actors = platformActors(ids);
  const spaceIds = rows.filter((row) => row.targetType === 'space' && row.targetId).map((row) => row.targetId as string);
  const listings = new Map<string, DiscoveryStatus | null>();
  if (spaceIds.length > 0) {
    const spaces = getDb().select({ id: schema.spaces.id, status: schema.spaces.discoveryStatus }).from(schema.spaces)
      .where(inArray(schema.spaces.id, spaceIds)).all();
    for (const space of spaces) listings.set(space.id, isDiscoveryStatus(space.status) ? space.status : null);
  }
  return rows.map((row) => adminReportOf(row, actors, listings));
}

export function listReports(status: 'open' | 'closed', before: string | undefined): ReportRow[] {
  const db = getDb();
  const condition = before
    ? and(eq(schema.contentReports.status, status), lt(sql`CAST(${schema.contentReports.id} AS INTEGER)`, sql`CAST(${before} AS INTEGER)`))
    : eq(schema.contentReports.status, status);
  return db.select().from(schema.contentReports)
    .where(condition)
    .orderBy(desc(sql`CAST(${schema.contentReports.id} AS INTEGER)`))
    .limit(REPORT_LIMITS.PAGE_SIZE)
    .all();
}

// ─── Removing what was reported ─────────────────────────────────────────────

/**
 * Remove a reported message as the instance's operator, with the same effects
 * as anyone's delete: attachments go, members see it vanish, federated copies
 * get the relay. False when it is already gone.
 */
export function removeReportedMessage(type: 'message' | 'dm_message', id: string): boolean {
  const db = getDb();
  if (type === 'message') {
    const message = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    if (!message) return false;
    const channel = db.select({ spaceId: schema.channels.spaceId }).from(schema.channels)
      .where(eq(schema.channels.id, message.channelId)).get();
    const files = db.select({ filename: schema.attachments.filename }).from(schema.attachments)
      .where(eq(schema.attachments.messageId, id)).all();
    db.transaction((tx) => {
      tx.delete(schema.attachments).where(eq(schema.attachments.messageId, id)).run();
      tx.delete(schema.messages).where(eq(schema.messages.id, id)).run();
    });
    deleteAttachmentFiles(files);
    if (channel) {
      connectionManager.sendToChannel(channel.spaceId, message.channelId, {
        type: 'message_deleted',
        messageId: id,
        channelId: message.channelId,
      });
    }
    return true;
  }
  const message = db.select().from(schema.dmMessages).where(eq(schema.dmMessages.id, id)).get();
  if (!message) return false;
  // A peer accepts a delete only from the message's author, so that is who the
  // relay names; a local copy of a remote author's message is removed here only.
  const relayTarget = dmMessageMutationTarget(message, message.userId);
  const files = db.select({ filename: schema.attachments.filename }).from(schema.attachments)
    .where(eq(schema.attachments.dmMessageId, id)).all();
  db.transaction((tx) => {
    tx.delete(schema.attachments).where(eq(schema.attachments.dmMessageId, id)).run();
    tx.delete(schema.dmReactions).where(eq(schema.dmReactions.dmMessageId, id)).run();
    tx.delete(schema.dmMessages).where(eq(schema.dmMessages.id, id)).run();
  });
  deleteAttachmentFiles(files);
  const members = db.select({ userId: schema.dmMembers.userId }).from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, message.dmChannelId)).all();
  for (const member of members) {
    connectionManager.sendToUser(member.userId, { type: 'dm_message_deleted', messageId: id, dmChannelId: message.dmChannelId });
  }
  queueDmMessageDeleteRelay(id, message.dmChannelId, relayTarget);
  return true;
}

// ─── Notices ────────────────────────────────────────────────────────────────

function noticeOf(row: typeof schema.userNotices.$inferSelect): UserNotice {
  return {
    id: row.id,
    kind: row.kind as UserNoticeKind,
    ground: row.ground as ReportGround | null,
    note: row.note,
    subject: row.subject,
    until: row.until,
    decision: row.decision as ReportDecision | null,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

/** Tell a person what was decided about them, now if they are connected, and keep it for later. */
export function sendNotice(
  userId: string,
  notice: { kind: UserNoticeKind; ground?: ReportGround | null; note?: string | null; subject?: string | null; until?: number | null; decision?: ReportDecision | null },
  now: number = Date.now(),
): void {
  const row = {
    id: generateSnowflake(),
    userId,
    kind: notice.kind,
    ground: notice.ground ?? null,
    note: notice.note ?? null,
    subject: notice.subject ? notice.subject.slice(0, NOTICE_SUBJECT_MAX) : null,
    until: notice.until ?? null,
    decision: notice.decision ?? null,
    createdAt: now,
    readAt: null,
  };
  getDb().insert(schema.userNotices).values(row).run();
  connectionManager.sendToUser(userId, { type: 'user_notice', notice: noticeOf(row) });
}

export function noticesOf(userId: string): UserNotice[] {
  return getDb().select().from(schema.userNotices)
    .where(eq(schema.userNotices.userId, userId))
    .orderBy(desc(sql`CAST(${schema.userNotices.id} AS INTEGER)`))
    .limit(REPORT_LIMITS.PAGE_SIZE)
    .all()
    .map(noticeOf);
}

// ─── Retention ──────────────────────────────────────────────────────────────

/** Decided reports and read notices go after a year, the administrators' log after two. */
export function purgeOldLegalRecords(now: number = Date.now()): void {
  const db = getDb();
  const cutoff = now - LEGAL_RECORD_RETENTION_MS;
  db.delete(schema.contentReports)
    .where(and(eq(schema.contentReports.status, 'closed'), isNotNull(schema.contentReports.decidedAt), lt(schema.contentReports.decidedAt, cutoff)))
    .run();
  db.delete(schema.userNotices)
    .where(and(isNotNull(schema.userNotices.readAt), lt(schema.userNotices.readAt, cutoff)))
    .run();
  db.delete(schema.platformAuditLog)
    .where(lt(schema.platformAuditLog.createdAt, now - PLATFORM_AUDIT_RETENTION_MS))
    .run();
}

/** Housekeeping must never take the server down with it. */
function sweepLegalRecords(): void {
  try {
    purgeOldLegalRecords();
  } catch (err) {
    console.error('[legal] could not delete old records:', err);
  }
}

export function startLegalRecordSweeper(): void {
  sweepLegalRecords();
  setInterval(sweepLegalRecords, 24 * 60 * 60 * 1000).unref();
}
