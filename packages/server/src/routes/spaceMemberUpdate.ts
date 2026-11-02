import path from 'path';
import { PROFILE_LIMITS, type MemberWithUser, type UpdateMemberRequest, type UpdateSpaceProfileRequest } from '@backspace/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { deleteAttachmentByFilename, deleteUploadFile } from '../utils/fileCleanup.js';
import { resizeProfileImage } from '../utils/thumbnail.js';
import { MAX_MEMBER_NICKNAME_LENGTH, normalizeMemberNickname } from '@backspace/shared/src/constants.js';
import { canActOnMember, canManageRoleAt, roleBitsChangeRefusal, stringToPermissions, type HeldBitsRefusal } from '@backspace/shared/src/permissions.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { hasPermission, computePermissions, PermissionBits } from '../utils/permissions.js';
import { getHierarchyStanding } from '../utils/roleHierarchy.js';
import { loadMemberWire } from '../utils/spaceWire.js';
import { recordMemberRoleAudit } from '../utils/auditLog.js';
import { connectionManager } from '../ws/handler.js';
import { checkVoicePermissions } from '../ws/events.js';
import { ownProfileUploadOf, pictureFileReleasable } from '../utils/profileImageRefs.js';

/**
 * Held-bits rule for handing out a role (permissions.md, "Held-bits rule"):
 * giving a member a role gives them its bits, so the actor must hold every
 * one of them. Taking a role away is governed by the hierarchy alone.
 */
export function roleGrantRefusal(spaceId: string, actorId: string, rolePermissions: string | null): HeldBitsRefusal | null {
  return roleBitsChangeRefusal(computePermissions(actorId, spaceId), 0n, stringToPermissions(rolePermissions));
}

interface MemberUpdateContext {
  spaceId: string;
  actorId: string;
  targetId: string;
  ownerId: string;
  reply: FastifyReply;
}

function validateRoleUpdate(context: MemberUpdateContext, roleIds: unknown): roleIds is string[] {
  const { spaceId, actorId, targetId, ownerId, reply } = context;
  if (!hasPermission(actorId, spaceId, PermissionBits.MANAGE_ROLES)) {
    sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_ROLES' });
    return false;
  }
  // The owner's rights come from owning the space, so the owner may set their
  // own roles; nobody else may set their own or the owner's.
  const ownerActsOnSelf = targetId === actorId && actorId === ownerId;
  if (targetId === actorId && !ownerActsOnSelf) {
    sendError(reply, 400, 'cannot_change_own_roles');
    return false;
  }
  if (targetId === ownerId && !ownerActsOnSelf) {
    sendError(reply, 403, 'space_owner_only');
    return false;
  }
  if (!Array.isArray(roleIds) || roleIds.some((id) => typeof id !== 'string') || new Set(roleIds).size !== roleIds.length) {
    sendError(reply, 400, 'role_ids_invalid');
    return false;
  }
  const db = getDb();
  const spaceRoles = db.select().from(schema.roles).where(eq(schema.roles.spaceId, spaceId)).all();
  const spaceRolePositions = new Map(spaceRoles.map(r => [r.id, r.position ?? 0]));
  for (const roleId of roleIds) {
    if (!spaceRolePositions.has(roleId)) {
      sendError(reply, 400, 'role_not_in_space', { roleId });
      return false;
    }
    if (roleId === spaceId) {
      sendError(reply, 400, 'everyone_role_not_assignable');
      return false;
    }
  }

  // Role hierarchy: the member must rank below the actor, and every role
  // this request adds or removes must sit below the actor's top role.
  const actorStanding = getHierarchyStanding(spaceId, actorId);
  if (!ownerActsOnSelf && !canActOnMember(actorStanding, getHierarchyStanding(spaceId, targetId))) {
    sendError(reply, 403, 'role_hierarchy');
    return false;
  }
  const currentRoleIds = new Set(
    db.select({ roleId: schema.memberRoles.roleId })
      .from(schema.memberRoles)
      .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.userId, targetId)))
      .all()
      .map(r => r.roleId),
  );
  const requestedRoleIds = new Set(roleIds);
  const changedRoleIds = [
    ...roleIds.filter(r => !currentRoleIds.has(r)),
    ...[...currentRoleIds].filter(r => !requestedRoleIds.has(r)),
  ];
  for (const roleId of changedRoleIds) {
    if (!canManageRoleAt(actorStanding, spaceRolePositions.get(roleId) ?? 0)) {
      sendError(reply, 403, 'role_hierarchy');
      return false;
    }
  }
  // Held-bits rule: a role this request adds must carry only bits the actor holds.
  for (const roleId of roleIds.filter(r => !currentRoleIds.has(r))) {
    const refusal = roleGrantRefusal(spaceId, actorId, spaceRoles.find(r => r.id === roleId)?.permissions ?? null);
    if (refusal) {
      sendError(reply, 403, refusal);
      return false;
    }
  }
  return true;
}

