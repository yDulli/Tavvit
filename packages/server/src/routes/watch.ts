import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  isWatchReaction,
  parseWatchUrl,
  WATCH_LIMITS,
  type WatchAction,
  type WatchAddRequest,
  type WatchControl,
  type WatchReactRequest,
  type WatchSession,
} from '@backspace/shared/src/watch.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { sendError } from '../utils/httpErrors.js';
import { hasPermission, PermissionBits } from '../utils/permissions.js';
import { memberActionRefusal } from '../utils/spaceModeration.js';
import { addToSession, announceWatch, announceWatchPosition, applyWatchAction, endSession } from '../utils/watchSessions.js';
import { lookUpWatchTitle } from '../utils/watchTitles.js';
import { connectionManager, watchPresenceOf, type VoiceRoom } from '../ws/handler.js';

/**
 * Watching together in a voice channel (docs/systems/watch-together.md). Every route is for those
 * in the call right now, as the soundboard's play is: the session belongs to the call. Showing a
 * video to the room takes STREAM, the right to show one's screen there.
 */

const addLimit = createFixedWindowLimit({ max: WATCH_LIMITS.ADDS_PER_MINUTE, windowMs: 60_000 });
const controlLimit = createFixedWindowLimit({ max: WATCH_LIMITS.CONTROLS_PER_MINUTE, windowMs: 60_000 });
const reactionLimit = createFixedWindowLimit({ max: WATCH_LIMITS.REACTIONS_PER_WINDOW, windowMs: WATCH_LIMITS.REACTION_WINDOW_MS });

export function _resetWatchLimitsForTests(): void {
  addLimit.reset();
  controlLimit.reset();
  reactionLimit.reset();
}

interface InCall {
  room: VoiceRoom;
  spaceId: string;
}

/**
 * The call `userId` is in on voice channel `channelId`, or null after a refusal was sent: the
 * channel must be a space's voice channel, the person in its call and still allowed into it
 * (VIEW_CHANNEL and CONNECT, as `voice_join` asks: a right taken away mid-call takes the session
 * with it, even while the room still lists them), and free to act in the space
 * (`memberActionRefusal`: not timed out, address confirmed where the gate asks it). `needs` names
 * further rights the route takes, STREAM for adding.
 */
function inCall(channelId: string, userId: string, reply: FastifyReply, needs: bigint = 0n): InCall | null {
  const channel = getDb().select({ spaceId: schema.channels.spaceId, type: schema.channels.type })
    .from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel?.spaceId || channel.type !== 'voice') {
    sendError(reply, 404, 'channel_not_found');
    return null;
  }
  const room = connectionManager.getRoom(channelId);
  if (!room || room.roomType !== 'space' || !room.participants.has(userId)) {
    sendError(reply, 403, 'watch_not_in_call');
    return null;
  }
  if (!hasPermission(userId, channel.spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT, channelId)) {
    sendError(reply, 403, 'watch_not_in_call');
    return null;
  }
  if (needs !== 0n && !hasPermission(userId, channel.spaceId, needs, channelId)) {
    sendError(reply, 403, 'missing_permission', { permission: 'STREAM' });
    return null;
  }
  const held = memberActionRefusal(channel.spaceId, userId);
  if (held) {
    sendError(reply, held.status, held.code, held.details);
    return null;
  }
  return { room, spaceId: channel.spaceId };
}

/** A change as the body names it, or null when it is not one. */
function actionOf(body: unknown): WatchAction | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;
  switch (raw.action) {
    case 'play':
    case 'pause':
      return { action: raw.action };
    case 'seek':
      return typeof raw.positionMs === 'number' && Number.isFinite(raw.positionMs) && raw.positionMs >= 0
        ? { action: 'seek', positionMs: raw.positionMs }
        : null;
    case 'next':
      if (raw.itemId === undefined) return { action: 'next' };
      return typeof raw.itemId === 'string' && raw.itemId.length <= 64 ? { action: 'next', itemId: raw.itemId } : null;
    case 'remove':
      return typeof raw.itemId === 'string' && raw.itemId.length <= 64 ? { action: 'remove', itemId: raw.itemId } : null;
    case 'control':
      return raw.control === 'everyone' || raw.control === 'starter' ? { action: 'control', control: raw.control as WatchControl } : null;
    default:
      return null;
  }
}

/** The answer of a route that changed a session: where it stands now, by the server's clock. */
function stateReply(reply: FastifyReply, session: WatchSession | null, serverNow: number): FastifyReply {
  return reply.code(200).send({ session, serverNow });
}

