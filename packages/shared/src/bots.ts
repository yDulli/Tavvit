/** Bots (docs/systems/bots.md): accounts a person runs from a program, under what they let them do. */

import type { MessageCard } from './cards.js';

export const BOT_LIMITS = {
  PER_OWNER: 5,
  NAME_MAX_LENGTH: 32,
  DESCRIPTION_MAX_LENGTH: 200,
  /** Requests one bot may make in a minute, across everything open to it. */
  REQUESTS_PER_MINUTE: 300,
  COMMANDS_PER_BOT: 25,
  COMMAND_NAME_MAX_LENGTH: 32,
  COMMAND_DESCRIPTION_MAX_LENGTH: 100,
  COMMAND_ARGS_MAX_LENGTH: 1000,
  OPTIONS_PER_COMMAND: 10,
  OPTION_NAME_MAX_LENGTH: 32,
  OPTION_DESCRIPTION_MAX_LENGTH: 100,
  OPTION_CHOICES: 25,
  OPTION_CHOICE_MAX_LENGTH: 100,
  OPTION_TEXT_MAX_LENGTH: 1000,
  /** How long a bot may answer a command it was asked. */
  INTERACTION_TTL_MS: 15 * 60_000,
  REPLIES_PER_INTERACTION: 5,
} as const;

/** What a bot may send on the socket, besides the ping. Anything else is refused. */
export const BOT_SOCKET_EVENTS: readonly string[] = ['typing_start', 'reaction_add', 'reaction_remove'];

export interface BotRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** What it does, for the reference. */
  summary: string;
  /** The right it takes in the channel or the space, when it takes one. */
  permission?: string;
  /** An example of what it takes. */
  body?: string;
}

/**
 * Every route a bot's token opens. Nothing else takes one. `routes/bots.test.ts` compares this with
 * the routes that say `botAllowed`, and the developer docs are made from it, so a route can be
 * neither open nor documented by accident. Adding to it is a decision, made here and in
 * docs/systems/bots.md.
 */
