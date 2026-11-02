import { contrastRatio, relativeLuminance, type Rgb } from '@backspace/shared/src/color.js';
import { applyLook, clearLook, DEFAULT_LOOK, type LookSettings } from './appearanceOptions';

/**
 * The look of the app's surfaces, chosen per device.
 *
 * A theme is not a list of colours but a point in a small space: a hue, how
 * strongly the surfaces carry it, and how deep (dark) they are. The surface
 * colours, borders and panel fills are all derived from those three numbers, so
 * the ready-made themes are just named points, a person's own theme is any
 * other point, and every point keeps the ordering that makes the layout read
 * (frame darkest, content lighter, floating panels lightest).
 *
 * Each surface is given a fixed luminance for its depth, whatever the hue:
 * a yellow and a blue at the same HSL lightness differ a lot in brightness,
 * and brightness is what text contrast depends on. The quieter text colours
 * are then lifted just far enough to stay readable on the lifted surfaces. A
 * test checks the ends of every range.
 *
 * The default, Carbon (the graphite of globals.css, a little cool), adds
 * nothing: the colours in globals.css stay in force. The rest of how the app
 * looks (shape, messages, typeface, light) is in appearanceOptions.ts;
 * `applyAppearance` puts both on the page.
 */

export interface SurfaceSettings {
  /** 0 to 359. */
  hue: number;
  /** 0 (grey) to 100 (the most colour the surfaces take). */
  strength: number;
  /** -3 (nearly black) to 4 (lifted), in steps of half a point. */
  depth: number;
}

export const HUE_RANGE = { min: 0, max: 359 } as const;
export const STRENGTH_RANGE = { min: 0, max: 100 } as const;
/**
 * Depth stops at 4: graphite is already lighter than the old near-black, and
 * four steps up its floating panel is as light as five steps once were, the
 * most that still keeps the primary text at 9:1 on it.
 */
export const DEPTH_RANGE = { min: -3, max: 4, step: 0.5 } as const;

export const THEME_IDS = ['carbon', 'slate', 'ink', 'moss', 'clay', 'harbor', 'plum'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeChoice = ThemeId | 'custom';

/** The ready-made themes; Carbon is the default and has no settings of its own. */
export const THEME_PRESETS: Record<Exclude<ThemeId, 'carbon'>, SurfaceSettings> = {
  slate: { hue: 215, strength: 14, depth: 0 },
  ink: { hue: 40, strength: 4, depth: -3 },
  moss: { hue: 110, strength: 16, depth: 0 },
  clay: { hue: 20, strength: 22, depth: 0.5 },
  harbor: { hue: 205, strength: 30, depth: -0.5 },
  plum: { hue: 320, strength: 14, depth: 0 },
};

/**
 * Where Carbon sits, for a custom theme to start from and for its swatch: a
 * blue-grey at low strength reproduces the shipped surfaces to within one
 * step of a channel.
 */
export const CARBON_SETTINGS: SurfaceSettings = { hue: 226, strength: 11, depth: 0 };

/**
 * The surfaces as shipped (globals.css). A theme at depth 0 is exactly as
 * bright as these and differs only in colour. Their order is the layout's.
 */
export const CARBON_SURFACES = {
  '--bg-base': [13, 14, 17],
  '--bg-channel': [17, 18, 22],
  '--bg-chat': [21, 22, 27],
  '--bg-members': [18, 19, 23],
  '--bg-elevated': [30, 31, 37],
  '--bg-input': [12, 13, 16],
  '--border-hard': [35, 36, 43],
  '--border-soft': [50, 51, 60],
  '--interactive-muted': [78, 80, 92],
} as const satisfies Record<string, Rgb>;

type SurfaceToken = keyof typeof CARBON_SURFACES;

/** The quieter text colours as shipped. */
const TEXT_BASES = {
  '--text-secondary': [172, 175, 186],
  '--text-tertiary': [141, 144, 156],
  '--text-category': [150, 153, 166],
} as const satisfies Record<string, Rgb>;

type TextToken = keyof typeof TEXT_BASES;

/**
 * Every variable a surface theme sets. The floating layers' fills (`--glass-bg`
 * and the like) are written in terms of `--bg-elevated` in globals.css, so they
 * follow it without being set here.
 */
export const SURFACE_VARIABLES = [
  ...(Object.keys(CARBON_SURFACES) as SurfaceToken[]),
  ...(Object.keys(TEXT_BASES) as TextToken[]),
] as const;

/** The colour of the browser's own chrome with the default surfaces (`--bg-base`). */
export const DEFAULT_FRAME_COLOR = '#0d0e11';

/** Saturation, in percent, that a strength of 100 gives. */
const MAX_SATURATION = 85;
/** Eight steps of depth double a surface's luminance. */
const DEPTH_STEPS_PER_OCTAVE = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** HSL (h in degrees, s and l in percent) to RGB channels 0 to 255, rounded. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const segment = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] =
    segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
    : segment < 3 ? [0, chroma, x]
    : segment < 4 ? [0, x, chroma]
    : segment < 5 ? [x, 0, chroma]
    : [chroma, 0, x];
  const m = light - chroma / 2;
  return [r1, g1, b1].map((c) => Math.round((c + m) * 255)) as [number, number, number];
}

