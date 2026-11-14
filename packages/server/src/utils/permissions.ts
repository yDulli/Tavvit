import { eq, and, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { batchInArray } from './sqlBatch.js';
import {
  PermissionBits,
  ALL_PERMISSIONS,
  stringToPermissions,
  permissionsToString,
} from '@backspace/shared/src/permissions.js';

// Re-export for convenience
export { PermissionBits, ALL_PERMISSIONS, permissionsToString, stringToPermissions };

// ─── Core Resolution Engine ─────────────────────────────────────────────────

/**
 * Compute the effective permissions for a user in a space, optionally scoped
 * to a specific channel. Follows Discord's resolution order:
 *
 * 1. Owner → ALL_PERMISSIONS
 * 2. Base = @everyone.permissions | union of all assigned role permissions
 * 3. ADMINISTRATOR in base → ALL_PERMISSIONS
 * 4. If channelId provided, apply channel overrides in order:
 *    a. @everyone role override
 *    b. Role overrides (combined)
 *    c. Member-specific override
 */
export function computePermissions(userId: string, spaceId: string, channelId?: string): bigint {
  const db = getDb();

  // 1. Owner check
  const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) return 0n;
  if (space.ownerId === userId) return ALL_PERMISSIONS;

  // 1b. Instance admin — full access across all spaces
  const userRow = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (userRow?.isAdmin === 1) return ALL_PERMISSIONS;

  // 1c. Membership gate — a user who has not joined the space has NO permissions
  // in it. Without this, the @everyone role below leaks default member rights
  // (VIEW_CHANNEL, READ_MESSAGE_HISTORY, CREATE_INVITE, …) to any authenticated
  // non-member, which allowed reading channels and minting invite codes for
  // spaces the caller never joined. Owner and instance admin are handled above.
  if (!getMember(spaceId, userId)) return 0n;

  // 2. Base permissions from @everyone role (id === spaceId)
  const everyoneRole = db.select().from(schema.roles)
    .where(and(eq(schema.roles.id, spaceId), eq(schema.roles.spaceId, spaceId)))
    .get();
  let base = everyoneRole ? stringToPermissions(everyoneRole.permissions) : 0n;

  // Get user's assigned roles via member_roles
  const memberRoleRows = db.select().from(schema.memberRoles)
    .where(and(
      eq(schema.memberRoles.spaceId, spaceId),
      eq(schema.memberRoles.userId, userId),
    ))
    .all();

  const assignedRoleIds = memberRoleRows.map(mr => mr.roleId);

  if (assignedRoleIds.length > 0) {
    // Fetch all assigned roles and OR their permissions into base
    for (const roleId of assignedRoleIds) {
      const role = db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).get();
      if (role) {
        base |= stringToPermissions(role.permissions);
      }
    }
  }

  // 3. Admin shortcut
  if ((base & PermissionBits.ADMINISTRATOR) !== 0n) return ALL_PERMISSIONS;

  // If no channel, return space-level perms
  if (!channelId) return base;

  // Look up the channel to get its categoryId
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel) return base;

  // A thread has the rights of the channel it is in, and no overrides of its own.
  if (channel.type === 'thread' && channel.parentChannelId) {
    return computePermissions(userId, spaceId, channel.parentChannelId);
  }

  // Fetch category overrides (if channel is in a category)
  let catOverrides: OverrideRow[] = [];
  if (channel.categoryId) {
    catOverrides = db.select().from(schema.categoryOverrides)
      .where(eq(schema.categoryOverrides.categoryId, channel.categoryId))
      .all();
  }

  // Fetch channel overrides
  const chanOverrides = db.select().from(schema.channelOverrides)
    .where(eq(schema.channelOverrides.channelId, channelId))
    .all();

  // If neither has overrides, return base
  if (catOverrides.length === 0 && chanOverrides.length === 0) return base;

  return applyOverrides(base, spaceId, userId, assignedRoleIds, catOverrides, chanOverrides);
}

type OverrideRow = { targetType: string; targetId: string; allow: string; deny: string };

/** What a member with no role holds in a channel: @everyone's rights, with its overrides. */
export function everyonePermissions(spaceId: string, channelId: string): bigint {
  const db = getDb();
  const everyoneRole = db.select().from(schema.roles)
    .where(and(eq(schema.roles.id, spaceId), eq(schema.roles.spaceId, spaceId)))
    .get();
  const base = everyoneRole ? stringToPermissions(everyoneRole.permissions) : 0n;
  if ((base & PermissionBits.ADMINISTRATOR) !== 0n) return ALL_PERMISSIONS;
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel) return base;
  const catOverrides = channel.categoryId
    ? db.select().from(schema.categoryOverrides).where(eq(schema.categoryOverrides.categoryId, channel.categoryId)).all()
    : [];
  const chanOverrides = db.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, channelId)).all();
  return applyOverrides(base, spaceId, '', [], catOverrides, chanOverrides);
}

