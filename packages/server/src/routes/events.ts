import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { EVENT_KEPT_AFTER_MS, EVENT_LIMITS, type SpaceEvent, type SpaceEventRequest } from '@backspace/shared/src/events.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { getDb, schema } from '../db/index.js';
import { recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { getMember, hasPermission, PermissionBits } from '../utils/permissions.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { connectionManager } from '../ws/handler.js';

type EventRow = typeof schema.spaceEvents.$inferSelect;

function goingCounts(eventIds: readonly string[]): Map<string, number> {
  if (eventIds.length === 0) return new Map();
  return new Map(getDb().select({ eventId: schema.spaceEventRsvps.eventId, count: sql<number>`count(*)` })
    .from(schema.spaceEventRsvps)
    .where(inArray(schema.spaceEventRsvps.eventId, [...eventIds]))
    .groupBy(schema.spaceEventRsvps.eventId)
    .all()
    .map((row) => [row.eventId, row.count]));
}

function toWire(row: EventRow, going: number, amGoing?: boolean): SpaceEvent {
  return {
    id: row.id,
    spaceId: row.spaceId,
    title: row.title,
    description: row.description,
    location: row.location,
    channelId: row.channelId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    going,
    ...(amGoing === undefined ? {} : { amGoing }),
  };
}

const eventOf = (id: string): EventRow | undefined =>
  getDb().select().from(schema.spaceEvents).where(eq(schema.spaceEvents.id, id)).get();

const isGoing = (eventId: string, userId: string): boolean => getDb().select({ userId: schema.spaceEventRsvps.userId })
  .from(schema.spaceEventRsvps)
  .where(and(eq(schema.spaceEventRsvps.eventId, eventId), eq(schema.spaceEventRsvps.userId, userId)))
  .get() !== undefined;

/** Tells the space. What goes to everyone has no `amGoing`: a client keeps its own. */
function announce(row: EventRow): void {
  connectionManager.sendToSpace(row.spaceId, {
    type: 'event_updated',
    event: toWire(row, goingCounts([row.id]).get(row.id) ?? 0),
  });
}

interface Refused { status: number; code: ErrorCode; details?: ErrorDetails }

/** The fields as stored, or why they are not an event. A channel must be this space's and one the writer can see. */
function cleanEvent(
  spaceId: string,
  userId: string,
  body: Partial<SpaceEventRequest> | undefined,
  now: number,
): { fields: Pick<EventRow, 'title' | 'description' | 'location' | 'channelId' | 'startsAt' | 'endsAt'> } | { refused: Refused } {
  const invalid = (field: string) => ({ refused: { status: 400, code: 'validation_failed' as const, details: { field } } });
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > EVENT_LIMITS.TITLE_MAX_LENGTH) return invalid('title');
  const text = (value: unknown, max: number): string | null | undefined => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > max) return undefined;
    return value.trim() || null;
  };
  const description = text(body?.description, EVENT_LIMITS.DESCRIPTION_MAX_LENGTH);
  if (description === undefined) return invalid('description');
  const location = text(body?.location, EVENT_LIMITS.LOCATION_MAX_LENGTH);
  if (location === undefined) return invalid('location');
  const { startsAt, endsAt } = body ?? {};
  if (typeof startsAt !== 'number' || !Number.isFinite(startsAt) || startsAt <= now) return invalid('startsAt');
  if (endsAt !== undefined && endsAt !== null && (typeof endsAt !== 'number' || !Number.isFinite(endsAt) || endsAt <= startsAt)) return invalid('endsAt');
  const channelId = body?.channelId ?? null;
  if (channelId !== null) {
    if (typeof channelId !== 'string') return invalid('channelId');
    const channel = getDb().select({ spaceId: schema.channels.spaceId, type: schema.channels.type })
      .from(schema.channels).where(eq(schema.channels.id, channelId)).get();
    if (!channel || channel.spaceId !== spaceId || channel.type === 'thread' || !hasPermission(userId, spaceId, PermissionBits.VIEW_CHANNEL, channelId)) {
      return invalid('channelId');
    }
  }
  return { fields: { title, description, location, channelId, startsAt, endsAt: endsAt ?? null } };
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/spaces/:id/events - What is coming up, and what ended within the last day
  app.get<{ Params: { id: string } }>('/api/spaces/:id/events', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    if (!hasPermission(request.userId, id, PermissionBits.VIEW_CHANNEL)) return sendError(reply, 403, 'not_space_member');
    const db = getDb();
    const since = Date.now() - EVENT_KEPT_AFTER_MS;
    const rows = db.select().from(schema.spaceEvents)
      .where(and(eq(schema.spaceEvents.spaceId, id), gte(sql`coalesce(${schema.spaceEvents.endsAt}, ${schema.spaceEvents.startsAt})`, since)))
      .orderBy(asc(schema.spaceEvents.startsAt))
      .all();
    const ids = rows.map((row) => row.id);
    const counts = goingCounts(ids);
    const mine = new Set(ids.length === 0 ? [] : db.select({ eventId: schema.spaceEventRsvps.eventId }).from(schema.spaceEventRsvps)
      .where(and(eq(schema.spaceEventRsvps.userId, request.userId), inArray(schema.spaceEventRsvps.eventId, ids)))
      .all().map((row) => row.eventId));
    return reply.code(200).send({ events: rows.map((row) => toWire(row, counts.get(row.id) ?? 0, mine.has(row.id))) });
  });

  // POST /api/spaces/:id/events - Announce one
  app.post<{ Params: { id: string }; Body: SpaceEventRequest }>('/api/spaces/:id/events', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_EVENTS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_EVENTS' });
    }
    const now = Date.now();
    const cleaned = cleanEvent(id, request.userId, request.body, now);
    if ('refused' in cleaned) return sendError(reply, cleaned.refused.status, cleaned.refused.code, cleaned.refused.details);

    const db = getDb();
    const upcoming = db.select({ count: sql<number>`count(*)` }).from(schema.spaceEvents)
      .where(and(eq(schema.spaceEvents.spaceId, id), gt(schema.spaceEvents.startsAt, now))).get()?.count ?? 0;
    if (upcoming >= EVENT_LIMITS.UPCOMING_MAX) return sendError(reply, 400, 'event_limit_reached', { max: EVENT_LIMITS.UPCOMING_MAX });

    const eventId = generateSnowflake();
    db.insert(schema.spaceEvents).values({ id: eventId, spaceId: id, ...cleaned.fields, createdBy: request.userId, createdAt: now }).run();
    const row = eventOf(eventId);
    if (!row) return sendError(reply, 500, 'internal_error');
    recordAudit({ spaceId: id, actorId: request.userId, action: 'event_create', targetType: 'space', targetId: eventId, targetLabel: row.title });
    announce(row);
    return reply.code(201).send(toWire(row, 0, false));
  });

  /** May this person change it: who announced it, or someone with MANAGE_EVENTS. */
  const canManage = (row: EventRow, userId: string): boolean => hasPermission(userId, row.spaceId, PermissionBits.MANAGE_EVENTS)
    || (row.createdBy === userId && getMember(row.spaceId, userId) !== undefined);

  // PATCH /api/events/:id - Change it. Those going stay, and hear again if the time moved.
  app.patch<{ Params: { id: string }; Body: SpaceEventRequest }>('/api/events/:id', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const row = eventOf(request.params.id);
    if (!row) return sendError(reply, 404, 'event_not_found');
    if (!canManage(row, request.userId)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_EVENTS' });
    const cleaned = cleanEvent(row.spaceId, request.userId, request.body, Date.now());
    if ('refused' in cleaned) return sendError(reply, cleaned.refused.status, cleaned.refused.code, cleaned.refused.details);

    getDb().update(schema.spaceEvents)
      .set({ ...cleaned.fields, ...(cleaned.fields.startsAt !== row.startsAt ? { reminderSentAt: null } : {}) })
      .where(eq(schema.spaceEvents.id, row.id))
      .run();
    const updated = eventOf(row.id);
    if (!updated) return sendError(reply, 500, 'internal_error');
    recordAudit({ spaceId: row.spaceId, actorId: request.userId, action: 'event_update', targetType: 'space', targetId: row.id, targetLabel: updated.title });
    announce(updated);
    return reply.code(200).send(toWire(updated, goingCounts([row.id]).get(row.id) ?? 0, isGoing(row.id, request.userId)));
  });

  // DELETE /api/events/:id - Call it off
  app.delete<{ Params: { id: string } }>('/api/events/:id', { preHandler: authenticate }, async (request, reply) => {
    const row = eventOf(request.params.id);
    if (!row) return sendError(reply, 404, 'event_not_found');
    if (!canManage(row, request.userId)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_EVENTS' });
    getDb().delete(schema.spaceEvents).where(eq(schema.spaceEvents.id, row.id)).run();
    recordAudit({ spaceId: row.spaceId, actorId: request.userId, action: 'event_delete', targetType: 'space', targetId: row.id, targetLabel: row.title });
    connectionManager.sendToSpace(row.spaceId, { type: 'event_deleted', eventId: row.id, spaceId: row.spaceId });
    return reply.code(200).send({ success: true });
  });

  // PUT /api/events/:id/rsvp - Going
  app.put<{ Params: { id: string } }>('/api/events/:id/rsvp', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const row = eventOf(request.params.id);
    if (!row) return sendError(reply, 404, 'event_not_found');
    if (!getMember(row.spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
    getDb().insert(schema.spaceEventRsvps)
      .values({ eventId: row.id, userId: request.userId, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
    announce(row);
    return reply.code(200).send(toWire(row, goingCounts([row.id]).get(row.id) ?? 0, true));
  });

  // DELETE /api/events/:id/rsvp - Not going after all
  app.delete<{ Params: { id: string } }>('/api/events/:id/rsvp', { preHandler: authenticate }, async (request, reply) => {
    const row = eventOf(request.params.id);
    if (!row) return sendError(reply, 404, 'event_not_found');
    getDb().delete(schema.spaceEventRsvps)
      .where(and(eq(schema.spaceEventRsvps.eventId, row.id), eq(schema.spaceEventRsvps.userId, request.userId)))
      .run();
    announce(row);
    return reply.code(200).send(toWire(row, goingCounts([row.id]).get(row.id) ?? 0, false));
  });

  // GET /api/events/:id/attendees - Who is going, for those in the space
  app.get<{ Params: { id: string } }>('/api/events/:id/attendees', { preHandler: authenticate }, async (request, reply) => {
    const row = eventOf(request.params.id);
    if (!row) return sendError(reply, 404, 'event_not_found');
    if (!hasPermission(request.userId, row.spaceId, PermissionBits.VIEW_CHANNEL)) return sendError(reply, 403, 'not_space_member');
    const rows = getDb().select().from(schema.spaceEventRsvps)
      .innerJoin(schema.users, eq(schema.users.id, schema.spaceEventRsvps.userId))
      .where(eq(schema.spaceEventRsvps.eventId, row.id))
      .orderBy(asc(schema.spaceEventRsvps.createdAt))
      .limit(EVENT_LIMITS.ATTENDEES_MAX)
      .all();
    return reply.code(200).send({ attendees: rows.map((entry) => sanitizeUser(entry.users)) });
  });
}
