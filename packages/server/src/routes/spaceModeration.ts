import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import {
  AUDIT_LOG_MAX_PAGE_SIZE,
  AUDIT_LOG_PAGE_SIZE,
  MODERATION_LIMITS,
  isAuditLogAction,
  type AuditLogAction,
  type AuditLogChange,
  type MemberResponse,
  type SpaceModerationSettings,
} from '@backspace/shared';
import { normalizeModerationSettings } from '@backspace/shared/src/moderation.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { hasPermission, isMember, isSpaceOwner, PermissionBits } from '../utils/permissions.js';
import { canActOnMemberInSpace } from '../utils/roleHierarchy.js';
import { activeTimeoutUntil, readModerationSettings, writeModerationSettings } from '../utils/spaceModeration.js';
import { loadMemberWire } from '../utils/spaceWire.js';
import { auditChange, auditUserLabel, readAuditLogPage, recordAudit } from '../utils/auditLog.js';
import { broadcastMemberUpdate } from './spaceMemberUpdate.js';
import { disconnectMemberFromSpaceVoice } from '../ws/events.js';

// Server settings → Moderation and Audit log, and member timeouts
// (docs/systems/spaces.md, "Moderation"; api.md, "Moderation"). Every route
// here runs on the instance that hosts the space, with the caller's and the
// target's row ids on this instance.

/** The request fields `normalizeModerationSettings` reads; a body with none of them changes nothing. */
const MODERATION_FIELDS = ['blockedWords', 'blockLinks', 'blockInvites', 'maxMentions', 'minAccountAgeMinutes', 'minMemberAgeMinutes'] as const;

/** A JSON object body (not an array or null), as every write here takes. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The rules other than the blocked words, compared and recorded field by field. */
const SCALAR_MODERATION_FIELDS = ['blockLinks', 'blockInvites', 'maxMentions', 'minAccountAgeMinutes', 'minMemberAgeMinutes'] as const;

/** Whether two versions of a space's rules are the same, the order and spelling of the blocked words included. */
function sameRules(a: SpaceModerationSettings, b: SpaceModerationSettings): boolean {
  return a.blockedWords.length === b.blockedWords.length
    && a.blockedWords.every((word, index) => word === b.blockedWords[index])
    && SCALAR_MODERATION_FIELDS.every((key) => a[key] === b[key]);
}

/**
 * The changes between two versions of a space's rules for the audit log: each
 * blocked word added or removed on its own (compared without case, as the
 * rules match), and every other field that moved.
 */
function moderationChanges(before: SpaceModerationSettings, after: SpaceModerationSettings): AuditLogChange[] {
  const changes: AuditLogChange[] = [];
  const keyOf = (word: string): string => word.toLowerCase();
  const beforeWords = new Set(before.blockedWords.map(keyOf));
  const afterWords = new Set(after.blockedWords.map(keyOf));
  for (const word of after.blockedWords) {
    if (!beforeWords.has(keyOf(word))) changes.push(auditChange('blocked_word_added', undefined, word));
  }
  for (const word of before.blockedWords) {
    if (!afterWords.has(keyOf(word))) changes.push(auditChange('blocked_word_removed', word, undefined));
  }
  for (const key of SCALAR_MODERATION_FIELDS) {
    if (before[key] !== after[key]) changes.push(auditChange(key, before[key], after[key]));
  }
  return changes;
}

type TimeoutTargetRefusal = { status: 400 | 403 | 404; code: 'cannot_target_self' | 'cannot_target_owner' | 'member_not_found' | 'role_hierarchy' };

/**
 * Who a timeout (or its removal) may not reach, as kick and ban are refused:
 * oneself, the owner, someone who is not a member, and anyone the actor does
 * not outrank (`canActOnMemberInSpace`; the owner and instance admins outrank
 * everyone else).
 */
