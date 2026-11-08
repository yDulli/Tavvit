import type { ReportGround } from './legal.js';
import type { SpaceSound } from './soundboard.js';
import type { SpaceEmoji, SpaceSticker } from './spaceExpressions.js';

/**
 * What an instance administrator can take away directly, without a report to decide
 * (docs/systems/admin.md, "Removing content"): a message in a space, parts of a person's
 * profile, parts of a space and its emoji, stickers and sounds, or the whole space. Each removal
 * names its reason and its ground, tells the person it concerns (DSA Art. 17) and goes into the
 * platform audit log. Direct messages stay with reports: an administrator does not read them.
 */

/** The parts of a person's profile an administrator can remove. */
export const PROFILE_REMOVABLE_PARTS = [
  'avatar',
  'banner',
  'displayName',
  'bio',
  'status',
  'pronouns',
  'links',
  'decorations',
  'spaceTag',
] as const;
export type ProfileRemovablePart = (typeof PROFILE_REMOVABLE_PARTS)[number];

/** The parts of a space an administrator can remove. Its name stays: a space has to have one. */
export const SPACE_REMOVABLE_PARTS = ['icon', 'banner', 'description', 'tag'] as const;
export type SpaceRemovablePart = (typeof SPACE_REMOVABLE_PARTS)[number];

/** What a space holds that an administrator can remove one by one. */
export const SPACE_EXPRESSION_KINDS = ['emoji', 'sticker', 'sound'] as const;
export type SpaceExpressionKind = (typeof SPACE_EXPRESSION_KINDS)[number];

/** The reason, told to the person it concerns. */
export const REMOVAL_REASON_LIMITS = { MIN: 3, MAX: 500 } as const;

export function isProfileRemovablePart(value: unknown): value is ProfileRemovablePart {
  return typeof value === 'string' && (PROFILE_REMOVABLE_PARTS as readonly string[]).includes(value);
}

export function isSpaceRemovablePart(value: unknown): value is SpaceRemovablePart {
  return typeof value === 'string' && (SPACE_REMOVABLE_PARTS as readonly string[]).includes(value);
}

export function isSpaceExpressionKind(value: unknown): value is SpaceExpressionKind {
  return typeof value === 'string' && (SPACE_EXPRESSION_KINDS as readonly string[]).includes(value);
}

/**
 * The parts a removal names, each once and in the list's order; null when the list is empty or
 * names anything else.
 */
export function removalPartsOf<Part extends string>(value: unknown, known: readonly Part[]): Part[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > known.length) return null;
  if (!value.every((part) => typeof part === 'string' && (known as readonly string[]).includes(part))) return null;
  const named = new Set(value as string[]);
  return known.filter((part) => named.has(part));
}

/**
 * What a notice of `profile_content_removed`, `space_content_removed` or `space_removed` is about,
 * kept in its `subject` as a small JSON document: the parts by their keys, which the client names
 * in the person's own language (legal `notices.parts.*`) whatever language the administrator wrote
 * in, the space by its name, and an emoji, a sticker or a sound by its kind and name.
 */
export interface RemovalSubject {
  parts?: string[];
  space?: string;
  expression?: SpaceExpressionKind;
  name?: string;
}

/** A notice's subject holds at most 200 characters: names are cut so the document always fits. */
const SUBJECT_NAME_MAX = 60;

export function removalSubject(subject: RemovalSubject): string {
  const cut = (value: string | undefined) => (value === undefined ? undefined : [...value].slice(0, SUBJECT_NAME_MAX).join(''));
  return JSON.stringify({
    ...(subject.parts ? { parts: subject.parts } : {}),
    ...(subject.space !== undefined ? { space: cut(subject.space) } : {}),
    ...(subject.expression ? { expression: subject.expression } : {}),
    ...(subject.name !== undefined ? { name: cut(subject.name) } : {}),
  });
}

/** A notice's subject read back; null for anything that is not such a document. */
export function removalSubjectOf(value: string | null): RemovalSubject | null {
  if (!value || !value.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const subject: RemovalSubject = {};
  if (Array.isArray(record.parts)) subject.parts = record.parts.filter((part): part is string => typeof part === 'string');
  if (typeof record.space === 'string') subject.space = record.space;
  if (isSpaceExpressionKind(record.expression)) subject.expression = record.expression;
  if (typeof record.name === 'string') subject.name = record.name;
  return subject;
}

/** What every removal asks for. */
export interface RemovalRequest {
  reason: string;
  ground: ReportGround;
}

export interface RemoveProfileContentRequest extends RemovalRequest {
  parts: ProfileRemovablePart[];
}

export interface RemoveSpaceContentRequest extends RemovalRequest {
  parts: SpaceRemovablePart[];
}

export interface RemoveSpaceExpressionRequest extends RemovalRequest {
  kind: SpaceExpressionKind;
  id: string;
}

/** A space's emoji, stickers and sounds, as the admin console lists them (an administrator need not be a member). */
export interface AdminSpaceExpressions {
  emojis: SpaceEmoji[];
  stickers: SpaceSticker[];
  sounds: SpaceSound[];
}
