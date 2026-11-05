import { cardImageIds, cardsFromDiscordEmbeds, cardsSummary, cardWords, cleanCards, type MessageCard } from '@backspace/shared/src/cards.js';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { MAX_MESSAGE_LENGTH } from '@backspace/shared';
import { WEBHOOK_LIMITS, type WebhookInfo, type WebhookWithToken } from '@backspace/shared/src/webhooks.js';
import { getDb, schema } from '../db/index.js';
import { recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { sendError } from '../utils/httpErrors.js';
import { isStickerFrom, mediaOriginsFor } from '../utils/remoteMedia.js';
import { emojiUseRefusal } from '../utils/emojiUse.js';
import { withoutMentions } from '../utils/neutralMentions.js';
import { getChannelSpaceId, hasPermission, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { automodRefusal, memberActionRefusal } from '../utils/spaceModeration.js';
import {
  createWebhookAccount,
  newWebhookToken,
  removeUnusedWebhookAccounts,
  webhookForToken,
  webhookTokenHash,
} from '../utils/webhookAccounts.js';
import { connectionManager } from '../ws/handler.js';
import { hydrateChannelMessages } from './messages.js';

type WebhookRow = typeof schema.webhooks.$inferSelect;

const MANAGE = PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_WEBHOOKS;
/** Counted per webhook, after its token proved good: nobody without it can use up its limit. */
const postLimit = createFixedWindowLimit({ max: WEBHOOK_LIMITS.POSTS_PER_MINUTE, windowMs: 60_000 });

export function _resetWebhookLimitForTests(): void {
  postLimit.reset();
}

function toInfo(row: WebhookRow): WebhookInfo {
  return {
    id: row.id,
    spaceId: row.spaceId,
    channelId: row.channelId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

function cleanName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= WEBHOOK_LIMITS.NAME_MAX_LENGTH ? name : null;
}

const webhookOf = (id: string): WebhookRow | undefined =>
  getDb().select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).get();

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/channels/:id/webhooks - A channel's webhooks
  app.get<{ Params: { id: string } }>('/api/channels/:id/webhooks', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, MANAGE, id)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_WEBHOOKS' });
    const rows = getDb().select().from(schema.webhooks)
      .where(eq(schema.webhooks.channelId, id))
      .orderBy(asc(schema.webhooks.createdAt))
      .all();
    return reply.code(200).send({ webhooks: rows.map(toInfo) });
  });

  // POST /api/channels/:id/webhooks - Make one. The answer holds its token, the only time it is shown.
  app.post<{ Params: { id: string }; Body: { name?: unknown } }>('/api/channels/:id/webhooks', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, MANAGE, id)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_WEBHOOKS' });
    // Someone held back from writing cannot write through a webhook instead.
    const held = memberActionRefusal(spaceId, request.userId);
    if (held) return sendError(reply, held.status, held.code, held.details);

    const db = getDb();
    const channel = db.select({ type: schema.channels.type }).from(schema.channels).where(eq(schema.channels.id, id)).get();
    if (channel?.type !== 'text' && channel?.type !== 'announcement') return sendError(reply, 400, 'webhook_not_allowed');
    const name = cleanName(request.body?.name);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });

    const count = (condition: ReturnType<typeof eq>) => db.select({ count: sql<number>`count(*)` }).from(schema.webhooks).where(condition).get()?.count ?? 0;
    if (count(eq(schema.webhooks.channelId, id)) >= WEBHOOK_LIMITS.PER_CHANNEL_MAX) {
      return sendError(reply, 400, 'webhook_limit_reached', { max: WEBHOOK_LIMITS.PER_CHANNEL_MAX });
    }
    if (count(eq(schema.webhooks.spaceId, spaceId)) >= WEBHOOK_LIMITS.PER_SPACE_MAX) {
      return sendError(reply, 400, 'webhook_limit_reached', { max: WEBHOOK_LIMITS.PER_SPACE_MAX });
    }

    const webhookId = generateSnowflake();
    const token = newWebhookToken();
    const now = Date.now();
    db.transaction((tx) => {
      const userId = createWebhookAccount(tx, webhookId, name, now);
      tx.insert(schema.webhooks).values({
        id: webhookId, spaceId, channelId: id, userId, name, tokenHash: webhookTokenHash(token), createdBy: request.userId, createdAt: now,
      }).run();
    });
    const row = webhookOf(webhookId);
    if (!row) return sendError(reply, 500, 'internal_error');
    recordAudit({ spaceId, actorId: request.userId, action: 'webhook_create', targetType: 'channel', targetId: id, targetLabel: name });
    const created: WebhookWithToken = { webhook: toInfo(row), token };
    return reply.code(201).send(created);
  });

  /** A webhook someone may manage, or why not. */
  const managed = (webhookId: string, userId: string) => {
    const row = webhookOf(webhookId);
    if (!row) return { ok: false, status: 404, code: 'webhook_not_found' } as const;
    if (!hasPermission(userId, row.spaceId, MANAGE, row.channelId)) {
      return { ok: false, status: 403, code: 'missing_permission', details: { permission: 'MANAGE_WEBHOOKS' } } as const;
    }
    return { ok: true, row } as const;
  };

  // PATCH /api/webhooks/:id - Rename it. Its messages so far carry the new name too.
  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>('/api/webhooks/:id', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const found = managed(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const name = cleanName(request.body?.name);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    const db = getDb();
    db.transaction((tx) => {
      tx.update(schema.webhooks).set({ name }).where(eq(schema.webhooks.id, found.row.id)).run();
      tx.update(schema.users).set({ displayName: name }).where(and(eq(schema.users.id, found.row.userId), eq(schema.users.accountKind, 'webhook'))).run();
    });
    recordAudit({ spaceId: found.row.spaceId, actorId: request.userId, action: 'webhook_update', targetType: 'channel', targetId: found.row.channelId, targetLabel: name });
    return reply.code(200).send(toInfo({ ...found.row, name }));
  });

  // POST /api/webhooks/:id/rotate - A new token, for an address that got out. The old one stops at once.
  app.post<{ Params: { id: string } }>('/api/webhooks/:id/rotate', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const found = managed(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    const held = memberActionRefusal(found.row.spaceId, request.userId);
    if (held) return sendError(reply, held.status, held.code, held.details);
    const token = newWebhookToken();
    getDb().update(schema.webhooks).set({ tokenHash: webhookTokenHash(token) }).where(eq(schema.webhooks.id, found.row.id)).run();
    recordAudit({ spaceId: found.row.spaceId, actorId: request.userId, action: 'webhook_update', targetType: 'channel', targetId: found.row.channelId, targetLabel: found.row.name });
    const rotated: WebhookWithToken = { webhook: toInfo(found.row), token };
    return reply.code(200).send(rotated);
  });

  // DELETE /api/webhooks/:id - The address stops. What it posted stays.
  app.delete<{ Params: { id: string } }>('/api/webhooks/:id', { preHandler: authenticate }, async (request, reply) => {
    const found = managed(request.params.id, request.userId);
    if (!found.ok) return sendError(reply, found.status, found.code, 'details' in found ? found.details : undefined);
    getDb().delete(schema.webhooks).where(eq(schema.webhooks.id, found.row.id)).run();
    removeUnusedWebhookAccounts();
    recordAudit({ spaceId: found.row.spaceId, actorId: request.userId, action: 'webhook_delete', targetType: 'channel', targetId: found.row.channelId, targetLabel: found.row.name });
    return reply.code(200).send({ success: true });
  });

  // POST /api/webhooks/:id/:token - Post. Public: the token in the address is what proves the right.
  // The message goes through the same funnel as any other (`sendToChannel`). No link in it is fetched.
  app.post<{ Params: { id: string; token: string }; Body: { content?: unknown; text?: unknown; cards?: unknown; embeds?: unknown } }>('/api/webhooks/:id/:token', {
    bodyLimit: 32 * 1024,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const row = webhookForToken(request.params.id, request.params.token);
    if (!row) return sendError(reply, 404, 'webhook_not_found');
    if (!postLimit.consume(row.id)) {
      reply.header('retry-after', '60');
      return sendError(reply, 429, 'rate_limited');
    }

    const body = request.body;
    const given = typeof body?.content === 'string' ? body.content : typeof body?.text === 'string' ? body.text : '';
    const trimmed = given.trim();
    if (trimmed.length > MAX_MESSAGE_LENGTH) return sendError(reply, 400, 'content_too_long', { max: MAX_MESSAGE_LENGTH });
    // A webhook's account lives here, so its stickers can only be this instance's (utils/remoteMedia.ts).
    if (!isStickerFrom(trimmed, mediaOriginsFor())) return sendError(reply, 400, 'sticker_elsewhere');
    // Its account belongs to no space, so of the spaces' emoji only its own channel's may come.
    const emojiRefusal = emojiUseRefusal(trimmed, row.userId, row.spaceId);
    if (emojiRefusal) return sendError(reply, emojiRefusal.status, emojiRefusal.code);

    // Cards, or Discord's embeds from a program that already speaks them. No uploads here, so no pictures.
    let cards: MessageCard[] = [];
    const asked = body?.cards ?? (body?.embeds !== undefined ? cardsFromDiscordEmbeds(body.embeds) : undefined);
    if (asked !== undefined) {
      const cleaned = cleanCards(asked, withoutMentions);
      if ('field' in cleaned) return sendError(reply, 400, 'cards_invalid', { field: cleaned.field });
      if (cardImageIds(cleaned.cards).size > 0) return sendError(reply, 400, 'cards_invalid', { field: 'imageAttachmentId' });
      cards = cleaned.cards;
    }
    if (!trimmed && cards.length === 0) return sendError(reply, 400, 'validation_failed', { field: 'content' });

    // A webhook pings nobody, and its words meet the space's automatic rules like anyone's.
    const content = trimmed ? withoutMentions(trimmed) : cardsSummary(cards);
    if (content && content.length > MAX_MESSAGE_LENGTH) return sendError(reply, 400, 'content_too_long', { max: MAX_MESSAGE_LENGTH });
    const refusal = automodRefusal(row.spaceId, cards.length > 0 ? `${cardWords(cards)}\n${content ?? ''}` : content ?? '');
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);

    const db = getDb();
    const now = Date.now();
    const messageId = generateSnowflake();
    db.transaction((tx) => {
      tx.insert(schema.messages).values({ id: messageId, channelId: row.channelId, userId: row.userId, content, cards: cards.length > 0 ? JSON.stringify(cards) : null, createdAt: now }).run();
      tx.update(schema.webhooks).set({ lastUsedAt: now }).where(eq(schema.webhooks.id, row.id)).run();
    });
    const stored = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
    const [message] = stored ? hydrateChannelMessages(row.channelId, [stored]) : [];
    if (!message) return sendError(reply, 500, 'internal_error');
    connectionManager.sendToChannel(row.spaceId, row.channelId, { type: 'message_created', message });
    return reply.code(201).send({ id: messageId });
  });
}
