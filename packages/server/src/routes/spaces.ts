import { spaceLimitReached } from '../utils/accountLimits.js';
import { shownCategories } from '../utils/categoryVisibility.js';
import { accountNeedsVerifiedEmail } from '../email/gate.js';
import { MAX_OWNER_TITLE_LENGTH, normalizeOwnerTitle } from '@backspace/shared/src/constants.js';
import { updateSpaceMemberRoutes, roleGrantRefusal } from './spaceMemberUpdate.js';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { eq, and, desc, inArray, sql, ne } from 'drizzle-orm';
import { getDb, getRawDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { markDirectoryDirty } from '../directory/state.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { isMember, isSpaceOwner, isBanned, hasPermission, computePermissions, PermissionBits } from '../utils/permissions.js';
import { DEFAULT_EVERYONE_PERMISSIONS, ALL_PERMISSIONS, permissionsToString, stringToPermissions, parsePermissionString, roleBitsChangeRefusal, idsHiddenFromEveryone, rolePermissionsVersion, type HeldBitsRefusal } from '@backspace/shared/src/permissions.js';
import { connectionManager } from '../ws/handler.js';
import { deleteAttachmentFiles, deleteUploadFile, deleteAttachmentByFilename } from '../utils/fileCleanup.js';
import { pictureFileReleasable, profilePictureOf, releaseMemberPictures, uploadNameOf } from '../utils/profileImageRefs.js';
import { removeSoundFiles } from '../utils/soundFiles.js';
import { resizeProfileImage } from '../utils/thumbnail.js';
import {
  discoveryStatusOf,
  isOpenReview,
  recordEditSteps,
  reviewsAfterEdit,
  reviewsAfterTransfer,
  verificationStatusOf,
} from '../utils/spaceReview.js';
import { announceReviewQueue, announceReviewStep } from '../utils/reviewNotify.js';
import { config } from '../config.js';
import type {
  AuditLogValue,
  CreateSpaceRequest,
  UpdateSpaceRequest,
  JoinSpaceRequest,
  Channel,
  ChannelCategory,
  MemberWithUser,
  RoleWriteRequest,
  SpaceWithChannelsAndMembers,
} from '@backspace/shared';
import {
  AVATAR_COLORS,
  BAN_DELETE_MESSAGE_SECONDS,
  INVITE_EXPIRY_SECONDS,
  INVITE_MAX_USES,
  MODERATION_REASON_MAX_LENGTH,
  isSpaceDefaultNotificationLevel,
  type CreateSpaceInviteRequest,
} from '@backspace/shared';
import { sanitizeUser } from '../utils/sanitize.js';
import { checkVoicePermissions, disconnectMemberFromSpaceVoice } from '../ws/events.js';
import { channelToWire, memberStaffBadges, memberToWire, spaceToWire } from '../utils/spaceWire.js';
import { dropHeldTimeout, holdDepartingTimeout, memberActionRefusal, restoreHeldTimeout } from '../utils/spaceModeration.js';
import {
  addedFields,
  auditChange,
  auditUserLabel,
  changedFields,
  recordAudit,
  recordMemberRoleAudit,
  removedFields,
} from '../utils/auditLog.js';
import { getLocalInvitePreview } from '../utils/spaceInviteSnapshot.js';
import { VANITY_CODE_LIMITS } from '@backspace/shared/src/vanityInvites.js';
import { consumeInvite, createInvite, generateInviteCode, listInvites, MAX_INVITES_PER_SPACE, revokeInvite, setVanityCode, usableInvite } from '../utils/spaceInvites.js';
import { sendError } from '../utils/httpErrors';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors';
import { canActOnMemberInSpace, canManageRoleInSpace, getHierarchyStanding } from '../utils/roleHierarchy.js';
import { canActOnMember, canManageRoleAt } from '@backspace/shared/src/permissions.js';
import { moveRoleToPosition, normalizeRolePositions, positionNextTo } from '../db/rolePositions.js';
import { memberRolesView, roleView, rolesForViewer, viewerReadsPermissionData } from '../utils/permissionDataView.js';
import { parseRoleDisplayFields } from '../utils/roleFields.js';

/**
 * The space columns the directory document serves (spec section 4). A change
 * to any of them on a listed space owes a ping.
 */
const DIRECTORY_SPACE_FIELDS = ['name', 'description', 'icon', 'banner', 'avatarColor', 'visibility'] as const;

export { generateInviteCode };

/**
 * After a change to the space's roles, to a member's roles or to its owner
 * (the owner holds every permission): every connected member is told with
 * `space_access_changed` (docs/systems/websocket.md) and refetches the
 * space's detail, which carries their permissions, the channels they can
 * see, the roles and the member list. `affectedUserIds` are the
 * members whose own permissions may have changed; each is also sent the voice
 * state they can see now (`announceSpaceAccessChange`). Voice permissions are
 * re-checked here too, since a role can carry SPEAK or STREAM.
 */
function announceAccessChange(spaceId: string, affectedUserIds: readonly string[]): void {
  connectionManager.announceSpaceAccessChange(spaceId, affectedUserIds);
  checkVoicePermissions(spaceId);
}

/** The members whose permissions a change to `roleId` reaches: its holders, or everyone for @everyone. */
function membersHoldingRole(spaceId: string, roleId: string): string[] {
  const db = getDb();
  if (roleId === spaceId) {
    return db.select({ userId: schema.spaceMembers.userId }).from(schema.spaceMembers)
      .where(eq(schema.spaceMembers.spaceId, spaceId)).all().map((m) => m.userId);
  }
  return db.select({ userId: schema.memberRoles.userId }).from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.roleId, roleId)))
    .all().map((m) => m.userId);
}

type RoleChangeRefusal = {
  status: 400 | 403 | 404;
  code: 'missing_permission' | 'cannot_change_own_roles' | 'space_owner_only' | 'member_not_found' | 'role_not_in_space' | 'everyone_role_not_assignable' | 'role_hierarchy' | HeldBitsRefusal;
  details?: Record<string, string>;
};

/**
 * The checks shared by the two single-role routes (add one role to a member,
 * take one away). They match what PATCH /members/:uid enforces for a whole
 * role set: MANAGE_ROLES, not one's own roles, not the owner's, a member of
 * this space, a role of this space other than @everyone, a member ranked
 * below the actor, a role below the actor's top role and, when adding, a
 * role whose bits the actor holds.
 */
function checkSingleRoleChange(
  spaceId: string,
  actorId: string,
  targetId: string,
  roleId: string,
  change: 'add' | 'remove',
): RoleChangeRefusal | null {
  const db = getDb();
  if (!hasPermission(actorId, spaceId, PermissionBits.MANAGE_ROLES)) {
    return { status: 403, code: 'missing_permission', details: { permission: 'MANAGE_ROLES' } };
  }
  // The owner's rights come from owning the space, not from a role, so the
  // owner may give and take their own roles (they cannot lock themselves
  // out); nobody else may change their own roles or the owner's.
  const ownerActsOnSelf = targetId === actorId && isSpaceOwner(spaceId, actorId);
  if (targetId === actorId && !ownerActsOnSelf) return { status: 400, code: 'cannot_change_own_roles' };
  if (!ownerActsOnSelf && isSpaceOwner(spaceId, targetId)) return { status: 403, code: 'space_owner_only' };
  if (!isMember(spaceId, targetId)) return { status: 404, code: 'member_not_found' };
  const role = typeof roleId === 'string'
    ? db.select().from(schema.roles).where(and(eq(schema.roles.id, roleId), eq(schema.roles.spaceId, spaceId))).get()
    : undefined;
  if (!role) return { status: 400, code: 'role_not_in_space', details: { roleId: String(roleId) } };
  if (role.id === spaceId) return { status: 400, code: 'everyone_role_not_assignable' };
  const actor = getHierarchyStanding(spaceId, actorId);
  if ((!ownerActsOnSelf && !canActOnMember(actor, getHierarchyStanding(spaceId, targetId))) || !canManageRoleAt(actor, role.position ?? 0)) {
    return { status: 403, code: 'role_hierarchy' };
  }
  if (change === 'add') {
    const refusal = roleGrantRefusal(spaceId, actorId, role.permissions);
    if (refusal) return { status: 403, code: refusal };
  }
  return null;
}

interface InviteJoinRefusal {
  status: number;
  code: ErrorCode;
  details?: ErrorDetails;
}

/**
 * Why a valid invite code does not admit this user, or null when it does.
 * Shared by both join-by-code routes. Read against the space's visibility at
 * the time of the call, so a link follows the space when its visibility
 * changes.
 *
 * Banned and already-member answer as every join path does. A request space
 * never admits anyone by code: entry is `POST /api/spaces/:id/request-join`
 * and a manager's approval. A user with a request waiting is told so
 * (`409 join_request_pending`, the answer the request route gives); anyone
 * else gets `403 join_request_required` with the space's id, which is all a
 * client needs to send the request. Private and public spaces admit by code.
 */
