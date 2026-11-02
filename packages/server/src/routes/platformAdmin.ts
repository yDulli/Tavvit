import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { isGrantedSpaceBadge, isGrantedUserBadge, orderedBadges } from '@backspace/shared/src/badges.js';
import {
  DISCOVERY_DECISIONS,
  PLATFORM_AUDIT_PAGE_SIZE,
  SUSPENSION_LIMITS,
  VERIFICATION_DECISIONS,
  isDiscoveryDecision,
  isPlatformAuditAction,
  isVerificationDecision,
  type AdminSpaceDetail,
  type AdminSpaceFilter,
  type AdminSpaceListResponse,
  type AdminSpaceSummary,
  type AdminUserDetail,
  type DiscoveryQueueItem,
  type PlatformActor,
  type PlatformAuditAction,
  type PlatformAuditTargetType,
  type PlatformOverview,
  type ReviewQueueResponse,
  type VerificationQueueItem,
} from '@backspace/shared/src/platform.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { AVATAR_COLORS, type AvatarColor } from '@backspace/shared';
import { getDb, getRawDb, schema } from '../db/index.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { connectionManager } from '../ws/handler.js';
import { activeSuspension } from '../utils/suspension.js';
import { platformActors, readPlatformAudit, recordPlatformAudit } from '../utils/platformAudit.js';
import { grantedSpaceBadgesOf, grantedUserBadgesOf, spaceBadgesOf } from '../utils/badges.js';
import { toAdminUser } from '../utils/adminUser.js';
import { ACCOUNT_LIMITS, storageGbToBytes } from '@backspace/shared/src/accountLimits.js';
import { storageUsage } from '../utils/accountLimits.js';
import { applySuspension } from '../utils/accountActions.js';
import {
  LISTED_IN_DISCOVERY_SQL,
  decideDiscovery,
  decideVerification,
  discoveryStatusOf,
  isReviewRefusal,
  openReviewCounts,
  openReviewSpaceIds,
  parseReviewNote,
  reviewRequestsOf,
  reviewStateOf,
  verificationStatusOf,
} from '../utils/spaceReview.js';
import { announceReviewStep, announceSpaceUpdate, announceUserUpdate } from '../utils/reviewNotify.js';
import { sendNotice } from '../utils/reports.js';
import { revokeVanityCode } from '../utils/spaceInvites.js';

// The platform admin area (docs/systems/admin.md, "Platform administration"):
// the overview, account suspensions, spaces and their reviews, badges and the
// platform audit log. Every route is behind requireAdmin, which reads
// `users.is_admin` on this instance; a space role or ownership never opens
// one. Every decision is recorded in the platform audit log.

const ADMIN = { preHandler: [authenticate, requireAdmin] };
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

type SpaceRow = typeof schema.spaces.$inferSelect;

function refuse(reply: FastifyReply, refusal: { status: number; code: ErrorCode; details?: ErrorDetails }): FastifyReply {
  return sendError(reply, refusal.status, refusal.code, refusal.details);
}

/** `value` trimmed when it is text of `min` to `max` characters without control characters; else null. */
function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max && !CONTROL.test(trimmed) ? trimmed : null;
}

function asSpaceVisibility(value: string | null): AdminSpaceSummary['visibility'] {
  return value === 'public' || value === 'request' ? value : 'private';
}

function memberCounts(spaceIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (spaceIds.length === 0) return counts;
  for (const row of getDb().select({ spaceId: schema.spaceMembers.spaceId, n: sql<number>`count(*)` })
    .from(schema.spaceMembers).where(inArray(schema.spaceMembers.spaceId, [...spaceIds]))
    .groupBy(schema.spaceMembers.spaceId).all()) {
    counts.set(row.spaceId, row.n);
  }
  return counts;
}

function avatarColorOf(value: string | null): AvatarColor | null {
  return value !== null && (AVATAR_COLORS as readonly string[]).includes(value) ? value as AvatarColor : null;
}

