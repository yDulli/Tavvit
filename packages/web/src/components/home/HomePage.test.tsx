import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DmChannel, FriendRequest, Space, User } from '@backspace/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via the stores.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

// The page reads the home instance's name from the shared info hook.
vi.mock('../../hooks/useHomeInstanceInfo', () => ({
  useHomeInstanceInfo: () => ({ name: 'Friend Club' }),
}));

// Joining voice opens a LiveKit connection; the page only has to ask for it.
const joinVoiceChannel = vi.hoisted(() => vi.fn());
vi.mock('../../utils/voice', () => ({ joinVoiceChannel }));

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSocialStore, type TaggedFriend, type TaggedFriendRequest } from '../../stores/socialStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { HomePage } from './HomePage';
import { useRecentPlacesStore } from '../../stores/recentPlacesStore';
import { useInboxStore } from '../../stores/inboxStore';

function user(id: string, name: string): User {
  return {
    id, username: name.toLowerCase(), displayName: name, avatar: null, banner: null, accentColor: null,
    avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 0,
    homeInstance: null, homeUserId: null, replicatedInstances: [],
  };
}

function friend(id: string, name: string, status: TaggedFriend['status'] = 'online'): TaggedFriend {
  return {
    id, username: name.toLowerCase(), displayName: name, avatar: null, banner: null, accentColor: null,
    avatarColor: null, bio: null, status, customStatus: null, createdAt: 0, addedAt: 0,
    homeUserId: null, homeInstance: null, _instanceOrigin: '',
  };
}

function space(id: string, name: string): Space {
  return {
    id, name, icon: null, banner: null, avatarColor: null, ownerId: 'x', ownerTitle: null, inviteCode: null,
    visibility: 'private', directoryListed: false, description: null, createdAt: 0,
  } as unknown as Space;
}

function dm(id: string, other: User, text: string, at: number): DmChannel {
  return {
    id, federatedId: null, ownerId: null, ownerHomeUserId: null, ownerHomeInstance: null, createdAt: at,
    members: [me, other], name: null, icon: null, metadataUpdatedAt: 0,
    lastMessage: { id: `m-${id}`, dmChannelId: id, userId: other.id, content: text, createdAt: at },
  } as unknown as DmChannel;
}

const me = user('me', 'Maxi');

