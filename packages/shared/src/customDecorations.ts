/**
 * Decorations people make themselves and share with their instance (docs/systems/decorations.md,
 * "Made by people"): a frame or a nameplate as a picture they upload, an effect as a small picture
 * that Tavvit sends across the profile in one of its own motions (so no picture ever lies over the
 * whole profile), and a name style built from colours and a look. A profile wears one by storing a
 * reference (`custom:<id>`) in the same column a built-in design takes; the server answers every
 * `User` with what a client needs to draw what it wears (`customDecorations`).
 */

/** What a person can make. A name style is built, the rest are pictures. */
export const CUSTOM_DECORATION_KINDS = ['frame', 'effect', 'nameplate', 'name'] as const;
export type CustomDecorationKind = (typeof CUSTOM_DECORATION_KINDS)[number];

/** The kinds that are a picture someone uploaded. */
export const PICTURE_DECORATION_KINDS: ReadonlySet<CustomDecorationKind> = new Set<CustomDecorationKind>(['frame', 'effect', 'nameplate']);

/** The profile field each kind is worn in. */
export const CUSTOM_DECORATION_FIELDS = {
  frame: 'avatarFrame',
  effect: 'profileEffect',
  nameplate: 'nameplate',
  name: 'nameEffect',
} as const satisfies Record<CustomDecorationKind, string>;
export type CustomDecorationField = (typeof CUSTOM_DECORATION_FIELDS)[CustomDecorationKind];

/** The kind a profile field wears, for the fields that can wear a made design. */
export const KIND_OF_FIELD: Readonly<Record<CustomDecorationField, CustomDecorationKind>> = {
  avatarFrame: 'frame',
  profileEffect: 'effect',
  nameplate: 'nameplate',
  nameEffect: 'name',
};

export function isCustomDecorationKind(value: unknown): value is CustomDecorationKind {
  return typeof value === 'string' && (CUSTOM_DECORATION_KINDS as readonly string[]).includes(value);
}

/** How a profile column names a made design: `custom:` and its id. */
export const CUSTOM_DECORATION_PREFIX = 'custom:';
export type CustomDecorationRef = `custom:${string}`;
const CUSTOM_REF = /^custom:(\d{1,20})$/;

export function customDecorationRef(id: string): CustomDecorationRef {
  return `${CUSTOM_DECORATION_PREFIX}${id}` as CustomDecorationRef;
}

/** The id a stored or sent value names, or null when it names no made design. */
export function customDecorationIdOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = CUSTOM_REF.exec(value);
  return match ? match[1]! : null;
}

export const CUSTOM_DECORATION_LIMITS = {
  /** Designs one account keeps, shared or not; instance administrators have no limit of their own. */
  PER_ACCOUNT: 30,
  /** A design's name: one visible line. */
  NAME_MAX: 32,
  /** The picture as sent, and as stored. */
  MAX_BYTES: 6 * 1024 * 1024,
  /** Frames of an animated picture, counted before anything is encoded. */
  MAX_FRAMES: 300,
  /** Pictures one account may send in a minute, and new designs in a day. */
  UPLOADS_PER_MINUTE: 10,
  CREATED_PER_DAY: 40,
  /** A page of the gallery. */
  PAGE_SIZE: 24,
  /** A search in the gallery. */
  QUERY_MAX: 64,
  /** Why an administrator removed someone's design (told to its maker). */
  REASON_MIN: 3,
  REASON_MAX: 500,
} as const;

/**
 * The size each picture is stored within, and how it fills it: a frame is square (a picture that
 * is not is set in the middle of a transparent square), the others keep their shape. An effect's
 * picture is one small piece, of which a profile shows a few at a time.
 */
export const CUSTOM_DECORATION_BOX: Readonly<Record<Exclude<CustomDecorationKind, 'name'>, { width: number; height: number; square: boolean }>> = {
  frame: { width: 512, height: 512, square: true },
  effect: { width: 256, height: 256, square: false },
  nameplate: { width: 960, height: 160, square: false },
};

