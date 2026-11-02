import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { and, desc, eq } from 'drizzle-orm';
import {
  LEGAL_LIMITS,
  LEGAL_TEXT_LANGUAGES,
  REPORT_LIMITS,
  isLegalDocumentKind,
  isLegalTextLanguage,
  isReportDecision,
  isReportGround,
  type AdminLegalDocument,
  type AdminLegalResponse,
  type AdminReportListResponse,
  type LegalDocumentResponse,
  type LegalInfoResponse,
  type LegalTextLanguage,
  type UserNoticeListResponse,
} from '@backspace/shared/src/legal.js';
import { SUSPENSION_LIMITS } from '@backspace/shared/src/platform.js';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { connectionManager } from '../ws/handler.js';
import { getOurOrigin } from '../utils/federationAuth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { platformActors, recordPlatformAudit } from '../utils/platformAudit.js';
import { applySuspension } from '../utils/accountActions.js';
import { decideDiscovery, isReviewRefusal } from '../utils/spaceReview.js';
import { announceReviewStep } from '../utils/reviewNotify.js';
import { SOURCE_DOWNLOAD_PREFIX, sourceDownloadDir } from '../utils/sourceOffer.js';
import {
  currentDocument,
  documentMeta,
  documentState,
  documentTexts,
  nextDocumentVersion,
  parseOperator,
  readOperator,
  securityTxt,
  upcomingDocument,
} from '../utils/legal.js';
import { legalTemplate } from '../utils/legalTemplates.js';
import { openReportCount } from '../utils/reportCount.js';
import {
  adminReports,
  announceReportQueue,
  createReport,
  snapshotFromRow,
  isReportRefusal,
  listReports,
  noticesOf,
  removeReportedMessage,
  sendNotice,
} from '../utils/reports.js';

// The legal basics of an instance (docs/systems/legal.md). The imprint, the
// documents and the report form are public: they must be reachable before and
// without an account. Publishing and deciding are behind requireAdmin.

const ADMIN = { preHandler: [authenticate, requireAdmin] };
const USER = { preHandler: authenticate };
const NOTICE_EXCERPT_MAX = 160;

function pickLanguage(wanted: unknown, available: Partial<Record<LegalTextLanguage, string>>): LegalTextLanguage | null {
  const order: LegalTextLanguage[] = [...(isLegalTextLanguage(wanted) ? [wanted] : []), 'en', 'de'];
  return order.find((language) => available[language] !== undefined) ?? null;
}

