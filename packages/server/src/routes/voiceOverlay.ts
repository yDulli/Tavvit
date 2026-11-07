import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { CreateVoiceOverlayResponse, VoiceOverlayLinkResponse } from '@backspace/shared/src/voiceOverlay.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { hasPermission, PermissionBits } from '../utils/permissions.js';
import { OVERLAY_PERMISSIONS, createVoiceOverlay, deleteVoiceOverlay, voiceOverlayOf, voiceOverlayState } from '../utils/voiceOverlays.js';

/** A voice channel of a space, or null for anything else. */
function voiceChannelOf(id: string): { id: string; spaceId: string } | null {
  const row = getDb().select({ id: schema.channels.id, spaceId: schema.channels.spaceId, type: schema.channels.type })
    .from(schema.channels).where(eq(schema.channels.id, id)).get();
  return row && row.spaceId && row.type === 'voice' ? { id: row.id, spaceId: row.spaceId } : null;
}

/**
 * The voice overlay (docs/systems/voice-overlay.md). A person's own link for a voice channel:
 * whether they have one, a new one (its secret shown this once, the old one ending), taking it
 * away. And what the overlay page asks with a link's secret, without an account: who is in the
 * channel and how to hear who speaks.
 */
export async function voiceOverlayRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/channels/:id/overlay', { preHandler: authenticate }, async (request, reply) => {
    const channel = voiceChannelOf(request.params.id);
    if (!channel || !hasPermission(request.userId, channel.spaceId, PermissionBits.VIEW_CHANNEL, channel.id)) {
      return sendError(reply, 404, 'channel_not_found');
    }
    const link = voiceOverlayOf(request.userId, channel.id);
    const response: VoiceOverlayLinkResponse = { exists: link !== null, createdAt: link?.createdAt ?? null };
    return reply.code(200).send(response);
  });

  app.post<{ Params: { id: string } }>('/api/channels/:id/overlay', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return sendError(reply, 503, 'voice_disabled');
    }
    const channel = voiceChannelOf(request.params.id);
    if (!channel || !hasPermission(request.userId, channel.spaceId, PermissionBits.VIEW_CHANNEL, channel.id)) {
      return sendError(reply, 404, 'channel_not_found');
    }
    // Showing who talks in a channel is showing the channel: whoever makes the link must be allowed to stream there.
    if (!hasPermission(request.userId, channel.spaceId, OVERLAY_PERMISSIONS, channel.id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'STREAM' });
    }
    const created = createVoiceOverlay(request.userId, channel.spaceId, channel.id);
    const response: CreateVoiceOverlayResponse = { secret: created.secret, createdAt: created.createdAt };
    return reply.code(201).send(response);
  });

  app.delete<{ Params: { id: string } }>('/api/channels/:id/overlay', { preHandler: authenticate }, async (request, reply) => {
    const channel = voiceChannelOf(request.params.id);
    if (!channel || !hasPermission(request.userId, channel.spaceId, PermissionBits.VIEW_CHANNEL, channel.id)) {
      return sendError(reply, 404, 'channel_not_found');
    }
    deleteVoiceOverlay(request.userId, channel.id);
    return reply.code(200).send({ success: true });
  });

  // The overlay page asks every few seconds; a link is a secret, so a guess gets nowhere and nothing is cached.
  app.get<{ Params: { secret: string } }>('/api/overlay/voice/:secret', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const state = await voiceOverlayState(request.params.secret);
    if (!state) return sendError(reply, 404, 'voice_overlay_unavailable');
    return reply.code(200).send(state);
  });
}