export const BOT_ROUTES: readonly BotRoute[] = [
  { method: 'GET', path: '/api/bots/@me', summary: 'The bot, and the spaces it is in.' },
  { method: 'PUT', path: '/api/bots/@me/commands', summary: 'The commands it answers to, all of them at once.', body: '{ "commands": [{ "name": "roll", "description": "Roll a die", "options": [{ "name": "sides", "description": "How many sides", "type": "number" }] }] }' },
  { method: 'POST', path: '/api/bots/@me/files', summary: 'Uploads a file as multipart/form-data, to name in a message. It counts on the owner\'s storage.' },
  { method: 'GET', path: '/api/users/@me', summary: 'Its account.' },
  { method: 'GET', path: '/api/spaces/:id', summary: 'A space, with its roles.' },
  { method: 'GET', path: '/api/spaces/:id/channels', summary: 'The channels of a space that the bot can see.' },
  { method: 'GET', path: '/api/spaces/:id/members', summary: 'The members of a space.' },
  { method: 'GET', path: '/api/channels/:id/messages', summary: 'A channel\'s history.', permission: 'READ_MESSAGE_HISTORY' },
  { method: 'GET', path: '/api/channels/:id/posts', summary: 'A forum\'s tags and its posts, the latest activity first.', permission: 'READ_MESSAGE_HISTORY' },
  { method: 'POST', path: '/api/channels/:id/posts', summary: 'Starts a post in a forum: a title, words or files, and tags.', permission: 'CREATE_THREADS', body: '{ "title": "Release 2.0", "content": "What changed", "tagIds": [] }' },
  { method: 'POST', path: '/api/channels/:id/messages', summary: 'Writes a message: text, cards, files, or several of them.', permission: 'SEND_MESSAGES', body: '{ "content": "Hello", "cards": [{ "title": "Build passed", "color": "#34c77b" }], "attachments": ["<id>"] }' },
  { method: 'PATCH', path: '/api/messages/:id', summary: 'Edits one of its own messages.', body: '{ "content": "Hello again", "cards": null }' },
  { method: 'DELETE', path: '/api/messages/:id', summary: 'Deletes one of its own messages, or any with the right.', permission: 'MANAGE_MESSAGES' },
  { method: 'PUT', path: '/api/messages/:id/reactions/:emoji', summary: 'Adds its reaction to a message.', permission: 'ADD_REACTIONS' },
  { method: 'DELETE', path: '/api/messages/:id/reactions/:emoji', summary: 'Takes its reaction back.' },
  { method: 'POST', path: '/api/interactions/:id/reply', summary: 'Answers a command it was asked, within 15 minutes, in the channel or for the person alone.', body: '{ "content": "You rolled 4", "ephemeral": true }' },
  { method: 'POST', path: '/api/spaces/:id/members/:uid/roles', summary: 'Gives a member a role below its own.', permission: 'MANAGE_ROLES', body: '{ "roleId": "<id>" }' },
  { method: 'DELETE', path: '/api/spaces/:id/members/:uid/roles/:roleId', summary: 'Takes a role away.', permission: 'MANAGE_ROLES' },
  { method: 'PUT', path: '/api/spaces/:id/members/:uid/timeout', summary: 'Times a member out.', permission: 'MODERATE_MEMBERS', body: '{ "durationSeconds": 600, "reason": "Spam" }' },
  { method: 'DELETE', path: '/api/spaces/:id/members/:uid/timeout', summary: 'Ends a timeout.', permission: 'MODERATE_MEMBERS' },
  { method: 'DELETE', path: '/api/spaces/:id/members/:uid', summary: 'Removes a member from a space.', permission: 'KICK_MEMBERS', body: '{ "reason": "Spam" }' },
  { method: 'GET', path: '/api/spaces/:id/bans', summary: 'Who is banned from a space.', permission: 'BAN_MEMBERS' },
  { method: 'POST', path: '/api/spaces/:id/bans', summary: 'Bans someone, and can delete what they wrote lately.', permission: 'BAN_MEMBERS', body: '{ "userId": "<id>", "reason": "Spam", "deleteMessagesSeconds": 3600 }' },
  { method: 'DELETE', path: '/api/spaces/:id/bans/:uid', summary: 'Lifts a ban.', permission: 'BAN_MEMBERS' },
];

/** What an owner sees. The token is not here: it is shown once, when it is made. */
export interface BotInfo {
  id: string;
  name: string;
  /** The stored file of its picture. */
  avatar: string | null;
  avatarColor: string | null;
  /** The stored file of the banner across the top of its profile (since 1.41.2; absent from older hosts). */
  banner?: string | null;
  /** What people find it by and see under its name: `bot-<id>` until its owner gives it one (since 1.41.2). */
  username?: string;
  description: string | null;
  ownerId: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** What the developer portal shows of one bot. */
export interface BotDetail extends BotInfo {
  commands: BotCommand[];
  spaces: Array<{ id: string; name: string }>;
}

export interface BotWithToken {
  bot: BotInfo;
  token: string;
}

export interface BotsResponse {
  /** Whether this instance allows bots at all. */
  enabled: boolean;
  bots: BotInfo[];
}

/** What someone about to add a bot to a space sees of it. */
export interface BotPublicInfo {
  id: string;
  name: string;
  avatar: string | null;
  avatarColor: string | null;
  description: string | null;
  ownerName: string;
  /** The spaces on this instance the person asking may bring it into. */
  spaces: Array<{ id: string; name: string }>;
}

/** A bot with who runs it, for the admin console. */
export interface AdminBotInfo extends BotInfo {
  ownerName: string;
  spaces: number;
}

export const BOT_OPTION_TYPES = ['text', 'number', 'boolean', 'person', 'channel', 'role'] as const;
export type BotOptionType = (typeof BOT_OPTION_TYPES)[number];

/** One thing a command asks for. A person fills it in; the server checks it before the bot hears of it. */
export interface BotCommandOption {
  name: string;
  description: string;
  type: BotOptionType;
  required?: boolean;
  /** For text: the only answers it takes. */
  choices?: string[];
}

export interface BotCommand {
  name: string;
  description: string;
  options?: BotCommandOption[];
}

/** What a filled-in option holds: a person, channel or role goes by its id. */
export type CommandOptionValue = string | number | boolean;

/** A command's answer that is for the person who asked alone: on their sockets, and stored nowhere. */
export interface CommandReply {
  id: string;
  channelId: string;
  spaceId: string;
  botId: string;
  botName: string;
  botAvatar: string | null;
  botAvatarColor: string | null;
  content: string | null;
  cards?: MessageCard[];
  createdAt: number;
}

/** A command as a channel's composer offers it. */
export interface ChannelCommand extends BotCommand {
  botId: string;
  botName: string;
}

const COMMAND_NAME = /^[a-z0-9_-]{1,32}$/;

function cleanOption(value: unknown): BotCommandOption | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, description, type, required, choices } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !COMMAND_NAME.test(name)) return null;
  const text = typeof description === 'string' ? description.trim() : '';
  if (!text || text.length > BOT_LIMITS.OPTION_DESCRIPTION_MAX_LENGTH) return null;
  if (!(BOT_OPTION_TYPES as readonly unknown[]).includes(type)) return null;
  const option: BotCommandOption = { name, description: text, type: type as BotOptionType };
  if (required === true) option.required = true;
  if (choices !== undefined) {
    if (type !== 'text' || !Array.isArray(choices) || choices.length === 0 || choices.length > BOT_LIMITS.OPTION_CHOICES) return null;
    if (!choices.every((choice) => typeof choice === 'string' && choice.trim() !== '' && choice.length <= BOT_LIMITS.OPTION_CHOICE_MAX_LENGTH)) return null;
    option.choices = (choices as string[]).map((choice) => choice.trim());
  }
  return option;
}