/**
 * A moderator's reason as it is stored: trimmed, or null when there is none.
 * Undefined when it is not one: too long, or not text at all.
 */
function moderationReason(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const reason = value.trim();
  if (reason.length > MODERATION_REASON_MAX_LENGTH) return undefined;
  return reason || null;
}

/** How many of a banned person's messages one ban takes with it, at most. */
const BAN_DELETE_MESSAGES_MAX = 5000;
/** Ids in one `messages_deleted` event. */
const BAN_DELETE_EVENT_SIZE = 500;

/**
 * The person's messages in this space since `since`, removed with their
 * attachments, the newest first up to the limit. Each channel's audience is told in
 * batches (`messages_deleted`), so a raid's worth of messages is not hundreds of
 * events. Returns how many went.
 */
function deleteRecentMessagesOf(spaceId: string, userId: string, since: number): number {
  const db = getDb();
  const channelIds = db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.spaceId, spaceId)).all().map((channel) => channel.id);
  if (channelIds.length === 0) return 0;
  const rows = db.select({ id: schema.messages.id, channelId: schema.messages.channelId }).from(schema.messages)
    .where(and(
      inArray(schema.messages.channelId, channelIds),
      eq(schema.messages.userId, userId),
      sql`${schema.messages.createdAt} >= ${since}`,
    ))
    .orderBy(desc(schema.messages.createdAt))
    .limit(BAN_DELETE_MESSAGES_MAX)
    .all();
  if (rows.length === 0) return 0;

  const ids = rows.map((row) => row.id);
  const files: Array<{ filename: string }> = [];
  db.transaction((tx) => {
    for (let start = 0; start < ids.length; start += BAN_DELETE_EVENT_SIZE) {
      const part = ids.slice(start, start + BAN_DELETE_EVENT_SIZE);
      files.push(...tx.select({ filename: schema.attachments.filename }).from(schema.attachments)
        .where(inArray(schema.attachments.messageId, part)).all());
      tx.delete(schema.attachments).where(inArray(schema.attachments.messageId, part)).run();
      tx.delete(schema.messages).where(inArray(schema.messages.id, part)).run();
    }
  });
  deleteAttachmentFiles(files);

  const byChannel = new Map<string, string[]>();
  for (const row of rows) byChannel.set(row.channelId, [...(byChannel.get(row.channelId) ?? []), row.id]);
  for (const [channelId, messageIds] of byChannel) {
    for (let start = 0; start < messageIds.length; start += BAN_DELETE_EVENT_SIZE) {
      connectionManager.sendToChannel(spaceId, channelId, {
        type: 'messages_deleted',
        messageIds: messageIds.slice(start, start + BAN_DELETE_EVENT_SIZE),
        channelId,
      });
    }
  }
  return rows.length;
}

function inviteJoinRefusal(space: typeof schema.spaces.$inferSelect, userId: string): InviteJoinRefusal | null {
  if (isBanned(space.id, userId)) {
    return { status: 403, code: 'user_banned' };
  }
  if (isMember(space.id, userId)) {
    return { status: 409, code: 'already_member' };
  }
  if (space.visibility === 'request') {
    const pending = getDb().select({ id: schema.joinRequests.id }).from(schema.joinRequests)
      .where(and(
        eq(schema.joinRequests.spaceId, space.id),
        eq(schema.joinRequests.userId, userId),
        eq(schema.joinRequests.status, 'pending'),
      ))
      .get();
    if (pending) {
      return { status: 409, code: 'join_request_pending' };
    }
    return { status: 403, code: 'join_request_required', details: { spaceId: space.id } };
  }
  return null;
}

/**
 * Add a member admitted by an invite code: the membership row (with a
 * timeout they left the space under put back, `restoreHeldTimeout`), the
 * user's WebSocket subscription to the space, and `member_joined` to the space.
 */
function admitByInvite(spaceId: string, userId: string): void {
  const db = getDb();
  const now = Date.now();
  db.insert(schema.spaceMembers).values({
    spaceId,
    userId,
    joinedAt: now,
  }).run();
  const timedOutUntil = restoreHeldTimeout(spaceId, userId, now);

  // Register the user in connectionManager so they receive WS broadcasts for this space
  connectionManager.addUserSpace(userId, spaceId);

  // Broadcast member_joined to existing space members
  const joiningUser = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (joiningUser) {
    const memberPayload = memberToWire(
      { spaceId, userId, nickname: null, joinedAt: now, timedOutUntil, avatar: null, banner: null, bio: null },
      joiningUser,
      [],
      now,
    );
    connectionManager.sendToSpace(spaceId, {
      type: 'member_joined',
      spaceId,
      member: memberPayload,
    });
  }
}

/**
 * The fields of a space a `PATCH /api/spaces/:id` may change, as the audit
 * log compares them (`directoryListed` as a boolean).
 */
function auditedSpaceFields(row: typeof schema.spaces.$inferSelect): Record<string, AuditLogValue> {
  return {
    name: row.name,
    icon: row.icon,
    banner: row.banner,
    avatarColor: row.avatarColor,
    visibility: row.visibility,
    description: row.description,
    directoryListed: row.directoryListed === 1,
    ownerTitle: row.ownerTitle,
    ownerGroup: row.ownerGroup === 1,
    defaultNotificationLevel: row.defaultNotificationLevel,
  };
}

/** The fields of a role the audit log records on its create, update and delete. */
function auditedRoleFields(row: typeof schema.roles.$inferSelect): Record<string, AuditLogValue> {
  return {
    name: row.name,
    color: row.color,
    colorSecondary: row.colorSecondary ?? null,
    description: row.description ?? null,
    icon: row.icon ?? null,
    hoist: row.hoist !== 0,
    mentionable: row.mentionable === 1,
    permissions: row.permissions ?? '0',
  };
}

/**
 * Fits a space's newly shown pictures to their sizes before the row takes them (utils/thumbnail.ts):
 * false when one cannot be written anew, and then the request is refused. Only files a picture
 * check passed come here (profilePictureOf).
 */
async function fitSpacePictures(icon: string | null, banner: string | null): Promise<boolean> {
  if (icon && !(await resizeProfileImage(path.join(config.uploadDir, icon), 'icon'))) return false;
  if (banner && !(await resizeProfileImage(path.join(config.uploadDir, banner), 'banner'))) return false;
  return true;
}

/** Once the spaces table holds a space's newly shown pictures, their upload records go. */
function adoptSpacePictures(icon: string | null, banner: string | null): void {
  if (icon) deleteAttachmentByFilename(icon);
  if (banner) deleteAttachmentByFilename(banner);
}

