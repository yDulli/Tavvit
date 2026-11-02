import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DmChannel, User } from '@backspace/shared';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

const markConversationRead = vi.hoisted(() => vi.fn<(channelId: string) => Promise<boolean>>());
vi.mock('../../utils/markConversationRead', () => ({ markConversationRead }));

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useInboxStore } from '../../stores/inboxStore';
import { useNotificationSettingsStore } from '../../stores/notificationSettingsStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useUnreadCountStore } from '../../stores/unreadCountStore';
import { InboxPage } from './InboxPage';

function user(id: string, name: string): User {
  return {
    id, username: name.toLowerCase(), displayName: name, avatar: null, banner: null, accentColor: null,
    avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 0,
    homeInstance: null, homeUserId: null, replicatedInstances: [],
  };
}

const me = user('me', 'Maxi');
const amy = user('a', 'Amy');

function dm(id: string, other: User, text: string, at: number): DmChannel {
  return {
    id, federatedId: null, ownerId: null, ownerHomeUserId: null, ownerHomeInstance: null, createdAt: at,
    members: [me, other], name: null, icon: null, metadataUpdatedAt: 0,
    lastMessage: { id: `m-${id}`, dmChannelId: id, userId: other.id, content: text, createdAt: at },
  } as unknown as DmChannel;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={['/inbox']}>
      <InboxPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function mention(id: string, channelId: string, content: string, via: 'user' | 'role' | 'everyone' = 'user') {
  return {
    spaceId: 'space-1', channelId, via,
    message: { id, channelId, userId: 'a', content, createdAt: Number(id), user: amy, attachments: [], embeds: [] } as never,
  };
}

beforeEach(() => {
  markConversationRead.mockReset().mockResolvedValue(true);
  useAuthStore.setState({ user: me });
  useChatStore.setState({ currentChannelId: null, unreadChannels: new Set(), readStates: new Map() });
  useUnreadCountStore.setState({ counts: {} });
  useNotificationSettingsStore.getState().reset();
  useInboxStore.getState().reset();
  useUIStore.setState({ toasts: [] });
  useSpaceStore.setState({
    spaces: [{ id: 'space-1', name: 'Game Night', icon: null, _instanceOrigin: '' } as never],
    dmChannels: [dm('dm-1', amy, 'are you coming?', 20)],
    spaceChannelIndex: new Map([
      ['text-1', { spaceId: 'space-1', origin: '', type: 'text' as const, name: 'plans' }],
      ['voice-1', { spaceId: 'space-1', origin: '', type: 'voice' as const, name: 'lounge' }],
    ]),
    channelToSpaceMap: new Map([['text-1', 'space-1'], ['voice-1', 'space-1']]),
    channelOriginMap: new Map(),
  });
});

afterEach(cleanup);

describe('InboxPage unread', () => {
  it('lists unread DMs and channels with their counts, grouped by space, and never a voice channel', () => {
    useChatStore.setState({ unreadChannels: new Set(['dm-1', 'text-1', 'voice-1']) });
    useUnreadCountStore.setState({ counts: { '': { 'text-1': 4 } } });
    renderInbox();
    expect(screen.getByRole('region', { name: 'Direct messages' })).toHaveTextContent('Amy');
    const spaces = screen.getByRole('region', { name: 'Spaces' });
    expect(spaces).toHaveTextContent('Game Night');
    expect(within(spaces).getByText('plans')).toBeInTheDocument();
    expect(within(spaces).getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('lounge')).toBeNull();
  });

  it('opens a conversation, and marks one read without opening it', async () => {
    useChatStore.setState({ unreadChannels: new Set(['text-1']) });
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(markConversationRead).toHaveBeenCalledWith('text-1'));
    expect(screen.getByTestId('location')).toHaveTextContent('/inbox');
    fireEvent.click(screen.getByText('plans'));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/space-1/text-1');
  });

  it('marks everything read, and says so when one could not be', async () => {
    useChatStore.setState({ unreadChannels: new Set(['dm-1', 'text-1']) });
    markConversationRead.mockImplementation(async (id) => id !== 'dm-1');
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: /Mark all as read/ }));
    await waitFor(() => expect(markConversationRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useUIStore.getState().toasts.map((toast) => toast.message)).toContain('Could not mark it as read. Try again.'));
  });

  it('leaves a muted channel out and says how many were left out', () => {
    useChatStore.setState({ unreadChannels: new Set(['text-1']) });
    useNotificationSettingsStore.getState().apply('', {
      spaceId: 'space-1', channelId: null, level: null, muted: true, mutedUntil: null, suppressEveryone: false, suppressRoles: false, updatedAt: 1,
    });
    renderInbox();
    expect(screen.queryByText('plans')).toBeNull();
    expect(screen.getByText(/Nothing new, except in 1 muted channel/)).toBeInTheDocument();
  });
});

describe('InboxPage mentions', () => {
  it('shows mentions newest first, marks the unseen ones, and opens one at its message', () => {
    useChatStore.setState({ readStates: new Map([['text-1', '150']]) });
    useInboxStore.setState({
      byOrigin: { '': { status: 'ready', nextBefore: null, loadingMore: false, items: [mention('200', 'text-1', 'hi <@me>'), mention('100', 'text-1', '@everyone old', 'everyone')] } },
    });
    renderInbox();
    fireEvent.click(screen.getByRole('tab', { name: /Mentions/ }));
    const tab = screen.getByRole('tab', { name: /Mentions/ });
    expect(tab).toHaveTextContent('1');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Game Night › #plans');
    expect(items[1]).toHaveTextContent('everyone');
    expect(within(items[0]!).getByRole('button', { name: 'Mark the channel as read' })).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button', { name: 'Mark the channel as read' })).toBeNull();
    fireEvent.click(within(items[0]!).getByText('Amy'));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/space-1/text-1?message=200');
  });

  it('offers older mentions and a retry when an instance could not answer', () => {
    const loadMore = vi.fn();
    const loadOrigin = vi.fn();
    useInboxStore.setState({
      byOrigin: {
        '': { status: 'ready', nextBefore: '100', loadingMore: false, items: [mention('200', 'text-1', 'hi <@me>')] },
        'https://elsewhere.test': { status: 'failed', nextBefore: null, loadingMore: false, items: [] },
      },
      loadMore,
      loadOrigin,
    });
    renderInbox();
    fireEvent.click(screen.getByRole('tab', { name: /Mentions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(loadMore).toHaveBeenCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(loadOrigin).toHaveBeenCalledWith('https://elsewhere.test');
  });

  it('says plainly when there are none', () => {
    useInboxStore.setState({ byOrigin: { '': { status: 'ready', nextBefore: null, loadingMore: false, items: [] } } });
    renderInbox();
    fireEvent.click(screen.getByRole('tab', { name: /Mentions/ }));
    expect(screen.getByText('No mentions yet')).toBeInTheDocument();
  });
});
