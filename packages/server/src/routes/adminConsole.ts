import { isSignupChallengeLevel, type SignupChallengeLevel } from '@backspace/shared/src/signupChallenge.js';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import {
  ADMIN_NOTE_LIMITS,
  ADMIN_SEARCH_LIMITS,
  ANNOUNCEMENT_LIMITS,
  DASHBOARD_DAYS,
  SIGNUP_RULE_LIMITS,
  STARTER_SPACES_MAX,
  USUAL_RESERVED_USERNAMES,
  WARNING_LIMITS,
  isAnnouncementTone,
  isSignupRuleKind,
  type AdminDashboard,
  type AdminNotesResponse,
  type AdminSearchResponse,
  type AdminSearchSpace,
  type AdminSystemInfo,
  type Announcement,
  type AnnouncementsResponse,
  type SignupRulesResponse,
  type StarterSpacesResponse,
} from '@backspace/shared/src/adminConsole.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { connectionManager } from '../ws/handler.js';
import { platformActors, readPlatformAudit, recordPlatformAudit } from '../utils/platformAudit.js';
import { createSnapshot, listSnapshots, pruneSnapshots } from '../utils/backup.js';
import { eventLoopStats } from '../utils/runtimeStats.js';
import { activeAlerts } from '../utils/operatorAlerts.js';
import { LISTED_IN_DISCOVERY_SQL, openReviewCounts } from '../utils/spaceReview.js';
import { openReportCount } from '../utils/reportCount.js';
import { sendNotice } from '../utils/reports.js';
import { emailState } from '../email/service.js';
import { normalizeEmail } from '../email/address.js';
import { twoFactorAvailable } from '../security/twoFactor.js';
import { listSecurityEvents, recordSecurityEvent } from '../security/events.js';
import { endOtherSessions, endSession, listSessions } from '../utils/sessions.js';
import { listSignupRules, normalizeRuleValue } from '../utils/signupRules.js';

// The admin console's own routes (docs/systems/admin.md, "The console"): the dashboard
// and the system page, announcements, searching the instance, exports, what an admin
// can do about one account, who may sign up and where a new account starts. Every route
// but the reading of running announcements is behind requireAdmin, which reads
// `users.is_admin` on this instance, and every change is in the platform audit log.
// Nothing here can touch a person's second factor: that stays with the server's shell.

const ADMIN = { preHandler: [authenticate, requireAdmin] };
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long the dashboard's counts are kept: they read a month of messages. */
const DASHBOARD_TTL_MS = 60_000;
const BACKUP_COOLDOWN_MS = 5 * 60_000;
/** The most an export holds: past that it is a job for the server's shell. */
const EXPORT_MAX_ROWS = 50_000;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || CONTROL.test(trimmed)) return null;
  return trimmed;
}

function bodyOf(request: { body: unknown }): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null ? request.body as Record<string, unknown> : {};
}

// ─── The dashboard ──────────────────────────────────────────────────────────

let dashboardCache: { at: number; value: AdminDashboard } | null = null;

/** For tests: the next request counts again. */
export function resetDashboardCache(): void {
  dashboardCache = null;
}

/** `rows` of day and count as one number per day from `firstDay`, with no holes. */
function dailySeries(rows: readonly { d: number; n: number }[], firstDay: number): number[] {
  const out = new Array<number>(DASHBOARD_DAYS).fill(0);
  for (const row of rows) {
    const at = row.d - firstDay;
    if (at >= 0 && at < DASHBOARD_DAYS) out[at] = row.n;
  }
  return out;
}

