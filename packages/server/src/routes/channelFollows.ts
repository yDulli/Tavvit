import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { MAX_MESSAGE_LENGTH, type MessageWithUser } from '@backspace/shared';
import { cardWords, parseStoredCards } from '@backspace/shared/src/cards.js';
import {
  FOLLOW_LIMITS,
  type ChannelFollowInfo,
  type ChannelFollowsResponse,
  type FollowTargetSpace,
} from '@backspace/shared/src/channelFollows.js';
import { getDb, schema } from '../db/index.js';
import { releaseUpload, reserveUpload, uploadRefusal } from '../utils/accountLimits.js';
import { copyAttachments, isOnThisDisk } from '../utils/attachmentCopies.js';
import { auditChange, recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { resolveEmbeds } from '../utils/embedResolver.js';
import { sendError } from '../utils/httpErrors.js';
import { withoutMentions } from '../utils/neutralMentions.js';
import { everyonePermissions, getChannelSpaceId, hasPermission, PermissionBits } from '../utils/permissions.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { automodRefusal, memberActionRefusal } from '../utils/spaceModeration.js';
import { createFollowAccount, removeUnusedWebhookAccounts } from '../utils/webhookAccounts.js';
import { connectionManager } from '../ws/handler.js';
import { hydrateChannelMessages } from './messages.js';

type FollowRow = typeof schema.channelFollows.$inferSelect;
type ChannelRow = typeof schema.channels.$inferSelect;

/** Having a channel's posts arrive takes what a webhook takes: both let something write there. */
const MANAGE_TARGET = PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_WEBHOOKS;
/** Seeing and ending who follows a channel. */
const MANAGE_SOURCE = PermissionBits.VIEW_CHANNEL | PermissionBits.MANAGE_WEBHOOKS;

const channelOf = (id: string): ChannelRow | undefined =>
  getDb().select().from(schema.channels).where(eq(schema.channels.id, id)).get();

const spaceNameOf = (id: string): string =>
  getDb().select({ name: schema.spaces.name }).from(schema.spaces).where(eq(schema.spaces.id, id)).get()?.name ?? '';

/** Only what every member of its space can read leaves it: a closed channel stays closed. */
function openToEveryone(channel: ChannelRow): boolean {
  return (everyonePermissions(channel.spaceId, channel.id) & PermissionBits.VIEW_CHANNEL) !== 0n;
}

/** The name the copies carry: where they come from. */
function accountNameFor(source: ChannelRow): string {
  return `${spaceNameOf(source.spaceId)} · #${source.name}`.slice(0, 100);
}

function infoOf(row: FollowRow): ChannelFollowInfo | null {
  const source = channelOf(row.sourceChannelId);
  const target = channelOf(row.targetChannelId);
  if (!source || !target) return null;
  return {
    id: row.id,
    sourceChannelId: source.id,
    sourceChannelName: source.name,
    sourceSpaceId: source.spaceId,
    sourceSpaceName: spaceNameOf(source.spaceId),
    targetChannelId: target.id,
    targetChannelName: target.name,
    targetSpaceId: target.spaceId,
    targetSpaceName: spaceNameOf(target.spaceId),
    createdAt: row.createdAt,
  };
}

/** Each of the two spaces sees it in its own log, under its own channel, with the other end beside it. */
function recordFollowAudit(action: 'channel_follow_create' | 'channel_follow_delete', actorId: string, source: ChannelRow, target: ChannelRow): void {
  const entries: Array<[ChannelRow, ChannelRow]> = [[source, target], [target, source]];
  for (const [here, there] of entries) {
    recordAudit({
      spaceId: here.spaceId,
      actorId,
      action,
      targetType: 'channel',
      targetId: here.id,
      targetLabel: here.name,
      changes: [auditChange('channel', undefined, `${spaceNameOf(there.spaceId)} #${there.name}`)],
    });
  }
}

const infosOf = (rows: readonly FollowRow[]): ChannelFollowInfo[] =>
  rows.flatMap((row) => {
    const info = infoOf(row);
    return info ? [info] : [];
  });

/**
 * What was posted in an announcement channel, as a new message in each channel that follows it.
 * It pings nobody, and the target space's automatic rules read it like anything else written
 * there: what they refuse is left out there, and nobody has to hear of it. An edit or a deletion
 * afterwards is not carried over. A poll stays where it was asked: its votes are its channel's.
 * The copies' author writes nothing that goes on from there, so follows cannot make a chain.
 */
export async function copyToFollowers(spaceId: string, message: MessageWithUser): Promise<void> {
  if (message.type !== 'user' || message.poll || message.user?.accountKind === 'follow') return;
  const db = getDb();
  const follows = db.select().from(schema.channelFollows).where(eq(schema.channelFollows.sourceChannelId, message.channelId)).all();
  if (follows.length === 0) return;
  const source = channelOf(message.channelId);
  if (!source || source.type !== 'announcement' || !openToEveryone(source)) return;

  const stored = db.select().from(schema.messages).where(eq(schema.messages.id, message.id)).get();
  if (!stored) return;
  const content = stored.content ? withoutMentions(stored.content).slice(0, MAX_MESSAGE_LENGTH) : null;
  const files = db.select().from(schema.attachments).where(eq(schema.attachments.messageId, message.id)).all();
  const cards = parseStoredCards(stored.cards);
  const words = cards ? `${cardWords(cards)}\n${content ?? ''}` : content ?? '';
  const name = accountNameFor(source);

  for (const follow of follows) {
    const targetSpaceId = getChannelSpaceId(follow.targetChannelId);
    if (!targetSpaceId || targetSpaceId === spaceId) continue;
    if (automodRefusal(targetSpaceId, words)) continue;
    // The copies count on whoever set the follow up (utils/accountLimits.ts), and are refused as an
    // upload of theirs would be: then the post arrives without its files.
    const bytes = files.filter(isOnThisDisk).reduce((sum, file) => sum + file.size, 0);
    const reservation = `follow-${generateSnowflake()}`;
    let copies: Awaited<ReturnType<typeof copyAttachments>> = [];
    const refusal = bytes > 0 ? uploadRefusal(follow.accountId, bytes) : null;
    if (refusal) {
      console.warn(`[follows] the files of ${message.id} did not go to ${follow.targetChannelId}: ${refusal}`);
    } else if (bytes > 0) {
      reserveUpload(reservation, follow.accountId, bytes);
      try {
        copies = await copyAttachments(files, { share: true });
      } catch (err) {
        console.error(`[follows] could not copy the files of ${message.id}:`, err);
      }
    }
    if (!content && !stored.cards && copies.length === 0) {
      releaseUpload(reservation);
      continue;
    }
    const now = Date.now();
    const copyId = generateSnowflake();
    try {
      db.transaction((tx) => {
        tx.insert(schema.messages).values({
          id: copyId,
          channelId: follow.targetChannelId,
          userId: follow.accountId,
          content,
          cards: stored.cards,
          forwarded: true,
          createdAt: now,
        }).run();
        for (const copy of copies) {
          tx.insert(schema.attachments).values({ ...copy, id: generateSnowflake(), messageId: copyId, uploaderId: follow.accountId, createdAt: now }).run();
        }
        // A space or channel renamed since: its posts say so from now on.
        tx.update(schema.users).set({ displayName: name }).where(eq(schema.users.id, follow.accountId)).run();
      });
    } finally {
      // In the table now, where they count.
      releaseUpload(reservation);
    }
    const row = db.select().from(schema.messages).where(eq(schema.messages.id, copyId)).get();
    const [copy] = row ? hydrateChannelMessages(follow.targetChannelId, [row]) : [];
    if (!copy) continue;
    connectionManager.sendToChannel(targetSpaceId, follow.targetChannelId, { type: 'message_created', message: copy });
    setImmediate(() => {
      resolveEmbeds(copyId, content, follow.targetChannelId, false, targetSpaceId).catch(() => {});
    });
  }
}

export async function channelFollowRoutes(app: FastifyInstance): Promise<void> {
  // Every message of a channel passes the connection manager, whichever route made it.
  connectionManager.onChannelMessage((spaceId, message) => {
    setImmediate(() => {
      copyToFollowers(spaceId, message).catch((err: unknown) => {
        console.error(`[follows] could not pass on ${message.id}:`, err);
      });
    });
  });

  // GET /api/channels/:id/follows - Who follows this channel, and what it follows, as far as the person may see
  app.get<{ Params: { id: string } }>('/api/channels/:id/follows', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, MANAGE_SOURCE, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_WEBHOOKS' });
    }
    const db = getDb();
    const response: ChannelFollowsResponse = {
      followers: infosOf(db.select().from(schema.channelFollows).where(eq(schema.channelFollows.sourceChannelId, id)).all()),
      following: infosOf(db.select().from(schema.channelFollows).where(eq(schema.channelFollows.targetChannelId, id)).all()),
    };
    return reply.code(200).send(response);
  });

  // GET /api/channels/:id/follow-targets - Where this person may have this channel's posts arrive
  app.get<{ Params: { id: string } }>('/api/channels/:id/follow-targets', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const source = channelOf(id);
    if (!source) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, source.spaceId, PermissionBits.VIEW_CHANNEL, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL' });
    }
    if (source.type !== 'announcement') return sendError(reply, 400, 'announcement_channel_required');
    const db = getDb();
    const memberships = db.select({ spaceId: schema.spaceMembers.spaceId }).from(schema.spaceMembers)
      .where(eq(schema.spaceMembers.userId, request.userId)).all();
    const spaces: FollowTargetSpace[] = [];
    for (const { spaceId } of memberships) {
      if (spaceId === source.spaceId) continue;
      const channels = db.select({ id: schema.channels.id, name: schema.channels.name }).from(schema.channels)
        .where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.type, 'text'))).all()
        .filter((channel) => hasPermission(request.userId, spaceId, MANAGE_TARGET, channel.id));
      if (channels.length > 0) spaces.push({ id: spaceId, name: spaceNameOf(spaceId), channels });
    }
    return reply.code(200).send({ spaces });
  });

  // POST /api/channels/:id/follows - Have this announcement channel's posts arrive in a text channel of another space
  app.post<{ Params: { id: string }; Body: { targetChannelId?: unknown } }>('/api/channels/:id/follows', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId } = request;
    const source = channelOf(id);
    if (!source) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(userId, source.spaceId, PermissionBits.VIEW_CHANNEL, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL' });
    }
    if (source.type !== 'announcement') return sendError(reply, 400, 'announcement_channel_required');
    if (!openToEveryone(source)) return sendError(reply, 400, 'follow_source_private');

    const targetId = request.body?.targetChannelId;
    if (typeof targetId !== 'string') return sendError(reply, 400, 'validation_failed', { field: 'targetChannelId' });
    const target = channelOf(targetId);
    if (!target || target.type !== 'text' || target.spaceId === source.spaceId) return sendError(reply, 400, 'follow_target_invalid');
    if (!hasPermission(userId, target.spaceId, MANAGE_TARGET, target.id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_WEBHOOKS' });
    }
    // Someone held back from writing there cannot have something else write there instead.
    const held = memberActionRefusal(target.spaceId, userId);
    if (held) return sendError(reply, held.status, held.code, held.details);

    const db = getDb();
    const count = (condition: ReturnType<typeof eq>) => db.select({ count: sql<number>`count(*)` }).from(schema.channelFollows).where(condition).get()?.count ?? 0;
    if (count(eq(schema.channelFollows.sourceChannelId, id)) >= FOLLOW_LIMITS.PER_SOURCE_MAX) {
      return sendError(reply, 400, 'follow_limit_reached', { max: FOLLOW_LIMITS.PER_SOURCE_MAX });
    }
    if (count(eq(schema.channelFollows.targetChannelId, target.id)) >= FOLLOW_LIMITS.PER_TARGET_MAX) {
      return sendError(reply, 400, 'follow_limit_reached', { max: FOLLOW_LIMITS.PER_TARGET_MAX });
    }
    const existing = db.select({ id: schema.channelFollows.id }).from(schema.channelFollows)
      .where(and(eq(schema.channelFollows.sourceChannelId, id), eq(schema.channelFollows.targetChannelId, target.id))).get();
    if (existing) return sendError(reply, 409, 'follow_exists');

    const followId = generateSnowflake();
    const now = Date.now();
    db.transaction((tx) => {
      const accountId = createFollowAccount(tx, followId, accountNameFor(source), now);
      tx.insert(schema.channelFollows).values({ id: followId, sourceChannelId: id, targetChannelId: target.id, accountId, createdBy: userId, createdAt: now }).run();
    });
    recordFollowAudit('channel_follow_create', userId, source, target);
    const row = db.select().from(schema.channelFollows).where(eq(schema.channelFollows.id, followId)).get();
    const info = row ? infoOf(row) : null;
    if (!info) return sendError(reply, 500, 'internal_error');
    return reply.code(201).send(info);
  });

  // DELETE /api/channel-follows/:id - End it, from either side. What arrived so far stays.
  app.delete<{ Params: { id: string } }>('/api/channel-follows/:id', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const row = db.select().from(schema.channelFollows).where(eq(schema.channelFollows.id, request.params.id)).get();
    if (!row) return sendError(reply, 404, 'follow_not_found');
    const source = channelOf(row.sourceChannelId);
    const target = channelOf(row.targetChannelId);
    const allowed = (source && hasPermission(request.userId, source.spaceId, MANAGE_SOURCE, source.id))
      || (target && hasPermission(request.userId, target.spaceId, MANAGE_TARGET, target.id));
    if (!allowed) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_WEBHOOKS' });
    db.delete(schema.channelFollows).where(eq(schema.channelFollows.id, row.id)).run();
    removeUnusedWebhookAccounts();
    if (source && target) recordFollowAudit('channel_follow_delete', request.userId, source, target);
    return reply.code(200).send({ success: true });
  });
}

/** Ends every follow of this channel, when it stops being an announcement channel. */
export function endFollowersOf(channelId: string): void {
  getDb().delete(schema.channelFollows).where(eq(schema.channelFollows.sourceChannelId, channelId)).run();
  removeUnusedWebhookAccounts();
}
