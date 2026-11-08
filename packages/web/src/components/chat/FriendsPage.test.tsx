import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FriendsPage } from './FriendsPage';
import { useSocialStore, type TaggedFriend, type TaggedFriendRequest, type TaggedSearchResult } from '../../stores/socialStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { api as mockedApi } from '../../api/client';
pageApi.client = mockedApi;

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

// Mock the api module
// Keep the real HttpError class: describeError narrows on it when a request fails.
// `api/client` and `crossStoreResolvers` import each other, so the resolver
// module can hold the unmocked client; route the page's own origin to the
// mocked one, as `getApiForOrigin('')` does in the app.
const pageApi = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../utils/crossStoreResolvers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/crossStoreResolvers')>();
  return {
    ...actual,
    getApiForOrigin: (origin: string) => (origin ? actual.getApiForOrigin(origin) : pageApi.client),
  };
});
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    dm: {
      create: vi.fn(),
    },
    social: {
      friends: vi.fn().mockResolvedValue([]),
      requests: vi.fn().mockResolvedValue([]),
      sendRequest: vi.fn().mockResolvedValue({ success: true }),
      updateRequest: vi.fn().mockResolvedValue({ success: true }),
      cancelRequest: vi.fn().mockResolvedValue({ success: true }),
      removeFriend: vi.fn().mockResolvedValue({ success: true }),
      search: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Whether the instance federates (`GET /api/instance/info`): a handle on
// another instance can be added only where it does.
const federation = vi.hoisted(() => ({ enabled: true as boolean | null }));
vi.mock('../../hooks/useFederationEnabled', () => ({ useFederationEnabled: () => federation.enabled }));

// Mock the instanceStore (imported by socialStore)
vi.mock('../../stores/instanceStore', () => ({
  useInstanceStore: Object.assign(
    (selector: (s: { instances: unknown[]; _autoConnectDone: boolean }) => unknown) => selector({
      instances: [],
      _autoConnectDone: true,
    }),
    {
      getState: () => ({ instances: [], _autoConnectDone: true }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
}));

vi.mock('../../stores/authStore', async () => {
  const state = { user: { id: 'current-user' } };
  return (await import('../../test/authStoreMock')).authStoreMock(() => state);
});

// Mock activityStore
vi.mock('../../stores/activityStore', () => ({
  useActivityStore: Object.assign(
    (selector: (s: { userActivities: Map<string, unknown> }) => unknown) => selector({
      userActivities: new Map(),
    }),
    {
      getState: () => ({ userActivities: new Map(), reset: vi.fn() }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
  // Nobody here streams: every status dot shows the status as it is.
  useStreaming: () => false,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const makeFriend = (overrides: Partial<TaggedFriend> = {}): TaggedFriend => ({
  id: 'friend-1',
  username: 'testfriend',
  displayName: 'Test Friend',
  avatar: null,
  banner: null,
  accentColor: null,
  avatarColor: null,
  bio: null,
  status: 'online',
  customStatus: null,
  createdAt: Date.now(),
  addedAt: Date.now(),
  homeUserId: null,
  homeInstance: null,
  _instanceOrigin: '',
  ...overrides,
});

const makeRequest = (overrides: Partial<TaggedFriendRequest> = {}): TaggedFriendRequest => ({
  id: 'req-1',
  fromId: 'other-user',
  toId: 'current-user',
  status: 'pending',
  createdAt: Date.now(),
  _instanceOrigin: '',
  user: {
    id: 'other-user',
    username: 'otheruser',
    displayName: 'Other User',
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: Date.now(),
    homeInstance: null,
    homeUserId: null,
    replicatedInstances: [],
  },
  ...overrides,
});

function renderFriendsPage() {
  return render(
    <MemoryRouter>
      <FriendsPage />
    </MemoryRouter>
  );
}

const PLACEHOLDER = 'Username or user@instance';

/** Opens the Add Friend view; the field is where a name or a handle is typed. */
async function openAddFriend() {
  const user = userEvent.setup();
  renderFriendsPage();
  await user.click(screen.getByText('Add Friend'));
  return { user, input: screen.getByPlaceholderText(PLACEHOLDER) };
}

/** Longer than the add-friend lookup's 300ms debounce. */
function pastTheDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

beforeEach(() => {
  mockNavigate.mockClear();
  federation.enabled = true;
  // Reset the social store with no-op loaders (we set state directly)
  useSocialStore.setState({
    friends: [],
    requests: [],
    isLoading: false,
    error: null,
    loadFriends: vi.fn(),
    loadRequests: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue([]),
  });
  useSpaceStore.setState({
    dmChannels: [],
    findExistingDmForUser: () => null,
  });
});

describe('FriendsPage', () => {
  describe('Add Friend tab', () => {
    it('opens on the search field and lists nobody before a search', async () => {
      const mockSearchUsers = vi.fn().mockResolvedValue([]);
      useSocialStore.setState({ searchUsers: mockSearchUsers });

      await openAddFriend();

      expect(screen.getByRole('heading', { name: 'Find People' })).toBeInTheDocument();
      expect(screen.getByText(/Nobody is listed here until you search/)).toBeInTheDocument();
      expect(mockSearchUsers).not.toHaveBeenCalled();
    });

    it('shows Direct Add row and sends request for user@domain input', async () => {
      const mockSendFriendRequest = vi.fn().mockResolvedValue('req-123');
      useSocialStore.setState({
        sendFriendRequest: mockSendFriendRequest,
      });

      const { user, input } = await openAddFriend();
      await user.type(input, 'newbuddy@remote.example.com');

      // Direct Add row should appear
      expect(screen.getByText(/Send friend request to/)).toBeInTheDocument();

      // Click Send Request
      await user.click(screen.getByText('Send Request'));

      await waitFor(() => {
        expect(mockSendFriendRequest).toHaveBeenCalledWith({ username: 'newbuddy@remote.example.com' });
      });
    });

    it('offers a handle on this instance even where the instance does not federate', async () => {
      federation.enabled = false;
      const mockSendFriendRequest = vi.fn().mockResolvedValue('req-124');
      useSocialStore.setState({ sendFriendRequest: mockSendFriendRequest });
      const handle = `bob@${window.location.host}`;

      const { user, input } = await openAddFriend();
      await user.type(input, handle);

      expect(screen.getByText(/Send friend request to/)).toBeInTheDocument();
      await user.click(screen.getByText('Send Request'));
      await waitFor(() => {
        expect(mockSendFriendRequest).toHaveBeenCalledWith({ username: handle });
      });
    });

    it('says a handle on another instance cannot be added while the instance does not federate', async () => {
      federation.enabled = false;

      const { user, input } = await openAddFriend();
      await user.type(input, 'bob@remote.example.com');

      expect(screen.getByText('People on other instances cannot be added while this instance does not federate.')).toBeInTheDocument();
      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
      expect(screen.queryByText('Send Request')).not.toBeInTheDocument();
    });

    it('sends the identity of a user found on a remote instance, with the handle for older servers', async () => {
      const mockSendFriendRequest = vi.fn().mockResolvedValue('req-9');
      // A native of orbit.test as the remote's search returns it after
      // normalizeUserAssets: qualified username and home identity filled in.
      const alice: TaggedSearchResult = {
        id: 'alice-id', username: 'alice@orbit.test', displayName: 'Alice', avatar: null, avatarColor: null,
        homeUserId: 'alice-id', homeInstance: 'orbit.test', _instanceOrigin: 'https://orbit.test',
      };
      const mockSearchUsers = vi.fn().mockResolvedValue([alice]);
      useSocialStore.setState({
        friends: [],
        requests: [],
        sendFriendRequest: mockSendFriendRequest,
        searchUsers: mockSearchUsers,
      });

      const { user, input } = await openAddFriend();
      await user.type(input, 'alice');
      await user.click(await screen.findByText('Send Request'));

      await waitFor(() => {
        expect(mockSendFriendRequest).toHaveBeenCalledWith({
          username: 'alice@orbit.test',
          homeUserId: 'alice-id',
          homeInstance: 'orbit.test',
        });
      });
    });

    it('shows toast when Direct Add request fails', async () => {
      const mockSendFriendRequest = vi.fn().mockRejectedValue(new Error('User not found'));
      const mockAddToast = vi.fn();
      useSocialStore.setState({
        sendFriendRequest: mockSendFriendRequest,
      });
      useUIStore.setState({
        addToast: mockAddToast,
      });

      const { user, input } = await openAddFriend();
      await user.type(input, 'ghost@remote.example.com');
      await user.click(screen.getByText('Send Request'));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('User not found', 'warning');
      });
    });

    it('looks a plain username up instead of offering it as a handle', async () => {
      const mockSearchUsers = vi.fn().mockResolvedValue([]);
      useSocialStore.setState({ searchUsers: mockSearchUsers });

      const { user, input } = await openAddFriend();
      await user.type(input, 'marc');

      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
      await waitFor(() => {
        expect(mockSearchUsers).toHaveBeenCalledWith('marc');
      });
      expect(await screen.findByText('No users match your search.')).toBeInTheDocument();
    });

    it('searches by the name in lower case, without a leading @', async () => {
      const mockSearchUsers = vi.fn().mockResolvedValue([]);
      useSocialStore.setState({ searchUsers: mockSearchUsers });

      const { user, input } = await openAddFriend();
      await user.type(input, '@Marc');

      await waitFor(() => {
        expect(mockSearchUsers).toHaveBeenCalledWith('marc');
      });
    });

    it('asks for three characters of a username before it searches', async () => {
      const mockSearchUsers = vi.fn().mockResolvedValue([]);
      useSocialStore.setState({ searchUsers: mockSearchUsers });

      const { user, input } = await openAddFriend();
      await user.type(input, 'ma');

      expect(screen.getByText('Type at least 3 characters of a username.')).toBeInTheDocument();
      await pastTheDebounce();
      expect(mockSearchUsers).not.toHaveBeenCalled();
    });

    it('says what a username is made of instead of searching for anything else', async () => {
      const mockSearchUsers = vi.fn().mockResolvedValue([]);
      useSocialStore.setState({ searchUsers: mockSearchUsers });

      const { user, input } = await openAddFriend();
      await user.type(input, 'bob!');

      expect(screen.getByText('Usernames are made of letters, digits and underscores.')).toBeInTheDocument();
      await pastTheDebounce();
      expect(mockSearchUsers).not.toHaveBeenCalled();
    });

    it('says why a search failed', async () => {
      useSocialStore.setState({ searchUsers: vi.fn().mockRejectedValue(new Error('Too many searches. Try again in a minute.')) });

      const { user, input } = await openAddFriend();
      await user.type(input, 'bob');

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many searches. Try again in a minute.');
    });

    it('leaves the viewer out of what a search found', async () => {
      const self: TaggedSearchResult = {
        id: 'current-user', username: 'current', displayName: 'Me', avatar: null, avatarColor: null,
        homeUserId: null, homeInstance: null, _instanceOrigin: '',
      };
      useSocialStore.setState({ searchUsers: vi.fn().mockResolvedValue([self]) });

      const { user, input } = await openAddFriend();
      await user.type(input, 'current');

      expect(await screen.findByText('No users match your search.')).toBeInTheDocument();
      expect(screen.queryByText('Send Request')).not.toBeInTheDocument();
    });

    it('does not show Direct Add row for malformed @ shapes', async () => {
      const { user, input } = await openAddFriend();

      // Lone @
      await user.type(input, '@');
      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
      await user.clear(input);

      // Leading @ — only domain, no baseName
      await user.type(input, '@bob');
      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
      await user.clear(input);

      // Trailing @ — only baseName, no domain
      await user.type(input, 'bob@');
      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
    });

    describe('search results and the lists, matched by person', () => {
      // Bob is native to orbit (b-1); the page's instance holds a replicated row of him (nb).
      const bobOnOrbit = {
        id: 'b-1', username: 'bob', displayName: 'Bob', avatar: null, banner: null, accentColor: null,
        avatarColor: null, bio: null, status: 'online' as const, customStatus: null, isAdmin: false, createdAt: 0,
        homeUserId: 'b-1', homeInstance: null, replicatedInstances: [], _instanceOrigin: 'https://orbit.test',
      };
      const bobOnPage = { ...bobOnOrbit, id: 'nb', username: 'bob@orbit.test', homeInstance: 'orbit.test', _instanceOrigin: '' };
      // Bob as orbit's username search answers: only what a result carries.
      const bobFound: TaggedSearchResult = {
        id: 'b-1', username: 'bob', displayName: 'Bob', avatar: null, avatarColor: null,
        homeUserId: 'b-1', homeInstance: null, _instanceOrigin: 'https://orbit.test',
      };

      async function searchForBob() {
        const { user, input } = await openAddFriend();
        await user.type(input, 'bob');
        return user;
      }

      it("shows a friend listed only by another instance's row as a friend, with Message", async () => {
        useSocialStore.setState({
          friends: [makeFriend({ ...bobOnPage, addedAt: 0 })],
          searchUsers: vi.fn().mockResolvedValue([bobFound]),
        });
        await searchForBob();
        expect(await screen.findByText('Already friends')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument();
        expect(screen.queryByText('Send Request')).not.toBeInTheDocument();
      });

      it('accepts a request held on another instance with that instance\'s request id and row', async () => {
        const mockUpdate = vi.fn().mockResolvedValue(undefined);
        useSocialStore.setState({
          requests: [makeRequest({ id: 'r-bob-page', fromId: 'nb', toId: 'me', _instanceOrigin: '', user: bobOnPage })],
          searchUsers: vi.fn().mockResolvedValue([bobFound]),
          updateFriendRequest: mockUpdate,
        });
        const user = await searchForBob();
        expect(await screen.findByText('Wants to be your friend')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Accept' }));
        await waitFor(() => {
          expect(mockUpdate).toHaveBeenCalledWith('r-bob-page', '', 'accepted', expect.objectContaining({ id: 'nb' }));
        });
      });

      it('declines a request from its result row the same way', async () => {
        const mockUpdate = vi.fn().mockResolvedValue(undefined);
        useSocialStore.setState({
          requests: [makeRequest({ id: 'r-bob-page', fromId: 'nb', toId: 'me', _instanceOrigin: '', user: bobOnPage })],
          searchUsers: vi.fn().mockResolvedValue([bobFound]),
          updateFriendRequest: mockUpdate,
        });
        const user = await searchForBob();
        await user.click(await screen.findByRole('button', { name: 'Decline' }));
        await waitFor(() => {
          expect(mockUpdate).toHaveBeenCalledWith('r-bob-page', '', 'declined', expect.objectContaining({ id: 'nb' }));
        });
      });

      it('cancels a pending request from its result row through the store, with the row\'s person', async () => {
        const mockCancel = vi.fn().mockResolvedValue(undefined);
        useSocialStore.setState({
          requests: [makeRequest({ id: 'r-bob-orbit', fromId: 'me-orbit', toId: 'b-1', _instanceOrigin: 'https://orbit.test', user: bobOnOrbit })],
          searchUsers: vi.fn().mockResolvedValue([bobFound]),
          cancelFriendRequest: mockCancel,
        });
        const user = await searchForBob();
        expect(await screen.findByText('Request sent')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Cancel Request' }));
        await waitFor(() => {
          expect(mockCancel).toHaveBeenCalledWith('r-bob-orbit', 'https://orbit.test', expect.objectContaining({ id: 'b-1' }));
        });
        expect(mockedApi.social.cancelRequest).not.toHaveBeenCalled();
      });
    });
  });

  describe('DM button on friend item', () => {
    it('calls api.dm.create and navigates when clicking the Message button', async () => {
      const user = userEvent.setup();
      const friend = makeFriend({ id: 'friend-42', username: 'dmpal', displayName: 'DM Pal' });

      useSocialStore.setState({
        friends: [friend],
        requests: [],
      });
      useSpaceStore.getState().reset();
      useSpaceStore.setState({
        findExistingDmForUser: () => null,
      });

      // Mock the dm.create API
      const { api } = await import('../../api/client');
      (api.dm.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'dm-channel-99',
        createdAt: Date.now(),
        members: [],
      });

      renderFriendsPage();

      // Switch to "All" tab to see the friend
      await user.click(screen.getByText('All'));

      // Find the Message button by title
      const dmButton = screen.getByRole('button', { name: 'Message' });
      await user.click(dmButton);

      await waitFor(() => {
        expect(api.dm.create).toHaveBeenCalledWith({ userId: 'friend-42' });
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/channels/@me/dm-channel-99');
      });
      expect(useSpaceStore.getState().dmChannels.map(d => d.id)).toEqual(['dm-channel-99']);
    });

    it('a DM the client already shows from another instance lands in its one row', async () => {
      // REMOTE's copy of the conversation is listed; findExistingDmForUser
      // (a shortcut, not identity) does not recognise it, so the request goes
      // out. The conversation key in the answer makes it the same row.
      const key = '0'.repeat(31) + '1';
      const user = userEvent.setup();
      const friend = makeFriend({ id: 'friend-42', username: 'dmpal', displayName: 'DM Pal' });
      useSocialStore.setState({ friends: [friend], requests: [] });
      useSpaceStore.getState().reset();
      useSpaceStore.setState({ findExistingDmForUser: () => null });
      useSpaceStore.getState().populateFromReady('https://remote.example', [], [], [
        { id: 'dm-remote-copy', federatedId: key, createdAt: 1, members: [] },
      ]);
      const { api } = await import('../../api/client');
      (api.dm.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'dm-home-copy', federatedId: key, createdAt: 2, members: [],
      });

      renderFriendsPage();
      await user.click(screen.getByText('All'));
      await user.click(screen.getByRole('button', { name: 'Message' }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/channels/@me/dm-home-copy');
      });
      expect(useSpaceStore.getState().dmChannels.map(d => d.id)).toEqual(['dm-home-copy']);
    });
  });

  describe('Friend names', () => {
    it('names a friend with an empty display name by their username', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [makeFriend({ username: 'dmpal@orbit.test', displayName: '' })], requests: [] });
      renderFriendsPage();
      await user.click(screen.getByText('All'));
      expect(screen.getByText('dmpal')).toBeInTheDocument();
    });
  });

  describe('Message button failure', () => {
    it('tells the user why opening the DM failed', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [makeFriend({ id: 'friend-7' })], requests: [] });
      const addToast = vi.fn();
      useUIStore.setState({ addToast });
      const { api, HttpError } = await import('../../api/client');
      (api.dm.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new HttpError(404, 'User not found', null, 'user_not_found'));

      renderFriendsPage();
      await user.click(screen.getByText('All'));
      await user.click(screen.getByRole('button', { name: 'Message' }));

      await waitFor(() => expect(addToast).toHaveBeenCalledWith('Could not open the conversation: No user with that name was found.', 'warning'));
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Cancel outgoing friend request', () => {
    it('calls cancelFriendRequest when clicking cancel on an outgoing request', async () => {
      const user = userEvent.setup();
      const mockCancel = vi.fn().mockResolvedValue(undefined);

      // Outgoing request: user.id === toId means current user sent it (fromId is current user, user is the recipient)
      const outgoingRequest = makeRequest({
        id: 'req-out-1',
        fromId: 'current-user',
        toId: 'other-user',
        user: {
          id: 'other-user',
          username: 'recipient',
          displayName: 'Recipient',
          avatar: null,
          banner: null,
          accentColor: null,
          avatarColor: null,
          bio: null,
          status: 'online',
          customStatus: null,
          isAdmin: false,
          createdAt: Date.now(),
          homeInstance: null,
          homeUserId: null,
          replicatedInstances: [],
        },
      });

      useSocialStore.setState({
        friends: [],
        requests: [outgoingRequest],
        cancelFriendRequest: mockCancel,
      });

      renderFriendsPage();

      // Switch to Pending tab
      await user.click(screen.getByText('Pending'));

      // Should see the outgoing request
      expect(screen.getByText('Outgoing Friend Request')).toBeInTheDocument();

      // Click the cancel button
      const cancelButton = screen.getByRole('button', { name: 'Cancel Request' });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(mockCancel).toHaveBeenCalledWith('req-out-1', '');
      });
    });
  });

  describe('Accept/Decline incoming friend request', () => {
    it('calls updateFriendRequest with "accepted" when clicking accept', async () => {
      const user = userEvent.setup();
      const mockUpdate = vi.fn().mockResolvedValue(undefined);

      const incomingRequest = makeRequest({
        id: 'req-in-1',
        _instanceOrigin: 'https://orbit.test',
        fromId: 'sender-id',
        toId: 'current-user',
        user: {
          id: 'sender-id',
          username: 'sender',
          displayName: 'Sender',
          avatar: null,
          banner: null,
          accentColor: null,
          avatarColor: null,
          bio: null,
          status: 'online',
          customStatus: null,
          isAdmin: false,
          createdAt: Date.now(),
          homeInstance: null,
          homeUserId: null,
          replicatedInstances: [],
        },
      });

      useSocialStore.setState({
        friends: [],
        requests: [incomingRequest],
        updateFriendRequest: mockUpdate,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Pending'));

      expect(screen.getByText('Incoming Friend Request')).toBeInTheDocument();

      const acceptButton = screen.getByRole('button', { name: 'Accept' });
      await user.click(acceptButton);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('req-in-1', 'https://orbit.test', 'accepted');
      });
    });

    it('calls updateFriendRequest with "declined" when clicking decline', async () => {
      const user = userEvent.setup();
      const mockUpdate = vi.fn().mockResolvedValue(undefined);

      const incomingRequest = makeRequest({
        id: 'req-in-2',
        fromId: 'sender-id',
        toId: 'current-user',
        user: {
          id: 'sender-id',
          username: 'sender2',
          displayName: 'Sender 2',
          avatar: null,
          banner: null,
          accentColor: null,
          avatarColor: null,
          bio: null,
          status: 'online',
          customStatus: null,
          isAdmin: false,
          createdAt: Date.now(),
          homeInstance: null,
          homeUserId: null,
          replicatedInstances: [],
        },
      });

      useSocialStore.setState({
        friends: [],
        requests: [incomingRequest],
        updateFriendRequest: mockUpdate,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Pending'));

      const declineButton = screen.getByRole('button', { name: 'Decline' });
      await user.click(declineButton);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('req-in-2', '', 'declined');
      });
    });
  });

  describe('Empty state mascot messages', () => {
    it('shows "No one\'s online right now." in online tab when no friends online', () => {
      useSocialStore.setState({ friends: [], requests: [] });
      renderFriendsPage();

      expect(screen.getByText("No one's online right now.")).toBeInTheDocument();
      expect(screen.queryByText(/Wumpus/)).not.toBeInTheDocument();
    });

    it('shows "No friends yet — add someone!" in all tab when no friends', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [], requests: [] });
      renderFriendsPage();

      await user.click(screen.getByText('All'));

      expect(screen.getByText('No friends yet — add someone!')).toBeInTheDocument();
      expect(screen.queryByText(/Wumpus/)).not.toBeInTheDocument();
    });

    it('shows "No pending requests — Nori is napping." in pending tab when empty', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [], requests: [] });
      renderFriendsPage();

      await user.click(screen.getByText('Pending'));

      expect(screen.getByText('No pending requests — Nori is napping.')).toBeInTheDocument();
      expect(screen.queryByText(/Wumpus/)).not.toBeInTheDocument();
    });
  });
});