function buildDashboard(now: number): AdminDashboard {
  const raw = getRawDb();
  const today = Math.floor(now / DAY_MS);
  const firstDay = today - (DASHBOARD_DAYS - 1);
  const from = firstDay * DAY_MS;

  const signups = raw.prepare(
    `SELECT created_at / ${DAY_MS} AS d, COUNT(*) AS n FROM users
     WHERE home_instance IS NULL AND account_kind = 'person' AND created_at >= ? GROUP BY d`,
  ).all(from) as { d: number; n: number }[];
  const messages = raw.prepare(
    `SELECT d, SUM(n) AS n FROM (
       SELECT created_at / ${DAY_MS} AS d, COUNT(*) AS n FROM messages WHERE created_at >= ? GROUP BY d
       UNION ALL
       SELECT created_at / ${DAY_MS} AS d, COUNT(*) AS n FROM dm_messages WHERE created_at >= ? GROUP BY d
     ) GROUP BY d`,
  ).all(from, from) as { d: number; n: number }[];
  const active = raw.prepare(
    `SELECT d, COUNT(DISTINCT user_id) AS n FROM (
       SELECT created_at / ${DAY_MS} AS d, user_id FROM messages WHERE created_at >= ? AND user_id NOT IN (SELECT id FROM users WHERE account_kind <> 'person')
       UNION ALL
       SELECT created_at / ${DAY_MS} AS d, user_id FROM dm_messages WHERE created_at >= ?
     ) GROUP BY d`,
  ).all(from, from) as { d: number; n: number }[];
  const mailRows = raw.prepare('SELECT day, accepted FROM email_usage_daily WHERE day >= ?')
    .all(new Date(from).toISOString().slice(0, 10)) as { day: string; accepted: number }[];
  const mail = mailRows.map((row) => ({ d: Math.floor(Date.parse(`${row.day}T00:00:00Z`) / DAY_MS), n: row.accepted }));

  const accounts = raw.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(is_admin), 0) AS admins,
            COALESCE(SUM(CASE WHEN suspended_at IS NOT NULL AND (suspended_until IS NULL OR suspended_until > ?) THEN 1 ELSE 0 END), 0) AS suspended,
            COALESCE(SUM(CASE WHEN two_factor_enabled_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS twoFactor,
            COALESCE(SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS confirmedEmail
     FROM users WHERE home_instance IS NULL AND account_kind = 'person' AND (is_deleted IS NULL OR is_deleted = 0)`,
  ).get(now) as { total: number; admins: number; suspended: number; twoFactor: number; confirmedEmail: number };
  const spaces = raw.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN ${LISTED_IN_DISCOVERY_SQL} THEN 1 ELSE 0 END), 0) AS listed,
            COALESCE(SUM(CASE WHEN s.verification_status = 'verified' THEN 1 ELSE 0 END), 0) AS verified
     FROM spaces s`,
  ).get() as { total: number; listed: number; verified: number };

  return {
    generatedAt: now,
    firstDay,
    series: {
      signups: dailySeries(signups, firstDay),
      messages: dailySeries(messages, firstDay),
      activeAccounts: dailySeries(active, firstDay),
      mail: dailySeries(mail, firstDay),
    },
    accounts: {
      total: accounts.total,
      online: 0,
      suspended: accounts.suspended,
      admins: accounts.admins,
      twoFactor: accounts.twoFactor,
      confirmedEmail: accounts.confirmedEmail,
    },
    spaces,
    open: { reports: 0, reviews: 0, alerts: 0 },
  };
}

function openNow(): AdminDashboard['open'] {
  const reviews = openReviewCounts();
  return { reports: openReportCount(), reviews: reviews.verificationOpen + reviews.discoveryOpen, alerts: activeAlerts().length };
}

// ─── Announcements ──────────────────────────────────────────────────────────

function toAnnouncement(row: typeof schema.announcements.$inferSelect): Announcement {
  return {
    id: row.id,
    tone: row.tone as Announcement['tone'],
    body: row.body,
    createdAt: row.createdAt,
    endsAt: row.endsAt,
    endedAt: row.endedAt,
    onStatusPage: row.onStatusPage === 1,
  };
}

/** What runs now: not ended by hand, and not past its end. */
function runningAnnouncements(now: number): Announcement[] {
  return getDb().select().from(schema.announcements)
    .where(and(isNull(schema.announcements.endedAt), or(isNull(schema.announcements.endsAt), gt(schema.announcements.endsAt, now))))
    .orderBy(desc(sql`CAST(${schema.announcements.id} AS INTEGER)`))
    .all()
    .map(toAnnouncement);
}

function tellEveryone(): void {
  for (const userId of connectionManager.getAllOnlineUserIds()) {
    connectionManager.sendToUser(userId, { type: 'announcements_changed' });
  }
}

// ─── Searching ──────────────────────────────────────────────────────────────

/** Text to look for inside a value, with SQL's own wildcards taken as plain characters. */
function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const SPACE_HIT_SQL = `SELECT s.id AS id, s.name AS name, s.icon AS icon, s.avatar_color AS avatarColor, s.visibility AS visibility,
  (SELECT COUNT(*) FROM space_members m WHERE m.space_id = s.id) AS memberCount
  FROM spaces s`;

// ─── Exports ────────────────────────────────────────────────────────────────

/**
 * One cell of a CSV file. A spreadsheet runs a cell that starts like a formula, and these
 * cells hold what people typed as their names, so such a cell is marked as text.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  // A semicolon is the separator in a spreadsheet set to German, so it gets quotes as a comma does.
  return /[",;\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(cells: readonly (string | number | boolean | null | undefined)[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

function sendCsv(reply: FastifyReply, name: string, lines: string[]): FastifyReply {
  return reply
    .code(200)
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}"`)
    .header('cache-control', 'no-store')
    // Excel reads UTF-8 only with this mark in front.
    .send(`﻿${lines.join('')}`);
}

function isoTime(at: number | null | undefined): string {
  return typeof at === 'number' ? new Date(at).toISOString() : '';
}

// ─── The routes ─────────────────────────────────────────────────────────────

/** The stored level, what the admin set: a test harness's switch does not move it. */
function storedChallengeLevel(): SignupChallengeLevel {
  const level = getDb().select({ level: schema.instanceSettings.signupChallenge }).from(schema.instanceSettings).get()?.level;
  return isSignupChallengeLevel(level) ? level : 'off';
}

export async function adminConsoleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/dashboard', ADMIN, async (_request, reply) => {
    const now = Date.now();
    if (!dashboardCache || now - dashboardCache.at > DASHBOARD_TTL_MS) {
      dashboardCache = { at: now, value: buildDashboard(now) };
    }
    // What the day's counts cost is kept; who is here and what waits is asked each time.
    const cached = dashboardCache.value;
    const live: AdminDashboard = {
      ...cached,
      accounts: { ...cached.accounts, online: connectionManager.getAllOnlineUserIds().length },
      open: openNow(),
    };
    return reply.code(200).send(live);
  });

  // ─── The system ─────────────────────────────────────────────────────────

  app.get('/api/admin/system', ADMIN, async (_request, reply) => {
    const memory = process.memoryUsage();
    const sizeOf = (file: string): number => {
      try { return fs.statSync(file).size; } catch { return 0; }
    };
    let disk: AdminSystemInfo['disk'] = null;
    try {
      const stats = fs.statfsSync(path.dirname(config.dbPath));
      disk = { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
    } catch {
      disk = null;
    }
    const info: AdminSystemInfo = {
      version: config.version,
      commit: config.commit,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
      eventLoop: eventLoopStats(),
      sockets: connectionManager.socketCounts(),
      database: { bytes: sizeOf(config.dbPath) + sizeOf(`${config.dbPath}-wal`) },
      disk,
      // The name of a file and no more: where the server keeps it is not the console's business.
      alerts: activeAlerts(),
      backups: listSnapshots().map((snapshot) => ({
        name: path.basename(snapshot.path),
        reason: snapshot.reason,
        bytes: snapshot.bytes,
        createdAt: snapshot.mtimeMs,
      })),
      backupIntervalHours: config.backup.intervalHours,
      services: {
        email: emailState(),
        twoFactor: twoFactorAvailable(),
        translation: config.translation.provider === 'none' ? null : config.translation.provider,
        voice: !!config.livekit.url,
        federation: config.federation.enabled,
      },
    };
    return reply.code(200).send(info);
  });

  // A backup, and only that: restoring one and downloading the database stay with the
  // server's shell, so that signing in as an admin is not a way to take everything.
  app.post('/api/admin/system/backup', {
    ...ADMIN,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const now = Date.now();
    const latest = listSnapshots().filter((snapshot) => snapshot.reason === 'console').sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (latest && now - latest.mtimeMs < BACKUP_COOLDOWN_MS) {
      return sendError(reply, 429, 'backup_too_soon', { seconds: Math.ceil((BACKUP_COOLDOWN_MS - (now - latest.mtimeMs)) / 1000) });
    }
    // A reason of its own, so that pressing this cannot rotate away the copies from before an update.
    const file = createSnapshot(getRawDb(), 'console');
    pruneSnapshots();
    recordPlatformAudit({
      actorId: request.userId,
      action: 'backup_create',
      targetType: 'instance',
      targetId: 'backup',
      details: { name: path.basename(file) },
    });
    return reply.code(201).send({ name: path.basename(file) });
  });

  // ─── Announcements ──────────────────────────────────────────────────────

  // For everyone signed in: this is what the banner shows.
  app.get('/api/announcements', { preHandler: authenticate }, async (_request, reply) => {
    const response: AnnouncementsResponse = { announcements: runningAnnouncements(Date.now()) };
    return reply.code(200).send(response);
  });

  app.get('/api/admin/announcements', ADMIN, async (_request, reply) => {
    const rows = getDb().select().from(schema.announcements)
      .orderBy(desc(sql`CAST(${schema.announcements.id} AS INTEGER)`))
      .limit(50)
      .all();
    const response: AnnouncementsResponse = { announcements: rows.map(toAnnouncement) };
    return reply.code(200).send(response);
  });

  app.post<{ Body: unknown }>('/api/admin/announcements', ADMIN, async (request, reply) => {
    const body = bodyOf(request);
    const text = boundedText(body.body, ANNOUNCEMENT_LIMITS.BODY_MIN_LENGTH, ANNOUNCEMENT_LIMITS.BODY_MAX_LENGTH);
    if (text === null) return sendError(reply, 400, 'validation_failed', { field: 'body' });
    if (!isAnnouncementTone(body.tone)) return sendError(reply, 400, 'validation_failed', { field: 'tone' });
    const hours = body.durationHours;
    if (hours !== null && hours !== undefined
      && (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > ANNOUNCEMENT_LIMITS.MAX_DURATION_HOURS)) {
      return sendError(reply, 400, 'validation_failed', { field: 'durationHours' });
    }
    const now = Date.now();
    if (runningAnnouncements(now).length >= ANNOUNCEMENT_LIMITS.MAX_ACTIVE) {
      return sendError(reply, 409, 'announcement_limit', { max: ANNOUNCEMENT_LIMITS.MAX_ACTIVE });
    }
    const row = {
      id: generateSnowflake(),
      tone: body.tone,
      body: text,
      createdBy: request.userId,
      createdAt: now,
      endsAt: typeof hours === 'number' ? now + hours * 60 * 60 * 1000 : null,
      endedAt: null,
      onStatusPage: body.onStatusPage === true ? 1 : 0,
    };
    getDb().insert(schema.announcements).values(row).run();
    recordPlatformAudit({
      actorId: request.userId,
      action: 'announcement_create',
      targetType: 'instance',
      targetId: row.id,
      reason: text,
      details: { tone: row.tone, endsAt: row.endsAt },
    });
    tellEveryone();
    return reply.code(201).send(toAnnouncement(row));
  });

  app.post<{ Params: { id: string } }>('/api/admin/announcements/:id/end', ADMIN, async (request, reply) => {
    const db = getDb();
    const row = db.select().from(schema.announcements).where(eq(schema.announcements.id, request.params.id)).get();
    if (!row) return sendError(reply, 404, 'not_found');
    const now = Date.now();
    if (row.endedAt === null) {
      db.update(schema.announcements).set({ endedAt: now }).where(eq(schema.announcements.id, row.id)).run();
      recordPlatformAudit({
        actorId: request.userId,
        action: 'announcement_end',
        targetType: 'instance',
        targetId: row.id,
        reason: row.body,
      });
      tellEveryone();
    }
    return reply.code(200).send(toAnnouncement({ ...row, endedAt: row.endedAt ?? now }));
  });

  // ─── Searching the instance ─────────────────────────────────────────────

  app.get<{ Querystring: { q?: string } }>('/api/admin/search', {
    ...ADMIN,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const query = (request.query.q ?? '').trim().slice(0, ADMIN_SEARCH_LIMITS.QUERY_MAX_LENGTH);
    if (query.length < ADMIN_SEARCH_LIMITS.QUERY_MIN_LENGTH) {
      const empty: AdminSearchResponse = { users: [], spaces: [] };
      return reply.code(200).send(empty);
    }
    const raw = getRawDb();
    const pattern = containsPattern(query);
    const lower = query.toLowerCase();
    // A whole confirmed address finds its account; part of one finds nothing, so this is no way to read
    // them out, and one anybody could have typed in finds nothing either.
    const address = normalizeEmail(query);
    const users = raw.prepare(
      `SELECT id, username, display_name AS displayName, avatar, avatar_color AS avatarColor,
              is_admin AS isAdmin, home_instance AS homeInstance,
              CASE WHEN suspended_at IS NOT NULL AND (suspended_until IS NULL OR suspended_until > ?) THEN 1 ELSE 0 END AS suspended
       FROM users
       WHERE (is_deleted IS NULL OR is_deleted = 0) AND account_kind = 'person'
         AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR id = ? OR (email = ? AND email_verified_at IS NOT NULL))
       ORDER BY CASE WHEN lower(username) = ? THEN 0 WHEN lower(username) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, username
       LIMIT ?`,
    ).all(Date.now(), pattern, pattern, query, address ?? '', lower, containsPattern(lower).slice(1), ADMIN_SEARCH_LIMITS.RESULTS) as {
      id: string; username: string; displayName: string | null; avatar: string | null; avatarColor: string | null;
      isAdmin: number; homeInstance: string | null; suspended: number;
    }[];
    const spaces = raw.prepare(
      `${SPACE_HIT_SQL} WHERE s.name LIKE ? ESCAPE '\\' OR s.id = ? ORDER BY s.name LIMIT ?`,
    ).all(pattern, query, ADMIN_SEARCH_LIMITS.RESULTS) as AdminSearchSpace[];
    const response: AdminSearchResponse = {
      users: users.map((user) => ({ ...user, isAdmin: user.isAdmin === 1, suspended: user.suspended === 1 })),
      spaces,
    };
    return reply.code(200).send(response);
  });

  // ─── Exports ────────────────────────────────────────────────────────────

  // The accounts as a table. No addresses in it, and no sign-in places: a file travels,
  // and what an operator needs from a list of accounts is who and in what state.
  app.get('/api/admin/users.csv', {
    ...ADMIN,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const now = Date.now();
    const rows = getRawDb().prepare(
      `SELECT id, username, display_name AS displayName, created_at AS createdAt, is_admin AS isAdmin,
              home_instance AS homeInstance, suspended_at AS suspendedAt, suspended_until AS suspendedUntil,
              email_verified_at AS emailVerifiedAt, two_factor_enabled_at AS twoFactorAt
       FROM users WHERE (is_deleted IS NULL OR is_deleted = 0) AND account_kind = 'person'
       ORDER BY CAST(id AS INTEGER) LIMIT ?`,
    ).all(EXPORT_MAX_ROWS) as {
      id: string; username: string; displayName: string | null; createdAt: number; isAdmin: number; homeInstance: string | null;
      suspendedAt: number | null; suspendedUntil: number | null; emailVerifiedAt: number | null; twoFactorAt: number | null;
    }[];
    recordPlatformAudit({
      actorId: request.userId,
      action: 'accounts_export',
      targetType: 'instance',
      targetId: 'accounts',
      details: { rows: rows.length },
    });
    return sendCsv(reply, 'accounts.csv', [
      csvLine(['id', 'username', 'display_name', 'created_at', 'admin', 'home_instance', 'suspended', 'email_confirmed', 'two_factor']),
      ...rows.map((row) => csvLine([
        row.id, row.username, row.displayName, isoTime(row.createdAt), row.isAdmin === 1, row.homeInstance,
        row.suspendedAt !== null && (row.suspendedUntil === null || row.suspendedUntil > now), row.emailVerifiedAt !== null, row.twoFactorAt !== null,
      ])),
    ]);
  });

  app.get('/api/admin/audit.csv', {
    ...ADMIN,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const lines = [csvLine(['id', 'time', 'action', 'admin', 'target_type', 'target_id', 'target', 'reason', 'details'])];
    let before: string | undefined;
    let rows = 0;
    while (rows < EXPORT_MAX_ROWS) {
      const page = readPlatformAudit({ before, limit: 100 });
      for (const entry of page.entries) {
        lines.push(csvLine([
          entry.id, isoTime(entry.createdAt), entry.action, entry.actor?.username ?? null, entry.targetType, entry.targetId,
          entry.targetLabel, entry.reason, entry.details ? JSON.stringify(entry.details) : null,
        ]));
        rows += 1;
      }
      if (!page.hasMore || page.entries.length === 0) break;
      before = page.entries[page.entries.length - 1]!.id;
    }
    recordPlatformAudit({
      actorId: request.userId,
      action: 'audit_export',
      targetType: 'instance',
      targetId: 'audit',
      details: { rows },
    });
    return sendCsv(reply, 'platform-audit.csv', lines);
  });

  // ─── One account ────────────────────────────────────────────────────────

  const accountOf = (id: string) => getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();

  app.get<{ Params: { id: string } }>('/api/admin/users/:id/sessions', ADMIN, async (request, reply) => {
    if (!accountOf(request.params.id)) return sendError(reply, 404, 'user_not_found');
    return reply.code(200).send({ sessions: listSessions(request.params.id, null) });
  });

  // Ending someone's sessions signs them out; it is in their own security activity, without
  // the admin's device or address, and a suspension is what keeps them out.
  app.delete<{ Params: { id: string; sessionId: string } }>('/api/admin/users/:id/sessions/:sessionId', ADMIN, async (request, reply) => {
    const { id, sessionId } = request.params;
    if (id === request.userId) return sendError(reply, 400, 'cannot_target_self');
    const target = accountOf(id);
    if (!target) return sendError(reply, 404, 'user_not_found');
    if (!endSession(id, sessionId)) return sendError(reply, 404, 'not_found');
    connectionManager.closeSessionSockets(new Set([sessionId]));
    recordSecurityEvent(id, 'sessions_ended_by_admin');
    recordPlatformAudit({
      actorId: request.userId,
      action: 'user_sessions_end',
      targetType: 'user',
      targetId: id,
      targetLabel: target.username,
      details: { sessions: 1 },
    });
    return reply.code(200).send({ sessions: listSessions(id, null) });
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/sessions/end-all', ADMIN, async (request, reply) => {
    const { id } = request.params;
    if (id === request.userId) return sendError(reply, 400, 'cannot_target_self');
    const target = accountOf(id);
    if (!target) return sendError(reply, 404, 'user_not_found');
    const ended = endOtherSessions(id, null);
    connectionManager.closeSessionSockets(new Set(ended));
    recordSecurityEvent(id, 'sessions_ended_by_admin');
    recordPlatformAudit({
      actorId: request.userId,
      action: 'user_sessions_end',
      targetType: 'user',
      targetId: id,
      targetLabel: target.username,
      details: { sessions: ended.length },
    });
    return reply.code(200).send({ sessions: [] });
  });

  app.get<{ Params: { id: string } }>('/api/admin/users/:id/security', ADMIN, async (request, reply) => {
    if (!accountOf(request.params.id)) return sendError(reply, 404, 'user_not_found');
    return reply.code(200).send({ events: listSecurityEvents(request.params.id) });
  });

  const notesOf = (userId: string): AdminNotesResponse => {
    const rows = getDb().select().from(schema.adminNotes)
      .where(eq(schema.adminNotes.userId, userId))
      .orderBy(desc(sql`CAST(${schema.adminNotes.id} AS INTEGER)`))
      .all();
    const authors = platformActors(rows.map((row) => row.authorId));
    return {
      notes: rows.map((row) => ({
        id: row.id,
        body: row.body,
        author: authors.get(row.authorId) ?? null,
        createdAt: row.createdAt,
      })),
    };
  };

  app.get<{ Params: { id: string } }>('/api/admin/users/:id/notes', ADMIN, async (request, reply) => {
    if (!accountOf(request.params.id)) return sendError(reply, 404, 'user_not_found');
    return reply.code(200).send(notesOf(request.params.id));
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/admin/users/:id/notes', ADMIN, async (request, reply) => {
    const { id } = request.params;
    const target = accountOf(id);
    if (!target) return sendError(reply, 404, 'user_not_found');
    if (target.isDeleted === 1) return sendError(reply, 400, 'user_already_deleted');
    const text = boundedText(bodyOf(request).body, ADMIN_NOTE_LIMITS.BODY_MIN_LENGTH, ADMIN_NOTE_LIMITS.BODY_MAX_LENGTH);
    if (text === null) return sendError(reply, 400, 'validation_failed', { field: 'body' });
    const now = Date.now();
    getDb().insert(schema.adminNotes).values({ id: generateSnowflake(), userId: id, authorId: request.userId, body: text, createdAt: now }).run();
    // That a note was written, and not what it says: the audit log outlives the account.
    recordPlatformAudit({ actorId: request.userId, action: 'user_note_add', targetType: 'user', targetId: id, targetLabel: target.username });
    return reply.code(201).send(notesOf(id));
  });

  app.delete<{ Params: { id: string; noteId: string } }>('/api/admin/users/:id/notes/:noteId', ADMIN, async (request, reply) => {
    const { id, noteId } = request.params;
    const target = accountOf(id);
    if (!target) return sendError(reply, 404, 'user_not_found');
    const removed = getDb().delete(schema.adminNotes)
      .where(and(eq(schema.adminNotes.id, noteId), eq(schema.adminNotes.userId, id)))
      .run();
    if (removed.changes === 0) return sendError(reply, 404, 'not_found');
    recordPlatformAudit({ actorId: request.userId, action: 'user_note_delete', targetType: 'user', targetId: id, targetLabel: target.username });
    return reply.code(200).send(notesOf(id));
  });

  // A warning is a notice from the operator, with its reason and the way to object, and it
  // changes nothing about the account.
  app.post<{ Params: { id: string }; Body: unknown }>('/api/admin/users/:id/warn', ADMIN, async (request, reply) => {
    const { id } = request.params;
    if (id === request.userId) return sendError(reply, 400, 'cannot_target_self');
    const target = accountOf(id);
    if (!target) return sendError(reply, 404, 'user_not_found');
    if (target.isDeleted === 1) return sendError(reply, 400, 'user_already_deleted');
    const body = bodyOf(request);
    const note = boundedText(body.note, WARNING_LIMITS.NOTE_MIN_LENGTH, WARNING_LIMITS.NOTE_MAX_LENGTH);
    if (note === null) return sendError(reply, 400, 'validation_failed', { field: 'note' });
    if (body.ground !== 'terms' && body.ground !== 'illegal') return sendError(reply, 400, 'validation_failed', { field: 'ground' });
    sendNotice(id, { kind: 'warning', note, ground: body.ground });
    recordPlatformAudit({
      actorId: request.userId,
      action: 'user_warn',
      targetType: 'user',
      targetId: id,
      targetLabel: target.username,
      // The notice holds the words and goes with the account; this log outlives it.
      details: { ground: body.ground },
    });
    return reply.code(200).send({ success: true });
  });

  // ─── Who may sign up ────────────────────────────────────────────────────

  const signupRulesResponse = (): SignupRulesResponse => ({ rules: listSignupRules(), challengeLevel: storedChallengeLevel() });

  // What a browser solves before an account is created.
  app.put<{ Body: unknown }>('/api/admin/signup-rules/challenge', ADMIN, async (request, reply) => {
    const { level } = bodyOf(request);
    if (!isSignupChallengeLevel(level)) return sendError(reply, 400, 'validation_failed', { field: 'level' });
    const before = storedChallengeLevel();
    getDb().update(schema.instanceSettings).set({ signupChallenge: level }).run();
    if (before !== level) {
      recordPlatformAudit({ actorId: request.userId, action: 'signup_challenge_update', targetType: 'instance', targetId: level });
    }
    return reply.code(200).send(signupRulesResponse());
  });

  app.get('/api/admin/signup-rules', ADMIN, async (_request, reply) => {
    const response = signupRulesResponse();
    return reply.code(200).send(response);
  });

  app.post<{ Body: unknown }>('/api/admin/signup-rules', ADMIN, async (request, reply) => {
    const body = bodyOf(request);
    if (!isSignupRuleKind(body.kind)) return sendError(reply, 400, 'validation_failed', { field: 'kind' });
    const kind = body.kind;
    // One value, or the usual names an operator wants nobody else to have.
    const wanted = body.usual === true && kind === 'username' ? [...USUAL_RESERVED_USERNAMES] : [body.value];
    const values = wanted.map((value) => normalizeRuleValue(kind, value));
    if (values.some((value) => value === null)) return sendError(reply, 400, 'signup_rule_invalid');
    const note = body.note === undefined || body.note === null || body.note === ''
      ? null
      : boundedText(body.note, 1, SIGNUP_RULE_LIMITS.NOTE_MAX_LENGTH);
    if (note === null && body.note !== undefined && body.note !== null && body.note !== '') {
      return sendError(reply, 400, 'validation_failed', { field: 'note' });
    }
    const db = getDb();
    const existing = db.select({ n: sql<number>`COUNT(*)` }).from(schema.signupRules).where(eq(schema.signupRules.kind, kind)).get()?.n ?? 0;
    if (existing + values.length > SIGNUP_RULE_LIMITS.MAX_RULES) {
      return sendError(reply, 409, 'signup_rule_limit', { max: SIGNUP_RULE_LIMITS.MAX_RULES });
    }
    const now = Date.now();
    for (const value of values as string[]) {
      const added = db.insert(schema.signupRules)
        .values({ kind, value, note, createdBy: request.userId, createdAt: now })
        .onConflictDoNothing()
        .run();
      if (added.changes > 0) {
        recordPlatformAudit({ actorId: request.userId, action: 'signup_rule_add', targetType: 'instance', targetId: value, details: { kind } });
      }
    }
    const response = signupRulesResponse();
    return reply.code(201).send(response);
  });

  app.delete<{ Params: { kind: string; value: string } }>('/api/admin/signup-rules/:kind/:value', ADMIN, async (request, reply) => {
    const { kind, value } = request.params;
    if (!isSignupRuleKind(kind)) return sendError(reply, 400, 'validation_failed', { field: 'kind' });
    const removed = getDb().delete(schema.signupRules)
      .where(and(eq(schema.signupRules.kind, kind), eq(schema.signupRules.value, value)))
      .run();
    if (removed.changes === 0) return sendError(reply, 404, 'not_found');
    recordPlatformAudit({ actorId: request.userId, action: 'signup_rule_remove', targetType: 'instance', targetId: value, details: { kind } });
    const response = signupRulesResponse();
    return reply.code(200).send(response);
  });

  // ─── Where a new account starts ─────────────────────────────────────────

  const starterSpacesResponse = (): StarterSpacesResponse => ({
    spaces: getRawDb().prepare(
      `${SPACE_HIT_SQL} JOIN starter_spaces t ON t.space_id = s.id ORDER BY t.added_at, s.name`,
    ).all() as AdminSearchSpace[],
  });

  app.get('/api/admin/starter-spaces', ADMIN, async (_request, reply) => {
    return reply.code(200).send(starterSpacesResponse());
  });

  app.put<{ Body: unknown }>('/api/admin/starter-spaces', ADMIN, async (request, reply) => {
    const ids = bodyOf(request).spaceIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      return sendError(reply, 400, 'validation_failed', { field: 'spaceIds' });
    }
    const unique = [...new Set(ids as string[])];
    if (unique.length > STARTER_SPACES_MAX) return sendError(reply, 400, 'starter_spaces_limit', { max: STARTER_SPACES_MAX });
    const db = getDb();
    // A new one must be public: nobody is put into a place they could not have walked into. One
    // chosen earlier may have gone private since; it stays on the list and sign-up skips it, or
    // it would stand in the way of every other change.
    const already = new Set(db.select({ id: schema.starterSpaces.spaceId }).from(schema.starterSpaces).all().map((row) => row.id));
    for (const id of unique.filter((candidate) => !already.has(candidate))) {
      const space = db.select({ visibility: schema.spaces.visibility }).from(schema.spaces).where(eq(schema.spaces.id, id)).get();
      if (!space) return sendError(reply, 404, 'space_not_found');
      if (space.visibility !== 'public') return sendError(reply, 400, 'space_not_public');
    }
    const now = Date.now();
    db.transaction((tx) => {
      tx.delete(schema.starterSpaces).run();
      unique.forEach((spaceId, index) => {
        tx.insert(schema.starterSpaces).values({ spaceId, addedBy: request.userId, addedAt: now + index }).run();
      });
    });
    recordPlatformAudit({
      actorId: request.userId,
      action: 'starter_spaces_update',
      targetType: 'instance',
      targetId: 'starter_spaces',
      details: { spaces: unique },
    });
    return reply.code(200).send(starterSpacesResponse());
  });
}
