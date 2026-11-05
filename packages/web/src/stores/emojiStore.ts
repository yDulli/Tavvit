import { create } from 'zustand';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';
import type { AvailableSpaceExpressions, SpaceEmoji } from '@backspace/shared/src/spaceExpressions';
import { api } from '../api/client';
import { getApiForOrigin } from '../utils/crossStoreResolvers';

/**
 * Custom emoji and space stickers, per instance (docs/systems/emoji.md).
 *
 * An emoji's id means something only on the instance that holds it, so everything here is kept
 * per origin (`''` is the page's own instance). For each origin: its library, and the emoji and
 * stickers of every space the person is in there (`GET /api/emojis/available`), loaded when first
 * needed (`ensureOrigin`: a picker opens, a composer is shown) and again when the space list says a
 * space is missing. The home library also stays in the flat fields below, which the library's own
 * settings page edits.
 *
 * Sources: `load()` and `loadOrigin()`, `emoji_upserted` and `emoji_removed` from each instance's
 * socket (`upsertLibrary`, `dropLibrary`), `space_emojis_changed` and `space_stickers_changed`
 * (`reloadSpace`), and the answers to this person's own `create()`, `rename()` and `remove()`
 * calls. A change that arrives twice (the answer and the event) lands once.
 *
 * Imports no other store, so the message renderer and the composer can read it without import
 * cycles; the space list it is ordered by is read by its callers (utils/emojiSets.ts).
 */

export type EmojiLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** An emoji as a picker or a reader needs it, whichever kind it is. */
export interface KnownEmoji {
  id: string;
  name: string;
  animated: boolean;
  /** The space it belongs to, or null for the instance's library. */
  spaceId: string | null;
}

/** What one instance offers this person. */
export interface OriginExpressions {
  status: EmojiLoadStatus;
  library: readonly CustomEmoji[];
  /** Every space the person is in there, in the order of joining. */
  spaces: readonly AvailableSpaceExpressions[];
  /** Every emoji above, by id. */
  byId: ReadonlyMap<string, KnownEmoji>;
}

interface EmojiState {
  /** The home library by name, for its settings page. */
  emojis: readonly CustomEmoji[];
  byId: ReadonlyMap<string, CustomEmoji>;
  /** Name to id in the home library. */
  idsByName: ReadonlyMap<string, string>;
  status: EmojiLoadStatus;
  /** Per origin; absent until first needed. */
  origins: ReadonlyMap<string, OriginExpressions>;
  load: () => Promise<void>;
  upsert: (emoji: CustomEmoji) => void;
  drop: (emojiId: string) => void;
  create: (name: string, image: string) => Promise<CustomEmoji>;
  rename: (id: string, name: string) => Promise<CustomEmoji>;
  remove: (id: string) => Promise<void>;
  /** Loads `origin`'s offer unless it is loaded or on its way. */
  ensureOrigin: (origin: string) => void;
  /** Loads `origin`'s offer again. */
  loadOrigin: (origin: string) => Promise<void>;
  /** One space's emoji and stickers again, after `space_emojis_changed` or `space_stickers_changed`. */
  reloadSpace: (origin: string, spaceId: string) => Promise<void>;
  /** A library change from `origin`'s socket. */
  upsertLibrary: (origin: string, emoji: CustomEmoji) => void;
  dropLibrary: (origin: string, emojiId: string) => void;
  /** The instance is gone from this client. */
  forgetOrigin: (origin: string) => void;
  reset: () => void;
}

/** The latest `load`; an answer for an older one, or for a previous session, is dropped. */
let loadSeq = 0;
/** The same per origin, for `loadOrigin`. */
const originSeq = new Map<string, number>();
/** Bumped by `reset`, so an answer from before a sign-out lands nowhere. */
let session = 0;