function summaryOf(row: SpaceRow, counts: Map<string, number>, owners: Map<string, PlatformActor>): AdminSpaceSummary {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    avatarColor: avatarColorOf(row.avatarColor),
    owner: owners.get(row.ownerId) ?? null,
    memberCount: counts.get(row.id) ?? 0,
    visibility: asSpaceVisibility(row.visibility),
    directoryListed: row.directoryListed === 1,
    verificationStatus: verificationStatusOf(row),
    discoveryStatus: discoveryStatusOf(row),
    badges: spaceBadgesOf(row),
    grantedBadges: grantedSpaceBadgesOf(row.badges),
    createdAt: row.createdAt,
  };
}

/** The admin area's view of these spaces, in the order given, with owners and member counts. */
function spaceSummaries(rows: readonly SpaceRow[]): AdminSpaceSummary[] {
  const counts = memberCounts(rows.map((row) => row.id));
  const owners = platformActors(rows.map((row) => row.ownerId));
  return rows.map((row) => summaryOf(row, counts, owners));
}

function spaceSummary(row: SpaceRow): AdminSpaceSummary {
  return summaryOf(row, memberCounts([row.id]), platformActors([row.ownerId]));
}

function isAuditTargetType(value: string): value is PlatformAuditTargetType {
  return value === 'user' || value === 'space' || value === 'instance';
}

function spaceRow(id: string): SpaceRow | undefined {
  return getDb().select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
}

/** A LIKE pattern matching `q` anywhere, with its wildcards taken literally. */
function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** The badge list a request names: known granted badges of the kind only, each once, in display order. */
function badgeListOf<T extends string>(body: unknown, accepts: (value: unknown) => value is T): T[] | null {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(input.badges) || input.badges.length > 32) return null;
  if (!input.badges.every(accepts)) return null;
  return orderedBadges(input.badges as T[]);
}

function badgeReason(body: unknown): string | null {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return boundedText(input.reason, 1, SUSPENSION_LIMITS.REASON_MAX_LENGTH);
}

function decisionTime(body: unknown): number | undefined {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return typeof input.requestedAt === 'number' && Number.isFinite(input.requestedAt) ? input.requestedAt : undefined;
}

