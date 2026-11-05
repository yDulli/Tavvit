import { splitCustomEmoji, tokenizeCustomEmojiShortcodes } from '@backspace/shared/src/customEmoji';
import { emojiContextOfChannel, shortcodeIndexFor } from './emojiSets';

/**
 * Text as it goes over the wire. What a person types and sees is `:name:` (or `:name~2:` where two
 * sets on offer share a name, utils/emojiSets.ts); what is sent names the emoji by id
 * (`<:name:id>`), so a rename never breaks an old message. The shortcodes are those on offer where
 * the text is written: in a space's channel, the emoji of its host; in a direct message, those of
 * this page's instance, the writer's home. A shortcode nothing on offer carries stays as typed.
 */
export function toWireText(text: string, channelId: string): string {
  return tokenizeCustomEmojiShortcodes(text, shortcodeIndexFor(emojiContextOfChannel(channelId)).idsByShortcode);
}

/**
 * The way back, for a message being edited: `<:name:id>` reads as the shortcode that names that
 * emoji where the message is, so saving turns it into the same id again. A token whose emoji is
 * not on offer there stays as it is, so saving cannot lose or swap a picture.
 */
export function fromWireText(text: string, channelId: string): string {
  const { shortcodeById } = shortcodeIndexFor(emojiContextOfChannel(channelId));
  return splitCustomEmoji(text)
    .map((part) => {
      if (part.kind === 'text') return part.text;
      const shortcode = shortcodeById.get(part.id);
      return shortcode === undefined ? part.token : `:${shortcode}:`;
    })
    .join('');
}
