import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { AccessToken } from 'livekit-server-sdk';
import { decorationsOf } from '@backspace/shared/src/decorations.js';
import type { VoiceOverlayPerson, VoiceOverlayState } from '@backspace/shared/src/voiceOverlay.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { hasPermission, PermissionBits } from './permissions.js';
import { shownAccountPicture, mediaOriginsFor, shownPicture } from './remoteMedia.js';
import { generateSnowflake } from './snowflake.js';
import { channelToWire } from './spaceWire.js';
import { activeSuspension } from './suspension.js';
import { markVoiceOverlayChannel, resetVoiceOverlayChannels } from './voiceOverlayChannels.js';
import { withoutUnsafeCharacters } from '@backspace/shared/src/profileFields.js';

/**
 * The voice overlay (docs/systems/voice-overlay.md): a link that shows a voice channel in a
 * stream. Only the SHA-256 of a link's secret is stored; the secret is shown once, when it is
 * made. A link works while the person who made it may still be in the channel and stream there,
 * and the channel says to everyone in its space that it has one.
 */

/** What a link needs of its maker in the channel: to see it, to join it, and to stream there. */
export const OVERLAY_PERMISSIONS = PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT | PermissionBits.STREAM;

const hashOf = (secret: string): string => createHash('sha256').update(secret).digest('hex');

/** Fills the memory of which channels have a link (`voiceOverlayChannels.ts`), at start. */
export function loadVoiceOverlayChannels(): void {
  resetVoiceOverlayChannels(getDb().select({ channelId: schema.voiceOverlays.channelId }).from(schema.voiceOverlays).all().map((row) => row.channelId));
}

/** Everyone who sees the channel hears that it now has, or no longer has, a link. */
function announceChannel(channelId: string): void {
  const db = getDb();
  const has = db.select({ id: schema.voiceOverlays.id }).from(schema.voiceOverlays).where(eq(schema.voiceOverlays.channelId, channelId)).get() !== undefined;
  if (!markVoiceOverlayChannel(channelId, has)) return;
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel?.spaceId) return;
  connectionManager.sendToChannel(channel.spaceId, channel.id, { type: 'channel_updated', channel: channelToWire(channel), spaceId: channel.spaceId });
}

/** A new link for a person and channel, ending the one they had there. Answers its secret, shown this once. */
export function createVoiceOverlay(userId: string, spaceId: string, channelId: string): { secret: string; createdAt: number } {
  const secret = randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.voiceOverlays).where(and(eq(schema.voiceOverlays.channelId, channelId), eq(schema.voiceOverlays.userId, userId))).run();
    tx.insert(schema.voiceOverlays).values({ id: generateSnowflake(), channelId, spaceId, userId, tokenHash: hashOf(secret), createdAt }).run();
  });
  announceChannel(channelId);
  return { secret, createdAt };
}

/** A person's link for a channel taken away. Answers whether there was one. */
export function deleteVoiceOverlay(userId: string, channelId: string): boolean {
  const result = getDb().delete(schema.voiceOverlays)
    .where(and(eq(schema.voiceOverlays.channelId, channelId), eq(schema.voiceOverlays.userId, userId)))
    .run();
  announceChannel(channelId);
  return result.changes > 0;
}

export function voiceOverlayOf(userId: string, channelId: string): { createdAt: number } | null {
  const row = getDb().select({ createdAt: schema.voiceOverlays.createdAt }).from(schema.voiceOverlays)
    .where(and(eq(schema.voiceOverlays.channelId, channelId), eq(schema.voiceOverlays.userId, userId)))
    .get();
  return row ?? null;
}

/**
 * What the page of a link shows: the channel's name, everyone in it as this space shows them, and
 * a way to hear who speaks. Null when the link is unknown, or its maker may no longer stream there.
 */
export async function voiceOverlayState(secret: string, now = Date.now()): Promise<VoiceOverlayState | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(secret)) return null;
  const db = getDb();
  const link = db.select().from(schema.voiceOverlays).where(eq(schema.voiceOverlays.tokenHash, hashOf(secret))).get();
  if (!link) return null;
  const maker = db.select().from(schema.users).where(eq(schema.users.id, link.userId)).get();
  if (!maker || maker.isDeleted === 1 || activeSuspension(maker, now)) return null;
  if (!hasPermission(link.userId, link.spaceId, OVERLAY_PERMISSIONS, link.channelId)) return null;
  const channel = db.select({ name: schema.channels.name, type: schema.channels.type }).from(schema.channels).where(eq(schema.channels.id, link.channelId)).get();
  if (!channel || channel.type !== 'voice') return null;

  // When a page last asked, to the minute: enough to see that a link is in use, without a write each time.
  const minute = Math.floor(now / 60_000) * 60_000;
  if (link.lastUsedAt !== minute) {
    db.update(schema.voiceOverlays).set({ lastUsedAt: minute }).where(eq(schema.voiceOverlays.id, link.id)).run();
  }

  const room = connectionManager.getRoom(link.channelId);
  const ids = room ? [...room.participants] : [];
  const pictureOrigins = mediaOriginsFor();
  const people: VoiceOverlayPerson[] = [];
  for (const id of ids) {
    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!user || user.isDeleted === 1) continue;
    const member = db.select({ nickname: schema.spaceMembers.nickname, avatar: schema.spaceMembers.avatar })
      .from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, link.spaceId), eq(schema.spaceMembers.userId, id)))
      .get();
    const status = connectionManager.getVoiceUserStatus(id);
    const pictureHome = user.federationHomeOrphaned === 1 ? null : user.homeInstance;
    const name = member?.nickname ?? user.displayName ?? user.username;
    people.push({
      id,
      name: withoutUnsafeCharacters(name),
      avatar: (member?.avatar ? shownPicture(member.avatar, pictureOrigins) : null) ?? shownAccountPicture(user.avatar, pictureHome),
      avatarColor: user.avatarColor ?? null,
      tileKey: user.homeUserId ?? user.id,
      frame: decorationsOf(user).avatarFrame,
      muted: status?.isMuted ?? false,
      deafened: status?.isDeafened ?? false,
    });
  }

  let livekit: VoiceOverlayState['livekit'] = null;
  if (config.livekit.apiKey && config.livekit.apiSecret && config.livekit.url) {
    // A participant nobody sees that can neither hear, nor send, nor publish: it only learns who speaks.
    const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, { identity: `overlay:${link.id}`, ttl: '10m' });
    token.addGrant({ room: link.channelId, roomJoin: true, hidden: true, canPublish: false, canSubscribe: false, canPublishData: false });
    livekit = { url: config.livekit.url, token: await token.toJwt() };
  }

  return { channelName: channel.name, people, livekit };
}
