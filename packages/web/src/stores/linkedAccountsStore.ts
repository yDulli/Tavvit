import { create } from 'zustand';
import type { LinkedAccountProvider, LinkedAccountsResponse, LinkedAccountView } from '@backspace/shared';
import { api } from '../api/client';

/**
 * One's own linked accounts (docs/systems/linked-accounts.md), as the settings show them. Read
 * from the home instance when the panel opens, then replaced by every answer of the server and by
 * `linked_accounts_update`, which also brings a change made on another device: a link completed in
 * the browser while the desktop app's settings are open.
 */
interface LinkedAccountsState {
  /** Null until the list was read once. */
  accounts: LinkedAccountView[] | null;
  /** The services the home instance can link now. */
  available: LinkedAccountProvider[];
  /** Take an answer of the server. */
  apply: (response: LinkedAccountsResponse) => void;
  /** Take the list `linked_accounts_update` brought. */
  setAccounts: (accounts: LinkedAccountView[]) => void;
  /** Read both from the home instance. */
  load: () => Promise<void>;
  reset: () => void;
}

export const useLinkedAccountsStore = create<LinkedAccountsState>((set) => ({
  accounts: null,
  available: [],

  apply: (response) => set({ accounts: response.accounts, available: response.available }),

  setAccounts: (accounts) => set({ accounts }),

  load: async () => {
    const response = await api.users.linkedAccounts();
    set({ accounts: response.accounts, available: response.available });
  },

  reset: () => set({ accounts: null, available: [] }),
}));
