import { CUSTOM_EMOJI_NAME_MAX, CUSTOM_EMOJI_NAME_MIN } from './customEmoji.js';
import { MAX_STICKER_NAME_LENGTH, normalizeStickerName } from './stickers.js';

/**
 * Bringing a Discord server's emoji and stickers into a space (docs/systems/spaces.md, "Importing
 * emoji and stickers from Discord"). Whoever may manage the space's emoji gives the token of a bot of
 * their own that is on that server, and the server's id. Our server uses the token for exactly two
 * requests to Discord's API (the server's emoji, then its stickers) and forgets it; it keeps the
 * listing in memory and then fetches the pictures from Discord's content servers with no token at
 * all, a few at a time, as the client asks for the next batch.
 *
 * This module is pure: it reads Discord's answers, plans what comes over under which name, and names
 * the addresses the pictures come from. Of Discord's answer only each entry's id, name, the animated
 * flag and a sticker's format are kept. Who uploaded an emoji on Discord (`user`), the roles that
 * could use it, a sticker's tags and description are dropped as they are read.
 */

export const DISCORD_EXPRESSION_LIMITS = {
  /** How long a looked-up listing waits for its import. */
  SESSION_TTL_MS: 30 * 60 * 1000,
  /** Look-ups one account may make in the window: each is two requests to Discord with a token. */
  PREVIEWS_PER_WINDOW: 5,
  PREVIEW_WINDOW_MS: 10 * 60 * 1000,
  /** The most entries either list may hold; a larger answer is taken as malformed. */
  MAX_LISTED_EMOJI: 1000,
  MAX_LISTED_STICKERS: 200,
  /** The most bytes one list from Discord may weigh. */
  MAX_LIST_BYTES: 1_000_000,
  /** Pictures one import request brings over, and how long it keeps starting new ones. */
  BATCH_ITEMS: 8,
  BATCH_BUDGET_MS: 12_000,
  /** No fetch from Discord within a request runs past this; the client's own limit is 30 seconds. */
  BATCH_DEADLINE_MS: 20_000,
} as const;

/** A Discord id: a snowflake of 17 to 20 digits. */
export const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

/** The hosts Discord serves pictures from: the only ones the import fetches a picture from. */
export const DISCORD_CDN_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'] as const;

export type DiscordStickerFormat = 'png' | 'apng' | 'lottie' | 'gif';

export interface DiscordEmojiEntry {
  discordId: string;
  name: string;
  animated: boolean;
  /** Belongs to an integration (a Twitch subscription, an app): not the server's own picture. */
  managed: boolean;
  /** Only some roles could use it on Discord; here every member can. */
  roleRestricted: boolean;
}

export interface DiscordStickerEntry {
  discordId: string;
  name: string;
  format: DiscordStickerFormat;
}

export interface DiscordExpressionListing {
  emojis: DiscordEmojiEntry[];
  stickers: DiscordStickerEntry[];
}

export type DiscordExpressionKind = 'emoji' | 'sticker';

/** Why an entry does not come over, as the report names it (an i18n key, not an error code). */
export type DiscordExpressionSkip = 'already_here' | 'no_room' | 'lottie' | 'managed' | 'not_selected';

/** What changes on the way, as the report names it. */
export type DiscordExpressionNote = 'renamed' | 'still_picture' | 'role_restriction_dropped';

/** What became of an entry the import tried. */
export type DiscordExpressionOutcome = 'imported' | DiscordExpressionSkip | 'download_failed' | 'image_refused';

export interface DiscordExpressionItem {
  /** `emoji:<discordId>` or `sticker:<discordId>`: what a selection names. */
  key: string;
  kind: DiscordExpressionKind;
  discordId: string;
  /** The name on Discord. */
  sourceName: string;
  /** The name it gets here. */
  name: string;
  animated: boolean;
  /** A sticker's format on Discord; absent for an emoji. */
  format?: DiscordStickerFormat;
  action: 'import' | 'skip';
  skip: DiscordExpressionSkip | null;
  notes: DiscordExpressionNote[];
}

/** What the space holds now, against which an import is planned. */
export interface DiscordExpressionTarget {
  emojiNames: readonly string[];
  stickerNames: readonly string[];
  /** The Discord ids an earlier import already brought, emoji and stickers. */
  importedDiscordIds: ReadonlySet<string>;
  emojiRoom: number;
  stickerRoom: number;
  /** The keys picked; null or absent means everything that fits. */
  selection?: ReadonlySet<string> | null;
}