export async function platformAdminRoutes(app: FastifyInstance): Promise<void> {
  // ─── Overview ─────────────────────────────────────────────────────────────

  app.get('/api/admin/overview', ADMIN, async (_request, reply) => {
    const raw = getRawDb();
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const accounts = raw.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_admin), 0) AS admins,
              COALESCE(SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END), 0) AS new7d,
              COALESCE(SUM(CASE WHEN suspended_at IS NOT NULL AND (suspended_until IS NULL OR suspended_until > ?) THEN 1 ELSE 0 END), 0) AS suspended
       FROM users WHERE home_instance IS NULL AND account_kind = 'person' AND (is_deleted IS NULL OR is_deleted = 0)`,
    ).get(weekAgo, now) as { total: number; admins: number; new7d: number; suspended: number };
    const messages = raw.prepare(
      `SELECT (SELECT COUNT(*) FROM messages WHERE created_at > ?) + (SELECT COUNT(*) FROM dm_messages WHERE created_at > ?) AS n`,
    ).get(weekAgo, weekAgo) as { n: number };
    const active = raw.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT user_id FROM messages WHERE created_at > ? AND user_id NOT IN (SELECT id FROM users WHERE account_kind <> 'person')
         UNION SELECT user_id FROM dm_messages WHERE created_at > ?
       )`,
    ).get(weekAgo, weekAgo) as { n: number };
    const spaces = raw.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN ${LISTED_IN_DISCOVERY_SQL} THEN 1 ELSE 0 END), 0) AS listed,
              COALESCE(SUM(CASE WHEN s.verification_status = 'verified' THEN 1 ELSE 0 END), 0) AS verified
       FROM spaces s`,
    ).get() as { total: number; listed: number; verified: number };
    const settings = raw.prepare('SELECT discovery_enabled FROM instance_settings WHERE id = 1').get() as { discovery_enabled: number } | undefined;
    const reviews = openReviewCounts();

    const overview: PlatformOverview = {
      users: {
        total: accounts.total,
        online: connectionManager.getAllOnlineUserIds().length,
        new7d: accounts.new7d,
        active7d: active.n,
        suspended: accounts.suspended,
        admins: accounts.admins,
      },
      activity: { messages7d: messages.n },
      spaces: {
        total: spaces.total,
        listed: spaces.listed,
        verified: spaces.verified,
        discoveryEnabled: settings?.discovery_enabled === 1,
      },
      reviews,
    };
    return reply.code(200).send(overview);
  });

  // ─── Accounts ─────────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/admin/users/:id', ADMIN, async (request, reply) => {
    const db = getDb();
    const target = db.select().from(schema.users).where(eq(schema.users.id, request.params.id)).get();
    if (!target) return sendError(reply, 404, 'user_not_found');

    const owned = db.select().from(schema.spaces).where(eq(schema.spaces.ownerId, target.id)).all();
    const memberships = db.select({ n: sql<number>`count(*)` }).from(schema.spaceMembers)
      .where(eq(schema.spaceMembers.userId, target.id)).get();
    const friends = db.select({ n: sql<number>`count(*)` }).from(schema.friends)
      .where(or(eq(schema.friends.userId, target.id), eq(schema.friends.friendId, target.id))).get();
    const messages = getRawDb().prepare(
      'SELECT (SELECT COUNT(*) FROM messages WHERE user_id = ?) + (SELECT COUNT(*) FROM dm_messages WHERE user_id = ?) AS n',
    ).get(target.id, target.id) as { n: number };

    const detail: AdminUserDetail = {
      user: toAdminUser(target),
      ownedSpaces: spaceSummaries(owned).map((space) => ({ id: space.id, name: space.name, memberCount: space.memberCount })),
      memberships: memberships?.n ?? 0,
      friends: friends?.n ?? 0,
      messages: messages.n,
      storage: { ...storageUsage(target.id), ownLimitBytes: target.storageLimitBytes },
      audit: readPlatformAudit({ limit: 20, targetType: 'user', targetId: target.id }).entries,
    };
    return reply.code(200).send(detail);
  });

  // PUT /api/admin/users/:id/storage-limit — this account's own limit in GB (0: none), or
  // with null back to the instance's. What it already keeps stays.
  app.put<{ Params: { id: string }; Body: unknown }>('/api/admin/users/:id/storage-limit', ADMIN, async (request, reply) => {
    const db = getDb();
    const target = db.select().from(schema.users).where(eq(schema.users.id, request.params.id)).get();
    if (!target || target.accountKind !== 'person') return sendError(reply, 404, 'user_not_found');
    if (target.isDeleted === 1) return sendError(reply, 400, 'user_already_deleted');

    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const limitBytes = body.limitGb === null ? null : storageGbToBytes(body.limitGb);
    if (body.limitGb !== null && limitBytes === null) {
      return sendError(reply, 400, 'account_limit_out_of_range', { min: 0, max: ACCOUNT_LIMITS.MAX_STORAGE_GB });
    }

    db.update(schema.users).set({ storageLimitBytes: limitBytes }).where(eq(schema.users.id, target.id)).run();
    recordPlatformAudit({
      actorId: request.userId,
      action: 'user_storage_limit',
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.username,
      details: { limitBytes },
    });
    return reply.code(200).send({ success: true });
  });

  // POST /api/admin/users/:id/suspend — suspend for a time, or until lifted.
  // Nothing of the account is deleted; its sessions end now.
  app.post<{ Params: { id: string }; Body: unknown }>('/api/admin/users/:id/suspend', ADMIN, async (request, reply) => {
    const { id } = request.params;
    if (id === request.userId) return sendError(reply, 400, 'cannot_suspend_self');
    const db = getDb();
    const target = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!target) return sendError(reply, 404, 'user_not_found');
    if (target.isDeleted === 1) return sendError(reply, 400, 'user_already_deleted');
    // An admin is demoted first, so an admin team can never lock itself out
    // by suspending one another.
    if (target.isAdmin === 1) return sendError(reply, 400, 'cannot_suspend_admin');

    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const reason = boundedText(body.reason, SUSPENSION_LIMITS.REASON_MIN_LENGTH, SUSPENSION_LIMITS.REASON_MAX_LENGTH);
    if (reason === null) {
      return sendError(reply, 400, 'suspension_reason_invalid', {
        min: SUSPENSION_LIMITS.REASON_MIN_LENGTH,
        max: SUSPENSION_LIMITS.REASON_MAX_LENGTH,
      });
    }
    const hours = body.durationHours;
    const indefinite = hours === null;
    if (!indefinite && (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > SUSPENSION_LIMITS.MAX_DURATION_HOURS)) {
      return sendError(reply, 400, 'suspension_duration_invalid', { max: SUSPENSION_LIMITS.MAX_DURATION_HOURS });
    }

    const now = Date.now();
    applySuspension(target, request.userId, reason, indefinite ? null : hours as number, now);

    const updated = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    return reply.code(200).send(toAdminUser(updated ?? target, now));
  });

  // POST /api/admin/users/:id/unsuspend — lift a suspension, or clear one that ran out.
  app.post<{ Params: { id: string }; Body: unknown }>('/api/admin/users/:id/unsuspend', ADMIN, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();
    const target = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!target) return sendError(reply, 404, 'user_not_found');
    if (target.suspendedAt === null) return sendError(reply, 409, 'user_not_suspended');
    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const reason = body.reason === undefined || body.reason === null || body.reason === ''
      ? null
      : boundedText(body.reason, 1, SUSPENSION_LIMITS.REASON_MAX_LENGTH);
    if (reason === null && body.reason !== undefined && body.reason !== null && body.reason !== '') {
      return sendError(reply, 400, 'suspension_reason_invalid', { min: 1, max: SUSPENSION_LIMITS.REASON_MAX_LENGTH });
    }

    const now = Date.now();
    const wasActive = activeSuspension(target, now) !== null;
    db.update(schema.users)
      .set({ suspendedAt: null, suspendedUntil: null, suspensionReason: null })
      .where(eq(schema.users.id, id)).run();
    recordPlatformAudit({
      actorId: request.userId,
      action: 'user_unsuspend',
      targetType: 'user',
      targetId: id,
      targetLabel: target.username,
      reason,
      details: { expired: !wasActive },
    }, now);

    const updated = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    return reply.code(200).send(toAdminUser(updated ?? target, now));
  });

  // PUT /api/admin/users/:id/badges — the badges an admin gives the person.
  // Staff is never among them: it follows the admin role.
  app.put<{ Params: { id: string }; Body: unknown }>('/api/admin/users/:id/badges', ADMIN, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();
    const target = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!target) return sendError(reply, 404, 'user_not_found');
    if (target.isDeleted === 1) return sendError(reply, 400, 'user_already_deleted');
    const badges = badgeListOf(request.body, isGrantedUserBadge);
    if (badges === null) return sendError(reply, 400, 'badge_invalid');

    const before = grantedUserBadgesOf(target.badges);
    db.update(schema.users).set({ badges: badges.length > 0 ? JSON.stringify(badges) : null })
      .where(eq(schema.users.id, id)).run();
    const added = badges.filter((badge) => !before.includes(badge));
    const removed = before.filter((badge) => !badges.includes(badge));
    if (added.length > 0 || removed.length > 0) {
      recordPlatformAudit({
        actorId: request.userId,
        action: 'user_badges',
        targetType: 'user',
        targetId: id,
        targetLabel: target.username,
        reason: badgeReason(request.body),
        details: { added, removed },
      });
      announceUserUpdate(id);
    }
    const updated = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    return reply.code(200).send(toAdminUser(updated ?? target));
  });

  // ─── Spaces ───────────────────────────────────────────────────────────────

  app.get<{ Querystring: { q?: string; filter?: string; visibility?: string; page?: string; pageSize?: string } }>('/api/admin/spaces', ADMIN, async (request, reply) => {
    const q = (request.query.q ?? '').trim().slice(0, 100);
    const filter: AdminSpaceFilter = request.query.filter === 'listed' || request.query.filter === 'verified' || request.query.filter === 'open_review'
      ? request.query.filter
      : 'all';
    const page = Math.max(1, parseInt(request.query.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize ?? '50', 10) || 50));

    const conditions: string[] = [];
    const params: string[] = [];
    if (q) {
      conditions.push(`(s.name LIKE ? ESCAPE '\\' OR s.id = ?)`);
      params.push(containsPattern(q), q);
    }
    if (request.query.visibility === 'public') conditions.push(`s.visibility = 'public'`);
    if (filter === 'listed') conditions.push(`(${LISTED_IN_DISCOVERY_SQL})`);
    if (filter === 'verified') conditions.push(`s.verification_status = 'verified'`);
    if (filter === 'open_review') {
      conditions.push(`(s.verification_status IN ('pending', 'needs_info') OR s.discovery_status IN ('pending', 'changes_requested'))`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const raw = getRawDb();
    const total = (raw.prepare(`SELECT COUNT(*) AS n FROM spaces s ${where}`).get(...params) as { n: number }).n;
    const ids = (raw.prepare(`SELECT s.id FROM spaces s ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as { id: string }[]).map((row) => row.id);
    const rows = ids.length > 0 ? getDb().select().from(schema.spaces).where(inArray(schema.spaces.id, ids)).all() : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id)).filter((row): row is SpaceRow => row !== undefined);

    const response: AdminSpaceListResponse = { spaces: spaceSummaries(ordered), total, page, pageSize };
    return reply.code(200).send(response);
  });

  app.get<{ Params: { id: string } }>('/api/admin/spaces/:id', ADMIN, async (request, reply) => {
    const space = spaceRow(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    const detail: AdminSpaceDetail = {
      space: spaceSummary(space),
      description: space.description,
      banner: space.banner,
      vanityCode: space.vanityCode ?? null,
      review: reviewStateOf(space),
      audit: readPlatformAudit({ limit: 20, targetType: 'space', targetId: space.id }).entries,
    };
    return reply.code(200).send(detail);
  });

  // PUT /api/admin/spaces/:id/badges — the badges an admin gives a space.
  // Verified is never among them: it follows the verification.
  app.put<{ Params: { id: string }; Body: unknown }>('/api/admin/spaces/:id/badges', ADMIN, async (request, reply) => {
    const space = spaceRow(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    const badges = badgeListOf(request.body, isGrantedSpaceBadge);
    if (badges === null) return sendError(reply, 400, 'badge_invalid');

    const before = grantedSpaceBadgesOf(space.badges);
    getDb().update(schema.spaces).set({ badges: badges.length > 0 ? JSON.stringify(badges) : null })
      .where(eq(schema.spaces.id, space.id)).run();
    const added = badges.filter((badge) => !before.includes(badge));
    const removed = before.filter((badge) => !badges.includes(badge));
    if (added.length > 0 || removed.length > 0) {
      recordPlatformAudit({
        actorId: request.userId,
        action: 'space_badges',
        targetType: 'space',
        targetId: space.id,
        targetLabel: space.name,
        reason: badgeReason(request.body),
        details: { added, removed },
      });
      announceSpaceUpdate(space.id);
    }
    return reply.code(200).send(spaceSummary(spaceRow(space.id) ?? space));
  });

  // ─── Reviews ──────────────────────────────────────────────────────────────

  // POST /api/admin/spaces/:id/vanity/revoke — takes a space's own invite address away. Nobody can
  // take it again, the owner is told why, and the space's other links go on working.
  app.post<{ Params: { id: string }; Body: unknown }>('/api/admin/spaces/:id/vanity/revoke', ADMIN, async (request, reply) => {
    const space = spaceRow(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    const code = revokeVanityCode(space.id);
    if (code === null) return sendError(reply, 404, 'vanity_code_not_found');
    const reason = badgeReason(request.body);
    recordPlatformAudit({
      actorId: request.userId,
      action: 'space_vanity_revoke',
      targetType: 'space',
      targetId: space.id,
      targetLabel: space.name,
      reason,
      details: { code },
    });
    sendNotice(space.ownerId, { kind: 'address_withdrawn', note: reason, subject: `/join/${code}` });
    announceSpaceUpdate(space.id);
    return reply.code(200).send({ vanityCode: null });
  });

  // GET /api/admin/reviews — every open request, oldest first.
  app.get('/api/admin/reviews', ADMIN, async (_request, reply) => {
    const open = openReviewSpaceIds();
    const allIds = [...new Set([...open.verification, ...open.discovery])];
    const rows = allIds.length > 0 ? getDb().select().from(schema.spaces).where(inArray(schema.spaces.id, allIds)).all() : [];
    const summaries = new Map(spaceSummaries(rows).map((summary) => [summary.id, summary]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const requests = reviewRequestsOf(allIds);

    const verification: VerificationQueueItem[] = [];
    for (const id of open.verification) {
      const row = byId.get(id);
      const space = summaries.get(id);
      const request = requests.verification.get(id);
      const status = row ? verificationStatusOf(row) : null;
      if (row && space && request && status) verification.push({ space, description: row.description, status, request });
    }
    const discovery: DiscoveryQueueItem[] = [];
    for (const id of open.discovery) {
      const row = byId.get(id);
      const space = summaries.get(id);
      const request = requests.discovery.get(id);
      const status = row ? discoveryStatusOf(row) : null;
      if (row && space && request && status) discovery.push({ space, description: row.description, banner: row.banner, status, request });
    }
    verification.sort((a, b) => a.request.requestedAt - b.request.requestedAt);
    discovery.sort((a, b) => a.request.requestedAt - b.request.requestedAt);

    const response: ReviewQueueResponse = { verification, discovery };
    return reply.code(200).send(response);
  });

  // POST /api/admin/spaces/:id/verification/:decision — approve, reject,
  // request_info or revoke. The owner reads the note.
  app.post<{ Params: { id: string; decision: string }; Body: unknown }>('/api/admin/spaces/:id/verification/:decision', ADMIN, async (request, reply) => {
    const { decision } = request.params;
    if (!isVerificationDecision(decision)) return sendError(reply, 400, 'review_decision_invalid');
    const space = spaceRow(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    const note = parseReviewNote(request.body, VERIFICATION_DECISIONS[decision].noteRequired);
    if (isReviewRefusal(note)) return refuse(reply, note);

    const result = decideVerification(space, decision, request.userId, note, decisionTime(request.body));
    if (isReviewRefusal(result)) return refuse(reply, result);
    announceReviewStep(space, result);
    const action: PlatformAuditAction = `verification_${decision}`;
    recordPlatformAudit({
      actorId: request.userId,
      action,
      targetType: 'space',
      targetId: space.id,
      targetLabel: space.name,
      reason: note,
      details: { status: result.status },
    });
    return reply.code(200).send(reviewStateOf(spaceRow(space.id) ?? space));
  });

  // POST /api/admin/spaces/:id/discovery/:decision — approve, reject,
  // request_changes or withdraw a listing.
  app.post<{ Params: { id: string; decision: string }; Body: unknown }>('/api/admin/spaces/:id/discovery/:decision', ADMIN, async (request, reply) => {
    const { decision } = request.params;
    if (!isDiscoveryDecision(decision)) return sendError(reply, 400, 'review_decision_invalid');
    const space = spaceRow(request.params.id);
    if (!space) return sendError(reply, 404, 'space_not_found');
    const note = parseReviewNote(request.body, DISCOVERY_DECISIONS[decision].noteRequired);
    if (isReviewRefusal(note)) return refuse(reply, note);

    const result = decideDiscovery(space, decision, request.userId, note, decisionTime(request.body));
    if (isReviewRefusal(result)) return refuse(reply, result);
    announceReviewStep(space, result);
    const action: PlatformAuditAction = `discovery_${decision}`;
    recordPlatformAudit({
      actorId: request.userId,
      action,
      targetType: 'space',
      targetId: space.id,
      targetLabel: space.name,
      reason: note,
      details: { status: result.status },
    });
    return reply.code(200).send(reviewStateOf(spaceRow(space.id) ?? space));
  });

  // ─── Audit log ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { before?: string; limit?: string; targetType?: string; targetId?: string; action?: string } }>('/api/admin/audit', ADMIN, async (request, reply) => {
    const { before, targetType, targetId, action } = request.query;
    if (before !== undefined && !/^\d{1,20}$/.test(before)) return sendError(reply, 400, 'validation_failed', { field: 'before' });
    if (targetType !== undefined && !isAuditTargetType(targetType)) {
      return sendError(reply, 400, 'validation_failed', { field: 'targetType' });
    }
    if (action !== undefined && !isPlatformAuditAction(action)) return sendError(reply, 400, 'validation_failed', { field: 'action' });
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? String(PLATFORM_AUDIT_PAGE_SIZE), 10) || PLATFORM_AUDIT_PAGE_SIZE));
    return reply.code(200).send(readPlatformAudit({
      before,
      limit,
      targetType,
      targetId: targetId?.slice(0, 64),
      action,
    }));
  });
}
