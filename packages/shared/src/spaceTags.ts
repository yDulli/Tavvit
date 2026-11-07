import { ROLE_GLYPH_IDS, type RoleGlyphId } from './roleGlyphs.js';

/**
 * Space tags (docs/systems/space-tags.md): a short mark a space can have, two to four letters or
 * digits beside a symbol of Tavvit's own set, in one of the accent colours. Its members can wear
 * it beside their name wherever this instance shows them, and a click on it shows the space, so a
 * community is seen by everyone its people meet. The space decides the tag (MANAGE_SPACE); each
 * member decides whether to wear it.
 */

/** The colours a tag can have: the accent family, and silver for none of them. */
export const SPACE_TAG_COLORS = ['silver', 'mint', 'peach', 'lavender', 'sky', 'amber', 'rose', 'coral'] as const;
export type SpaceTagColor = (typeof SPACE_TAG_COLORS)[number];

export const SPACE_TAG_LIMITS = { MIN_LENGTH: 2, MAX_LENGTH: 4 } as const;

/** A space's tag. */
export interface SpaceTag {
  text: string;
  glyph: RoleGlyphId;
  color: SpaceTagColor;
}

/** The tag a person wears: the space's, and which space it is (on the instance that sent the person). */
export interface WornSpaceTag extends SpaceTag {
  spaceId: string;
}

/** Why a tag is refused. */
export type SpaceTagRefusal = 'length' | 'characters' | 'reserved' | 'glyph' | 'color';

/**
 * Words a tag may not be, in any case: beside a name they would read as a mark of the platform
 * or of a role, which only the instance and a space's roles give (docs/systems/badges.md).
 */
const RESERVED: ReadonlySet<string> = new Set(['MOD', 'MODS', 'ADM', 'ADMN', 'STAF', 'TEAM', 'SYS', 'BOT', 'BOTS', 'HELP', 'OWNR', 'TAV', 'TAVV']);

const GLYPHS: ReadonlySet<string> = new Set(ROLE_GLYPH_IDS);
const COLORS: ReadonlySet<string> = new Set(SPACE_TAG_COLORS);
const LETTERS_AND_DIGITS = /^[\p{L}\p{N}]+$/u;
/** Scripts whose letters look alike: a tag keeps to one of them, so it cannot pass for another word. */
const LOOKALIKE_SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];

export function isSpaceTagColor(value: unknown): value is SpaceTagColor {
  return typeof value === 'string' && COLORS.has(value);
}

/** A tag as a space stores it (the text trimmed and composed), or why it is refused. */
export function checkSpaceTag(value: unknown): { ok: true; tag: SpaceTag } | { ok: false; reason: SpaceTagRefusal } {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'length' };
  const { text, glyph, color } = value as Record<string, unknown>;
  if (typeof text !== 'string') return { ok: false, reason: 'length' };
  const normalized = text.normalize('NFC').trim();
  const characters = [...normalized];
  if (characters.length < SPACE_TAG_LIMITS.MIN_LENGTH || characters.length > SPACE_TAG_LIMITS.MAX_LENGTH) {
    return { ok: false, reason: 'length' };
  }
  if (!LETTERS_AND_DIGITS.test(normalized)) return { ok: false, reason: 'characters' };
  const scripts = LOOKALIKE_SCRIPTS.filter((script) => characters.some((character) => script.test(character)));
  if (scripts.length > 1) return { ok: false, reason: 'characters' };
  if (RESERVED.has(normalized.toUpperCase())) return { ok: false, reason: 'reserved' };
  if (typeof glyph !== 'string' || !GLYPHS.has(glyph)) return { ok: false, reason: 'glyph' };
  if (!isSpaceTagColor(color)) return { ok: false, reason: 'color' };
  return { ok: true, tag: { text: normalized, glyph: glyph as RoleGlyphId, color } };
}

/** A tag from anywhere (a stored column, a host's row): what passes the rules, or null. */
export function spaceTagOf(value: unknown): SpaceTag | null {
  const checked = checkSpaceTag(value);
  return checked.ok ? checked.tag : null;
}

/** A worn tag from anywhere: the space's id and a tag that passes the rules, or null. */
export function wornSpaceTagOf(value: unknown): WornSpaceTag | null {
  if (!value || typeof value !== 'object') return null;
  const { spaceId } = value as Record<string, unknown>;
  if (typeof spaceId !== 'string' || !/^\d{1,24}$/.test(spaceId)) return null;
  const tag = spaceTagOf(value);
  return tag ? { ...tag, spaceId } : null;
}

/** A stored JSON column read back: null for none, or for anything that no longer passes. */
export function parseStoredSpaceTag(stored: string | null | undefined): SpaceTag | null {
  if (!stored) return null;
  try {
    return spaceTagOf(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function parseStoredWornSpaceTag(stored: string | null | undefined): WornSpaceTag | null {
  if (!stored) return null;
  try {
    return wornSpaceTagOf(JSON.parse(stored));
  } catch {
    return null;
  }
}
