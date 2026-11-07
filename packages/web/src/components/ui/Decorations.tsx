import type { CSSProperties, ReactNode } from 'react';
import type { NameEffect, NameFont } from '@backspace/shared/src/decorations';
import type { NameStyle } from '@backspace/shared/src/customDecorations';
import { formatters } from '../../i18n/formatters';
import {
  effectParticles,
  isMadeDesign,
  nameplateParticles,
  particleStyle,
  type EffectChoice,
  type NameEffectChoice,
  type NameplateChoice,
} from '../../utils/decorations';
import type { DecorationMotion } from './Avatar';
import { effectArt, effectSprites, nameplateArt, nameplateSprites } from './decorationArt';
import { MadeEffect, MadePicture } from './MadeDecorationArt';

/**
 * A profile's effect (docs/systems/decorations.md): drawn things bursting, flying, falling or
 * rising across the whole profile card, over its content and never taking a pointer. The parent
 * is `relative` and gives it its size; what moves crosses all of it, on a card as in a picker's
 * tile (the layer measures itself: `container-type: size`). A card puts it last, over everything
 * (`className="z-20"`); a picker's tile can draw it smaller (`--deco-scale`). An effect someone
 * made is a few of their piece, moving as one of these does (`MadeEffect`).
 */
export function ProfileEffectLayer({ effect, className = '' }: { effect: EffectChoice | null; className?: string }) {
  if (!effect) return null;
  if (isMadeDesign(effect)) return <MadeEffect view={effect} className={className} />;
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
 * moves while the row (`.deco-hover`) is pointed at. A nameplate someone made is their picture,
 * filling the row from its far end.
 */
export function NameplateLayer({ nameplate, colors, motion = 'on', className = '' }: {
  nameplate: NameplateChoice | null;
  colors: { a: string; b: string };
  motion?: DecorationMotion;
  className?: string;
}) {
  if (!nameplate) return null;
  if (isMadeDesign(nameplate)) {
    return (
      <span aria-hidden="true" className={`deco-nameplate ${className}`} data-nameplate="made" data-motion={motion}>
        <MadePicture view={nameplate} motion={motion} className="deco-made-plate" />
      </span>
    );
  }
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

/** A made name style's colours as the custom properties its look reads (`--c1` to `--c3`). */
function styleColors(style: NameStyle): CSSProperties {
  const [first, second, third] = style.colors;
  return {
    '--c1': first,
    ...(second ? { '--c2': second } : {}),
    ...(third ? { '--c3': third } : {}),
  } as CSSProperties;
}

/**
 * A name in the person's chosen style (docs/systems/decorations.md): a typeface, and an effect in
 * or on the letters, one of Tavvit's or a style someone built from a look and colours. Without
 * either it is the text as it is. The colours of "your colours" come from the person (`colors`).
 * Where the name wears a role's colour (`roleColored`: a space's members and messages), that colour
 * says something about the person there and wins over the effect; the typeface stays. An effect
 * that moves each letter (a wave) draws the name letter by letter for the eye and keeps it whole
 * for a screen reader.
 */
export function DecoratedName({ font, effect, colors, motion = 'on', roleColored = false, className = '', style, children }: {
  font: NameFont | null;
  effect: NameEffectChoice | null;
  colors: { a: string; b: string };
  motion?: DecorationMotion;
  roleColored?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const shownEffect = roleColored ? null : effect;
  if (!font && !shownEffect) return <span className={className} style={style}>{children}</span>;
  const made = isMadeDesign(shownEffect) && shownEffect.style ? shownEffect.style : null;
  const builtIn = shownEffect !== null && !isMadeDesign(shownEffect) ? shownEffect : null;
  const byLetter = made ? made.look === 'wave' : builtIn !== null && LETTER_EFFECTS.has(builtIn);
  const letters = byLetter && typeof children === 'string' ? formatters.splitGraphemes(children) : null;
  return (
    <span
      className={`deco-name ${className}`}
      data-name-font={font ?? undefined}
      data-name-effect={builtIn ?? undefined}
      data-name-made={made?.look}
      data-motion={motion}
      style={{ ...style, '--deco-a': colors.a, '--deco-b': colors.b, ...(made ? styleColors(made) : {}) } as CSSProperties}
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
