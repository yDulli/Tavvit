import { create } from 'zustand';
import type { TranslationTarget } from '@backspace/shared/src/translation';
import { describeError } from '../i18n/errors';
import { translateOnDevice } from '../utils/deviceTranslation';
import { getApiForOrigin, getChannelOrigin } from './spaceStore';
import { translationTarget, useTranslationTargetStore } from './translationTargetStore';

/**
 * A message read in another language, for as long as this window is open (nothing is stored).
 * What the entry says is what the row shows; `content` is what it was made from, so an edit
 * makes it go away instead of leaving the translation of older words under the new ones.
 *
 * The browser's own translator comes first, as nothing leaves the device. Then the server of
 * the channel, if its operator set one up. Where neither can, the row offers a link to a page
 * that can (docs/systems/translation.md).
 */
export type TranslationEntry =
  | { status: 'working'; content: string; downloading: boolean }
  | { status: 'done'; content: string; text: string; source: string | null }
  | { status: 'same'; content: string; source: string | null; target: TranslationTarget }
  | { status: 'offer'; content: string; target: TranslationTarget; error: string | null };

/** Instance by instance, whether its server has a translator; asked once. */
const serverAnswers = new Map<string, Promise<boolean>>();

function serverTranslates(origin: string): Promise<boolean> {
  let answer = serverAnswers.get(origin);
  if (!answer) {
    answer = getApiForOrigin(origin).instance.info().then((info) => info.translation === true);
    serverAnswers.set(origin, answer);
    // A server that did not answer gets asked again the next time.
    answer.catch(() => serverAnswers.delete(origin));
  }
  return answer.catch(() => false);
}

interface TranslationState {
  entries: Readonly<Record<string, TranslationEntry>>;
  translate: (messageId: string, content: string, channelId: string) => Promise<void>;
  hide: (messageId: string) => void;
}

export const useTranslationStore = create<TranslationState>((set, get) => {
  const put = (messageId: string, entry: TranslationEntry) => set((state) => ({ entries: { ...state.entries, [messageId]: entry } }));
  /** Hidden or asked again meanwhile: this answer has nowhere to go. */
  const stillWanted = (messageId: string, content: string) => {
    const entry = get().entries[messageId];
    return entry?.status === 'working' && entry.content === content;
  };

  return {
    entries: {},

    translate: async (messageId, content, channelId) => {
      const target = translationTarget(useTranslationTargetStore.getState().chosenTarget);
      put(messageId, { status: 'working', content, downloading: false });

      const onDevice = await translateOnDevice(content, target, () => {
        if (stillWanted(messageId, content)) put(messageId, { status: 'working', content, downloading: true });
      });
      if (!stillWanted(messageId, content)) return;
      if (onDevice) {
        put(messageId, onDevice.same
          ? { status: 'same', content, source: onDevice.source, target }
          : { status: 'done', content, text: onDevice.text, source: onDevice.source });
        return;
      }

      const origin = getChannelOrigin(channelId);
      let error: string | null = null;
      if (await serverTranslates(origin)) {
        try {
          const answer = await getApiForOrigin(origin).messages.translate(messageId, target);
          if (!stillWanted(messageId, content)) return;
          put(messageId, answer.sameLanguage
            ? { status: 'same', content, source: answer.sourceLanguage, target }
            : { status: 'done', content, text: answer.text, source: answer.sourceLanguage });
          return;
        } catch (err) {
          error = describeError(err);
        }
      }
      if (stillWanted(messageId, content)) put(messageId, { status: 'offer', content, target, error });
    },

    hide: (messageId) => set((state) => {
      if (!state.entries[messageId]) return state;
      const entries = { ...state.entries };
      delete entries[messageId];
      return { entries };
    }),
  };
});

// What was translated into the language before no longer answers the question.
useTranslationTargetStore.subscribe((state, previous) => {
  if (state.chosenTarget !== previous.chosenTarget) useTranslationStore.setState({ entries: {} });
});

/** Test-only: forget which servers answered what. */
export function __resetServerAnswersForTests(): void {
  serverAnswers.clear();
}
