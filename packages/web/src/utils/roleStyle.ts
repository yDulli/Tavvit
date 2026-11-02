import type { CSSProperties } from 'react';
import type { Role } from '@backspace/shared';

// How a role colours a name: its colour, or the gradient from its colour to
// its second one (`Role.colorSecondary`). Every surface that draws a name in
// a role's colours reads it here, so a gradient looks the same in the member
// list, on the profile card and in the role editor.

/**
 * A role's colour as it is drawn: `#rrggbb` and nothing else. A role of a space on another instance
 * comes from that instance as it sent it, and a value put into a gradient as it is could add a layer
 * that loads an address from anywhere (`red), url(https://...)`), past the client's gate.
 */
function hexOf(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

/** The style of text drawn in `role`'s colours. */
export function roleTextStyle(role: Pick<Role, 'color' | 'colorSecondary'>): CSSProperties {
  const color = hexOf(role.color);
  const second = hexOf(role.colorSecondary);
  if (!color || !second) return { color };
  return {
    color,
    backgroundImage: `linear-gradient(90deg, ${color}, ${second})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  };
}

/** The style of a role's colour dot: its colour, or a split of its two. */
export function roleDotStyle(role: Pick<Role, 'color' | 'colorSecondary'>): CSSProperties {
  const color = hexOf(role.color);
  const second = hexOf(role.colorSecondary);
  if (!color || !second) return { backgroundColor: color };
  return { backgroundImage: `linear-gradient(135deg, ${color} 50%, ${second} 50%)` };
}
