import { create } from 'zustand';
import type { SpaceWelcome } from '@backspace/shared/src/welcome';
import { getApiForOrigin } from './spaceStore';

export const welcomeKey = (origin: string, spaceId: string): string => `${origin}|${spaceId}`;

interface WelcomeState {
  bySpace: ReadonlyMap<string, SpaceWelcome>;
  /** The space whose welcome is on screen, if any. */
  dialog: { origin: string; spaceId: string } | null;
  load: (origin: string, spaceId: string) => Promise<SpaceWelcome>;
  store: (origin: string, spaceId: string, welcome: SpaceWelcome) => void;
  openDialog: (origin: string, spaceId: string) => void;
  closeDialog: () => void;
}

export const useWelcomeStore = create<WelcomeState>((set, get) => ({
  bySpace: new Map(),
  dialog: null,

  load: async (origin, spaceId) => {
    const welcome = await getApiForOrigin(origin).welcome.get(spaceId);
    get().store(origin, spaceId, welcome);
    return welcome;
  },

  store: (origin, spaceId, welcome) => {
    const next = new Map(get().bySpace);
    next.set(welcomeKey(origin, spaceId), welcome);
    set({ bySpace: next });
  },

  openDialog: (origin, spaceId) => set({ dialog: { origin, spaceId } }),
  closeDialog: () => set({ dialog: null }),
}));
