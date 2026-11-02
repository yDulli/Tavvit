import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import type { MessageWithUser } from '@backspace/shared';
import { usePinRevision } from '../../stores/pinStore';
import { PinsPopover } from './PinsPopover';

const client = vi.hoisted(() => ({
  channels: { pins: vi.fn() },
  dm: { pins: vi.fn(), unpinMessage: vi.fn() },
  messages: { unpin: vi.fn() },
}));

vi.mock('../../stores/spaceStore', () => ({
  getApiForOrigin: () => client,
  getChannelOrigin: () => '',
}));

vi.mock('../../hooks/useFloatingPosition', () => ({ useFloatingPosition: () => ({ style: {} }) }));

vi.mock('./SearchPopover', () => ({
  SearchResultRow: ({ msg, onJumpToMessage }: { msg: MessageWithUser; onJumpToMessage: (id: string) => void }) => (
    <button type="button" onClick={() => onJumpToMessage(msg.id)}>{msg.content}</button>
  ),
}));

const pin = (id: string, content: string) => ({ id, content }) as unknown as MessageWithUser;

function show(overrides: Partial<React.ComponentProps<typeof PinsPopover>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    anchorRef: createRef<HTMLButtonElement>(),
    channelId: 'c1',
    isDm: false,
    canUnpin: true,
    onJumpToMessage: vi.fn(),
    ...overrides,
  };
  render(<PinsPopover {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.channels.pins.mockResolvedValue([pin('m1', 'first pin'), pin('m2', 'second pin')]);
  client.messages.unpin.mockResolvedValue({ pinnedAt: null, pinnedBy: null });
});

describe('the list of pinned messages', () => {
  it('asks the channel, and goes to a message when one is chosen', async () => {
    const { onJumpToMessage } = show();
    await userEvent.click(await screen.findByRole('button', { name: 'second pin' }));
    expect(onJumpToMessage).toHaveBeenCalledWith('m2');
  });

  it('asks a conversation instead in a conversation', async () => {
    client.dm.pins.mockResolvedValue([pin('d1', 'between us')]);
    show({ isDm: true });
    expect(await screen.findByRole('button', { name: 'between us' })).toBeTruthy();
    expect(client.channels.pins).not.toHaveBeenCalled();
  });

  it('says so when there is nothing', async () => {
    client.channels.pins.mockResolvedValue([]);
    show();
    expect(await screen.findByText('Nothing pinned yet')).toBeTruthy();
  });

  it('takes a pin off for someone who may, and offers nothing to someone who may not', async () => {
    show();
    const [first] = await screen.findAllByRole('button', { name: 'Unpin' });
    await userEvent.click(first!);
    expect(client.messages.unpin).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'first pin' })).toBeNull());
  });

  it('offers no way to unpin without the right', async () => {
    show({ canUnpin: false });
    await screen.findByRole('button', { name: 'first pin' });
    expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull();
  });

  it('asks again while open when a pin changes', async () => {
    show();
    await screen.findByRole('button', { name: 'first pin' });
    client.channels.pins.mockResolvedValue([pin('m3', 'a new pin')]);
    act(() => usePinRevision.getState().bump());
    expect(await screen.findByRole('button', { name: 'a new pin' })).toBeTruthy();
  });

  it('asks nothing while closed', () => {
    show({ open: false });
    expect(client.channels.pins).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes with Escape', async () => {
    const { onClose } = show();
    await screen.findByRole('button', { name: 'first pin' });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
