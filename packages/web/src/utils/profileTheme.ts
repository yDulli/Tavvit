import { parseHexColor } from '@backspace/shared/src/color.js';
import { adjustColor, hexToRgba, mutedGradient } from './gradients';

/**
 * A profile theme: two colours the person chose. They make the banner's
 * gradient when there is no banner picture and a soft tint down the profile
 * card. Only the card's top is tinted and only faintly, so the text on it is as
 * readable with any pair as with none.
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

/** The preset that `fields` are exactly, if any, ignoring case. */
export function presetOf(fields: ThemeFields): ProfileThemePreset | null {
  const primary = validHex(fields.accentColor)?.toLowerCase();
  const secondary = validHex(fields.accentColorSecondary)?.toLowerCase();
  if (!primary || !secondary) return null;
  return PROFILE_THEME_PRESETS.find((p) => p.primary === primary && p.secondary === secondary) ?? null;
}
