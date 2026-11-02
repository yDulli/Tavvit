import { create } from 'zustand';
import type { SavedItem, SavedKind } from '@backspace/shared/src/saved';
import { getApiForOrigin } from './spaceStore';

/** Each instance answers for the messages it holds, so an item belongs to the origin it came from. */
export const savedKey = (origin: string, messageId: string): string => `${origin}|${messageId}`;

export type SavedEntry = SavedItem & { origin: string };

interface SavedOrigin {
  items: readonly SavedEntry[];
  nextBefore: string | null;
  status: 'idle' | 'loading' | 'ready' | 'failed';
}

interface SavedState {
  /** What is on the list, as the message menu needs to know. */
  ids: ReadonlySet<string>;
  byOrigin: Readonly<Record<string, SavedOrigin>>;
  loadIds: (origin: string) => Promise<void>;
  loadList: (origin: string) => Promise<void>;
  loadMore: (origin: string) => Promise<void>;
  save: (origin: string, kind: SavedKind, messageId: string, remindAt?: number | null) => Promise<void>;
  remove: (origin: string, kind: SavedKind, messageId: string) => Promise<void>;
  applyChanged: (origin: string, messageId: string, saved: boolean) => void;
  applyReminderDone: (origin: string, savedId: string) => void;
  reset: () => void;
}

const EMPTY: SavedOrigin = { items: [], nextBefore: null, status: 'idle' };

export function selectAllSaved(state: Pick<SavedState, 'byOrigin'>): SavedEntry[] {
  return Object.values(state.byOrigin)
    .flatMap((list) => list.items)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const useSavedStore = create<SavedState>((set, get) => ({
  ids: new Set(),
  byOrigin: {},

  loadIds: async (origin) => {
    try {
      const { messageIds } = await getApiForOrigin(origin).saved.ids();
      const prefix = savedKey(origin, '');
      const next = new Set([...get().ids].filter((key) => !key.startsWith(prefix)));
      for (const id of messageIds) next.add(savedKey(origin, id));
      set({ ids: next });
    } catch {
      // The menu offers saving either way, and saving twice counts once.
    }
  },

  loadList: async (origin) => {
    set((state) => ({ byOrigin: { ...state.byOrigin, [origin]: { ...(state.byOrigin[origin] ?? EMPTY), status: 'loading' } } }));
    try {
      const { items, nextBefore } = await getApiForOrigin(origin).saved.list();
      const entries = items.map((item) => ({ ...item, origin }));
      set((state) => ({ byOrigin: { ...state.byOrigin, [origin]: { items: entries, nextBefore, status: 'ready' } } }));
    } catch {
      set((state) => ({ byOrigin: { ...state.byOrigin, [origin]: { ...(state.byOrigin[origin] ?? EMPTY), status: 'failed' } } }));
    }
  },

  loadMore: async (origin) => {
    const current = get().byOrigin[origin];
    if (!current?.nextBefore) return;
    const { items, nextBefore } = await getApiForOrigin(origin).saved.list(current.nextBefore);
    const entries = items.map((item) => ({ ...item, origin }));
    set((state) => ({
      byOrigin: { ...state.byOrigin, [origin]: { items: [...(state.byOrigin[origin]?.items ?? []), ...entries], nextBefore, status: 'ready' } },
    }));
  },

  save: async (origin, kind, messageId, remindAt) => {
    const item = await getApiForOrigin(origin).saved.save(kind, messageId, remindAt);
    const entry: SavedEntry = { ...item, origin };
    set((state) => {
      const ids = new Set(state.ids);
      ids.add(savedKey(origin, messageId));
      const current = state.byOrigin[origin];
      if (!current) return { ids };
      return {
        ids,
        byOrigin: { ...state.byOrigin, [origin]: { ...current, items: [entry, ...current.items.filter((other) => other.id !== entry.id)] } },
      };
    });
  },

  remove: async (origin, kind, messageId) => {
    await getApiForOrigin(origin).saved.remove(kind, messageId);
    get().applyChanged(origin, messageId, false);
  },

  // What another device of the same person did.
  applyChanged: (origin, messageId, saved) => set((state) => {
    const ids = new Set(state.ids);
    const key = savedKey(origin, messageId);
    if (saved) ids.add(key);
    else ids.delete(key);
    const current = state.byOrigin[origin];
    if (saved || !current) return { ids };
    return {
      ids,
      byOrigin: { ...state.byOrigin, [origin]: { ...current, items: current.items.filter((item) => item.message.id !== messageId) } },
    };
  }),

  applyReminderDone: (origin, savedId) => set((state) => {
    const current = state.byOrigin[origin];
    if (!current) return {};
    return {
      byOrigin: {
        ...state.byOrigin,
        [origin]: { ...current, items: current.items.map((item) => (item.id === savedId ? { ...item, remindAt: null } : item)) },
      },
    };
  }),

  reset: () => set({ ids: new Set(), byOrigin: {} }),
}));
