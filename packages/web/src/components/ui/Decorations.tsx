import type { CSSProperties, ReactNode } from 'react';
import type { NameEffect, NameFont, Nameplate, ProfileEffect } from '@backspace/shared/src/decorations';
import { formatters } from '../../i18n/formatters';
import { effectParticles, nameplateParticles, particleStyle } from '../../utils/decorations';
import type { DecorationMotion } from './Avatar';
import { effectArt, effectSprites, nameplateArt, nameplateSprites } from './decorationArt';

/**
 * A profile's effect (docs/systems/decorations.md): drawn things bursting, flying, falling or
 * rising across the whole profile card, over its content and never taking a pointer. The parent
 * is `relative` and gives it its size; what moves crosses all of it, on a card as in a picker's
 * tile (the layer measures itself: `container-type: size`). A card puts it last, over everything
 * (`className="z-20"`); a picker's tile can draw it smaller (`--deco-scale`).
 */
export function ProfileEffectLayer({ effect, className = '' }: { effect: ProfileEffect | null; className?: string }) {
  if (!effect) return null;
  return (
    <div aria-hidden="true" className={`deco-effect ${className}`} data-effect={effect} style={effectSprites(effect) ?? undefined}>
      {effectParticles(effect).map((particle, index) => <i key={index} style={particleStyle(particle) as CSSProperties} />)}
      {effectArt(effect)}
    </div>
  );
}

/**
 * A nameplate (docs/systems/decorations.md): a small scene at the far end of a row of a list of
 * people, behind the row's content and away from the name, with what falls or rises in it kept to
 * a box the scene's size (`.deco-plate-field`). The row is `relative`, `isolate` (so the plate lies
 * under its content and over its background) and rounded; this takes its corners. In a list it
 * moves while the row (`.deco-hover`) is pointed at.
 */
export function NameplateLayer({ nameplate, colors, motion = 'on', className = '' }: {
  nameplate: Nameplate | null;
  colors: { a: string; b: string };
  motion?: DecorationMotion;
  className?: string;
}) {
  if (!nameplate) return null;
  const particles = nameplateParticles(nameplate);
  return (
    <span
      aria-hidden="true"
      className={`deco-nameplate ${className}`}
      data-nameplate={nameplate}
      data-motion={motion}
      style={{ '--deco-a': colors.a, '--deco-b': colors.b, ...nameplateSprites(nameplate) } as CSSProperties}
    >
      {nameplateArt(nameplate)}
      {particles.length > 0 && (
        <span className="deco-plate-field">
          {particles.map((particle, index) => <i key={index} style={particleStyle(particle) as CSSProperties} />)}
        </span>
      )}
    </span>
  );
}

/** Effects that move each letter on its own: the name is drawn letter by letter. */
const LETTER_EFFECTS: ReadonlySet<NameEffect> = new Set<NameEffect>(['wave']);

/**
 * A name in the person's chosen style (docs/systems/decorations.md): a typeface, and an effect in
 * or on the letters. Without either it is the text as it is. The colours of "your colours" come
 * from the person (`colors`). Where the name wears a role's colour (`roleColored`: a space's
 * members and messages), that colour says something about the person there and wins over the
 * effect; the typeface stays. An effect that moves each letter (`wave`) draws the name letter by
 * letter for the eye and keeps it whole for a screen reader.
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
  const letters = shownEffect && LETTER_EFFECTS.has(shownEffect) && typeof children === 'string' ? formatters.splitGraphemes(children) : null;
  return (
    <span
      className={`deco-name ${className}`}
      data-name-font={font ?? undefined}
      data-name-effect={shownEffect ?? undefined}
      data-motion={motion}
      style={{ ...style, '--deco-a': colors.a, '--deco-b': colors.b } as CSSProperties}
    >
      {letters ? (
        <>
          <span className="sr-only">{children}</span>
          <span aria-hidden="true">
            {letters.map((letter, index) => (
              <span
                key={index}
                className="deco-name-letter"
                style={{ '--i': index, '--p': letters.length > 1 ? index / (letters.length - 1) : 0 } as CSSProperties}
              >
                {letter === ' ' ? ' ' : letter}
              </span>
            ))}
          </span>
        </>
      ) : children}
    </span>
  );
}