function timeoutTargetRefusal(spaceId: string, actorId: string, targetId: string): TimeoutTargetRefusal | null {
  if (targetId === actorId) return { status: 400, code: 'cannot_target_self' };
  if (isSpaceOwner(spaceId, targetId)) return { status: 400, code: 'cannot_target_owner' };
  if (!isMember(spaceId, targetId)) return { status: 404, code: 'member_not_found' };
  if (!canActOnMemberInSpace(spaceId, actorId, targetId)) return { status: 403, code: 'role_hierarchy' };
  return null;
}

/** A decimal snowflake, as an audit entry id is. */
const ENTRY_ID = /^\d{1,20}$/;

type AuditQuery = { before?: string; limit: number; action?: AuditLogAction; actorId?: string };

/**
 * The audit log query, or null when a parameter is not one: `before` an entry
 * id, `limit` a whole number (clamped to 1..AUDIT_LOG_MAX_PAGE_SIZE,
 * AUDIT_LOG_PAGE_SIZE when absent), `action` one of AUDIT_LOG_ACTIONS,
 * `actorId` a user id. An empty value counts as absent; a repeated one
 * (an array) is refused.
 */
function parseAuditQuery(query: Record<string, unknown>): AuditQuery | null {
  const read = (value: unknown): string | undefined | null => {
    if (value === undefined || value === '') return undefined;
    return typeof value === 'string' ? value : null;
  };
  const before = read(query.before);
  const limitText = read(query.limit);
  const action = read(query.action);
  const actorId = read(query.actorId);
  if (before === null || limitText === null || action === null || actorId === null) return null;
  if (before !== undefined && !ENTRY_ID.test(before)) return null;
  let limit = AUDIT_LOG_PAGE_SIZE;
  if (limitText !== undefined) {
    if (!/^\d{1,6}$/.test(limitText)) return null;
    limit = Math.min(Math.max(Number(limitText), 1), AUDIT_LOG_MAX_PAGE_SIZE);
  }
  if (action !== undefined && !isAuditLogAction(action)) return null;
  const parsed: AuditQuery = { limit };
  if (before !== undefined) parsed.before = before;
  if (action !== undefined) parsed.action = action;
  if (actorId !== undefined) parsed.actorId = actorId;
  return parsed;
}

