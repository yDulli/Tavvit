import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';
import type { AvailableSpaceExpressions } from '@backspace/shared/src/spaceExpressions';

interface PickerProps {
  custom: Array<{ id: string; name: string; emojis: Array<{ id: string; name: string; keywords: string[]; skins: Array<{ src: string }> }> }>;
  categories: string[];
  categoryIcons?: Record<string, { svg: string }>;
  onEmojiSelect: (picked: { native?: string; id?: string }) => void;
}

// emoji-mart is a web component; what matters here is what is handed to it and what comes back.
const lastProps = vi.hoisted(() => ({ value: null as PickerProps | null }));
vi.mock('@emoji-mart/react', () => ({
  default: (props: PickerProps) => {
    lastProps.value = props;
    return <div data-testid="emoji-mart" />;
  },
}));
vi.mock('./StickerPicker', () => ({ StickerPicker: () => <div /> }));
vi.mock('../../utils/emojiData', () => ({ loadEmojiData: async () => ({}) }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { EmojiPicker } from './EmojiPicker';
import { originEntry, useEmojiStore } from '../../stores/emojiStore';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';

function emoji(id: string, name: string): CustomEmoji {
  return { id, name, animated: false, createdBy: null, createdAt: 1 };
}

function spaceEmoji(id: string, name: string, spaceId: string) {
  return { id, spaceId, name, animated: false, createdBy: null, createdAt: 1 };
}

/** What `origin` offers, as if loaded: a library and the spaces the person is in. */
function offer(origin: string, library: CustomEmoji[], spaces: AvailableSpaceExpressions[] = []) {
  const origins = new Map(useEmojiStore.getState().origins);
  origins.set(origin, originEntry('ready', library, spaces));
  useEmojiStore.setState({ origins });
}

function space(id: string, name: string, origin = ''): TaggedSpace {
  return { id, name, _instanceOrigin: origin } as TaggedSpace;
}

beforeEach(() => {
  lastProps.value = null;
  useEmojiStore.getState().reset();
  offer('', []);
  useSpaceStore.setState({ spaces: [] });
});

afterEach(() => {
  cleanup();
  useEmojiStore.getState().reset();
  useSpaceStore.setState({ spaces: [] });
});

describe('the picker with no custom emoji', () => {
  it('has no custom category and passes standard emoji through', () => {
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker onEmojiSelect={onEmojiSelect} stickers={false} />);
    expect(lastProps.value!.custom).toEqual([]);
    expect(lastProps.value!.categories).not.toContain('orbit');
    lastProps.value!.onEmojiSelect({ native: '🎉', id: 'tada' });
    expect(onEmojiSelect).toHaveBeenCalledWith({ native: '🎉' });
  });
});

describe('the picker with custom emoji', () => {
  beforeEach(() => {
    offer('', [emoji('11111', 'wave'), emoji('22222', 'party_parrot')]);
  });

  it('offers them as a category after the frequent ones, searchable by name', () => {
    render(<EmojiPicker onEmojiSelect={() => {}} stickers={false} />);
    const { custom, categories, categoryIcons } = lastProps.value!;
    expect(categories.slice(0, 3)).toEqual(['frequent', 'orbit', 'people']);
    expect(custom).toHaveLength(1);
    expect(custom[0]!.id).toBe('orbit');
    expect(custom[0]!.name).toBe('Shared emoji');
    expect(custom[0]!.emojis.map((e) => e.name)).toEqual(['party_parrot', 'wave']);
    expect(custom[0]!.emojis[0]).toMatchObject({ id: 'orbit-22222', keywords: ['party_parrot'], skins: [{ src: '/api/emojis/22222.webp' }] });
    expect(categoryIcons?.orbit?.svg).toContain('<svg');
  });

  it('gives a custom emoji as :name: for a message being written', () => {
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker onEmojiSelect={onEmojiSelect} stickers={false} />);
    lastProps.value!.onEmojiSelect({ id: 'orbit-11111' });
    expect(onEmojiSelect).toHaveBeenCalledWith({ native: ':wave:' });
  });

  it('gives a custom emoji as the reaction value when asked for a reaction', () => {
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker onEmojiSelect={onEmojiSelect} customAs="reaction" stickers={false} />);
    lastProps.value!.onEmojiSelect({ id: 'orbit-11111' });
    expect(onEmojiSelect).toHaveBeenCalledWith({ native: 'emoji:11111' });
  });

  it('gives nothing for an emoji removed while the picker was open', () => {
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker onEmojiSelect={onEmojiSelect} stickers={false} />);
    act(() => useEmojiStore.getState().dropLibrary('', '11111'));
    lastProps.value!.onEmojiSelect({ id: 'orbit-11111' });
    expect(onEmojiSelect).not.toHaveBeenCalled();
  });

  it('does not take a standard emoji for a custom one, even one whose id starts the same way', () => {
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker onEmojiSelect={onEmojiSelect} stickers={false} />);
    lastProps.value!.onEmojiSelect({ native: '🌍', id: 'earth_africa' });
    expect(onEmojiSelect).toHaveBeenCalledWith({ native: '🌍' });
  });
});

