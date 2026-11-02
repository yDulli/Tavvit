import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MessageWithUser, User } from '@backspace/shared';

vi.mock('../../hooks/useWebSocket', () => ({
  wsSend: vi.fn(),
  wsSendAll: vi.fn(),
}));

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const loadMessages = vi.fn();
vi.mock('../../utils/crossStoreResolvers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/crossStoreResolvers')>()),
  getApiForOrigin: () => ({
    channels: {
      messages: (...args: unknown[]) => loadMessages(...args),
      messagesAround: vi.fn(),
      messagesAfter: () => new Promise<never>(() => {}),
    },
  }),
}));

import { MessageList } from './MessageList';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { useBlockStore } from '../../stores/blockStore';
import { usePendingMessageStore } from '../../stores/pendingMessageStore';
import { ALL_PERMISSIONS, permissionsToString } from '../../utils/permissions';

const CHANNEL = 'home-chan';
const REMOTE = 'https://orbit.example';

const me = { id: 'me', username: 'jannis', displayName: 'Jannis', avatar: null, createdAt: 1 } as unknown as User;
const mira = { id: 'u-mira', username: 'mira', displayName: 'Mira', avatar: null, createdAt: 1 } as unknown as User;
const troll = { id: 'u-troll', username: 'troll', displayName: 'Troll', avatar: null, createdAt: 1 } as unknown as User;

function message(id: string, author: User, content: string): MessageWithUser {
  return {
    id, channelId: CHANNEL, userId: author.id, replyToId: null, content, editedAt: null,
    createdAt: 1_700_000_000_000 + Number(id) * 60_000, user: author, attachments: [], embeds: [], reactions: [],
  };
}

const messages = [
  message('1', mira, 'good morning'),
  message('2', troll, 'first rude thing'),
  message('3', troll, 'second rude thing'),
  message('4', mira, 'anyway'),
];

function renderList() {
  return render(
    <MemoryRouter>
      <MessageList channelId={CHANNEL} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  loadMessages.mockReset();
  loadMessages.mockResolvedValue(messages);
  useBlockStore.getState().reset();
  useBlockStore.setState({ blockedIds: new Set(['u-troll']) });
  useAuthStore.setState({ user: me, myRowIds: new Map() });
  useSpaceStore.setState({
    spaceChannelIndex: new Map([[CHANNEL, 'space-1']]),
    channelOriginMap: new Map([[CHANNEL, '']]),
    channelPermissions: new Map([[CHANNEL, permissionsToString(ALL_PERMISSIONS)]]),
    dmChannels: [],
    members: [],
  });
  useChatStore.setState({ messages: new Map([[CHANNEL, messages]]), hasMore: new Map(), scrollPositions: new Map(), readStates: new Map() });
  usePendingMessageStore.setState({ bubbles: new Map() });
});

afterEach(() => {
  vi.restoreAllMocks();
  useBlockStore.getState().reset();
  useChatStore.setState({ messages: new Map(), hasMore: new Map(), scrollPositions: new Map() });
  useSpaceStore.setState({ spaceChannelIndex: new Map(), channelOriginMap: new Map(), channelPermissions: new Map(), members: [] });
  useAuthStore.setState({ user: null, myRowIds: new Map() });
});

describe('messages from blocked people', () => {
  it('collapse to one line for the whole run, and the others stay', async () => {
    renderList();
    await screen.findByText('good morning');
    expect(screen.getByText('anyway')).toBeInTheDocument();
    expect(screen.queryByText('first rude thing')).not.toBeInTheDocument();
    expect(screen.queryByText('second rude thing')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('blocked-run')).toHaveLength(1);
    expect(screen.getByText('2 blocked messages')).toBeInTheDocument();
  });

  it('can be shown and hidden again, one run at a time', async () => {
    renderList();
    await screen.findByText('good morning');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('first rude thing')).toBeInTheDocument();
    expect(screen.getByText('second rude thing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('first rude thing')).not.toBeInTheDocument();
  });

  it('show everything when nobody is blocked', async () => {
    useBlockStore.setState({ blockedIds: new Set() });
    renderList();
    expect(await screen.findByText('first rude thing')).toBeInTheDocument();
    expect(screen.queryByTestId('blocked-run')).not.toBeInTheDocument();
  });

  it('lets a block lifted in the meantime bring the messages back at once', async () => {
    renderList();
    await screen.findByText('good morning');
    expect(screen.queryByText('first rude thing')).not.toBeInTheDocument();
    useBlockStore.setState({ blockedIds: new Set() });
    expect(await screen.findByText('first rude thing')).toBeInTheDocument();
  });

  it('are not hidden in a channel another instance hosts: its ids name other people', async () => {
    useSpaceStore.setState({ channelOriginMap: new Map([[CHANNEL, REMOTE]]) });
    renderList();
    expect(await screen.findByText('first rude thing')).toBeInTheDocument();
    expect(screen.queryByTestId('blocked-run')).not.toBeInTheDocument();
  });
});
