import { CATEGORY_NAME_MAX_LENGTH, CHANNEL_NAME_MAX_LENGTH, CHANNEL_TOPIC_MAX_LENGTH, normalizeCategoryName, normalizeChannelName, normalizeChannelTopic } from './constants.js';
import { PermissionBits, canManageRoleAt, permissionsToString, type HierarchyStanding } from './permissions.js';
import { cutToLength, isRoleIcon, normalizeRoleName, withoutHiddenCharacters } from './roleDisplay.js';
import { ROLE_LIMITS, SLOWMODE_SECONDS, type Space } from './types.js';

// Importing a Discord server template (docs/systems/spaces.md, "Importing a
// Discord template"). A template is a snapshot of a server's structure:
// roles with their permissions, categories, channels and their permission
// overwrites. It holds no messages, members, emoji, bots or webhooks, and this
// import never claims to move them.
//
// Everything here is pure: the instance that imports reads the template (from
// Discord's public template endpoint or from a file the person supplies),
// plans the import against the target space with `planDiscordImport` and
// writes the plan. The preview the person approves is that same plan.

// ─── The template ─────────────────────────────────────────────────────────

export const DISCORD_IMPORT_LIMITS = {
  /** Discord's own ceilings for a server. */
  MAX_ROLES: 250,
  MAX_CHANNELS: 500,
  MAX_OVERWRITES_PER_CHANNEL: 100,
  /** The most a template answer or file may weigh. */
  MAX_TEMPLATE_BYTES: 2_000_000,
  MAX_NAME_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 300,
} as const;

/** A template code: what follows discord.new/ or discord.com/template/. */
const TEMPLATE_CODE = /^[A-Za-z0-9_-]{2,64}$/;
const TEMPLATE_HOSTS = new Set(['discord.new', 'discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com', 'ptb.discord.com', 'canary.discord.com']);

/**
 * The template code a person pasted: a bare code, or a link of the forms
 * `discord.new/CODE` and `discord.com/template/CODE` (with or without
 * https://, ptb. or canary., a trailing slash, a query). Null for anything
 * else, so nothing but a code ever reaches the request to Discord.
 */
