// ─── Space Moderation Rules ─────────────────────────────────────────────────
// The automatic message rules of a space (Server settings → Moderation): how a
// change to them is validated and stored, and how a message is checked against
// them. The instance hosting the space runs both (server
// utils/spaceModeration.ts); a client may run the same check to explain a
// refusal. docs/systems/spaces.md, "Moderation", holds the rules.

import { isVisibleSingleLine } from './constants.js';
import { parseMentions } from './mentions.js';
import { stickerUrl } from './stickers.js';
import {
  MODERATION_LIMITS,
  type SpaceModerationSettings,
  type UpdateSpaceModerationRequest,
} from './types.js';

/** The rules of a space that has never changed them: nothing blocked, no limits. Copy before changing. */
export const DEFAULT_MODERATION_SETTINGS: Readonly<SpaceModerationSettings> = Object.freeze({
  blockedWords: [],
  blockLinks: false,
  blockInvites: false,
  maxMentions: 0,
  minAccountAgeMinutes: 0,
  minMemberAgeMinutes: 0,
  updatedAt: null,
});

/** A field of `UpdateSpaceModerationRequest`, as `moderation_settings_invalid` names it in `details.field`. */
export type ModerationSettingsField = keyof UpdateSpaceModerationRequest;

export type ModerationSettingsNormalization =
  | { ok: true; value: SpaceModerationSettings }
  | { ok: false; field: ModerationSettingsField | 'body' };

const BOOLEAN_FIELDS = ['blockLinks', 'blockInvites'] as const;

const NUMBER_FIELDS: ReadonlyArray<readonly ['maxMentions' | 'minAccountAgeMinutes' | 'minMemberAgeMinutes', number]> = [
  ['maxMentions', MODERATION_LIMITS.MAX_MENTIONS_CAP],
  ['minAccountAgeMinutes', MODERATION_LIMITS.MAX_AGE_MINUTES],
  ['minMemberAgeMinutes', MODERATION_LIMITS.MAX_AGE_MINUTES],
];

/**
 * The text a rule compares: compatibility forms folded (a fullwidth "ｂａｄ"
 * reads "bad") and format characters removed (a zero-width space inside a
 * word does not hide it). Applied to the content and to each entry alike.
 */
function comparable(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

/**
 * The stored form of one blocked word: whitespace runs made one space, the
 * whole trimmed, and a leading or trailing run of `*` kept as one `*` (the
 * entry may then sit inside a longer word on that side). `''` for an entry
 * with nothing left, which is dropped; null for one that cannot be shown on
 * one line (a control character, a bidirectional control, nothing visible).
 */
function normalizeBlockedWord(raw: string): string | null {
  const collapsed = raw.replace(/\s+/gu, ' ').trim();
  const leading = collapsed.startsWith('*');
  const trailing = collapsed.endsWith('*');
  const core = collapsed.replace(/^\*+/, '').replace(/\*+$/, '').trim();
  if (core.length === 0) return '';
  if (!isVisibleSingleLine(core)) return null;
  return `${leading ? '*' : ''}${core}${trailing ? '*' : ''}`;
}

/** Two entries that differ only in case or compatibility form block the same text. */
function blockedWordKey(entry: string): string {
  return comparable(entry).toLowerCase();
}

/**
 * The stored list from a request's `blockedWords`, or null when it is not a
 * list of strings or breaks a limit: each entry is normalized, empty ones are
 * dropped, repeats (compared without case) are kept once, and what remains
 * holds at most MAX_BLOCKED_WORDS entries of at most MAX_BLOCKED_WORD_LENGTH
 * UTF-16 code units each (the stored form, `*` included).
 */
function normalizeBlockedWords(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    const entry = normalizeBlockedWord(item);
    if (entry === null) return null;
    if (entry === '') continue;
    if (entry.length > MODERATION_LIMITS.MAX_BLOCKED_WORD_LENGTH) return null;
    const key = blockedWordKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(entry);
  }
  return words.length > MODERATION_LIMITS.MAX_BLOCKED_WORDS ? null : words;
}

