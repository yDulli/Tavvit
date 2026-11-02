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
