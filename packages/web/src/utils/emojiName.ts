import { CUSTOM_EMOJI_NAME_MAX, normalizeEmojiName } from '@backspace/shared/src/customEmoji';

/**
 * A name for an emoji from the file's own name: lower case, letters, digits and underscores, or
 * empty when nothing usable is left. The instance's library and a space's emoji suggest names alike.
 */
export function suggestEmojiName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return normalizeEmojiName(base.slice(0, CUSTOM_EMOJI_NAME_MAX)) ?? '';
}
