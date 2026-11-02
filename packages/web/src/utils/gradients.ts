/**
 * Tavvit's palettes for avatars and space icons.
 * Deterministic color assignment based on entity ID (snowflake) or name.
 *
 * Seven muted tones, each a little lighter at its top, as if lit from above; every
 * one carries white initials at 3:1 or better.
 * The names are the `AvatarColor` values stored in the database, so they stay;
 * only the colours behind them changed. A space's tile is the same hue a step
 * deeper than a person's, so a space and a person are never the same picture.
 *
 * `gradient` is the CSS background of the tile, `from` and `to` its colour, `glow`
 * the colour of a selection ring.
 */

import type { AvatarColor } from '@backspace/shared';

export interface GradientEntry {
  from: string;      // hex colour of the tile
  to: string;        // the same colour
  gradient: string;  // the CSS background of the tile
  glow: string;      // hex colour of a selection ring around it
}

/** A tile's fill, in the shape every reader of these palettes expects. */
function flat(color: string): GradientEntry {
  return { from: color, to: color, gradient: `linear-gradient(170deg, ${adjustColor(color, 22)} 0%, ${color} 62%)`, glow: color };
}

// ── Avatar tiles (user fallbacks) ──
const AVATAR_GRADIENTS: GradientEntry[] = [
  flat('#2f8f6a'),   // mint
  flat('#3a72c8'),   // sky
  flat('#6d5ec8'),   // lavender
  flat('#c8553a'),   // coral
  flat('#b84a72'),   // rose
  flat('#25818c'),   // teal
  flat('#a87414'),   // amber
];

export const AVATAR_GRADIENT_MAP: Record<AvatarColor, GradientEntry> = {
  mint:     AVATAR_GRADIENTS[0]!,
  sky:      AVATAR_GRADIENTS[1]!,
  lavender: AVATAR_GRADIENTS[2]!,
  coral:    AVATAR_GRADIENTS[3]!,
  rose:     AVATAR_GRADIENTS[4]!,
  teal:     AVATAR_GRADIENTS[5]!,
  amber:    AVATAR_GRADIENTS[6]!,
};

// ── Space tiles (space fallbacks): the same hues, a step deeper ──
export const SPACE_GRADIENTS: GradientEntry[] = [
  flat('#a8442c'),   // coral
  flat('#9a3c5f'),   // rose
  flat('#1e6b74'),   // teal
  flat('#8d600f'),   // amber
  flat('#2f5ea8'),   // sky
  flat('#5a4da8'),   // lavender
  flat('#26765a'),   // mint
];

export const SPACE_GRADIENT_MAP: Record<AvatarColor, GradientEntry> = {
  coral:    SPACE_GRADIENTS[0]!,
  rose:     SPACE_GRADIENTS[1]!,
  teal:     SPACE_GRADIENTS[2]!,
  amber:    SPACE_GRADIENTS[3]!,
  sky:      SPACE_GRADIENTS[4]!,
  lavender: SPACE_GRADIENTS[5]!,
  mint:     SPACE_GRADIENTS[6]!,
};

/** djb2 hash → stable unsigned 32-bit integer. */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic gradient for a user avatar. Uses stored avatarColor if available; falls back to hash. */
export function getAvatarGradient(id?: string | null, name?: string, avatarColor?: string | null): GradientEntry {
  // Only a colour of the map's own: `'constructor' in` an object is true, and its value no gradient.
  if (avatarColor && Object.hasOwn(AVATAR_GRADIENT_MAP, avatarColor)) {
    return AVATAR_GRADIENT_MAP[avatarColor as AvatarColor];
  }
  const key = id || name || 'unknown';
  return AVATAR_GRADIENTS[hashString(key) % AVATAR_GRADIENTS.length]!;
}

/** Deterministic gradient for a space icon. Uses stored avatarColor if available; falls back to hash. */
export function getSpaceGradient(id?: string | null, name?: string, avatarColor?: string | null): GradientEntry {
  if (avatarColor && Object.hasOwn(SPACE_GRADIENT_MAP, avatarColor)) {
    return SPACE_GRADIENT_MAP[avatarColor as AvatarColor];
  }
  const key = id || name || 'unknown';
  return SPACE_GRADIENTS[hashString(key) % SPACE_GRADIENTS.length]!;
}

/** Banner-color presets: 7 families × 3 shades (deep, vibrant, soft). */
export const BANNER_COLOR_PRESETS: string[][] = [
  ['#047857', '#10b981', '#6ee7b7'],   // mint
  ['#4338ca', '#6366f1', '#a5b4fc'],   // sky
  ['#7c3aed', '#c084fc', '#e9d5ff'],   // lavender
  ['#c2410c', '#f97316', '#fdba74'],   // coral
  ['#be185d', '#ec4899', '#f9a8d4'],   // rose
  ['#0e7490', '#06b6d4', '#67e8f9'],   // teal
  ['#b45309', '#f59e0b', '#fcd34d'],   // amber
];

/** @deprecated Use BANNER_COLOR_PRESETS instead. */
export const ACCENT_PRESETS: string[] = BANNER_COLOR_PRESETS.map(f => f[1]!);

/** Convert 6-digit hex (#rrggbb) to rgba string. */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Build a banner-style muted gradient from two hex colors with baked-in alpha. */
export function mutedGradient(from: string, to: string, alpha = 0.6): string {
  return `linear-gradient(135deg, ${hexToRgba(from, alpha)}, ${hexToRgba(to, alpha)})`;
}

/** Shift each RGB component of a hex color by `amount` (positive = lighter, negative = darker). */
export function adjustColor(hex: string, amount: number): string {
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
