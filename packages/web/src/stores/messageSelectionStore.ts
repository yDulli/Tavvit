import { create } from 'zustand';
import { MAX_BULK_DELETE_MESSAGES } from '@backspace/shared';

interface MessageSelectionState {
  /** The channel being picked from; null when nobody is picking. One at a time. */
  channelId: string | null;
  ids: ReadonlySet<string>;
  start: (channelId: string, messageId: string) => void;
  toggle: (messageId: string) => void;
  /** Takes those out that went meanwhile, by anyone. */
  drop: (messageIds: readonly string[]) => void;
  cancel: () => void;
}

const NOTHING: ReadonlySet<string> = new Set();

/**
 * The messages picked to delete together (`MessageList` draws the bar, each `Message` its
 * box). Only someone who may manage a channel's messages starts it, and the server decides.
 */
export const useMessageSelection = create<MessageSelectionState>((set) => ({
  channelId: null,
  ids: NOTHING,
  start: (channelId, messageId) => set({ channelId, ids: new Set([messageId]) }),
  toggle: (messageId) => set((state) => {
    if (state.channelId === null) return state;
    const ids = new Set(state.ids);
    if (ids.has(messageId)) ids.delete(messageId);
    else if (ids.size < MAX_BULK_DELETE_MESSAGES) ids.add(messageId);
    return { ids };
  }),
  drop: (messageIds) => set((state) => {
    if (state.channelId === null || !messageIds.some((id) => state.ids.has(id))) return state;
    const ids = new Set(state.ids);
    for (const id of messageIds) ids.delete(id);
    return { ids };
  }),
  cancel: () => set({ channelId: null, ids: NOTHING }),
}));
