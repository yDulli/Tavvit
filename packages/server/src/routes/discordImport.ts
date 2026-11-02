import { spaceLimitReached } from '../utils/accountLimits.js';
import { accountNeedsVerifiedEmail } from '../email/gate.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, ne, sql } from 'drizzle-orm';
import { AVATAR_COLORS, type AuditLogChange } from '@backspace/shared';
import {
  DISCORD_IMPORT_LIMITS,
  DISCORD_NOT_TRANSFERRED,
  parseDiscordTemplateCode,
  planDiscordImport,
  readDiscordTemplate,
  type DiscordImportApplyRequest,
  type DiscordImportPlan,
  type DiscordImportPreview,
  type DiscordImportPreviewRequest,
  type DiscordImportResult,
  type DiscordImportTarget,
  type DiscordTemplateSource,
} from '@backspace/shared/src/discordImport.js';
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, canManageRoleAt, hasPermissionBit, permissionsToString } from '@backspace/shared/src/permissions.js';
import { getDb, getRawDb, schema, type DBHandle } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { computePermissions, isMember, isSpaceOwner } from '../utils/permissions.js';
import { getHierarchyStanding } from '../utils/roleHierarchy.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { fetchDiscordTemplate } from '../utils/discordTemplateFetch.js';
import { recordAudit } from '../utils/auditLog.js';
import { spaceToWire } from '../utils/spaceWire.js';
import { connectionManager } from '../ws/handler.js';
import { generateInviteCode } from './spaces.js';

// Importing a Discord server template (docs/systems/spaces.md, "Importing a
// Discord template"): a preview that changes nothing, and the import, which
// plans again from the template (never from what a client sends back) and
// writes the whole plan in one transaction, so a failure leaves nothing
// behind.

/** Previews and imports a person may start in a minute: each may cost a request to Discord. */
const STARTS_PER_MINUTE = 10;
const starts = new Map<string, number[]>();

function tooManyStarts(userId: string, now: number): boolean {
  const recent = (starts.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= STARTS_PER_MINUTE) {
    starts.set(userId, recent);
    return true;
  }
  recent.push(now);
  starts.set(userId, recent);
  return false;
}

/** The template a request names (a code or link, or the template's own JSON), read and checked; or a refusal already sent. */
async function loadSource(body: { code?: unknown; template?: unknown }, reply: FastifyReply): Promise<DiscordTemplateSource | null> {
  let raw: unknown;
  let code: string | null = null;
  if (body.template !== undefined && body.template !== null) {
    raw = body.template;
  } else if (typeof body.code === 'string') {
    code = parseDiscordTemplateCode(body.code);
    if (!code) {
      sendError(reply, 400, 'discord_template_code_invalid');
      return null;
    }
    const fetched = await fetchDiscordTemplate(code);
    if (!fetched.ok) {
      sendError(reply, fetched.status, fetched.code, fetched.details);
      return null;
    }
    raw = fetched.data;
  } else {
    sendError(reply, 400, 'discord_template_code_invalid');
    return null;
  }
  const read = readDiscordTemplate(raw, code);
  if (!read.ok) {
    if (read.error === 'too_large') {
      const tooMany = read.kind === 'roles' ? 'discord_template_too_many_roles'
        : read.kind === 'channels' ? 'discord_template_too_many_channels'
          : 'discord_template_too_many_overwrites';
      sendError(reply, 413, tooMany, { max: read.max });
    } else {
      sendError(reply, 400, 'discord_template_invalid', { field: read.field });
    }
    return null;
  }
  return read.source;
}

/**
 * What the importer finds in an existing space, or a refusal already sent.
 * Importing adds roles, channels and overrides, so it takes what creating
 * each of them takes: the owner, or MANAGE_ROLES and MANAGE_CHANNELS.
 */
