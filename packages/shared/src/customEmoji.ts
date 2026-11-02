/**
 * Custom emoji: pictures anyone on the instance can add, usable in every space
 * and conversation, in text and as reactions.
 *
 * There is one library for the whole instance. Anyone may add to it, the person
 * who added an emoji and the administrators may rename or remove it, and every
 * emoji can be used everywhere (nothing is tied to a space).
 *
 * In message text an emoji is the token `<:name:id>`. The id names the picture;
 * the name is only what a reader of the raw text sees, so a rename never breaks
 * an old message. As a reaction it is `emoji:<id>`, with no name, because a
 * reaction is counted by its exact text and a rename must not split the count.
 * Tokens in code stay text, as mentions do.
 */

export const CUSTOM_EMOJI_NAME_MIN = 2;
export const CUSTOM_EMOJI_NAME_MAX = 32;

export const CUSTOM_EMOJI_LIMITS = {
  /** Emoji the instance holds. */
  MAX_TOTAL: 500,
  /** Emoji one person added; administrators have no limit of their own. */
  MAX_PER_USER: 50,
  /** The largest original the server takes. */
  MAX_SOURCE_BYTES: 3 * 1024 * 1024,
  /** The most the stored picture may weigh. */
  MAX_STORED_BYTES: 256 * 1024,
  /** Stored pictures fit this square. */
  SIZE: 128,
  /** The most frames of an animated original that are kept. */
  MAX_FRAMES: 120,
  /** Uploads one person may send per minute. */
  UPLOADS_PER_MINUTE: 10,
} as const;

/** Namespace of an emoji used as a reaction. */
export const EMOJI_REACTION_PREFIX = 'emoji:';

export interface CustomEmoji {
  id: string;
  name: string;
  animated: boolean;
  /** Who added it, or null when that account is gone. */
  createdBy: string | null;
  createdAt: number;
}

const NAME_PATTERN = new RegExp(`^[a-z0-9_]{${CUSTOM_EMOJI_NAME_MIN},${CUSTOM_EMOJI_NAME_MAX}}$`);

/**
 * The form a name is stored in, or null when the value is not one: lower case,
 * letters, digits and underscores, two to thirty-two of them. Surrounding space
 * and capitals are forgiven (the name is typed between colons), anything else
 * is refused rather than quietly changed.
 */
export function normalizeEmojiName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/^:|:$/g, '').toLowerCase();
  return NAME_PATTERN.test(name) ? name : null;
}

/** An id as the server issues it (a snowflake, digits only). */
export const EMOJI_ID_PATTERN = /^\d{5,25}$/;

/** Where an emoji's picture is served from, relative to the instance. */
export function customEmojiUrl(id: string): string {
  return `/api/emojis/${id}.webp`;
}

/** The text of an emoji in a message. */
export function emojiToken(name: string, id: string): string {
  return `<:${name}:${id}>`;
}

/** The text of an emoji as a reaction. */
export function emojiReactionValue(id: string): string {
  return `${EMOJI_REACTION_PREFIX}${id}`;
}

/** The id an emoji reaction names, or null when the value is not one. */
export function emojiIdOfReaction(value: string): string | null {
  if (!value.startsWith(EMOJI_REACTION_PREFIX)) return null;
  const id = value.slice(EMOJI_REACTION_PREFIX.length);
  return EMOJI_ID_PATTERN.test(id) ? id : null;
}

/** Code spans (fenced, then inline), or an emoji token. A new instance per scan: the `g` flag makes a RegExp stateful. */
function emojiScanner(): RegExp {
  return /(```[\s\S]*?```|`[^`]+`)|<:([a-z0-9_]{2,32}):(\d{5,25})>/g;
}

export type EmojiPart =
  | { kind: 'text'; text: string }
  | { kind: 'emoji'; name: string; id: string; token: string };

/**
 * `content` cut into text and emoji parts, in order. Code stays inside text
 * parts as written, and adjacent text is joined, so reading each part's `text`
 * or `token` back gives `content` again. Empty content gives an empty list.
 */
export function splitCustomEmoji(content: string): EmojiPart[] {
  const parts: EmojiPart[] = [];
  let pending = '';
  let textStart = 0;
  for (const match of content.matchAll(emojiScanner())) {
    if (match[1] !== undefined) continue;
    pending += content.slice(textStart, match.index);
    if (pending) parts.push({ kind: 'text', text: pending });
    pending = '';
    parts.push({ kind: 'emoji', name: match[2]!, id: match[3]!, token: match[0] });
    textStart = match.index + match[0].length;
  }
  pending += content.slice(textStart);
  if (pending) parts.push({ kind: 'text', text: pending });
  return parts;
}

/** The ids of the emoji a message uses, outside code, each once. */
export function emojiIdsIn(content: string | null | undefined): string[] {
  if (!content) return [];
  return [...new Set(splitCustomEmoji(content).flatMap((part) => (part.kind === 'emoji' ? [part.id] : [])))];
}

/**
 * `content` with each `:name:` that names a known emoji (outside code) turned
 * into its token. People type and see `:name:`; the token is what is sent. A
 * name that is not in `idsByName` stays as typed, so ordinary `:smile:` text
 * and the standard shortcodes are left to the rest of the app.
 */
export function tokenizeCustomEmojiShortcodes(content: string, idsByName: ReadonlyMap<string, string>): string {
  if (idsByName.size === 0 || !content.includes(':')) return content;
  const scanner = /(```[\s\S]*?```|`[^`]+`|<:[a-z0-9_]{2,32}:\d{5,25}>)|(?<![\w:]):([a-z0-9_]{2,32}):(?![\w:])/g;
  return content.replace(scanner, (whole, protectedText: string | undefined, name: string | undefined) => {
    if (protectedText !== undefined || name === undefined) return whole;
    const id = idsByName.get(name);
    return id === undefined ? whole : emojiToken(name, id);
  });
}

/**
 * `content` with each emoji token as `:name:`, for places that show text only
 * (notifications, conversation previews). Code is left as written.
 */
export function emojiTokensToText(content: string): string {
  return splitCustomEmoji(content)
    .map((part) => (part.kind === 'emoji' ? `:${part.name}:` : part.text))
    .join('');
}
