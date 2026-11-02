import { useChatStore } from '../stores/chatStore';

/**
 * Marks a channel or DM read up to its newest message without opening it.
 *
 * A read position is a message id, and the newest one is known only once the
 * newest page is loaded, so this loads it (a no-op when it already is) and then
 * acknowledges it the way opening the conversation would (`ackChannel`), which
 * moves the read position on the conversation's own instance. Resolves false
 * when the messages could not be loaded, so the caller can say so.
 */
export async function markConversationRead(channelId: string): Promise<boolean> {
  const loaded = await useChatStore.getState().loadMessages(channelId);
  if (!loaded) return false;
  useChatStore.getState().ackChannel(channelId);
  return true;
}