/** Where the page sent the user: the path and, for the Friends page's views, the query. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderHome(now = new Date(2026, 0, 5, 20, 0)) {
  return render(
    <MemoryRouter initialEntries={['/channels/@me']}>
      <HomePage now={now} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  joinVoiceChannel.mockReset();
  useAuthStore.setState({ user: me });
  useChatStore.setState({ currentChannelId: null, unreadChannels: new Set() });
  useSocialStore.setState({
    friends: [],
    requests: [],
    loadFriends: vi.fn().mockResolvedValue(undefined),
    loadRequests: vi.fn().mockResolvedValue(undefined),
  });
  useSpaceStore.setState({ spaces: [], dmChannels: [], spaceChannelIndex: new Map() });
  useVoiceStore.setState({ voiceUsers: new Map() });
  useUIStore.setState({ activeModal: null });
  useRecentPlacesStore.setState({ byUser: {} });
  useInboxStore.getState().reset();
});

afterEach(cleanup);

describe('HomePage header', () => {
  it.each([
    [new Date(2026, 0, 5, 8), 'Good morning, Maxi'],
    [new Date(2026, 0, 5, 14), 'Good afternoon, Maxi'],
    [new Date(2026, 0, 5, 20), 'Good evening, Maxi'],
    [new Date(2026, 0, 5, 2), 'Still up, Maxi?'],
  ])('greets for the time of day (%s)', (now, text) => {
    renderHome(now);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(text);
  });

  it('counts the friends who are online next to the instance name', () => {
    useSocialStore.setState({ friends: [friend('a', 'Amy'), friend('b', 'Ben'), friend('c', 'Cleo', 'offline')] });
    renderHome();
    expect(screen.getByText('Friend Club · Friends online: 2')).toBeInTheDocument();
  });

  it('says so when nobody is online', () => {
    useSocialStore.setState({ friends: [friend('c', 'Cleo', 'offline')] });
    renderHome();
    expect(screen.getByText('Friend Club · No friends online right now')).toBeInTheDocument();
  });

  // The search is the top bar's: Home keeps no second one beside it.
  it('has no search field of its own', () => {
    useSocialStore.setState({ friends: [friend('a', 'Amy')] });
    renderHome();
    expect(screen.getByRole('button', { name: /New message/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /jump to a conversation|search/i })).toBeNull();
  });

  it('offers the quick actions once there is something to show', () => {
    useSocialStore.setState({ friends: [friend('a', 'Amy')] });
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'New message' }));
    expect(useUIStore.getState().activeModal).toBe('newDm');
    fireEvent.click(screen.getByRole('button', { name: 'Join space' }));
    expect(useUIStore.getState().activeModal).toBe('joinSpace');
  });
});

describe('HomePage for a brand-new account', () => {
  it('explains how to get started and opens the Add Friend view', () => {
    renderHome();
    expect(screen.getByText('Your people will show up here')).toBeInTheDocument();
    // The steps stand in for the quick actions, which would only repeat them.
    expect(screen.queryByRole('button', { name: 'New message' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add a friend' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/friends?view=add');
  });

  it('opens the create-space and join dialogs from the first steps', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Create a space' }));
    expect(useUIStore.getState().activeModal).toBe('createSpace');
    fireEvent.click(screen.getByRole('button', { name: 'Join with invite' }));
    expect(useUIStore.getState().activeModal).toBe('joinSpace');
  });

  it('does not show the first steps once there is anything to show', () => {
    useSocialStore.setState({ friends: [friend('a', 'Amy')] });
    renderHome();
    expect(screen.queryByText('Your people will show up here')).toBeNull();
  });
});

describe('HomePage voice section', () => {
  beforeEach(() => {
    useSocialStore.setState({ friends: [friend('a', 'Amy'), friend('b', 'Ben'), friend('c', 'Cleo')] });
    useSpaceStore.setState({
      spaces: [space('space-1', 'Game Night')],
      spaceChannelIndex: new Map([['voice-1', { spaceId: 'space-1', origin: '', type: 'voice' as const, name: 'lounge' }]]),
    });
    useVoiceStore.setState({ voiceUsers: new Map([['voice-1', ['a', 'b']]]) });
  });

  it('names the voice channel and its space, and says in words who is in voice', () => {
    renderHome();
    const section = screen.getByRole('region', { name: 'In voice' });
    expect(within(section).getByText('lounge')).toBeInTheDocument();
    expect(within(section).getByText('in Game Night')).toBeInTheDocument();
    const online = screen.getByRole('region', { name: 'Online now' });
    const amy = within(online).getByText('Amy').closest('li')!;
    expect(within(amy).getByText('In voice · Game Night')).toBeInTheDocument();
    const cleo = within(online).getByText('Cleo').closest('li')!;
    expect(within(cleo).getByText('Online')).toBeInTheDocument();
  });

  it('marks the space whose voice channel has friends in it', () => {
    renderHome();
    const spaces = screen.getByRole('region', { name: 'Your spaces' });
    expect(within(spaces).getByText('2 friends in voice')).toBeInTheDocument();
  });

  it('joins the channel and shows it when Join is pressed', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Join voice in Game Night' }));
    expect(joinVoiceChannel).toHaveBeenCalledWith('voice-1', undefined);
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/space-1/voice-1');
  });

  it('leaves the section out when nobody is on voice', () => {
    useVoiceStore.setState({ voiceUsers: new Map() });
    renderHome();
    expect(screen.queryByRole('region', { name: 'In voice' })).toBeNull();
  });
});

describe('HomePage online friends', () => {
  it('lists only the friends who are online', () => {
    useSocialStore.setState({ friends: [friend('a', 'Amy'), friend('c', 'Cleo', 'offline')] });
    renderHome();
    const online = screen.getByRole('region', { name: 'Online now' });
    expect(within(online).getByText('Amy')).toBeInTheDocument();
    expect(within(online).queryByText('Cleo')).toBeNull();
  });

  it('says how many are offline when nobody is online, and offers to add friends', () => {
    useSocialStore.setState({ friends: [friend('b', 'Ben', 'offline'), friend('c', 'Cleo', 'offline')] });
    renderHome();
    const online = screen.getByRole('region', { name: 'Online now' });
    expect(within(online).getByText('Nobody is online')).toBeInTheDocument();
    expect(within(online).getByText('2 friends are offline right now.')).toBeInTheDocument();

    fireEvent.click(within(online).getByRole('button', { name: 'Add friend' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/friends?view=add');
  });

  it('says there are no friends yet to someone who only has spaces', () => {
    useSpaceStore.setState({ spaces: [space('space-1', 'Game Night')] });
    renderHome();
    const online = screen.getByRole('region', { name: 'Online now' });
    expect(within(online).getByText('No friends yet')).toBeInTheDocument();
  });
});

describe('HomePage messages', () => {
  const amy = user('a', 'Amy');
  const ben = user('b', 'Ben');

  beforeEach(() => {
    useSocialStore.setState({ friends: [friend('a', 'Amy')] });
    useSpaceStore.setState({
      dmChannels: [dm('dm-1', amy, 'are you coming?', 20), dm('dm-2', ben, 'old news', 10)],
    });
  });

  it('lists the conversations with something unread and opens one on click', () => {
    useChatStore.setState({ unreadChannels: new Set(['dm-1']) });
    renderHome();
    const section = screen.getByRole('region', { name: 'Needs your attention' });
    expect(within(section).getByText('Amy')).toBeInTheDocument();
    expect(within(section).getByText('are you coming?')).toBeInTheDocument();
    expect(within(section).queryByText('Ben')).toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: /Amy/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/@me/dm-1');
  });

  it('does not offer an unread conversation again under recent conversations', () => {
    useChatStore.setState({ unreadChannels: new Set(['dm-1']) });
    renderHome();
    const recent = screen.getByRole('region', { name: 'Recent conversations' });
    expect(within(recent).getByText('Ben')).toBeInTheDocument();
    expect(within(recent).queryByText('Amy')).toBeNull();
  });

  it('says the user is caught up when nothing is unread', () => {
    renderHome();
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });
});

describe('HomePage friend requests', () => {
  function request(id: string, fromId: string, toId: string, other: User): TaggedFriendRequest {
    return { id, fromId, toId, status: 'pending', createdAt: 0, user: other, _instanceOrigin: '' } as unknown as TaggedFriendRequest;
  }

  it('shows how many requests wait for an answer, only incoming ones, and opens them', () => {
    const amy = user('a', 'Amy');
    const ben = user('b', 'Ben');
    useSocialStore.setState({
      friends: [friend('z', 'Zed')],
      requests: [
        request('r1', 'a', 'me', amy),
        // outgoing: the other party is the recipient
        request('r2', 'me', 'b', ben),
      ] as unknown as FriendRequest[] as TaggedFriendRequest[],
    });
    renderHome();
    const section = screen.getByRole('region', { name: 'Friend requests' });
    expect(within(section).getByText('Waiting for your answer: 1')).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: 'Review' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/friends?view=pending');
  });

  it('leaves the section out when there are none', () => {
    useSocialStore.setState({ friends: [friend('z', 'Zed')] });
    renderHome();
    expect(screen.queryByRole('region', { name: 'Friend requests' })).toBeNull();
  });
});

describe('HomePage spaces', () => {
  it('lists the spaces and opens one on click', () => {
    useSpaceStore.setState({ spaces: [space('space-1', 'Game Night'), space('space-2', 'Book Club')] });
    renderHome();
    const section = screen.getByRole('region', { name: 'Your spaces' });
    expect(within(section).getByText('Book Club')).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: /Game Night/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/space-1');
  });

  it('offers to create or join a space while there are few', () => {
    useSocialStore.setState({ friends: [friend('z', 'Zed')] });
    renderHome();
    const section = screen.getByRole('region', { name: 'Your spaces' });
    fireEvent.click(within(section).getByRole('button', { name: 'Join with invite' }));
    expect(useUIStore.getState().activeModal).toBe('joinSpace');
  });

  it('stops offering it once there are three spaces', () => {
    useSpaceStore.setState({ spaces: [space('space-1', 'Game Night'), space('space-2', 'Book Club'), space('space-3', 'Climbing')] });
    renderHome();
    const section = screen.getByRole('region', { name: 'Your spaces' });
    expect(within(section).queryByRole('button', { name: 'Join with invite' })).toBeNull();
  });
});

describe('HomePage recent conversations', () => {
  const amy = user('a', 'Amy');

  it('offers the conversations opened last on this device, newest first, and only ones that still exist', () => {
    useSpaceStore.setState({
      spaces: [space('space-1', 'Game Night')],
      dmChannels: [dm('dm-1', amy, 'see you', 20)],
      spaceChannelIndex: new Map([['text-1', { spaceId: 'space-1', origin: '', type: 'text' as const, name: 'plans' }]]),
    });
    useRecentPlacesStore.setState({
      byUser: {
        me: [
          { channelId: 'text-1', spaceId: 'space-1', at: 30 },
          { channelId: 'gone', spaceId: 'space-9', at: 25 },
          { channelId: 'dm-1', spaceId: null, at: 20 },
        ],
      },
    });
    renderHome();
    const section = screen.getByRole('region', { name: 'Recent conversations' });
    const rows = within(section).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('plans'), expect.stringContaining('Amy')]);
    fireEvent.click(rows[0]!);
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/space-1/text-1');
  });

  it('falls back to the latest conversations on a device with no visits yet', () => {
    useSpaceStore.setState({ dmChannels: [dm('dm-1', amy, 'see you', 20)] });
    renderHome();
    const section = screen.getByRole('region', { name: 'Recent conversations' });
    expect(within(section).getByText('see you')).toBeInTheDocument();
  });
});

describe('HomePage mentions', () => {
  it('puts an unread mention first among what needs attention, opens it at the message and marks its space', () => {
    const amy = user('a', 'Amy');
    useSocialStore.setState({ friends: [friend('a', 'Amy')] });
    useSpaceStore.setState({
      spaces: [space('space-1', 'Game Night')],
      spaceChannelIndex: new Map([['text-1', { spaceId: 'space-1', origin: '', type: 'text' as const, name: 'plans' }]]),
    });
    useInboxStore.setState({
      byOrigin: {
        '': {
          status: 'ready', nextBefore: null, loadingMore: false,
          items: [{
            spaceId: 'space-1', channelId: 'text-1', via: 'user',
            message: { id: '500', channelId: 'text-1', userId: 'a', content: 'ping <@me>', createdAt: 50, user: amy, attachments: [], embeds: [] } as never,
          }],
        },
      },
    });
    renderHome();
    expect(within(screen.getByRole('region', { name: 'Your spaces' })).getByText('1 unread mention')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Needs your attention' });
    expect(within(section).getByText('Open inbox (1)')).toBeInTheDocument();
    fireEvent.click(within(section).getByText('Amy'));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/space-1/text-1?message=500');
  });
});