/**
 * What someone holds in a category: their rights in the space with the category's own overrides
 * on them, which is what a channel in it starts from. Whoever is not in the space holds nothing,
 * and whoever holds everything (owner, instance admin, ADMINISTRATOR) holds it here too.
 */
export function computeCategoryPermissions(userId: string, spaceId: string, categoryId: string): bigint {
  const held = computePermissions(userId, spaceId);
  if ((held & ALL_PERMISSIONS) === ALL_PERMISSIONS) return held;
  if (!getMember(spaceId, userId)) return 0n;
  const db = getDb();
  const catOverrides = db.select().from(schema.categoryOverrides)
    .where(eq(schema.categoryOverrides.categoryId, categoryId))
    .all();
  if (catOverrides.length === 0) return held;
  const assignedRoleIds = db.select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.userId, userId)))
    .all()
    .map((row) => row.roleId);
  return applyOverrides(held, spaceId, userId, assignedRoleIds, catOverrides, []);
}

/**
 * A channel's overrides on what someone holds in the space. Within each tier (@everyone, roles,
 * member), category first, then channel: channel bits win for any bit they explicitly set.
 */
function applyOverrides(
  held: bigint,
  spaceId: string,
  userId: string,
  assignedRoleIds: readonly string[],
  catOverrides: readonly OverrideRow[],
  chanOverrides: readonly OverrideRow[],
): bigint {
  let base = held;

  // Tier 1: @everyone override (targetType='role', targetId=spaceId)
  const catEveryoneOverride = catOverrides.find(o => o.targetType === 'role' && o.targetId === spaceId);
  if (catEveryoneOverride) {
    const deny = stringToPermissions(catEveryoneOverride.deny);
    const allow = stringToPermissions(catEveryoneOverride.allow);
    base = (base & ~deny) | allow;
  }
  const chanEveryoneOverride = chanOverrides.find(o => o.targetType === 'role' && o.targetId === spaceId);
  if (chanEveryoneOverride) {
    const deny = stringToPermissions(chanEveryoneOverride.deny);
    const allow = stringToPermissions(chanEveryoneOverride.allow);
    base = (base & ~deny) | allow;
  }

  // Tier 2: Role overrides (combined for all assigned roles)
  let catCombinedAllow = 0n;
  let catCombinedDeny = 0n;
  for (const roleId of assignedRoleIds) {
    const roleOverride = catOverrides.find(o => o.targetType === 'role' && o.targetId === roleId);
    if (roleOverride) {
      catCombinedAllow |= stringToPermissions(roleOverride.allow);
      catCombinedDeny |= stringToPermissions(roleOverride.deny);
    }
  }
  base = (base & ~catCombinedDeny) | catCombinedAllow;

  let chanCombinedAllow = 0n;
  let chanCombinedDeny = 0n;
  for (const roleId of assignedRoleIds) {
    const roleOverride = chanOverrides.find(o => o.targetType === 'role' && o.targetId === roleId);
    if (roleOverride) {
      chanCombinedAllow |= stringToPermissions(roleOverride.allow);
      chanCombinedDeny |= stringToPermissions(roleOverride.deny);
    }
  }
  base = (base & ~chanCombinedDeny) | chanCombinedAllow;

  // Tier 3: Member-specific override
  const catMemberOverride = catOverrides.find(o => o.targetType === 'member' && o.targetId === userId);
  if (catMemberOverride) {
    const deny = stringToPermissions(catMemberOverride.deny);
    const allow = stringToPermissions(catMemberOverride.allow);
    base = (base & ~deny) | allow;
  }
  const chanMemberOverride = chanOverrides.find(o => o.targetType === 'member' && o.targetId === userId);
  if (chanMemberOverride) {
    const deny = stringToPermissions(chanMemberOverride.deny);
    const allow = stringToPermissions(chanMemberOverride.allow);
    base = (base & ~deny) | allow;
  }

  return base;
}

/**
 * `computePermissions` in one channel for everyone in `userIds`, read once and fresh: an event in
 * a channel has to know this for all who are online, and asking for each of them separately is
 * what stopped a few hundred people from talking at once (docs/systems/operations.md). The rules
 * are the same code; `permissions.test.ts` compares the two.
 */
