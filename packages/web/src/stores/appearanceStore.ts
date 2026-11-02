import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { accentColorProblem } from '@backspace/shared/src/color.js';
import {
  DEFAULT_APPEARANCE,
  CARBON_SETTINGS,
  isThemeChoice,
  normalizeChatTextScale,
  normalizeSurface,
  type AppearanceSettings,
  type SurfaceSettings,
  type ThemeChoice,
} from '../utils/appTheme';
import { normalizeLook, type LookSettings } from '../utils/appearanceOptions';

/**
 * How this device looks: the surface theme, the person's own accent colour, the
 * shape of the interface, how messages are drawn, the typeface, the size of chat
 * text and whether animation is cut down. Kept in this browser like the
 * interface scale, and applied before anyone signs in (`AppearanceController`).
 */

interface AppearanceState extends AppearanceSettings {
  setTheme: (theme: ThemeChoice) => void;
  /** Change the custom theme; choosing to edit it also makes it the active theme. */
  setCustom: (custom: SurfaceSettings) => void;
  /** A usable `#rrggbb`, or null for the instance's colour. An unusable colour is refused (returns false). */
  setAccent: (accent: string | null) => boolean;
  setChatTextScale: (scale: number) => void;
  setReduceMotion: (reduce: boolean) => void;
  /** Change some of the look settings; each is brought into its own range or set of options. */
  setLook: (patch: Partial<LookSettings>) => void;
  reset: () => void;
}

/** A stored accent is trusted only if it would still be accepted today. */
function normalizeAccent(value: unknown): string | null {
  return typeof value === 'string' && accentColorProblem(value) === null ? value.toLowerCase() : null;
}

/** What is kept, read defensively: another version or a hand-edited store must not break the page. */
export function normalizeAppearance(stored: unknown): AppearanceSettings {
  const raw = (stored ?? {}) as Partial<Record<keyof AppearanceSettings, unknown>>;
  return {
    ...normalizeLook(raw),
    theme: isThemeChoice(raw.theme) ? raw.theme : DEFAULT_APPEARANCE.theme,
    custom: normalizeSurface(raw.custom ?? CARBON_SETTINGS),
    accent: normalizeAccent(raw.accent),
    chatTextScale: normalizeChatTextScale(raw.chatTextScale),
    reduceMotion: raw.reduceMotion === true,
  };
}

/** The look settings out of a state, nothing else. */
function lookOf(state: LookSettings): LookSettings {
  return {
    corners: state.corners,
    messageStyle: state.messageStyle,
    density: state.density,
    avatarShape: state.avatarShape,
    font: state.font,
    sidebarWidth: state.sidebarWidth,
    contrast: state.contrast,
    light: state.light,
    underlineLinks: state.underlineLinks,
    statusPalette: state.statusPalette,
    timeFormat: state.timeFormat,
  };
}

/** The settings of a state, without its actions: what is kept, and what `AppearanceController` applies. */
export function appearanceSettingsOf(state: AppearanceSettings): AppearanceSettings {
  return {
    ...lookOf(state),
    theme: state.theme,
    custom: state.custom,
    accent: state.accent,
    chatTextScale: state.chatTextScale,
    reduceMotion: state.reduceMotion,
  };
}

export const useAppearanceStore = create<AppearanceState>()(persist(
  (set, get) => ({
    ...DEFAULT_APPEARANCE,
    setTheme: (theme) => set({ theme: isThemeChoice(theme) ? theme : DEFAULT_APPEARANCE.theme }),
    setCustom: (custom) => set({ custom: normalizeSurface(custom), theme: 'custom' }),
    setAccent: (accent) => {
      if (accent === null) { set({ accent: null }); return true; }
      if (accentColorProblem(accent) !== null) return false;
      set({ accent: accent.toLowerCase() });
      return true;
    },
    setChatTextScale: (scale) => set({ chatTextScale: normalizeChatTextScale(scale) }),
    setReduceMotion: (reduce) => set({ reduceMotion: reduce === true }),
    setLook: (patch) => set(normalizeLook({ ...lookOf(get()), ...patch })),
    reset: () => set({ ...DEFAULT_APPEARANCE }),
  }),
  {
    name: 'orbit-appearance',
    partialize: (state) => appearanceSettingsOf(state),
    merge: (stored, current) => ({ ...current, ...normalizeAppearance(stored) }),
  },
));

/** The look settings, for code outside React (a formatter) that needs the current value. */
export function currentLook(): LookSettings {
  return lookOf(useAppearanceStore.getState());
}