describe('the picker where a space is written in', () => {
  beforeEach(() => {
    useSpaceStore.setState({ spaces: [space('s-other', 'Other place'), space('s-here', 'Night Shift'), space('s-far', 'Far', 'https://nova.example')] });
    offer('', [emoji('11111', 'wave')], [
      { spaceId: 's-here', emojis: [spaceEmoji('33333', 'wave', 's-here')], stickers: [] },
      { spaceId: 's-other', emojis: [spaceEmoji('44444', 'cat', 's-other'), spaceEmoji('55555', 'wave', 's-other')], stickers: [] },
    ]);
    offer('https://nova.example', [emoji('66666', 'nova')], [{ spaceId: 's-far', emojis: [spaceEmoji('77777', 'far', 's-far')], stickers: [] }]);
  });

  it('offers the space first, then the library, then the other spaces, each named', () => {
    render(<EmojiPicker onEmojiSelect={() => {}} stickers={false} context={{ origin: '', spaceId: 's-here' }} />);
    const { custom, categories } = lastProps.value!;
    expect(categories.slice(0, 4)).toEqual(['frequent', 'space-s-here', 'orbit', 'space-s-other']);
    expect(custom.map((category) => category.name)).toEqual(['Night Shift', 'Shared emoji', 'Other place']);
  });

  it('gives a name a later set shares a shortcode of its own, so the pick is what is sent', () => {
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker onEmojiSelect={onEmojiSelect} stickers={false} context={{ origin: '', spaceId: 's-here' }} />);
    const names = lastProps.value!.custom.flatMap((category) => category.emojis.map((entry) => entry.name));
    expect(names).toEqual(['wave', 'wave~2', 'cat', 'wave~3']);
    lastProps.value!.onEmojiSelect({ id: 'orbit-55555' });
    expect(onEmojiSelect).toHaveBeenCalledWith({ native: ':wave~3:' });
  });

  it('offers another instance\'s own emoji in its channels, drawn from there, and none of home\'s', () => {
    render(<EmojiPicker onEmojiSelect={() => {}} stickers={false} context={{ origin: 'https://nova.example', spaceId: 's-far' }} />);
    const { custom } = lastProps.value!;
    expect(custom.map((category) => category.id)).toEqual(['space-s-far', 'orbit']);
    expect(custom[0]!.emojis[0]!.skins).toEqual([{ src: 'https://nova.example/api/emojis/77777.webp' }]);
    expect(custom.flatMap((category) => category.emojis.map((entry) => entry.id))).not.toContain('orbit-11111');
  });

  it('offers no custom emoji where only a standard one will do', () => {
    render(<EmojiPicker onEmojiSelect={() => {}} stickers={false} custom={false} context={{ origin: '', spaceId: 's-here' }} />);
    expect(lastProps.value!.custom).toEqual([]);
  });
});