function existingTarget(spaceId: string, userId: string, reply: FastifyReply): DiscordImportTarget | null {
  const db = getDb();
  const space = db.select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) {
    sendError(reply, 404, 'space_not_found');
    return null;
  }
  const owner = isSpaceOwner(spaceId, userId);
  const held = computePermissions(userId, spaceId);
  if (!owner && (!isMember(spaceId, userId)
    || !hasPermissionBit(held, PermissionBits.MANAGE_ROLES)
    || !hasPermissionBit(held, PermissionBits.MANAGE_CHANNELS))) {
    sendError(reply, 403, 'import_target_forbidden');
    return null;
  }
  return {
    kind: 'existing',
    // An administrator holds every bit (hasPermissionBit), so nothing they
    // import is withheld; anyone else grants only what they hold. The role
    // hierarchy exempts only the owner and instance admins, as everywhere.
    grantsEveryBit: owner || hasPermissionBit(held, PermissionBits.ADMINISTRATOR),
    heldPermissions: held,
    standing: getHierarchyStanding(spaceId, userId),
    roles: db.select({ id: schema.roles.id, name: schema.roles.name, position: schema.roles.position }).from(schema.roles)
      .where(eq(schema.roles.spaceId, spaceId)).all()
      .filter((role) => role.id !== spaceId)
      .map((role) => ({ id: role.id, name: role.name, position: role.position ?? 0 })),
    categories: db.select({ id: schema.channelCategories.id, name: schema.channelCategories.name }).from(schema.channelCategories)
      .where(eq(schema.channelCategories.spaceId, spaceId)).all(),
    channels: db.select({ name: schema.channels.name, type: schema.channels.type, categoryId: schema.channels.categoryId }).from(schema.channels)
      .where(and(eq(schema.channels.spaceId, spaceId), ne(schema.channels.type, 'thread'))).all(),
  };
}

const NEW_SPACE_TARGET: DiscordImportTarget = {
  kind: 'new',
  grantsEveryBit: true,
  heldPermissions: ALL_PERMISSIONS,
  standing: { isOwner: true, isInstanceAdmin: false, topPosition: 0 },
  roles: [],
  categories: [],
  channels: [],
};

/**
 * A new role starts at the bottom, just above @everyone, so creating one takes
 * a role above that (POST /api/spaces/:id/roles answers the same), unless the
 * importer owns the space or administers the instance.
 */
function refusesRoleCreation(plan: DiscordImportPlan, target: DiscordImportTarget): boolean {
  return !canManageRoleAt(target.standing, 1) && plan.roles.some((role) => role.action === 'create');
}

/** A template's JSON may weigh as much as the limit, plus the request around it. */
const BODY_LIMIT = DISCORD_IMPORT_LIMITS.MAX_TEMPLATE_BYTES + 64 * 1024;

function previewOf(source: DiscordTemplateSource, plan: DiscordImportPlan): DiscordImportPreview {
  return {
    template: {
      code: source.code,
      name: source.name,
      description: source.description,
      guildName: source.guildName,
      usageCount: source.usageCount,
      creatorName: source.creatorName,
      updatedAt: source.updatedAt,
    },
    plan,
    notTransferred: DISCORD_NOT_TRANSFERRED,
  };
}

/** The next free position in a list of rows with positions. */
function nextPosition(rows: ReadonlyArray<{ position: number | null }>): number {
  return rows.reduce((max, row) => Math.max(max, (row.position ?? 0) + 1), 0);
}

/**
 * Writes `plan` into `spaceId` inside `tx` (the transaction of the caller).
 * New roles go below the space's existing ones, in the template's order; new
 * categories and channels after the existing ones. Answers what was made.
 */
