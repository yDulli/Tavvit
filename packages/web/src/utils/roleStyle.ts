import type { CSSProperties } from 'react';
import type { Role } from '@backspace/shared';

// How a role colours a name: its colour, or the gradient from its colour to
// its second one (`Role.colorSecondary`). Every surface that draws a name in
// a role's colours reads it here, so a gradient looks the same in the member
// list, on the profile card and in the role editor.

/** The style of text drawn in `role`'s colours. */
export function roleTextStyle(role: Pick<Role, 'color' | 'colorSecondary'>): CSSProperties {
  if (!role.colorSecondary) return { color: role.color };
  return {
    color: role.color,
    backgroundImage: `linear-gradient(90deg, ${role.color}, ${role.colorSecondary})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  };
}

/** The style of a role's colour dot: its colour, or a split of its two. */
export function roleDotStyle(role: Pick<Role, 'color' | 'colorSecondary'>): CSSProperties {
  if (!role.colorSecondary) return { backgroundColor: role.color };
  return { backgroundImage: `linear-gradient(135deg, ${role.color} 50%, ${role.colorSecondary} 50%)` };
}
