import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BlockedUser, User } from '@backspace/shared';

const apiMock = vi.hoisted(() => ({ listBlocks: vi.fn(), block: vi.fn(), unblock: vi.fn() }));
vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  api: { users: apiMock },
}));

import { BlockedPeopleSection } from './BlockedPeopleSection';
import { useBlockStore } from '../../../stores/blockStore';
import { useUIStore } from '../../../stores/uiStore';

function entry(id: string, name: string, blockedAt: number): BlockedUser {
  return { user: { id, username: id, displayName: name } as User, blockedAt };
}

beforeEach(() => {
  apiMock.listBlocks.mockReset();
  apiMock.unblock.mockReset();
  useBlockStore.getState().reset();
  useUIStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe('BlockedPeopleSection', () => {
  it('says so while the list is loading', () => {
    useBlockStore.setState({ status: 'loading' });
    render(<BlockedPeopleSection />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('says nobody is blocked once the list came back empty', () => {
    useBlockStore.setState({ status: 'ready' });
    render(<BlockedPeopleSection />);
    expect(screen.getByText('You have not blocked anyone.')).toBeInTheDocument();
  });

  it('lists the blocked people, newest first, each with an unblock button', () => {
    useBlockStore.setState({
      status: 'ready',
      blocks: [entry('b', 'Bea', 9), entry('a', 'Ann', 1)],
      blockedIds: new Set(['a', 'b']),
    });
    render(<BlockedPeopleSection />);
    const names = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(names[0]).toContain('Bea');
    expect(names[1]).toContain('Ann');
    expect(screen.getAllByRole('button', { name: 'Unblock' })).toHaveLength(2);
  });

  it('unblocks the person whose button was pressed', async () => {
    apiMock.unblock.mockResolvedValue({ success: true });
    useBlockStore.setState({
      status: 'ready',
      blocks: [entry('b', 'Bea', 9), entry('a', 'Ann', 1)],
      blockedIds: new Set(['a', 'b']),
    });
    const user = userEvent.setup();
    render(<BlockedPeopleSection />);
    await user.click(screen.getAllByRole('button', { name: 'Unblock' })[1]!);
    await waitFor(() => expect(apiMock.unblock).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(useUIStore.getState().toasts.map((toast) => toast.message)).toContain('Ann is unblocked.');
  });

  it('offers the retry when the list could not be read, and uses it', async () => {
    useBlockStore.setState({ status: 'failed' });
    apiMock.listBlocks.mockResolvedValue({ blocks: [entry('a', 'Ann', 1)] });
    const user = userEvent.setup();
    render(<BlockedPeopleSection />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your blocked people.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Ann')).toBeInTheDocument());
  });

  it('keeps the person listed and shows the reason when unblocking fails', async () => {
    apiMock.unblock.mockRejectedValue(new Error('offline'));
    useBlockStore.setState({ status: 'ready', blocks: [entry('a', 'Ann', 1)], blockedIds: new Set(['a']) });
    const user = userEvent.setup();
    render(<BlockedPeopleSection />);
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(useUIStore.getState().toasts.some((toast) => toast.message.startsWith('Could not unblock Ann'))).toBe(true));
    expect(screen.getByText('Ann')).toBeInTheDocument();
  });
});
