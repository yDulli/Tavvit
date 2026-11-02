import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';

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

import { EmojiPicker } from './EmojiPicker';
import { useEmojiStore } from '../../stores/emojiStore';

function emoji(id: string, name: string): CustomEmoji {
  return { id, name, animated: false, createdBy: null, createdAt: 1 };
}

beforeEach(() => {
  lastProps.value = null;
  useEmojiStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useEmojiStore.getState().reset();
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
    useEmojiStore.getState().upsert(emoji('11111', 'wave'));
    useEmojiStore.getState().upsert(emoji('22222', 'party_parrot'));
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
    useEmojiStore.getState().drop('11111');
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
