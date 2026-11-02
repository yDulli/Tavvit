import { create } from 'zustand';

/**
 * The origins of the instances this client is signed into, which stores/instanceStore.ts keeps
 * current. A store of its own so that what only needs to know them, every avatar for one, does
 * not load the instance store and the socket code behind it.
 */
interface ConnectedOriginsState {
  origins: readonly string[];
  setOrigins: (origins: readonly string[]) => void;
}

export const useConnectedOriginsStore = create<ConnectedOriginsState>()((set) => ({
  origins: [],
  setOrigins: (origins) => set({ origins }),
}));
