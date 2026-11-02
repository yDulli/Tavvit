import { create } from 'zustand';

/**
 * Asks for a second factor from the middle of something else: signing in to another instance
 * happens in several places, and each would otherwise need its own code step. `ask` opens the
 * one dialog (`MfaPromptDialog`) and resolves with what was typed.
 */
interface MfaPromptState {
  /** The instance asking, while the dialog is open. */
  origin: string | null;
  /** Why the last code was not taken, for the dialog to show. */
  problem: string | null;
  resolve: ((code: string) => void) | null;
  reject: ((reason: Error) => void) | null;
  ask: (origin: string, problem?: string | null) => Promise<string>;
  answer: (code: string) => void;
  cancel: () => void;
}

export const useMfaPromptStore = create<MfaPromptState>()((set, get) => ({
  origin: null,
  problem: null,
  resolve: null,
  reject: null,
  ask: (origin, problem = null) => new Promise<string>((resolve, reject) => {
    get().reject?.(new Error('Replaced by another request'));
    set({ origin, problem, resolve, reject });
  }),
  answer: (code) => {
    const { resolve } = get();
    set({ origin: null, problem: null, resolve: null, reject: null });
    resolve?.(code);
  },
  cancel: () => {
    const { reject } = get();
    set({ origin: null, problem: null, resolve: null, reject: null });
    reject?.(new Error('Cancelled'));
  },
}));
