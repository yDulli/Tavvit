import type { ChannelType } from '@backspace/shared';
import { parseRoleGlyph } from '@backspace/shared/src/roleGlyphs';
import { RoleGlyph } from '../../roles/RoleIcon';
import { channelIconName } from '../../utils/channelKinds';
import { Icon } from './Icon';

/**
 * What stands in front of a channel's name: the icon its space gave it, or the one of its type.
 * An icon of the set takes the colour of the text around it, as the type's icon does; an emoji
 * keeps its own colours, so `muted` dims only the first two. Unlike a role's, a channel's emoji
 * is never swapped for a drawing of the set: it stays the one that was picked.
 */
export function ChannelIcon({ type, icon, size = 16, muted = false, className = '' }: {
  type: ChannelType | undefined;
  icon?: string | null;
  size?: number;
  muted?: boolean;
  className?: string;
}) {
  const dim = muted ? ' opacity-60' : '';
  if (icon) {
    const glyph = parseRoleGlyph(icon);
    if (glyph) return <RoleGlyph id={glyph} size={size} className={`${className}${dim}`} />;
    // An emoji is wider than its font size: in a box of the icon's size, the name beside it starts
    // where it does on every other row.
    return (
      <span
        aria-hidden="true"
        className={`inline-flex flex-shrink-0 items-center justify-center leading-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.9) }}
      >
        {icon}
      </span>
    );
  }
  return <Icon name={channelIconName(type)} size={size} className={`${className}${dim}`} />;
}
