import { usableInvite } from './spaceInvites.js';
import { isAvatarColor, type AvatarColor, type InvitePreview, type SpaceVisibility } from '@backspace/shared';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { safeFetch } from './ssrf.js';
import { instanceOrigin, mediaOriginsFor, shownPicture } from './remoteMedia.js';

export interface SpaceInviteSnapshot {
  spaceId: string;
  spaceName: string;
  description: string | null;
  icon: string | null;
  avatarColor: AvatarColor | null;
  memberCount: number;
  instanceName: string;
}

/**
 * The invite preview for a code on this instance, or null when no space holds
 * it. This is what `GET /api/spaces/invite/:code/preview` answers: the
 * snapshot fields plus the space's current visibility, read on every call so
 * a link follows the space's visibility at the time it is opened.
 */
export function getLocalInvitePreview(inviteCode: string): InvitePreview | null {
  const db = getDb();
  const invite = usableInvite(inviteCode);
  if (!invite) return null;
  const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, invite.spaceId)).get();
  if (!space) return null;

  const memberCount = db.select({ value: sql<number>`count(*)` }).from(schema.spaceMembers)
    .where(eq(schema.spaceMembers.spaceId, space.id)).get()?.value ?? 0;

  const settings = db.select().from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get();
  const instanceName = settings?.instanceName ?? DEFAULT_INSTANCE_NAME;

  return {
    spaceId: space.id,
    spaceName: space.name,
    description: space.description ?? null,
    icon: shownPicture(space.icon, mediaOriginsFor()),
    avatarColor: (space.avatarColor as AvatarColor | null) ?? null,
    memberCount,
    instanceName,
    visibility: (space.visibility ?? 'private') as SpaceVisibility,
    movedFromDiscord: space.discordImportedAt !== null,
  };
}

/**
 * Build a local invite snapshot directly from the DB. Used when the space
 * lives on this instance — avoids an HTTP roundtrip through our own domain
 * (which fails inside Docker due to NAT loopback) and is faster anyway.
 *
 * Returns the same shape as `fetchSpaceInviteSnapshot` so callers don't
 * branch downstream of the snapshot lookup.
 */
export function getLocalInviteSnapshot(inviteCode: string): SpaceInviteSnapshot | null {
  const preview = getLocalInvitePreview(inviteCode);
  if (!preview) return null;
  return {
    spaceId: preview.spaceId,
    spaceName: preview.spaceName,
    description: preview.description,
    icon: preview.icon,
    avatarColor: preview.avatarColor,
    memberCount: preview.memberCount,
    instanceName: preview.instanceName,
  };
}

/**
 * Fetch a space invite preview from a (possibly remote) instance.
 * Returns null on 4xx, network error, or timeout — caller should treat as
 * "invite no longer valid".
 *
 * Uses a 5s default timeout so a slow/unreachable Z does not stall the
 * caller-instance request.
 */
export async function fetchSpaceInviteSnapshot(
  spaceInstanceOrigin: string,
  inviteCode: string,
  timeoutMs = 5000,
): Promise<SpaceInviteSnapshot | null> {
  const url = `${spaceInstanceOrigin}/api/spaces/invite/${encodeURIComponent(inviteCode)}/preview`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json() as Partial<SpaceInviteSnapshot>;
    if (typeof data?.spaceId !== 'string' || typeof data?.spaceName !== 'string') return null;
    return {
      spaceId: data.spaceId,
      spaceName: data.spaceName,
      description: data.description ?? null,
      // Whoever sees the invite fetches its icon: a file of that instance, by name or address, and nothing elsewhere.
      icon: typeof data.icon === 'string' ? shownPicture(data.icon, [instanceOrigin(spaceInstanceOrigin) ?? spaceInstanceOrigin]) : null,
      avatarColor: isAvatarColor(data.avatarColor) ? data.avatarColor : null,
      memberCount: typeof data.memberCount === 'number' ? data.memberCount : 0,
      instanceName: data.instanceName ?? DEFAULT_INSTANCE_NAME,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