/** `settings` with every number brought into its range, or the defaults for what is not a number. */
export function normalizeSurface(value: unknown): SurfaceSettings {
  const raw = (value ?? {}) as Partial<Record<keyof SurfaceSettings, unknown>>;
  const number = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    hue: Math.round(clamp(number(raw.hue, CARBON_SETTINGS.hue), HUE_RANGE.min, HUE_RANGE.max)),
    strength: Math.round(clamp(number(raw.strength, CARBON_SETTINGS.strength), STRENGTH_RANGE.min, STRENGTH_RANGE.max)),
    depth: Math.round(clamp(number(raw.depth, CARBON_SETTINGS.depth), DEPTH_RANGE.min, DEPTH_RANGE.max) * 2) / 2,
  };
}

/** The luminance a surface has at `depth`. */
function targetLuminance(token: SurfaceToken, depth: number): number {
  return relativeLuminance(CARBON_SURFACES[token]) * Math.pow(2, depth / DEPTH_STEPS_PER_OCTAVE);
}

/** The colour of one surface as the three channels: this hue and strength, at the luminance its depth asks for. */
export function surfaceChannels(settings: SurfaceSettings, token: SurfaceToken): [number, number, number] {
  const { hue, strength, depth } = normalizeSurface(settings);
  const saturation = (strength / 100) * MAX_SATURATION;
  const target = targetLuminance(token, depth);
  // At a fixed hue and saturation, luminance rises with lightness, so the lightness that gives the target is found by halving.
  let low = 0;
  let high = 100;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (relativeLuminance(hslToRgb(hue, saturation, mid)) < target) low = mid;
    else high = mid;
  }
  return hslToRgb(hue, saturation, (low + high) / 2);
}

/** `base` blended towards white just far enough to reach `minimum` contrast on `surface`; unchanged when it already does. */
export function liftToContrast(base: Rgb, surface: Rgb, minimum: number): [number, number, number] {
  if (contrastRatio(base, surface) >= minimum) return [base[0], base[1], base[2]];
  const blend = (t: number): [number, number, number] =>
    [0, 1, 2].map((i) => Math.round(base[i]! + (255 - base[i]!) * t)) as [number, number, number];
  let low = 0;
  let high = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (contrastRatio(blend(mid), surface) >= minimum) high = mid;
    else low = mid;
  }
  return blend(high);
}

/**
 * The contrast each quieter text colour has on Carbon's lightest surface, the
 * floating panel, which every theme keeps. On the darker surfaces it then has
 * more.
 */
const TEXT_CONTRAST_ON_PANEL: Record<TextToken, number> = {
  '--text-secondary': contrastRatio(TEXT_BASES['--text-secondary'], CARBON_SURFACES['--bg-elevated']),
  '--text-tertiary': contrastRatio(TEXT_BASES['--text-tertiary'], CARBON_SURFACES['--bg-elevated']),
  '--text-category': contrastRatio(TEXT_BASES['--text-category'], CARBON_SURFACES['--bg-elevated']),
};

/** The CSS variables for a surface theme, in the forms globals.css uses. */
export function surfaceVariables(settings: SurfaceSettings): Record<(typeof SURFACE_VARIABLES)[number], string> {
  const out: Record<string, string> = {};
  for (const token of Object.keys(CARBON_SURFACES) as SurfaceToken[]) {
    out[token] = surfaceChannels(settings, token).join(' ');
  }
  // The quieter text keeps the contrast it has on Carbon's floating panel, now on this theme's.
  const panel = surfaceChannels(settings, '--bg-elevated');
  for (const token of Object.keys(TEXT_BASES) as TextToken[]) {
    out[token] = liftToContrast(TEXT_BASES[token], panel, TEXT_CONTRAST_ON_PANEL[token]).join(' ');
  }
  return out as Record<(typeof SURFACE_VARIABLES)[number], string>;
}

