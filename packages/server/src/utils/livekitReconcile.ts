import { eq } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { hasPermission, PermissionBits } from './permissions.js';

/**
 * Who sits in a space's voice channel at LiveKit is held to who this server has there
 * (docs/systems/voice.md, "Who is in a call"). A token is handed out before the socket hears of a
 * join, and LiveKit is asked nothing again while a client stays connected. So without this:
 *
 * - a client that takes a token and never sends `voice_join`, or sends `voice_leave` and stays,
 *   listens to a channel in which nobody sees it, and no moderator can disconnect, move or mute it;
 * - someone who lost VIEW_CHANNEL or CONNECT there while in that state stays as well, since
 *   `checkVoicePermissions` only looks at the people this server has in the room.
 *
 * Every half minute the open rooms that are a space's voice channel are read. A participant this
 * server does not have in the room, or who may no longer be in it, is noted; one still so at the
 * next look is put out. Two looks, because joining goes token, LiveKit, then `voice_join`, and a
 * dropped socket keeps its seat for its reconnect grace: neither is ever two looks long.
 *
 * A conversation's call (`dm-`, `fed:`) is not looked at: who is in it is settled where someone
 * leaves or is removed (routes/dm.ts), and one hosted with a peer has people this server never
 * seats. The overlay's hidden participant (`overlay:`) is its own module's (utils/voiceOverlays.ts).
 */
const INTERVAL_MS = 30_000;
const OVERLAY_IDENTITY = 'overlay:';

/** What the reconciler needs of LiveKit: the two reads and the removal. */
export interface RoomService {
  listRooms(): Promise<Array<{ name: string }>>;
  listParticipants(room: string): Promise<Array<{ identity: string }>>;
  removeParticipant(room: string, identity: string): Promise<unknown>;
}

/** Who this server has in a room: `connectionManager.getRoomParticipants`, passed in so this module does not import the socket. */
export type SeatedIn = (roomId: string) => ReadonlySet<string>;

/** `room\nidentity` of who was out of place at the last look, and when that was first seen. */
const outOfPlace = new Map<string, number>();

/** The space a room belongs to when it is a voice channel, else null. */
function voiceChannelSpace(roomName: string): string | null {
  if (!/^\d{1,20}$/.test(roomName)) return null;
  const channel = getDb().select({ spaceId: schema.channels.spaceId, type: schema.channels.type })
    .from(schema.channels).where(eq(schema.channels.id, roomName)).get();
  return channel?.type === 'voice' ? channel.spaceId : null;
}

/**
 * One look. Returns the identities put out, as `room\nidentity`. `graceMs` is how long someone
 * must have been out of place before they go: the time between two looks.
 */
export async function reconcileVoiceRooms(service: RoomService, seatedIn: SeatedIn, now: number = Date.now(), graceMs: number = INTERVAL_MS - 1000): Promise<string[]> {
  const seen = new Set<string>();
  const removed: string[] = [];
  for (const room of await service.listRooms()) {
    const spaceId = voiceChannelSpace(room.name);
    if (spaceId === null) continue;
    const seated = seatedIn(room.name);
    for (const participant of await service.listParticipants(room.name)) {
      const { identity } = participant;
      if (identity.startsWith(OVERLAY_IDENTITY)) continue;
      const colon = identity.indexOf(':');
      const userId = colon > 0 ? identity.slice(0, colon) : identity;
      const inPlace = seated.has(userId)
        && hasPermission(userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT, room.name);
      const key = `${room.name}\n${identity}`;
      if (inPlace) continue;
      seen.add(key);
      const since = outOfPlace.get(key);
      if (since === undefined) {
        outOfPlace.set(key, now);
      } else if (now - since >= graceMs) {
        await service.removeParticipant(room.name, identity);
        removed.push(key);
        seen.delete(key);
      }
    }
  }
  for (const key of [...outOfPlace.keys()]) {
    if (!seen.has(key)) outOfPlace.delete(key);
  }
  return removed;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastFailure = 0;

/** Starts the looks, on an instance with LiveKit. The first comes one interval after the start, when clients have come back. */
export function startVoiceReconciler(seatedIn: SeatedIn): void {
  const { apiUrl, url, apiKey, apiSecret } = config.livekit;
  const host = apiUrl ?? url;
  if (timer || !host || !apiKey || !apiSecret) return;
  const service = new RoomServiceClient(host, apiKey, apiSecret) as unknown as RoomService;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    reconcileVoiceRooms(service, seatedIn)
      .then((removed) => {
        if (removed.length > 0) console.log(`[livekit] put ${removed.length} participant(s) out of calls this server does not have them in`);
      })
      .catch((err: unknown) => {
        // LiveKit away is said once an hour, not every half minute.
        if (Date.now() - lastFailure > 60 * 60_000) {
          lastFailure = Date.now();
          console.warn(`[livekit] Could not compare the calls with who is in them: ${err instanceof Error ? err.message : 'unknown error'}`);
        }
      })
      .finally(() => { running = false; });
  }, INTERVAL_MS);
  timer.unref();
}

export function stopVoiceReconciler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  outOfPlace.clear();
}

/** Tests only. */
export function _resetVoiceReconciler(): void {
  outOfPlace.clear();
}