// ─── Wire ─────────────────────────────────────────────────────────────────

export interface DiscordExpressionPreviewRequest {
  spaceId: string;
  guildId: string;
  token: string;
}

export interface DiscordExpressionPreview {
  importId: string;
  expiresAt: number;
  items: DiscordExpressionItem[];
  /** Room left in the space now. */
  room: { emoji: number; stickers: number };
  limits: { emoji: number; stickers: number };
}

export interface DiscordExpressionApplyRequest {
  importId: string;
  /** The keys to bring over; sent until a call has been answered, and read from the first that arrives. */
  selection?: string[];
  /** How many results the client has already: the answer carries those after them. */
  after?: number;
}

export interface DiscordExpressionResult {
  key: string;
  kind: DiscordExpressionKind;
  discordId: string;
  name: string;
  outcome: DiscordExpressionOutcome;
}

export interface DiscordExpressionApplyResult {
  /** Entries settled so far, out of `total` picked. */
  done: number;
  total: number;
  finished: boolean;
  /** Why the import stopped before the end; null while it runs or once it is through. */
  stopped: 'storage_limit_reached' | 'disk_full' | null;
  /**
   * Everything settled after the client's cursor (`after`): what this call settled, and what an
   * earlier answer carried that never arrived.
   */
  results: DiscordExpressionResult[];
}

// ─── Reading Discord's answers ─────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function discordIdOf(value: unknown): string | null {
  return typeof value === 'string' && DISCORD_SNOWFLAKE.test(value) ? value : null;
}

function discordNameOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, 64);
  return name.length > 0 ? name : null;
}

/**
 * A server's emoji from `GET /guilds/{id}/emojis`, or null when the answer is not such a list. An
 * entry without an id or a name (Discord gives such for deleted ones) is left out.
 */
export function readDiscordEmojiList(raw: unknown): DiscordEmojiEntry[] | null {
  if (!Array.isArray(raw) || raw.length > DISCORD_EXPRESSION_LIMITS.MAX_LISTED_EMOJI) return null;
  const emojis: DiscordEmojiEntry[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const discordId = discordIdOf(entry.id);
    const name = discordNameOf(entry.name);
    if (!discordId || !name) continue;
    emojis.push({
      discordId,
      name,
      animated: entry.animated === true,
      managed: entry.managed === true,
      roleRestricted: Array.isArray(entry.roles) && entry.roles.length > 0,
    });
  }
  return emojis;
}

const STICKER_FORMATS: Record<number, DiscordStickerFormat> = { 1: 'png', 2: 'apng', 3: 'lottie', 4: 'gif' };

/**
 * A server's own stickers from `GET /guilds/{id}/stickers`, or null when the answer is not such a
 * list. Discord's standard stickers (type 1) are not the server's and are left out, as is a format
 * this code does not know.
 */
export function readDiscordStickerList(raw: unknown): DiscordStickerEntry[] | null {
  if (!Array.isArray(raw) || raw.length > DISCORD_EXPRESSION_LIMITS.MAX_LISTED_STICKERS) return null;
  const stickers: DiscordStickerEntry[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    if (entry.type !== undefined && entry.type !== 2) continue;
    const discordId = discordIdOf(entry.id);
    const name = discordNameOf(entry.name);
    const format = typeof entry.format_type === 'number' ? STICKER_FORMATS[entry.format_type] : undefined;
    if (!discordId || !name || !format) continue;
    stickers.push({ discordId, name, format });
  }
  return stickers;
}

// ─── Names ────────────────────────────────────────────────────────────────

/** The emoji name a Discord name becomes here: lower case, letters, digits and underscores, 2 to 32 of them. */
export function emojiNameFromDiscord(name: string): string {
  let base = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, CUSTOM_EMOJI_NAME_MAX);
  while (base.length < CUSTOM_EMOJI_NAME_MIN) base += '_';
  return base;
}

/** The sticker name a Discord name becomes here. */
export function stickerNameFromDiscord(name: string): string {
  return normalizeStickerName(name) ?? 'sticker';
}

/**
 * The first of `base`, `base_2`, `base_3`… (emoji) or `base (2)`… (stickers) that `taken` does not
 * hold, within the kind's length; `taken` holds names in lower case.
 */
