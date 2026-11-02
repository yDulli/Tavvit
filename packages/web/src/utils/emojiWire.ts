import { splitCustomEmoji, tokenizeCustomEmojiShortcodes } from '@backspace/shared/src/customEmoji';
import { useEmojiStore } from '../stores/emojiStore';
import { getChannelOrigin } from '../stores/spaceStore';

/**
 * Text as it goes over the wire. What a person types and sees is `:name:`; what
 * is sent names the emoji by id (`<:name:id>`), so a rename never breaks an
 * old message. A channel another instance hosts has no use for this
 * instance's ids, so text sent there stays exactly as typed.
 */
export function toWireText(text: string, channelId: string): string {
  if (getChannelOrigin(channelId) !== '') return text;
  return tokenizeCustomEmojiShortcodes(text, useEmojiStore.getState().idsByName);
}

/**
 * The way back, for a message being edited: `<:name:id>` reads `:name:` again. Only
 * where that name still leads to that emoji, because the name is what `toWireText`
 * goes by when the edit is saved; any other token stays as it is, so saving cannot
 * lose or swap a picture.
 */
export function fromWireText(text: string, channelId: string): string {
  if (getChannelOrigin(channelId) !== '') return text;
  const { idsByName } = useEmojiStore.getState();
  return splitCustomEmoji(text)
    .map((part) => {
      if (part.kind === 'text') return part.text;
      return idsByName.get(part.name) === part.id ? `:${part.name}:` : part.token;
    })
    .join('');
}
