import { create } from 'zustand';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';
import { api } from '../api/client';

/**
 * The instance's custom emoji library, as the home instance lists it.
 *
 * Emoji belong to the instance that holds them: an id means nothing on another
 * instance, so this store speaks to the home client only and a message from a
 * channel another instance hosts shows its emoji as `:name:` text.
 *
 * Sources: `load()` when the home socket's `ready` arrives, `emoji_upserted` and
 * `emoji_removed` from that socket, and the answers to this person's own
 * `create()`, `rename()` and `remove()` calls. All of them go through `upsert`
 * and `drop`, so a change that arrives twice (the answer and the event) lands once.
 *
 * Imports no other store, so the message renderer and the composer can read it
 * without import cycles.
 */

export type EmojiLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface EmojiState {
  /** By name. */
  emojis: readonly CustomEmoji[];
  byId: ReadonlyMap<string, CustomEmoji>;
  /** Name to id, for turning `:name:` the person typed into a token. */
  idsByName: ReadonlyMap<string, string>;
  status: EmojiLoadStatus;
  load: () => Promise<void>;
  upsert: (emoji: CustomEmoji) => void;
  drop: (emojiId: string) => void;
  create: (name: string, image: string) => Promise<CustomEmoji>;
  rename: (id: string, name: string) => Promise<CustomEmoji>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

/** The latest `load`; an answer for an older one, or for a previous session, is dropped. */
let loadSeq = 0;

function byName(a: CustomEmoji, b: CustomEmoji): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function derived(emojis: readonly CustomEmoji[]) {
  const sorted = [...emojis].sort(byName);
  return {
    emojis: sorted,
    byId: new Map(sorted.map((emoji) => [emoji.id, emoji])),
    idsByName: new Map(sorted.map((emoji) => [emoji.name, emoji.id])),
  };
}

export const useEmojiStore = create<EmojiState>((set, get) => ({
  ...derived([]),
  status: 'idle',

  load: async () => {
    const seq = ++loadSeq;
    set({ status: 'loading' });
    try {
      const { emojis } = await api.emojis.list();
      if (seq !== loadSeq) return;
      set({ ...derived(emojis), status: 'ready' });
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error('Failed to load the emoji library:', err);
      set({ status: 'failed' });
    }
  },

  upsert: (emoji) => {
    set(derived([...get().emojis.filter((existing) => existing.id !== emoji.id), emoji]));
  },

  drop: (emojiId) => {
    set(derived(get().emojis.filter((emoji) => emoji.id !== emojiId)));
  },

  create: async (name, image) => {
    const emoji = await api.emojis.create({ name, image });
    get().upsert(emoji);
    return emoji;
  },

  rename: async (id, name) => {
    const emoji = await api.emojis.rename(id, name);
    get().upsert(emoji);
    return emoji;
  },

  remove: async (id) => {
    await api.emojis.remove(id);
    get().drop(id);
  },

  reset: () => {
    loadSeq++;
    set({ ...derived([]), status: 'idle' });
  },
}));

/** The emoji with this id, or undefined (not in the library, or not loaded yet). */
export function findCustomEmoji(id: string): CustomEmoji | undefined {
  return useEmojiStore.getState().byId.get(id);
}
