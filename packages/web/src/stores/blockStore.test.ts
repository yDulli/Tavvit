import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlockedUser, User } from '@backspace/shared';

const apiMock = vi.hoisted(() => ({
  listBlocks: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
}));
vi.mock('../api/client', () => ({ api: { users: apiMock } }));

import { isBlockedUser, useBlockStore } from './blockStore';

function entry(id: string, blockedAt: number): BlockedUser {
  return { user: { id, username: id } as User, blockedAt };
}

beforeEach(() => {
  apiMock.listBlocks.mockReset();
  apiMock.block.mockReset();
  apiMock.unblock.mockReset();
  useBlockStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('load', () => {
  it('reads the list, newest block first, and indexes the ids', async () => {
    apiMock.listBlocks.mockResolvedValue({ blocks: [entry('a', 1), entry('b', 3), entry('c', 2)] });
    await useBlockStore.getState().load();
    const state = useBlockStore.getState();
    expect(state.status).toBe('ready');
    expect(state.blocks.map((b) => b.user.id)).toEqual(['b', 'c', 'a']);
    expect(isBlockedUser('a')).toBe(true);
    expect(isBlockedUser('zzz')).toBe(false);
    expect(isBlockedUser(null)).toBe(false);
  });

  it('records a failure instead of throwing, and keeps what it had', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMock.listBlocks.mockResolvedValueOnce({ blocks: [entry('a', 1)] });
    await useBlockStore.getState().load();
    apiMock.listBlocks.mockRejectedValueOnce(new Error('offline'));
    await useBlockStore.getState().load();
    expect(useBlockStore.getState().status).toBe('failed');
    expect(isBlockedUser('a')).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it('drops the answer of an older load when a newer one was started', async () => {
    let releaseFirst!: (value: { blocks: BlockedUser[] }) => void;
    apiMock.listBlocks
      .mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce({ blocks: [entry('new', 5)] });
    const first = useBlockStore.getState().load();
    await useBlockStore.getState().load();
    releaseFirst({ blocks: [entry('old', 1)] });
    await first;
    expect(useBlockStore.getState().blocks.map((b) => b.user.id)).toEqual(['new']);
  });

  it('drops the answer that arrives after the session was reset', async () => {
    let release!: (value: { blocks: BlockedUser[] }) => void;
    apiMock.listBlocks.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const pending = useBlockStore.getState().load();
    useBlockStore.getState().reset();
    release({ blocks: [entry('previous-account', 1)] });
    await pending;
    expect(useBlockStore.getState().blocks).toEqual([]);
    expect(useBlockStore.getState().status).toBe('idle');
  });
});

describe('block and unblock', () => {
  it('adds the answered entry at the top', async () => {
    apiMock.listBlocks.mockResolvedValue({ blocks: [entry('a', 1)] });
    await useBlockStore.getState().load();
    apiMock.block.mockResolvedValue(entry('b', 9));
    await useBlockStore.getState().block({ id: 'b' });
    expect(apiMock.block).toHaveBeenCalledWith('b');
    expect(useBlockStore.getState().blocks.map((b) => b.user.id)).toEqual(['b', 'a']);
    expect(isBlockedUser('b')).toBe(true);
  });

  it('does not list somebody twice when the same block is made again', async () => {
    apiMock.block.mockResolvedValue(entry('b', 9));
    await useBlockStore.getState().block({ id: 'b' });
    await useBlockStore.getState().block({ id: 'b' });
    expect(useBlockStore.getState().blocks).toHaveLength(1);
  });

  it('leaves the store alone and rejects when the server refuses', async () => {
    apiMock.block.mockRejectedValue(new Error('nope'));
    await expect(useBlockStore.getState().block({ id: 'b' })).rejects.toThrow('nope');
    expect(isBlockedUser('b')).toBe(false);
  });

  it('removes the person on unblock, and keeps them when it fails', async () => {
    apiMock.listBlocks.mockResolvedValue({ blocks: [entry('a', 1), entry('b', 2)] });
    await useBlockStore.getState().load();
    apiMock.unblock.mockRejectedValueOnce(new Error('offline'));
    await expect(useBlockStore.getState().unblock('a')).rejects.toThrow('offline');
    expect(isBlockedUser('a')).toBe(true);

    apiMock.unblock.mockResolvedValueOnce({ success: true });
    await useBlockStore.getState().unblock('a');
    expect(isBlockedUser('a')).toBe(false);
    expect(isBlockedUser('b')).toBe(true);
  });
});

describe('applyIds (blocks_updated)', () => {
  it('hides a newly blocked id at once and fetches the entry it has no row for', async () => {
    apiMock.listBlocks.mockResolvedValue({ blocks: [entry('x', 4)] });
    useBlockStore.getState().applyIds(['x']);
    expect(isBlockedUser('x')).toBe(true);
    await vi.waitFor(() => expect(useBlockStore.getState().blocks.map((b) => b.user.id)).toEqual(['x']));
    expect(apiMock.listBlocks).toHaveBeenCalledTimes(1);
  });

  it('drops a lifted block without asking the server again', async () => {
    apiMock.listBlocks.mockResolvedValue({ blocks: [entry('a', 1), entry('b', 2)] });
    await useBlockStore.getState().load();
    apiMock.listBlocks.mockClear();
    useBlockStore.getState().applyIds(['b']);
    expect(useBlockStore.getState().blocks.map((b) => b.user.id)).toEqual(['b']);
    expect(isBlockedUser('a')).toBe(false);
    expect(apiMock.listBlocks).not.toHaveBeenCalled();
  });
});
