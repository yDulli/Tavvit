import { create } from 'zustand';
import { api } from '../api/client';

interface KeywordState {
  /** The words this person watches, kept on their home instance. */
  words: readonly string[];
  load: () => Promise<void>;
  set: (words: string[]) => Promise<void>;
  reset: () => void;
}

export const useKeywordStore = create<KeywordState>((set) => ({
  words: [],

  load: async () => {
    try {
      const { keywords } = await api.keywords.get();
      set({ words: keywords });
    } catch {
      // Nothing is lost: the words alert again from the next connection on.
    }
  },

  set: async (words) => {
    const { keywords } = await api.keywords.set(words);
    set({ words: keywords });
  },

  reset: () => set({ words: [] }),
}));
