import { useTranslation } from 'react-i18next';
import { StickerPicker } from './StickerPicker';
import React, { useMemo, useRef, useEffect, useState } from 'react';
import Picker from '@emoji-mart/react';
import { loadEmojiData } from '../../utils/emojiData';
import { customEmojiUrl, emojiReactionValue } from '@backspace/shared/src/customEmoji';
import { useEmojiStore } from '../../stores/emojiStore';

/** The picker's own category for the instance's custom emoji, and the prefix that tells their ids from the standard ones. */
const ORBIT_CATEGORY = 'orbit';
const ORBIT_ID_PREFIX = 'orbit-';
const ORBIT_ICON_SVG = '<svg style="display: block;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)"/></svg>';

/**
 * emoji-mart's init looks at its module-level data before awaiting this loader
 * and prepends its "frequent" category after it. Two pickers mounting together
 * (StrictMode's double effect, the remount when the library arrives) both get
 * past that check, and on one shared object each prepended one: "Frequently
 * used" twice. Each init gets a list of its own.
 */
const loadPickerData = () => loadEmojiData().then((data) => ({ ...data, categories: [...data.categories] }));

/**
 * The picker lives in a shadow root the stylesheet cannot reach, and its own
 * sheet draws a rounded search box, frosted headers and surfaces of its own.
 * These rules put the app's fields and surfaces in their place; custom
 * properties do cross the boundary, so they follow the theme.
 */
const PICKER_SHADOW_CSS = `
  #root { background-color: rgb(var(--bg-elevated)); }
  .sticky {
    background-color: rgb(var(--bg-elevated));
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    font-size: 12px;
    color: rgb(var(--text-secondary));
  }
  .search input[type="search"] {
    padding-top: 7px;
    padding-bottom: 7px;
    border-radius: calc(5px * var(--radius-scale, 1));
    background-color: rgb(var(--bg-input));
    box-shadow: inset 0 0 0 1px rgb(var(--border-soft));
    font-size: 13px;
  }
  .search input[type="search"]:hover { box-shadow: inset 0 0 0 1px rgb(var(--interactive-muted)); }
  .search input[type="search"]:focus {
    background-color: rgb(var(--bg-input));
    box-shadow: inset 0 0 0 1px rgb(var(--accent-primary)), 0 0 0 1px rgb(var(--accent-primary) / 0.4);
  }
  .menu {
    border-color: rgb(var(--border-soft));
    border-radius: calc(6px * var(--radius-scale, 1));
    background-color: rgb(var(--bg-elevated));
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .option { border-radius: calc(4px * var(--radius-scale, 1)); }
  #nav:before { height: 1px; background: rgb(var(--border-hard)); }
  #nav .bar { height: 2px; border-radius: 1px 1px 0 0; }
`;

interface EmojiPickerProps {
  /**
   * `native` is the standard emoji, the sticker token, or a custom emoji in
   * the form the caller asked for with `customAs`.
   */
  onEmojiSelect: (emoji: { native: string }) => void;
  /**
   * What a custom emoji comes back as: `:name:` to put in a message being
   * written (turned into its token when it is sent), or the `emoji:<id>`
   * value of a reaction.
   */
  customAs?: 'text' | 'reaction';
  /**
   * Mobile rendering: stretch the picker to fill its container width
   * (the parent bottom-sheet provides the viewport-wide bounds), use
   * larger touch targets, and let the picker's own scroll area expand
   * to consume the available height of the sheet.
   */
  mobile?: boolean;
  stickers?: boolean;
  /** Offers the instance's own emoji too. Off where only a standard emoji will do (a channel's icon). */
  custom?: boolean;
}

function HeartIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

