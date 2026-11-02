import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BlockedUser, User } from '@backspace/shared';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

const apiMock = vi.hoisted(() => ({ listBlocks: vi.fn(), block: vi.fn(), unblock: vi.fn() }));
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: { users: apiMock },
}));

import { BlockUserButton } from './BlockUserButton';
import { useBlockStore } from '../../stores/blockStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';

const friend = { id: 'friend-1', username: 'rhea', displayName: 'Rhea' } as User;
const CLASS = 'btn';

function entry(user: User): BlockedUser {
  return { user, blockedAt: 5 };
}

beforeEach(() => {
  apiMock.block.mockReset();
  apiMock.unblock.mockReset();
  useBlockStore.getState().reset();
  useAuthStore.setState({ user: { id: 'me', username: 'me' } as User, myRowIds: new Map() });
  useUIStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe('BlockUserButton', () => {
  it('asks before blocking, and says what a block does', async () => {
    const user = userEvent.setup();
    render(<BlockUserButton user={friend} origin="" className={CLASS} />);
    await user.click(screen.getByRole('button', { name: 'Block' }));
    expect(screen.getByText('Block Rhea?')).toBeInTheDocument();
    expect(screen.getByText(/They are not told/)).toBeInTheDocument();
    expect(apiMock.block).not.toHaveBeenCalled();
  });

  it('blocks once confirmed, tells the user and reports done', async () => {
    apiMock.block.mockResolvedValue(entry(friend));
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<BlockUserButton user={friend} origin="" className={CLASS} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Block' }));
    // The dialog's own confirm button is the second one with that name.
    const confirm = screen.getAllByRole('button', { name: 'Block' }).at(-1)!;
    await user.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(apiMock.block).toHaveBeenCalledWith('friend-1');
    expect(useBlockStore.getState().blockedIds.has('friend-1')).toBe(true);
    expect(useUIStore.getState().toasts.map((toast) => toast.message)).toContain('Rhea is blocked.');
  });

  it('shows the reason and blocks nobody when the server refuses', async () => {
    apiMock.block.mockRejectedValue(new Error('server down'));
    const user = userEvent.setup();
    render(<BlockUserButton user={friend} origin="" className={CLASS} />);
    await user.click(screen.getByRole('button', { name: 'Block' }));
    await user.click(screen.getAllByRole('button', { name: 'Block' }).at(-1)!);
    await waitFor(() => expect(useUIStore.getState().toasts.some((toast) => toast.message.startsWith('Could not block Rhea'))).toBe(true));
    expect(useBlockStore.getState().blockedIds.has('friend-1')).toBe(false);
  });

  it('offers to unblock someone already blocked, with no question asked', async () => {
    useBlockStore.setState({ blocks: [entry(friend)], blockedIds: new Set(['friend-1']) });
    apiMock.unblock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<BlockUserButton user={friend} origin="" className={CLASS} />);
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(apiMock.unblock).toHaveBeenCalledWith('friend-1'));
    await waitFor(() => expect(useBlockStore.getState().blockedIds.has('friend-1')).toBe(false));
    expect(screen.queryByText('Block Rhea?')).not.toBeInTheDocument();
  });

  it('is not offered for yourself', () => {
    const { container } = render(<BlockUserButton user={{ id: 'me', username: 'me' } as User} origin="" className={CLASS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not offered for a person met on another instance: their id is not a home id', () => {
    const { container } = render(<BlockUserButton user={friend} origin="https://remote.example" className={CLASS} />);
    expect(container).toBeEmptyDOMElement();
  });
});