/**
 * Who may set whose nickname: anyone their own; another member's needs
 * MANAGE_SPACE, never reaches the owner, and follows the role hierarchy like
 * every other action on a member (permissions.md, "Role hierarchy").
 * Answers the stored form (null clears), or undefined after sending a refusal.
 */
function validateNicknameUpdate(context: MemberUpdateContext, nickname: unknown): string | null | undefined {
  const { spaceId, actorId, targetId, ownerId, reply } = context;
  if (actorId !== targetId) {
    if (!hasPermission(actorId, spaceId, PermissionBits.MANAGE_SPACE)) {
      sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
      return undefined;
    }
    if (targetId === ownerId) {
      sendError(reply, 403, 'space_owner_only');
      return undefined;
    }
    if (!canActOnMember(getHierarchyStanding(spaceId, actorId), getHierarchyStanding(spaceId, targetId))) {
      sendError(reply, 403, 'role_hierarchy');
      return undefined;
    }
  }
  const stored = normalizeMemberNickname(nickname);
  if (stored === undefined) {
    sendError(reply, 400, 'member_nickname_invalid', { max: MAX_MEMBER_NICKNAME_LENGTH });
    return undefined;
  }
  return stored;
}

/** What a valid PATCH writes: the role set and the nickname in its stored form, each only when sent. */
interface MemberWrite {
  roleIds?: string[];
  nickname?: string | null;
}

/**
 * Checks every field before anything is written, so a request that changes
 * roles and the nickname together never half succeeds. Answers the write, or
 * null after sending a refusal.
 */
function validateMemberPatch(context: MemberUpdateContext, patch: UpdateMemberRequest): MemberWrite | null {
  const { roleIds, nickname } = patch;
  if (roleIds === undefined && nickname === undefined) {
    sendError(context.reply, 400, 'validation_failed');
    return null;
  }
  const write: MemberWrite = {};
  if (roleIds !== undefined) {
    if (!validateRoleUpdate(context, roleIds)) return null;
    write.roleIds = roleIds;
  }
  if (nickname !== undefined) {
    const stored = validateNicknameUpdate(context, nickname);
    if (stored === undefined) return null;
    write.nickname = stored;
  }
  return write;
}

function persistMemberUpdate(target: { spaceId: string; userId: string }, write: MemberWrite): void {
  const { spaceId: id, userId: uid } = target;
  const { roleIds, nickname } = write;
  const db = getDb();
  db.transaction((tx) => {
    if (roleIds !== undefined) {
      tx.delete(schema.memberRoles)
        .where(and(eq(schema.memberRoles.spaceId, id), eq(schema.memberRoles.userId, uid))).run();
      for (const roleId of roleIds) {
        tx.insert(schema.memberRoles).values({ spaceId: id, userId: uid, roleId }).run();
      }
    }
    if (nickname !== undefined) {
      tx.update(schema.spaceMembers).set({ nickname })
        .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, uid))).run();
    }
  });
}

export function updateSpaceMemberRoutes(app: FastifyInstance): void {
  registerSpaceProfileRoute(app);
  app.patch<{ Params: { id: string; uid: string }; Body: UpdateMemberRequest }>('/api/spaces/:id/members/:uid', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, uid } = request.params;
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      return sendError(reply, 400, 'validation_failed');
    }
    const db = getDb();
    const server = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!server) return sendError(reply, 404, 'space_not_found');

    // No membership check on the actor: the permission checks decide, as
    // before nicknames, so an instance admin keeps managing roles in a space
    // they have not joined. A nickname of one's own needs a member row (404).
    const context = { spaceId: id, actorId: request.userId, targetId: uid, ownerId: server.ownerId, reply };
    const write = validateMemberPatch(context, request.body);
    if (!write) return reply;
    const member = db.select().from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, uid))).get();
    if (!member) return sendError(reply, 404, 'member_not_found');

    const rolesBefore = write.roleIds !== undefined ? currentRoleIds(id, uid) : null;
    persistMemberUpdate({ spaceId: id, userId: uid }, write);

    if (write.roleIds !== undefined && rolesBefore !== null) {
      const requested = new Set(write.roleIds);
      recordMemberRoleAudit(
        id,
        request.userId,
        uid,
        write.roleIds.filter((roleId) => !rolesBefore.has(roleId)),
        [...rolesBefore].filter((roleId) => !requested.has(roleId)),
      );
      // Recompute the target's permissions in addition to refreshing everyone's member display.
      connectionManager.announceSpaceAccessChange(id, [uid]);
      checkVoicePermissions(id);
    }

    return publishUpdatedMember(id, uid, reply);
  });
}

