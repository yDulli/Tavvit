import { hslToRgb } from './appTheme';
import { adjustColor } from './gradients';

/** How colourful and how bright the light of a place may be, in percent. */
const SATURATION = { min: 42, max: 86 };
const LIGHTNESS = { min: 56, max: 70 };

/** A `#rrggbb` as hue in degrees and saturation and lightness in percent. */
function hexToHsl(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const [r, g, b] = [match[1]!, match[2]!, match[3]!].map((part) => parseInt(part, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation * 100, lightness * 100];
}

/**
 * The light a colour gives. A place's colour is often a deep tile (a space's fill
 * carries white initials) or almost white (a logo), and neither lights a dark room,
 * so its hue is kept and its strength is brought into a range that does. A grey stays
 * grey: a place with no colour of its own has a neutral light, not an invented one.
 */
export function lightFromColor(hex: string): string | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const [hue, saturation, lightness] = hsl;
  const strength = saturation < 8 ? saturation : Math.min(SATURATION.max, Math.max(SATURATION.min, saturation));
  const [r, g, b] = hslToRgb(hue, strength, Math.min(LIGHTNESS.max, Math.max(LIGHTNESS.min, lightness)));
  return `rgb(${r} ${g} ${b})`;
}

/**
 * A band painted in a colour rather than with a picture (a space's card, a profile's
 * banner): lit from its top corner, deepening away from it. Goes with `.banner-depth`.
 */
export function bannerFill(hex: string): string {
  return `radial-gradient(120% 150% at 85% -20%, ${lightFromColor(hex) ?? hex} 0%, ${hex} 48%, ${adjustColor(hex, -34)} 100%)`;
}
