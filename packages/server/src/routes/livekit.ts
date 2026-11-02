import type { FastifyInstance } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { FULL_VOICE_GRANT, spaceVoiceGrant, type VoiceGrant } from '../utils/livekitGrants.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { config } from '../config.js';
import { getChannelSpaceId, hasPermission, isDmMember, PermissionBits } from '../utils/permissions.js';
import type { LiveKitTokenRequest, LiveKitTokenResponse } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { memberActionRefusal } from '../utils/spaceModeration.js';

/**
 * The LiveKit room of a DM's call on this instance. A space's voice channel is a room named by its
 * bare channel id, so a DM's room has a prefix no channel id has: a key a peer chose can never name
 * someone's voice channel, or another conversation's call.
 */
export function dmCallRoomName(dmChannelId: string, federatedId: string | null): string {
  return federatedId ? `fed:${federatedId}` : `dm-${dmChannelId}`;
}

/**
 * Generate a LiveKit token for a federated call participant.
 * Uses homeUserId as identity (stable across instances).
 * Short TTL (5 min) — must join quickly.
 */
export async function generateFederatedCallToken(
  roomName: string,
  homeUserId: string,
  displayName: string,
): Promise<string> {
  const token = new AccessToken(config.livekit.apiKey!, config.livekit.apiSecret!, {
    identity: `${homeUserId}:${displayName}`,
    ttl: '5m',
  });

  token.addGrant({ room: roomName, roomJoin: true, ...FULL_VOICE_GRANT });

  return token.toJwt();
}

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LiveKitTokenRequest & { dmChannelId?: string } }>('/api/livekit/token', {
    preHandler: authenticate,
  }, async (request, reply) => {
    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return sendError(reply, 503, 'voice_disabled');
    }

    const { channelId, dmChannelId } = request.body as { channelId?: string; dmChannelId?: string };

    // Determine room name based on channel type
    let roomName: string;

    // DM calls always get full permissions; a space's voice channel what the member may do there.
    let grant: VoiceGrant = FULL_VOICE_GRANT;

    if (dmChannelId && typeof dmChannelId === 'string') {
      // DM call token
      if (!isDmMember(dmChannelId, request.userId)) {
        return sendError(reply, 403, 'not_dm_member');
      }

      // Federated DMs are named by their federatedId (cross-instance stable), local-only DMs by
      // their id, each with a prefix of its own (dmCallRoomName).
      const db = getDb();
      const channel = db.select({ federatedId: schema.dmChannels.federatedId })
        .from(schema.dmChannels)
        .where(eq(schema.dmChannels.id, dmChannelId))
        .get();

      roomName = dmCallRoomName(dmChannelId, channel?.federatedId ?? null);
    } else if (channelId && typeof channelId === 'string') {
      // Space voice channel token: a voice channel's only (ws/events.ts, handleVoiceJoin).
      const spaceId = getChannelSpaceId(channelId);
      const channelType = spaceId
        ? getDb().select({ type: schema.channels.type }).from(schema.channels).where(eq(schema.channels.id, channelId)).get()?.type
        : undefined;
      if (!spaceId || channelType !== 'voice') {
        return sendError(reply, 404, 'channel_not_found');
      }
      // VIEW_CHANNEL as well: CONNECT alone would let a member hear a hidden voice channel (permissions.md).
      if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT, channelId)) {
        return sendError(reply, 403, 'voice_connect_forbidden');
      }
      // A timed-out member joins no voice in the space (docs/systems/spaces.md, "Moderation").
      const timeout = memberActionRefusal(spaceId, request.userId);
      if (timeout) {
        return sendError(reply, timeout.status, timeout.code, timeout.details);
      }
      // SPEAK and STREAM, less a space mute or deafen a moderator set (utils/livekitGrants.ts).
      grant = spaceVoiceGrant(request.userId, spaceId, channelId);
      roomName = channelId;
    } else {
      return sendError(reply, 400, 'validation_failed');
    }

    const identity = `${request.userId}:${request.username}`;

    // Short, since it is what someone put out of a call could come back with: a connected client
    // gets new ones from LiveKit by itself, and joining anew asks here first.
    const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity,
      ttl: '10m',
    });

    token.addGrant({ room: roomName, roomJoin: true, ...grant });

    const jwt = await token.toJwt();

    const livekitUrl = config.livekit.url ?? '';

    const response: LiveKitTokenResponse = {
      token: jwt,
      url: livekitUrl
    };
    return reply.code(200).send(response);
  });
}
