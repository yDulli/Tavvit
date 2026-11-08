import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import {
  PROFILE_REMOVABLE_PARTS,
  REMOVAL_REASON_LIMITS,
  SPACE_REMOVABLE_PARTS,
  isSpaceExpressionKind,
  removalPartsOf,
  removalSubject,
  type AdminSpaceExpressions,
  type ProfileRemovablePart,
  type SpaceRemovablePart,
} from '@backspace/shared/src/adminRemoval.js';
import { isReportGround, type ReportGround } from '@backspace/shared/src/legal.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { markDirectoryDirty } from '../directory/state.js';
import { profileKeptByHome } from '../utils/adminUser.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { forgetWearerCounts } from '../utils/customDecorations.js';
import { isFederationRelayEnabled } from '../utils/federationOutbox.js';
import { deleteAttachmentByFilename, deleteUploadFile } from '../utils/fileCleanup.js';
import { sendError } from '../utils/httpErrors.js';
import { recordPlatformAudit } from '../utils/platformAudit.js';
import { announceProfileChange } from '../utils/profileBroadcast.js';
import { pictureFileReleasable, uploadNameOf } from '../utils/profileImageRefs.js';
import { relayProfileUpdate } from '../utils/profileRelay.js';
import { removeReportedMessage, sendNotice } from '../utils/reports.js';
import { deleteSpaceCompletely } from '../utils/spaceDeletion.js';
import {
  removeSpaceEmoji,
  removeSpaceSound,
  removeSpaceSticker,
  spaceEmojiRow,
  spaceSoundRow,
  spaceStickerRow,
} from '../utils/spaceExpressionRemoval.js';
import { announceSpaceTagChange, releaseSpaceTagsOf } from '../utils/spaceTags.js';
import { listSpaceEmojis, listSpaceStickers, toSpaceEmoji, toSpaceSticker } from '../utils/spaceExpressions.js';
import { spaceToWire } from '../utils/spaceWire.js';
import { connectionManager } from '../ws/handler.js';

/**
 * What an instance administrator takes away directly, without a report to decide
 * (docs/systems/admin.md, "Removing content"): a message in a space, parts of a person's profile,
 * parts of a space or one of its emoji, stickers and sounds, or the whole space. Every removal
 * names its reason and its ground; the person it concerns is told what went, why, on which ground
 * and how to object (DSA Art. 17), and the platform audit log keeps that it happened. Direct
 * messages are not here: an administrator does not read them, and acts on them through a report.
 * Closed to bots like every route that does not open itself (bots.md).
 */

const ADMIN = { preHandler: [authenticate, requireAdmin] };

type UserRow = typeof schema.users.$inferSelect;

interface Removal {
  reason: string;
  ground: ReportGround;
}

/** The reason and the ground every removal names, or the refusal already sent. */
function removalOf(request: FastifyRequest, reply: FastifyReply): Removal | null {
  const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < REMOVAL_REASON_LIMITS.MIN || reason.length > REMOVAL_REASON_LIMITS.MAX) {
    void sendError(reply, 400, 'removal_reason_invalid', { min: REMOVAL_REASON_LIMITS.MIN, max: REMOVAL_REASON_LIMITS.MAX });
    return null;
  }
  if (!isReportGround(body.ground)) {
    void sendError(reply, 400, 'report_ground_required');
    return null;
  }
  return { reason, ground: body.ground };
}

function bodyField(request: FastifyRequest, field: string): unknown {
  return typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>)[field] : undefined;
}

function accountOf(id: string): UserRow | undefined {
  return getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();
}

/** An account of this instance, whom a notice reaches: not a copy of someone whose home is elsewhere. */
function isLocalAccount(user: UserRow | undefined): user is UserRow {
  return !!user && user.isDeleted !== 1 && !profileKeptByHome(user);
}

/** A replaced picture goes once nothing shows it any more (utils/profileImageRefs.ts). */
function releasePicture(value: string | null): void {
  const file = uploadNameOf(value);
  if (file && pictureFileReleasable(file)) {
    deleteUploadFile(file);
    deleteAttachmentByFilename(file);
  }
}

/** The columns a part of a profile is kept in, as they read when it is gone. */
function clearedProfile(parts: readonly ProfileRemovablePart[]): Partial<typeof schema.users.$inferInsert> {
  const changes: Partial<typeof schema.users.$inferInsert> = {};
  for (const part of parts) {
    switch (part) {
      case 'avatar': changes.avatar = null; break;
      case 'banner': changes.banner = null; break;
      case 'displayName': changes.displayName = null; break;
      case 'bio': changes.bio = null; break;
      case 'status': changes.customStatus = null; changes.customStatusExpiresAt = null; break;
      case 'pronouns': changes.pronouns = null; break;
      case 'links': changes.profileLinks = null; break;
      case 'decorations':
        changes.avatarFrame = null;
        changes.profileEffect = null;
        changes.nameplate = null;
        changes.nameFont = null;
        changes.nameEffect = null;
        break;
      case 'spaceTag': changes.spaceTag = null; break;
    }
  }
  return changes;
}

