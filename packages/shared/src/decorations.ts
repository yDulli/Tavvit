/**
 * Profile decorations (docs/systems/decorations.md): a frame for the picture, an effect over the
 * profile's banner, a nameplate behind the name in lists, and a style for the name itself (a font
 * and an effect). Free for everyone, Tavvit's own designs, drawn by the client from these names
 * alone: nothing is uploaded and nothing loads from elsewhere, so a decoration is a word in the
 * profile and looks the same on every screen.
 *
 * A design that was retired keeps working as its nearest successor (`RETIRED_*`), so nobody who
 * chose one loses their look and nothing stored has to change.
 */

/**
 * Frames around the picture, in the order the picker offers them. Every one is a drawing of a thing
 * (`decorationArt.tsx`); some keep the name of the design they were drawn after (`stardust` is the
 * stars, `kindling` the flames, `frost` the snow, `blossom` the cherry blossoms, `fizz` the
 * bubbles, `halo` the angel, `theme` the loop in the person's colours).
 */
export const AVATAR_FRAMES = [
  'headphones', 'catears', 'crown', 'halo', 'horns', 'laurel',
  'blossom', 'kindling', 'frost', 'stardust', 'hearts', 'fizz', 'theme',
] as const;
export type AvatarFrame = (typeof AVATAR_FRAMES)[number];

/** Effects over the whole profile card: drawn things flying, falling or rising across it. */
export const PROFILE_EFFECTS = [
  'butterflies', 'notes', 'stars', 'snow', 'petals',
  'leaves', 'hearts', 'confetti', 'bubbles', 'lanterns',
] as const;
export type ProfileEffect = (typeof PROFILE_EFFECTS)[number];

/** Nameplates behind the name in a list of people: a small scene at the end of the row. */
export const NAMEPLATES = [
  'vinyl', 'skyline', 'sakura', 'snow', 'rain', 'embers',
  'starlit', 'waves', 'sunset', 'moss', 'theme',
] as const;
export type Nameplate = (typeof NAMEPLATES)[number];

/** The typeface of the name. `classic` is the interface's own. */
export const NAME_FONTS = ['classic', 'mono', 'serif', 'round', 'hand', 'pixel', 'engraved', 'wide'] as const;
export type NameFont = (typeof NAME_FONTS)[number];

/**
 * What the name's letters carry: motion (a wave through them, a glitch), a printed look (a
 * sticker's edge, a comic's ink, a retro shadow, candy stripes), or colour flowing through them.
 */
export const NAME_EFFECTS = [
  'wave', 'glitch', 'sticker', 'comic', 'retro', 'candycane', 'galaxy', 'toxic', 'lagoon', 'berry',
  'shimmer', 'gold', 'silver', 'frost', 'aurora', 'sunset', 'ocean', 'candy', 'ember', 'prism', 'theme',
] as const;
export type NameEffect = (typeof NAME_EFFECTS)[number];

/**
 * Designs of light and particles that the drawings replaced, and the drawing each now shows as:
 * the one nearest in theme. A profile that stored one keeps a look near what it chose; an update
 * that names one (a client older than the change) stores its successor.
 */
export const RETIRED_FRAMES: Readonly<Record<string, AvatarFrame>> = {
  silver: 'halo', gilded: 'crown', rosegold: 'blossom', obsidian: 'horns',
  ember: 'kindling', tide: 'fizz', bloom: 'blossom', aurora: 'stardust', prism: 'theme',
  orbit: 'stardust', binary: 'stardust', dial: 'stardust', pulse: 'hearts',
};
export const RETIRED_EFFECTS: Readonly<Record<string, ProfileEffect>> = {
  sparkles: 'stars', shooting: 'stars', nebula: 'stars', aurora: 'stars', sunbeams: 'butterflies',
  rain: 'bubbles', waves: 'bubbles', fireflies: 'lanterns', embers: 'lanterns',
};
export const RETIRED_NAMEPLATES: Readonly<Record<string, Nameplate>> = {
  dusk: 'sunset', tide: 'waves', ember: 'embers', aurora: 'starlit', nebula: 'starlit',
  holo: 'sunset', pinstripe: 'skyline', circuit: 'skyline',
};
export const RETIRED_NAME_FONTS: Readonly<Record<string, NameFont>> = {};
export const RETIRED_NAME_EFFECTS: Readonly<Record<string, NameEffect>> = {};

const FRAME_SET: ReadonlySet<string> = new Set(AVATAR_FRAMES);
const EFFECT_SET: ReadonlySet<string> = new Set(PROFILE_EFFECTS);
const NAMEPLATE_SET: ReadonlySet<string> = new Set(NAMEPLATES);
const NAME_FONT_SET: ReadonlySet<string> = new Set(NAME_FONTS);
const NAME_EFFECT_SET: ReadonlySet<string> = new Set(NAME_EFFECTS);

