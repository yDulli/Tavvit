import { createContext, useContext } from 'react';
import { customEmojiUrl } from '@backspace/shared/src/customEmoji';
import { useEmojiStore } from '../../stores/emojiStore';

/** How large emoji are drawn where they stand: in running text, or on a line of their own. */
export type EmojiSize = 'inline' | 'jumbo';

export const EmojiSizeContext = createContext<EmojiSize>('inline');

/** Edge of the picture, in em for text and pixels for jumbo. */
const INLINE_CLASS = 'h-[1.375em] min-w-[1.375em]';
const JUMBO_CLASS = 'h-12 min-w-12';

interface CustomEmojiImageProps {
  id: string;
  /** The name written in the text, shown when the emoji is not in the library. */
  fallbackName?: string;
  /** Overrides the size the surrounding message asks for. */
  size?: EmojiSize;
  className?: string;
}

/**
 * One custom emoji, as a picture that sits in a line of text. The library
 * gives its current name, so a renamed emoji reads right in old messages; an
 * emoji that is gone (removed, or from an instance this one does not know)
 * shows as `:name:`.
 */
export function CustomEmojiImage({ id, fallbackName, size, className = '' }: CustomEmojiImageProps) {
  const emoji = useEmojiStore((s) => s.byId.get(id));
  const ambient = useContext(EmojiSizeContext);
  const name = emoji?.name ?? fallbackName;
  if (!emoji) {
    // The name as it was written between colons, which is what a reader of the raw text would see.
    const written = `:${name ?? 'emoji'}:`;
    return <span className="text-txt-tertiary" data-testid="emoji-fallback">{written}</span>;
  }
  return (
    <img
      src={customEmojiUrl(emoji.id)}
      alt={`:${emoji.name}:`}
      title={`:${emoji.name}:`}
      draggable={false}
      loading="lazy"
      className={`inline-block w-auto align-[-0.3em] object-contain ${(size ?? ambient) === 'jumbo' ? JUMBO_CLASS : INLINE_CLASS} ${className}`}
    />
  );
}