function writePlan(
  tx: DBHandle,
  spaceId: string,
  plan: DiscordImportPlan,
  now: number,
): { roles: number; categories: number; channels: number; overrides: number } {
  const created = { roles: 0, categories: 0, channels: 0, overrides: 0 };
  const roleIds = new Map<string, string>();

  // Roles. The template lists them from the bottom; new ones take positions
  // 1..n under every role the space already has, which move up by n.
  const newRoles = plan.roles.filter((role) => role.action === 'create');
  if (newRoles.length > 0) {
    tx.update(schema.roles)
      .set({ position: sql`${schema.roles.position} + ${newRoles.length}` })
      .where(and(eq(schema.roles.spaceId, spaceId), ne(schema.roles.id, spaceId)))
      .run();
  }
  let position = 1;
  for (const role of plan.roles) {
    if (role.everyone) {
      roleIds.set(role.key, spaceId);
      if (role.action === 'update_everyone') {
        tx.update(schema.roles).set({ permissions: role.permissions })
          .where(and(eq(schema.roles.id, spaceId), eq(schema.roles.spaceId, spaceId))).run();
      }
      continue;
    }
    if (role.action === 'reuse' && role.existingRoleId) {
      roleIds.set(role.key, role.existingRoleId);
      continue;
    }
    const id = generateSnowflake();
    tx.insert(schema.roles).values({
      id,
      spaceId,
      name: role.name,
      color: role.color,
      icon: role.icon,
      hoist: role.hoist ? 1 : 0,
      mentionable: role.mentionable ? 1 : 0,
      position,
      permissions: role.permissions,
      createdAt: now,
    }).run();
    roleIds.set(role.key, id);
    position += 1;
    created.roles += 1;
  }

  // Categories.
  const categoryIds = new Map<string, string>();
  let categoryPosition = nextPosition(tx.select({ position: schema.channelCategories.position }).from(schema.channelCategories)
    .where(eq(schema.channelCategories.spaceId, spaceId)).all());
  for (const category of plan.categories) {
    if (category.action === 'reuse' && category.existingCategoryId) {
      categoryIds.set(category.key, category.existingCategoryId);
      continue;
    }
    const id = generateSnowflake();
    tx.insert(schema.channelCategories).values({ id, spaceId, name: category.name, position: categoryPosition, createdAt: now }).run();
    categoryPosition += 1;
    categoryIds.set(category.key, id);
    created.categories += 1;
    for (const override of category.overrides) {
      const targetId = roleIds.get(override.roleKey);
      if (!targetId) continue;
      tx.insert(schema.categoryOverrides).values({ categoryId: id, targetType: 'role', targetId, allow: override.allow, deny: override.deny }).run();
      created.overrides += 1;
    }
  }

  // Channels: after what each category (or the uncategorised list) already holds.
  const positions = new Map<string, number>();
  for (const row of tx.select({ categoryId: schema.channels.categoryId, position: schema.channels.position }).from(schema.channels)
    .where(eq(schema.channels.spaceId, spaceId)).all()) {
    const key = row.categoryId ?? '';
    positions.set(key, Math.max(positions.get(key) ?? 0, (row.position ?? 0) + 1));
  }
  for (const channel of plan.channels) {
    if (channel.action !== 'create') continue;
    const categoryId = channel.categoryKey !== null ? categoryIds.get(channel.categoryKey) ?? null : null;
    const slot = categoryId ?? '';
    const channelPosition = positions.get(slot) ?? 0;
    positions.set(slot, channelPosition + 1);
    const id = generateSnowflake();
    tx.insert(schema.channels).values({
      id,
      spaceId,
      name: channel.name,
      type: channel.type,
      topic: channel.topic,
      position: channelPosition,
      categoryId,
      slowmodeSeconds: channel.slowmodeSeconds,
      createdAt: now,
    }).run();
    created.channels += 1;
    for (const override of channel.overrides) {
      const targetId = roleIds.get(override.roleKey);
      if (!targetId) continue;
      tx.insert(schema.channelOverrides).values({ channelId: id, targetType: 'role', targetId, allow: override.allow, deny: override.deny }).run();
      created.overrides += 1;
    }
  }
  return created;
}