export function EmojiPicker({ onEmojiSelect, customAs = 'text', mobile = false, stickers = true, custom: withCustom = true }: EmojiPickerProps) {
  const { t } = useTranslation('chat');
  const library = useEmojiStore((s) => s.emojis);
  const custom = useMemo(() => (!withCustom || library.length === 0 ? [] : [{
    id: ORBIT_CATEGORY,
    name: t('emoji.category'),
    emojis: library.map((emoji) => ({
      id: `${ORBIT_ID_PREFIX}${emoji.id}`,
      name: emoji.name,
      keywords: [emoji.name],
      skins: [{ src: customEmojiUrl(emoji.id) }],
    })),
  }]), [library, t, withCustom]);

  const handlePick = (picked: { native?: string; id?: string }) => {
    if (picked.id?.startsWith(ORBIT_ID_PREFIX)) {
      const id = picked.id.slice(ORBIT_ID_PREFIX.length);
      const emoji = useEmojiStore.getState().byId.get(id);
      // Removed while the picker was open: nothing to insert.
      if (!emoji) return;
      onEmojiSelect({ native: customAs === 'reaction' ? emojiReactionValue(id) : `:${emoji.name}:` });
      return;
    }
    onEmojiSelect({ native: picked.native ?? '' });
  };
  const [showStickers, setShowStickers] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Prevent keyboard events from bubbling out (e.g. Enter submitting the chat input)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    el.addEventListener('keydown', stop);
    return () => el.removeEventListener('keydown', stop);
  }, []);

  // The element and its shadow root exist by now: the picker's own effect, a
  // child's, has run. It gets a new element when it remounts.
  useEffect(() => {
    containerRef.current?.querySelectorAll('em-emoji-picker').forEach((picker) => {
      const root = picker.shadowRoot;
      if (!root || root.querySelector('[data-app-picker-css]')) return;
      const style = document.createElement('style');
      style.dataset.appPickerCss = '';
      style.textContent = PICKER_SHADOW_CSS;
      root.appendChild(style);
    });
  }, [showStickers, library.length]);

  // emoji-mart's Picker computes its own internal width from
  // `perLine * emojiButtonSize` UNLESS `dynamicWidth` is set, in which case
  // it stretches to its parent's width. On mobile we want full-viewport.
  // The mobile sheet wraps this picker in `flex-1 min-h-0 flex flex-col`,
  // so we make the wrapper fill that space and tell the picker to expand.
  //
  // The `<em-emoji-picker>` custom element has no intrinsic stretch behavior:
  // even with `dynamicWidth: true` it ships with `display: flex` but no
  // `width: 100%`, so it shrinks to its perLine*emojiButtonSize content width
  // unless we force it to fill. The `emoji-picker-wrapper--mobile` modifier
  // applies that override (see globals.css) — desktop keeps the legacy
  // intrinsic-width sizing.
  const wrapperClass = mobile
    ? 'emoji-picker-wrapper emoji-picker-wrapper--mobile flex-1 min-h-0 w-full overflow-hidden'
    : 'emoji-picker-wrapper flex flex-col';

  return (
    <div ref={containerRef} className={wrapperClass}>
      {stickers && (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-border-hard p-1.5">
          <button
            type="button"
            aria-pressed={!showStickers}
            onClick={() => setShowStickers(false)}
            className={`flex h-7 items-center rounded-md px-2.5 text-ui font-medium transition-colors ${
              !showStickers
                ? 'bg-interactive-selected text-txt-primary'
                : 'text-txt-tertiary hover:bg-interactive-hover hover:text-txt-primary active:bg-interactive-active'
            }`}
          >
            {t('composer.emoji')}
          </button>
          <button
            type="button"
            aria-pressed={showStickers}
            aria-label={t('stickers.title')}
            title={t('stickers.title')}
            onClick={() => setShowStickers(true)}
            className={`flex h-7 w-8 items-center justify-center rounded-md transition-colors ${
              showStickers
                ? 'bg-interactive-selected text-txt-primary'
                : 'text-txt-tertiary hover:bg-interactive-hover hover:text-txt-primary active:bg-interactive-active'
            }`}
          >
            <HeartIcon className="w-4 h-4" />
          </button>
        </div>
      )}
      {stickers && showStickers ? <StickerPicker mobile={mobile} onSelect={token => onEmojiSelect({ native: token })} /> : <Picker
        key={`library-${library.length}`}
        data={loadPickerData}
        custom={custom}
        categoryIcons={custom.length > 0 ? { [ORBIT_CATEGORY]: { svg: ORBIT_ICON_SVG } } : undefined}
        onEmojiSelect={handlePick}
        theme="dark"
        set="native"
        skinTonePosition="search"
        previewPosition="none"
        navPosition="bottom"
        perLine={mobile ? 8 : 10}
        maxFrequentRows={2}
        emojiSize={mobile ? 28 : 24}
        emojiButtonSize={mobile ? 40 : 32}
        emojiButtonRadius="calc(5px * var(--radius-scale, 1))"
        dynamicWidth={mobile ? true : false}
        categories={['frequent', ...(custom.length > 0 ? [ORBIT_CATEGORY] : []), 'people', 'nature', 'foods', 'activity', 'places', 'objects', 'symbols', 'flags']}
      />}
    </div>
  );
}