/** `#rrggbb` of the darkest surface, for the browser's own chrome. */
export function frameColor(settings: SurfaceSettings): string {
  return '#' + surfaceChannels(settings, '--bg-base').map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** The settings a choice stands for: null for Carbon, which is globals.css as it is. */
export function surfaceOf(choice: ThemeChoice, custom: SurfaceSettings): SurfaceSettings | null {
  if (choice === 'carbon') return null;
  if (choice === 'custom') return normalizeSurface(custom);
  return THEME_PRESETS[choice];
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'custom' || (typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value));
}

/**
 * Ready-made accent colours, Tavvit's own violet (the built-in colour,
 * `DEFAULT_ACCENT_COLOR`) first. Each one is a colour the server's own rule
 * accepts (`accentColorProblem`: white button text stays readable on it and it
 * stays visible on the dark panels); a test keeps it so.
 */
export const ACCENT_CHOICES = [
  { id: 'violet', hex: '#7466e8' },
  { id: 'vermilion', hex: '#e0501f' },
  { id: 'crimson', hex: '#c0283f' },
  { id: 'rose', hex: '#d4376b' },
  { id: 'amber', hex: '#b7791f' },
  { id: 'lime', hex: '#5a8f1c' },
  { id: 'teal', hex: '#0e8f7e' },
  { id: 'sky', hex: '#0f7fc4' },
  { id: 'blue', hex: '#2f6fed' },
  { id: 'orchid', hex: '#a23fd0' },
] as const;

// ── Reading text and motion ────────────────────────────────────────────────

/** How large message text is drawn, as a share of the default 15 pixels. */
export const CHAT_TEXT_SCALES = [0.875, 1, 1.125, 1.25, 1.4] as const;

export function normalizeChatTextScale(value: unknown): number {
  return typeof value === 'number' && CHAT_TEXT_SCALES.some((scale) => scale === value) ? value : 1;
}

// ── Applying ───────────────────────────────────────────────────────────────

export interface AppearanceSettings extends LookSettings {
  theme: ThemeChoice;
  custom: SurfaceSettings;
  /** `#rrggbb` the person chose for buttons and highlights, or null to use the instance's. */
  accent: string | null;
  chatTextScale: number;
  /** Cut animation down whatever the system asks for. */
  reduceMotion: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  ...DEFAULT_LOOK,
  theme: 'carbon',
  custom: CARBON_SETTINGS,
  accent: null,
  chatTextScale: 1,
  reduceMotion: false,
};

/** Puts the surface theme, the look, the text size and the motion setting on `root`; the accent is applied separately. */
export function applyAppearance(root: HTMLElement, appearance: AppearanceSettings): void {
  const surface = surfaceOf(appearance.theme, appearance.custom);
  const variables = surface ? surfaceVariables(surface) : null;
  for (const name of SURFACE_VARIABLES) {
    if (variables) root.style.setProperty(name, variables[name]);
    else root.style.removeProperty(name);
  }

  applyLook(root, appearance);

  if (appearance.chatTextScale !== 1) root.style.setProperty('--chat-text-scale', String(appearance.chatTextScale));
  else root.style.removeProperty('--chat-text-scale');

  if (appearance.reduceMotion) root.dataset.motion = 'reduce';
  else delete root.dataset.motion;

  showFrameColor(surface ? frameColor(surface) : DEFAULT_FRAME_COLOR);
}

/** Tells the browser's chrome, and the desktop app's window buttons, what colour the frame is. */
function showFrameColor(color: string): void {
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', color);
  window.backspace?.setFrameColor?.(color);
}

/** Takes everything `applyAppearance` put on `root` off again. */
export function clearAppearance(root: HTMLElement): void {
  for (const name of SURFACE_VARIABLES) root.style.removeProperty(name);
  clearLook(root);
  root.style.removeProperty('--chat-text-scale');
  delete root.dataset.motion;
  showFrameColor(DEFAULT_FRAME_COLOR);
}
