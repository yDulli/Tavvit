import { ROLE_LIMITS } from './types.js';
import { parseRoleGlyph } from './roleGlyphs.js';

// A role's name and icon as Tavvit stores them (docs/systems/permissions.md,
// "Role display"). The role routes refuse anything else, and the Discord
// template import fits a template's roles to the same rules, so a role reads
// the same however it was made.

/**
 * Characters that would let a name hide or disguise itself: controls,
 * bidirectional controls, zero-width spaces and invisible operators. The
 * joiners and variation selectors emoji and some scripts are made of (U+200C,
 * U+200D, U+FE0E, U+FE0F) are not among them; they hide a name only where
 * they join nothing (see `formatCharacterInPlace`).
 */
const HIDDEN = /[\p{Cc}\u00ad\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;
const HIDDEN_ALL = new RegExp(HIDDEN.source, 'gu');

/** One joiner or variation selector. */
const JOIN_FORMAT = /^[\u200c\u200d\ufe0e\ufe0f]$/u;
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
const SKIN_TONE = /^[\u{1f3fb}-\u{1f3ff}]$/u;
const KEYCAP_BASE = /^[#*0-9]$/u;
/**
 * A letter or mark of a script that writes with joiners (Arabic, Persian,
 * the Indic scripts and others). Latin, Greek and Cyrillic do not, so there a
 * joiner would only make one name look like another.
 */
const JOINING_SCRIPT = /^(?![\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])[\p{L}\p{M}]$/u;

/** What makes an icon an emoji: a pictograph, a flag letter or a keycap. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
/**
 * Letters on their own are a name, not an icon; a keycap's digit comes with
 * U+20E3. A pictograph that Unicode also counts as a letter (the information
 * sign) is an emoji.
 */
const LETTER = /(?!\p{Extended_Pictographic})\p{L}/u;
/** Format characters an emoji is made of: joiners, variation selectors. */
const EMOJI_FORMAT = /[\u200c\u200d\ufe0e\ufe0f]/gu;
/** A subdivision flag (England, Scotland, Wales): the black flag, tag letters, the cancel tag. */
const SUBDIVISION_FLAG = /\u{1f3f4}[\u{e0061}-\u{e007a}]+\u{e007f}/gu;
const ANY_FORMAT = /\p{Cf}/u;

/** `text` cut to at most `max` UTF-16 code units, never through the middle of a character. */
export function cutToLength(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const char of text) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}

/**
 * Whether the joiner or selector at `index` sits where an emoji or a script
 * uses it: a variation selector right after a pictograph or a keycap's base;
 * a zero-width joiner between the parts of an emoji sequence; either joiner
 * between two letters or marks of a script that writes with them. Anywhere
 * else it joins nothing and only makes the text look like other text, or
 * like nothing at all.
 */
function formatCharacterInPlace(chars: readonly string[], index: number): boolean {
  const char = chars[index];
  const before = chars[index - 1] ?? '';
  const after = chars[index + 1] ?? '';
  if (char === '\ufe0e' || char === '\ufe0f') return PICTOGRAPH.test(before) || KEYCAP_BASE.test(before);
  if (JOINING_SCRIPT.test(before) && JOINING_SCRIPT.test(after)) return true;
  return char === '\u200d'
    && (PICTOGRAPH.test(before) || SKIN_TONE.test(before) || before === '\ufe0f')
    && PICTOGRAPH.test(after);
}

function hasStrayFormatCharacter(chars: readonly string[]): boolean {
  return chars.some((char, index) => JOIN_FORMAT.test(char) && !formatCharacterInPlace(chars, index));
}

/** Whether `text` holds a character that would hide or disguise it. */
export function hasHiddenCharacters(text: string): boolean {
  return HIDDEN.test(text) || hasStrayFormatCharacter(Array.from(text));
}

/** `text` without the characters that would hide or disguise it. */
export function withoutHiddenCharacters(text: string): string {
  let chars = Array.from(text.replace(HIDDEN_ALL, ''));
  // Each pass drops at least one character, so this ends; a joiner whose
  // neighbour went in one pass is judged again in the next.
  while (hasStrayFormatCharacter(chars)) {
    chars = chars.filter((char, index) => !JOIN_FORMAT.test(char) || formatCharacterInPlace(chars, index));
  }
  return chars.join('');
}

/**
 * A role name as stored: trimmed, runs of white space collapsed. Null when
 * that leaves nothing, is longer than `ROLE_LIMITS.MAX_NAME_LENGTH` or holds a
 * hidden character.
 */
export function normalizeRoleName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > ROLE_LIMITS.MAX_NAME_LENGTH || hasHiddenCharacters(name)) return null;
  return name;
}

/**
 * Whether `icon` (already trimmed) is what a role icon must be: one of Tavvit's
 * own (`glyph:<id>`, shared/src/roleGlyphs.ts), or an emoji, a flag or a short
 * sequence of them, no letters, no spaces, nothing hidden, at most
 * `ROLE_LIMITS.MAX_ICON_LENGTH` UTF-16 code units. The client offers only the
 * first; emoji stay valid for roles that have one and for Discord templates.
 */
export function isRoleIcon(icon: string): boolean {
  if (parseRoleGlyph(icon)) return true;
  if (icon.length === 0 || icon.length > ROLE_LIMITS.MAX_ICON_LENGTH || /\s/u.test(icon)) return false;
  const bare = icon.replace(SUBDIVISION_FLAG, '\u{1f3f4}').replace(EMOJI_FORMAT, '');
  return !ANY_FORMAT.test(bare) && !/\p{Cc}/u.test(bare) && !LETTER.test(bare) && EMOJI.test(icon);
}