export async function spaceRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/spaces - Create a new server
  app.post<{ Body: CreateSpaceRequest }>('/api/spaces', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name, icon, banner, avatarColor, visibility, description } = request.body;

    if (accountNeedsVerifiedEmail(request.userId)) return sendError(reply, 403, 'email_verification_required');

    const spaceLimit = spaceLimitReached(request.userId);
    if (spaceLimit !== null) return sendError(reply, 409, 'space_limit_reached', { max: spaceLimit });

    if (!name || typeof name !== 'string') {
      return sendError(reply, 400, 'space_name_required');
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      return sendError(reply, 400, 'space_name_length', { min: 1, max: 100 });
    }

    // A new space's pictures are the creator's own uploads or addresses
    // elsewhere (utils/profileImageRefs.ts).
    const iconPicture = profilePictureOf(icon, request.userId, null);
    if (!iconPicture) return sendError(reply, 400, 'icon_url_invalid');
    const bannerPicture = profilePictureOf(banner, request.userId, null);
    if (!bannerPicture) return sendError(reply, 400, 'banner_url_invalid');

    // Validate visibility
    const validVisibilities = ['public', 'request', 'private'];
    const safeVisibility = visibility && validVisibilities.includes(visibility) ? visibility : 'private';

    // Validate description
    const safeDescription = description ? description.trim().slice(0, 200) || null : null;

    // Validate avatarColor — assign random if not provided
    const safeAvatarColor = avatarColor && (AVATAR_COLORS as readonly string[]).includes(avatarColor)
      ? avatarColor
      : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    if (!(await fitSpacePictures(iconPicture.upload, bannerPicture.upload))) {
      return sendError(reply, 400, 'profile_image_invalid');
    }
    // Asked again after the pictures were fitted, with nothing awaited before the insert: spaces
    // created side by side would otherwise all pass the check made before.
    const spaceLimitNow = spaceLimitReached(request.userId);
    if (spaceLimitNow !== null) return sendError(reply, 409, 'space_limit_reached', { max: spaceLimitNow });

    const db = getDb();
    const spaceId = generateSnowflake();
    const textCategoryId = generateSnowflake();
    const voiceCategoryId = generateSnowflake();
    const channelId = generateSnowflake();
    const voiceChannelId = generateSnowflake();
    const now = Date.now();
    const inviteCode = generateInviteCode();

    // Create server, owner membership, default categories + channels, and @everyone role atomically
    db.transaction((tx) => {
      tx.insert(schema.spaces).values({
        id: spaceId,
        name: trimmedName,
        icon: iconPicture.stored,
        banner: bannerPicture.stored,
        avatarColor: safeAvatarColor,
        ownerId: request.userId,
        inviteCode,
        visibility: safeVisibility,
        description: safeDescription,
        createdAt: now,
      }).run();

      tx.insert(schema.spaceMembers).values({
        spaceId,
        userId: request.userId,
        joinedAt: now,
      }).run();

      // Default categories
      tx.insert(schema.channelCategories).values({
        id: textCategoryId,
        spaceId,
        name: 'text-channels',
        position: 0,
        createdAt: now,
      }).run();

      tx.insert(schema.channelCategories).values({
        id: voiceCategoryId,
        spaceId,
        name: 'voice-channels',
        position: 1,
        createdAt: now,
      }).run();

      // Default text channel in text-channels category
      tx.insert(schema.channels).values({
        id: channelId,
        spaceId,
        name: 'general',
        type: 'text',
        position: 0,
        categoryId: textCategoryId,
        createdAt: now,
      }).run();

      // Default voice channel in voice-channels category
      tx.insert(schema.channels).values({
        id: voiceChannelId,
        spaceId,
        name: 'voice',
        type: 'voice',
        position: 0,
        categoryId: voiceCategoryId,
        createdAt: now,
      }).run();

      // Auto-create @everyone role (id = spaceId)
      tx.insert(schema.roles).values({
        id: spaceId,
        spaceId,
        name: '@everyone',
        color: '#b9bbbe',
        position: 0,
        permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS),
        createdAt: now,
      }).run();
    });

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
    if (!server) {
      return sendError(reply, 500, 'space_create_failed');
    }

    // Register the creator in connectionManager so they receive WS broadcasts for this space
    connectionManager.addUserSpace(request.userId, spaceId);

    adoptSpacePictures(iconPicture.upload, bannerPicture.upload);

    return reply.code(201).send(spaceToWire(server));
  });

  // GET /api/spaces - List user's servers
  app.get('/api/spaces', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();

    const memberships = db.select()
      .from(schema.spaceMembers)
      .where(eq(schema.spaceMembers.userId, request.userId))
      .all();

    if (memberships.length === 0) {
      return reply.code(200).send([]);
    }

    const spaceIds = memberships.map(m => m.spaceId);
    const servers = db.select()
      .from(schema.spaces)
      .where(inArray(schema.spaces.id, spaceIds))
      .all();

    return reply.code(200).send(servers.map(spaceToWire));
  });

  // GET /api/spaces/:id - Get server detail with channels and members
  app.get<{ Params: { id: string } }>('/api/spaces/:id', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (!isMember(id, request.userId)) {
      return sendError(reply, 403, 'not_space_member');
    }

    const channels = db.select()
      .from(schema.channels)
      .where(and(eq(schema.channels.spaceId, id), ne(schema.channels.type, 'thread')))
      .all();

    const roles = db.select()
      .from(schema.roles)
      .where(eq(schema.roles.spaceId, id))
      .orderBy(schema.roles.position)
      .all();

    const memberRows = db.select()
      .from(schema.spaceMembers)
      .where(eq(schema.spaceMembers.spaceId, id))
      .all();

    const memberUserIds = memberRows.map(m => m.userId);
    const users = memberUserIds.length > 0
      ? db.select().from(schema.users).where(inArray(schema.users.id, memberUserIds)).all()
      : [];

    const userMap = new Map(users.map(u => [u.id, u]));

    const memberRoleRows = db.select()
      .from(schema.memberRoles)
      .where(eq(schema.memberRoles.spaceId, id))
      .all();

    const members: MemberWithUser[] = memberRows
      .map(m => {
        const user = userMap.get(m.userId);
        if (!user) return null;

        const assignedRoleIds = new Set(memberRoleRows
          .filter(mr => mr.userId === m.userId)
          .map(mr => mr.roleId));

        return memberToWire(m, user, memberRolesView(roles, assignedRoleIds), undefined, memberStaffBadges(roles, assignedRoleIds, m.spaceId));
      })
      .filter((m): m is MemberWithUser => m !== null);

    // Fetch categories for this space
    const categoryRows = db.select()
      .from(schema.channelCategories)
      .where(eq(schema.channelCategories.spaceId, id))
      .all();

    // Batch-fetch the @everyone category overrides to determine isPrivate
    // (`isHiddenFromEveryone`, read per category).
    const catEveryoneOverrides = db.select().from(schema.categoryOverrides)
      .where(and(
        eq(schema.categoryOverrides.targetType, 'role'),
        eq(schema.categoryOverrides.targetId, id),
      ))
      .all();
    const privateCategoryIds = idsHiddenFromEveryone(catEveryoneOverrides, (o) => o.categoryId, () => id);

    const categories: ChannelCategory[] = categoryRows.map(c => ({
      id: c.id,
      spaceId: c.spaceId,
      name: c.name,
      position: c.position ?? 0,
      isPrivate: privateCategoryIds.has(c.id),
      createdAt: c.createdAt,
    }));

    // Compute space-level permissions for the requesting user
    const spacePerms = computePermissions(request.userId, id);

    // Batch-fetch the @everyone channel overrides (role = spaceId) to determine
    // isPrivate (`isHiddenFromEveryone`, read per channel).
    const everyoneOverrides = db.select().from(schema.channelOverrides)
      .where(and(
        eq(schema.channelOverrides.targetType, 'role'),
        eq(schema.channelOverrides.targetId, id),
      ))
      .all();
    const privateChannelIds = idsHiddenFromEveryone(everyoneOverrides, (o) => o.channelId, () => id);

    // Filter channels by VIEW_CHANNEL permission and attach per-channel myPermissions
    const visibleChannels: (Channel & { isPrivate: boolean; myPermissions: string })[] = [];
    for (const ch of channels) {
      const perms = computePermissions(request.userId, id, ch.id);
      if ((perms & PermissionBits.VIEW_CHANNEL) !== 0n) {
        visibleChannels.push({
          ...channelToWire(ch),
          isPrivate: privateChannelIds.has(ch.id),
          myPermissions: permissionsToString(perms),
        });
      }
    }

    const result: SpaceWithChannelsAndMembers = {
      ...spaceToWire(server),
      channels: visibleChannels,
      categories: shownCategories(categories, visibleChannels, spacePerms),
      members,
      roles: rolesForViewer(roles, spacePerms),
      myPermissions: permissionsToString(spacePerms),
    };

    return reply.code(200).send(result);
  });

  // PATCH /api/spaces/:id - Update server (owner only)
  app.patch<{ Params: { id: string }; Body: UpdateSpaceRequest }>('/api/spaces/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, icon, banner, avatarColor, visibility, description, directoryListed, ownerTitle, ownerGroup, defaultNotificationLevel } = request.body;
    const db = getDb();

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    // The title and how the owner is listed belong to the owner, not to
    // anyone granted MANAGE_SPACE.
    if ((ownerTitle !== undefined || ownerGroup !== undefined) && server.ownerId !== request.userId) {
      return sendError(reply, 403, 'space_owner_only');
    }

    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }

    const updates: Partial<typeof schema.spaces.$inferInsert> = {};

    if (ownerTitle !== undefined) {
      const normalized = normalizeOwnerTitle(ownerTitle);
      if (normalized === undefined) {
        return sendError(reply, 400, 'space_owner_title_invalid', { max: MAX_OWNER_TITLE_LENGTH });
      }
      updates.ownerTitle = normalized;
    }

    if (ownerGroup !== undefined) {
      if (typeof ownerGroup !== 'boolean') {
        return sendError(reply, 400, 'validation_failed');
      }
      updates.ownerGroup = ownerGroup ? 1 : 0;
    }

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (trimmedName.length < 1 || trimmedName.length > 100) {
        return sendError(reply, 400, 'space_name_length', { min: 1, max: 100 });
      }
      updates.name = trimmedName;
    }

    // Track old files for cleanup after update
    const oldIcon = server.icon;
    const oldBanner = server.banner;

    // The space's pictures: an upload of the actor's own, an address
    // elsewhere, or the one it shows (utils/profileImageRefs.ts).
    let iconUpload: string | null = null;
    let bannerUpload: string | null = null;
    if (icon !== undefined) {
      const picture = profilePictureOf(icon, request.userId, oldIcon);
      if (!picture) return sendError(reply, 400, 'icon_url_invalid');
      updates.icon = picture.stored;
      iconUpload = picture.upload;
    }

    if (banner !== undefined) {
      const picture = profilePictureOf(banner, request.userId, oldBanner);
      if (!picture) return sendError(reply, 400, 'banner_url_invalid');
      updates.banner = picture.stored;
      bannerUpload = picture.upload;
    }

    if (avatarColor !== undefined) {
      if (avatarColor === '') {
        updates.avatarColor = null;
      } else if ((AVATAR_COLORS as readonly string[]).includes(avatarColor)) {
        updates.avatarColor = avatarColor;
      } else {
        return sendError(reply, 400, 'avatar_color_invalid');
      }
    }

    if (visibility !== undefined) {
      const validVisibilities = ['public', 'request', 'private'];
      if (!validVisibilities.includes(visibility)) {
        return sendError(reply, 400, 'space_visibility_invalid');
      }
      updates.visibility = visibility;
    }

    if (description !== undefined) {
      const trimmed = description.trim().slice(0, 200);
      updates.description = trimmed || null;
    }

    // The level members start with until they choose their own; null brings
    // back the built-in default. "nothing" is each member's own choice.
    if (defaultNotificationLevel !== undefined) {
      if (defaultNotificationLevel !== null && !isSpaceDefaultNotificationLevel(defaultNotificationLevel)) {
        return sendError(reply, 400, 'notification_level_invalid');
      }
      updates.defaultNotificationLevel = defaultNotificationLevel;
    }

    // Directory listing follows the same MANAGE_SPACE rule as visibility. A
    // private space is never listed: asking for it is refused, and a listed
    // space going private is unlisted in the same write (spec section 4).
    const resultingVisibility = updates.visibility ?? server.visibility ?? 'private';
    if (directoryListed !== undefined) {
      if (typeof directoryListed !== 'boolean') {
        return sendError(reply, 400, 'field_not_boolean', { field: 'directoryListed' });
      }
      if (directoryListed && resultingVisibility === 'private') {
        return sendError(reply, 400, 'directory_private_space');
      }
      updates.directoryListed = directoryListed ? 1 : 0;
    }
    if (resultingVisibility === 'private' && server.directoryListed === 1) {
      updates.directoryListed = 0;
    }

    if (Object.keys(updates).length === 0) {
      return sendError(reply, 400, 'no_fields_to_update');
    }

    // A listed space whose name, description or pictures change goes back to
    // review, one made private leaves Discovery, and a verified space that is
    // renamed is verified again (utils/spaceReview.ts). The statuses are
    // written with the edit, so no change is listed or vouched for unseen.
    const reviewEdit = reviewsAfterEdit(server, {
      name: updates.name ?? server.name,
      description: updates.description !== undefined ? updates.description : server.description,
      icon: updates.icon !== undefined ? updates.icon : server.icon,
      banner: updates.banner !== undefined ? updates.banner : server.banner,
      visibility: updates.visibility ?? server.visibility,
    });
    if (reviewEdit.discovery) updates.discoveryStatus = reviewEdit.discovery.status;
    if (reviewEdit.verification) updates.verificationStatus = reviewEdit.verification.status;

    if (!(await fitSpacePictures(iconUpload, bannerUpload))) {
      return sendError(reply, 400, 'profile_image_invalid');
    }

    db.update(schema.spaces).set(updates).where(eq(schema.spaces.id, id)).run();

    const listedAfter = (updates.directoryListed ?? server.directoryListed) === 1;
    const listingChanged = updates.directoryListed !== undefined && updates.directoryListed !== server.directoryListed;
    const servedFieldChanged = DIRECTORY_SPACE_FIELDS.some(
      (field) => updates[field] !== undefined && updates[field] !== server[field],
    );
    if (listingChanged || (listedAfter && servedFieldChanged)) {
      markDirectoryDirty(getRawDb());
    }

    // A replaced picture goes once nothing shows it any more.
    const replacedIcon = icon !== undefined ? uploadNameOf(oldIcon) : null;
    if (replacedIcon && replacedIcon !== uploadNameOf(updates.icon) && pictureFileReleasable(replacedIcon)) {
      deleteUploadFile(replacedIcon);
      deleteAttachmentByFilename(replacedIcon);
    }
    const replacedBanner = banner !== undefined ? uploadNameOf(oldBanner) : null;
    if (replacedBanner && replacedBanner !== uploadNameOf(updates.banner) && pictureFileReleasable(replacedBanner)) {
      deleteUploadFile(replacedBanner);
      deleteAttachmentByFilename(replacedBanner);
    }
    adoptSpacePictures(iconUpload, bannerUpload);

    const updated = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!updated) {
      return sendError(reply, 500, 'space_update_failed');
    }
    if (reviewEdit.discovery || reviewEdit.verification) {
      // The space_updated below carries the badge; the steps need not.
      for (const step of recordEditSteps(updated, request.userId, reviewEdit)) {
        announceReviewStep(updated, step, { spaceUpdate: false });
      }
    }

    const spaceChanges = changedFields(auditedSpaceFields(server), auditedSpaceFields(updated));
    if (spaceChanges.length > 0) {
      recordAudit({
        spaceId: id, actorId: request.userId, action: 'space_update',
        targetType: 'space', targetId: id, targetLabel: updated.name, changes: spaceChanges,
      });
    }

    const spaceData = spaceToWire(updated);

    // Broadcast space_updated to all space members
    connectionManager.sendToSpace(id, {
      type: 'space_updated',
      space: spaceData,
    });

    return reply.code(200).send(spaceData);
  });

  // DELETE /api/spaces/:id - Delete server (owner only)
  app.delete<{ Params: { id: string } }>('/api/spaces/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (!isSpaceOwner(id, request.userId)) {
      return sendError(reply, 403, 'space_owner_only');
    }

    // Collect all attachment files before cascade-deleting DB records
    const channelIds = db.select({ id: schema.channels.id })
      .from(schema.channels).where(eq(schema.channels.spaceId, id)).all().map(c => c.id);

    let attachmentRows: { filename: string }[] = [];
    if (channelIds.length > 0) {
      const messageIds = db.select({ id: schema.messages.id })
        .from(schema.messages).where(inArray(schema.messages.channelId, channelIds)).all().map(m => m.id);
      if (messageIds.length > 0) {
        attachmentRows = db.select({ filename: schema.attachments.filename })
          .from(schema.attachments).where(inArray(schema.attachments.messageId, messageIds)).all();
      }
    }

    // Capture space icon/banner before deletion
    const spaceIcon = server.icon;
    const spaceBanner = server.banner;
    const hadOpenReview = isOpenReview(verificationStatusOf(server), discoveryStatusOf(server));

    const memberPictures = db.select({ userId: schema.spaceMembers.userId, avatar: schema.spaceMembers.avatar, banner: schema.spaceMembers.banner })
      .from(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, id)).all();
    // The soundboard's rows go with the space; their files are removed here, not left for a restart.
    const soundIds = db.select({ id: schema.spaceSounds.id }).from(schema.spaceSounds)
      .where(eq(schema.spaceSounds.spaceId, id)).all().map((sound) => sound.id);

    // Delete all channels (messages cascade), members, folder refs, read states, then space atomically
    db.transaction((tx) => {
      // Clean up read_states for all channels in this space (no FK cascade — channelId is plain text)
      if (channelIds.length > 0) {
        tx.delete(schema.readStates).where(inArray(schema.readStates.channelId, channelIds)).run();
      }
      tx.delete(schema.channels).where(eq(schema.channels.spaceId, id)).run();
      tx.delete(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, id)).run();
      tx.delete(schema.spaceFolderMembers).where(eq(schema.spaceFolderMembers.spaceId, id)).run();
      tx.delete(schema.spaces).where(eq(schema.spaces.id, id)).run();
    });

    // A listed space just left the served document.
    if (server.directoryListed === 1) {
      markDirectoryDirty(getRawDb());
    }
    if (hadOpenReview) announceReviewQueue();

    // Clean up all attachment files from disk
    deleteAttachmentFiles(attachmentRows);
    removeSoundFiles(soundIds);

    // Clean up space icon/banner files nothing else shows, and the members' own pictures.
    for (const picture of [uploadNameOf(spaceIcon), uploadNameOf(spaceBanner)]) {
      if (picture && pictureFileReleasable(picture)) deleteUploadFile(picture);
    }
    releaseMemberPictures(memberPictures);
    // Nobody is in its voice or told about it any more.
    for (const member of memberPictures) {
      disconnectMemberFromSpaceVoice(id, member.userId);
      connectionManager.removeUserSpace(member.userId, id);
    }

    return reply.code(200).send({ success: true });
  });

  // POST /api/spaces/:id/invite - Generate invite code (admin+)
  app.post<{ Params: { id: string } }>('/api/spaces/:id/invite', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (!hasPermission(request.userId, id, PermissionBits.CREATE_INVITE)) {
      // Owners and instance admins always pass hasPermission, so anyone who lands
      // here is either a non-member or a member without CREATE_INVITE. Give the
      // non-member a clearer "go join first" message instead of a permission error.
      if (!isMember(id, request.userId)) {
        return sendError(reply, 403, 'not_space_member');
      }
      return sendError(reply, 403, 'missing_permission', { permission: 'CREATE_INVITE' });
    }

    // Every space hands out its link, a request space included: the link
    // never admits anyone to a request space (see inviteJoinRefusal), it leads
    // to the join request flow.

    // Return existing invite code if one exists, otherwise generate a new one
    if (server.inviteCode) {
      return reply.code(200).send({ inviteCode: server.inviteCode });
    }

    // Making a new link is a member action, as POST /invites is (utils/spaceModeration.ts).
    const refusal = memberActionRefusal(id, request.userId);
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);

    const inviteCode = generateInviteCode();
    db.update(schema.spaces).set({ inviteCode }).where(eq(schema.spaces.id, id)).run();
    // A new standing link, for a space left without one.
    recordAudit({
      spaceId: id, actorId: request.userId, action: 'invite_regenerate',
      targetType: 'invite', targetId: inviteCode, targetLabel: null,
      changes: [auditChange('inviteCode', server.inviteCode, inviteCode)],
    });

    return reply.code(200).send({ inviteCode });
  });

  // POST /api/spaces/:id/join - Join server by invite code
  app.post<{ Params: { id: string }; Body: JoinSpaceRequest }>('/api/spaces/:id/join', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const { inviteCode } = request.body;

    if (!inviteCode || typeof inviteCode !== 'string') {
      return sendError(reply, 400, 'invite_code_required');
    }

    const db = getDb();

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    const invite = usableInvite(inviteCode);
    if (!invite || invite.spaceId !== server.id) {
      return sendError(reply, 400, 'invite_not_found');
    }

    const refusal = inviteJoinRefusal(server, request.userId);
    if (refusal) {
      return sendError(reply, refusal.status, refusal.code, refusal.details);
    }

    if (!consumeInvite(invite.code)) {
      return sendError(reply, 400, 'invite_not_found');
    }
    admitByInvite(server.id, request.userId);
    return reply.code(200).send(spaceToWire(server));
  });

  // POST /api/spaces/join - Join server by invite code (no server ID needed)
  app.post<{ Body: JoinSpaceRequest }>('/api/spaces/join', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { inviteCode } = request.body;

    if (!inviteCode || typeof inviteCode !== 'string') {
      return sendError(reply, 400, 'invite_code_required');
    }

    const db = getDb();

    const invite = usableInvite(inviteCode);
    const server = invite ? db.select().from(schema.spaces).where(eq(schema.spaces.id, invite.spaceId)).get() : undefined;
    if (!server) {
      return sendError(reply, 404, 'invite_not_found');
    }

    const refusal = inviteJoinRefusal(server, request.userId);
    if (refusal) {
      return sendError(reply, refusal.status, refusal.code, refusal.details);
    }

    if (!invite || !consumeInvite(invite.code)) {
      return sendError(reply, 404, 'invite_not_found');
    }
    admitByInvite(server.id, request.userId);
    return reply.code(200).send(spaceToWire(server));
  });

  // PUT /api/spaces/:id/vanity - The space's own invite address, or null to give it up
  app.put<{ Params: { id: string }; Body: { code?: unknown } }>('/api/spaces/:id/vanity', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();
    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) {
      return sendError(reply, 404, 'space_not_found');
    }
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }
    const given = request.body?.code;
    if (given !== null && typeof given !== 'string') {
      return sendError(reply, 400, 'validation_failed', { field: 'code' });
    }
    const refusal = setVanityCode(id, given, request.userId);
    if (refusal === 'invalid') {
      return sendError(reply, 400, 'vanity_code_invalid', { min: VANITY_CODE_LIMITS.MIN_LENGTH, max: VANITY_CODE_LIMITS.MAX_LENGTH });
    }
    if (refusal === 'reserved') {
      return sendError(reply, 409, 'vanity_code_reserved');
    }
    if (refusal === 'taken') {
      return sendError(reply, 409, 'vanity_code_taken');
    }
    const updated = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!updated) {
      return sendError(reply, 500, 'internal_error');
    }
    if (updated.vanityCode !== space.vanityCode) {
      recordAudit({
        spaceId: id, actorId: request.userId, action: 'vanity_update',
        targetType: 'invite', targetId: updated.vanityCode ?? space.vanityCode ?? id, targetLabel: updated.vanityCode,
        changes: [auditChange('vanityCode', space.vanityCode, updated.vanityCode)],
      });
      connectionManager.sendToSpace(id, { type: 'space_updated', space: spaceToWire(updated) });
    }
    return reply.code(200).send({ vanityCode: updated.vanityCode });
  });

  // GET /api/spaces/:id/invites - The space's live links
  app.get<{ Params: { id: string } }>('/api/spaces/:id/invites', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    if (!getDb().select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, id)).get()) {
      return sendError(reply, 404, 'space_not_found');
    }
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }
    return reply.code(200).send({ invites: listInvites(id) });
  });

  // POST /api/spaces/:id/invites - A new link, with an end date or a limit if wanted
  app.post<{ Params: { id: string }; Body: CreateSpaceInviteRequest }>('/api/spaces/:id/invites', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const { expiresInSeconds = null, maxUses = null } = request.body ?? {};
    if (!getDb().select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, id)).get()) {
      return sendError(reply, 404, 'space_not_found');
    }
    if (!hasPermission(request.userId, id, PermissionBits.CREATE_INVITE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'CREATE_INVITE' });
    }
    // Bringing people in is something done in the space (utils/spaceModeration.ts).
    const refusal = memberActionRefusal(id, request.userId);
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
    if (expiresInSeconds !== null && !(INVITE_EXPIRY_SECONDS as readonly number[]).includes(expiresInSeconds)) {
      return sendError(reply, 400, 'invite_options_invalid');
    }
    if (maxUses !== null && !(INVITE_MAX_USES as readonly number[]).includes(maxUses)) {
      return sendError(reply, 400, 'invite_options_invalid');
    }
    const now = Date.now();
    const invite = createInvite(id, request.userId, { expiresAt: expiresInSeconds === null ? null : now + expiresInSeconds * 1000, maxUses }, now);
    if (!invite) {
      return sendError(reply, 409, 'invite_limit_reached', { max: MAX_INVITES_PER_SPACE });
    }
    recordAudit({ spaceId: id, actorId: request.userId, action: 'invite_create', targetType: 'invite', targetId: invite.code, targetLabel: null });
    return reply.code(201).send({ invites: listInvites(id) });
  });

  // DELETE /api/spaces/:id/invites/:code - End a link
  app.delete<{ Params: { id: string; code: string } }>('/api/spaces/:id/invites/:code', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, code } = request.params;
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }
    if (!revokeInvite(id, code)) {
      return sendError(reply, 404, 'invite_not_found');
    }
    recordAudit({ spaceId: id, actorId: request.userId, action: 'invite_revoke', targetType: 'invite', targetId: code, targetLabel: null });
    return reply.code(200).send({ invites: listInvites(id) });
  });

  // GET /api/spaces/:id/members - List server members
  app.get<{ Params: { id: string } }>('/api/spaces/:id/members', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (!isMember(id, request.userId)) {
      return sendError(reply, 403, 'not_space_member');
    }

    const memberRows = db.select()
      .from(schema.spaceMembers)
      .where(eq(schema.spaceMembers.spaceId, id))
      .all();

    const memberUserIds = memberRows.map(m => m.userId);
    const users = memberUserIds.length > 0
      ? db.select().from(schema.users).where(inArray(schema.users.id, memberUserIds)).all()
      : [];

    const userMap = new Map(users.map(u => [u.id, u]));

    const roles = db.select()
      .from(schema.roles)
      .where(eq(schema.roles.spaceId, id))
      .orderBy(schema.roles.position)
      .all();

    const memberRoleRows = db.select()
      .from(schema.memberRoles)
      .where(eq(schema.memberRoles.spaceId, id))
      .all();

    const members: MemberWithUser[] = memberRows
      .map(m => {
        const user = userMap.get(m.userId);
        if (!user) return null;

        const assignedRoleIds = new Set(memberRoleRows
          .filter(mr => mr.userId === m.userId)
          .map(mr => mr.roleId));

        return memberToWire(m, user, memberRolesView(roles, assignedRoleIds), undefined, memberStaffBadges(roles, assignedRoleIds, m.spaceId));
      })
      .filter((m): m is MemberWithUser => m !== null);

    return reply.code(200).send(members);
  });

  updateSpaceMemberRoutes(app);

  // DELETE /api/spaces/:id/members/:uid - Kick member (owner) or leave (self)
  app.delete<{ Params: { id: string; uid: string }; Body: { reason?: string } | undefined }>('/api/spaces/:id/members/:uid', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id, uid } = request.params;
    const db = getDb();
    const reason = moderationReason(request.body?.reason);
    if (reason === undefined) {
      return sendError(reply, 400, 'moderation_reason_too_long', { max: MODERATION_REASON_MAX_LENGTH });
    }

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    const isSelf = uid === request.userId;
    const isOwnerUser = isSpaceOwner(id, request.userId);
    const canKick = hasPermission(request.userId, id, PermissionBits.KICK_MEMBERS);

    if (!isSelf && !canKick) {
      return sendError(reply, 403, 'missing_permission', { permission: 'KICK_MEMBERS' });
    }

    // Owner cannot leave their own server - they must delete it
    if (isSelf && isOwnerUser) {
      return sendError(reply, 400, 'space_owner_cannot_leave');
    }

    const member = db.select()
      .from(schema.spaceMembers)
      .where(and(
        eq(schema.spaceMembers.spaceId, id),
        eq(schema.spaceMembers.userId, uid),
      ))
      .get();

    if (!member) {
      return sendError(reply, 404, 'member_not_found');
    }

    // Cannot kick the owner
    if (isSpaceOwner(id, uid)) {
      return sendError(reply, 400, 'cannot_target_owner');
    }

    // Kicking someone else needs a higher top role than theirs
    if (!isSelf && !canActOnMemberInSpace(id, request.userId, uid)) {
      return sendError(reply, 403, 'role_hierarchy');
    }

    // Read while the member row still holds their nickname.
    const kickedLabel = isSelf ? null : auditUserLabel(id, uid);
    // Leaving does not lift a timeout: it is put back if they join again.
    holdDepartingTimeout(id, uid);

    const departing = and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, uid));
    const departingPictures = db.select({ avatar: schema.spaceMembers.avatar, banner: schema.spaceMembers.banner })
      .from(schema.spaceMembers).where(departing).all();
    db.delete(schema.spaceMembers).where(departing).run();
    releaseMemberPictures(departingPictures);

    // Clean up any voice restrictions for the removed member
    db.delete(schema.voiceRestrictions).where(
      and(
        eq(schema.voiceRestrictions.spaceId, id),
        eq(schema.voiceRestrictions.userId, uid),
      )
    ).run();

    // Clean up read_states for the departing user in this space's channels
    const spaceChannelIds = db.select({ id: schema.channels.id })
      .from(schema.channels).where(eq(schema.channels.spaceId, id)).all().map(c => c.id);
    if (spaceChannelIds.length > 0) {
      db.delete(schema.readStates).where(and(
        eq(schema.readStates.userId, uid),
        inArray(schema.readStates.channelId, spaceChannelIds),
      )).run();
      db.delete(schema.threadMembers).where(and(
        eq(schema.threadMembers.userId, uid),
        inArray(schema.threadMembers.threadId, spaceChannelIds),
      )).run();
    }

    if (!isSelf) {
      recordAudit({
        spaceId: id, actorId: request.userId, action: 'member_kick',
        targetType: 'member', targetId: uid, targetLabel: kickedLabel, reason,
      });
    }

    // Broadcast member_left event
    connectionManager.sendToSpace(id, {
      type: 'member_left',
      spaceId: id,
      userId: uid,
    });
    // Out of its voice, and no longer told what its members are told.
    disconnectMemberFromSpaceVoice(id, uid);
    connectionManager.removeUserSpace(uid, id);

    return reply.code(200).send({ success: true });
  });

  // Role Management
  
  // POST /api/spaces/:id/roles - Create a new role
  app.post<{ Params: { id: string }; Body: RoleWriteRequest }>('/api/spaces/:id/roles', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const { permissions } = request.body;
    const db = getDb();

    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_ROLES)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_ROLES' });
    }

    // A new role can only carry bits its creator holds (held-bits rule,
    // permissions.md). Without this a MANAGE_ROLES holder could create an
    // ADMINISTRATOR role below their own and give it to anyone they outrank.
    const actorPerms = computePermissions(request.userId, id);
    let permStr: string;
    if (permissions !== undefined && permissions !== null) {
      const requested = parsePermissionString(permissions);
      if (requested === null) {
        return sendError(reply, 400, 'permissions_invalid');
      }
      const refusal = roleBitsChangeRefusal(actorPerms, 0n, requested);
      if (refusal) {
        return sendError(reply, 403, refusal);
      }
      permStr = permissionsToString(requested);
    } else {
      // Default to the @everyone baseline so new roles start functional,
      // limited to the bits the creator holds.
      permStr = permissionsToString(DEFAULT_EVERYONE_PERMISSIONS & actorPerms);
    }

    // The display fields; the name defaults to "new role".
    const body = (request.body ?? {}) as Record<string, unknown>;
    const display = parseRoleDisplayFields({ ...body, name: typeof body.name === 'string' && body.name.trim() ? body.name : 'new role' });
    if (!display.ok) {
      return sendError(reply, 400, display.refusal.code, display.refusal.details);
    }
    const roleName = display.value.name ?? 'new role';

    // Check for case-insensitive duplicate name within the space
    const rawDb = getRawDb();
    const duplicate = rawDb.prepare(
      'SELECT id FROM roles WHERE space_id = ? AND name COLLATE NOCASE = ?'
    ).get(id, roleName);
    if (duplicate) {
      return sendError(reply, 409, 'role_name_taken');
    }

    // A new role starts at the bottom, just above @everyone, so the actor
    // must be able to manage a role there.
    if (!canManageRoleInSpace(id, request.userId, 1)) {
      return sendError(reply, 403, 'role_hierarchy');
    }

    const roleId = generateSnowflake();
    db.insert(schema.roles).values({
      id: roleId,
      spaceId: id,
      name: roleName,
      color: display.value.color ?? '#b9bbbe',
      colorSecondary: display.value.colorSecondary ?? null,
      description: display.value.description ?? null,
      icon: display.value.icon ?? null,
      hoist: display.value.hoist ?? 1,
      mentionable: display.value.mentionable ?? 0,
      // Position 0 ties with nothing but @everyone's slot; the normalisation
      // below places the newest role last, at 1, and moves the others up.
      position: 0,
      permissions: permStr,
      createdAt: Date.now(),
    }).run();
    normalizeRolePositions(rawDb, id);

    const role = db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).get();
    if (!role) {
      return sendError(reply, 500, 'internal_error');
    }

    recordAudit({
      spaceId: id, actorId: request.userId, action: 'role_create',
      targetType: 'role', targetId: role.id, targetLabel: role.name,
      changes: addedFields(auditedRoleFields(role)),
    });

    // A new role has no holders yet, so nobody's own access changed.
    announceAccessChange(id, []);

    return reply.code(201).send(roleView(role, viewerReadsPermissionData(computePermissions(request.userId, id))));
  });

  // PATCH /api/spaces/:id/roles/:roleId - Update a role
  app.patch<{ Params: { id: string; roleId: string }; Body: RoleWriteRequest & { position?: number; above?: unknown; below?: unknown; permissionsVersion?: unknown } }>('/api/spaces/:id/roles/:roleId', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, roleId } = request.params;
    const { permissions, above, below, permissionsVersion } = request.body;
    let position = request.body.position;
    const db = getDb();

    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_ROLES)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_ROLES' });
    }

    const role = db.select().from(schema.roles)
      .where(and(eq(schema.roles.id, roleId), eq(schema.roles.spaceId, id)))
      .get();
    if (!role) {
      return sendError(reply, 404, 'role_not_in_space', { roleId });
    }

    // Only roles below the actor's top role can be edited or moved, and only
    // to a position that is still below it.
    const actorStanding = getHierarchyStanding(id, request.userId);
    if (!canManageRoleAt(actorStanding, role.position ?? 0)) {
      return sendError(reply, 403, 'role_hierarchy');
    }
    // A move by anchor (`above` or `below` another role) lands the role next
    // to that role in the order as it is now, so it does what the mover's list
    // showed even when that list is out of date; the request's `position`,
    // which clients send too for servers that do not read the anchor, is
    // ignored then (permissions.md, "Setting the order").
    if (above !== undefined || below !== undefined) {
      const side = above !== undefined ? 'above' : 'below';
      const anchorId = above ?? below;
      if (roleId === id || (above !== undefined && below !== undefined) || typeof anchorId !== 'string') {
        return sendError(reply, 400, 'validation_failed');
      }
      const anchor = db.select({ id: schema.roles.id }).from(schema.roles)
        .where(and(eq(schema.roles.id, anchorId), eq(schema.roles.spaceId, id)))
        .get();
      if (!anchor) {
        return sendError(reply, 400, 'role_not_in_space', { roleId: anchorId });
      }
      const placed = positionNextTo(getRawDb(), id, roleId, anchorId, side);
      if (placed === null) {
        return sendError(reply, 400, 'validation_failed');
      }
      position = placed;
    }
    if (position !== undefined) {
      // @everyone is always at 0, and positions count from 1.
      if (roleId === id || !Number.isInteger(position) || position < 1) {
        return sendError(reply, 400, 'validation_failed');
      }
      if (!canManageRoleAt(actorStanding, position)) {
        return sendError(reply, 403, 'role_hierarchy');
      }
    }

    const display = parseRoleDisplayFields((request.body ?? {}) as Record<string, unknown>);
    if (!display.ok) {
      return sendError(reply, 400, display.refusal.code, display.refusal.details);
    }
    // @everyone is everyone: it is never listed apart or mentioned as a role.
    if (roleId === id && (display.value.hoist !== undefined || display.value.mentionable !== undefined)) {
      return sendError(reply, 400, 'validation_failed');
    }
    const updates: Partial<typeof schema.roles.$inferInsert> = {};
    if (display.value.name !== undefined) {
      const trimmed = display.value.name;
      // Check for case-insensitive duplicate name within the space
      const rawDb = getRawDb();
      const duplicate = rawDb.prepare(
        'SELECT id FROM roles WHERE space_id = ? AND name COLLATE NOCASE = ? AND id != ?'
      ).get(id, trimmed, roleId);
      if (duplicate) {
        return sendError(reply, 409, 'role_name_taken');
      }
      updates.name = trimmed;
    }
    for (const field of ['color', 'colorSecondary', 'description', 'icon', 'hoist', 'mentionable'] as const) {
      if (display.value[field] !== undefined) Object.assign(updates, { [field]: display.value[field] });
    }

    if (permissions !== undefined) {
      const requested = parsePermissionString(permissions);
      if (requested === null) {
        return sendError(reply, 400, 'permissions_invalid');
      }
      // Concurrent edits (permissions.md): a value saved from an outdated copy
      // of the role is refused. Without `permissionsVersion` (a client from
      // before the check) the write is not compared, as before.
      if (permissionsVersion !== undefined) {
        if (typeof permissionsVersion !== 'string' || permissionsVersion.length === 0) {
          return sendError(reply, 400, 'validation_failed');
        }
        if (rolePermissionsVersion(role.permissions) !== permissionsVersion) {
          return sendError(reply, 409, 'role_permissions_conflict');
        }
      }
      // Held-bits rule: only bits the actor holds may be switched, on or off.
      const refusal = roleBitsChangeRefusal(
        computePermissions(request.userId, id),
        stringToPermissions(role.permissions),
        requested,
      );
      if (refusal) {
        return sendError(reply, 403, refusal);
      }
      updates.permissions = permissionsToString(requested);
    }

    if (Object.keys(updates).length === 0 && position === undefined) {
      return sendError(reply, 400, 'no_fields_to_update');
    }

    if (Object.keys(updates).length > 0) {
      db.update(schema.roles).set(updates).where(and(eq(schema.roles.id, roleId), eq(schema.roles.spaceId, id))).run();
    }
    // A move renumbers the other roles too, so positions stay distinct.
    if (position !== undefined) {
      moveRoleToPosition(getRawDb(), id, roleId, position);
    }
    const updated = db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).get();
    if (!updated) {
      return sendError(reply, 404, 'role_not_in_space', { roleId });
    }

    // A request that only moved the role is a reorder; one that changed its
    // name, colour or bits is an update (with the move, when it moved too).
    const fieldChanges = changedFields(auditedRoleFields(role), auditedRoleFields(updated));
    const positionChanges = changedFields({ position: role.position ?? 0 }, { position: updated.position ?? 0 });
    if (fieldChanges.length > 0 || positionChanges.length > 0) {
      recordAudit({
        spaceId: id, actorId: request.userId, action: fieldChanges.length > 0 ? 'role_update' : 'role_reorder',
        targetType: 'role', targetId: roleId, targetLabel: updated.name, changes: [...fieldChanges, ...positionChanges],
      });
    }

    announceAccessChange(id, membersHoldingRole(id, roleId));

    // The actor may have just switched off their own MANAGE_ROLES (a role
    // below their top role can carry it), so the answer is shaped for what
    // they hold now.
    return reply.code(200).send(roleView(updated, viewerReadsPermissionData(computePermissions(request.userId, id))));
  });

  // DELETE /api/spaces/:id/roles/:roleId - Delete a role
  app.delete<{ Params: { id: string; roleId: string } }>('/api/spaces/:id/roles/:roleId', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, roleId } = request.params;
    const db = getDb();

    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_ROLES)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_ROLES' });
    }

    // Cannot delete @everyone role
    if (roleId === id) {
      return sendError(reply, 400, 'everyone_role_not_deletable');
    }

    // The overrides below are keyed by role id alone, so the role has to be
    // proven to belong to this space before its id is used to delete them.
    const role = db.select().from(schema.roles)
      .where(and(eq(schema.roles.id, roleId), eq(schema.roles.spaceId, id)))
      .get();
    if (!role) {
      return sendError(reply, 404, 'role_not_in_space', { roleId });
    }

    if (!canManageRoleInSpace(id, request.userId, role.position ?? 0)) {
      return sendError(reply, 403, 'role_hierarchy');
    }

    // Held-bits rule: deleting a role switches every bit of it off, the same
    // change as a PATCH to no bits, so each bit must be held. Who holds the
    // role (members ranked above the actor included) does not matter: the
    // hierarchy decides who may change a role, not who the change reaches.
    const deleteRefusal = roleBitsChangeRefusal(computePermissions(request.userId, id), stringToPermissions(role.permissions), 0n);
    if (deleteRefusal) {
      return sendError(reply, 403, deleteRefusal);
    }

    // Its holders, read before the delete takes their member_roles rows with it.
    const holders = membersHoldingRole(id, roleId);

    // Overrides name their target without a foreign key, so they would
    // outlive the role: invisible in the editor and impossible to remove.
    db.transaction((tx) => {
      tx.delete(schema.channelOverrides).where(
        and(eq(schema.channelOverrides.targetType, 'role'), eq(schema.channelOverrides.targetId, roleId))
      ).run();
      tx.delete(schema.categoryOverrides).where(
        and(eq(schema.categoryOverrides.targetType, 'role'), eq(schema.categoryOverrides.targetId, roleId))
      ).run();
      tx.delete(schema.roles).where(and(eq(schema.roles.id, roleId), eq(schema.roles.spaceId, id))).run();
    });
    normalizeRolePositions(getRawDb(), id);

    recordAudit({
      spaceId: id, actorId: request.userId, action: 'role_delete',
      targetType: 'role', targetId: roleId, targetLabel: role.name, changes: removedFields(auditedRoleFields(role)),
    });

    announceAccessChange(id, holders);

    return reply.code(200).send({ success: true });
  });

  // POST /api/spaces/:id/members/:uid/roles - Add role to member
  app.post<{ Params: { id: string; uid: string }; Body: { roleId: string } }>('/api/spaces/:id/members/:uid/roles', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id, uid } = request.params;
    const { roleId } = request.body;
    const db = getDb();

    const refusal = checkSingleRoleChange(id, request.userId, uid, roleId, 'add');
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);

    const added = db.insert(schema.memberRoles).values({
      spaceId: id,
      userId: uid,
      roleId,
    }).onConflictDoNothing().run();
    if (added.changes > 0) recordMemberRoleAudit(id, request.userId, uid, [roleId], []);

    announceAccessChange(id, [uid]);

    return reply.code(200).send({ success: true });
  });

  // DELETE /api/spaces/:id/members/:uid/roles/:roleId - Remove role from member
  app.delete<{ Params: { id: string; uid: string; roleId: string } }>('/api/spaces/:id/members/:uid/roles/:roleId', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id, uid, roleId } = request.params;
    const db = getDb();

    const refusal = checkSingleRoleChange(id, request.userId, uid, roleId, 'remove');
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);

    const removed = db.delete(schema.memberRoles).where(and(
      eq(schema.memberRoles.spaceId, id),
      eq(schema.memberRoles.userId, uid),
      eq(schema.memberRoles.roleId, roleId)
    )).run();
    if (removed.changes > 0) recordMemberRoleAudit(id, request.userId, uid, [], [roleId]);

    announceAccessChange(id, [uid]);

    return reply.code(200).send({ success: true });
  });

  // PATCH /api/spaces/:id/transfer-ownership — Transfer space ownership
  app.patch<{ Params: { id: string }; Body: { newOwnerId: string } }>('/api/spaces/:id/transfer-ownership', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const { newOwnerId } = request.body;
    const db = getDb();

    if (!newOwnerId || typeof newOwnerId !== 'string') {
      return sendError(reply, 400, 'new_owner_required');
    }

    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (!isSpaceOwner(id, request.userId)) {
      return sendError(reply, 403, 'space_owner_only');
    }

    if (newOwnerId === request.userId) {
      return sendError(reply, 400, 'already_owner');
    }

    // Verify new owner is a member
    if (!isMember(id, newOwnerId)) {
      return sendError(reply, 400, 'new_owner_not_member');
    }

    const formerOwnerLabel = auditUserLabel(id, request.userId);
    const newOwnerLabel = auditUserLabel(id, newOwnerId);

    // Do not transfer the previous owner's personal title to the new owner.
    // The owner is never timed out, so a timeout the new owner was under ends.
    db.transaction((tx) => {
      tx.update(schema.spaces).set({ ownerId: newOwnerId, ownerTitle: null }).where(eq(schema.spaces.id, id)).run();
      tx.update(schema.spaceMembers).set({ timedOutUntil: null })
        .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, newOwnerId))).run();
    });

    const reviewEdit = reviewsAfterTransfer(server);
    if (reviewEdit.verification) {
      db.update(schema.spaces).set({ verificationStatus: reviewEdit.verification.status }).where(eq(schema.spaces.id, id)).run();
    }

    const updated = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!updated) {
      return sendError(reply, 500, 'ownership_transfer_failed');
    }
    if (reviewEdit.verification) {
      for (const step of recordEditSteps(updated, request.userId, reviewEdit)) {
        announceReviewStep(updated, step, { spaceUpdate: false });
      }
    }

    recordAudit({
      spaceId: id, actorId: request.userId, action: 'ownership_transfer',
      targetType: 'member', targetId: newOwnerId, targetLabel: newOwnerLabel,
      changes: [auditChange('owner', formerOwnerLabel, newOwnerLabel)],
    });

    const spaceData = spaceToWire(updated);

    // Broadcast space_updated so all clients see the new owner
    connectionManager.sendToSpace(id, {
      type: 'space_updated',
      space: spaceData,
    });

    // The owner holds every permission, so the former owner's and the new
    // owner's own permissions both changed: their clients refetch the detail,
    // which carries role bits only for what each holds now.
    announceAccessChange(id, [request.userId, newOwnerId]);

    return reply.code(200).send(spaceData);
  });

  // GET /api/spaces/invite/:code/preview — Public invite preview (no auth)
  app.get<{ Params: { code: string } }>('/api/spaces/invite/:code/preview', async (request, reply) => {
    const { code } = request.params;
    const preview = getLocalInvitePreview(code);
    if (!preview) {
      return sendError(reply, 404, 'invite_not_found');
    }
    return reply.code(200).send(preview);
  });

  // ─── Ban Management ───────────────────────────────────────────────────────

  // GET /api/spaces/:id/bans - List bans
  app.get<{ Params: { id: string } }>('/api/spaces/:id/bans', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    if (!hasPermission(request.userId, id, PermissionBits.BAN_MEMBERS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'BAN_MEMBERS' });
    }

    const banRows = db.select().from(schema.bans)
      .where(eq(schema.bans.spaceId, id))
      .all();

    if (banRows.length === 0) return reply.code(200).send([]);

    const userIds = [...new Set(banRows.map(b => b.userId))];
    const bannedByIds = [...new Set(banRows.map(b => b.bannedBy))];
    const allUserIds = [...new Set([...userIds, ...bannedByIds].filter((id): id is string => id !== null))];
    const users = allUserIds.length > 0
      ? db.select().from(schema.users).where(inArray(schema.users.id, allUserIds)).all()
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));

    const bans = banRows.map(b => {
      const user = userMap.get(b.userId);
      const moderator = b.bannedBy ? userMap.get(b.bannedBy) : undefined;
      return {
        spaceId: b.spaceId,
        userId: b.userId,
        reason: b.reason,
        bannedBy: b.bannedBy,
        createdAt: b.createdAt,
        user: user ? sanitizeUser(user) : null,
        moderator: moderator ? sanitizeUser(moderator) : null,
      };
    });

    return reply.code(200).send(bans);
  });

  // POST /api/spaces/:id/bans - Ban a member
  app.post<{ Params: { id: string }; Body: { userId: string; reason?: string; deleteMessagesSeconds?: number } }>('/api/spaces/:id/bans', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId: targetId, deleteMessagesSeconds = 0 } = request.body;
    const db = getDb();

    if (!targetId || typeof targetId !== 'string') {
      return sendError(reply, 400, 'user_id_required');
    }

    const reason = moderationReason(request.body.reason);
    if (reason === undefined) {
      return sendError(reply, 400, 'moderation_reason_too_long', { max: MODERATION_REASON_MAX_LENGTH });
    }
    if (!(BAN_DELETE_MESSAGE_SECONDS as readonly number[]).includes(deleteMessagesSeconds)) {
      return sendError(reply, 400, 'ban_delete_window_invalid');
    }

    if (!hasPermission(request.userId, id, PermissionBits.BAN_MEMBERS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'BAN_MEMBERS' });
    }

    // Cannot ban the space owner
    if (isSpaceOwner(id, targetId)) {
      return sendError(reply, 400, 'cannot_target_owner');
    }

    // Cannot ban yourself
    if (targetId === request.userId) {
      return sendError(reply, 400, 'cannot_target_self');
    }

    // Banning needs a higher top role than the target's
    if (!canActOnMemberInSpace(id, request.userId, targetId)) {
      return sendError(reply, 403, 'role_hierarchy');
    }

    // Check if already banned
    if (isBanned(id, targetId)) {
      return sendError(reply, 409, 'already_banned');
    }

    const now = Date.now();
    // Read while the member row still holds their nickname.
    const bannedLabel = auditUserLabel(id, targetId);

    // Fetch channel IDs before the transaction for read_states cleanup
    const banChannelIds = db.select({ id: schema.channels.id })
      .from(schema.channels).where(eq(schema.channels.spaceId, id)).all().map(c => c.id);
    const bannedPictures = db.select({ avatar: schema.spaceMembers.avatar, banner: schema.spaceMembers.banner })
      .from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, targetId)))
      .all();

    db.transaction((tx) => {
      // Insert ban record
      tx.insert(schema.bans).values({
        spaceId: id,
        userId: targetId,
        reason,
        bannedBy: request.userId,
        createdAt: now,
      }).run();

      // Remove member from space
      tx.delete(schema.spaceMembers).where(and(
        eq(schema.spaceMembers.spaceId, id),
        eq(schema.spaceMembers.userId, targetId),
      )).run();

      // Remove member's role assignments
      tx.delete(schema.memberRoles).where(and(
        eq(schema.memberRoles.spaceId, id),
        eq(schema.memberRoles.userId, targetId),
      )).run();

      // Clean up read_states for the banned user in this space's channels
      if (banChannelIds.length > 0) {
        tx.delete(schema.readStates).where(and(
          eq(schema.readStates.userId, targetId),
          inArray(schema.readStates.channelId, banChannelIds),
        )).run();
      }

      // Clean up any voice restrictions for the banned member
      tx.delete(schema.voiceRestrictions).where(and(
        eq(schema.voiceRestrictions.spaceId, id),
        eq(schema.voiceRestrictions.userId, targetId),
      )).run();

      // A ban drops a timeout, one held from an earlier leave included.
      dropHeldTimeout(id, targetId, tx);
    });
    releaseMemberPictures(bannedPictures);

    recordAudit({
      spaceId: id, actorId: request.userId, action: 'member_ban',
      targetType: 'member', targetId, targetLabel: bannedLabel, reason,
    });

    if (deleteMessagesSeconds > 0) {
      const removed = deleteRecentMessagesOf(id, targetId, now - deleteMessagesSeconds * 1000);
      if (removed > 0) {
        recordAudit({
          spaceId: id, actorId: request.userId, action: 'messages_bulk_delete',
          targetType: 'member', targetId, targetLabel: bannedLabel,
          changes: [auditChange('messages', null, String(removed))],
        });
      }
    }

    // Broadcast member_left event so other clients update their member list
    connectionManager.sendToSpace(id, {
      type: 'member_left',
      spaceId: id,
      userId: targetId,
    });

    // Notify the banned user
    connectionManager.sendToUser(targetId, {
      type: 'member_banned',
      spaceId: id,
      reason,
    });
    // Out of its voice, and no longer told what its members are told.
    disconnectMemberFromSpaceVoice(id, targetId);
    connectionManager.removeUserSpace(targetId, id);

    return reply.code(200).send({ success: true });
  });

  // DELETE /api/spaces/:id/bans/:uid - Unban a user
  app.delete<{ Params: { id: string; uid: string } }>('/api/spaces/:id/bans/:uid', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const { id, uid } = request.params;
    const db = getDb();

    if (!hasPermission(request.userId, id, PermissionBits.BAN_MEMBERS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'BAN_MEMBERS' });
    }

    const result = db.delete(schema.bans).where(and(
      eq(schema.bans.spaceId, id),
      eq(schema.bans.userId, uid),
    )).run();

    if (result.changes === 0) {
      return sendError(reply, 404, 'ban_not_found');
    }

    recordAudit({
      spaceId: id, actorId: request.userId, action: 'member_unban',
      targetType: 'member', targetId: uid, targetLabel: auditUserLabel(id, uid),
    });

    return reply.code(200).send({ success: true });
  });
}