export async function spaceModerationRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/spaces/:id/moderation - The space's automatic message rules
  app.get<{ Params: { id: string } }>('/api/spaces/:id/moderation', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const space = getDb().select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }
    return reply.code(200).send(readModerationSettings(id));
  });

  // PATCH /api/spaces/:id/moderation - Change some of them
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/spaces/:id/moderation', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const space = getDb().select({ id: schema.spaces.id, name: schema.spaces.name }).from(schema.spaces)
      .where(eq(schema.spaces.id, id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }
    const body = request.body;
    if (!isPlainObject(body)) return sendError(reply, 400, 'validation_failed');
    if (!MODERATION_FIELDS.some((field) => body[field] !== undefined)) {
      return sendError(reply, 400, 'no_fields_to_update');
    }

    const current = readModerationSettings(id);
    const result = normalizeModerationSettings(current, body);
    if (!result.ok) {
      return sendError(reply, 400, 'moderation_settings_invalid', { field: result.field });
    }

    // Nothing moved: nothing is written, stamped or recorded.
    if (sameRules(current, result.value)) {
      return reply.code(200).send(current);
    }

    const stored = writeModerationSettings(id, result.value, Date.now());
    // A list only reordered or respelled in case is stored but records nothing.
    const changes = moderationChanges(current, result.value);
    if (changes.length > 0) {
      recordAudit({
        spaceId: id, actorId: request.userId, action: 'moderation_update',
        targetType: 'space', targetId: id, targetLabel: space.name, changes,
      });
    }
    return reply.code(200).send(stored);
  });

  // PUT /api/spaces/:id/members/:uid/timeout - Time a member out
  app.put<{ Params: { id: string; uid: string }; Body: unknown }>('/api/spaces/:id/members/:uid/timeout', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id, uid } = request.params;
    const db = getDb();
    const space = db.select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (!hasPermission(request.userId, id, PermissionBits.MODERATE_MEMBERS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MODERATE_MEMBERS' });
    }
    const body = request.body;
    if (!isPlainObject(body)) return sendError(reply, 400, 'validation_failed');

    const refusal = timeoutTargetRefusal(id, request.userId, uid);
    if (refusal) return sendError(reply, refusal.status, refusal.code);

    const { durationSeconds, reason } = body;
    if (typeof durationSeconds !== 'number' || !Number.isInteger(durationSeconds)
      || durationSeconds < MODERATION_LIMITS.MIN_TIMEOUT_SECONDS || durationSeconds > MODERATION_LIMITS.MAX_TIMEOUT_SECONDS) {
      return sendError(reply, 400, 'timeout_duration_invalid');
    }
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      return sendError(reply, 400, 'validation_failed');
    }
    const storedReason = typeof reason === 'string' ? reason.trim() || null : null;
    if (storedReason !== null && storedReason.length > MODERATION_LIMITS.MAX_REASON_LENGTH) {
      return sendError(reply, 400, 'timeout_reason_too_long', { max: MODERATION_LIMITS.MAX_REASON_LENGTH });
    }

    // The end comes from this server's clock, so every client reads the same one.
    const now = Date.now();
    const until = now + durationSeconds * 1000;
    db.update(schema.spaceMembers).set({ timedOutUntil: until })
      .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, uid))).run();

    recordAudit({
      spaceId: id, actorId: request.userId, action: 'member_timeout',
      targetType: 'member', targetId: uid, targetLabel: auditUserLabel(id, uid),
      changes: [auditChange('durationSeconds', undefined, durationSeconds)],
      reason: storedReason,
    }, now);

    // No voice while timed out: out of the channel they are in, as
    // DISCONNECT_MEMBERS would take them out.
    disconnectMemberFromSpaceVoice(id, uid);

    const member = broadcastMemberUpdate(id, uid);
    if (!member) return sendError(reply, 500, 'member_update_failed');
    const response: MemberResponse = { member };
    return reply.code(200).send(response);
  });

  // DELETE /api/spaces/:id/members/:uid/timeout - End a member's timeout early
  app.delete<{ Params: { id: string; uid: string } }>('/api/spaces/:id/members/:uid/timeout', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id, uid } = request.params;
    const db = getDb();
    const space = db.select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (!hasPermission(request.userId, id, PermissionBits.MODERATE_MEMBERS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MODERATE_MEMBERS' });
    }
    const refusal = timeoutTargetRefusal(id, request.userId, uid);
    if (refusal) return sendError(reply, refusal.status, refusal.code);

    const row = db.select({ timedOutUntil: schema.spaceMembers.timedOutUntil }).from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, uid))).get();
    const now = Date.now();
    if (row && row.timedOutUntil !== null) {
      db.update(schema.spaceMembers).set({ timedOutUntil: null })
        .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, uid))).run();
      // Only a timeout that was still running is lifted; clearing one that had
      // already ended is tidying, not a moderation action.
      if (activeTimeoutUntil(row.timedOutUntil, now) !== null) {
        recordAudit({
          spaceId: id, actorId: request.userId, action: 'member_timeout_remove',
          targetType: 'member', targetId: uid, targetLabel: auditUserLabel(id, uid),
        }, now);
      }
      const member = broadcastMemberUpdate(id, uid);
      if (!member) return sendError(reply, 500, 'member_update_failed');
      const response: MemberResponse = { member };
      return reply.code(200).send(response);
    }

    // Not timed out: the state the request asks for already holds.
    const member = loadMemberWire(id, uid, now);
    if (!member) return sendError(reply, 404, 'member_not_found');
    const response: MemberResponse = { member };
    return reply.code(200).send(response);
  });

  // GET /api/spaces/:id/audit-log - The space's audit log, newest first
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>('/api/spaces/:id/audit-log', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const space = getDb().select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (!hasPermission(request.userId, id, PermissionBits.VIEW_AUDIT_LOG)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_AUDIT_LOG' });
    }
    const query = parseAuditQuery(request.query ?? {});
    if (!query) return sendError(reply, 400, 'validation_failed');
    return reply.code(200).send(readAuditLogPage({ spaceId: id, ...query }));
  });
}
