import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { SAVED_LIMITS, type SavedItem, type SavedKind, type SavedListResponse } from '@backspace/shared/src/saved.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { getChannelSpaceId, hasPermission, isDmMember, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { connectionManager } from '../ws/handler.js';
import { hydrateDmMessages } from './dm.js';
import { hydrateChannelMessages } from './messages.js';

type SavedRow = typeof schema.savedMessages.$inferSelect;
type ChannelRow = typeof schema.messages.$inferSelect;
type DmRow = typeof schema.dmMessages.$inferSelect;

/** Candidate rows read per round: a row someone can no longer see is passed over. */
const SCAN_BATCH = 100;
const MAX_ROUNDS = 5;

/** The channel message this person may see now, or undefined. */
export function visibleChannelMessage(userId: string, messageId: string): { row: ChannelRow; spaceId: string } | undefined {
  const row = getDb().select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!row) return undefined;
  const spaceId = getChannelSpaceId(row.channelId);
  if (!spaceId || !hasPermission(userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, row.channelId)) return undefined;
  return { row, spaceId };
}

/** The conversation's message this person may see now, or undefined. */
export function visibleDmMessage(userId: string, messageId: string): DmRow | undefined {
  const row = getDb().select().from(schema.dmMessages).where(eq(schema.dmMessages.id, messageId)).get();
  return row && isDmMember(row.dmChannelId, userId) ? row : undefined;
}

/** A saved row as the person sees it, or undefined when they can no longer see its message. */
export function savedItemOf(saved: SavedRow): SavedItem | undefined {
  const base = { id: saved.id, remindAt: saved.reminderSentAt === null ? saved.remindAt : null, createdAt: saved.createdAt };
  if (saved.messageId) {
    const found = visibleChannelMessage(saved.userId, saved.messageId);
    const [message] = found ? hydrateChannelMessages(found.row.channelId, [found.row], saved.userId) : [];
    return found && message ? { ...base, kind: 'channel', channelId: found.row.channelId, spaceId: found.spaceId, message } : undefined;
  }
  if (saved.dmMessageId) {
    const row = visibleDmMessage(saved.userId, saved.dmMessageId);
    const [message] = row ? hydrateDmMessages(row.dmChannelId, [row]) : [];
    return row && message ? { ...base, kind: 'dm', channelId: row.dmChannelId, spaceId: null, message } : undefined;
  }
  return undefined;
}