export function computeChannelPermissionsFor(spaceId: string, channelId: string, userIds: readonly string[]): Map<string, bigint> {
  const result = new Map<string, bigint>();
  if (userIds.length === 0) return result;
  const db = getDb();

  const space = db.select({ ownerId: schema.spaces.ownerId }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) {
    for (const userId of userIds) result.set(userId, 0n);
    return result;
  }

  // A thread has the rights of the channel it is in, and no overrides of its own.
  const channelFields = { id: schema.channels.id, type: schema.channels.type, parentChannelId: schema.channels.parentChannelId, categoryId: schema.channels.categoryId };
  let channel = db.select(channelFields).from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (channel?.type === 'thread' && channel.parentChannelId) {
    channel = db.select(channelFields).from(schema.channels).where(eq(schema.channels.id, channel.parentChannelId)).get();
  }
  const catOverrides: OverrideRow[] = channel?.categoryId
    ? db.select().from(schema.categoryOverrides).where(eq(schema.categoryOverrides.categoryId, channel.categoryId)).all()
    : [];
  const chanOverrides: OverrideRow[] = channel
    ? db.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, channel.id)).all()
    : [];

  const roleBits = new Map(db.select({ id: schema.roles.id, permissions: schema.roles.permissions })
    .from(schema.roles).where(eq(schema.roles.spaceId, spaceId)).all()
    .map((role) => [role.id, stringToPermissions(role.permissions)]));
  const everyone = roleBits.get(spaceId) ?? 0n;

  const ids = [...userIds];
  const admins = new Set(batchInArray(ids, (chunk) => db.select({ id: schema.users.id }).from(schema.users)
    .where(and(inArray(schema.users.id, chunk), eq(schema.users.isAdmin, 1))).all()).map((row) => row.id));
  const members = new Set(batchInArray(ids, (chunk) => db.select({ userId: schema.spaceMembers.userId }).from(schema.spaceMembers)
    .where(and(eq(schema.spaceMembers.spaceId, spaceId), inArray(schema.spaceMembers.userId, chunk))).all()).map((row) => row.userId));
  const assigned = new Map<string, string[]>();
  for (const row of batchInArray(ids, (chunk) => db.select({ userId: schema.memberRoles.userId, roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.spaceId, spaceId), inArray(schema.memberRoles.userId, chunk))).all())) {
    const held = assigned.get(row.userId);
    if (held) held.push(row.roleId);
    else assigned.set(row.userId, [row.roleId]);
  }

  const noOverrides = catOverrides.length === 0 && chanOverrides.length === 0;
  for (const userId of userIds) {
    if (userId === space.ownerId || admins.has(userId)) {
      result.set(userId, ALL_PERMISSIONS);
      continue;
    }
    if (!members.has(userId)) {
      result.set(userId, 0n);
      continue;
    }
    const roles = assigned.get(userId) ?? [];
    let base = everyone;
    for (const roleId of roles) base |= roleBits.get(roleId) ?? 0n;
    if ((base & PermissionBits.ADMINISTRATOR) !== 0n) result.set(userId, ALL_PERMISSIONS);
    else result.set(userId, noOverrides ? base : applyOverrides(base, spaceId, userId, roles, catOverrides, chanOverrides));
  }
  return result;
}

/**
 * `computePermissions` for one person in a space and in each of `channels` (not threads), read once:
 * what `ready` needs for every space and channel someone is in. `permissions.test.ts` compares the two.
 */
