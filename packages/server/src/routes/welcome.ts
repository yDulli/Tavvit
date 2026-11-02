import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { WELCOME_LIMITS, type SpaceWelcome, type SpaceWelcomeRequest } from '@backspace/shared/src/welcome.js';
import { getDb, schema } from '../db/index.js';
import { recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { computePermissions, getMember, hasPermission, PermissionBits } from '../utils/permissions.js';
import { mustAcceptRules } from '../utils/spaceModeration.js';
import { connectionManager } from '../ws/handler.js';

function storedChannelIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** The space's welcome as this reader sees it: only channels they can see. */
function welcomeFor(spaceId: string, userId: string): SpaceWelcome | null {
  const db = getDb();
  const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) return null;
  const member = getMember(spaceId, userId);
  const channels = storedChannelIds(space.welcomeChannelIds).flatMap((id) => {
    const channel = db.select({ id: schema.channels.id, name: schema.channels.name, spaceId: schema.channels.spaceId })
      .from(schema.channels).where(eq(schema.channels.id, id)).get();
    if (!channel || channel.spaceId !== spaceId) return [];
    const permissions = computePermissions(userId, spaceId, id);
    return (permissions & (PermissionBits.VIEW_CHANNEL | PermissionBits.ADMINISTRATOR)) !== 0n ? [{ id: channel.id, name: channel.name }] : [];
  });
  return {
    welcomeText: space.welcomeText,
    rulesText: space.rulesText,
    rulesRequired: space.rulesRequiredSince !== null,
    channels,
    mustAccept: member ? mustAcceptRules(spaceId, member) : false,
    acceptedAt: member?.rulesAcceptedAt ?? null,
  };
}

export async function welcomeRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/spaces/:id/welcome - What the space says to its members
  app.get<{ Params: { id: string } }>('/api/spaces/:id/welcome', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    if (!hasPermission(request.userId, id, PermissionBits.VIEW_CHANNEL)) return sendError(reply, 403, 'not_space_member');
    const welcome = welcomeFor(id, request.userId);
    if (!welcome) return sendError(reply, 404, 'not_found');
    return reply.code(200).send(welcome);
  });

  // PUT /api/spaces/:id/welcome - Set it
  app.put<{ Params: { id: string }; Body: SpaceWelcomeRequest }>('/api/spaces/:id/welcome', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    const db = getDb();
    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) return sendError(reply, 404, 'not_found');

    const { welcomeText, rulesText, rulesRequired, channelIds } = request.body ?? {};
    const clean = (value: unknown, max: number): string | null | undefined => {
      if (value === undefined || value === null || value === '') return null;
      if (typeof value !== 'string' || value.length > max) return undefined;
      return value.trim() || null;
    };
    const welcome = clean(welcomeText, WELCOME_LIMITS.WELCOME_MAX_LENGTH);
    if (welcome === undefined) return sendError(reply, 400, 'validation_failed', { field: 'welcomeText' });
    const rules = clean(rulesText, WELCOME_LIMITS.RULES_MAX_LENGTH);
    if (rules === undefined) return sendError(reply, 400, 'validation_failed', { field: 'rulesText' });
    if (rulesRequired === true && !rules) return sendError(reply, 400, 'validation_failed', { field: 'rulesRequired' });

    const ids = Array.isArray(channelIds) ? [...new Set(channelIds)] : [];
    if (ids.length > WELCOME_LIMITS.CHANNELS_MAX || ids.some((channelId) => typeof channelId !== 'string')) {
      return sendError(reply, 400, 'validation_failed', { field: 'channelIds' });
    }
    for (const channelId of ids) {
      const channel = db.select({ spaceId: schema.channels.spaceId, type: schema.channels.type }).from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel || channel.spaceId !== id || channel.type === 'thread') return sendError(reply, 400, 'validation_failed', { field: 'channelIds' });
    }

    const wantRequired = rulesRequired === true;
    const now = Date.now();
    db.update(schema.spaces).set({
      welcomeText: welcome,
      rulesText: rules,
      welcomeChannelIds: ids.length > 0 ? JSON.stringify(ids) : null,
      // Turning it on now means from now on: who is there already is not locked out.
      rulesRequiredSince: wantRequired ? (space.rulesRequiredSince ?? now) : null,
    }).where(eq(schema.spaces.id, id)).run();
    recordAudit({ spaceId: id, actorId: request.userId, action: 'welcome_update', targetType: 'space', targetId: id, targetLabel: space.name });
    connectionManager.sendToSpace(id, { type: 'space_welcome_changed', spaceId: id });
    return reply.code(200).send(welcomeFor(id, request.userId));
  });

  // POST /api/spaces/:id/rules/accept - Agree to the rules
  app.post<{ Params: { id: string } }>('/api/spaces/:id/rules/accept', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    if (!getMember(id, request.userId)) return sendError(reply, 403, 'not_space_member');
    getDb().update(schema.spaceMembers).set({ rulesAcceptedAt: Date.now() })
      .where(and(eq(schema.spaceMembers.spaceId, id), eq(schema.spaceMembers.userId, request.userId)))
      .run();
    return reply.code(200).send(welcomeFor(id, request.userId));
  });
}
