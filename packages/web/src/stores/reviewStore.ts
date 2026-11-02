import { create } from 'zustand';
import type { ReviewQueueCountPayload } from '@backspace/shared/src/platform';

/**
 * The platform's reviews as this client hears of them (docs/systems/admin.md,
 * "Platform administration"): the open-request counts the home instance's
 * admins see on the admin area, and a revision per space that moves when one
 * of its reviews moved, so a panel showing that space's review reloads it.
 */
interface ReviewState {
  /** Open verification and Discovery requests on the home instance; null for anyone but its admins. */
  queue: ReviewQueueCountPayload | null;
  /** Reports waiting for a decision on the home instance; null for anyone but its admins. */
  reportsOpen: number | null;
  /** Space id → review updates heard; a panel reloads when its space's number moves. */
  revisions: Readonly<Record<string, number>>;
  setQueue: (queue: ReviewQueueCountPayload | null) => void;
  setReportsOpen: (open: number | null) => void;
  noteUpdate: (spaceId: string) => void;
  reset: () => void;
}

export const useReviewStore = create<ReviewState>()((set) => ({
  queue: null,
  reportsOpen: null,
  revisions: {},
  setQueue: (queue) => set({ queue }),
  setReportsOpen: (reportsOpen) => set({ reportsOpen }),
  noteUpdate: (spaceId) => set((state) => ({
    revisions: { ...state.revisions, [spaceId]: (state.revisions[spaceId] ?? 0) + 1 },
  })),
  reset: () => set({ queue: null, reportsOpen: null, revisions: {} }),
}));

/** Open requests in all, for the admin area's count badge. */
export function openReviewTotal(queue: ReviewQueueCountPayload | null): number {
  return queue ? queue.verificationOpen + queue.discoveryOpen : 0;
}
