import { describe, it, expect } from 'vitest';
import {
  CUSTOM_EMOJI_NAME_MAX,
  EMOJI_ID_PATTERN,
  customEmojiUrl,
  emojiIdOfReaction,
  emojiIdsIn,
  emojiReactionValue,
  emojiToken,
  emojiTokensToText,
  normalizeEmojiName,
  splitCustomEmoji,
  tokenizeCustomEmojiShortcodes,
} from '@backspace/shared/src/customEmoji.js';

describe('normalizeEmojiName', () => {
  it('keeps a good name, forgives capitals, spaces and colons', () => {
    expect(normalizeEmojiName('party_parrot')).toBe('party_parrot');
    expect(normalizeEmojiName('  Party_Parrot ')).toBe('party_parrot');
    expect(normalizeEmojiName(':party_parrot:')).toBe('party_parrot');
    expect(normalizeEmojiName('a1')).toBe('a1');
  });

  it.each(['', 'a', 'x'.repeat(CUSTOM_EMOJI_NAME_MAX + 1), 'has space', 'dash-ed', 'ümlaut', ':', 'a:b', '<x>', 'a.b', 42, null, undefined])(
    'refuses %j rather than changing it',
    (value) => {
      expect(normalizeEmojiName(value)).toBeNull();
    },
  );

  it('accepts the longest name and no longer one', () => {
    expect(normalizeEmojiName('x'.repeat(CUSTOM_EMOJI_NAME_MAX))).not.toBeNull();
  });
});

describe('the forms an emoji takes', () => {
  it('has a token in text, a value as a reaction and a picture address', () => {
    expect(emojiToken('wave', '12345')).toBe('<:wave:12345>');
    expect(emojiReactionValue('12345')).toBe('emoji:12345');
    expect(customEmojiUrl('12345')).toBe('/api/emojis/12345.webp');
  });

  it('reads the id back from a reaction, and only from a reaction', () => {
    expect(emojiIdOfReaction('emoji:12345')).toBe('12345');
    expect(emojiIdOfReaction('emoji:')).toBeNull();
    expect(emojiIdOfReaction('emoji:abc')).toBeNull();
    expect(emojiIdOfReaction('emoji:12')).toBeNull();
    expect(emojiIdOfReaction('👍')).toBeNull();
    expect(emojiIdOfReaction('sticker:https://x/api/stickers/assets/a.webp')).toBeNull();
    expect(EMOJI_ID_PATTERN.test('369926066531020800')).toBe(true);
  });
});

describe('splitCustomEmoji', () => {
  it('cuts text and emoji in order', () => {
    expect(splitCustomEmoji('hi <:wave:11111> there <:smile_big:22222>!')).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'emoji', name: 'wave', id: '11111', token: '<:wave:11111>' },
      { kind: 'text', text: ' there ' },
      { kind: 'emoji', name: 'smile_big', id: '22222', token: '<:smile_big:22222>' },
      { kind: 'text', text: '!' },
    ]);
  });

  it('reads the parts back as the text it was given', () => {
    const text = 'a <:x1:12345><:y2:67890> b `<:z3:11111>` c\n```\n<:q4:22222>\n```';
    expect(splitCustomEmoji(text).map((p) => (p.kind === 'emoji' ? p.token : p.text)).join('')).toBe(text);
  });

  it('leaves an emoji in code as text', () => {
    expect(splitCustomEmoji('`<:wave:11111>`')).toEqual([{ kind: 'text', text: '`<:wave:11111>`' }]);
    expect(splitCustomEmoji('```\n<:wave:11111>\n```')).toEqual([{ kind: 'text', text: '```\n<:wave:11111>\n```' }]);
  });

  it('does not take malformed tokens', () => {
    for (const bad of ['<:wave:abc>', '<:w:12345>', '<:Wave:12345>', '<wave:12345>', '<:wave:1234>', '<:wave 1:12345>']) {
      expect(splitCustomEmoji(bad)).toEqual([{ kind: 'text', text: bad }]);
    }
  });

  it('gives an empty list for empty content', () => {
    expect(splitCustomEmoji('')).toEqual([]);
  });
});

describe('emojiIdsIn', () => {
  it('lists each id once, outside code', () => {
    expect(emojiIdsIn('<:a1:11111> <:b2:22222> <:a1:11111> `<:c3:33333>`')).toEqual(['11111', '22222']);
    expect(emojiIdsIn(null)).toEqual([]);
    expect(emojiIdsIn('')).toEqual([]);
  });
});

describe('tokenizeCustomEmojiShortcodes', () => {
  const ids = new Map([['wave', '11111'], ['party_parrot', '22222']]);

  it('turns a known :name: into its token and leaves the rest as typed', () => {
    expect(tokenizeCustomEmojiShortcodes('hi :wave: and :smile: and :party_parrot:', ids))
      .toBe('hi <:wave:11111> and :smile: and <:party_parrot:22222>');
  });

  it('turns every occurrence, including two in a row', () => {
    expect(tokenizeCustomEmojiShortcodes(':wave: :wave:', ids)).toBe('<:wave:11111> <:wave:11111>');
    expect(tokenizeCustomEmojiShortcodes(' :wave: :party_parrot: ', ids)).toBe(' <:wave:11111> <:party_parrot:22222> ');
  });

  it('leaves code and existing tokens alone', () => {
    expect(tokenizeCustomEmojiShortcodes('`:wave:` and ```\n:wave:\n```', ids)).toBe('`:wave:` and ```\n:wave:\n```');
    expect(tokenizeCustomEmojiShortcodes('<:wave:11111>', ids)).toBe('<:wave:11111>');
  });

  it('does not take a name that is part of something longer', () => {
    expect(tokenizeCustomEmojiShortcodes('12:wave:34', ids)).toBe('12:wave:34');
    expect(tokenizeCustomEmojiShortcodes('a:wave:', ids)).toBe('a:wave:');
    expect(tokenizeCustomEmojiShortcodes('::wave::', ids)).toBe('::wave::');
    expect(tokenizeCustomEmojiShortcodes('http://wave:8080', ids)).toBe('http://wave:8080');
  });

  it('does nothing without emoji or without a colon', () => {
    expect(tokenizeCustomEmojiShortcodes('hello :wave:', new Map())).toBe('hello :wave:');
    expect(tokenizeCustomEmojiShortcodes('hello', ids)).toBe('hello');
  });

  it('is case sensitive, as names are lower case', () => {
    expect(tokenizeCustomEmojiShortcodes(':Wave:', ids)).toBe(':Wave:');
  });
});

describe('emojiTokensToText', () => {
  it('shows each token as :name: and keeps code as written', () => {
    expect(emojiTokensToText('hi <:wave:11111>!')).toBe('hi :wave:!');
    expect(emojiTokensToText('`<:wave:11111>` <:wave:11111>')).toBe('`<:wave:11111>` :wave:');
    expect(emojiTokensToText('plain')).toBe('plain');
  });
});
