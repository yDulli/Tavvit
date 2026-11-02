import { create } from 'zustand';

interface QuickSwitcherState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/** Whether the quick switcher (Ctrl/Cmd+K) is showing. Deliberately not persisted. */
export const useQuickSwitcherStore = create<QuickSwitcherState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