/**
 * The size a maker is told to draw at (the template): a frame's picture sits in the middle five
 * sevenths, as the drawn frames do (the view is a fifth larger than the picture on every side).
 */
export const CUSTOM_DECORATION_TEMPLATE: Readonly<Record<Exclude<CustomDecorationKind, 'name'>, { width: number; height: number }>> = {
  frame: { width: 420, height: 420 },
  effect: { width: 128, height: 128 },
  nameplate: { width: 720, height: 120 },
};

/**
 * How the pieces of a made effect move across a profile, each as one of Tavvit's drawn effects
 * does: falling like snow, tumbling like leaves, rising like hearts, floating up like lanterns,
 * twinkling in place like stars. Tavvit decides how many there are and how large, so the profile
 * stays readable whatever the picture is.
 */
export const EFFECT_MOTIONS = ['fall', 'tumble', 'rise', 'float', 'twinkle'] as const;
export type EffectMotion = (typeof EFFECT_MOTIONS)[number];

export function isEffectMotion(value: unknown): value is EffectMotion {
  return typeof value === 'string' && (EFFECT_MOTIONS as readonly string[]).includes(value);
}

/** An effect's motion as it is stored (`{"motion":…}` in its style), falling where none is. */
export function effectMotionOf(value: unknown): EffectMotion {
  if (typeof value === 'object' && value !== null && isEffectMotion((value as { motion?: unknown }).motion)) {
    return (value as { motion: EffectMotion }).motion;
  }
  return 'fall';
}

/** The looks a name style is built on, and how many colours each takes. */
export const NAME_STYLE_LOOKS = ['gradient', 'flow', 'wave', 'sticker', 'comic', 'retro', 'glitch'] as const;
export type NameStyleLook = (typeof NAME_STYLE_LOOKS)[number];

export const NAME_STYLE_COLORS: Readonly<Record<NameStyleLook, { min: number; max: number }>> = {
  gradient: { min: 2, max: 3 },
  flow: { min: 2, max: 3 },
  wave: { min: 2, max: 2 },
  sticker: { min: 1, max: 1 },
  comic: { min: 1, max: 1 },
  retro: { min: 3, max: 3 },
  glitch: { min: 3, max: 3 },
};

export interface NameStyle {
  look: NameStyleLook;
  /** `#rrggbb`, lower case. */
  colors: string[];
}

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** A name style as it is stored, or null when the value is not one (an unknown look, a colour that is not `#rrggbb`, too many or too few colours). */
export function normalizeNameStyle(value: unknown): NameStyle | null {
  if (typeof value !== 'object' || value === null) return null;
  const { look, colors } = value as { look?: unknown; colors?: unknown };
  if (typeof look !== 'string' || !(NAME_STYLE_LOOKS as readonly string[]).includes(look)) return null;
  if (!Array.isArray(colors)) return null;
  const range = NAME_STYLE_COLORS[look as NameStyleLook];
  if (colors.length < range.min || colors.length > range.max) return null;
  const normalized: string[] = [];
  for (const color of colors) {
    if (typeof color !== 'string') return null;
    const lower = color.trim().toLowerCase();
    if (!HEX_COLOR.test(lower)) return null;
    normalized.push(lower);
  }
  return { look: look as NameStyleLook, colors: normalized };
}

/** Characters a name must not hold: controls, bidirectional overrides and invisible joiners that would disguise it. */
const UNSAFE_NAME = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;

/** A design's name as it is stored: trimmed, one visible line of 1 to NAME_MAX characters; undefined when it is not one. */
export function normalizeDecorationName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || [...name].length > CUSTOM_DECORATION_LIMITS.NAME_MAX || UNSAFE_NAME.test(name)) return undefined;
  return name;
}

/**
 * What a profile carries of a made design, enough to draw it: the picture's address on the
 * instance that holds it (a path there, `PICTURE_PATH`, which a client reading it from another
 * instance makes absolute on that one as it arrives, so it is drawn through the same consent a
 * picture from another server needs), the first frame of an animated one for where it stands
 * still, or the name style.
 */
