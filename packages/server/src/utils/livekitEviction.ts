import { eq } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';

/**
 * Puts someone out of every call on this instance's LiveKit, at once (docs/systems/voice.md,
 * "Removing someone from a call"). Their token stays good at LiveKit for as long as it lasts and
 * a connected client is not asked again, so ending a session or suspending an account only stops
 * the call by telling LiveKit.
 *
 * Every room is looked at, not only the one the socket says they are in: a client may hold a
 * token and be in a call without ever having told the socket. It runs when an account or a session
 * ends, which is rare, and never holds up what asked for it. A call hosted by another instance
 * is that instance's to end.
 */
/**
 * Puts someone out of one room on this instance's LiveKit: the voice channel of a space they were
 * disconnected from, moved out of, timed out, kicked or banned from (ws/events.ts,
 * disconnectFromSpaceVoice). Their client is told to leave as well, but a client that does not
 * listen would stay in the room, and hear it, for as long as it liked.
 */
export function evictFromLiveKitRoom(userId: string, roomName: string): void {
  const { apiUrl, url, apiKey, apiSecret } = config.livekit;
  const host = apiUrl ?? url;
  if (!host || !apiKey || !apiSecret) return;

  void (async () => {
    try {
      const client = new RoomServiceClient(host, apiKey, apiSecret);
      for (const participant of await client.listParticipants(roomName)) {
        if (participant.identity.startsWith(`${userId}:`)) await client.removeParticipant(roomName, participant.identity);
      }
    } catch (err) {
      // A room LiveKit has already closed has nobody in it.
      console.warn(`[livekit] Could not put ${userId} out of ${roomName}: ${(err as Error).message}`);
    }
  })();
}

/**
 * Puts someone out of each of these rooms that exists on this instance's LiveKit, whether or not
 * the socket ever heard of them being there: a token is handed out before `voice_join` is sent,
 * so a client that takes the token and never says so sits in the call unseen. Kicking, banning or
 * timing a member out ends that too (ws/events.ts, disconnectMemberFromSpaceVoice), as leaving
 * or being removed from a group conversation does (routes/dm.ts). One listing of the rooms, then
 * only those that are open.
 */
export function evictFromLiveKitRooms(userId: string, roomNames: readonly string[]): void {
  const { apiUrl, url, apiKey, apiSecret } = config.livekit;
  const host = apiUrl ?? url;
  if (!host || !apiKey || !apiSecret || roomNames.length === 0) return;

  void (async () => {
    try {
      const account = getDb().select({ homeUserId: schema.users.homeUserId }).from(schema.users).where(eq(schema.users.id, userId)).get();
      // A person from elsewhere is in a conversation's call under the id their home gave them.
      const prefixes = [`${userId}:`, ...(account?.homeUserId ? [`${account.homeUserId}:`] : [])];
      const client = new RoomServiceClient(host, apiKey, apiSecret);
      for (const room of await client.listRooms([...roomNames])) {
        for (const participant of await client.listParticipants(room.name)) {
          if (prefixes.some((prefix) => participant.identity.startsWith(prefix))) {
            await client.removeParticipant(room.name, participant.identity);
          }
        }
      }
    } catch (err) {
      console.warn(`[livekit] Could not put ${userId} out of ${roomNames.length} room(s): ${(err as Error).message}`);
    }
  })();
}

/**
 * Puts one participant out of a room by its whole identity: the hidden one of a voice overlay
 * whose link was replaced, taken away, or whose maker may no longer stream there
 * (utils/voiceOverlays.ts). It only ever learned who speaks, and must not go on learning it.
 */
export function evictIdentityFromLiveKitRoom(roomName: string, identity: string): void {
  const { apiUrl, url, apiKey, apiSecret } = config.livekit;
  const host = apiUrl ?? url;
  if (!host || !apiKey || !apiSecret) return;

  void (async () => {
    try {
      const client = new RoomServiceClient(host, apiKey, apiSecret);
      for (const room of await client.listRooms([roomName])) {
        for (const participant of await client.listParticipants(room.name)) {
          if (participant.identity === identity) await client.removeParticipant(room.name, participant.identity);
        }
      }
    } catch (err) {
      console.warn(`[livekit] Could not end an overlay's connection to ${roomName}: ${(err as Error).message}`);
    }
  })();
}

export function evictFromLiveKit(userId: string): void {
  const { apiUrl, url, apiKey, apiSecret } = config.livekit;
  const host = apiUrl ?? url;
  if (!host || !apiKey || !apiSecret) return;

  void (async () => {
    try {
      const account = getDb().select({ homeUserId: schema.users.homeUserId }).from(schema.users).where(eq(schema.users.id, userId)).get();
      // A person from elsewhere is in a call under the id their home gave them.
      const prefixes = [`${userId}:`, ...(account?.homeUserId ? [`${account.homeUserId}:`] : [])];
      const client = new RoomServiceClient(host, apiKey, apiSecret);
      for (const room of await client.listRooms()) {
        for (const participant of await client.listParticipants(room.name)) {
          if (prefixes.some((prefix) => participant.identity.startsWith(prefix))) {
            await client.removeParticipant(room.name, participant.identity);
          }
        }
      }
    } catch (err) {
      console.warn(`[livekit] Could not put ${userId} out of their calls: ${(err as Error).message}`);
    }
  })();
}