export async function savedRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/saved - A page of a person's saved messages, those they can still see, the latest saved first
  app.get<{ Querystring: { before?: string } }>('/api/saved', { preHandler: authenticate }, async (request, reply) => {
    const { before } = request.query;
    if (before !== undefined && !/^\d{1,20}$/.test(before)) return sendError(reply, 400, 'validation_failed', { field: 'before' });
    const db = getDb();
    const items: SavedItem[] = [];
    let cursor = before;
    let exhausted = false;
    let lastItem: string | null = null;
    for (let round = 0; round < MAX_ROUNDS && items.length <= SAVED_LIMITS.PAGE && !exhausted; round += 1) {
      const rows = db.select().from(schema.savedMessages).where(and(
        eq(schema.savedMessages.userId, request.userId),
        cursor === undefined ? undefined : sql`CAST(${schema.savedMessages.id} AS INTEGER) < CAST(${cursor} AS INTEGER)`,
      )).orderBy(desc(sql`CAST(${schema.savedMessages.id} AS INTEGER)`)).limit(SCAN_BATCH).all();
      if (rows.length < SCAN_BATCH) exhausted = true;
      for (const row of rows) {
        cursor = row.id;
        const item = savedItemOf(row);
        if (!item) continue;
        items.push(item);
        if (items.length > SAVED_LIMITS.PAGE) break;
        lastItem = row.id;
      }
    }
    const more = items.length > SAVED_LIMITS.PAGE;
    const response: SavedListResponse = {
      items: items.slice(0, SAVED_LIMITS.PAGE),
      nextBefore: more ? lastItem : exhausted ? null : cursor ?? null,
    };
    return reply.code(200).send(response);
  });

  // GET /api/saved/ids - What this person saved, for the message menu to say so
  app.get('/api/saved/ids', { preHandler: authenticate }, async (request, reply) => {
    const rows = getDb().select({ messageId: schema.savedMessages.messageId, dmMessageId: schema.savedMessages.dmMessageId })
      .from(schema.savedMessages).where(eq(schema.savedMessages.userId, request.userId)).all();
    return reply.code(200).send({ messageIds: rows.flatMap((row) => row.messageId ?? row.dmMessageId ?? []) });
  });

  const save = (kind: SavedKind) => async (
    request: { userId: string; params: { id: string }; body?: { remindAt?: unknown } },
    reply: Parameters<typeof sendError>[0],
  ) => {
    const { id } = request.params;
    const userId = request.userId;
    const visible = kind === 'channel' ? visibleChannelMessage(userId, id) : visibleDmMessage(userId, id);
    if (!visible) return sendError(reply, 404, 'message_not_found');

    const now = Date.now();
    const asked = request.body?.remindAt;
    if (asked !== undefined && asked !== null
      && (typeof asked !== 'number' || !Number.isFinite(asked) || asked <= now || asked > now + SAVED_LIMITS.REMIND_WITHIN_MS)) {
      return sendError(reply, 400, 'validation_failed', { field: 'remindAt' });
    }

    const db = getDb();
    const column = kind === 'channel' ? schema.savedMessages.messageId : schema.savedMessages.dmMessageId;
    const existing = db.select().from(schema.savedMessages).where(and(eq(schema.savedMessages.userId, userId), eq(column, id))).get();
    if (existing) {
      // Saved again with no word about a reminder: whatever it had stays.
      if (asked !== undefined) {
        db.update(schema.savedMessages).set({ remindAt: asked as number | null, reminderSentAt: null }).where(eq(schema.savedMessages.id, existing.id)).run();
      }
    } else {
      const count = db.select({ count: sql<number>`count(*)` }).from(schema.savedMessages).where(eq(schema.savedMessages.userId, userId)).get()?.count ?? 0;
      if (count >= SAVED_LIMITS.PER_ACCOUNT) return sendError(reply, 400, 'saved_limit_reached', { max: SAVED_LIMITS.PER_ACCOUNT });
      db.insert(schema.savedMessages).values({
        id: generateSnowflake(),
        userId,
        messageId: kind === 'channel' ? id : null,
        dmMessageId: kind === 'dm' ? id : null,
        remindAt: (asked as number | null | undefined) ?? null,
        createdAt: now,
      }).run();
    }
    connectionManager.sendToUser(userId, { type: 'saved_changed', messageId: id, saved: true });
    const row = db.select().from(schema.savedMessages).where(and(eq(schema.savedMessages.userId, userId), eq(column, id))).get();
    const item = row ? savedItemOf(row) : undefined;
    if (!item) return sendError(reply, 500, 'internal_error');
    return reply.code(200).send(item);
  };

  const remove = (kind: SavedKind) => async (
    request: { userId: string; params: { id: string } },
    reply: Parameters<typeof sendError>[0],
  ) => {
    const column = kind === 'channel' ? schema.savedMessages.messageId : schema.savedMessages.dmMessageId;
    getDb().delete(schema.savedMessages).where(and(eq(schema.savedMessages.userId, request.userId), eq(column, request.params.id))).run();
    connectionManager.sendToUser(request.userId, { type: 'saved_changed', messageId: request.params.id, saved: false });
    return reply.code(200).send({ success: true });
  };

  const LIMIT = { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  // PUT /api/saved/messages/:id, /api/saved/dm-messages/:id - Save it. `remindAt` sets or (null) clears a reminder.
  app.put<{ Params: { id: string }; Body: { remindAt?: unknown } }>('/api/saved/messages/:id', LIMIT, (request, reply) => save('channel')(request, reply));
  app.put<{ Params: { id: string }; Body: { remindAt?: unknown } }>('/api/saved/dm-messages/:id', LIMIT, (request, reply) => save('dm')(request, reply));
  // DELETE the same: take it off the list
  app.delete<{ Params: { id: string } }>('/api/saved/messages/:id', LIMIT, (request, reply) => remove('channel')(request, reply));
  app.delete<{ Params: { id: string } }>('/api/saved/dm-messages/:id', LIMIT, (request, reply) => remove('dm')(request, reply));
}

/** Reminders that are due, oldest first, at most `limit`. */
export function dueSavedReminders(now: number, limit: number): SavedRow[] {
  return getDb().select().from(schema.savedMessages).where(and(
    isNull(schema.savedMessages.reminderSentAt),
    sql`${schema.savedMessages.remindAt} IS NOT NULL AND ${schema.savedMessages.remindAt} <= ${now}`,
  )).orderBy(schema.savedMessages.remindAt).limit(limit).all();
}

/** Marks these as told, so a reminder comes once. */
export function markSavedRemindersSent(ids: readonly string[], now: number): void {
  if (ids.length === 0) return;
  getDb().update(schema.savedMessages).set({ reminderSentAt: now }).where(inArray(schema.savedMessages.id, [...ids])).run();
}