export interface CustomDecorationView {
  id: string;
  kind: CustomDecorationKind;
  name: string;
  /** Null for a name style. */
  image: string | null;
  /** The first frame, for an animated picture; null when it does not move or for a name style. */
  still: string | null;
  /** Only for a name style. */
  style: NameStyle | null;
  /** Only for an effect: how its pieces move. */
  motion: EffectMotion | null;
}

/** The made designs a profile wears, by the field each is worn in. */
export type WornCustomDecorations = Partial<Record<CustomDecorationField, CustomDecorationView>>;

/** Where an instance serves a made design's picture and its still first frame, as the path it sends. */
export const PICTURE_PATH = /^\/api\/decorations\/\d{1,20}(?:-still)?\.webp$/;
/** The same path made absolute on the instance it came from. */
const PICTURE_ADDRESS = /^https?:\/\/[^\s/?#@]{1,253}\/api\/decorations\/\d{1,20}(?:-still)?\.webp$/i;

/** An address a picture may be drawn from: where an instance serves one, as a path or on its origin. */
function pictureAddressOf(value: unknown): string | null {
  return typeof value === 'string' && (PICTURE_PATH.test(value) || PICTURE_ADDRESS.test(value)) ? value : null;
}

/**
 * A made design as a client may draw it, from whatever a host sent: of the kind its field wears,
 * a picture only from where an instance serves one, a name style only by the rules above. Null for
 * anything else, which is then drawn as nothing.
 */
export function customDecorationViewOf(value: unknown, kind: CustomDecorationKind): CustomDecorationView | null {
  if (typeof value !== 'object' || value === null) return null;
  const view = value as Record<string, unknown>;
  if (typeof view.id !== 'string' || !/^\d{1,20}$/.test(view.id) || view.kind !== kind || typeof view.name !== 'string') return null;
  const picture = PICTURE_DECORATION_KINDS.has(kind);
  const image = picture ? pictureAddressOf(view.image) : null;
  if (picture && image === null) return null;
  const style = kind === 'name' ? normalizeNameStyle(view.style) : null;
  if (kind === 'name' && style === null) return null;
  return {
    id: view.id,
    kind,
    name: [...view.name].slice(0, CUSTOM_DECORATION_LIMITS.NAME_MAX).join(''),
    image,
    still: picture ? pictureAddressOf(view.still) : null,
    style,
    motion: kind === 'effect' ? effectMotionOf(view) : null,
  };
}

/** The made designs a profile wears, as a client may draw them; an entry that does not pass is left out. */
export function wornCustomDecorationsFrom(value: unknown): WornCustomDecorations {
  const worn: WornCustomDecorations = {};
  if (typeof value !== 'object' || value === null) return worn;
  for (const [field, kind] of Object.entries(KIND_OF_FIELD) as Array<[CustomDecorationField, CustomDecorationKind]>) {
    const view = customDecorationViewOf((value as Record<string, unknown>)[field], kind);
    if (view) worn[field] = view;
  }
  return worn;
}

/** A design as the gallery and its maker see it. */
export interface CustomDecoration extends CustomDecorationView {
  /** Who made it; null once their account is gone. */
  creator: { id: string; username: string; displayName: string | null } | null;
  /** In the community's gallery. */
  shared: boolean;
  /** How many profiles wear it now. */
  wearers: number;
  createdAt: number;
  /** The caller made it. */
  mine: boolean;
}

export type CustomDecorationSort = 'popular' | 'new';

export interface CustomDecorationPage {
  items: CustomDecoration[];
  /** Designs that match, over all pages. */
  total: number;
}

export interface CreateCustomDecorationRequest {
  kind: CustomDecorationKind;
  name: string;
  /** The picture in base64, for a frame, an effect or a nameplate. */
  image?: string;
  /** For a name style. */
  style?: NameStyle;
  /** For an effect: how its pieces move. */
  motion?: EffectMotion;
  /** Put it in the community's gallery straight away. */
  shared?: boolean;
}

export interface UpdateCustomDecorationRequest {
  name?: string;
  shared?: boolean;
}
