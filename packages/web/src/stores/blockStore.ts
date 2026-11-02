import { create } from 'zustand';
import type { BlockedUser, User } from '@backspace/shared';
import { api } from '../api/client';

/**
 * The people the signed-in user has blocked on the home instance.
 *
 * A block lives on the instance that made it and is about that instance's
 * user rows, so this store speaks to the home client only and its ids are home
 * ids. A person met on another instance carries a different id there; the
 * profile actions therefore offer "Block" only for home rows.
 *
 * Sources: `load()` when the home socket's `ready` arrives, `applyIds()` for
 * `blocks_updated` (the server pushes the whole id set after every change),
 * and the answers to this user's own `block()` / `unblock()` calls.
 *
 * The store imports no other store, so `utils/alerts.ts` and the message list
 * can read it without import cycles.
 */

export type BlockLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface BlockState {
  /** Most recently blocked first. */
  blocks: readonly BlockedUser[];
  /** The ids in `blocks`, for the O(1) question the message list asks per message. */
  blockedIds: ReadonlySet<string>;
  status: BlockLoadStatus;
  /** Read the list from the server. Failure is recorded in `status`, not thrown. */
  load: () => Promise<void>;
  /** The server's full id set after a change: drop what is gone, fetch what is new. */
  applyIds: (ids: readonly string[]) => void;
  /** Block `user` (a home row). Rejects with the API error. */
  block: (user: Pick<User, 'id'>) => Promise<void>;
  /** Lift the block on `userId`. Rejects with the API error. */
  unblock: (userId: string) => Promise<void>;
  reset: () => void;
}

/** The latest `load`; an answer for an older one, or for a previous session, is dropped. */
let loadSeq = 0;

function byNewest(a: BlockedUser, b: BlockedUser): number {
  return b.blockedAt - a.blockedAt;
}

function withEntry(blocks: readonly BlockedUser[], entry: BlockedUser): BlockedUser[] {
  return [entry, ...blocks.filter((existing) => existing.user.id !== entry.user.id)].sort(byNewest);
}

function idsOf(blocks: readonly BlockedUser[]): ReadonlySet<string> {
  return new Set(blocks.map((entry) => entry.user.id));
}

export const useBlockStore = create<BlockState>((set, get) => ({
  blocks: [],
  blockedIds: new Set<string>(),
  status: 'idle',

  load: async () => {
    const seq = ++loadSeq;
    set({ status: 'loading' });
    try {
      const { blocks } = await api.users.listBlocks();
      if (seq !== loadSeq) return;
      const sorted = [...blocks].sort(byNewest);
      set({ blocks: sorted, blockedIds: idsOf(sorted), status: 'ready' });
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error('Failed to load the block list:', err);
      set({ status: 'failed' });
    }
  },

  applyIds: (ids) => {
    const wanted = new Set(ids);
    const kept = get().blocks.filter((entry) => wanted.has(entry.user.id));
    const known = new Set(kept.map((entry) => entry.user.id));
    set({ blocks: kept, blockedIds: wanted });
    // The event carries ids only. A person this client has no row for yet
    // (blocked from another tab or device) needs the list.
    if ([...wanted].some((id) => !known.has(id))) void get().load();
  },

  block: async (user) => {
    const entry = await api.users.block(user.id);
    const blocks = withEntry(get().blocks, entry);
    set({ blocks, blockedIds: idsOf(blocks) });
  },

  unblock: async (userId) => {
    await api.users.unblock(userId);
    const blocks = get().blocks.filter((entry) => entry.user.id !== userId);
    set({ blocks, blockedIds: idsOf(blocks) });
  },

  reset: () => {
    loadSeq++;
    set({ blocks: [], blockedIds: new Set<string>(), status: 'idle' });
  },
}));

/** Whether `userId` (a home row id) is blocked by the signed-in user. */
export function isBlockedUser(userId: string | null | undefined): boolean {
  return userId != null && useBlockStore.getState().blockedIds.has(userId);
}
