/**
 * Threads (docs/systems/threads.md): a side conversation that grows from one message of a
 * text channel. On the server it is a channel of type `thread` with the rights of its parent,
 * so messages, files, reactions, typing, search and read state work as anywhere.
 */
import type { MessageWithUser } from './types.js';

export const THREAD_LIMITS = {
  NAME_MAX_LENGTH: 100,
  /** How many threads a channel's list shows at a time. */
  LIST_MAX: 50,
} as const;

/** A thread with no new message for this long goes from a channel's list to its archive. A new message brings it back. */
export const THREAD_ARCHIVE_AFTER_MS = 7 * 24 * 3600 * 1000;

/** What the message a thread grew from shows of it. */
export interface ThreadSummary {
  id: string;
  name: string;
  /** Messages people wrote in it. */
  messageCount: number;
  lastMessageAt: number | null;
  /** A post of a forum: its tags. Left out for a thread that grew from a message. */
  tagIds?: string[];
}

export interface ThreadInfo extends ThreadSummary {
  spaceId: string;
  parentChannelId: string;
  /** Null once that message is gone; the thread stays. */
  starterMessageId: string | null;
  createdBy: string | null;
  createdAt: number;
  /** Whether the reader follows it. */
  following: boolean;
  /** The newest message, to tell whether the reader has seen it. */
  lastMessageId?: string | null;
  /** The reader's permissions in it, those of its parent (decimal string). */
  myPermissions?: string;
}

/** What opening a thread answers. */
export interface ThreadOpened {
  thread: ThreadInfo;
  /** The message it grew from, null when that is gone. */
  starter: MessageWithUser | null;
}

/** Whether a thread has gone quiet long enough to leave its channel's list. */
export function threadArchived(thread: Pick<ThreadInfo, 'lastMessageAt' | 'createdAt'>, now: number): boolean {
  return now - (thread.lastMessageAt ?? thread.createdAt) > THREAD_ARCHIVE_AFTER_MS;
}

/**
 * How a followed thread alerts: every message, unless the reader's setting for the channel
 * it is in says nothing at all. Following is the choice to hear about it.
 */
export function followedThreadLevel<T extends { level: 'all' | 'mentions' | 'nothing' }>(policy: T): T {
  return policy.level === 'nothing' ? policy : { ...policy, level: 'all' };
}
