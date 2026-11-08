import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lookNameOf, lookOf, sameLook, type Look } from '../utils/looks';

/**
 * The looks a person kept on this device (the theme studio, docs/systems/design-system.md,
 * "Looks"), each with a name, to put on again with one click. Kept in this browser like the rest
 * of the appearance; a link carries one to another device or person.
 */

export interface SavedLook {
  id: string;
  name: string;
  look: Look;
  savedAt: number;
}

/** How many looks a device keeps. */
export const SAVED_LOOKS_MAX = 30;

interface LooksState {
  looks: SavedLook[];
  /** Keeps `look` under `name`, newest first; null when the name is empty or the shelf is full. */
  save: (name: string, look: Look) => SavedLook | null;
  rename: (id: string, name: string) => boolean;
  remove: (id: string) => void;
  /** Puts a look just removed back where it was (the toast's Undo). */
  restore: (saved: SavedLook, index: number) => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The kept looks, read defensively: another version or a hand-edited store must not break the page. */
export function normalizeSavedLooks(stored: unknown): SavedLook[] {
  const raw = (stored as { looks?: unknown } | null)?.looks;
  if (!Array.isArray(raw)) return [];
  const looks: SavedLook[] = [];
  for (const item of raw.slice(0, SAVED_LOOKS_MAX)) {
    const record = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const name = lookNameOf(record.name);
    const look = lookOf(record.look);
    if (typeof record.id !== 'string' || !name || !look) continue;
    looks.push({ id: record.id, name, look, savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0 });
  }
  return looks;
}

/** The kept look `look` is, when one is exactly it. */
export function savedLookOf(looks: readonly SavedLook[], look: Look): SavedLook | null {
  return looks.find((saved) => sameLook(saved.look, look)) ?? null;
}

export const useLooksStore = create<LooksState>()(persist(
  (set, get) => ({
    looks: [],
    save: (name, look) => {
      const clean = lookNameOf(name);
      if (!clean || get().looks.length >= SAVED_LOOKS_MAX) return null;
      const saved: SavedLook = { id: newId(), name: clean, look, savedAt: Date.now() };
      set((state) => ({ looks: [saved, ...state.looks] }));
      return saved;
    },
    rename: (id, name) => {
      const clean = lookNameOf(name);
      if (!clean) return false;
      set((state) => ({ looks: state.looks.map((saved) => (saved.id === id ? { ...saved, name: clean } : saved)) }));
      return true;
    },
    remove: (id) => set((state) => ({ looks: state.looks.filter((saved) => saved.id !== id) })),
    restore: (saved, index) => set((state) => {
      if (state.looks.length >= SAVED_LOOKS_MAX || state.looks.some((look) => look.id === saved.id)) return state;
      const looks = [...state.looks];
      looks.splice(Math.min(Math.max(index, 0), looks.length), 0, saved);
      return { looks };
    }),
  }),
  {
    name: 'tavvit-looks',
    partialize: (state) => ({ looks: state.looks }),
    merge: (stored, current) => ({ ...current, looks: normalizeSavedLooks(stored) }),
  },
));
