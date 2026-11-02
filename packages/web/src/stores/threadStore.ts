import { create } from 'zustand';
import type { ThreadInfo, ThreadSummary } from '@backspace/shared/src/threads';

export interface OpenThread {
  threadId: string;
  parentChannelId: string;
  /** Where to start reading, once: a mention or a notification leads here. */
  jumpToMessageId: string | null;
}

/** A followed thread, with the instance that holds it. */
export type FollowedThread = ThreadInfo & { origin: string };

interface ThreadState {
  /** The thread in the panel beside a channel, on a window. A phone shows it as a screen instead. */
  open: OpenThread | null;
  /** The threads the user follows, on every connected instance. */
  followed: ReadonlyMap<string, FollowedThread>;
  /** The thread this client has open, whichever surface shows it: it asks to hear about that one. */
  watching: { threadId: string; origin: string } | null;
  /** Threads deleted while the client was running, so one still open can say so. */
  gone: ReadonlySet<string>;
  openThread: (thread: OpenThread) => void;
  closeThread: () => void;
  clearJump: () => void;
  setWatching: (watching: { threadId: string; origin: string } | null) => void;
  /** What a `ready` says of one instance replaces what was known of it. */
  setFollowedFrom: (origin: string, threads: readonly ThreadInfo[]) => void;
  addFollowed: (origin: string, thread: ThreadInfo) => void;
  removeFollowed: (threadId: string) => void;
  applySummary: (summary: ThreadSummary) => void;
  markGone: (threadId: string) => void;
  /** A channel went: its threads go with it. */
  dropChannel: (channelId: string) => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  open: null,
  followed: new Map(),
  watching: null,
  gone: new Set(),
  openThread: (thread) => set({ open: thread }),
  closeThread: () => set({ open: null }),
  clearJump: () => set((state) => (state.open?.jumpToMessageId ? { open: { ...state.open, jumpToMessageId: null } } : state)),
  setWatching: (watching) => set({ watching }),
  setFollowedFrom: (origin, threads) => set((state) => {
    const followed = new Map([...state.followed].filter(([, thread]) => thread.origin !== origin));
    for (const thread of threads) followed.set(thread.id, { ...thread, origin });
    return { followed };
  }),
  addFollowed: (origin, thread) => set((state) => {
    const followed = new Map(state.followed);
    followed.set(thread.id, { ...thread, origin, following: true });
    return { followed };
  }),
  removeFollowed: (threadId) => set((state) => {
    if (!state.followed.has(threadId)) return state;
    const followed = new Map(state.followed);
    followed.delete(threadId);
    return { followed };
  }),
  applySummary: (summary) => set((state) => {
    const known = state.followed.get(summary.id);
    if (!known) return state;
    const followed = new Map(state.followed);
    followed.set(summary.id, { ...known, ...summary });
    return { followed };
  }),
  markGone: (threadId) => set((state) => {
    const followed = new Map(state.followed);
    followed.delete(threadId);
    return {
      followed,
      gone: new Set([...state.gone, threadId]),
      open: state.open?.threadId === threadId ? null : state.open,
    };
  }),
  dropChannel: (channelId) => set((state) => ({
    followed: new Map([...state.followed].filter(([, thread]) => thread.parentChannelId !== channelId)),
    open: state.open?.parentChannelId === channelId ? null : state.open,
  })),
}));
