import { useInbox } from './useInbox';

/**
 * The number the inbox's nav entries carry: unread mentions plus
 * conversations with something unread, muted ones left out. One count for the
 * sidebar row and the top bar button, so they can never disagree.
 */
export function useInboxCount(): number {
  const { conversations, unreadMentionCount } = useInbox();
  return conversations.length + unreadMentionCount;
}