/**
 * The rules after applying `patch` (a `PATCH /api/spaces/:id/moderation`
 * body) to `current`, or the first field that is not valid. A field the patch
 * leaves out keeps its value; fields the request type does not name are
 * ignored. `blockLinks` and `blockInvites` are booleans; `maxMentions` is a
 * whole number from 0 to MAX_MENTIONS_CAP and the two ages from 0 to
 * MAX_AGE_MINUTES, 0 meaning off. `updatedAt` is left as it is: the server
 * stamps it when it stores the result.
 */
export function normalizeModerationSettings(current: SpaceModerationSettings, patch: unknown): ModerationSettingsNormalization {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return { ok: false, field: 'body' };
  const input = patch as Record<string, unknown>;
  const value: SpaceModerationSettings = { ...current, blockedWords: [...current.blockedWords] };

  if (input.blockedWords !== undefined) {
    const words = normalizeBlockedWords(input.blockedWords);
    if (!words) return { ok: false, field: 'blockedWords' };
    value.blockedWords = words;
  }
  for (const field of BOOLEAN_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (typeof raw !== 'boolean') return { ok: false, field };
    value[field] = raw;
  }
  for (const [field, max] of NUMBER_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > max) return { ok: false, field };
    value[field] = raw;
  }
  return { ok: true, value };
}

// ─── Message checks ─────────────────────────────────────────────────────────

/** A character that continues a word: a letter, a combining mark, a digit or a connector such as `_`. */
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]';

/** The characters with a meaning in a regular expression, escaped so an entry matches as written. */
function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

/**
 * The pattern of one stored entry: its words in order, any whitespace between
 * them, and a word boundary on each side the entry has no `*` on. Null for an
 * entry with nothing to match.
 */
function blockedWordPattern(entry: string): string | null {
  const leading = entry.startsWith('*');
  const trailing = entry.endsWith('*');
  const core = comparable(entry.replace(/^\*+/, '').replace(/\*+$/, '')).trim();
  if (core.length === 0) return null;
  const body = core.split(/\s+/u).map(escapeRegExp).join('\\s+');
  return `(?:${leading ? '' : `(?<!${WORD_CHAR})`}${body}${trailing ? '' : `(?!${WORD_CHAR})`})`;
}

/**
 * One expression matching any of the entries, compared without regard to case
 * and only as whole words unless an entry has `*` on a side; null when there
 * is nothing to match. The patterns are literal text with fixed lookarounds,
 * so a match takes time linear in the content.
 */
export function compileBlockedWords(words: readonly string[]): RegExp | null {
  const patterns = words.map(blockedWordPattern).filter((pattern): pattern is string => pattern !== null);
  return patterns.length === 0 ? null : new RegExp(patterns.join('|'), 'iu');
}

/** A code after `/join/` as `generateInviteCode` makes it: eight characters of base64url. Older links are eight hex digits, which this covers. */
const JOIN_PATH_CODE = '[A-Za-z0-9_-]{8}(?![\\p{L}\\p{N}_-])';

/**
 * A code with a host after it (`<code>@host`): the old hex form only, because any wider and
 * every mail address would count as an invite.
 */
const QUALIFIED_INVITE_CODE = '[0-9a-f]{8}(?![\\p{L}\\p{N}])';

/** What could be a space's own address: only the server can tell whether one is (`isOwnAddress`). */
const JOIN_PATH_NAME = /\/join\/([a-z0-9-]{3,32})(?![\p{L}\p{N}_-])/giu;

/** A host name with a dot in it, and a port. */
const DOTTED_HOST = '(?:[\\p{L}\\p{N}-]+\\.)+[\\p{L}\\p{N}-]{2,}(?::\\d{1,5})?';

