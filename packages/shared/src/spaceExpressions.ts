import { isVisibleSingleLine } from './constants.js';
import type { CustomEmoji } from './customEmoji.js';

/**
 * A space's own emoji and stickers (docs/systems/emoji.md). Whoever may manage them (MANAGE_EMOJIS)
 * adds, renames and removes them; everyone who may write in the space's channels can use them there,
 * and its members can use them anywhere on its instance.
 *
 * A space emoji is an emoji like the instance's own (shared/src/customEmoji.ts): its id comes from
 * the same generator, so the tokens `<:name:id>` and `emoji:<id>` and the picture at
 * `/api/emojis/<id>.webp` serve both kinds, and a reader draws one from its id alone. A space sticker
 * is a named entry over the content-addressed sticker assets (shared/src/stickers.ts), sent with the
 * same token as a personal sticker, so everything that draws or collects stickers works for it.
 */

export const SPACE_EXPRESSION_LIMITS = {
  /** Emoji one space holds: more than a Discord server holds without boosts. */
  EMOJI_PER_SPACE: 200,
  /** Stickers one space holds. */
  STICKERS_PER_SPACE: 60,
  /** Pictures one account may add per minute, emoji and stickers together. */
  UPLOADS_PER_MINUTE: 30,
  /**
   * Stickers one account may upload to spaces in a day. A removed sticker's picture stays on disk
   * until the sticker janitor's grace has passed (server utils/stickerAssets.ts), so adding and
   * removing them over and over would otherwise fill the disk at the per-minute speed. The Discord
   * import does not count: its pictures come from Discord's servers, a few look-ups at a time.
   */
  STICKER_UPLOADS_PER_DAY: 100,
} as const;

/** The longest description of a sticker, read out by screen readers in place of the picture. */
export const MAX_STICKER_DESCRIPTION_LENGTH = 200;

export interface SpaceEmoji {
  id: string;
  spaceId: string;
  name: string;
  animated: boolean;
  /** Who added it, or null when that account is gone. */
  createdBy: string | null;
  createdAt: number;
}

export interface SpaceSticker {
  /** The entry's own id, which renaming and removing name. */
  id: string;
  spaceId: string;
  /** The asset the token names: the SHA-256 of the stored WebP. */
  stickerId: string;
  name: string;
  /** What a screen reader says in place of the picture; null when none was given. */
  description: string | null;
  animated: boolean;
  /** `sticker:<origin>/api/stickers/assets/<stickerId>.webp`, as for a personal sticker. */
  token: string;
  /** Who added it, or null when that account is gone. */
  createdBy: string | null;
  createdAt: number;
}

/** One space's emoji and stickers, as its instance lists them for a member. */
export interface AvailableSpaceExpressions {
  spaceId: string;
  /** By name. */
  emojis: SpaceEmoji[];
  /** In the order they were added. */
  stickers: SpaceSticker[];
}

/**
 * `GET /api/emojis/available`: everything the person may pick on this instance, the library and
 * every space they are in, also those with nothing yet (so a client can tell a space it has not
 * heard of yet). Not part of `ready`: it grows with the spaces a person is in.
 */
export interface AvailableExpressionsResponse {
  library: CustomEmoji[];
  spaces: AvailableSpaceExpressions[];
}

export interface SpaceEmojiRequest {
  name: string;
  /** The picture, base64. */
  image: string;
}

export interface SpaceStickerRequest {
  name: string;
  description?: string | null;
  /** The picture, base64. */
  image: string;
}

export interface SpaceStickerUpdate {
  name?: string;
  description?: string | null;
}

/**
 * The form a sticker's description is stored in: null for none (an empty text included), the trimmed
 * text when it is one visible line no longer than the limit, and undefined when it is not one.
 */
export function normalizeStickerDescription(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_STICKER_DESCRIPTION_LENGTH) return undefined;
  return isVisibleSingleLine(trimmed) ? trimmed : undefined;
}