type ProfileImageField = 'avatar' | 'banner';

/**
 * PATCH /api/spaces/:id/members/@me/profile: the member's own picture, banner
 * and about text for this space (spaces.md, "Space profiles"). Null shows the
 * account's again. Only the member sets it; it is never read in another space.
 */
function registerSpaceProfileRoute(app: FastifyInstance): void {
  app.patch<{ Params: { id: string }; Body: UpdateSpaceProfileRequest }>('/api/spaces/:id/members/@me/profile', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendError(reply, 400, 'validation_failed');
    }
    const db = getDb();
    const member = db.select().from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, request.userId))).get();
    if (!member) return sendError(reply, 404, 'not_space_member');

    const updates: Partial<Pick<typeof schema.spaceMembers.$inferInsert, 'avatar' | 'banner' | 'bio'>> = {};
    const replaced: string[] = [];
    const placed: Array<{ name: string; kind: ProfileImageField }> = [];
    for (const field of ['avatar', 'banner'] as const) {
      const value: unknown = body[field];
      if (value === undefined) continue;
      const current = member[field] ?? null;
      if (value === null || value === '') {
        updates[field] = null;
      } else {
        const name = typeof value === 'string' ? ownProfileUploadOf(value, request.userId, current) : undefined;
        if (!name) return sendError(reply, 400, field === 'avatar' ? 'avatar_url_invalid' : 'banner_url_invalid');
        updates[field] = name;
        if (name !== current) placed.push({ name, kind: field });
      }
      if (current && current !== updates[field]) replaced.push(current);
    }
    if (body.bio !== undefined) {
      if (body.bio !== null && typeof body.bio !== 'string') return sendError(reply, 400, 'validation_failed');
      const trimmed = typeof body.bio === 'string' ? body.bio.trim() : '';
      if (trimmed.length > PROFILE_LIMITS.MAX_BIO_LENGTH) {
        return sendError(reply, 400, 'bio_too_long', { max: PROFILE_LIMITS.MAX_BIO_LENGTH });
      }
      updates.bio = trimmed || null;
    }
    if (Object.keys(updates).length === 0) return sendError(reply, 400, 'no_fields_to_update');

    db.update(schema.spaceMembers).set(updates)
      .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, request.userId))).run();

    // The new images are the member row's now, not an upload waiting for a
    // message; they are fitted to their slot like an account's.
    for (const image of placed) {
      deleteAttachmentByFilename(image.name);
      await resizeProfileImage(path.join(config.uploadDir, path.basename(image.name)), image.kind);
    }
    // A replaced image goes once nothing else shows it and no message holds it.
    for (const old of replaced) {
      if (pictureFileReleasable(old)) deleteUploadFile(old);
    }

    return publishUpdatedMember(id, request.userId, reply);
  });
}

/** The ids of the roles `userId` holds in `spaceId`. */
function currentRoleIds(spaceId: string, userId: string): Set<string> {
  return new Set(getDb().select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.userId, userId)))
    .all()
    .map((row) => row.roleId));
}

/**
 * Tell the space how a member is now: `member_updated` with the member as
 * `loadMemberWire` builds it (roles by display fields only, the timeout while
 * it runs). Answers that member, or null when there is no such member. The
 * timeout routes (routes/spaceModeration.ts) send it through here too.
 */
export function broadcastMemberUpdate(spaceId: string, userId: string): MemberWithUser | null {
  const member = loadMemberWire(spaceId, userId);
  if (member) connectionManager.sendToSpace(spaceId, { type: 'member_updated', spaceId, member });
  return member;
}

function publishUpdatedMember(id: string, uid: string, reply: FastifyReply): FastifyReply {
  const result = broadcastMemberUpdate(id, uid);
  if (!result) {
    return sendError(reply, 500, 'member_update_failed');
  }
  return reply.code(200).send(result);
}

