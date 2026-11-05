import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { fromWireText, toWireText } from './emojiWire';
import { originEntry, useEmojiStore } from '../stores/emojiStore';
import { useSpaceStore, type TaggedSpace } from '../stores/spaceStore';

// What a person types (`:name:`, `:name~2:`) and what is sent (`<:name:id>`), by the sets on offer
// where the text goes: a channel's host and space, or this page's instance in a direct message.

function emoji(id: string, name: string): CustomEmoji {
  return { id, name, animated: false, createdBy: null, createdAt: 1 };
}

function spaceEmoji(id: string, name: string, spaceId: string) {
  return { id, spaceId, name, animated: false, createdBy: null, createdAt: 1 };
}

beforeEach(() => {
  useEmojiStore.getState().reset();
  useEmojiStore.setState({
    origins: new Map([
      ['', originEntry('ready', [emoji('11111', 'wave')], [
        { spaceId: 'space-here', emojis: [spaceEmoji('22222', 'party', 'space-here'), spaceEmoji('33333', 'wave', 'space-here')], stickers: [] },
      ])],
      ['https://nova.example', originEntry('ready', [emoji('44444', 'nova')], [])],
    ]),
  });
  useSpaceStore.setState({
    spaces: [{ id: 'space-here', name: 'Here', _instanceOrigin: '' } as TaggedSpace, { id: 'space-far', name: 'Far', _instanceOrigin: 'https://nova.example' } as TaggedSpace],
    channelToSpaceMap: new Map([['home-chan', 'space-here'], ['remote-chan', 'space-far']]),
    channelOriginMap: new Map([['home-chan', ''], ['remote-chan', 'https://nova.example']]),
  });
});

afterEach(() => {
  useEmojiStore.getState().reset();
  useSpaceStore.setState({ spaces: [], channelToSpaceMap: new Map(), channelOriginMap: new Map() });
});

describe('toWireText', () => {
  it('sends a typed :name: as the token of the emoji on offer there, the space\'s own first', () => {
    expect(toWireText('hi :party: :wave:', 'home-chan')).toBe('hi <:party:22222> <:wave:33333>');
  });

  it('reaches a later set\'s emoji of the same name by its alias, and sends its plain name', () => {
    expect(toWireText(':wave~2:', 'home-chan')).toBe('<:wave:11111>');
  });

  it('uses the host\'s emoji in a channel another instance hosts, not this one\'s', () => {
    expect(toWireText(':nova: :wave:', 'remote-chan')).toBe('<:nova:44444> :wave:');
  });

  it('uses this page\'s library and spaces in a direct message', () => {
    expect(toWireText(':wave: :party:', 'dm-1')).toBe('<:wave:11111> <:party:22222>');
  });

  it('leaves text with no known emoji, and code, exactly as it is', () => {
    expect(toWireText('hi :smile: and :unknown: `:wave:`', 'home-chan')).toBe('hi :smile: and :unknown: `:wave:`');
  });

  it('uses the offer as it is now', () => {
    useEmojiStore.getState().upsertLibrary('', emoji('55555', 'fresh'));
    expect(toWireText(':fresh:', 'dm-1')).toBe('<:fresh:55555>');
    useEmojiStore.getState().dropLibrary('', '55555');
    expect(toWireText(':fresh:', 'dm-1')).toBe(':fresh:');
  });
});

describe('fromWireText', () => {
  it('reads a token as the shortcode that sends it again, alias included', () => {
    expect(fromWireText('hi <:wave:11111> <:wave:33333>', 'home-chan')).toBe('hi :wave~2: :wave:');
    expect(toWireText(fromWireText('hi <:wave:11111> <:wave:33333>', 'home-chan'), 'home-chan')).toBe('hi <:wave:11111> <:wave:33333>');
  });

  it('keeps a token whose emoji is not on offer there, so saving cannot swap or lose it', () => {
    expect(fromWireText('<:gone:12345> <:nova:44444>', 'home-chan')).toBe('<:gone:12345> <:nova:44444>');
    expect(fromWireText('`<:wave:11111>`', 'home-chan')).toBe('`<:wave:11111>`');
  });
});
