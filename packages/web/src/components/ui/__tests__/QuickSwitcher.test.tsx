import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DmChannel, Space, User } from '@backspace/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via the stores.
vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const openDirectMessage = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/openDirectMessage', () => ({ openDirectMessage }));

import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { useQuickSwitcherStore } from '../../../stores/quickSwitcherStore';
import { useSocialStore, type TaggedFriend } from '../../../stores/socialStore';
import { useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { QuickSwitcher } from '../QuickSwitcher';

function user(id: string, name: string): User {
  return {
    id, username: name.toLowerCase(), displayName: name, avatar: null, banner: null, accentColor: null,
    avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 0,
    homeInstance: null, homeUserId: null, replicatedInstances: [],
  };
}

function friend(id: string, name: string): TaggedFriend {
  return {
    id, username: name.toLowerCase(), displayName: name, avatar: null, banner: null, accentColor: null,
    avatarColor: null, bio: null, status: 'online', customStatus: null, createdAt: 0, addedAt: 0,
    homeUserId: null, homeInstance: null, _instanceOrigin: '',
  };
}

const me = user('me', 'Maxi');
const amy = user('amy', 'Amy');

function dm(id: string, other: User, at: number): DmChannel {
  return {
    id, federatedId: null, ownerId: null, ownerHomeUserId: null, ownerHomeInstance: null, createdAt: at,
    members: [me, other], name: null, icon: null, metadataUpdatedAt: 0, lastMessage: null,
  } as unknown as DmChannel;
}

function space(id: string, name: string): Space {
  return { id, name, icon: null, banner: null, avatarColor: null, ownerId: 'x' } as unknown as Space;
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/channels/@me']}>
      <QuickSwitcher />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  openDirectMessage.mockReset();
  useAuthStore.setState({ user: me });
  useChatStore.setState({ unreadChannels: new Set(), currentChannelId: null });
  useQuickSwitcherStore.setState({ open: false });
  useUIStore.setState({ isMobile: false });
  useSocialStore.setState({ friends: [friend('amy', 'Amy'), friend('ben', 'Ben')] });
  useSpaceStore.setState({
    dmChannels: [dm('dm-amy', amy, 5)],
    spaces: [space('s1', 'Game Night'), space('s2', 'Book Club')],
    currentSpaceId: null,
    channels: [],
  });
});

afterEach(cleanup);

describe('QuickSwitcher opening', () => {
  it('is closed until Ctrl+K', () => {
    renderSwitcher();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Quick switcher' })).toBeInTheDocument();
  });

  it('opens on Cmd+K too, and closes on a second press', () => {
    renderSwitcher();
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('takes the shortcut over from the browser', () => {
    renderSwitcher();
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true, bubbles: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores K without the modifier and other combinations', () => {
    renderSwitcher();
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape and when the backdrop is pressed', async () => {
    renderSwitcher();
    useQuickSwitcherStore.getState().setOpen(true);
    const input = await screen.findByRole('combobox');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    act(() => useQuickSwitcherStore.getState().setOpen(true));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('focuses the search field', async () => {
    renderSwitcher();
    act(() => useQuickSwitcherStore.getState().setOpen(true));
    expect(await screen.findByRole('combobox')).toHaveFocus();
  });
});

describe('QuickSwitcher results', () => {
  beforeEach(() => {
    renderSwitcher();
    act(() => useQuickSwitcherStore.getState().setOpen(true));
  });

  it('offers conversations, friends without one, spaces and pages when nothing is typed', async () => {
    const list = await screen.findByRole('listbox');
    const labels = within(list).getAllByRole('option').map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('Amy') && l.includes('Conversation'))).toBe(true);
    // Ben has no conversation yet, so he is listed as a friend; Amy is not listed twice.
    expect(labels.filter((l) => l?.includes('Amy'))).toHaveLength(1);
    expect(labels.some((l) => l?.includes('Ben') && l.includes('Friend'))).toBe(true);
    expect(labels.some((l) => l?.includes('Game Night') && l.includes('Space'))).toBe(true);
    expect(labels.some((l) => l?.startsWith('Home'))).toBe(true);
  });

  it('narrows as you type and puts the best match first', async () => {
    await userEvent.type(await screen.findByRole('combobox'), 'book');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Book Club');
  });

  it('says so when nothing matches', async () => {
    await userEvent.type(await screen.findByRole('combobox'), 'zzzzqq');
    expect(screen.getByRole('status')).toHaveTextContent('Nothing matches “zzzzqq”.');
  });

  it('moves with the arrow keys, wrapping at both ends, and tells assistive technology which row is active', async () => {
    const input = await screen.findByRole('combobox');
    const count = screen.getAllByRole('option').length;
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[count - 1]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('QuickSwitcher choosing', () => {
  beforeEach(() => {
    renderSwitcher();
    act(() => useQuickSwitcherStore.getState().setOpen(true));
  });

  it('opens a conversation with Enter', async () => {
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'amy');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/channels/@me/dm-amy'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a space with a click', async () => {
    await userEvent.type(await screen.findByRole('combobox'), 'game');
    await userEvent.click(screen.getByRole('option', { name: /Game Night/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/channels/s1'));
  });

  it('starts the conversation with a friend who has none, then opens it', async () => {
    openDirectMessage.mockResolvedValue('dm-ben');
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'ben');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/channels/@me/dm-ben'));
    expect(openDirectMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'ben' }), '');
  });

  it('tells the user, and stays where it was, when the conversation cannot be made', async () => {
    openDirectMessage.mockRejectedValue(new Error('nope'));
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'ben');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(useUIStore.getState().toasts.some((t) => t.message.includes('nope'))).toBe(true));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/@me');
  });

  it('opens the settings dialog for the Settings entry', async () => {
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'settings');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(useUIStore.getState().activeModal).toBe('userSettings'));
  });
});

describe('QuickSwitcher channels', () => {
  it('lists the channels of every space, and only those the user may see', async () => {
    useSpaceStore.setState({
      currentSpaceId: null,
      spaceChannelIndex: new Map([
        ['c-general', { spaceId: 's1', origin: '', type: 'text', name: 'general' }],
        ['c-secret', { spaceId: 's1', origin: '', type: 'text', name: 'secret' }],
      ]) as never,
      channelPermissions: new Map([['c-general', '2'], ['c-secret', '0']]) as never,
    });
    renderSwitcher();
    act(() => useQuickSwitcherStore.getState().setOpen(true));
    await userEvent.type(await screen.findByRole('combobox'), 'gen');
    expect(screen.getByRole('option', { name: /general/ })).toHaveTextContent('Game Night');
    expect(screen.queryByRole('option', { name: /secret/ })).toBeNull();
  });
});
