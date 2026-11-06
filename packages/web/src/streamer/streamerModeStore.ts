import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Streamer mode (docs/systems/streamer-mode.md): while it is on, the app hides
 * what is personal from anyone watching the screen, an email address, invite
 * links and codes, connected instances, two-factor secrets, session addresses,
 * tokens, moderator notes, and what notifications say. It is this device's
 * choice, kept in this browser, and nothing about it is sent anywhere.
 *
 * It goes on and off by hand (the settings, a shortcut) and, in the desktop
 * app, by itself: when OBS, Streamlabs or XSplit starts, if `automatic` allows
 * it (`reportStreamingPrograms`). One the programs turned on goes off when they
 * stop; one turned off by hand while they run stays off until they start again.
 */

interface StreamerModeState {
  on: boolean;
  /** Turn on by itself when a streaming program starts (desktop app). */
  automatic: boolean;
  /** It is on because a streaming program started, so it goes off when that stops. */
  bySoftware: boolean;
  /**
   * What the desktop app last said: a streaming program runs. Null before it
   * has said, while nothing is watched, and outside the desktop app. Not kept.
   */
  programsRunning: boolean | null;
  setOn: (on: boolean) => void;
  toggle: () => void;
  setAutomatic: (automatic: boolean) => void;
  reportStreamingPrograms: (running: boolean) => void;
  /** The desktop app no longer watches: what it said last is no longer known. */
  forgetStreamingPrograms: () => void;
}

export const useStreamerModeStore = create<StreamerModeState>()(
  persist(
    (set) => ({
      on: false,
      automatic: true,
      bySoftware: false,
      programsRunning: null,

      setOn: (on) => set({ on, bySoftware: false }),

      toggle: () => set((state) => ({ on: !state.on, bySoftware: false })),

      setAutomatic: (automatic) =>
        set((state) => {
          // Allowing it while a program already runs turns it on now, as a start would.
          if (automatic && state.programsRunning === true && !state.on) return { automatic, on: true, bySoftware: true };
          // Not allowing it any more leaves the mode as it is, now as if set by hand:
          // taking it off in the middle of a stream is for the person to do.
          return { automatic, bySoftware: automatic ? state.bySoftware : false };
        }),

      reportStreamingPrograms: (running) =>
        set((state) => {
          const started = running && state.programsRunning !== true;
          if (started && state.automatic && !state.on) return { programsRunning: running, on: true, bySoftware: true };
          if (!running && state.bySoftware) return { programsRunning: running, on: false, bySoftware: false };
          return { programsRunning: running };
        }),

      forgetStreamingPrograms: () => set({ programsRunning: null }),
    }),
    {
      name: 'tavvit-streamer-mode',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ on: state.on, automatic: state.automatic, bySoftware: state.bySoftware }),
      merge: (persisted, current) => {
        const kept = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<StreamerModeState>;
        return {
          ...current,
          on: kept.on === true,
          automatic: kept.automatic !== false,
          bySoftware: kept.on === true && kept.bySoftware === true,
        };
      },
    },
  ),
);

/** Whether streamer mode is on. */
export function useStreamerMode(): boolean {
  return useStreamerModeStore((state) => state.on);
}

/** What stands for a hidden value: as long as a short one, never its length. */
export const STREAMER_MASK = '••••••••';
