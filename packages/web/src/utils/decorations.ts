import type { User } from '@backspace/shared';
import {
  decorationsOf,
  type AvatarFrame,
  type DecorationField,
  type NameEffect,
  type NameFont,
  type Nameplate,
  type ProfileEffect,
} from '@backspace/shared/src/decorations';
import { wornCustomDecorationsFrom, type CustomDecorationView, type EffectMotion } from '@backspace/shared/src/customDecorations';
import { getAvatarGradient, type GradientEntry } from './gradients';
import { profileThemeOf } from './profileTheme';

/**
 * Profile decorations (docs/systems/decorations.md): what the client works out for them.
 * The drawings are `components/ui/decorationArt.tsx` and their motion `styles/decorations.css`;
 * this gives them the person's own colours and the places of what falls or rises in them.
 */

/**
 * The colours "your colours" takes, in a frame, a nameplate or a name: the person's profile
 * theme, or else their picture's tile, so it is theirs either way.
 */
export function decorationColors(
  fields: { accentColor?: string | null; accentColorSecondary?: string | null },
  tile: Pick<GradientEntry, 'from' | 'to'>,
): { a: string; b: string } {
  const theme = profileThemeOf({ accentColor: fields.accentColor ?? null, accentColorSecondary: fields.accentColorSecondary ?? null });
  if (theme) return { a: theme.primary, b: theme.secondary };
  return { a: tile.from, b: tile.to };
}

/** What a field wears: one of Tavvit's designs by its name, or one someone made (customDecorations.ts). */
export type FrameChoice = AvatarFrame | CustomDecorationView;
export type EffectChoice = ProfileEffect | CustomDecorationView;
export type NameplateChoice = Nameplate | CustomDecorationView;
export type NameEffectChoice = NameEffect | CustomDecorationView;

/** A person's decorations as a surface draws them, with the colours "your colours" takes there. */
export interface PersonDecorations {
  avatarFrame: FrameChoice | null;
  profileEffect: EffectChoice | null;
  nameplate: NameplateChoice | null;
  nameFont: NameFont | null;
  nameEffect: NameEffectChoice | null;
  colors: { a: string; b: string };
}

/** The fields of a person that their decorations are drawn from. */
export type DecoratedPerson = Partial<Record<DecorationField, unknown>>
  & Pick<User, 'id'>
  & Partial<Pick<User, 'homeUserId' | 'avatarColor' | 'accentColor' | 'accentColorSecondary' | 'customDecorations'>>;

/**
 * What a person's profile shows of its decorations, on any surface: a design someone made where it
 * wears one and it passes (`wornCustomDecorationsFrom`), else the designs this client knows (a
 * retired one as its successor, a name it does not know as nothing), and the person's colours, from
 * the same tile their picture falls back to.
 */
export function personDecorations(person: DecoratedPerson | null | undefined, name: string): PersonDecorations {
  const builtIn = decorationsOf(person);
  const made = wornCustomDecorationsFrom(person?.customDecorations);
  const tile = getAvatarGradient(person?.homeUserId ?? person?.id, name, person?.avatarColor);
  return {
    avatarFrame: made.avatarFrame ?? builtIn.avatarFrame,
    profileEffect: made.profileEffect ?? builtIn.profileEffect,
    nameplate: made.nameplate ?? builtIn.nameplate,
    nameFont: builtIn.nameFont,
    nameEffect: made.nameEffect ?? builtIn.nameEffect,
    colors: decorationColors(person ?? {}, tile),
  };
}

/** Whether a field wears a design someone made rather than one of Tavvit's. */
export function isMadeDesign(choice: FrameChoice | EffectChoice | NameplateChoice | NameEffectChoice | null): choice is CustomDecorationView {
  return typeof choice === 'object' && choice !== null;
}

/** One particle: where it starts (per cent of its box), when (a negative delay starts it part way) and how long (seconds), its size and drift (px). */
export interface Particle {
  x: number;
  y: number;
  delay: number;
  size: number;
  duration: number;
  sway: number;
}

/** A small seeded generator, so particles are in the same places on every screen. */
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

/** How many particles, where across their box, and how they vary. */
interface Shape {
  count: number;
  /** The share of the width they start in, from the left of their box. */
  span: [number, number];
  size: [number, number];
  duration: [number, number];
  sway: [number, number];
}

const between = (random: () => number, [low, high]: [number, number]): number => low + (high - low) * random();
const round = (value: number): number => Math.round(value * 100) / 100;

