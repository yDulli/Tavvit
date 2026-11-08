import { accentColorProblem } from './color.js';

/**
 * Looks (docs/systems/design-system.md, "Looks"): how the app is coloured and shaped, made in the
 * theme studio, kept on a device, shared as a link and offered by a space. What the server and
 * every client must agree on lives here: the range of a surface theme, and a space's look, which
 * the server stores and every client reads back, from this instance or another, by the same rule.
 */

/**
 * The surfaces of a theme as a point: a hue, how much of it the greys take, and how deep they sit
 * (packages/web/src/utils/appTheme.ts derives each surface from it).
 */
export const SURFACE_RANGES = {
  hue: { min: 0, max: 359 },
  strength: { min: 0, max: 100 },
  /** Depth stops at 4: four steps up the floating panel still keeps the primary text at 9:1. */
  depth: { min: -3, max: 4, step: 0.5 },
} as const;

/**
 * The colours a space chooses for itself: its surfaces, and an accent or none (then each member's
 * own, or the instance's). Its members see the space in them while they are in it, unless they
 * turned that off; the shape, the typeface and how messages sit stay each person's own.
 */
export interface SpaceLook {
  hue: number;
  strength: number;
  depth: number;
  /** `#rrggbb`, lower case, one `accentColorProblem` accepts; or null for no accent of its own. */
  accent: string | null;
}

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}

/**
 * A space's look as it may be stored and shown, or null when `value` is not one: a whole hue and
 * strength, a depth in half steps, each in its range, and an accent that keeps white text readable
 * and stays visible on the dark panels. Nothing is brought into range: a look that does not hold
 * is no look.
 */
export function spaceLookOf(value: unknown): SpaceLook | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { hue, strength, depth, accent } = record;
  if (!inRange(hue, SURFACE_RANGES.hue) || !Number.isInteger(hue)) return null;
  if (!inRange(strength, SURFACE_RANGES.strength) || !Number.isInteger(strength)) return null;
  if (!inRange(depth, SURFACE_RANGES.depth) || !Number.isInteger(depth / SURFACE_RANGES.depth.step)) return null;
  if (accent !== null && (typeof accent !== 'string' || accentColorProblem(accent) !== null)) return null;
  return { hue, strength, depth, accent: typeof accent === 'string' ? accent.toLowerCase() : null };
}

/** A space's look as the database keeps it (JSON), read as any arriving look is; null for none. */
export function parseStoredSpaceLook(value: string | null | undefined): SpaceLook | null {
  if (!value) return null;
  try {
    return spaceLookOf(JSON.parse(value));
  } catch {
    return null;
  }
}
