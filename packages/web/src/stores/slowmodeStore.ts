import { create } from 'zustand';

/**
 * When the signed-in user may next post in a channel that has slow mode
 * (`Channel.slowmodeSeconds`), so the composer can count down instead of
 * letting a message be refused.
 *
 * A wait starts after a send the channel's instance accepted, and when the
 * instance refuses one with `slowmode_active` (its `retryAfterSeconds` is the
 * exact rest of the wait). Times are this client's clock: the instance only
 * ever states a wait as seconds from now. The instance enforces the rule
 * itself, so a wait this store does not know about (a message sent from
 * another device) still ends in a refusal, which then starts it here.
 *
 * Entries are keyed by origin as well as by channel id, since ids are issued
 * per instance. spaceStore clears them with the channels they belong to: on
 * sign-out (`reset`) and when an instance is removed (`forgetOrigin`).
 */

/** Map key of one channel's wait: the instance, then the channel id. */
export function slowmodeKey(origin: string, channelId: string): string {
  return `${origin}\u0000${channelId}`;
}

interface SlowmodeState {
  /** Keyed by `slowmodeKey`: when the next message may be sent (epoch ms). */
  readyAt: ReadonlyMap<string, number>;
  /** Start a wait of `ms` from now in a channel. */
  startWait: (origin: string, channelId: string, ms: number) => void;
  /** Drop every wait on an instance that is gone. */
  forgetOrigin: (origin: string) => void;
  reset: () => void;
}

export const useSlowmodeStore = create<SlowmodeState>((set, get) => ({
  readyAt: new Map(),

  startWait: (origin, channelId, ms) => {
    if (!(ms > 0)) return;
    const now = Date.now();
    const readyAt = new Map<string, number>();
    // Waits that have run out are dropped on the way, so the map only ever
    // holds the channels that are still counting down.
    for (const [key, at] of get().readyAt) {
      if (at > now) readyAt.set(key, at);
    }
    readyAt.set(slowmodeKey(origin, channelId), now + ms);
    set({ readyAt });
  },

  forgetOrigin: (origin) => {
    const prefix = `${origin}\u0000`;
    const current = get().readyAt;
    if (![...current.keys()].some((key) => key.startsWith(prefix))) return;
    const readyAt = new Map<string, number>();
    for (const [key, at] of current) {
      if (!key.startsWith(prefix)) readyAt.set(key, at);
    }
    set({ readyAt });
  },

  reset: () => set({ readyAt: new Map() }),
}));