export function parseDiscordTemplateCode(input: string): string | null {
  const trimmed = input.trim();
  if (TEMPLATE_CODE.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!TEMPLATE_HOSTS.has(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const code = host === 'discord.new'
    ? (parts.length === 1 ? parts[0] : undefined)
    : (parts.length === 2 && parts[0] === 'template' ? parts[1] : undefined);
  return code && TEMPLATE_CODE.test(code) ? code : null;
}

export interface DiscordTemplateRole {
  key: string;
  name: string;
  /** Decimal string of Discord's permission bits. */
  permissions: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  unicodeEmoji: string | null;
  /** The role had a picture as its icon, which a template only names by hash. */
  hasImageIcon: boolean;
}

export interface DiscordTemplateOverwrite {
  /** The role's key for `type` role; a member's id for `type` member. */
  key: string;
  type: 'role' | 'member';
  allow: string;
  deny: string;
}

export interface DiscordTemplateChannel {
  key: string;
  /** Discord's channel type: 0 text, 2 voice, 4 category, 5 announcement, 13 stage, 15 forum, 16 media. */
  type: number;
  name: string;
  position: number;
  topic: string | null;
  parentKey: string | null;
  rateLimitPerUser: number;
  nsfw: boolean;
  overwrites: DiscordTemplateOverwrite[];
}

/** A template as read and checked, whatever it came from. */
export interface DiscordTemplateSource {
  code: string | null;
  name: string;
  description: string | null;
  guildName: string;
  usageCount: number | null;
  creatorName: string | null;
  updatedAt: string | null;
  /** In Discord's order, which is the hierarchy from the bottom: @everyone first. */
  roles: DiscordTemplateRole[];
  channels: DiscordTemplateChannel[];
}

export type DiscordTemplateReadResult =
  | { ok: true; source: DiscordTemplateSource }
  | { ok: false; error: 'invalid'; field: string }
  | { ok: false; error: 'too_large'; kind: 'roles' | 'channels' | 'overwrites'; max: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An id or a permission value: an integer as a number or a decimal string. */
function decimalOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(value)) return value;
  return null;
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? cutToLength(trimmed, max) : null;
}

/**
 * Reads a template: the answer of Discord's `GET /guilds/templates/{code}`, or
 * only its `serialized_source_guild` (what a saved template file may hold).
 * Every field is checked and bounded; anything that is not a template is
 * refused with the field that gave it away.
 */
export function readDiscordTemplate(raw: unknown, code: string | null): DiscordTemplateReadResult {
  if (!isRecord(raw)) return { ok: false, error: 'invalid', field: 'template' };
  const guild = isRecord(raw.serialized_source_guild) ? raw.serialized_source_guild : raw;
  if (!Array.isArray(guild.roles)) return { ok: false, error: 'invalid', field: 'roles' };
  if (!Array.isArray(guild.channels)) return { ok: false, error: 'invalid', field: 'channels' };
  if (guild.roles.length > DISCORD_IMPORT_LIMITS.MAX_ROLES) return { ok: false, error: 'too_large', kind: 'roles', max: DISCORD_IMPORT_LIMITS.MAX_ROLES };
  if (guild.channels.length > DISCORD_IMPORT_LIMITS.MAX_CHANNELS) return { ok: false, error: 'too_large', kind: 'channels', max: DISCORD_IMPORT_LIMITS.MAX_CHANNELS };

  const roles: DiscordTemplateRole[] = [];
  const roleKeys = new Set<string>();
  for (const entry of guild.roles) {
    if (!isRecord(entry)) return { ok: false, error: 'invalid', field: 'roles' };
    const key = decimalOf(entry.id);
    const permissions = decimalOf(entry.permissions);
    const name = textOf(entry.name, DISCORD_IMPORT_LIMITS.MAX_NAME_LENGTH);
    if (key === null || roleKeys.has(key)) return { ok: false, error: 'invalid', field: 'roles.id' };
    if (permissions === null) return { ok: false, error: 'invalid', field: 'roles.permissions' };
    if (name === null) return { ok: false, error: 'invalid', field: 'roles.name' };
    roleKeys.add(key);
    roles.push({
      key,
      name,
      permissions,
      color: typeof entry.color === 'number' && Number.isInteger(entry.color) && entry.color >= 0 && entry.color <= 0xffffff ? entry.color : 0,
      hoist: entry.hoist === true,
      mentionable: entry.mentionable === true,
      unicodeEmoji: textOf(entry.unicode_emoji, ROLE_LIMITS.MAX_ICON_LENGTH),
      hasImageIcon: typeof entry.icon === 'string' && entry.icon.length > 0,
    });
  }
  if (roles.length === 0) return { ok: false, error: 'invalid', field: 'roles' };

  const channels: DiscordTemplateChannel[] = [];
  const channelKeys = new Set<string>();
  for (const entry of guild.channels) {
    if (!isRecord(entry)) return { ok: false, error: 'invalid', field: 'channels' };
    const key = decimalOf(entry.id);
    const name = textOf(entry.name, DISCORD_IMPORT_LIMITS.MAX_NAME_LENGTH);
    if (key === null || channelKeys.has(key)) return { ok: false, error: 'invalid', field: 'channels.id' };
    if (name === null) return { ok: false, error: 'invalid', field: 'channels.name' };
    if (typeof entry.type !== 'number' || !Number.isInteger(entry.type)) return { ok: false, error: 'invalid', field: 'channels.type' };
    const rawOverwrites = entry.permission_overwrites === undefined || entry.permission_overwrites === null ? [] : entry.permission_overwrites;
    if (!Array.isArray(rawOverwrites)) return { ok: false, error: 'invalid', field: 'channels.permission_overwrites' };
    if (rawOverwrites.length > DISCORD_IMPORT_LIMITS.MAX_OVERWRITES_PER_CHANNEL) {
      return { ok: false, error: 'too_large', kind: 'overwrites', max: DISCORD_IMPORT_LIMITS.MAX_OVERWRITES_PER_CHANNEL };
    }
    const overwrites: DiscordTemplateOverwrite[] = [];
    // A channel has one overwrite per role or member, as an override per
    // target is all Tavvit stores; a template naming one twice is not Discord's.
    const targets = new Set<string>();
    for (const overwrite of rawOverwrites) {
      if (!isRecord(overwrite)) return { ok: false, error: 'invalid', field: 'channels.permission_overwrites' };
      const target = decimalOf(overwrite.id);
      const allow = decimalOf(overwrite.allow);
      const deny = decimalOf(overwrite.deny);
      const type = overwrite.type === 0 || overwrite.type === '0' || overwrite.type === 'role' ? 'role'
        : overwrite.type === 1 || overwrite.type === '1' || overwrite.type === 'member' ? 'member' : null;
      if (target === null || allow === null || deny === null || type === null || targets.has(`${type}:${target}`)) {
        return { ok: false, error: 'invalid', field: 'channels.permission_overwrites' };
      }
      targets.add(`${type}:${target}`);
      overwrites.push({ key: target, type, allow, deny });
    }
    channelKeys.add(key);
    channels.push({
      key,
      type: entry.type,
      name,
      position: typeof entry.position === 'number' && Number.isFinite(entry.position) ? entry.position : channels.length,
      topic: typeof entry.topic === 'string' ? entry.topic : null,
      parentKey: decimalOf(entry.parent_id),
      rateLimitPerUser: typeof entry.rate_limit_per_user === 'number' && entry.rate_limit_per_user > 0 ? Math.floor(entry.rate_limit_per_user) : 0,
      nsfw: entry.nsfw === true,
      overwrites,
    });
  }

  const creator = isRecord(raw.creator) ? textOf(raw.creator.global_name, 64) ?? textOf(raw.creator.username, 64) : null;
  const guildName = textOf(guild.name, DISCORD_IMPORT_LIMITS.MAX_NAME_LENGTH) ?? textOf(raw.name, DISCORD_IMPORT_LIMITS.MAX_NAME_LENGTH) ?? 'Discord';
  return {
    ok: true,
    source: {
      code,
      name: textOf(raw.name, DISCORD_IMPORT_LIMITS.MAX_NAME_LENGTH) ?? guildName,
      description: textOf(raw.description, DISCORD_IMPORT_LIMITS.MAX_DESCRIPTION_LENGTH),
      guildName,
      usageCount: typeof raw.usage_count === 'number' && Number.isSafeInteger(raw.usage_count) ? raw.usage_count : null,
      creatorName: creator,
      updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at.slice(0, 40) : null,
      roles,
      channels,
    },
  };
}

// ─── Permissions ──────────────────────────────────────────────────────────

type NativePermission = keyof typeof PermissionBits;

/**
 * Every Discord permission bit and what it becomes in Tavvit. `native` empty
 * means Tavvit has nothing that does the same; such a bit is never granted
 * silently in its place, but named in the preview and the report. A bit is
 * mapped only to permissions that allow no more than it did on Discord, with
 * one exception said in the note: Discord's Move Members also disconnects.
 */
export const DISCORD_PERMISSIONS: ReadonlyArray<{ bit: number; name: string; native: readonly NativePermission[] }> = [
  { bit: 0, name: 'CREATE_INSTANT_INVITE', native: ['CREATE_INVITE'] },
  { bit: 1, name: 'KICK_MEMBERS', native: ['KICK_MEMBERS'] },
  { bit: 2, name: 'BAN_MEMBERS', native: ['BAN_MEMBERS'] },
  { bit: 3, name: 'ADMINISTRATOR', native: ['ADMINISTRATOR'] },
  { bit: 4, name: 'MANAGE_CHANNELS', native: ['MANAGE_CHANNELS'] },
  { bit: 5, name: 'MANAGE_GUILD', native: ['MANAGE_SPACE'] },
  { bit: 6, name: 'ADD_REACTIONS', native: ['ADD_REACTIONS'] },
  { bit: 7, name: 'VIEW_AUDIT_LOG', native: ['VIEW_AUDIT_LOG'] },
  { bit: 8, name: 'PRIORITY_SPEAKER', native: [] },
  { bit: 9, name: 'STREAM', native: ['STREAM'] },
  { bit: 10, name: 'VIEW_CHANNEL', native: ['VIEW_CHANNEL'] },
  { bit: 11, name: 'SEND_MESSAGES', native: ['SEND_MESSAGES'] },
  { bit: 12, name: 'SEND_TTS_MESSAGES', native: [] },
  { bit: 13, name: 'MANAGE_MESSAGES', native: ['MANAGE_MESSAGES'] },
  { bit: 14, name: 'EMBED_LINKS', native: [] },
  { bit: 15, name: 'ATTACH_FILES', native: ['ATTACH_FILES'] },
  { bit: 16, name: 'READ_MESSAGE_HISTORY', native: ['READ_MESSAGE_HISTORY'] },
  { bit: 17, name: 'MENTION_EVERYONE', native: ['MENTION_EVERYONE'] },
  { bit: 18, name: 'USE_EXTERNAL_EMOJIS', native: [] },
  { bit: 19, name: 'VIEW_GUILD_INSIGHTS', native: [] },
  { bit: 20, name: 'CONNECT', native: ['CONNECT'] },
  { bit: 21, name: 'SPEAK', native: ['SPEAK'] },
  { bit: 22, name: 'MUTE_MEMBERS', native: ['MUTE_MEMBERS'] },
  { bit: 23, name: 'DEAFEN_MEMBERS', native: ['DEAFEN_MEMBERS'] },
  { bit: 24, name: 'MOVE_MEMBERS', native: ['MOVE_MEMBERS', 'DISCONNECT_MEMBERS'] },
  { bit: 25, name: 'USE_VAD', native: [] },
  { bit: 26, name: 'CHANGE_NICKNAME', native: [] },
  { bit: 27, name: 'MANAGE_NICKNAMES', native: [] },
  { bit: 28, name: 'MANAGE_ROLES', native: ['MANAGE_ROLES'] },
  { bit: 29, name: 'MANAGE_WEBHOOKS', native: ['MANAGE_WEBHOOKS'] },
  { bit: 30, name: 'MANAGE_GUILD_EXPRESSIONS', native: [] },
  { bit: 31, name: 'USE_APPLICATION_COMMANDS', native: [] },
  { bit: 32, name: 'REQUEST_TO_SPEAK', native: [] },
  { bit: 33, name: 'MANAGE_EVENTS', native: [] },
  { bit: 34, name: 'MANAGE_THREADS', native: [] },
  { bit: 35, name: 'CREATE_PUBLIC_THREADS', native: [] },
  { bit: 36, name: 'CREATE_PRIVATE_THREADS', native: [] },
  { bit: 37, name: 'USE_EXTERNAL_STICKERS', native: [] },
  { bit: 38, name: 'SEND_MESSAGES_IN_THREADS', native: [] },
  { bit: 39, name: 'USE_EMBEDDED_ACTIVITIES', native: [] },
  { bit: 40, name: 'MODERATE_MEMBERS', native: ['MODERATE_MEMBERS'] },
  { bit: 41, name: 'VIEW_CREATOR_MONETIZATION_ANALYTICS', native: [] },
  { bit: 42, name: 'USE_SOUNDBOARD', native: [] },
  { bit: 43, name: 'CREATE_GUILD_EXPRESSIONS', native: [] },
  { bit: 44, name: 'CREATE_EVENTS', native: ['MANAGE_EVENTS'] },
  { bit: 45, name: 'USE_EXTERNAL_SOUNDS', native: [] },
  { bit: 46, name: 'SEND_VOICE_MESSAGES', native: [] },
  { bit: 49, name: 'SEND_POLLS', native: [] },
  { bit: 50, name: 'USE_EXTERNAL_APPS', native: [] },
  { bit: 51, name: 'PIN_MESSAGES', native: ['PIN_MESSAGES'] },
];

const KNOWN_DISCORD_BITS = DISCORD_PERMISSIONS.reduce((all, entry) => all | (1n << BigInt(entry.bit)), 0n);

export interface MappedPermissions {
  /** The Tavvit bits, as a bigint. */
  native: bigint;
  /** Discord permissions that were set and have no Tavvit equivalent, by Discord's name. */
  unsupported: string[];
}

/** Discord permission bits (a decimal string) in Tavvit's terms. Unknown bits are named by number. */
export function mapDiscordPermissions(discord: string): MappedPermissions {
  const value = BigInt(discord);
  let native = 0n;
  const unsupported: string[] = [];
  for (const entry of DISCORD_PERMISSIONS) {
    if ((value & (1n << BigInt(entry.bit))) === 0n) continue;
    if (entry.native.length === 0) unsupported.push(entry.name);
    for (const name of entry.native) native |= PermissionBits[name];
  }
  let unknown = value & ~KNOWN_DISCORD_BITS;
  for (let bit = 0; unknown > 0n && bit < 64; bit += 1) {
    if ((unknown & (1n << BigInt(bit))) !== 0n) {
      unsupported.push(`BIT_${bit}`);
      unknown &= ~(1n << BigInt(bit));
    }
  }
  return { native, unsupported };
}

/** The names of the Tavvit permissions in `bits`. */
export function nativePermissionNames(bits: bigint): NativePermission[] {
  return (Object.keys(PermissionBits) as NativePermission[]).filter((name) => (bits & PermissionBits[name]) !== 0n);
}

// ─── The plan ─────────────────────────────────────────────────────────────

/** What the import finds in the space it imports into (nothing for a new space). */
export interface DiscordImportTarget {
  kind: 'new' | 'existing';
  /**
   * The importer grants any bit there (they own the target, as always for a
   * new space, or hold ADMINISTRATOR): the held-bits rule withholds nothing.
   */
  grantsEveryBit: boolean;
  /** The bits the importer holds there, as the held-bits rule reads them. */
  heldPermissions: bigint;
  /** Where the importer stands in the role hierarchy (permissions.md, "Role hierarchy"). */
  standing: HierarchyStanding;
  /** The space's roles other than @everyone, with their positions. */
  roles: ReadonlyArray<{ id: string; name: string; position: number }>;
  categories: ReadonlyArray<{ id: string; name: string }>;
  channels: ReadonlyArray<{ name: string; type: string; categoryId: string | null }>;
}

export interface DiscordImportOverridePlan {
  /** The role's key in the template; the template's @everyone means the space's @everyone. */
  roleKey: string;
  allow: string;
  deny: string;
  unsupported: string[];
  /** Tavvit permissions left out because the importer does not hold them. */
  withheld: NativePermission[];
}

export interface DiscordImportRolePlan {
  key: string;
  name: string;
  color: string;
  icon: string | null;
  hoist: boolean;
  mentionable: boolean;
  /** Decimal Tavvit bits the role gets (or would get, for a kept @everyone). */
  permissions: string;
  everyone: boolean;
  /**
   * `create` a new role; `reuse` an existing one of the same name (left as it
   * is); `update_everyone` sets a new space's @everyone; `keep_everyone`
   * leaves an existing space's @everyone alone.
   */
  action: 'create' | 'reuse' | 'update_everyone' | 'keep_everyone';
  existingRoleId: string | null;
  unsupported: string[];
  withheld: NativePermission[];
}

export interface DiscordImportCategoryPlan {
  key: string;
  name: string;
  action: 'create' | 'reuse';
  existingCategoryId: string | null;
  /** On the category itself; empty when its channels carry their own (see the note `permissions_per_channel`). */
  overrides: DiscordImportOverridePlan[];
}

export interface DiscordImportChannelPlan {
  key: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'forum';
  /** Discord's type, for the preview. */
  sourceType: number;
  /** Created as `type` from a kind Tavvit does not have (stage, media). */
  converted: boolean;
  categoryKey: string | null;
  topic: string | null;
  slowmodeSeconds: number;
  action: 'create' | 'skip';
  overrides: DiscordImportOverridePlan[];
}

export type DiscordImportNoteKind =
  | 'channel_converted'
  | 'channel_unsupported'
  | 'channel_exists'
  | 'category_reused'
  | 'role_reused'
  | 'role_renamed'
  | 'role_icon_dropped'
  | 'everyone_kept'
  | 'roles_below_existing'
  | 'permissions_per_channel'
  | 'member_overwrite_dropped'
  | 'reference_missing'
  | 'slowmode_adjusted'
  | 'topic_shortened'
  | 'name_changed'
  | 'nsfw_dropped'
  /** Bits an override would set that the importer does not hold; `detail` is their names, comma-separated. */
  | 'override_withheld'
  /** Overrides on roles the importer does not outrank, left out; `detail` names the roles. */
  | 'override_hierarchy';

export interface DiscordImportNote {
  kind: DiscordImportNoteKind;
  /** The role, category or channel the note is about, as it will be named. */
  subject: string | null;
  /**
   * A value the note mentions: the kind of channel a converted one was on
   * Discord (a `DiscordConvertedChannelKind`), the number of an unknown
   * Discord channel type, the slow mode it gets in seconds, an original name.
   */
  detail: string | null;
}

export interface DiscordImportPlan {
  roles: DiscordImportRolePlan[];
  categories: DiscordImportCategoryPlan[];
  channels: DiscordImportChannelPlan[];
  notes: DiscordImportNote[];
  counts: { roles: number; categories: number; channels: number; overrides: number; skipped: number };
}

/** What a server template never holds, so an import cannot move it. */
export const DISCORD_NOT_TRANSFERRED = ['messages', 'members', 'bots', 'webhooks', 'emoji', 'stickers', 'icon', 'events', 'threads', 'integrations'] as const;
export type DiscordNotTransferred = (typeof DISCORD_NOT_TRANSFERRED)[number];

export interface DiscordImportPreview {
  template: Omit<DiscordTemplateSource, 'roles' | 'channels'>;
  plan: DiscordImportPlan;
  notTransferred: readonly DiscordNotTransferred[];
}

/** Body of `POST /api/import/discord/preview`: a code (or link) or the template's JSON, and the space to import into. */
export interface DiscordImportPreviewRequest {
  code?: string;
  template?: unknown;
  /** Absent: a new space. */
  spaceId?: string;
}

/** Body of `POST /api/import/discord/apply`. The plan is made again from the template, never taken from the client. */
export interface DiscordImportApplyRequest {
  code?: string;
  template?: unknown;
  target: { kind: 'new'; name?: string } | { kind: 'existing'; spaceId: string };
}

export interface DiscordImportResult {
  space: Space;
  plan: DiscordImportPlan;
}

/** The Discord channels that come over as a plain text or voice channel. */
export type DiscordConvertedChannelKind = 'stage' | 'media';

type ChannelKind =
  | { type: 'text' | 'voice' | 'announcement' | 'forum'; converted: false }
  | { type: 'text' | 'voice'; converted: true; from: DiscordConvertedChannelKind };

const CHANNEL_TYPES: Record<number, ChannelKind | undefined> = {
  0: { type: 'text', converted: false },
  2: { type: 'voice', converted: false },
  5: { type: 'announcement', converted: false },
  13: { type: 'voice', converted: true, from: 'stage' },
  15: { type: 'forum', converted: false },
  16: { type: 'text', converted: true, from: 'media' },
};

const DISCORD_CATEGORY = 4;
const DEFAULT_ROLE_COLOR = '#b9bbbe';

function hexColor(color: number): string {
  return color === 0 ? DEFAULT_ROLE_COLOR : `#${color.toString(16).padStart(6, '0')}`;
}

/** The largest slow mode Tavvit has that is no longer than Discord's. */
function slowmodeFor(seconds: number): number {
  let chosen = 0;
  for (const allowed of SLOWMODE_SECONDS) {
    if (allowed <= seconds) chosen = allowed;
  }
  return chosen;
}

function overwriteSignature(overwrites: readonly DiscordTemplateOverwrite[]): string {
  return overwrites.map((o) => `${o.type}:${o.key}:${o.allow}:${o.deny}`).sort().join('|');
}

/** A template role's name as Tavvit stores one: hidden characters dropped, cut to length. */
function roleNameFromTemplate(raw: string): string {
  return normalizeRoleName(cutToLength(withoutHiddenCharacters(raw), ROLE_LIMITS.MAX_NAME_LENGTH)) ?? 'role';
}

/** `name` with " (n)" after it, cut so the number always fits. */
function withSuffix(name: string, n: number): string {
  const suffix = ` (${n})`;
  return `${cutToLength(name, ROLE_LIMITS.MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

/** Where a channel sits, by kind and name, as Tavvit names channels (`normalizeChannelName`). */
function channelSlot(categoryId: string | null, type: string, name: string): string {
  return `${categoryId ?? ''}:${type}:${normalizeChannelName(name)}`;
}

/**
 * Plans the import of `source` into `target`. Nothing in the target is
 * changed or removed: roles and categories that already exist by name are
 * reused as they are, each at most once, channels that already exist by kind
 * and name in the same category are skipped, and an existing space's
 * @everyone keeps its bits. A non-owner importer grants no bit they do not
 * hold (the held-bits rule) and sets no override on a role they do not
 * outrank (the role hierarchy); what is left out is named.
 */
export function planDiscordImport(source: DiscordTemplateSource, target: DiscordImportTarget): DiscordImportPlan {
  const notes: DiscordImportNote[] = [];
  const noted = new Set<string>();
  const note = (kind: DiscordImportNoteKind, subject: string | null = null, detail: string | null = null) => {
    const key = JSON.stringify([kind, subject, detail]);
    if (noted.has(key)) return;
    noted.add(key);
    notes.push({ kind, subject, detail });
  };
  const withheldOf = (bits: bigint): { kept: bigint; withheld: NativePermission[] } => {
    if (target.grantsEveryBit) return { kept: bits, withheld: [] };
    const held = target.heldPermissions;
    return { kept: bits & held, withheld: nativePermissionNames(bits & ~held) };
  };

  // Roles, in the template's order: the hierarchy from @everyone upwards. A
  // template role takes over an existing role of its name, each existing role
  // at most once. A second role of one name becomes "Name (2)", or takes over
  // the "Name (2)" an earlier import made, so a second import adds nothing.
  const existingByName = new Map<string, Array<{ id: string; name: string; position: number }>>();
  for (const role of target.roles) {
    const key = role.name.toLowerCase();
    existingByName.set(key, [...(existingByName.get(key) ?? []), role]);
  }
  const claimedRoleIds = new Set<string>();
  const plannedNames = new Set<string>(['@everyone']);
  const roles: DiscordImportRolePlan[] = [];
  /** Template role key -> its position in the space, or null for a role the import creates (always below the importer). */
  const rolePositions = new Map<string, number | null>();
  const roleNames = new Map<string, string>();
  source.roles.forEach((role, index) => {
    const mapped = mapDiscordPermissions(role.permissions);
    const { kept, withheld } = withheldOf(mapped.native);
    const color = hexColor(role.color);
    if (index === 0) {
      // A kept @everyone is not written, so nothing of it is left out either.
      const action = target.kind === 'new' ? 'update_everyone' : 'keep_everyone';
      if (action === 'keep_everyone') note('everyone_kept');
      const applied = action === 'update_everyone';
      rolePositions.set(role.key, 0);
      roleNames.set(role.key, '@everyone');
      roles.push({
        key: role.key, name: '@everyone', color, icon: null, hoist: false, mentionable: false,
        permissions: permissionsToString(kept), everyone: true, action, existingRoleId: null,
        unsupported: applied ? mapped.unsupported : [], withheld: applied ? withheld : [],
      });
      return;
    }

    const base = roleNameFromTemplate(role.name);
    let name = base;
    let existing: { id: string; name: string; position: number } | undefined;
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? base : withSuffix(base, n);
      const lower = candidate.toLowerCase();
      existing = (existingByName.get(lower) ?? []).find((other) => !claimedRoleIds.has(other.id));
      if (existing || (!existingByName.has(lower) && !plannedNames.has(lower))) {
        name = candidate;
        break;
      }
    }
    plannedNames.add(name.toLowerCase());

    if (existing) {
      // Used as it is: nothing of the template role is written to it.
      claimedRoleIds.add(existing.id);
      note('role_reused', existing.name);
      rolePositions.set(role.key, existing.position);
      roleNames.set(role.key, existing.name);
      roles.push({
        key: role.key, name: existing.name, color, icon: null, hoist: false, mentionable: false,
        permissions: permissionsToString(kept), everyone: false, action: 'reuse', existingRoleId: existing.id,
        unsupported: [], withheld: [],
      });
      return;
    }

    if (name !== base) note('role_renamed', name, base);
    const icon = role.unicodeEmoji !== null && isRoleIcon(role.unicodeEmoji) ? role.unicodeEmoji : null;
    if ((role.hasImageIcon || role.unicodeEmoji !== null) && icon === null) note('role_icon_dropped', name);
    rolePositions.set(role.key, null);
    roleNames.set(role.key, name);
    roles.push({
      key: role.key, name, color, icon, hoist: role.hoist, mentionable: role.mentionable,
      permissions: permissionsToString(kept), everyone: false, action: 'create', existingRoleId: null,
      unsupported: mapped.unsupported, withheld,
    });
  });
  if (target.kind === 'existing' && roles.some((role) => role.action === 'create')) note('roles_below_existing');

  // What overrides leave out, gathered per channel or category for one note each.
  const withheldOn = new Map<string, Set<string>>();
  const outrankedOn = new Map<string, Set<string>>();
  const gather = (into: Map<string, Set<string>>, subject: string, values: readonly string[]) => {
    if (values.length === 0) return;
    const set = into.get(subject) ?? new Set<string>();
    for (const value of values) set.add(value);
    into.set(subject, set);
  };

  const overridesOf = (overwrites: readonly DiscordTemplateOverwrite[], subject: string): DiscordImportOverridePlan[] => {
    const result: DiscordImportOverridePlan[] = [];
    for (const overwrite of overwrites) {
      if (overwrite.type === 'member') {
        note('member_overwrite_dropped', subject);
        continue;
      }
      if (!rolePositions.has(overwrite.key)) {
        note('reference_missing', subject);
        continue;
      }
      // The role hierarchy, as the override routes apply it: an override only
      // on a role below the importer's top role. Roles the import creates are.
      const position = rolePositions.get(overwrite.key) ?? null;
      if (position !== null && !canManageRoleAt(target.standing, position)) {
        gather(outrankedOn, subject, [roleNames.get(overwrite.key) ?? overwrite.key]);
        continue;
      }
      const allow = mapDiscordPermissions(overwrite.allow);
      const deny = mapDiscordPermissions(overwrite.deny);
      // ADMINISTRATOR does nothing in a Discord overwrite; in an Tavvit override
      // it would hand the role everything in the channel. It is named among the
      // unsupported bits and never carried over, so nothing that worked on
      // Discord is lost.
      const administrator = ((allow.native | deny.native) & PermissionBits.ADMINISTRATOR) !== 0n;
      const keptAllow = withheldOf(allow.native & ~PermissionBits.ADMINISTRATOR);
      const keptDeny = withheldOf(deny.native & ~PermissionBits.ADMINISTRATOR);
      const withheld = [...new Set([...keptAllow.withheld, ...keptDeny.withheld])];
      gather(withheldOn, subject, withheld);
      if (keptAllow.kept === 0n && keptDeny.kept === 0n) continue;
      result.push({
        roleKey: overwrite.key,
        allow: permissionsToString(keptAllow.kept),
        deny: permissionsToString(keptDeny.kept),
        unsupported: [...new Set([...allow.unsupported, ...deny.unsupported, ...(administrator ? ['ADMINISTRATOR'] : [])])],
        withheld,
      });
    }
    return result;
  };

  // Categories, in Discord's order. A template category takes over an
  // existing one of its name, each existing one at most once.
  const sourceCategories = source.channels
    .map((channel, index) => ({ channel, index }))
    .filter(({ channel }) => channel.type === DISCORD_CATEGORY)
    .sort((a, b) => a.channel.position - b.channel.position || a.index - b.index);
  const existingCategories = new Map<string, Array<{ id: string; name: string }>>();
  for (const category of target.categories) {
    const key = category.name.toLowerCase();
    existingCategories.set(key, [...(existingCategories.get(key) ?? []), category]);
  }
  const claimedCategoryIds = new Set<string>();
  const childrenOf = new Map<string, DiscordTemplateChannel[]>();
  for (const channel of source.channels) {
    if (channel.type === DISCORD_CATEGORY || channel.parentKey === null) continue;
    const list = childrenOf.get(channel.parentKey) ?? [];
    list.push(channel);
    childrenOf.set(channel.parentKey, list);
  }

  const categories: DiscordImportCategoryPlan[] = [];
  const categoryKeys = new Set<string>();
  /** Category key -> whether its overrides sit on the category (every channel in it is synced with it). */
  const overridesOnCategory = new Map<string, boolean>();
  const categoryIds = new Map<string, string | null>();
  for (const { channel } of sourceCategories) {
    const name = cutToLength(normalizeCategoryName(channel.name), CATEGORY_NAME_MAX_LENGTH);
    const existing = (existingCategories.get(name.toLowerCase()) ?? []).find((category) => !claimedCategoryIds.has(category.id));
    if (existing) claimedCategoryIds.add(existing.id);
    const signature = overwriteSignature(channel.overwrites);
    const synced = (childrenOf.get(channel.key) ?? []).every((child) => overwriteSignature(child.overwrites) === signature);
    const onCategory = !existing && synced;
    if (existing) note('category_reused', existing.name);
    else if (!synced && channel.overwrites.length > 0) note('permissions_per_channel', name);
    categoryKeys.add(channel.key);
    overridesOnCategory.set(channel.key, onCategory);
    categoryIds.set(channel.key, existing?.id ?? null);
    categories.push({
      key: channel.key,
      name,
      action: existing ? 'reuse' : 'create',
      existingCategoryId: existing?.id ?? null,
      overrides: onCategory ? overridesOf(channel.overwrites, name) : [],
    });
  }

  // Channels: by category in the category order, the uncategorised first, as
  // Discord lists them; inside each, text before voice, then by position.
  const existingChannels = new Set(target.channels.map((channel) => channelSlot(channel.categoryId, channel.type, channel.name)));
  const ordered = source.channels
    .map((channel, index) => ({ channel, index }))
    .filter(({ channel }) => channel.type !== DISCORD_CATEGORY);
  const categoryRank = new Map(sourceCategories.map(({ channel }, rank) => [channel.key, rank]));
  ordered.sort((a, b) => {
    const rankA = a.channel.parentKey !== null && categoryRank.has(a.channel.parentKey) ? (categoryRank.get(a.channel.parentKey) ?? 0) : -1;
    const rankB = b.channel.parentKey !== null && categoryRank.has(b.channel.parentKey) ? (categoryRank.get(b.channel.parentKey) ?? 0) : -1;
    const voiceA = CHANNEL_TYPES[a.channel.type]?.type === 'voice' ? 1 : 0;
    const voiceB = CHANNEL_TYPES[b.channel.type]?.type === 'voice' ? 1 : 0;
    return rankA - rankB || voiceA - voiceB || a.channel.position - b.channel.position || a.index - b.index;
  });

  const channels: DiscordImportChannelPlan[] = [];
  for (const { channel } of ordered) {
    const kind = CHANNEL_TYPES[channel.type];
    if (!kind) {
      note('channel_unsupported', channel.name, String(channel.type));
      continue;
    }
    let categoryKey = channel.parentKey;
    if (categoryKey !== null && !categoryKeys.has(categoryKey)) {
      note('reference_missing', channel.name);
      categoryKey = null;
    }
    // Every Tavvit channel name, text or voice, is in this form (routes/channels.ts).
    // Discord's text channels already are, so only a text channel's change is
    // news; a voice channel's capitals simply follow Tavvit's naming.
    const name = cutToLength(normalizeChannelName(channel.name), CHANNEL_NAME_MAX_LENGTH);
    if (kind.type !== 'voice' && name !== channel.name) note('name_changed', name, channel.name);
    if (kind.converted) note('channel_converted', name, kind.from);
    if (channel.nsfw) note('nsfw_dropped', name);

    // Only a channel the target already has (same kind and name in the same
    // category) is skipped, which is what makes a second import of the same
    // template add nothing; two channels of one name in the template both come over.
    const existingCategoryId = categoryKey !== null ? categoryIds.get(categoryKey) ?? null : null;
    const exists = (categoryKey === null || existingCategoryId !== null)
      && existingChannels.has(channelSlot(existingCategoryId, kind.type, name));
    const action: DiscordImportChannelPlan['action'] = exists ? 'skip' : 'create';
    if (exists) note('channel_exists', name);

    let topic: string | null = null;
    if (kind.type !== 'voice' && channel.topic) {
      const normalized = normalizeChannelTopic(channel.topic);
      if (normalized && normalized.length > CHANNEL_TOPIC_MAX_LENGTH) {
        // Normalised again: a cut just after a space or line break would
        // otherwise end the stored topic in it.
        topic = normalizeChannelTopic(cutToLength(normalized, CHANNEL_TOPIC_MAX_LENGTH));
        note('topic_shortened', name);
      } else {
        topic = normalized;
      }
    }
    const slowmodeSeconds = kind.type !== 'voice' ? slowmodeFor(channel.rateLimitPerUser) : 0;
    if (kind.type !== 'voice' && slowmodeSeconds !== channel.rateLimitPerUser) note('slowmode_adjusted', name, String(slowmodeSeconds));

    // A channel inherits through its category only where the category carries
    // the overrides (every channel in it synced); otherwise it carries its own.
    // A reused category is not changed, so its channels carry their own too,
    // which is what Discord applies to them.
    const inherits = categoryKey !== null && overridesOnCategory.get(categoryKey) === true;
    const overwrites = inherits ? [] : channel.overwrites;
    channels.push({
      key: channel.key,
      name,
      type: kind.type,
      sourceType: channel.type,
      converted: kind.converted,
      categoryKey,
      topic,
      slowmodeSeconds,
      action,
      overrides: action === 'create' ? overridesOf(overwrites, name) : [],
    });
  }
  for (const [subject, names] of outrankedOn) note('override_hierarchy', subject, [...names].join(', '));
  for (const [subject, bits] of withheldOn) note('override_withheld', subject, [...bits].join(','));

  const createdCategories = categories.filter((category) => category.action === 'create');
  const createdChannels = channels.filter((channel) => channel.action === 'create');
  return {
    roles,
    categories,
    channels,
    notes,
    counts: {
      roles: roles.filter((role) => role.action === 'create').length,
      categories: createdCategories.length,
      channels: createdChannels.length,
      overrides: createdCategories.reduce((n, c) => n + c.overrides.length, 0) + createdChannels.reduce((n, c) => n + c.overrides.length, 0),
      skipped: channels.length - createdChannels.length,
    },
  };
}
