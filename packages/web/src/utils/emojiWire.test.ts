import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { fromWireText, toWireText } from './emojiWire';
import { useEmojiStore } from '../stores/emojiStore';
import { useSpaceStore } from '../stores/spaceStore';

function emoji(id: string, name: string): CustomEmoji {
  return { id, name, animated: false, createdBy: null, createdAt: 1 };
}

beforeEach(() => {
  useEmojiStore.getState().reset();
  useEmojiStore.getState().upsert(emoji('11111', 'wave'));
  useSpaceStore.setState({ channelOriginMap: new Map([['home-chan', ''], ['remote-chan', 'https://nova.example']]) });
});

afterEach(() => {
  useEmojiStore.getState().reset();
  useSpaceStore.setState({ channelOriginMap: new Map() });
});

describe('fromWireText', () => {
  it('reads a token as the name it was typed as, and back', () => {
    expect(fromWireText('hi <:wave:11111>', 'home-chan')).toBe('hi :wave:');
    expect(toWireText(fromWireText('hi <:wave:11111>', 'home-chan'), 'home-chan')).toBe('hi <:wave:11111>');
  });

  it('keeps a token whose name no longer leads to that emoji', () => {
    expect(fromWireText('<:wave:99999> and <:gone:12345>', 'home-chan')).toBe('<:wave:99999> and <:gone:12345>');
  });

  it('leaves text in code and in a channel of another instance alone', () => {
    expect(fromWireText('`<:wave:11111>`', 'home-chan')).toBe('`<:wave:11111>`');
    expect(fromWireText('<:wave:11111>', 'remote-chan')).toBe('<:wave:11111>');
  });
});

describe('toWireText', () => {
  it('sends a typed :name: as the emoji\'s token', () => {
    expect(toWireText('hi :wave:', 'home-chan')).toBe('hi <:wave:11111>');
  });

  it('leaves text with no known emoji exactly as it is', () => {
    expect(toWireText('hi :smile: and :unknown:', 'home-chan')).toBe('hi :smile: and :unknown:');
  });

  it('treats a channel with no recorded origin as home', () => {
    expect(toWireText(':wave:', 'not-yet-known')).toBe('<:wave:11111>');
  });

  it('leaves the text alone for a channel another instance hosts', () => {
    expect(toWireText('hi :wave:', 'remote-chan')).toBe('hi :wave:');
  });

  it('uses the library as it is now', () => {
    useEmojiStore.getState().upsert(emoji('22222', 'party'));
    expect(toWireText(':party:', 'home-chan')).toBe('<:party:22222>');
    useEmojiStore.getState().drop('22222');
    expect(toWireText(':party:', 'home-chan')).toBe(':party:');
  });
});
