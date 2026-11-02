import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';

const apiMock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() }));
vi.mock('../api/client', () => ({ api: { emojis: apiMock } }));

import { findCustomEmoji, useEmojiStore } from './emojiStore';

function emoji(id: string, name: string): CustomEmoji {
  return { id, name, animated: false, createdBy: 'u', createdAt: 1 };
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  useEmojiStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('load', () => {
  it('reads the library, by name, and indexes it by id and by name', async () => {
    apiMock.list.mockResolvedValue({ emojis: [emoji('3', 'zebra'), emoji('1', 'apple'), emoji('2', 'mango')] });
    await useEmojiStore.getState().load();
    const state = useEmojiStore.getState();
    expect(state.status).toBe('ready');
    expect(state.emojis.map((e) => e.name)).toEqual(['apple', 'mango', 'zebra']);
    expect(state.byId.get('2')?.name).toBe('mango');
    expect(state.idsByName.get('zebra')).toBe('3');
    expect(findCustomEmoji('1')?.name).toBe('apple');
    expect(findCustomEmoji('nope')).toBeUndefined();
  });

  it('records a failure, logs it and keeps what it had', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMock.list.mockResolvedValueOnce({ emojis: [emoji('1', 'apple')] });
    await useEmojiStore.getState().load();
    apiMock.list.mockRejectedValueOnce(new Error('offline'));
    await useEmojiStore.getState().load();
    expect(useEmojiStore.getState().status).toBe('failed');
    expect(findCustomEmoji('1')).toBeDefined();
    expect(log).toHaveBeenCalled();
  });

  it('drops the answer of an older load, and one that arrives after the session was reset', async () => {
    let first!: (value: { emojis: CustomEmoji[] }) => void;
    apiMock.list
      .mockReturnValueOnce(new Promise((resolve) => { first = resolve; }))
      .mockResolvedValueOnce({ emojis: [emoji('2', 'new')] });
    const slow = useEmojiStore.getState().load();
    await useEmojiStore.getState().load();
    first({ emojis: [emoji('1', 'old')] });
    await slow;
    expect(useEmojiStore.getState().emojis.map((e) => e.name)).toEqual(['new']);

    let late!: (value: { emojis: CustomEmoji[] }) => void;
    apiMock.list.mockReturnValueOnce(new Promise((resolve) => { late = resolve; }));
    const pending = useEmojiStore.getState().load();
    useEmojiStore.getState().reset();
    late({ emojis: [emoji('9', 'previous_account')] });
    await pending;
    expect(useEmojiStore.getState().emojis).toEqual([]);
    expect(useEmojiStore.getState().status).toBe('idle');
  });
});

describe('changes', () => {
  it('upserts by id, so an event and the answer to the same change land once', () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave'));
    useEmojiStore.getState().upsert(emoji('1', 'wave'));
    expect(useEmojiStore.getState().emojis).toHaveLength(1);
    useEmojiStore.getState().upsert(emoji('1', 'hello'));
    expect(useEmojiStore.getState().emojis.map((e) => e.name)).toEqual(['hello']);
    expect(useEmojiStore.getState().idsByName.has('wave')).toBe(false);
  });

  it('drops by id, and a drop of an unknown id changes nothing', () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave'));
    useEmojiStore.getState().drop('2');
    expect(useEmojiStore.getState().emojis).toHaveLength(1);
    useEmojiStore.getState().drop('1');
    expect(useEmojiStore.getState().emojis).toEqual([]);
  });

  it('creates, renames and removes through the server, and applies what it answered', async () => {
    apiMock.create.mockResolvedValue(emoji('5', 'party'));
    await expect(useEmojiStore.getState().create('party', 'AAAA')).resolves.toMatchObject({ id: '5' });
    expect(apiMock.create).toHaveBeenCalledWith({ name: 'party', image: 'AAAA' });
    expect(findCustomEmoji('5')?.name).toBe('party');

    apiMock.rename.mockResolvedValue(emoji('5', 'celebrate'));
    await useEmojiStore.getState().rename('5', 'celebrate');
    expect(apiMock.rename).toHaveBeenCalledWith('5', 'celebrate');
    expect(findCustomEmoji('5')?.name).toBe('celebrate');

    apiMock.remove.mockResolvedValue({ success: true });
    await useEmojiStore.getState().remove('5');
    expect(findCustomEmoji('5')).toBeUndefined();
  });

  it('leaves the library alone and rejects when the server refuses', async () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave'));
    apiMock.create.mockRejectedValue(new Error('taken'));
    await expect(useEmojiStore.getState().create('wave', 'AAAA')).rejects.toThrow('taken');
    apiMock.remove.mockRejectedValue(new Error('forbidden'));
    await expect(useEmojiStore.getState().remove('1')).rejects.toThrow('forbidden');
    expect(findCustomEmoji('1')).toBeDefined();
    apiMock.rename.mockRejectedValue(new Error('taken'));
    await expect(useEmojiStore.getState().rename('1', 'x')).rejects.toThrow('taken');
    expect(findCustomEmoji('1')?.name).toBe('wave');
  });
});
