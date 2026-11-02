import { and, eq } from 'drizzle-orm';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { computePermissions, PermissionBits } from './permissions.js';

/**
 * What LiveKit lets someone do in a call (docs/systems/voice.md, "What LiveKit enforces"). The
 * client is told the same, but a client that does not listen is held to this by LiveKit itself.
 */
export interface VoiceGrant {
  canPublish: boolean;
  canPublishSources: TrackSource[];
  canSubscribe: boolean;
  canPublishData: boolean;
}

/** A DM call: everyone in it may do everything. */
export const FULL_VOICE_GRANT: VoiceGrant = {
  canPublish: true,
  canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
  canSubscribe: true,
  canPublishData: true,
};

/**
 * In a space's voice channel: the microphone and the camera with SPEAK, a shared screen with
 * STREAM, less what a moderator took in the space. A space mute takes every sound and the camera,
 * a shared screen's sound too, so a muted member does not speak through it; a space deafen takes
 * hearing, and with it what the others send.
 */
export function spaceVoiceGrant(userId: string, spaceId: string, channelId: string): VoiceGrant {
  const perms = computePermissions(userId, spaceId, channelId);
  const admin = (perms & PermissionBits.ADMINISTRATOR) !== 0n;
  const restricted = new Set(getDb().select({ type: schema.voiceRestrictions.restrictionType })
    .from(schema.voiceRestrictions)
    .where(and(eq(schema.voiceRestrictions.spaceId, spaceId), eq(schema.voiceRestrictions.userId, userId)))
    .all()
    .map((row) => row.type));
  const muted = restricted.has('mute');
  const canSpeak = (admin || (perms & PermissionBits.SPEAK) !== 0n) && !muted;
  const canStream = admin || (perms & PermissionBits.STREAM) !== 0n;
  const sources: TrackSource[] = [];
  if (canSpeak) sources.push(TrackSource.MICROPHONE, TrackSource.CAMERA);
  if (canStream) sources.push(TrackSource.SCREEN_SHARE);
  if (canStream && !muted) sources.push(TrackSource.SCREEN_SHARE_AUDIO);
  return { canPublish: sources.length > 0, canPublishSources: sources, canSubscribe: !restricted.has('deafen'), canPublishData: true };
}

/**
 * Tells LiveKit what each of these people may now do in `roomName`, and silences a track one of
 * them sends but may no longer: a token already handed out keeps its grant until LiveKit is told.
 * Keyed by account id, the start of their identity there. Never holds up what asked for it.
 */
export function applyVoiceGrants(roomName: string, grants: ReadonlyMap<string, VoiceGrant>): void {
  const { apiUrl, url, apiKey, apiSecret } = config.livekit;
  const host = apiUrl ?? url;
  if (!host || !apiKey || !apiSecret || grants.size === 0) return;

  void (async () => {
    try {
      const client = new RoomServiceClient(host, apiKey, apiSecret);
      for (const participant of await client.listParticipants(roomName)) {
        const colon = participant.identity.indexOf(':');
        const grant = colon > 0 ? grants.get(participant.identity.slice(0, colon)) : undefined;
        if (!grant) continue;
        await client.updateParticipant(roomName, participant.identity, { permission: { ...grant } });
        for (const track of participant.tracks) {
          if (!track.muted && !grant.canPublishSources.includes(track.source)) {
            await client.mutePublishedTrack(roomName, participant.identity, track.sid, true);
          }
        }
      }
    } catch (err) {
      // A room LiveKit has already closed has nobody in it to tell.
      console.warn(`[livekit] Could not change what people may do in ${roomName}: ${(err as Error).message}`);
    }
  })();
}

/** The same for one person in a space's voice channel, after a moderator or a role changed what they may do there. */
export function applySpaceVoiceGrant(userId: string, spaceId: string, channelId: string): void {
  applyVoiceGrants(channelId, new Map([[userId, spaceVoiceGrant(userId, spaceId, channelId)]]));
}
