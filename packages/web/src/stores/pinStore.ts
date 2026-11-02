import { create } from 'zustand';

interface PinRevisionState {
  revision: number;
  bump: () => void;
}

/**
 * Moves on when any channel's pins may have changed: a pin, an unpin, or a message going
 * with its pin. An open list (`PinsPopover`) asks the server again; nothing else reads it.
 */
export const usePinRevision = create<PinRevisionState>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));
