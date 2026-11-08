import { and, eq } from 'drizzle-orm';
import type { Channel, MemberWithUser, Role, Space, SpaceDefaultNotificationLevel } from '@backspace/shared';
import { isSpaceDefaultNotificationLevel } from '@backspace/shared';
import type { MemberBadgeId } from '@backspace/shared/src/badges.js';
import { PermissionBits, stringToPermissions } from '@backspace/shared/src/permissions.js';
import { getDb, schema } from '../db/index.js';
import type { channels, spaceMembers, spaces } from '../db/schema.js';
import { memberRolesView } from './permissionDataView.js';
import { publicUserOf, type PublicUserRow } from './sanitize.js';
import { activeTimeoutUntil } from './spaceModeration.js';
import { spaceBadgesOf } from './badges.js';
import { mediaOriginsFor, shownPicture } from './remoteMedia.js';
import { parseStoredSpaceTag } from '@backspace/shared/src/spaceTags.js';
import { parseStoredSpaceLook } from '@backspace/shared/src/looks.js';
import { channelHasVoiceOverlay } from './voiceOverlayChannels.js';

// The wire shapes of a space, a channel and a member, built in one place for
// every route and event that sends them (the ready payload, the space detail
// and lists, join answers, member_*, channel_* and space_updated), so a field
// added to a row reaches every client the same way.

type SpaceRow = typeof spaces.$inferSelect;
type ChannelRow = typeof channels.$inferSelect;
type MemberRow = typeof spaceMembers.$inferSelect;

/** A stored default notification level as the wire carries it: null for none or for a value this version does not know. */
export function storedSpaceDefaultLevel(value: string | null): SpaceDefaultNotificationLevel | null {
  return isSpaceDefaultNotificationLevel(value) ? value : null;
}

/** A space row as every client receives it (without channels, members or roles). */
export function spaceToWire(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    // Every member fetches these by themselves: a file here, never an address elsewhere (utils/remoteMedia.ts).
    icon: shownPicture(row.icon, mediaOriginsFor()),
    banner: shownPicture(row.banner, mediaOriginsFor()),
    avatarColor: (row.avatarColor as Space['avatarColor']) ?? null,
    ownerId: row.ownerId,
    ownerTitle: row.ownerTitle,
    ownerGroup: row.ownerGroup === 1,
    // Not on the wire: this goes to every member, and a link is for those who may
    // hand it out (POST /api/spaces/:id/invite, CREATE_INVITE).
    inviteCode: null,
    vanityCode: row.vanityCode ?? null,
    visibility: (row.visibility ?? 'private') as Space['visibility'],
    directoryListed: row.directoryListed === 1,
    description: row.description ?? null,
    badges: spaceBadgesOf(row),
    tag: parseStoredSpaceTag(row.tag),
    look: parseStoredSpaceLook(row.look),
    defaultNotificationLevel: storedSpaceDefaultLevel(row.defaultNotificationLevel),
    createdAt: row.createdAt,
  };
}

/** A channel row as every client receives it; per-viewer fields (`isPrivate`, `myPermissions`, `lastMessageId`) are added by the caller. */
export function channelToWire(row: ChannelRow): Channel {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    type: row.type as Channel['type'],
    topic: row.topic,
    position: row.position ?? 0,
    categoryId: row.categoryId ?? null,
    slowmodeSeconds: row.slowmodeSeconds ?? 0,
    icon: row.icon ?? null,
    ...(row.type === 'voice' ? { streamOverlay: channelHasVoiceOverlay(row.id) } : {}),
    createdAt: row.createdAt,
  };
}

/**
 * A member row with its account and roles (display fields only, as
 * `memberRolesView` shapes them). `timedOutUntil` is the end of a timeout
 * still running at `now`, else null, so a client never reads an ended one as
 * in force.
 */
/** The role bits that make a member a moderator of the space (badges.ts). */
const MODERATION_BITS = PermissionBits.KICK_MEMBERS | PermissionBits.BAN_MEMBERS | PermissionBits.MODERATE_MEMBERS | PermissionBits.MANAGE_MESSAGES;

/**
 * The staff badges a member's roles give them in their space: administrator
 * for a role with ADMINISTRATOR, else moderator for one with a moderation bit
 * (docs/systems/badges.md). Worked out here because members cannot see role
 * bits. @everyone is left out, since what everyone holds marks nobody, and so
 * is owning the space, which the client reads from the space's owner id.
 */
export function memberStaffBadges(
  roles: ReadonlyArray<{ id: string; permissions: string | null }>,
  assignedRoleIds: ReadonlySet<string>,
  spaceId: string,
): MemberBadgeId[] {
  let bits = 0n;
  for (const role of roles) {
    if (role.id === spaceId || !assignedRoleIds.has(role.id)) continue;
    bits |= stringToPermissions(role.permissions);
  }
  if ((bits & PermissionBits.ADMINISTRATOR) !== 0n) return ['administrator'];
  return (bits & MODERATION_BITS) !== 0n ? ['moderator'] : [];
}

export function memberToWire(row: Omit<MemberRow, 'rulesAcceptedAt'>, user: PublicUserRow, roles: Role[], now: number = Date.now(), badges: MemberBadgeId[] = []): MemberWithUser {
  return {
    spaceId: row.spaceId,
    userId: row.userId,
    nickname: row.nickname,
    avatar: row.avatar ?? null,
    banner: row.banner ?? null,
    bio: row.bio ?? null,
    joinedAt: row.joinedAt,
    timedOutUntil: activeTimeoutUntil(row.timedOutUntil, now),
    user: publicUserOf(user),
    roles,
    badges,
  };
}

/** One member of a space as `memberToWire` builds it, read from the database; null when there is no such member or account. */
export function loadMemberWire(spaceId: string, userId: string, now: number = Date.now()): MemberWithUser | null {
  const db = getDb();
  const member = db.select().from(schema.spaceMembers)
    .where(and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.spaceMembers.userId, userId))).get();
  if (!member) return null;
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return null;
  const assignedRoleIds = new Set(db.select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.userId, userId)))
    .all()
    .map((r) => r.roleId));
  const roles = db.select().from(schema.roles).where(eq(schema.roles.spaceId, spaceId))
    .orderBy(schema.roles.position).all();
  return memberToWire(member, user, memberRolesView(roles, assignedRoleIds), now, memberStaffBadges(roles, assignedRoleIds, spaceId));
}