export function freeExpressionName(base: string, taken: ReadonlySet<string>, kind: DiscordExpressionKind): string {
  const fold = (value: string) => value.toLowerCase();
  if (!taken.has(fold(base))) return base;
  const max = kind === 'emoji' ? CUSTOM_EMOJI_NAME_MAX : MAX_STICKER_NAME_LENGTH;
  for (let n = 2; ; n += 1) {
    const suffix = kind === 'emoji' ? `_${n}` : ` (${n})`;
    const candidate = `${base.slice(0, max - suffix.length)}${suffix}`;
    if (!taken.has(fold(candidate))) return candidate;
  }
}

// ─── The plan ─────────────────────────────────────────────────────────────

/** The key a selection names an entry by. */
export function discordExpressionKey(kind: DiscordExpressionKind, discordId: string): string {
  return `${kind}:${discordId}`;
}

/**
 * What comes over, in Discord's order, emoji first: each entry with the name it gets here (free in
 * the space and among what this import brings, compared without regard to case), or the reason it
 * stays behind. Room is taken in that order, so what does not fit is the end of Discord's list.
 */
export function planDiscordExpressionImport(listing: DiscordExpressionListing, target: DiscordExpressionTarget): DiscordExpressionItem[] {
  const items: DiscordExpressionItem[] = [];
  const takenEmoji = new Set(target.emojiNames.map((name) => name.toLowerCase()));
  const takenStickers = new Set(target.stickerNames.map((name) => name.toLowerCase()));
  let emojiRoom = Math.max(0, target.emojiRoom);
  let stickerRoom = Math.max(0, target.stickerRoom);

  // What was not picked is out first, whatever else is true of it, so a report on a selection names
  // only what was picked; then what cannot come over at all; then what an earlier import brought.
  const decide = (key: string, discordId: string, cannotCome: DiscordExpressionSkip | null): DiscordExpressionSkip | null => {
    if (target.selection && !target.selection.has(key)) return 'not_selected';
    if (cannotCome) return cannotCome;
    if (target.importedDiscordIds.has(discordId)) return 'already_here';
    return null;
  };

  for (const emoji of listing.emojis) {
    const key = discordExpressionKey('emoji', emoji.discordId);
    const base = emojiNameFromDiscord(emoji.name);
    let skip = decide(key, emoji.discordId, emoji.managed ? 'managed' : null);
    if (skip === null && emojiRoom === 0) skip = 'no_room';
    const notes: DiscordExpressionNote[] = [];
    let name = base;
    if (skip === null) {
      name = freeExpressionName(base, takenEmoji, 'emoji');
      takenEmoji.add(name.toLowerCase());
      emojiRoom -= 1;
      if (name !== emoji.name) notes.push('renamed');
      if (emoji.roleRestricted) notes.push('role_restriction_dropped');
    }
    items.push({ key, kind: 'emoji', discordId: emoji.discordId, sourceName: emoji.name, name, animated: emoji.animated, action: skip ? 'skip' : 'import', skip, notes });
  }

  for (const sticker of listing.stickers) {
    const key = discordExpressionKey('sticker', sticker.discordId);
    const base = stickerNameFromDiscord(sticker.name);
    let skip = decide(key, sticker.discordId, sticker.format === 'lottie' ? 'lottie' : null);
    if (skip === null && stickerRoom === 0) skip = 'no_room';
    const notes: DiscordExpressionNote[] = [];
    let name = base;
    if (skip === null) {
      name = freeExpressionName(base, takenStickers, 'sticker');
      takenStickers.add(name.toLowerCase());
      stickerRoom -= 1;
      if (name !== sticker.name) notes.push('renamed');
      if (sticker.format === 'apng') notes.push('still_picture');
    }
    items.push({
      key, kind: 'sticker', discordId: sticker.discordId, sourceName: sticker.name, name,
      animated: sticker.format === 'gif', format: sticker.format, action: skip ? 'skip' : 'import', skip, notes,
    });
  }
  return items;
}

/**
 * Where an entry's picture is on Discord's content servers, or null for a sticker that is not a
 * picture (Lottie). The only addresses the import fetches a picture from.
 */
export function discordAssetUrl(item: { kind: DiscordExpressionKind; discordId: string; animated: boolean; format?: DiscordStickerFormat }): string | null {
  if (!DISCORD_SNOWFLAKE.test(item.discordId)) return null;
  if (item.kind === 'emoji') return `https://cdn.discordapp.com/emojis/${item.discordId}.${item.animated ? 'gif' : 'png'}`;
  if (item.format === 'gif') return `https://media.discordapp.net/stickers/${item.discordId}.gif`;
  if (item.format === 'png' || item.format === 'apng') return `https://cdn.discordapp.com/stickers/${item.discordId}.png`;
  return null;
}
