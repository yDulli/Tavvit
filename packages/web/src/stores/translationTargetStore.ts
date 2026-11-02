import { create } from 'zustand';
import { isTranslationTarget, type TranslationTarget } from '@backspace/shared/src/translation';
import { getLanguage } from '../i18n';

/**
 * The language messages are translated into. On its own, as the settings need it before and
 * without anything of a conversation (`translationStore` holds those). Kept on this device.
 */
const TARGET_KEY = 'backspace-translate-target';

function storedTarget(): TranslationTarget | null {
  try {
    const value = window.localStorage.getItem(TARGET_KEY);
    return isTranslationTarget(value) ? value : null;
  } catch {
    return null;
  }
}

interface TranslationTargetState {
  /** The language chosen under Settings, or null for the app's own. */
  chosenTarget: TranslationTarget | null;
  setChosenTarget: (target: TranslationTarget | null) => void;
}

export const useTranslationTargetStore = create<TranslationTargetState>((set) => ({
  chosenTarget: storedTarget(),
  setChosenTarget: (target) => {
    try {
      if (target) window.localStorage.setItem(TARGET_KEY, target);
      else window.localStorage.removeItem(TARGET_KEY);
    } catch {
      // It holds for this window, then.
    }
    set({ chosenTarget: target });
  },
}));

/** The language a message is translated into. The app's languages are all among the targets. */
export function translationTarget(chosen: TranslationTarget | null): TranslationTarget {
  if (chosen) return chosen;
  const language = getLanguage();
  return isTranslationTarget(language) ? language : 'en';
}
