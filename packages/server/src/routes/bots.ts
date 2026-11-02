import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { withoutUnsafeCharacters } from '@backspace/shared/src/profileFields.js';
import { isVisibleSingleLine } from '@backspace/shared/src/constants.js';
import {
  BOT_LIMITS,
  cleanCommand,
  cleanCommandInput,
  type AdminBotInfo,
  type BotCommand,
  type BotCommandOption,
  type BotDetail,
  type BotInfo,
  type BotPublicInfo,
  type BotsResponse,
  type BotWithToken,
  type ChannelCommand,
} from '@backspace/shared/src/bots.js';
import { parsePermissionString, permissionsToString, roleBitsChangeRefusal } from '@backspace/shared/src/permissions.js';
import { MAX_MESSAGE_LENGTH } from '@backspace/shared';
import { cardImageIds, cardsSummary, cardWords, cleanCards, type MessageCard } from '@backspace/shared/src/cards.js';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { interactionFor, openInteraction } from '../utils/botInteractions.js';
import { deleteAttachmentByFilename, deleteUploadFile } from '../utils/fileCleanup.js';
import { withoutMentions } from '../utils/neutralMentions.js';
import { pictureFileReleasable, profilePictureOf, uploadNameOf } from '../utils/profileImageRefs.js';
import { resizeProfileImage } from '../utils/thumbnail.js';
import { postChannelMessage } from './messages.js';
import { recordAudit } from '../utils/auditLog.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { botsEnabled, createBotAccount, newBotToken } from '../utils/botAccess.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { sendError } from '../utils/httpErrors.js';
import { mayPostSticker } from '../utils/remoteMedia.js';
import { computePermissions, getChannelSpaceId, hasPermission, isBanned, isMember, PermissionBits } from '../utils/permissions.js';
import { recordPlatformAudit } from '../utils/platformAudit.js';
import { normalizeRolePositions } from '../db/rolePositions.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { automodRefusal, memberActionRefusal, spaceMessageRefusal } from '../utils/spaceModeration.js';
import { memberToWire } from '../utils/spaceWire.js';
import { tombstoneUser } from '../utils/userDeletion.js';
import { connectionManager } from '../ws/handler.js';

type BotRow = typeof schema.bots.$inferSelect;

const ADMIN = { preHandler: [authenticate, requireAdmin] };
/** How often one person can invoke commands. */
const commandLimit = createFixedWindowLimit({ max: 10, windowMs: 10_000 });

export function _resetCommandLimitForTests(): void {
  commandLimit.reset();
}

/** The bot's name as shown, also for its role: a name stored before such characters were refused loses them. */
function nameOf(botId: string): string {
  const row = getDb().select({ displayName: schema.users.displayName, username: schema.users.username })
    .from(schema.users).where(eq(schema.users.id, botId)).get();
  return withoutUnsafeCharacters(row?.displayName || row?.username || '');
}

/** What it looks like wherever it is shown: its picture, or its colour without one. */
const faceOf = (botId: string): { avatar: string | null; avatarColor: string | null } => {
  const row = getDb().select({ avatar: schema.users.avatar, avatarColor: schema.users.avatarColor })
    .from(schema.users).where(eq(schema.users.id, botId)).get();
  return { avatar: row?.avatar ?? null, avatarColor: row?.avatarColor ?? null };
};

function toInfo(row: BotRow): BotInfo {
  return { id: row.id, name: nameOf(row.id), ...faceOf(row.id), description: row.description, ownerId: row.ownerId, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt };
}

/** The options a command keeps as JSON. A row the server wrote itself, so it is read, not checked again. */
function optionsOf(stored: string | null): BotCommandOption[] | undefined {
  if (!stored) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as BotCommandOption[]) : undefined;
  } catch {
    return undefined;
  }
}

function commandFrom(row: typeof schema.botCommands.$inferSelect): BotCommand {
  const options = optionsOf(row.options);
  return { name: row.name, description: row.description, ...(options ? { options } : {}) };
}

/**
 * A bot's name as stored, or null when the value is not one: trimmed, at most NAME_MAX_LENGTH,
 * and following the rule nicknames follow (no control character, line break or bidirectional
 * control, something visible). It is shown as the bot's name and as its role's in each space.
 */