/** A command as it is kept, or null when it is not one. */
export function cleanCommand(value: unknown): BotCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, description, options } = value as { name?: unknown; description?: unknown; options?: unknown };
  if (typeof name !== 'string' || !COMMAND_NAME.test(name)) return null;
  const text = typeof description === 'string' ? description.trim() : '';
  if (!text || text.length > BOT_LIMITS.COMMAND_DESCRIPTION_MAX_LENGTH) return null;
  const command: BotCommand = { name, description: text };
  if (options !== undefined) {
    if (!Array.isArray(options) || options.length > BOT_LIMITS.OPTIONS_PER_COMMAND) return null;
    const cleaned = options.map(cleanOption);
    if (cleaned.some((option) => option === null)) return null;
    const kept = cleaned as BotCommandOption[];
    if (new Set(kept.map((option) => option.name)).size !== kept.length) return null;
    if (kept.length > 0) command.options = kept;
  }
  return command;
}

/**
 * The options as someone filled them in, against what the command asks: the values to hand on,
 * or the name of the first that will not do. Whether a person, channel or role exists in the
 * space is for the server to ask; here they are only ids.
 */
export function cleanCommandInput(
  options: readonly BotCommandOption[],
  given: unknown,
): { values: Record<string, CommandOptionValue> } | { option: string } {
  const input = typeof given === 'object' && given !== null ? (given as Record<string, unknown>) : {};
  const values: Record<string, CommandOptionValue> = {};
  for (const option of options) {
    const value = input[option.name];
    if (value === undefined || value === null || value === '') {
      if (option.required) return { option: option.name };
      continue;
    }
    switch (option.type) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) return { option: option.name };
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return { option: option.name };
        break;
      case 'text':
        if (typeof value !== 'string' || value.length > BOT_LIMITS.OPTION_TEXT_MAX_LENGTH) return { option: option.name };
        if (option.choices && !option.choices.includes(value)) return { option: option.name };
        break;
      default:
        if (typeof value !== 'string' || !/^[\w-]{1,64}$/.test(value)) return { option: option.name };
    }
    values[option.name] = value as CommandOptionValue;
  }
  return { values };
}

/** What the composer holds, read as a command: `/roll 2d6`. Null when it is a message. */
export function parseCommandText(text: string): { name: string; args: string } | null {
  const match = /^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { name: match[1] ?? '', args: (match[2] ?? '').trim() };
}
