import { createContext, useContext, useState } from 'react';
import { emojiPictureUrl } from '@backspace/shared/src/customEmoji';
import { useEmojiStore } from '../../stores/emojiStore';
import { GatedPicture } from './ExternalMedia';

/** How large emoji are drawn where they stand: in running text, or on a line of their own. */
export type EmojiSize = 'inline' | 'jumbo';

export const EmojiSizeContext = createContext<EmojiSize>('inline');

/**
 * The instance whose emoji the surrounding text names (`''`: this page's own): a channel's host, or
 * for a direct message the writer's home (utils/emojiSets.ts `emojiOriginOfPerson`).
 */
export const EmojiOriginContext = createContext<string>('');

/** Edge of the picture, in em for text and pixels for jumbo. */
const INLINE_CLASS = 'h-[1.375em] min-w-[1.375em]';
const JUMBO_CLASS = 'h-12 min-w-12';

/**
 * Pictures that answered with an error this session (removed, or never there), per origin and id:
 * drawn as text from then on, without asking again. A 404 is not cached by browsers.
 */
const missing = new Set<string>();

interface CustomEmojiImageProps {
  id: string;
  /** The instance the emoji belongs to; by default the surrounding text's (EmojiOriginContext). */
  origin?: string;
  /** The name written in the text, shown when the picture cannot be. */
  fallbackName?: string;
  /** Overrides the size the surrounding message asks for. */
  size?: EmojiSize;
  className?: string;
}

/**
 * One custom emoji, as a picture that sits in a line of text. Drawn from its id on the instance it
 * belongs to, whether or not this client knows it (a space's emoji in a space the reader is not in
 * is still a picture there); the name is the current one where this client knows it, else the one
 * in the text. A picture from an instance this client is not connected to waits for the reader's
 * yes like any other (docs/systems/legal.md), and one that is gone shows as `:name:`.
 */
export function CustomEmojiImage({ id, origin: given, fallbackName, size, className = '' }: CustomEmojiImageProps) {
  const ambientOrigin = useContext(EmojiOriginContext);
  const origin = given ?? ambientOrigin;
  const knownName = useEmojiStore((s) => s.origins.get(origin)?.byId.get(id)?.name ?? (origin === '' ? s.byId.get(id)?.name : undefined));
  const ambient = useContext(EmojiSizeContext);
  const key = `${origin}|${id}`;
  const [failed, setFailed] = useState(() => missing.has(key));
  // The name as it was written between colons, which is what a reader of the raw text would see.
  const written = `:${knownName ?? fallbackName ?? 'emoji'}:`;
  const asText = <span className="text-txt-tertiary" data-testid="emoji-fallback">{written}</span>;
  if (failed || missing.has(key)) return asText;
  return (
    <GatedPicture
      src={emojiPictureUrl(id, origin)}
      whileBlocked={asText}
      alt={written}
      title={written}
      draggable={false}
      loading="lazy"
      onError={() => {
        missing.add(key);
        setFailed(true);
      }}
      className={`inline-block w-auto align-[-0.3em] object-contain ${(size ?? ambient) === 'jumbo' ? JUMBO_CLASS : INLINE_CLASS} ${className}`}
    />
  );
}
