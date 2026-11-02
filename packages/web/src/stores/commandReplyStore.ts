import { create } from 'zustand';
import type { CommandReply } from '@backspace/shared/src/bots';

/** The most a channel keeps on screen: a bot that keeps answering must not fill it. */
const MAX_PER_CHANNEL = 5;

interface CommandReplyState {
  /**
   * What bots answered this person alone (docs/systems/bots.md, "Commands"). Nothing keeps these
   * anywhere: a reload ends them, as the person is told on each.
   */
  replies: CommandReply[];
  add: (reply: CommandReply) => void;
  dismiss: (id: string) => void;
  reset: () => void;
}

export const useCommandReplyStore = create<CommandReplyState>((set) => ({
  replies: [],
  add: (reply) => set((state) => {
    const others = state.replies.filter((item) => item.channelId !== reply.channelId);
    const sameChannel = state.replies.filter((item) => item.channelId === reply.channelId);
    return { replies: [...others, ...sameChannel.slice(-(MAX_PER_CHANNEL - 1)), reply] };
  }),
  dismiss: (id) => set((state) => ({ replies: state.replies.filter((item) => item.id !== id) })),
  reset: () => set({ replies: [] }),
}));
