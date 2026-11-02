import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MentionItem, MentionsResponse } from '@backspace/shared';

const mentions = vi.hoisted(() => vi.fn<(params?: { before?: string; limit?: number }) => Promise<MentionsResponse>>());
vi.mock('../utils/crossStoreResolvers', () => ({ getApiForOrigin: () => ({ inbox: { mentions } }) }));

import { selectAllMentions, useInboxStore } from './inboxStore';

function item(id: string, createdAt: number): MentionItem {
  return {
    spaceId: 's', channelId: 'c', via: 'user',
    message: { id, channelId: 'c', userId: 'a', content: `<@me> ${id}`, createdAt, user: { id: 'a' }, attachments: [], embeds: [] } as never,
  };
}

beforeEach(() => {
  mentions.mockReset();
  useInboxStore.getState().reset();
});

describe('inboxStore', () => {
  it('loads an origin, pages older mentions without repeats, and merges origins newest first', async () => {
    mentions.mockResolvedValueOnce({ mentions: [item('3', 30), item('2', 20)], nextBefore: '2' });
    await useInboxStore.getState().loadOrigin('');
    mentions.mockResolvedValueOnce({ mentions: [item('2', 20), item('1', 10)], nextBefore: null });
    await useInboxStore.getState().loadMore('');
    expect(mentions).toHaveBeenLastCalledWith({ before: '2', limit: 30 });

    mentions.mockResolvedValueOnce({ mentions: [item('9', 25)], nextBefore: null });
    await useInboxStore.getState().loadOrigin('https://elsewhere.test');

    expect(selectAllMentions(useInboxStore.getState()).map((m) => [m.origin, m.message.id])).toEqual([
      ['', '3'], ['https://elsewhere.test', '9'], ['', '2'], ['', '1'],
    ]);
    expect(useInboxStore.getState().byOrigin['']!.nextBefore).toBeNull();
  });

  it('adds a live mention once, follows edits and deletions, and ignores them before the first page', async () => {
    useInboxStore.getState().addLive('', item('5', 50));
    expect(useInboxStore.getState().byOrigin['']).toBeUndefined();

    mentions.mockResolvedValueOnce({ mentions: [item('3', 30)], nextBefore: null });
    await useInboxStore.getState().loadOrigin('');
    useInboxStore.getState().addLive('', item('5', 50));
    useInboxStore.getState().addLive('', item('5', 50));
    expect(useInboxStore.getState().byOrigin['']!.items.map((m) => m.message.id)).toEqual(['5', '3']);

    useInboxStore.getState().updateLive('', { ...item('5', 50).message, content: 'edited <@me>' });
    expect(useInboxStore.getState().byOrigin['']!.items[0]!.message.content).toBe('edited <@me>');
    useInboxStore.getState().removeLive('', '5');
    expect(useInboxStore.getState().byOrigin['']!.items.map((m) => m.message.id)).toEqual(['3']);
  });

  it('marks a failed origin and drops an answer that arrives after a reset', async () => {
    mentions.mockRejectedValueOnce(new Error('offline'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await useInboxStore.getState().loadOrigin('');
    expect(useInboxStore.getState().byOrigin['']!.status).toBe('failed');
    log.mockRestore();

    let resolve: (value: MentionsResponse) => void = () => undefined;
    mentions.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = useInboxStore.getState().loadOrigin('');
    useInboxStore.getState().reset();
    resolve({ mentions: [item('1', 1)], nextBefore: null });
    await pending;
    expect(useInboxStore.getState().byOrigin).toEqual({});
  });
});