export function computeSpacePermissionsFor(
  userId: string,
  spaceId: string,
  channels: readonly { id: string; categoryId: string | null }[],
): { space: bigint; channels: Map<string, bigint> } {
  const result = new Map<string, bigint>();
  const everywhere = (bits: bigint) => {
    for (const channel of channels) result.set(channel.id, bits);
    return { space: bits, channels: result };
  };
  const db = getDb();

  const space = db.select({ ownerId: schema.spaces.ownerId }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) return everywhere(0n);
  if (space.ownerId === userId) return everywhere(ALL_PERMISSIONS);
  const account = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (account?.isAdmin === 1) return everywhere(ALL_PERMISSIONS);
  if (!getMember(spaceId, userId)) return everywhere(0n);

  const roleBits = new Map(db.select({ id: schema.roles.id, permissions: schema.roles.permissions })
    .from(schema.roles).where(eq(schema.roles.spaceId, spaceId)).all()
    .map((role) => [role.id, stringToPermissions(role.permissions)]));
  const assignedRoleIds = db.select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.userId, userId))).all()
    .map((row) => row.roleId);
  let base = roleBits.get(spaceId) ?? 0n;
  for (const roleId of assignedRoleIds) base |= roleBits.get(roleId) ?? 0n;
  if ((base & PermissionBits.ADMINISTRATOR) !== 0n) return everywhere(ALL_PERMISSIONS);

  const categoryIds = [...new Set(channels.flatMap((channel) => (channel.categoryId ? [channel.categoryId] : [])))];
  const byCategory = new Map<string, OverrideRow[]>();
  for (const row of batchInArray(categoryIds, (chunk) => db.select().from(schema.categoryOverrides).where(inArray(schema.categoryOverrides.categoryId, chunk)).all())) {
    const rows = byCategory.get(row.categoryId);
    if (rows) rows.push(row);
    else byCategory.set(row.categoryId, [row]);
  }
  const byChannel = new Map<string, OverrideRow[]>();
  for (const row of batchInArray(channels.map((channel) => channel.id), (chunk) => db.select().from(schema.channelOverrides).where(inArray(schema.channelOverrides.channelId, chunk)).all())) {
    const rows = byChannel.get(row.channelId);
    if (rows) rows.push(row);
    else byChannel.set(row.channelId, [row]);
  }

  for (const channel of channels) {
    const catOverrides = channel.categoryId ? byCategory.get(channel.categoryId) ?? [] : [];
    const chanOverrides = byChannel.get(channel.id) ?? [];
    result.set(channel.id, catOverrides.length === 0 && chanOverrides.length === 0
      ? base
      : applyOverrides(base, spaceId, userId, assignedRoleIds, catOverrides, chanOverrides));
  }
  return { space: base, channels: result };
}

/**
 * Check if a user has a specific permission in a space/channel.
 */
export function hasPermission(
  userId: string,
  spaceId: string,
  permission: bigint,
  channelId?: string,
): boolean {
  const perms = computePermissions(userId, spaceId, channelId);
  // ADMINISTRATOR grants everything
  if ((perms & PermissionBits.ADMINISTRATOR) !== 0n) return true;
  return (perms & permission) === permission;
}

// ─── Existing helpers ───────────────────────────────────────────────────────

export function getMember(spaceId: string, userId: string) {
  const db = getDb();
  return db.select().from(schema.spaceMembers)
    .where(and(
      eq(schema.spaceMembers.spaceId, spaceId),
      eq(schema.spaceMembers.userId, userId),
    ))
    .get();
}

export function isMember(spaceId: string, userId: string): boolean {
  return getMember(spaceId, userId) !== undefined;
}

export function isSpaceOwner(spaceId: string, userId: string): boolean {
  const db = getDb();
  const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  return space?.ownerId === userId;
}

export function getChannelSpaceId(channelId: string): string | null {
  const db = getDb();
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  return channel?.spaceId ?? null;
}

export function isDmMember(dmChannelId: string, userId: string): boolean {
  const db = getDb();
  const member = db.select().from(schema.dmMembers)
    .where(and(
      eq(schema.dmMembers.dmChannelId, dmChannelId),
      eq(schema.dmMembers.userId, userId),
    ))
    .get();
  return member !== undefined;
}

/**
 * True when a DM is a 1-on-1 (ownerId NULL) whose only other participant(s)
 * are tombstoned (isDeleted=1). Used to make a Deleted-User thread read-only:
 * no message create/edit/delete, so we never enqueue doomed/mis-directed relays.
 */
export function isDeadOneOnOne(dmChannelId: string, requesterId: string): boolean {
  const db = getDb();
  const channel = db.select({ ownerId: schema.dmChannels.ownerId })
    .from(schema.dmChannels).where(eq(schema.dmChannels.id, dmChannelId)).get();
  if (!channel || channel.ownerId !== null) return false; // groups are never a dead 1-on-1
  const others = db.select({ isDeleted: schema.users.isDeleted })
    .from(schema.dmMembers)
    .innerJoin(schema.users, eq(schema.dmMembers.userId, schema.users.id))
    .where(and(
      eq(schema.dmMembers.dmChannelId, dmChannelId),
      sql`${schema.dmMembers.userId} != ${requesterId}`,
    ))
    .all();
  if (others.length === 0) return false;
  return others.every(o => o.isDeleted === 1);
}

export function isBanned(spaceId: string, userId: string): boolean {
  const db = getDb();
  const ban = db.select().from(schema.bans)
    .where(and(
      eq(schema.bans.spaceId, spaceId),
      eq(schema.bans.userId, userId),
    ))
    .get();
  return ban !== undefined;
}