export async function legalRoutes(app: FastifyInstance): Promise<void> {
  // ─── Public ───────────────────────────────────────────────────────────────

  // Where to report a vulnerability (RFC 9116). It names the operator's own address, so without
  // one there is nothing to say. Made with each request, since it has to expire ahead of today.
  app.get('/.well-known/security.txt', async (_request, reply) => {
    const operator = readOperator();
    if (!operator) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    return reply
      .type('text/plain; charset=utf-8')
      .send(securityTxt(operator.email, config.publicOrigin ?? `https://${config.domain}`, Date.now()));
  });

  app.get('/api/legal', async (_request, reply) => {
    const response: LegalInfoResponse = {
      operator: readOperator(),
      terms: documentState('terms'),
      privacy: documentState('privacy'),
    };
    reply.header('Cache-Control', 'no-cache');
    return response;
  });

  // ?lang= picks the language, with English and then German as the fallback.
  // ?version=upcoming reads ahead: an announced version people may read and accept early.
  app.get<{ Params: { kind: string }; Querystring: { lang?: string; version?: string } }>('/api/legal/documents/:kind', async (request, reply) => {
    const { kind } = request.params;
    if (!isLegalDocumentKind(kind)) return sendError(reply, 404, 'legal_document_not_found');
    const row = request.query.version === 'upcoming' ? upcomingDocument(kind) : currentDocument(kind);
    if (!row) return sendError(reply, 404, 'legal_document_not_found');
    const texts = documentTexts(row);
    const language = pickLanguage(request.query.lang, texts);
    if (!language) return sendError(reply, 404, 'legal_document_not_found');
    const response: LegalDocumentResponse = { ...documentMeta(row), language, text: texts[language] as string };
    reply.header('Cache-Control', 'no-cache');
    return response;
  });

  // Open to anyone (Art. 16: notices come from "any individual or entity"), so
  // limited per address. A signed-in reporter is named by their account.
  app.post<{ Body: unknown }>('/api/legal/reports', {
    bodyLimit: 64 * 1024,
    // No token: anonymous. A token that no longer holds answers 401 as anywhere
    // else, so a signed-in person is sent to sign in again and not told to name
    // themselves in a form that does not ask them to.
    preHandler: async (request, reply) => {
      if (request.headers.authorization?.startsWith('Bearer ')) await authenticate(request, reply);
    },
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '10 minutes',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request, reply) => {
    const result = createReport(request.body, request.headers.authorization?.startsWith('Bearer ') ? request.userId : null);
    if (isReportRefusal(result)) return sendError(reply, result.refusal.status, result.refusal.code, result.refusal.details);
    return reply.code(201).send(result);
  });

  // The source archive of the running version (AGPL section 13), placed by publish-source.sh.
  fs.mkdirSync(sourceDownloadDir(), { recursive: true });
  await app.register(fastifyStatic, {
    root: sourceDownloadDir(),
    prefix: SOURCE_DOWNLOAD_PREFIX,
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    setHeaders(reply) {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Type', 'application/gzip');
      reply.header('Cache-Control', 'public, max-age=3600');
    },
  });

  // ─── A person's own ───────────────────────────────────────────────────────

  // Agreeing to a version that applies now or is announced. An older version
  // is never recorded over a newer acceptance.
  app.post<{ Body: { version?: unknown } }>('/api/legal/terms/accept', USER, async (request, reply) => {
    const version = request.body?.version;
    const allowed = [currentDocument('terms')?.version, upcomingDocument('terms')?.version];
    if (typeof version !== 'number' || !allowed.includes(version)) return sendError(reply, 400, 'terms_version_invalid');
    const db = getDb();
    const row = db.select({ termsVersion: schema.users.termsVersion }).from(schema.users).where(eq(schema.users.id, request.userId)).get();
    const accepted = Math.max(row?.termsVersion ?? 0, version);
    db.update(schema.users).set({ termsVersion: accepted, termsAcceptedAt: Date.now() }).where(eq(schema.users.id, request.userId)).run();
    return reply.code(200).send({ termsVersion: accepted });
  });

  app.get('/api/legal/notices', USER, async (request) => {
    const response: UserNoticeListResponse = { notices: noticesOf(request.userId) };
    return response;
  });

  app.post<{ Params: { id: string } }>('/api/legal/notices/:id/read', USER, async (request, reply) => {
    const result = getDb().update(schema.userNotices)
      .set({ readAt: Date.now() })
      .where(and(eq(schema.userNotices.id, request.params.id), eq(schema.userNotices.userId, request.userId)))
      .run();
    if (result.changes === 0) return sendError(reply, 404, 'notice_not_found');
    return reply.code(200).send({ success: true });
  });

  // ─── Admin: details and documents ─────────────────────────────────────────

  app.get('/api/admin/legal', ADMIN, async () => {
    const rows = getDb().select().from(schema.legalDocuments)
      .orderBy(desc(schema.legalDocuments.publishedAt))
      .all();
    const actors = platformActors(rows.map((row) => row.publishedBy));
    const response: AdminLegalResponse = {
      operator: readOperator(),
      documents: rows.map((row) => ({ ...documentMeta(row), publishedBy: actors.get(row.publishedBy) ?? null })),
    };
    return response;
  });

  app.put<{ Body: unknown }>('/api/admin/legal/operator', ADMIN, async (request, reply) => {
    const operator = parseOperator(request.body);
    if (!operator) return sendError(reply, 400, 'legal_operator_invalid');
    getDb().update(schema.instanceSettings)
      .set({ legalOperator: JSON.stringify(operator) })
      .where(eq(schema.instanceSettings.id, 1))
      .run();
    recordPlatformAudit({
      actorId: request.userId,
      action: 'legal_operator_update',
      targetType: 'instance',
      targetId: 'legal',
    });
    connectionManager.sendToEveryone({ type: 'legal_updated' });
    return reply.code(200).send(operator);
  });

  app.get<{ Params: { id: string } }>('/api/admin/legal/documents/:id', ADMIN, async (request, reply) => {
    const row = getDb().select().from(schema.legalDocuments).where(eq(schema.legalDocuments.id, request.params.id)).get();
    if (!row) return sendError(reply, 404, 'legal_document_not_found');
    const response: AdminLegalDocument = {
      ...documentMeta(row),
      publishedBy: platformActors([row.publishedBy]).get(row.publishedBy) ?? null,
      texts: documentTexts(row),
    };
    return response;
  });

  // A draft from what this instance has switched on (utils/legalTemplates.ts).
  app.get<{ Params: { kind: string }; Querystring: { lang?: string } }>('/api/admin/legal/templates/:kind', ADMIN, async (request, reply) => {
    const { kind } = request.params;
    const language = request.query.lang;
    if (!isLegalDocumentKind(kind) || !isLegalTextLanguage(language)) return sendError(reply, 404, 'legal_document_not_found');
    const operator = readOperator();
    if (!operator) return sendError(reply, 409, 'legal_operator_required');
    const settings = getDb().select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    const text = legalTemplate(kind, language, {
      operator,
      instanceName: settings?.instanceName ?? DEFAULT_INSTANCE_NAME,
      origin: getOurOrigin(),
      voice: Boolean(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret),
      gifs: Boolean(settings?.gifApiKey),
      translation: config.translation.provider === 'none' ? null : config.translation.provider,
      federation: config.federation.enabled,
      directory: config.directory.endpoint !== '' && settings?.directoryEnabled === 1,
      backupDays: config.backup.keepScheduled,
      backupsBeforeUpdates: config.backup.keepPreMigration,
      backupHandDays: config.backup.handMaxAgeDays,
      starterSpaces: getDb().select({ id: schema.starterSpaces.spaceId }).from(schema.starterSpaces).limit(1).get() !== undefined,
      mail: config.email.transport === 'none' ? null : { provider: config.email.transport, required: settings?.emailRequiredSince != null },
    });
    return { text };
  });

  // Publish a new version. Earlier ones stay, because a person's acceptance names one.
  app.post<{ Body: unknown }>('/api/admin/legal/documents', { ...ADMIN, bodyLimit: 1024 * 1024 }, async (request, reply) => {
    if (!readOperator()) return sendError(reply, 409, 'legal_operator_required');
    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const { kind, texts: rawTexts, effectiveAt: rawEffectiveAt, changes: rawChanges } = body;
    if (!isLegalDocumentKind(kind)) return sendError(reply, 400, 'legal_document_invalid');

    const texts: Partial<Record<LegalTextLanguage, string>> = {};
    if (typeof rawTexts === 'object' && rawTexts !== null) {
      for (const language of LEGAL_TEXT_LANGUAGES) {
        const text = (rawTexts as Record<string, unknown>)[language];
        if (typeof text !== 'string') continue;
        const trimmed = text.replace(/\r\n/g, '\n').trim();
        if (trimmed.length > LEGAL_LIMITS.TEXT_MAX) return sendError(reply, 400, 'legal_document_too_long', { max: LEGAL_LIMITS.TEXT_MAX });
        if (trimmed.length > 0) texts[language] = trimmed;
      }
    }
    if (Object.keys(texts).length === 0) return sendError(reply, 400, 'legal_document_invalid');

    const now = Date.now();
    if (rawEffectiveAt !== null && rawEffectiveAt !== undefined && (typeof rawEffectiveAt !== 'number' || !Number.isFinite(rawEffectiveAt))) {
      return sendError(reply, 400, 'legal_effective_date_invalid');
    }
    const effectiveAt = typeof rawEffectiveAt === 'number' && rawEffectiveAt > now ? rawEffectiveAt : now;

    const changes = typeof rawChanges === 'string' && rawChanges.trim().length > 0 ? rawChanges.trim().slice(0, LEGAL_LIMITS.CHANGES_MAX) : null;
    const version = nextDocumentVersion(kind);
    // People who agreed to the terms are told what changed before they agree again.
    if (kind === 'terms' && version > 1 && changes === null) return sendError(reply, 400, 'legal_changes_required');

    const id = generateSnowflake();
    getDb().insert(schema.legalDocuments).values({
      id,
      kind,
      version,
      texts: JSON.stringify(texts),
      publishedAt: now,
      effectiveAt,
      changes,
      publishedBy: request.userId,
    }).run();
    recordPlatformAudit({
      actorId: request.userId,
      action: 'legal_publish',
      targetType: 'instance',
      targetId: 'legal',
      targetLabel: `${kind} v${version}`,
      details: { kind, version, effectiveAt },
    }, now);
    connectionManager.sendToEveryone({ type: 'legal_updated' });
    return reply.code(201).send({ id, version });
  });

  // ─── Admin: reports ───────────────────────────────────────────────────────

  app.get<{ Querystring: { status?: string; before?: string } }>('/api/admin/reports', ADMIN, async (request) => {
    const status = request.query.status === 'closed' ? 'closed' : 'open';
    const response: AdminReportListResponse = {
      reports: adminReports(listReports(status, request.query.before)),
      open: openReportCount(),
    };
    return response;
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/admin/reports/:id/decide', ADMIN, async (request, reply) => {
    const db = getDb();
    const report = db.select().from(schema.contentReports).where(eq(schema.contentReports.id, request.params.id)).get();
    if (!report) return sendError(reply, 404, 'report_not_found');
    if (report.status !== 'open') return sendError(reply, 409, 'report_already_decided');

    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const { decision, ground: rawGround, durationHours } = body;
    if (!isReportDecision(decision)) return sendError(reply, 400, 'report_decision_invalid');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length < REPORT_LIMITS.NOTE_MIN || note.length > REPORT_LIMITS.NOTE_MAX) {
      return sendError(reply, 400, 'report_note_required', { min: REPORT_LIMITS.NOTE_MIN, max: REPORT_LIMITS.NOTE_MAX });
    }
    const ground = isReportGround(rawGround) ? rawGround : null;
    const noticeKind = decision === 'no_action' || decision === 'handled' ? null : decision;
    if (noticeKind !== null && ground === null) return sendError(reply, 400, 'report_ground_required');

    const snapshot = snapshotFromRow(report);
    const now = Date.now();
    let affectedUser: string | null = null;
    let subject: string | null = snapshot?.content ? snapshot.content.slice(0, NOTICE_EXCERPT_MAX) : null;
    let until: number | null = null;

    if (decision === 'content_removed') {
      if ((report.targetType !== 'message' && report.targetType !== 'dm_message') || !report.targetId) {
        return sendError(reply, 400, 'report_decision_invalid');
      }
      removeReportedMessage(report.targetType, report.targetId);
      // Someone who deleted their account in the meantime has nobody left to tell.
      const author = snapshot?.authorId
        ? db.select({ id: schema.users.id, isDeleted: schema.users.isDeleted }).from(schema.users).where(eq(schema.users.id, snapshot.authorId)).get()
        : undefined;
      affectedUser = author && author.isDeleted !== 1 ? author.id : null;
    } else if (decision === 'account_suspended') {
      // A space's owner may have changed since the report: a space is dealt with as a space.
      if (report.targetType === 'space') return sendError(reply, 400, 'report_decision_invalid');
      const targetId = report.targetType === 'user' ? report.targetId : snapshot?.authorId ?? null;
      if (!targetId) return sendError(reply, 400, 'report_decision_invalid');
      if (targetId === request.userId) return sendError(reply, 400, 'cannot_suspend_self');
      const target = db.select().from(schema.users).where(eq(schema.users.id, targetId)).get();
      if (!target) return sendError(reply, 404, 'user_not_found');
      if (target.isDeleted === 1) return sendError(reply, 400, 'user_already_deleted');
      if (target.isAdmin === 1) return sendError(reply, 400, 'cannot_suspend_admin');
      const indefinite = durationHours === null;
      if (!indefinite && (typeof durationHours !== 'number' || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > SUSPENSION_LIMITS.MAX_DURATION_HOURS)) {
        return sendError(reply, 400, 'suspension_duration_invalid', { max: SUSPENSION_LIMITS.MAX_DURATION_HOURS });
      }
      if (note.length < SUSPENSION_LIMITS.REASON_MIN_LENGTH || note.length > SUSPENSION_LIMITS.REASON_MAX_LENGTH) {
        return sendError(reply, 400, 'suspension_reason_invalid', { min: SUSPENSION_LIMITS.REASON_MIN_LENGTH, max: SUSPENSION_LIMITS.REASON_MAX_LENGTH });
      }
      until = applySuspension(target, request.userId, note, indefinite ? null : durationHours as number, now);
      affectedUser = target.id;
    } else if (decision === 'listing_withdrawn') {
      if (report.targetType !== 'space' || !report.targetId) return sendError(reply, 400, 'report_decision_invalid');
      const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, report.targetId)).get();
      if (!space) return sendError(reply, 404, 'space_not_found');
      const step = decideDiscovery(space, 'withdraw', request.userId, note, undefined, now);
      if (isReviewRefusal(step)) return sendError(reply, step.status, step.code, step.details);
      announceReviewStep(space, step);
      affectedUser = space.ownerId;
      subject = space.name;
    }

    db.update(schema.contentReports).set({
      status: 'closed',
      decision,
      ground,
      decisionNote: note,
      decidedBy: request.userId,
      decidedAt: now,
    }).where(eq(schema.contentReports.id, report.id)).run();

    recordPlatformAudit({
      actorId: request.userId,
      action: 'report_decide',
      targetType: 'instance',
      targetId: report.id,
      targetLabel: report.category,
      reason: note,
      details: { decision, ground },
    }, now);

    // What a restriction rests on goes to the person it hits (Art. 17), the
    // outcome to whoever reported it (Art. 16(5)).
    if (affectedUser && noticeKind) {
      sendNotice(affectedUser, { kind: noticeKind, ground, note, subject, until }, now);
    }
    if (report.reporterUserId) {
      sendNotice(report.reporterUserId, { kind: 'report_decided', decision, subject: report.category }, now);
    }
    announceReportQueue();

    const updated = db.select().from(schema.contentReports).where(eq(schema.contentReports.id, report.id)).get();
    return reply.code(200).send(adminReports(updated ? [updated] : [])[0]);
  });
}
