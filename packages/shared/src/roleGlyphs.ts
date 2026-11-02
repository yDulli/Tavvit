/**
 * The icons a role can have (docs/systems/permissions.md, "Role display"). Tavvit's own set,
 * drawn in the role's colour or gradient, in place of emoji, which come in everyone's
 * system's colours and clash with the rest of the interface. Stored in `roles.icon` as
 * `glyph:<id>`. The drawings are the client's (`packages/web/src/roles/`); here is what a
 * server needs to check a value and a client needs to offer them.
 */
export const ROLE_GLYPH_GROUPS = {
  rank: ['crown', 'crownb', 'shield', 'shieldstar', 'shieldok', 'trophy', 'medal', 'star', 'star4', 'sparkle', 'diamond', 'key', 'flag', 'banner'],
  power: ['sword', 'bolt', 'fire', 'skull', 'wand', 'target', 'hammer', 'ghost', 'alien', 'robot', 'mask', 'eye'],
  play: ['gamepad', 'joystick', 'dice', 'puzzle', 'music', 'headset', 'mic', 'guitar', 'film', 'camera', 'brush', 'palette', 'pen', 'book', 'gradcap'],
  make: ['code', 'terminal', 'bug', 'chip', 'flask', 'atom', 'rocket', 'planet', 'compass', 'wrench', 'megaphone', 'handshake'],
  nature: ['leaf', 'tree', 'lotus', 'moon', 'sun', 'snow', 'waves', 'mountain', 'storm', 'paw', 'bird', 'cat', 'butterfly', 'feather', 'fish'],
  life: ['heart', 'coffee', 'pizza', 'cake', 'gift', 'beer', 'handheart', 'anchor', 'globe', 'infinity', 'hourglass', 'bell'],
} as const;

export type RoleGlyphGroup = keyof typeof ROLE_GLYPH_GROUPS;
export type RoleGlyphId = (typeof ROLE_GLYPH_GROUPS)[RoleGlyphGroup][number];

export const ROLE_GLYPH_GROUP_IDS = Object.keys(ROLE_GLYPH_GROUPS) as RoleGlyphGroup[];
export const ROLE_GLYPH_IDS: readonly RoleGlyphId[] = ROLE_GLYPH_GROUP_IDS.flatMap((group) => ROLE_GLYPH_GROUPS[group]);

const KNOWN: ReadonlySet<string> = new Set(ROLE_GLYPH_IDS);
const PREFIX = 'glyph:';

/** What `roles.icon` holds for this icon. */
export function roleGlyphValue(id: RoleGlyphId): string {
  return `${PREFIX}${id}`;
}

/** The icon a stored `glyph:<id>` names, or null for anything else. */
export function parseRoleGlyph(icon: string): RoleGlyphId | null {
  if (!icon.startsWith(PREFIX)) return null;
  const id = icon.slice(PREFIX.length);
  return KNOWN.has(id) ? (id as RoleGlyphId) : null;
}

/**
 * The emoji roles have from before this set, and from Discord templates, that have an icon
 * meaning the same. They are drawn with it, so existing roles look right without anyone
 * doing anything. What is stored stays as it was.
 */
const FROM_EMOJI: Readonly<Record<string, RoleGlyphId>> = {
  '👑': 'crown', '🛡': 'shield', '🏆': 'trophy', '🥇': 'medal', '🏅': 'medal', '🎖': 'medal', '⭐': 'star', '🌟': 'star', '✨': 'sparkle', '💎': 'diamond', '🔑': 'key', '🗝': 'key', '🚩': 'flag', '🏴': 'flag', '🏳': 'flag',
  '⚔': 'sword', '🗡': 'sword', '⚡': 'bolt', '🔥': 'fire', '💀': 'skull', '☠': 'skull', '🪄': 'wand', '🎯': 'target', '🔨': 'hammer', '⚒': 'hammer', '👻': 'ghost', '👽': 'alien', '🤖': 'robot', '🎭': 'mask', '👁': 'eye', '👀': 'eye',
  '🎮': 'gamepad', '🕹': 'joystick', '🎲': 'dice', '🧩': 'puzzle', '🎵': 'music', '🎶': 'music', '🎧': 'headset', '🎤': 'mic', '🎸': 'guitar', '🎬': 'film', '🎥': 'film', '📷': 'camera', '📸': 'camera', '🖌': 'brush', '🎨': 'palette', '🖊': 'pen', '✏': 'pen', '📚': 'book', '📖': 'book', '🎓': 'gradcap',
  '💻': 'code', '🖥': 'terminal', '🐛': 'bug', '🧪': 'flask', '⚗': 'flask', '⚛': 'atom', '🚀': 'rocket', '🪐': 'planet', '🧭': 'compass', '🔧': 'wrench', '🛠': 'wrench', '📣': 'megaphone', '📢': 'megaphone', '🤝': 'handshake',
  '🌱': 'leaf', '🌿': 'leaf', '🍃': 'leaf', '🍀': 'leaf', '🌲': 'tree', '🌳': 'tree', '🌸': 'lotus', '🌺': 'lotus', '🪷': 'lotus', '🌙': 'moon', '🌛': 'moon', '☀': 'sun', '🌞': 'sun', '❄': 'snow', '🌊': 'waves', '⛰': 'mountain', '🏔': 'mountain', '🌩': 'storm', '⛈': 'storm', '🐾': 'paw', '🐦': 'bird', '🕊': 'bird', '🐱': 'cat', '🐈': 'cat', '🦋': 'butterfly', '🪶': 'feather', '🐟': 'fish', '🐠': 'fish',
  '❤': 'heart', '💜': 'heart', '💙': 'heart', '💚': 'heart', '💛': 'heart', '🧡': 'heart', '🖤': 'heart', '🤍': 'heart', '💖': 'heart', '☕': 'coffee', '🍕': 'pizza', '🎂': 'cake', '🍰': 'cake', '🎁': 'gift', '🍺': 'beer', '🍻': 'beer', '⚓': 'anchor', '🌍': 'globe', '🌎': 'globe', '🌏': 'globe', '♾': 'infinity', '⏳': 'hourglass', '⌛': 'hourglass', '🔔': 'bell',
};

/**
 * Which icon of the set to draw for what `roles.icon` holds: the one it names, or the one
 * that means the same as its emoji. Null for an emoji without one, which is then shown as it is.
 */
export function roleIconGlyph(icon: string): RoleGlyphId | null {
  const named = parseRoleGlyph(icon);
  if (named) return named;
  // A variation selector asks for an emoji's coloured form: it is the same emoji.
  return FROM_EMOJI[icon.replace(/️/gu, '')] ?? null;
}
