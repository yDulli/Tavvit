/**
 * Profile decorations (docs/systems/decorations.md): a frame for the picture, an effect over the
 * profile's banner, a nameplate behind the name in lists, and a style for the name itself (a font
 * and an effect). Free for everyone, Tavvit's own designs, drawn by the client from these names
 * alone: nothing is uploaded and nothing loads from elsewhere, so a decoration is a word in the
 * profile and looks the same on every screen.
 */

/** Frames around the picture, in the order the picker offers them: metal, colour, pattern, with particles. */
export const AVATAR_FRAMES = [
  'silver', 'gilded', 'rosegold', 'obsidian',
  'ember', 'tide', 'bloom', 'aurora', 'prism', 'theme',
  'orbit', 'binary', 'dial', 'pulse',
  'stardust', 'frost', 'kindling', 'blossom', 'fizz',
] as const;
export type AvatarFrame = (typeof AVATAR_FRAMES)[number];

/** Frames that bring particles around the picture where it moves. */
export const PARTICLE_FRAMES: ReadonlySet<AvatarFrame> = new Set<AvatarFrame>(['stardust', 'frost', 'kindling', 'blossom', 'fizz']);

/** Effects over the profile's banner. */
export const PROFILE_EFFECTS = [
  'stars', 'sparkles', 'shooting', 'nebula', 'aurora', 'sunbeams',
  'snow', 'rain', 'waves', 'bubbles', 'fireflies', 'embers',
  'petals', 'leaves', 'hearts', 'confetti',
] as const;
export type ProfileEffect = (typeof PROFILE_EFFECTS)[number];

/** Nameplates behind the name in a list of people. */
export const NAMEPLATES = [
  'dusk', 'tide', 'ember', 'moss', 'theme',
  'aurora', 'sunset', 'holo', 'nebula',
  'starlit', 'snow', 'rain', 'sakura', 'embers',
  'pinstripe', 'waves', 'circuit',
] as const;
export type Nameplate = (typeof NAMEPLATES)[number];

/** The typeface of the name. `classic` is the interface's own. */
export const NAME_FONTS = ['classic', 'mono', 'serif', 'round', 'hand', 'pixel', 'engraved', 'wide'] as const;
export type NameFont = (typeof NAME_FONTS)[number];

/** What light the name's letters carry. */
export const NAME_EFFECTS = ['shimmer', 'gold', 'silver', 'frost', 'aurora', 'sunset', 'ocean', 'candy', 'ember', 'prism', 'theme'] as const;
export type NameEffect = (typeof NAME_EFFECTS)[number];

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

/** A profile's decorations; null for none (the classic font for the name). */
export interface ProfileDecorations {
  avatarFrame: AvatarFrame | null;
  profileEffect: ProfileEffect | null;
  nameplate: Nameplate | null;
  nameFont: NameFont | null;
  nameEffect: NameEffect | null;
}

type DecorationFields = Partial<Record<keyof ProfileDecorations, unknown>>;

/** What a profile shows, from whatever a host sent: a name this client does not know shows nothing. */
export function decorationsOf(source: DecorationFields | null | undefined): ProfileDecorations {
  return {
    avatarFrame: isAvatarFrame(source?.avatarFrame) ? source.avatarFrame : null,
    profileEffect: isProfileEffect(source?.profileEffect) ? source.profileEffect : null,
    nameplate: isNameplate(source?.nameplate) ? source.nameplate : null,
    nameFont: isNameFont(source?.nameFont) && source.nameFont !== 'classic' ? source.nameFont : null,
    nameEffect: isNameEffect(source?.nameEffect) ? source.nameEffect : null,
  };
}

/** The profile's fields for its decorations, as the API and the database name them. */
export const DECORATION_FIELDS = ['avatarFrame', 'profileEffect', 'nameplate', 'nameFont', 'nameEffect'] as const;
export type DecorationField = (typeof DECORATION_FIELDS)[number];

const DECORATION_CHECKS: Record<DecorationField, (value: unknown) => boolean> = {
  avatarFrame: isAvatarFrame,
  profileEffect: isProfileEffect,
  nameplate: isNameplate,
  nameFont: isNameFont,
  nameEffect: isNameEffect,
};

export type DecorationUpdate =
  | { ok: true; values: Partial<Record<DecorationField, string | null>> }
  | { ok: false; field: DecorationField };

/**
 * What a profile update asks of the decorations: each field it names, as it is stored (null for
 * none, and the classic font stored as none), or else the first field whose value is not one of
 * the designs. A field the update leaves out is not in `values`.
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
    if (!DECORATION_CHECKS[field](value) || typeof value !== 'string') return { ok: false, field };
    values[field] = field === 'nameFont' && value === 'classic' ? null : value;
  }
  return { ok: true, values };
}

/** An update's decoration fields: a design, or null to clear it. */
export type DecorationsUpdate = { [Field in DecorationField]?: ProfileDecorations[Field] };
