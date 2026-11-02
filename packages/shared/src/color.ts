/**
 * Colour helpers shared by the server (which validates the instance accent
 * colour an admin chooses) and the web client (which derives the hover,
 * pressed and text shades from it). Keeping the maths in one file means the
 * server can never accept a colour the client then renders unreadably.
 *
 * Contrast follows WCAG 2.x: relative luminance of the sRGB channels, ratio
 * (L1 + 0.05) / (L2 + 0.05).
 */

export type Rgb = readonly [number, number, number];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb` (any case) to channels 0-255, or null when it is not exactly that form. */
export function parseHexColor(value: string): Rgb | null {
  if (!HEX_COLOR.test(value)) return null;
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}

/** Channels 0-255 (clamped and rounded) to lowercase `#rrggbb`. */
export function toHexColor(rgb: Rgb): string {
  return '#' + rgb
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('');
}

function linearChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2]);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE: Rgb = [255, 255, 255];

/** The chat surface the accent has to stay visible against (`--bg-chat`). */
export const ACCENT_REFERENCE_SURFACE: Rgb = [19, 19, 26];

/** Primary buttons carry white text, so the accent must be dark enough for it. */
export const ACCENT_MIN_CONTRAST_WITH_WHITE = 3.5;

/** The accent also tints icons and indicators on the dark panels, so it must not vanish into them. */
export const ACCENT_MIN_CONTRAST_WITH_SURFACE = 2.5;

export type AccentColorProblem =
  /** Not a `#rrggbb` string. */
  | 'invalid'
  /** Too light: white button text would be hard to read on it. */
  | 'too_light'
  /** Too dark: it would disappear into the dark panels. */
  | 'too_dark';

/** What is wrong with a candidate instance accent colour, or null when it is usable. */
export function accentColorProblem(value: unknown): AccentColorProblem | null {
  if (typeof value !== 'string') return 'invalid';
  const rgb = parseHexColor(value);
  if (!rgb) return 'invalid';
  if (contrastRatio(rgb, WHITE) < ACCENT_MIN_CONTRAST_WITH_WHITE) return 'too_light';
  if (contrastRatio(rgb, ACCENT_REFERENCE_SURFACE) < ACCENT_MIN_CONTRAST_WITH_SURFACE) return 'too_dark';
  return null;
}

/**
 * The accent shades the UI needs, derived from the one colour an admin picks.
 * `hover` and `active` are the button states (progressively darker); `soft` is
 * the same hue lifted until it reads as text on the dark panels (4.5:1 against
 * the chat surface, the WCAG AA threshold for body text).
 */
export interface AccentScale {
  base: Rgb;
  hover: Rgb;
  active: Rgb;
  soft: Rgb;
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

const BLACK: Rgb = [0, 0, 0];

export function deriveAccentScale(base: Rgb): AccentScale {
  const hover = mix(base, BLACK, 0.12);
  const active = mix(base, BLACK, 0.24);
  // Walk toward white until the shade clears AA on the chat surface. The loop is
  // bounded: pure white always passes, and 20 steps of 5% reach it.
  let soft: Rgb = base;
  for (let step = 0; step <= 20 && contrastRatio(soft, ACCENT_REFERENCE_SURFACE) < 4.5; step += 1) {
    soft = mix(base, WHITE, step * 0.05);
  }
  return { base, hover, active, soft };
}
