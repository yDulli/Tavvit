import { create } from 'zustand';
import type { Announcement } from '@backspace/shared/src/adminConsole';
import { api } from '../api/client';

const DISMISSED_KEY = 'tavvit-announcements-dismissed';

function readDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

interface AnnouncementState {
  /** What runs on the home instance now. */
  announcements: Announcement[];
  /** What this device put away. */
  dismissed: string[];
  load: () => Promise<void>;
  dismiss: (id: string) => void;
}

export const useAnnouncementStore = create<AnnouncementState>()((set, get) => ({
  announcements: [],
  dismissed: readDismissed(),
  load: async () => {
    try {
      const { announcements } = await api.instance.announcements();
      set({ announcements });
    } catch {
      // A banner is not worth an error: it stays as it was until the next load.
    }
  },
  dismiss: (id) => {
    const running = new Set(get().announcements.map((entry) => entry.id));
    // Only what still runs is worth remembering, so the list cannot grow for ever.
    const dismissed = [...get().dismissed.filter((entry) => running.has(entry)), id];
    set({ dismissed });
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
    } catch {
      // Then it comes back on the next load; nothing depends on it.
    }
  },
}));