export async function adminRemovalRoutes(app: FastifyInstance): Promise<void> {
  // ─── A message in a space ─────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/admin/messages/:id/remove', ADMIN, async (request, reply) => {
    const removal = removalOf(request, reply);
    if (!removal) return reply;
    const db = getDb();
    const message = db.select().from(schema.messages).where(eq(schema.messages.id, request.params.id)).get();
    if (!message) return sendError(reply, 404, 'message_not_found');
    const channel = db.select({ spaceId: schema.channels.spaceId }).from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
    if (!removeReportedMessage('message', message.id)) return sendError(reply, 404, 'message_not_found');
    const author = accountOf(message.userId);
    if (isLocalAccount(author) && author.id !== request.userId) {
      sendNotice(author.id, { kind: 'content_removed', ground: removal.ground, note: removal.reason, subject: message.content || null });
    }
    recordPlatformAudit({
      actorId: request.userId,
      action: 'message_remove',
      targetType: 'user',
      targetId: message.userId,
      targetLabel: author?.username ?? null,
      reason: removal.reason,
      details: { message: message.id, channel: message.channelId, space: channel?.spaceId ?? null, ground: removal.ground },
    });
    return reply.code(200).send({ success: true });
  });

  // ─── Parts of a person's profile ──────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/admin/users/:id/profile/remove', ADMIN, async (request, reply) => {
    const removal = removalOf(request, reply);
    if (!removal) return reply;
    const parts = removalPartsOf(bodyField(request, 'parts'), PROFILE_REMOVABLE_PARTS);
    if (!parts) return sendError(reply, 400, 'removal_parts_invalid');
    const { id } = request.params;
    if (id === request.userId) return sendError(reply, 400, 'cannot_target_self');
    const target = accountOf(id);
    if (!target || target.isDeleted === 1) return sendError(reply, 404, 'user_not_found');
    // A copy of someone whose home is another instance shows what that instance sends: it is
    // theirs to act on, and this one would only be written over by the next update from there.
    if (!isLocalAccount(target)) return sendError(reply, 400, 'profile_managed_by_home');

    const db = getDb();
    db.update(schema.users).set({ ...clearedProfile(parts), profileUpdatedAt: Date.now() }).where(eq(schema.users.id, id)).run();
    if (parts.includes('avatar')) releasePicture(target.avatar);
    if (parts.includes('banner')) releasePicture(target.banner);
    if (parts.includes('decorations')) forgetWearerCounts();
    const updated = accountOf(id)!;
    announceProfileChange(updated);
    if (isFederationRelayEnabled()) relayProfileUpdate(updated);

    sendNotice(id, { kind: 'profile_content_removed', ground: removal.ground, note: removal.reason, subject: removalSubject({ parts }) });
    recordPlatformAudit({
      actorId: request.userId,
      action: 'profile_content_remove',
      targetType: 'user',
      targetId: id,
      targetLabel: target.username,
      reason: removal.reason,
      details: { parts, ground: removal.ground },
    });
    return reply.code(200).send({ success: true });
  });

  // ─── Parts of a space ─────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/admin/spaces/:id/content/remove', ADMIN, async (request, reply) => {
    const removal = removalOf(request, reply);
    if (!removal) return reply;
    const parts = removalPartsOf(bodyField(request, 'parts'), SPACE_REMOVABLE_PARTS);
    if (!parts) return sendError(reply, 400, 'removal_parts_invalid');
    const db = getDb();
    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, request.params.id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');

    const changes: Partial<typeof schema.spaces.$inferInsert> = {};
    const removing = (part: SpaceRemovablePart) => parts.includes(part);
    if (removing('icon')) changes.icon = null;
    if (removing('banner')) changes.banner = null;
    if (removing('description')) changes.description = null;
    // Whoever wears the tag stops wearing it, as when its space drops it.
    const tagWearers = removing('tag') ? releaseSpaceTagsOf(space.id) : [];
    if (removing('tag')) changes.tag = null;
    db.update(schema.spaces).set(changes).where(eq(schema.spaces.id, space.id)).run();
    if (removing('icon')) releasePicture(space.icon);
    if (removing('banner')) releasePicture(space.banner);
    const updated = db.select().from(schema.spaces).where(eq(schema.spaces.id, space.id)).get()!;
    connectionManager.sendToSpace(space.id, { type: 'space_updated', space: spaceToWire(updated) });
    if (tagWearers.length > 0) announceSpaceTagChange(tagWearers);
    if (space.directoryListed === 1) markDirectoryDirty(getRawDb());

    const owner = accountOf(space.ownerId);
    if (isLocalAccount(owner) && owner.id !== request.userId) {
      sendNotice(owner.id, { kind: 'space_content_removed', ground: removal.ground, note: removal.reason, subject: removalSubject({ space: space.name, parts }) });
    }
    recordPlatformAudit({
      actorId: request.userId,
      action: 'space_content_remove',
      targetType: 'space',
      targetId: space.id,
      targetLabel: space.name,
      reason: removal.reason,
      details: { parts, ground: removal.ground },
    });
    return reply.code(200).send({ success: true });
  });

  // ─── One of a space's emoji, stickers or sounds ───────────────────────────
  // What there is to remove, for the admin console: an administrator need not be a member.
  app.get<{ Params: { id: string } }>('/api/admin/spaces/:id/expressions', ADMIN, async (request, reply) => {
    const db = getDb();
    const space = db.select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, request.params.id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    const sounds = db.select().from(schema.spaceSounds).where(eq(schema.spaceSounds.spaceId, space.id)).orderBy(asc(schema.spaceSounds.createdAt)).all();
    const listing: AdminSpaceExpressions = {
      emojis: listSpaceEmojis(space.id).map(toSpaceEmoji),
      stickers: listSpaceStickers(space.id).map(toSpaceSticker),
      sounds: sounds.map((row) => ({ id: row.id, spaceId: row.spaceId, name: row.name, duration: row.duration, createdBy: row.createdBy, createdAt: row.createdAt })),
    };
    return listing;
  });

  app.post<{ Params: { id: string } }>('/api/admin/spaces/:id/expressions/remove', ADMIN, async (request, reply) => {
    const removal = removalOf(request, reply);
    if (!removal) return reply;
    const kind = bodyField(request, 'kind');
    const itemId = bodyField(request, 'id');
    if (!isSpaceExpressionKind(kind) || typeof itemId !== 'string') return sendError(reply, 400, 'removal_parts_invalid');
    const space = getDb().select().from(schema.spaces).where(eq(schema.spaces.id, request.params.id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');

    let name: string;
    let addedBy: string | null;
    if (kind === 'emoji') {
      const row = spaceEmojiRow(itemId);
      if (!row || row.spaceId !== space.id) return sendError(reply, 404, 'space_emoji_not_found');
      await removeSpaceEmoji(row, request.userId);
      name = row.name;
      addedBy = row.createdBy;
    } else if (kind === 'sticker') {
      const row = spaceStickerRow(itemId);
      if (!row || row.spaceId !== space.id) return sendError(reply, 404, 'space_sticker_not_found');
      removeSpaceSticker(row, request.userId);
      name = row.name;
      addedBy = row.createdBy;
    } else {
      const row = spaceSoundRow(itemId);
      if (!row || row.spaceId !== space.id) return sendError(reply, 404, 'sound_not_found');
      await removeSpaceSound(row, request.userId);
      name = row.name;
      addedBy = row.createdBy;
    }

    // Whoever added it is told, and the space's owner when that person's account is gone.
    const added = addedBy ? accountOf(addedBy) : undefined;
    const told = isLocalAccount(added) ? added : accountOf(space.ownerId);
    if (isLocalAccount(told) && told.id !== request.userId) {
      sendNotice(told.id, { kind: 'space_content_removed', ground: removal.ground, note: removal.reason, subject: removalSubject({ space: space.name, expression: kind, name }) });
    }
    recordPlatformAudit({
      actorId: request.userId,
      action: 'space_content_remove',
      targetType: 'space',
      targetId: space.id,
      targetLabel: space.name,
      reason: removal.reason,
      details: { expression: kind, item: itemId, name, ground: removal.ground },
    });
    return reply.code(200).send({ success: true });
  });

  // ─── A whole space ────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/admin/spaces/:id/delete', ADMIN, async (request, reply) => {
    const removal = removalOf(request, reply);
    if (!removal) return reply;
    const space = getDb().select().from(schema.spaces).where(eq(schema.spaces.id, request.params.id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    // Everything in it goes with it, as when its owner deletes it (utils/spaceDeletion.ts).
    deleteSpaceCompletely(space);
    const owner = accountOf(space.ownerId);
    if (isLocalAccount(owner) && owner.id !== request.userId) {
      sendNotice(owner.id, { kind: 'space_removed', ground: removal.ground, note: removal.reason, subject: removalSubject({ space: space.name }) });
    }
    recordPlatformAudit({
      actorId: request.userId,
      action: 'space_delete',
      targetType: 'space',
      targetId: space.id,
      targetLabel: space.name,
      reason: removal.reason,
      details: { ground: removal.ground },
    });
    return reply.code(200).send({ success: true });
  });
}
