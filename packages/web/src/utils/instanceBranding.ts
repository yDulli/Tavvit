/**
 * What an instance looks like to the person using it: the name in the browser
 * tab and the accent colour of buttons and highlights.
 *
 * Both are set by the administrator (Admin console → General) and read
 * from the public instance info, so the sign-in page already wears them. The
 * accent is one colour; the hover, pressed and text shades are derived from it
 * by `deriveAccentScale`, the same maths the server uses to refuse a colour that
 * would be unreadable.
 */
import { deriveAccentScale, parseHexColor, type Rgb } from '@backspace/shared/src/color.js';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';

/**
 * The CSS variables the accent drives. They hold space-separated channels ("116 67 252").
 * `--on-accent` is what is written on the accent's fill: the stylesheet's own signal is white and
 * carries black, an accent chosen here is one white text reads on (`accentColorProblem`), so it
 * carries white.
 */
export const ACCENT_VARIABLES = [
  '--accent-primary',
  '--accent-primary-hover',
  '--accent-primary-active',
  '--accent-primary-soft',
  '--on-accent',
] as const;

/** White, as channels: the text on an accent a person, a space or an instance chose. */
export const ON_CHOSEN_ACCENT = '255 255 255';

function channels(rgb: Rgb): string {
  return rgb.map((c) => Math.round(c)).join(' ');
}

/**
 * The accent variables for `accent`, or null when it is not a usable `#rrggbb`
 * (the built-in colours in globals.css then stay in force).
 */
export function accentVariables(accent: string | null | undefined): Record<(typeof ACCENT_VARIABLES)[number], string> | null {
  const base = typeof accent === 'string' ? parseHexColor(accent) : null;
  if (!base) return null;
  const scale = deriveAccentScale(base);
  return {
    '--accent-primary': channels(scale.base),
    '--accent-primary-hover': channels(scale.hover),
    '--accent-primary-active': channels(scale.active),
    '--accent-primary-soft': channels(scale.soft),
    '--on-accent': ON_CHOSEN_ACCENT,
  };
}

/**
 * Puts the accent on `root`, or removes a previous one so the defaults apply
 * again. A selected row keeps its neutral background whatever the accent: the
 * accent only marks it with the bar at its edge (design-system.md, ".nav-item").
 */
export function applyAccent(root: HTMLElement, accent: string | null | undefined): void {
  const variables = accentVariables(accent);
  for (const name of ACCENT_VARIABLES) {
    if (variables) root.style.setProperty(name, variables[name]);
    else root.style.removeProperty(name);
  }
}

/** The text of the browser tab: the instance name, with the number of unread conversations in front. */
export function documentTitle(name: string | null | undefined, unread: number): string {
  const label = name?.trim() || DEFAULT_INSTANCE_NAME;
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${label}` : label;
}