const cleanName = (value: unknown): string | null => {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= BOT_LIMITS.NAME_MAX_LENGTH && isVisibleSingleLine(name) ? name : null;
};

/** The text as stored; undefined when it is too long or no text. */
const cleanDescription = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > BOT_LIMITS.DESCRIPTION_MAX_LENGTH) return undefined;
  return value.trim() || null;
};

const botOf = (id: string): BotRow | undefined => getDb().select().from(schema.bots).where(eq(schema.bots.id, id)).get();

/** Ends a bot: its token stops, it leaves every space, and what it wrote stays under a deleted account. */
export function retireBot(botId: string): void {
  getDb().delete(schema.roles).where(eq(schema.roles.botId, botId)).run();
  getDb().delete(schema.bots).where(eq(schema.bots.id, botId)).run();
  tombstoneUser(botId, { purgeContent: false });
  connectionManager.forceDisconnectUser(botId, { reason: 'Bot retired', endPresence: true });
}

export async function botRoutes(app: FastifyInstance): Promise<void> {
  // ─── What an owner does. None of this is open to a bot's own token. ───

  app.get('/api/bots', { preHandler: authenticate }, async (request, reply) => {
    const rows = getDb().select().from(schema.bots).where(eq(schema.bots.ownerId, request.userId)).orderBy(asc(schema.bots.createdAt)).all();
    const response: BotsResponse = { enabled: botsEnabled(), bots: rows.map(toInfo) };
    return reply.code(200).send(response);
  });

  app.post<{ Body: { name?: unknown; description?: unknown } }>('/api/bots', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!botsEnabled()) return sendError(reply, 403, 'bots_disabled');
    const name = cleanName(request.body?.name);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    const description = cleanDescription(request.body?.description);
    if (description === undefined) return sendError(reply, 400, 'validation_failed', { field: 'description' });
    const db = getDb();
    const owned = db.select({ count: sql<number>`count(*)` }).from(schema.bots).where(eq(schema.bots.ownerId, request.userId)).get()?.count ?? 0;
    if (owned >= BOT_LIMITS.PER_OWNER) return sendError(reply, 400, 'bot_limit_reached', { max: BOT_LIMITS.PER_OWNER });

    const botId = generateSnowflake();
    const { token, hash } = newBotToken(botId);
    const now = Date.now();
    db.transaction((tx) => {
      createBotAccount(tx, botId, name, now);
      tx.insert(schema.bots).values({ id: botId, ownerId: request.userId, description, tokenHash: hash, createdAt: now }).run();
    });
    const row = botOf(botId);
    if (!row) return sendError(reply, 500, 'internal_error');
    const created: BotWithToken = { bot: toInfo(row), token };
    return reply.code(201).send(created);
  });

  /** A bot this person owns, or undefined: someone else's looks the same as none at all. */
  const owned = (botId: string, userId: string): BotRow | undefined => {
    const row = botOf(botId);
    return row?.ownerId === userId ? row : undefined;
  };

  // GET /api/bots/:id - What the developer portal shows of one's own bot
  app.get<{ Params: { id: string } }>('/api/bots/:id', { preHandler: authenticate }, async (request, reply) => {
    const row = owned(request.params.id, request.userId);
    if (!row) return sendError(reply, 404, 'bot_not_found');
    const db = getDb();
    const commands = db.select().from(schema.botCommands).where(eq(schema.botCommands.botId, row.id)).orderBy(asc(schema.botCommands.name)).all();
    const spaces = db.select({ id: schema.spaces.id, name: schema.spaces.name }).from(schema.spaceMembers)
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.spaceMembers.spaceId))
      .where(eq(schema.spaceMembers.userId, row.id)).all();
    const detail: BotDetail = { ...toInfo(row), commands: commands.map(commandFrom), spaces };
    return reply.code(200).send(detail);
  });

  app.patch<{ Params: { id: string }; Body: { name?: unknown; description?: unknown; avatar?: unknown } }>('/api/bots/:id', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const row = owned(request.params.id, request.userId);
    if (!row) return sendError(reply, 404, 'bot_not_found');
    const name = cleanName(request.body?.name);
    if (!name) return sendError(reply, 400, 'validation_failed', { field: 'name' });
    const description = cleanDescription(request.body?.description);
    if (description === undefined) return sendError(reply, 400, 'validation_failed', { field: 'description' });
    const db = getDb();

    // Its picture is its owner's upload. Never one at an address elsewhere: every member who
    // reads the bot would ask that server for it.
    const oldAvatar = faceOf(row.id).avatar;
    const asked = request.body?.avatar;
    const elsewhere = typeof asked === 'string' && /^https?:/i.test(asked.trim());
    const picture = asked === undefined || elsewhere ? null : profilePictureOf(asked, request.userId, oldAvatar);
    if (elsewhere || (asked !== undefined && !picture)) return sendError(reply, 400, 'avatar_url_invalid');
    // Written anew before the bot shows it, and refused when it cannot be (utils/thumbnail.ts).
    if (picture?.upload && !(await resizeProfileImage(path.join(config.uploadDir, picture.upload), 'avatar'))) {
      return sendError(reply, 400, 'profile_image_invalid');
    }

    db.transaction((tx) => {
      tx.update(schema.users).set({ displayName: name, ...(picture ? { avatar: picture.stored } : {}) }).where(eq(schema.users.id, row.id)).run();
      tx.update(schema.bots).set({ description }).where(eq(schema.bots.id, row.id)).run();
    });

    if (picture) {
      // Handled as a person's own picture is (routes/users.ts): the replaced file goes once nothing
      // shows it, and the new one's upload record goes, so it counts on nobody's storage.
      const replaced = uploadNameOf(oldAvatar);
      if (replaced && replaced !== uploadNameOf(picture.stored) && pictureFileReleasable(replaced)) {
        deleteUploadFile(replaced);
        deleteAttachmentByFilename(replaced);
      }
      if (picture.upload) deleteAttachmentByFilename(picture.upload);
    }

    const updated = botOf(row.id);
    return reply.code(200).send(updated ? toInfo(updated) : toInfo(row));
  });

  // A new token: the old one stops at once, and a connected bot is sent away.
  app.post<{ Params: { id: string } }>('/api/bots/:id/token', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const row = owned(request.params.id, request.userId);
    if (!row) return sendError(reply, 404, 'bot_not_found');
    const { token, hash } = newBotToken(row.id);
    getDb().update(schema.bots).set({ tokenHash: hash }).where(eq(schema.bots.id, row.id)).run();
    connectionManager.forceDisconnectUser(row.id, { reason: 'Token replaced', endPresence: true });
    const rotated: BotWithToken = { bot: toInfo(row), token };
    return reply.code(200).send(rotated);
  });

  app.delete<{ Params: { id: string } }>('/api/bots/:id', { preHandler: authenticate }, async (request, reply) => {
    const row = owned(request.params.id, request.userId);
    if (!row) return sendError(reply, 404, 'bot_not_found');
    retireBot(row.id);
    return reply.code(200).send({ success: true });
  });

  // ─── Bringing a bot into a space ───

  app.get<{ Params: { id: string } }>('/api/bots/:id/public', { preHandler: authenticate }, async (request, reply) => {
    if (!botsEnabled()) return sendError(reply, 403, 'bots_disabled');
    const row = botOf(request.params.id);
    if (!row) return sendError(reply, 404, 'bot_not_found');
    const spaces = getDb().select({ id: schema.spaces.id, name: schema.spaces.name }).from(schema.spaceMembers)
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.spaceMembers.spaceId))
      .where(eq(schema.spaceMembers.userId, request.userId)).all()
      .filter((space) => hasPermission(request.userId, space.id, PermissionBits.MANAGE_SPACE));
    const info: BotPublicInfo = { id: row.id, name: nameOf(row.id), ...faceOf(row.id), description: row.description, ownerName: nameOf(row.ownerId), spaces };
    return reply.code(200).send(info);
  });

  // Whoever may manage a space lets a bot in, with its own role. It can hold only what they hold,
  // and never ADMINISTRATOR, so nobody can hand a program more than they could use themselves.
  app.post<{ Params: { id: string; spaceId: string }; Body: { permissions?: unknown } }>('/api/bots/:id/spaces/:spaceId', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id, spaceId } = request.params;
    if (!botsEnabled()) return sendError(reply, 403, 'bots_disabled');
    const row = botOf(id);
    if (!row) return sendError(reply, 404, 'bot_not_found');
    if (!hasPermission(request.userId, spaceId, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }
    if (isBanned(spaceId, id)) return sendError(reply, 403, 'bot_banned');
    if (isMember(spaceId, id)) return sendError(reply, 409, 'bot_already_member');

    const requested = parsePermissionString(request.body?.permissions);
    if (requested === null) return sendError(reply, 400, 'permissions_invalid');
    if ((requested & PermissionBits.ADMINISTRATOR) !== 0n) return sendError(reply, 403, 'bot_admin_forbidden');
    const refusal = roleBitsChangeRefusal(computePermissions(request.userId, spaceId), 0n, requested);
    if (refusal) return sendError(reply, 403, refusal);

    const db = getDb();
    const now = Date.now();
    const name = nameOf(id).slice(0, 32);
    const existing = db.select().from(schema.roles).where(and(eq(schema.roles.spaceId, spaceId), eq(schema.roles.botId, id))).get();
    const roleId = existing?.id ?? generateSnowflake();
    db.transaction((tx) => {
      if (existing) {
        tx.update(schema.roles).set({ permissions: permissionsToString(requested) }).where(eq(schema.roles.id, roleId)).run();
      } else {
        const free = tx.select({ id: schema.roles.id }).from(schema.roles)
          .where(and(eq(schema.roles.spaceId, spaceId), sql`${schema.roles.name} = ${name} COLLATE NOCASE`)).get();
        tx.insert(schema.roles).values({
          id: roleId,
          spaceId,
          botId: id,
          // Role names are unique in a space, and a person's role may already have this one.
          name: free ? `${name.slice(0, 24)} (bot)` : name,
          // Its role is what it may do, not a group of people to list it under.
          hoist: 0,
          position: 0,
          permissions: permissionsToString(requested),
          createdAt: now,
        }).run();
      }
      // The rules of a space are for people to read; whoever let it in answers for it.
      tx.insert(schema.spaceMembers).values({ spaceId, userId: id, joinedAt: now, rulesAcceptedAt: now }).run();
      tx.insert(schema.memberRoles).values({ spaceId, userId: id, roleId }).onConflictDoNothing().run();
    });
    normalizeRolePositions(getRawDb(), spaceId);
    recordAudit({ spaceId, actorId: request.userId, action: 'bot_add', targetType: 'member', targetId: id, targetLabel: name });

    connectionManager.addUserSpace(id, spaceId);
    const account = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    const role = db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).get();
    if (account && role) {
      connectionManager.sendToSpace(spaceId, {
        type: 'member_joined',
        spaceId,
        member: memberToWire(
          { spaceId, userId: id, nickname: null, joinedAt: now, timedOutUntil: null, avatar: null, banner: null, bio: null },
          account,
          [],
          now,
        ),
      });
    }
    connectionManager.announceSpaceAccessChange(spaceId, [id]);
    return reply.code(200).send({ success: true, roleId });
  });

  // ─── What a bot's own token may do, besides the channel and member routes ───

  // GET /api/bots/@me - Who this bot is, and which spaces it is in
  app.get('/api/bots/@me', { preHandler: authenticate, config: { botAllowed: true } }, async (request, reply) => {
    const row = botOf(request.userId);
    if (!row) return sendError(reply, 403, 'bot_route_forbidden');
    const spaces = getDb().select({ id: schema.spaces.id, name: schema.spaces.name }).from(schema.spaceMembers)
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.spaceMembers.spaceId))
      .where(eq(schema.spaceMembers.userId, row.id)).all();
    return reply.code(200).send({ bot: toInfo(row), spaces });
  });

  // PUT /api/bots/@me/commands - The commands this bot answers to, all of them
  app.put<{ Body: { commands?: unknown } }>('/api/bots/@me/commands', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const row = botOf(request.userId);
    if (!row) return sendError(reply, 403, 'bot_route_forbidden');
    const asked = request.body?.commands;
    if (!Array.isArray(asked) || asked.length > BOT_LIMITS.COMMANDS_PER_BOT) return sendError(reply, 400, 'validation_failed', { field: 'commands' });
    const commands = asked.map(cleanCommand);
    if (commands.some((command) => command === null)) return sendError(reply, 400, 'validation_failed', { field: 'commands' });
    const names = new Set(commands.map((command) => command?.name));
    if (names.size !== commands.length) return sendError(reply, 400, 'validation_failed', { field: 'commands' });
    getDb().transaction((tx) => {
      tx.delete(schema.botCommands).where(eq(schema.botCommands.botId, row.id)).run();
      for (const command of commands) {
        if (command) {
          tx.insert(schema.botCommands).values({
            botId: row.id,
            name: command.name,
            description: command.description,
            options: command.options ? JSON.stringify(command.options) : null,
          }).run();
        }
      }
    });
    return reply.code(200).send({ commands });
  });

  // ─── Commands, from a person's side ───

  // GET /api/channels/:id/commands - What the bots in this channel answer to
  app.get<{ Params: { id: string } }>('/api/channels/:id/commands', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'SEND_MESSAGES' });
    }
    if (!botsEnabled()) return reply.code(200).send({ commands: [] });
    const rows = getDb().select().from(schema.botCommands)
      .innerJoin(schema.spaceMembers, eq(schema.spaceMembers.userId, schema.botCommands.botId))
      .where(eq(schema.spaceMembers.spaceId, spaceId)).all();
    const commands: ChannelCommand[] = rows
      .filter((row) => hasPermission(row.bot_commands.botId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, id))
      .map((row) => ({ ...commandFrom(row.bot_commands), botId: row.bot_commands.botId, botName: nameOf(row.bot_commands.botId) }));
    return reply.code(200).send({ commands });
  });

  // POST /api/channels/:id/commands/:botId/:name - Ask a bot. It answers by writing in the channel,
  // under its own rights. Nothing is posted in the person's name.
  app.post<{ Params: { id: string; botId: string; name: string }; Body: { args?: unknown; options?: unknown } }>('/api/channels/:id/commands/:botId/:name', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, botId, name } = request.params;
    const spaceId = getChannelSpaceId(id);
    if (!spaceId) return sendError(reply, 404, 'channel_not_found');
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'SEND_MESSAGES' });
    }
    const held = memberActionRefusal(spaceId, request.userId);
    if (held) return sendError(reply, held.status, held.code, held.details);
    if (!botsEnabled()) return sendError(reply, 403, 'bots_disabled');
    const args = request.body?.args === undefined ? '' : request.body.args;
    if (typeof args !== 'string' || args.length > BOT_LIMITS.COMMAND_ARGS_MAX_LENGTH) return sendError(reply, 400, 'validation_failed', { field: 'args' });

    const db = getDb();
    const known = db.select().from(schema.botCommands).where(and(eq(schema.botCommands.botId, botId), eq(schema.botCommands.name, name))).get();
    if (!known || !isMember(spaceId, botId) || !hasPermission(botId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, id)) {
      return sendError(reply, 404, 'bot_command_not_found');
    }
    if (!commandLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');
    if (!connectionManager.isUserConnected(botId)) return sendError(reply, 409, 'bot_offline');

    // What it asks for, checked here so that a bot need not trust what reaches it.
    const definition = optionsOf(known.options) ?? [];
    const filled = cleanCommandInput(definition, request.body?.options);
    if ('option' in filled) return sendError(reply, 400, 'command_option_invalid', { option: filled.option });
    for (const option of definition) {
      const value = filled.values[option.name];
      if (value === undefined) continue;
      const exists = option.type === 'person' ? isMember(spaceId, String(value))
        : option.type === 'channel' ? getChannelSpaceId(String(value)) === spaceId && hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL, String(value))
          : option.type === 'role' ? db.select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.id, String(value)), eq(schema.roles.spaceId, spaceId))).get() !== undefined
            : true;
      if (!exists) return sendError(reply, 400, 'command_option_invalid', { option: option.name });
    }

    const person = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!person) return sendError(reply, 500, 'internal_error');
    connectionManager.sendToUser(botId, {
      type: 'command_invoked',
      name,
      args: args.trim(),
      options: filled.values,
      interactionId: openInteraction({ botId, channelId: id, spaceId, userId: request.userId }),
      channelId: id,
      spaceId,
      user: sanitizeUser(person),
    });
    return reply.code(200).send({ success: true });
  });

  // POST /api/interactions/:id/reply - A bot answers a command it was asked: in the channel like
  // any message of its own, or for the person who asked alone, which nobody else hears of and
  // nothing keeps. Only the bot that was asked can answer, and only for a while.
  app.post<{ Params: { id: string }; Body: { content?: unknown; cards?: unknown; ephemeral?: unknown } }>('/api/interactions/:id/reply', {
    preHandler: authenticate,
    config: { botAllowed: true },
  }, async (request, reply) => {
    const interaction = interactionFor(request.params.id, request.userId);
    if (!interaction) return sendError(reply, 404, 'interaction_not_found');
    if (interaction.replies >= BOT_LIMITS.REPLIES_PER_INTERACTION) return sendError(reply, 429, 'rate_limited');
    const { channelId, spaceId, userId } = interaction;
    if (!hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES, channelId)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'SEND_MESSAGES' });
    }

    const given = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
    if (given.length > MAX_MESSAGE_LENGTH) return sendError(reply, 400, 'content_too_long', { max: MAX_MESSAGE_LENGTH });
    if (!mayPostSticker(given, request.userId)) return sendError(reply, 400, 'sticker_elsewhere');
    let cards: MessageCard[] = [];
    if (request.body?.cards !== undefined) {
      const cleaned = cleanCards(request.body.cards, withoutMentions);
      if ('field' in cleaned) return sendError(reply, 400, 'cards_invalid', { field: cleaned.field });
      // Nothing can be attached here: an answer is words and cards.
      if (cardImageIds(cleaned.cards).size > 0) return sendError(reply, 400, 'cards_invalid', { field: 'imageAttachmentId' });
      cards = cleaned.cards;
    }
    if (!given && cards.length === 0) return sendError(reply, 400, 'message_empty');
    const now = Date.now();
    const words = cards.length > 0 ? `${cardWords(cards)}\n${given}` : given;

    if (request.body?.ephemeral === true) {
      const refusal = automodRefusal(spaceId, words);
      if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
      interaction.replies += 1;
      connectionManager.sendToUser(userId, {
        type: 'command_reply',
        id: generateSnowflake(),
        channelId,
        spaceId,
        botId: request.userId,
        botName: nameOf(request.userId),
        botAvatar: faceOf(request.userId).avatar,
        botAvatarColor: faceOf(request.userId).avatarColor,
        // Nobody is alerted by what only one person sees.
        content: given ? withoutMentions(given) : null,
        ...(cards.length > 0 ? { cards } : {}),
        createdAt: now,
      });
      return reply.code(200).send({ ephemeral: true });
    }

    const refusal = spaceMessageRefusal({ spaceId, channelId, userId: request.userId, content: words, kind: 'create', now });
    if (refusal) return sendError(reply, refusal.status, refusal.code, refusal.details);
    interaction.replies += 1;
    const message = postChannelMessage({ channelId, spaceId, userId: request.userId, text: given || cardsSummary(cards), cards, now });
    if (!message) return sendError(reply, 500, 'internal_error');
    return reply.code(201).send(message);
  });

  // ─── The instance's operator ───

  app.get('/api/admin/bots', ADMIN, async (_request, reply) => {
    const rows = getDb().select().from(schema.bots).orderBy(asc(schema.bots.createdAt)).all();
    const counts = new Map(getDb().select({ userId: schema.spaceMembers.userId, count: sql<number>`count(*)` }).from(schema.spaceMembers)
      .groupBy(schema.spaceMembers.userId).all().map((row) => [row.userId, row.count]));
    const bots: AdminBotInfo[] = rows.map((row) => ({ ...toInfo(row), ownerName: nameOf(row.ownerId), spaces: counts.get(row.id) ?? 0 }));
    return reply.code(200).send({ enabled: botsEnabled(), bots });
  });

  app.put<{ Body: { enabled?: unknown } }>('/api/admin/bots/enabled', ADMIN, async (request, reply) => {
    const { enabled } = request.body ?? {};
    if (typeof enabled !== 'boolean') return sendError(reply, 400, 'validation_failed', { field: 'enabled' });
    getDb().update(schema.instanceSettings).set({ botsEnabled: enabled ? 1 : 0 }).run();
    recordPlatformAudit({ actorId: request.userId, action: 'bots_update', targetType: 'instance', targetId: 'instance', details: { enabled } });
    return reply.code(200).send({ enabled });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/bots/:id', ADMIN, async (request, reply) => {
    const row = botOf(request.params.id);
    if (!row) return sendError(reply, 404, 'bot_not_found');
    const label = nameOf(row.id);
    retireBot(row.id);
    recordPlatformAudit({ actorId: request.userId, action: 'bot_delete', targetType: 'user', targetId: row.id, targetLabel: label });
    return reply.code(200).send({ success: true });
  });
}
