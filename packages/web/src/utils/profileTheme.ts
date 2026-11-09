import type { CSSProperties } from 'react';
import { parseHexColor, relativeLuminance, toHexColor } from '@backspace/shared/src/color.js';
import { isProfileThemeStyle, type ProfileThemeStyle } from '@backspace/shared/src/profileFields.js';
import { adjustColor, hexToRgba, mutedGradient } from './gradients';

export type { ProfileThemeStyle };

/**
 * A profile theme: two colours the person chose (docs/systems/design-system.md, "Profile themes").
 * They make the banner's gradient when there is no banner picture, and colour the profile card as
 * strongly as the person chose (`ProfileThemeStyle`): `soft`, a faint tint at its top; `strong`,
 * the whole card in the two colours, deep enough for every text colour to read on it as on a
 * plain card; `full`, the colours bright across the card, the text on a dark panel in it.
 */

export interface ProfileTheme {
  primary: string;
  secondary: string;
}

export interface ProfileThemePreset extends ProfileTheme {
  /** Key of the preset's name in the catalog (`settings:account.profile.theme.preset.<id>`). */
  id: 'nebula' | 'ember' | 'tide' | 'moss' | 'dusk' | 'sol' | 'slate';
}

export const PROFILE_THEME_PRESETS: readonly ProfileThemePreset[] = [
  { id: 'nebula', primary: '#7443fc', secondary: '#45affd' },
  { id: 'ember', primary: '#f0803c', secondary: '#d6336c' },
  { id: 'tide', primary: '#2bb5a0', secondary: '#3b82f6' },
  { id: 'moss', primary: '#6aa84f', secondary: '#2f8f83' },
  { id: 'dusk', primary: '#c05fd8', secondary: '#e0607e' },
  { id: 'sol', primary: '#f2b84b', secondary: '#f2784b' },
  { id: 'slate', primary: '#7d8aa5', secondary: '#4a5570' },
];

interface ThemeFields {
  accentColor?: string | null;
  accentColorSecondary?: string | null;
}

function validHex(value: string | null | undefined): string | null {
  return typeof value === 'string' && parseHexColor(value) !== null ? value : null;
}

/**
 * The theme a person has chosen, or null when they chose none. With a first
 * colour only, the second is the first made darker, which is how a single
 * colour has always looked.
 */
export function profileThemeOf(fields: ThemeFields): ProfileTheme | null {
  const primary = validHex(fields.accentColor);
  if (primary === null) return null;
  return { primary, secondary: validHex(fields.accentColorSecondary) ?? adjustColor(primary, -40) };
}

/** The banner's background when the person has no banner picture. */
export function bannerBackground(theme: ProfileTheme): string {
  return mutedGradient(theme.primary, theme.secondary);
}

/** The tint laid over the top of the profile card. */
export function cardTint(theme: ProfileTheme): string {
  return `linear-gradient(180deg, ${hexToRgba(theme.primary, 0.2)} 0%, ${hexToRgba(theme.secondary, 0.1)} 38%, transparent 72%)`;
}

/** The card's edge in the theme's first colour. */
export function cardEdge(theme: ProfileTheme): string {
  return hexToRgba(theme.primary, 0.35);
}

/** The style a person chose for their theme; `soft`, the look a theme always had, when none. */
export function profileThemeStyleOf(fields: { profileThemeStyle?: string | null }): ProfileThemeStyle {
  return isProfileThemeStyle(fields.profileThemeStyle) ? fields.profileThemeStyle : 'soft';
}

/**
 * The most light the colour of a `strong` card, or of the panel in a `full` one, may have
 * (relative luminance): at it the quietest text (`--text-tertiary`) still reads at 4.5:1, as it
 * does on a plain card. A `full` card's own colours may be brighter, for no text stands on them.
 */
const READABLE_GROUND = 0.022;
const FULL_TOP = 0.1;
const FULL_BOTTOM = 0.05;

function srgbChannel(linear: number): number {
  const c = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return c * 255;
}

function linearChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * `hex` brought down until its relative luminance is at most `most`, its hue and saturation kept:
 * the channels are scaled in linear light, where luminance is their weighted sum.
 */
export function deepened(hex: string, most: number): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  const luminance = relativeLuminance(rgb);
  if (luminance <= most) return hex.toLowerCase();
  const scale = most / luminance;
  return toHexColor([
    srgbChannel(linearChannel(rgb[0]) * scale),
    srgbChannel(linearChannel(rgb[1]) * scale),
    srgbChannel(linearChannel(rgb[2]) * scale),
  ]);
}

/** How a profile card wears its theme: the card's own style, the ring round the picture on it, and whether its text stands on a panel. */
export interface ProfileCardLook {
  card: CSSProperties;
  /** The colour the picture's ring takes, to cut it out of the card's top; null keeps the card's surface. */
  ring: string | null;
  panel: boolean;
}

export function profileCardLook(theme: ProfileTheme, style: ProfileThemeStyle): ProfileCardLook {
  if (style === 'strong') {
    const top = deepened(theme.primary, READABLE_GROUND);
    return {
      card: { backgroundImage: `linear-gradient(180deg, ${top} 0%, ${deepened(theme.secondary, READABLE_GROUND * 0.7)} 100%)`, borderColor: hexToRgba(theme.primary, 0.5) },
      ring: top,
      panel: false,
    };
  }
  if (style === 'full') {
    const top = deepened(theme.primary, FULL_TOP);
    return {
      card: { backgroundImage: `linear-gradient(180deg, ${top} 0%, ${deepened(theme.secondary, FULL_BOTTOM)} 100%)`, borderColor: hexToRgba(theme.primary, 0.7) },
      ring: top,
      panel: true,
    };
  }
  return { card: { backgroundImage: cardTint(theme), borderColor: cardEdge(theme) }, ring: null, panel: false };
}

/** The preset that `fields` are exactly, if any, ignoring case. */
export function presetOf(fields: ThemeFields): ProfileThemePreset | null {
  const primary = validHex(fields.accentColor)?.toLowerCase();
  const secondary = validHex(fields.accentColorSecondary)?.toLowerCase();
  if (!primary || !secondary) return null;
  return PROFILE_THEME_PRESETS.find((p) => p.primary === primary && p.secondary === secondary) ?? null;
}
