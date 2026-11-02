/**
 * Forums (docs/systems/forums.md): a channel of type `forum` holds no messages of its own.
 * Each post is a thread with no message in the channel it grew from, so its messages, rights,
 * following and unread counts are a thread's. New here are a title people choose, tags, and
 * the list of posts by latest activity.
 */
import type { ThreadInfo } from './threads.js';
import type { User } from './types.js';

export const FORUM_LIMITS = {
  TAGS_PER_FORUM: 20,
  TAG_NAME_MAX_LENGTH: 24,
  TAGS_PER_POST: 5,
  /** How many posts one page of the list holds. */
  PAGE_SIZE: 30,
  /** How much of the first message the list shows. */
  PREVIEW_LENGTH: 200,
} as const;

/** The colours a tag can have: the accent family, by name, so a theme keeps them readable. */
export const FORUM_TAG_COLORS = ['mint', 'peach', 'lavender', 'sky', 'amber', 'rose', 'coral'] as const;
export type ForumTagColor = (typeof FORUM_TAG_COLORS)[number];

export function isForumTagColor(value: unknown): value is ForumTagColor {
  return typeof value === 'string' && (FORUM_TAG_COLORS as readonly string[]).includes(value);
}

export interface ForumTag {
  id: string;
  name: string;
  color: ForumTagColor | null;
}

/** One post in a forum's list. */
export interface ForumPost extends ThreadInfo {
  tagIds: string[];
  /** Null when the account is gone. */
  author: User | null;
  /** The first message as plain words, without anything a spoiler hides. */
  preview: string | null;
  /** The stored file of the first picture's thumbnail, unless it is a spoiler. */
  thumbnail: string | null;
}

export interface ForumPostsResponse {
  tags: ForumTag[];
  posts: ForumPost[];
  /** What to ask for as `before` to go on; null at the end of the list. */
  nextBefore: string | null;
}

export interface CreateForumPostRequest {
  title: string;
  content?: string;
  tagIds?: string[];
  attachments?: string[];
  spoilerAttachments?: string[];
}

export interface UpdateForumTagsRequest {
  /** All of a forum's tags at once, in the order they stand. An id keeps a tag on its posts; one without is new. */
  tags: Array<{ id?: string; name: string; color?: ForumTagColor | null }>;
}
