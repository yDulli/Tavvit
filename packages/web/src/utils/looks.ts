import { accentColorProblem } from '@backspace/shared/src/color.js';
import type { SpaceLook } from '@backspace/shared/src/looks.js';
import {
  normalizeOption,
  type AvatarShape,
  type Corners,
  type Density,
  type Font,
  type Light,
  type MessageStyle,
} from './appearanceOptions';
import {
  CARBON_SETTINGS,
  THEME_IDS,
  THEME_PRESETS,
  normalizeSurface,
  surfaceOf,
  type AppearanceSettings,
  type SurfaceSettings,
  type ThemeChoice,
} from './appTheme';

/**
 * Looks (docs/systems/design-system.md, "Looks"): how the app is coloured and shaped, as one thing
 * that can be named, kept, shared as a link and offered by a space. A look is the surfaces, the
 * accent, the light, the corners, the typeface, the shape of pictures, and how messages are drawn
 * and spaced. What helps a person read (contrast, text size, motion, status colours, underlined
 * links, the clock, the sidebar's width) is never part of one: putting on a look leaves it as it is.
 */
export interface Look {
  surface: SurfaceSettings;
  /** `#rrggbb` for buttons and highlights, or null for the instance's. */
  accent: string | null;
  light: Light;
  corners: Corners;
  font: Font;
  avatarShape: AvatarShape;
  messageStyle: MessageStyle;
  density: Density;
}

/** How long a look's name may be, in characters. */
export const LOOK_NAME_MAX = 40;

/** The look a device shows now, out of its appearance settings. */
export function lookOfAppearance(appearance: AppearanceSettings): Look {
  return {
    surface: surfaceOf(appearance.theme, appearance.custom) ?? CARBON_SETTINGS,
    accent: appearance.accent,
    light: appearance.light,
    corners: appearance.corners,
    font: appearance.font,
    avatarShape: appearance.avatarShape,
    messageStyle: appearance.messageStyle,
    density: appearance.density,
  };
}

export function sameSurface(a: SurfaceSettings, b: SurfaceSettings): boolean {
  return a.hue === b.hue && a.strength === b.strength && a.depth === b.depth;
}

/** The theme a surface is: Carbon or a ready-made one when it is exactly that point, else the person's own. */
export function themeChoiceOf(surface: SurfaceSettings): ThemeChoice {
  if (sameSurface(surface, CARBON_SETTINGS)) return 'carbon';
  for (const id of THEME_IDS) {
    if (id !== 'carbon' && sameSurface(surface, THEME_PRESETS[id])) return id;
  }
  return 'custom';
}

/** What putting `look` on a device sets: the theme it is (and its own surfaces only when it is no ready-made one), the accent and the shape. */
export function appearanceOfLook(look: Look): Pick<AppearanceSettings, 'theme' | 'accent' | 'light' | 'corners' | 'font' | 'avatarShape' | 'messageStyle' | 'density'> & { custom?: SurfaceSettings } {
  const theme = themeChoiceOf(look.surface);
  return {
    theme,
    ...(theme === 'custom' ? { custom: look.surface } : {}),
    accent: look.accent,
    light: look.light,
    corners: look.corners,
    font: look.font,
    avatarShape: look.avatarShape,
    messageStyle: look.messageStyle,
    density: look.density,
  };
}

export function sameLook(a: Look, b: Look): boolean {
  return sameSurface(a.surface, b.surface)
    && a.accent === b.accent
    && a.light === b.light
    && a.corners === b.corners
    && a.font === b.font
    && a.avatarShape === b.avatarShape
    && a.messageStyle === b.messageStyle
    && a.density === b.density;
}

