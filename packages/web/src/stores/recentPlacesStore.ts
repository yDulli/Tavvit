import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Where the user was last: the conversations they opened, newest first, so
 * the Home page can offer to pick up where they left off.
 *
 * Kept in this browser only (localStorage), per signed-in user id, and
 * nowhere else: it is a convenience, not a record anyone else needs. An entry
 * whose conversation the user can no longer see is simply not shown (the Home
 * page checks every entry against what the client knows), and is overwritten
 * as new visits push it out.
 */

export interface RecentPlace {
  /** The channel or DM id. */
  channelId: string;
  /** The space it is in; null for a DM. */
  spaceId: string | null;
  /** When it was last opened (ms). */
  at: number;
}

/** How many places are remembered per user. */
export const RECENT_PLACES_LIMIT = 20;

interface RecentPlacesState {
  byUser: Record<string, RecentPlace[]>;
  visit: (userId: string, place: Omit<RecentPlace, 'at'>, at?: number) => void;
  forget: (userId: string, channelId: string) => void;
}

export const useRecentPlacesStore = create<RecentPlacesState>()(
  persist(
    (set) => ({
      byUser: {},
      visit: (userId, place, at = Date.now()) => set((s) => {
        const current = s.byUser[userId] ?? [];
        // Re-opening the conversation that is already first changes nothing worth a write.
        if (current[0]?.channelId === place.channelId && at - current[0].at < 60_000) return s;
        const next = [{ ...place, at }, ...current.filter((p) => p.channelId !== place.channelId)].slice(0, RECENT_PLACES_LIMIT);
        return { byUser: { ...s.byUser, [userId]: next } };
      }),
      forget: (userId, channelId) => set((s) => {
        const current = s.byUser[userId];
        if (!current?.some((p) => p.channelId === channelId)) return s;
        return { byUser: { ...s.byUser, [userId]: current.filter((p) => p.channelId !== channelId) } };
      }),
    }),
    {
      name: 'orbit-recent-places',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
);

const NONE: RecentPlace[] = [];

export function selectRecentPlaces(state: Pick<RecentPlacesState, 'byUser'>, userId: string | null | undefined): RecentPlace[] {
  return userId ? state.byUser[userId] ?? NONE : NONE;
}
