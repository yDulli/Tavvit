import { create } from 'zustand';
import type { LegalInfoResponse, UserNotice } from '@backspace/shared/src/legal';
import { api } from '../api/client';

/**
 * The home instance's legal basics as this client knows them
 * (docs/systems/legal.md): who runs it, which versions of its documents apply,
 * and what its operator decided about this person.
 */
interface LegalState {
  info: LegalInfoResponse | null;
  notices: UserNotice[];
  load: () => Promise<void>;
  loadNotices: () => Promise<void>;
  addNotice: (notice: UserNotice) => void;
  markRead: (id: string) => Promise<void>;
  clearNotices: () => void;
}

export const useLegalStore = create<LegalState>()((set) => ({
  info: null,
  notices: [],
  load: async () => {
    try {
      set({ info: await api.legal.info() });
    } catch (err) {
      // Nothing to show until the next try; the pages say so themselves.
      console.warn('Could not load the legal details', err);
    }
  },
  loadNotices: async () => {
    try {
      const { notices } = await api.legal.notices();
      set({ notices });
    } catch (err) {
      console.warn('Could not load notices', err);
    }
  },
  addNotice: (notice) => set((state) => ({ notices: [notice, ...state.notices.filter((known) => known.id !== notice.id)] })),
  markRead: async (id) => {
    const readAt = Date.now();
    set((state) => ({ notices: state.notices.map((notice) => (notice.id === id ? { ...notice, readAt } : notice)) }));
    try {
      await api.legal.readNotice(id);
    } catch (err) {
      console.warn('Could not mark the notice as read', err);
    }
  },
  clearNotices: () => set({ notices: [] }),
}));