/**
 * An invite to a space, in every form the clients read one: a `/join/<code>`
 * link on any host, with or without its scheme (the code may be qualified,
 * `<code>%40host`); the desktop deep link `tavvit://join/<code>` (and the older
 * `orbit://` and upstream `backspace://`); and a qualified code `<code>@host`
 * (web utils/inviteParser.ts). A space's own address has no shape to tell it by
 * from a page called `/join/team` somewhere else, so `isOwnAddress` asks. Space invite cards are system messages the
 * instance writes in DMs, never text a member types, so they need no rule.
 */
const INVITE_PATTERN = new RegExp([
  `https?:\\/\\/[^\\s/?#<>]+\\/join\\/${JOIN_PATH_CODE}`,
  `(?<![\\p{L}\\p{N}._/-])${DOTTED_HOST}\\/join\\/${JOIN_PATH_CODE}`,
  `(?:tavvit|orbit|backspace):\\/\\/join\\/${JOIN_PATH_CODE}`,
  `(?<![\\p{L}\\p{N}._%+-])${QUALIFIED_INVITE_CODE}@${DOTTED_HOST}`,
].join('|'), 'iu');

/**
 * A web link: an `http://` or `https://` address, or a host written with
 * `www.` and a name after it. A bare name with a dot ("e.g.", "file.txt",
 * "example.com") is not one, so ordinary text is never refused for it.
 */
const LINK_PATTERN = /(?<![\p{L}\p{N}])https?:\/\/[^\s<>"']|(?<![\p{L}\p{N}_@./-])www\.[\p{L}\p{N}-]+\.[\p{L}\p{N}-]{2,}/iu;

/** How many people and roles a message mentions: distinct `<@user>` and `<@&role>` tokens outside code. */
export function countMentions(content: string | null | undefined): number {
  const parsed = parseMentions(content);
  return parsed.userIds.size + parsed.roleIds.size;
}

export type AutomodCode =
  | 'automod_blocked_word'
  | 'automod_link_blocked'
  | 'automod_invite_blocked'
  | 'automod_too_many_mentions';

/** Why a message breaks a space's rules: the ErrorCode its refusal answers with, and the details that code reads. */
export interface ModerationViolation {
  code: AutomodCode;
  details?: { max: number };
}

/**
 * The first rule `content` breaks, or null: a blocked word, then an invite,
 * then a link, then more than `maxMentions` mentions (`mentionCount`, as
 * `countMentions` reads the content). A sticker (the whole content is a
 * sticker token, `stickerUrl`) carries no text, so only the mention limit can
 * apply to it. Who is exempt is the caller's decision. `isOwnAddress` says
 * whether a name after `/join/` is a space's own invite address here.
 */
export function findModerationViolation(
  content: string | null | undefined,
  settings: Pick<SpaceModerationSettings, 'blockedWords' | 'blockLinks' | 'blockInvites' | 'maxMentions'>,
  mentionCount: number,
  isOwnAddress?: (name: string) => boolean,
): ModerationViolation | null {
  const text = content?.trim() ?? '';
  if (text.length > 0 && stickerUrl(text) === null) {
    const compared = comparable(text);
    const blocked = compileBlockedWords(settings.blockedWords);
    if (blocked && blocked.test(compared)) return { code: 'automod_blocked_word' };
    if (settings.blockInvites && INVITE_PATTERN.test(compared)) return { code: 'automod_invite_blocked' };
    if (settings.blockInvites && isOwnAddress) {
      for (const match of compared.matchAll(JOIN_PATH_NAME)) {
        if (isOwnAddress(match[1]!.toLowerCase())) return { code: 'automod_invite_blocked' };
      }
    }
    if (settings.blockLinks && LINK_PATTERN.test(compared)) return { code: 'automod_link_blocked' };
  }
  if (settings.maxMentions > 0 && mentionCount > settings.maxMentions) {
    return { code: 'automod_too_many_mentions', details: { max: settings.maxMentions } };
  }
  return null;
}