function byName<T extends { name: string }>(a: T, b: T): number {
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

function known(emoji: CustomEmoji | SpaceEmoji, spaceId: string | null): KnownEmoji {
  return { id: emoji.id, name: emoji.name, animated: emoji.animated, spaceId };
}

/** One instance's offer as the store keeps it, with its index by id. */
export function originEntry(status: EmojiLoadStatus, library: readonly CustomEmoji[], spaces: readonly AvailableSpaceExpressions[]): OriginExpressions {
  const sortedLibrary = [...library].sort(byName);
  const byId = new Map<string, KnownEmoji>();
  for (const emoji of sortedLibrary) byId.set(emoji.id, known(emoji, null));
  for (const space of spaces) for (const emoji of space.emojis) byId.set(emoji.id, known(emoji, space.spaceId));
  return { status, library: sortedLibrary, spaces, byId };
}

const EMPTY_ORIGIN = originEntry('idle', [], []);

export const useEmojiStore = create<EmojiState>((set, get) => {
  const withOrigin = (origin: string, change: (entry: OriginExpressions) => OriginExpressions) => {
    const current = get().origins.get(origin);
    if (!current) return;
    const origins = new Map(get().origins);
    origins.set(origin, change(current));
    set({ origins });
  };

  return {
    ...derived([]),
    status: 'idle',
    origins: new Map(),

    load: async () => {
      const seq = ++loadSeq;
      set({ status: 'loading' });
      try {
        const { emojis } = await api.emojis.list();
        if (seq !== loadSeq) return;
        set({ ...derived(emojis), status: 'ready' });
        withOrigin('', (entry) => originEntry(entry.status, emojis, entry.spaces));
      } catch (err) {
        if (seq !== loadSeq) return;
        console.error('Failed to load the emoji library:', err);
        set({ status: 'failed' });
      }
    },

    upsert: (emoji) => {
      set(derived([...get().emojis.filter((existing) => existing.id !== emoji.id), emoji]));
      get().upsertLibrary('', emoji);
    },

    drop: (emojiId) => {
      set(derived(get().emojis.filter((emoji) => emoji.id !== emojiId)));
      get().dropLibrary('', emojiId);
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

    ensureOrigin: (origin) => {
      const status = get().origins.get(origin)?.status ?? 'idle';
      if (status === 'idle' || status === 'failed') void get().loadOrigin(origin);
    },

    loadOrigin: async (origin) => {
      const seq = (originSeq.get(origin) ?? 0) + 1;
      originSeq.set(origin, seq);
      const started = session;
      const before = get().origins.get(origin) ?? EMPTY_ORIGIN;
      const origins = new Map(get().origins);
      origins.set(origin, { ...before, status: 'loading' });
      set({ origins });
      try {
        const answer = await getApiForOrigin(origin).spaceExpressions.available();
        if (started !== session || originSeq.get(origin) !== seq) return;
        const next = new Map(get().origins);
        next.set(origin, originEntry('ready', answer.library, answer.spaces));
        set(origin === '' ? { origins: next, ...derived(answer.library), status: 'ready' } : { origins: next });
      } catch (err) {
        if (started !== session || originSeq.get(origin) !== seq) return;
        // An instance older than space emoji answers 404: it still has a library to offer.
        console.warn('[emoji] Could not load what an instance offers:', err instanceof Error ? err.message : err);
        withOrigin(origin, (entry) => ({ ...entry, status: 'failed' }));
      }
    },

    reloadSpace: async (origin, spaceId) => {
      const entry = get().origins.get(origin);
      if (!entry || entry.status !== 'ready') return;
      const started = session;
      try {
        const client = getApiForOrigin(origin).spaceExpressions;
        const [emojis, stickers] = await Promise.all([client.emojis(spaceId), client.stickers(spaceId)]);
        if (started !== session) return;
        withOrigin(origin, (current) => {
          const spaces = current.spaces.some((space) => space.spaceId === spaceId)
            ? current.spaces.map((space) => (space.spaceId === spaceId ? { spaceId, emojis: emojis.emojis, stickers: stickers.stickers } : space))
            : [...current.spaces, { spaceId, emojis: emojis.emojis, stickers: stickers.stickers }];
          return originEntry(current.status, current.library, spaces);
        });
      } catch (err) {
        // Gone from the space meanwhile, or the instance is away: the next full load sets it right.
        console.warn('[emoji] Could not reload a space\'s emoji:', err instanceof Error ? err.message : err);
      }
    },

    upsertLibrary: (origin, emoji) => {
      withOrigin(origin, (entry) => originEntry(entry.status, [...entry.library.filter((existing) => existing.id !== emoji.id), emoji], entry.spaces));
    },

    dropLibrary: (origin, emojiId) => {
      withOrigin(origin, (entry) => originEntry(entry.status, entry.library.filter((emoji) => emoji.id !== emojiId), entry.spaces));
    },

    forgetOrigin: (origin) => {
      if (!get().origins.has(origin)) return;
      originSeq.delete(origin);
      const origins = new Map(get().origins);
      origins.delete(origin);
      set({ origins });
    },

    reset: () => {
      loadSeq++;
      session++;
      originSeq.clear();
      set({ ...derived([]), status: 'idle', origins: new Map() });
    },
  };
});

/** The emoji with this id in the home library, or undefined (not in it, or not loaded yet). */
export function findCustomEmoji(id: string): CustomEmoji | undefined {
  return useEmojiStore.getState().byId.get(id);
}

/** What `origin` offers, once loaded. */
export function originExpressions(origin: string): OriginExpressions | undefined {
  return useEmojiStore.getState().origins.get(origin);
}