export async function discordImportRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/import/discord/preview — the plan, changing nothing.
  app.post<{ Body: DiscordImportPreviewRequest }>('/api/import/discord/preview', {
    preHandler: authenticate,
    bodyLimit: BODY_LIMIT,
  }, async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(reply, 400, 'validation_failed');
    if (tooManyStarts(request.userId, Date.now())) return sendError(reply, 429, 'rate_limited');
    const spaceId = body.spaceId;
    if (spaceId !== undefined && typeof spaceId !== 'string') return sendError(reply, 400, 'validation_failed');
    // Who may import is settled before anything is asked of Discord.
    if (spaceId !== undefined && !existingTarget(spaceId, request.userId, reply)) return reply;
    const source = await loadSource(body, reply);
    if (!source) return reply;
    // The space as it is now, after the wait for Discord.
    const target = spaceId !== undefined ? existingTarget(spaceId, request.userId, reply) : NEW_SPACE_TARGET;
    if (!target) return reply;
    const plan = planDiscordImport(source, target);
    if (refusesRoleCreation(plan, target)) return sendError(reply, 403, 'role_hierarchy');
    return reply.code(200).send(previewOf(source, plan));
  });

  // POST /api/import/discord/apply — the import.
  app.post<{ Body: DiscordImportApplyRequest }>('/api/import/discord/apply', {
    preHandler: authenticate,
    bodyLimit: BODY_LIMIT,
  }, async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.target || typeof body.target !== 'object') {
      return sendError(reply, 400, 'validation_failed');
    }
    if (tooManyStarts(request.userId, Date.now())) return sendError(reply, 429, 'rate_limited');
    if (body.target.kind !== 'existing' && accountNeedsVerifiedEmail(request.userId)) return sendError(reply, 403, 'email_verification_required');
    const db = getDb();
    const now = Date.now();

    if (body.target.kind === 'existing') {
      const spaceId = body.target.spaceId;
      if (typeof spaceId !== 'string') return sendError(reply, 400, 'validation_failed');
      if (!existingTarget(spaceId, request.userId, reply)) return reply;
      const source = await loadSource(body, reply);
      if (!source) return reply;
      // Read the space again after the wait for Discord, and plan and write
      // with nothing awaited in between, so the plan matches what it writes to.
      const target = existingTarget(spaceId, request.userId, reply);
      if (!target) return reply;
      const plan = planDiscordImport(source, target);
      if (refusesRoleCreation(plan, target)) return sendError(reply, 403, 'role_hierarchy');
      let created: ReturnType<typeof writePlan>;
      try {
        created = db.transaction((tx) => writePlan(tx, spaceId, plan, now));
      } catch (err) {
        request.log.error({ err }, '[discordImport] import into an existing space failed');
        return sendError(reply, 500, 'internal_error');
      }
      const changes: AuditLogChange[] = [
        { key: 'template', to: source.name },
        { key: 'roles', to: created.roles },
        { key: 'categories', to: created.categories },
        { key: 'channels', to: created.channels },
      ];
      recordAudit({ spaceId, actorId: request.userId, action: 'template_import', targetType: 'space', targetId: spaceId, targetLabel: source.name, changes });
      // Every member's view of the space's channels and roles may change.
      const members = getRawDb().prepare('SELECT user_id FROM space_members WHERE space_id = ?').all(spaceId) as Array<{ user_id: string }>;
      connectionManager.announceSpaceAccessChange(spaceId, members.map((row) => row.user_id));
      const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
      if (!space) return sendError(reply, 404, 'space_not_found');
      const result: DiscordImportResult = { space: spaceToWire(space), plan };
      return reply.code(200).send(result);
    }

    if (body.target.kind !== 'new') return sendError(reply, 400, 'validation_failed');
    const limitBefore = spaceLimitReached(request.userId);
    if (limitBefore !== null) return sendError(reply, 409, 'space_limit_reached', { max: limitBefore });
    const source = await loadSource(body, reply);
    if (!source) return reply;
    // Asked again after the wait for Discord, with nothing awaited before the write.
    const limitAfter = spaceLimitReached(request.userId);
    if (limitAfter !== null) return sendError(reply, 409, 'space_limit_reached', { max: limitAfter });
    const plan = planDiscordImport(source, NEW_SPACE_TARGET);
    const requestedName = typeof body.target.name === 'string' ? body.target.name.trim() : '';
    const name = (requestedName || source.guildName).slice(0, 100);
    const spaceId = generateSnowflake();
    try {
      db.transaction((tx) => {
        tx.insert(schema.spaces).values({
          id: spaceId,
          name,
          icon: null,
          banner: null,
          avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
          ownerId: request.userId,
          inviteCode: generateInviteCode(),
          visibility: 'private',
          description: source.description ? source.description.slice(0, 200) : null,
          createdAt: now,
        }).run();
        tx.insert(schema.spaceMembers).values({ spaceId, userId: request.userId, joinedAt: now }).run();
        tx.insert(schema.roles).values({
          id: spaceId,
          spaceId,
          name: '@everyone',
          color: '#b9bbbe',
          position: 0,
          permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS),
          hoist: 0,
          createdAt: now,
        }).run();
        writePlan(tx, spaceId, plan, now);
      });
    } catch (err) {
      request.log.error({ err }, '[discordImport] import into a new space failed');
      return sendError(reply, 500, 'space_create_failed');
    }
    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
    if (!space) return sendError(reply, 500, 'space_create_failed');
    // The creator is in the space now; their sessions hear its events from here on.
    connectionManager.addUserSpace(request.userId, spaceId);
    const result: DiscordImportResult = { space: spaceToWire(space), plan };
    return reply.code(201).send(result);
  });
}
