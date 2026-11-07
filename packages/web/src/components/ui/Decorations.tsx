import type { CSSProperties, ReactNode } from 'react';
import type { NameEffect, NameFont, Nameplate, ProfileEffect } from '@backspace/shared/src/decorations';
import { effectParticles, nameplateParticles, particleStyle } from '../../utils/decorations';
import type { DecorationMotion } from './Avatar';

/**
 * A profile's effect (docs/systems/decorations.md): a layer over its banner, behind the card's
 * content, fading out before the text. The parent is `relative` and gives it its size; `height`
 * is that size in pixels, so what falls or rises crosses the whole of it, on a card as in a
 * picker's tile. It never takes a pointer.
 */
export function ProfileEffectLayer({ effect, height = 96, className = '' }: { effect: ProfileEffect | null; height?: number; className?: string }) {
  if (!effect) return null;
  return (
    <div aria-hidden="true" className={`deco-effect ${className}`} data-effect={effect} style={{ '--fall': `${height + 24}px` } as CSSProperties}>
      {effectParticles(effect).map((particle, index) => <i key={index} style={particleStyle(particle) as CSSProperties} />)}
    </div>
  );
}

/**
 * A profile's effect on a layout without a banner (docs/systems/decorations.md): across the top of
 * the card, under everything on it. The card is `relative` and `isolate`, so the layer lies over
 * its background and under its content.
 */
export function CardTopEffect({ effect, height }: { effect: ProfileEffect | null; height: number }) {
  if (!effect) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10" style={{ height }}>
      <ProfileEffectLayer effect={effect} height={height} />
    </div>
  );
}

/**
 * A nameplate (docs/systems/decorations.md): colour and movement gathered at the far end of a row
 * of a list of people, behind the row's content and away from the name. The row is `relative`,
 * `isolate` (so the plate lies under its content and over its background) and rounded; this takes
 * its corners. In a list it moves while the row (`.deco-hover`) is pointed at.
 */
export function NameplateLayer({ nameplate, colors, motion = 'on', className = '' }: {
  nameplate: Nameplate | null;
  colors: { a: string; b: string };
  motion?: DecorationMotion;
  className?: string;
}) {
  if (!nameplate) return null;
  return (
    <span
      aria-hidden="true"
      className={`deco-nameplate ${className}`}
      data-nameplate={nameplate}
      data-motion={motion}
      style={{ '--deco-a': colors.a, '--deco-b': colors.b } as CSSProperties}
    >
      {nameplateParticles(nameplate).map((particle, index) => <i key={index} style={particleStyle(particle) as CSSProperties} />)}
    </span>
  );
}

/**
 * A name in the person's chosen style (docs/systems/decorations.md): a typeface, and light inside
 * the letters. Without either it is the text as it is. The colours of "your colours" come from the
 * person (`colors`). Where the name wears a role's colour (`roleColored`: a space's members and
 * messages), that colour says something about the person there and wins over the effect; the
 * typeface stays.
 */
export function DecoratedName({ font, effect, colors, motion = 'on', roleColored = false, className = '', style, children }: {
  font: NameFont | null;
  effect: NameEffect | null;
  colors: { a: string; b: string };
  motion?: DecorationMotion;
  roleColored?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const shownEffect = roleColored ? null : effect;
  if (!font && !shownEffect) return <span className={className} style={style}>{children}</span>;
  return (
    <span
      className={`deco-name ${className}`}
      data-name-font={font ?? undefined}
      data-name-effect={shownEffect ?? undefined}
      data-motion={motion}
      style={{ ...style, '--deco-a': colors.a, '--deco-b': colors.b } as CSSProperties}
    >
      {children}
    </span>
  );
}
