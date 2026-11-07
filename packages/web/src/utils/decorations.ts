import type { User } from '@backspace/shared';
import { decorationsOf, type AvatarFrame, type DecorationField, type Nameplate, type ProfileDecorations, type ProfileEffect } from '@backspace/shared/src/decorations';
import { getAvatarGradient, type GradientEntry } from './gradients';
import { profileThemeOf } from './profileTheme';

/**
 * Profile decorations (docs/systems/decorations.md): what the client works out for them.
 * The drawings themselves are CSS (`styles/decorations.css`); this gives them the person's own
 * colours and the places of their particles.
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

/** A person's decorations as a surface draws them, with the colours "your colours" takes there. */
export interface PersonDecorations extends ProfileDecorations {
  colors: { a: string; b: string };
}

/** The fields of a person that their decorations are drawn from. */
export type DecoratedPerson = Partial<Record<DecorationField, unknown>>
  & Pick<User, 'id'>
  & Partial<Pick<User, 'homeUserId' | 'avatarColor' | 'accentColor' | 'accentColorSecondary'>>;

/**
 * What a person's profile shows of its decorations, on any surface: the designs this client knows
 * (a name it does not know shows nothing) and the person's colours, from the same tile their
 * picture falls back to.
 */
export function personDecorations(person: DecoratedPerson | null | undefined, name: string): PersonDecorations {
  const decorations = decorationsOf(person);
  const tile = getAvatarGradient(person?.homeUserId ?? person?.id, name, person?.avatarColor);
  return { ...decorations, colors: decorationColors(person ?? {}, tile) };
}

/** One particle: where it starts (per cent of its box), when (a negative delay starts it part way) and how long (seconds), its size, drift and travel (px). */
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
  /** The share of the width they start in, from the left: a nameplate keeps them at its far end. */
  span: [number, number];
  /** Kept to the two sides (a frame's particles pass the picture, not over it). */
  sides?: boolean;
  /** Placed round a ring instead (a frame's sparkles). */
  ring?: boolean;
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
    let x: number;
    let y = 4 + random() * 88;
    if (shape.ring) {
      // Round the ring, a little in or out of it; the ring is at about a third of the box from its middle.
      const angle = (index / shape.count) * Math.PI * 2 + random() * 0.5;
      const radius = 33 + random() * 12;
      x = 50 + Math.cos(angle) * radius;
      y = 50 + Math.sin(angle) * radius;
    } else if (shape.sides) {
      // Alternately left and right of the picture, never over it.
      const side = index % 2 === 0 ? [2, 20] : [80, 96];
      x = side[0]! + random() * (side[1]! - side[0]!);
    } else {
      // Spread evenly across the span, each nudged a little, so none bunch together.
      x = from + ((index + 0.15 + random() * 0.7) / shape.count) * (to - from);
    }
    particles.push({
      x: round(x),
      y: round(y),
      // Already under way when it is first seen.
      delay: round(-random() * duration),
      size: round(between(random, shape.size)),
      duration: round(duration),
      sway: round(between(random, shape.sway)),
    });
  }
  return particles;
}

const NONE: Shape = { count: 0, span: [0, 100], size: [0, 0], duration: [0, 0], sway: [0, 0] };

/** An effect's particles. The veils (aurora, nebula) are drawn without any. */
const EFFECT_SHAPES: Record<ProfileEffect, Shape> = {
  stars: { count: 26, span: [0, 100], size: [1, 2.4], duration: [2.4, 5.2], sway: [0, 0] },
  sparkles: { count: 12, span: [0, 100], size: [2.4, 4.4], duration: [2.2, 4], sway: [0, 0] },
  shooting: { count: 4, span: [0, 100], size: [1, 1], duration: [6, 10], sway: [0, 0] },
  nebula: NONE,
  aurora: NONE,
  sunbeams: { count: 4, span: [0, 100], size: [1, 1], duration: [7, 11], sway: [0, 0] },
  snow: { count: 20, span: [0, 100], size: [2, 4.5], duration: [7, 13], sway: [-18, 18] },
  rain: { count: 26, span: [0, 100], size: [2, 4], duration: [1.1, 1.9], sway: [0, 0] },
  // Three swells, each drawn by CSS as a curve of water.
  waves: { count: 3, span: [0, 100], size: [1, 1], duration: [1, 1], sway: [0, 0] },
  bubbles: { count: 12, span: [0, 100], size: [3, 6], duration: [5, 9], sway: [-14, 14] },
  fireflies: { count: 12, span: [0, 100], size: [3, 5], duration: [6, 11], sway: [-26, 26] },
  embers: { count: 16, span: [0, 100], size: [3, 6], duration: [3.5, 6.5], sway: [-26, 26] },
  petals: { count: 12, span: [0, 100], size: [6, 10], duration: [8, 14], sway: [-40, 40] },
  leaves: { count: 11, span: [0, 100], size: [8, 12], duration: [8, 13], sway: [-46, 46] },
  hearts: { count: 10, span: [0, 100], size: [5, 8], duration: [4.5, 7.5], sway: [-22, 22] },
  confetti: { count: 22, span: [0, 100], size: [3, 5], duration: [4, 7], sway: [-30, 30] },
};

/** A frame's particles; frames without them have none. */
const FRAME_SHAPES: Partial<Record<AvatarFrame, Shape>> = {
  stardust: { count: 9, span: [0, 100], ring: true, size: [4, 7], duration: [2.2, 3.8], sway: [0, 0] },
  frost: { count: 10, span: [0, 100], sides: true, size: [2, 3.6], duration: [3.5, 6], sway: [-8, 8] },
  kindling: { count: 10, span: [0, 100], sides: true, size: [3, 5], duration: [2.4, 4.2], sway: [-10, 10] },
  blossom: { count: 8, span: [0, 100], sides: true, size: [5, 8], duration: [4.5, 7], sway: [-12, 12] },
  fizz: { count: 9, span: [0, 100], sides: true, size: [3, 6], duration: [3, 5.5], sway: [-6, 6] },
};

/** A nameplate's particles, at the far end of the row. */
const NAMEPLATE_SHAPES: Partial<Record<Nameplate, Shape>> = {
  starlit: { count: 12, span: [48, 100], size: [1, 2], duration: [2, 4.5], sway: [0, 0] },
  snow: { count: 12, span: [46, 100], size: [1.5, 3], duration: [3, 5.5], sway: [-8, 8] },
  rain: { count: 14, span: [46, 100], size: [2, 3], duration: [0.8, 1.4], sway: [0, 0] },
  sakura: { count: 8, span: [48, 100], size: [5, 7], duration: [4, 7], sway: [-14, 14] },
  embers: { count: 10, span: [50, 100], size: [2.5, 4], duration: [2.2, 3.8], sway: [-10, 10] },
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

export function frameParticles(frame: AvatarFrame): Particle[] {
  return cached(`frame:${frame}`, FRAME_SHAPES[frame]);
}

export function nameplateParticles(nameplate: Nameplate): Particle[] {
  return cached(`nameplate:${nameplate}`, NAMEPLATE_SHAPES[nameplate]);
}

/** The custom properties a particle's element carries. */
export function particleStyle(particle: Particle, travel?: number): Record<string, string> {
  return {
    '--x': `${particle.x}%`,
    '--y': `${particle.y}%`,
    '--d': `${particle.delay}s`,
    '--s': `${particle.size}px`,
    '--t': `${particle.duration}s`,
    '--sway': `${particle.sway}px`,
    ...(travel !== undefined ? { '--travel': `${travel}px` } : {}),
  };
}