/** A look read from anywhere (this device's store, a link): each part brought into its range or options; null when it is not an object. */
export function lookOf(value: unknown): Look | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Partial<Record<keyof Look, unknown>>;
  return {
    surface: normalizeSurface(raw.surface),
    accent: typeof raw.accent === 'string' && accentColorProblem(raw.accent) === null ? raw.accent.toLowerCase() : null,
    light: normalizeOption('light', raw.light),
    corners: normalizeOption('corners', raw.corners),
    font: normalizeOption('font', raw.font),
    avatarShape: normalizeOption('avatarShape', raw.avatarShape),
    messageStyle: normalizeOption('messageStyle', raw.messageStyle),
    density: normalizeOption('density', raw.density),
  };
}

/** A look's name: one line of plain text, at most `LOOK_NAME_MAX` characters; null when nothing is left. */
export function lookNameOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
  const name = [...value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, LOOK_NAME_MAX).join('').trim();
  return name || null;
}

// ── Links ──────────────────────────────────────────────────────────────────

/** The version of the link's format, before its first dot. */
const LINK_VERSION = '1';
/** The longest fragment a look's link is read from: a look is far shorter. */
const LINK_MAX = 2048;

interface LinkPayload {
  n: string;
  h: number;
  s: number;
  d: number;
  a: string | null;
  l: Light;
  c: Corners;
  f: Font;
  p: AvatarShape;
  m: MessageStyle;
  y: Density;
}

function base64UrlOf(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textOfBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * A look and its name as the part of a link after `#`. The whole look is in it, so a link needs
 * no server: it is never sent to one (a browser keeps what follows `#` to itself), it works on
 * any instance, and nothing is kept anywhere until someone puts it on.
 */
export function encodeLook(look: Look, name: string): string {
  const payload: LinkPayload = {
    n: lookNameOf(name) ?? '',
    h: look.surface.hue,
    s: look.surface.strength,
    d: look.surface.depth,
    a: look.accent,
    l: look.light,
    c: look.corners,
    f: look.font,
    p: look.avatarShape,
    m: look.messageStyle,
    y: look.density,
  };
  return `${LINK_VERSION}.${base64UrlOf(JSON.stringify(payload))}`;
}

/** The look and name a link's part after `#` holds, read as any look is; null when it holds none. */
export function decodeLook(fragment: string): { name: string | null; look: Look } | null {
  const value = fragment.replace(/^#/, '');
  if (value.length > LINK_MAX || !value.startsWith(`${LINK_VERSION}.`)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(textOfBase64Url(value.slice(LINK_VERSION.length + 1)));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const raw = payload as Partial<Record<keyof LinkPayload, unknown>>;
  const look = lookOf({
    surface: { hue: raw.h, strength: raw.s, depth: raw.d },
    accent: raw.a,
    light: raw.l,
    corners: raw.c,
    font: raw.f,
    avatarShape: raw.p,
    messageStyle: raw.m,
    density: raw.y,
  });
  return look ? { name: lookNameOf(raw.n), look } : null;
}

/** The address of the page that shows a look and offers to put it on (`/look#…`). */
export function lookAddress(look: Look, name: string, origin: string = window.location.origin): string {
  return `${origin}/look#${encodeLook(look, name)}`;
}

// ── A space's look ─────────────────────────────────────────────────────────

/** The part of a look a space can choose for itself: its colours. */
export function spaceLookOfLook(look: Look): SpaceLook {
  const surface = normalizeSurface(look.surface);
  return { hue: surface.hue, strength: surface.strength, depth: surface.depth, accent: look.accent };
}

/**
 * The appearance a device shows in a space that chose its colours: the space's surfaces, and its
 * accent when it chose one; everything else, the shape and all that helps reading, the person's.
 */
export function withSpaceLook(appearance: AppearanceSettings, look: SpaceLook): AppearanceSettings {
  const surface: SurfaceSettings = { hue: look.hue, strength: look.strength, depth: look.depth };
  const theme = themeChoiceOf(surface);
  return {
    ...appearance,
    theme,
    custom: theme === 'custom' ? surface : appearance.custom,
    accent: look.accent ?? appearance.accent,
  };
}