export function isAvatarFrame(value: unknown): value is AvatarFrame {
  return typeof value === 'string' && FRAME_SET.has(value);
}

export function isProfileEffect(value: unknown): value is ProfileEffect {
  return typeof value === 'string' && EFFECT_SET.has(value);
}

export function isNameplate(value: unknown): value is Nameplate {
  return typeof value === 'string' && NAMEPLATE_SET.has(value);
}

export function isNameFont(value: unknown): value is NameFont {
  return typeof value === 'string' && NAME_FONT_SET.has(value);
}

export function isNameEffect(value: unknown): value is NameEffect {
  return typeof value === 'string' && NAME_EFFECT_SET.has(value);
}

/** A design of `current`, or the successor of a retired one, or null for anything else. */
function resolve<T extends string>(value: unknown, current: ReadonlySet<string>, retired: Readonly<Record<string, T>>): T | null {
  if (typeof value !== 'string') return null;
  if (current.has(value)) return value as T;
  return Object.hasOwn(retired, value) ? retired[value]! : null;
}

export const resolveAvatarFrame = (value: unknown): AvatarFrame | null => resolve(value, FRAME_SET, RETIRED_FRAMES);
export const resolveProfileEffect = (value: unknown): ProfileEffect | null => resolve(value, EFFECT_SET, RETIRED_EFFECTS);
export const resolveNameplate = (value: unknown): Nameplate | null => resolve(value, NAMEPLATE_SET, RETIRED_NAMEPLATES);
export const resolveNameFont = (value: unknown): NameFont | null => resolve(value, NAME_FONT_SET, RETIRED_NAME_FONTS);
export const resolveNameEffect = (value: unknown): NameEffect | null => resolve(value, NAME_EFFECT_SET, RETIRED_NAME_EFFECTS);

/** A profile's decorations; null for none (the classic font for the name). */
export interface ProfileDecorations {
  avatarFrame: AvatarFrame | null;
  profileEffect: ProfileEffect | null;
  nameplate: Nameplate | null;
  nameFont: NameFont | null;
  nameEffect: NameEffect | null;
}

type DecorationFields = Partial<Record<keyof ProfileDecorations, unknown>>;

/**
 * What a profile shows, from whatever a host sent: a retired design as its successor, and a name
 * this client does not know as nothing.
 */
export function decorationsOf(source: DecorationFields | null | undefined): ProfileDecorations {
  const font = resolveNameFont(source?.nameFont);
  return {
    avatarFrame: resolveAvatarFrame(source?.avatarFrame),
    profileEffect: resolveProfileEffect(source?.profileEffect),
    nameplate: resolveNameplate(source?.nameplate),
    nameFont: font === 'classic' ? null : font,
    nameEffect: resolveNameEffect(source?.nameEffect),
  };
}

/** The profile's fields for its decorations, as the API and the database name them. */
export const DECORATION_FIELDS = ['avatarFrame', 'profileEffect', 'nameplate', 'nameFont', 'nameEffect'] as const;
export type DecorationField = (typeof DECORATION_FIELDS)[number];

const DECORATION_RESOLVERS: Record<DecorationField, (value: unknown) => string | null> = {
  avatarFrame: resolveAvatarFrame,
  profileEffect: resolveProfileEffect,
  nameplate: resolveNameplate,
  nameFont: resolveNameFont,
  nameEffect: resolveNameEffect,
};

export type DecorationUpdate =
  | { ok: true; values: Partial<Record<DecorationField, string | null>> }
  | { ok: false; field: DecorationField };

/**
 * What a profile update asks of the decorations: each field it names, as it is stored (null for
 * none, the classic font stored as none, and a retired design stored as its successor), or else
 * the first field whose value is not a design. A field the update leaves out is not in `values`.
 */
export function decorationUpdateOf(body: Partial<Record<DecorationField, unknown>>): DecorationUpdate {
  const values: Partial<Record<DecorationField, string | null>> = {};
  for (const field of DECORATION_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null) {
      values[field] = null;
      continue;
    }
    const resolved = DECORATION_RESOLVERS[field](value);
    if (resolved === null) return { ok: false, field };
    values[field] = field === 'nameFont' && resolved === 'classic' ? null : resolved;
  }
  return { ok: true, values };
}

/** An update's decoration fields: a design, or null to clear it. */
export type DecorationsUpdate = { [Field in DecorationField]?: ProfileDecorations[Field] };