export async function watchRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/channels/:id/watch - Where the call's session stands, for someone in the call
  app.get<{ Params: { id: string } }>('/api/channels/:id/watch', { preHandler: authenticate }, async (request, reply) => {
    const call = inCall(request.params.id, request.userId, reply);
    if (!call) return reply;
    return stateReply(reply, call.room.watch ?? null, Date.now());
  });

  // POST /api/channels/:id/watch - Add a video, or start watching with it
  app.post<{ Params: { id: string }; Body: WatchAddRequest }>('/api/channels/:id/watch', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const call = inCall(id, request.userId, reply, PermissionBits.STREAM);
    if (!call) return reply;
    const source = parseWatchUrl(request.body?.url);
    if (!source) return sendError(reply, 400, 'watch_link_unsupported');
    if (call.room.watch && call.room.watch.current && call.room.watch.queue.length >= WATCH_LIMITS.QUEUE_MAX) {
      return sendError(reply, 409, 'watch_queue_full', { max: WATCH_LIMITS.QUEUE_MAX });
    }
    if (!addLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const looked = await lookUpWatchTitle(source);
    if (looked.kind === 'not_embeddable') return sendError(reply, 400, 'watch_link_unsupported');
    // The call and the person's rights may have changed while the title was asked for: everything
    // is checked again, as if the request came in now.
    const again = inCall(id, request.userId, reply, PermissionBits.STREAM);
    if (!again) return reply;
    // Without a title from the provider the video is named by its provider on the client, never by
    // its link: a title goes to everyone who can see the channel, and a link may carry the key of
    // an unlisted video.
    const before = watchPresenceOf(again.room);
    const outcome = addToSession(again.room, source, looked.kind === 'title' ? looked.title : '', request.userId);
    if (outcome.kind === 'queue_full') return sendError(reply, 409, 'watch_queue_full', { max: WATCH_LIMITS.QUEUE_MAX });
    const now = Date.now();
    announceWatch(again.room, now, before);
    return stateReply(reply, outcome.session, now);
  });

  // POST /api/channels/:id/watch/state - Play, pause, seek, skip, remove, or say who may steer
  app.post<{ Params: { id: string }; Body: unknown }>('/api/channels/:id/watch/state', {
    preHandler: authenticate,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const call = inCall(request.params.id, request.userId, reply);
    if (!call) return reply;
    const action = actionOf(request.body);
    if (!action) return sendError(reply, 400, 'validation_failed', { field: 'action' });
    if (!controlLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
    const now = Date.now();
    const before = watchPresenceOf(call.room);
    const outcome = applyWatchAction(call.room, action, request.userId, now);
    if (outcome.kind === 'not_found') return sendError(reply, 404, 'watch_not_found');
    if (outcome.kind === 'not_controller') return sendError(reply, 403, 'watch_not_controller');
    // A change that changed nothing is told to nobody: the answer alone says where things stand.
    if (outcome.kind === 'changed') {
      if (outcome.scope === 'position') announceWatchPosition(call.room, now);
      else announceWatch(call.room, now, before);
    }
    return stateReply(reply, outcome.session, now);
  });

  // DELETE /api/channels/:id/watch - End it: its starter, anyone while everyone steers, or someone who may move members
  app.delete<{ Params: { id: string } }>('/api/channels/:id/watch', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const call = inCall(id, request.userId, reply);
    if (!call) return reply;
    const session = call.room.watch;
    if (!session) return sendError(reply, 404, 'watch_not_found');
    const mayEnd = session.starterId === request.userId
      || session.control === 'everyone'
      || hasPermission(request.userId, call.spaceId, PermissionBits.MOVE_MEMBERS, id);
    if (!mayEnd) return sendError(reply, 403, 'watch_not_controller');
    const before = watchPresenceOf(call.room);
    endSession(call.room);
    const now = Date.now();
    announceWatch(call.room, now, before);
    return stateReply(reply, null, now);
  });

  // POST /api/channels/:id/watch/react - A reaction flies over the picture for everyone in the call
  app.post<{ Params: { id: string }; Body: WatchReactRequest }>('/api/channels/:id/watch/react', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const call = inCall(id, request.userId, reply);
    if (!call) return reply;
    if (!call.room.watch?.current) return sendError(reply, 404, 'watch_not_found');
    const reaction = request.body?.reaction;
    if (!isWatchReaction(reaction)) return sendError(reply, 400, 'validation_failed', { field: 'reaction' });
    if (!reactionLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
    // Nobody is named: the call sees a reaction, not who gave it, and nothing is shown of that.
    connectionManager.sendToUsers(call.room.participants, { type: 'watch_reaction', channelId: id, reaction });
    return reply.code(200).send({ success: true });
  });
}