function generate(seed: string, shape: Shape): Particle[] {
  const random = seeded(seed);
  const particles: Particle[] = [];
  const [from, to] = shape.span;
  for (let index = 0; index < shape.count; index += 1) {
    const duration = between(random, shape.duration);
    particles.push({
      // Spread evenly across the span, each nudged a little, so none bunch together.
      x: round(from + ((index + 0.15 + random() * 0.7) / shape.count) * (to - from)),
      y: round(4 + random() * 88),
      // Already under way when it is first seen.
      delay: round(-random() * duration),
      size: round(between(random, shape.size)),
      duration: round(duration),
      sway: round(between(random, shape.sway)),
    });
  }
  return particles;
}

/** What flies, falls or rises across the profile card. */
const EFFECT_SHAPES: Record<ProfileEffect, Shape> = {
  butterflies: { count: 7, span: [0, 100], size: [20, 30], duration: [7, 11], sway: [-46, 46] },
  notes: { count: 14, span: [0, 100], size: [15, 23], duration: [4, 7], sway: [-28, 28] },
  stars: { count: 16, span: [0, 100], size: [9, 16], duration: [2.4, 4.6], sway: [0, 0] },
  snow: { count: 26, span: [0, 100], size: [10, 18], duration: [6, 11], sway: [-24, 24] },
  petals: { count: 18, span: [0, 100], size: [12, 18], duration: [6, 11], sway: [-50, 50] },
  leaves: { count: 14, span: [0, 100], size: [16, 24], duration: [6, 11], sway: [-56, 56] },
  hearts: { count: 16, span: [0, 100], size: [14, 24], duration: [4, 7], sway: [-28, 28] },
  confetti: { count: 30, span: [0, 100], size: [10, 16], duration: [3.5, 6.5], sway: [-40, 40] },
  bubbles: { count: 16, span: [0, 100], size: [14, 28], duration: [5, 9], sway: [-18, 18] },
  lanterns: { count: 10, span: [4, 96], size: [18, 28], duration: [9, 14], sway: [-20, 20] },
};

/**
 * What falls or rises in a nameplate's scene, in a box the scene's size at the end of the row
 * (`.deco-plate-field`): petals under the branch, rain under its cloud, sparks over the fire.
 */
const NAMEPLATE_SHAPES: Partial<Record<Nameplate, Shape>> = {
  starlit: { count: 6, span: [4, 96], size: [4, 7], duration: [2.2, 4.5], sway: [0, 0] },
  snow: { count: 7, span: [6, 100], size: [5, 7], duration: [3, 5.5], sway: [-8, 8] },
  rain: { count: 7, span: [38, 82], size: [4, 5], duration: [0.9, 1.4], sway: [0, 0] },
  sakura: { count: 6, span: [10, 84], size: [6, 8], duration: [4, 7], sway: [-14, 14] },
  embers: { count: 5, span: [44, 60], size: [4, 6], duration: [1.8, 3], sway: [-8, 8] },
};

const cache = new Map<string, Particle[]>();

function cached(key: string, shape: Shape | undefined): Particle[] {
  if (!shape || shape.count === 0) return [];
  const known = cache.get(key);
  if (known) return known;
  const particles = generate(key, shape);
  cache.set(key, particles);
  return particles;
}

export function effectParticles(effect: ProfileEffect): Particle[] {
  return cached(`effect:${effect}`, EFFECT_SHAPES[effect]);
}

export function nameplateParticles(nameplate: Nameplate): Particle[] {
  return cached(`nameplate:${nameplate}`, NAMEPLATE_SHAPES[nameplate]);
}

/**
 * What moves across a profile that wears an effect someone made: their piece, in one of the
 * motions of Tavvit's own effects (`EFFECT_MOTIONS`), as many and as large as Tavvit decides, so
 * that no picture covers the profile. A little fewer and larger than the drawn ones, because a
 * piece someone drew carries more detail of its own.
 */
const MADE_EFFECT_SHAPES: Record<EffectMotion, Shape> = {
  fall: { count: 14, span: [0, 100], size: [16, 26], duration: [7, 12], sway: [-24, 24] },
  tumble: { count: 12, span: [0, 100], size: [18, 28], duration: [6, 11], sway: [-56, 56] },
  rise: { count: 12, span: [0, 100], size: [16, 26], duration: [4, 7], sway: [-28, 28] },
  float: { count: 9, span: [4, 96], size: [20, 30], duration: [9, 14], sway: [-20, 20] },
  twinkle: { count: 12, span: [0, 100], size: [12, 22], duration: [2.4, 4.6], sway: [0, 0] },
};

export function madeEffectParticles(motion: EffectMotion): Particle[] {
  return cached(`made:${motion}`, MADE_EFFECT_SHAPES[motion]);
}

/** The custom properties a particle's element carries. */
export function particleStyle(particle: Particle): Record<string, string> {
  return {
    '--x': `${particle.x}%`,
    '--y': `${particle.y}%`,
    '--d': `${particle.delay}s`,
    '--s': `${particle.size}px`,
    '--t': `${particle.duration}s`,
    '--sway': `${particle.sway}px`,
  };
}
