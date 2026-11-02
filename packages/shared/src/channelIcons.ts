import { isRoleIcon } from './roleDisplay.js';
import { parseRoleGlyph } from './roleGlyphs.js';

/**
 * A channel's own icon, in place of the one its type has (docs/systems/spaces.md, "Channel icons").
 * As a role's: one of Tavvit's icons (`glyph:<id>`, shared/src/roleGlyphs.ts) or an emoji, but
 * one emoji only, since a row has room for one. None means the type's icon. A space chooses it
 * to give its channels a feel of their own.
 */
export type ChannelIconValue = { ok: true; icon: string | null } | { ok: false };

/** What a request's `icon` stands for: null and an empty string clear it. */
export function normalizeChannelIcon(value: unknown): ChannelIconValue {
  if (value === null) return { ok: true, icon: null };
  if (typeof value !== 'string') return { ok: false };
  const icon = value.trim();
  if (icon === '') return { ok: true, icon: null };
  return isRoleIcon(icon) && (parseRoleGlyph(icon) !== null || isOneCharacter(icon)) ? { ok: true, icon } : { ok: false };
}

/**
 * One character as a reader sees it: an emoji with its skin tone, a flag and a family are one
 * each, two emoji side by side are two. The server always has a segmenter; a browser without
 * one leaves the decision to the server.
 */
function isOneCharacter(text: string): boolean {
  if (typeof Intl.Segmenter !== 'function') return true;
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length === 1;
}
