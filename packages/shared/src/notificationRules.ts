import { splitMentions } from './mentions.js';
import type { ChannelNotificationPolicy } from './types.js';

/**
 * Whether a message alerts its reader: the one rule, read by the client for its sound and
 * notification and by the server for a push while the app is closed (docs/systems/push.md),
 * so the two cannot come to different answers.
 */

export const KEYWORD_LIMITS = {
  /** How many words one account can watch. */
  MAX: 25,
  MIN_LENGTH: 2,
  MAX_LENGTH: 50,
} as const;

/** A word as it is kept and compared, or null when it is not one. */
export function cleanKeyword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const word = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return word.length >= KEYWORD_LIMITS.MIN_LENGTH && word.length <= KEYWORD_LIMITS.MAX_LENGTH ? word : null;
}

const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
/** What counts as part of a word on either side, in any alphabet. Scripts written without spaces have no such edge. */
const WORD_EDGE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
const escapeForRegExp = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a message holds one of the words a person watches: whole words, in any case, outside
 * code. "raid" finds "Raid?" and not "afraid". In a script written without spaces there are no
 * whole words to go by, so there the word is found anywhere.
 */
export function matchesKeyword(content: string | null | undefined, keywords: readonly string[] | undefined): boolean {
  if (!content || !keywords || keywords.length === 0) return false;
  const text = content.replace(CODE, ' ').toLowerCase();
  return keywords.some((word) => {
    const at = escapeForRegExp(word);
    return WORD_EDGE.test(word) ? text.includes(word) : new RegExp(`(?<![\\p{L}\\p{N}_])${at}(?![\\p{L}\\p{N}_])`, 'u').test(text);
  });
}

/** Whether `content` mentions any of `userIds` with a `<@id>` token outside code. */
export function contentMentionsAny(content: string, userIds: ReadonlySet<string>): boolean {
  return splitMentions(content).some((part) => part.kind === 'user' && userIds.has(part.userId));
}

/** What a message mentions, as the reader needs it to decide whether it mentions them. */
export interface MessageMentionInput {
  /** The reader's id on the instance that issued the channel. */
  myId: string | undefined;
  /** The reader's role ids in the channel's space on that instance; absent for a DM or an unread roster. */
  myRoleIds?: readonly string[];
  content: string | null;
  /**
   * The mass mention fields the instance hosting the space stamped on the
   * message (`Message.mentionEveryone`, `Message.mentionRoleIds`). Mass
   * mentions are read from these alone, never from the text: that instance
   * stamps only what it let an author with MENTION_EVERYONE send, and an
   * instance from before the permission stamps nothing.
   */
  mentionEveryone?: boolean;
  mentionRoleIds?: readonly string[];
}

/** How a message mentions its reader. Each is false when it does not. */
export interface MessageMentions {
  /** A `<@id>` token for the reader's id, outside code. */
  direct: boolean;
  /** A stamped `@everyone` or `@here`. */
  everyone: boolean;
  /** A stamped role the reader holds. */
  role: boolean;
}

/**
 * How a message mentions the reader: the rule the alert below and the
 * message highlight (`Message.tsx`) share. Documented in
 * docs/systems/sounds.md ("Which messages alert").
 */
export function messageMentions(input: MessageMentionInput): MessageMentions {
  const direct = !!input.content && !!input.myId && contentMentionsAny(input.content, new Set([input.myId]));
  const everyone = input.mentionEveryone === true;
  const stamped = input.mentionRoleIds ?? [];
  const role = stamped.length > 0 && (input.myRoleIds ?? []).some((id) => stamped.includes(id));
  return { direct, everyone, role };
}

/** Whether a message mentions the reader in any way: what the highlight shows. */
export function mentionsReader(input: MessageMentionInput): boolean {
  const m = messageMentions(input);
  return m.direct || m.everyone || m.role;
}

/**
 * The rule that decides whether a freshly-arrived chat message alerts the user.
 * Pure; the caller answers who wrote it, which id is the user's in that
 * channel and what the channel's notification settings are (see
 * `messageAlertsUser` in utils/alerts.ts, which both outputs of the `message`
 * alert kind go through). Documented in docs/systems/sounds.md ("Which
 * messages alert").
 *
 * Rule:
 *   - Never for a message the user wrote (`authoredBySelf`).
 *   - Always for a DM. Notification settings belong to spaces and channels
 *     and do not reach DMs.
 *   - For a space channel, by its notification policy:
 *     - muted (its own mute or its space's): never, mentions included;
 *     - `nothing`: never, mentions included;
 *     - `all`: every message;
 *     - `mentions`: a message that mentions the user (`messageMentions`):
 *       directly, by a stamped `@everyone` / `@here` unless the space's
 *       `suppressEveryone` is on, or by a stamped role they hold unless
 *       `suppressRoles` is on. The switches never hold back a direct mention.
 *       With `allChannels`, every message: only the in-app cue passes it,
 *       since the "Play sound for every message" preference is a sound
 *       setting and does not widen the OS notification. It widens `mentions`
 *       only, so it never overrides a channel the user set to `nothing` or
 *       muted.
 */
export interface MessageAlertInput extends MessageMentionInput {
  authoredBySelf: boolean;
  isDmChannel: boolean;
  allChannels: boolean;
  /** The words this person watches. A hit counts as a mention of them. */
  keywords?: readonly string[];
  /** The channel's resolved settings (`resolveChannelNotificationPolicy`); not read for a DM. */
  notification: Pick<ChannelNotificationPolicy, 'level' | 'muted'> & Partial<Pick<ChannelNotificationPolicy, 'suppressEveryone' | 'suppressRoles'>>;
}

export function isMessageAlert(input: MessageAlertInput): boolean {
  if (input.authoredBySelf) return false;
  if (input.isDmChannel) return true;
  if (input.notification.muted) return false;
  switch (input.notification.level) {
    case 'nothing':
      return false;
    case 'all':
      return true;
    case 'mentions': {
      if (input.allChannels) return true;
      const m = messageMentions(input);
      return m.direct
        || (m.everyone && input.notification.suppressEveryone !== true)
        || (m.role && input.notification.suppressRoles !== true)
        || matchesKeyword(input.content, input.keywords);
    }
  }
}
