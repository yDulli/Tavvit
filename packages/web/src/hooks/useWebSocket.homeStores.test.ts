import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@backspace/shared';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';

// jsdom has no AudioWorkletNode; the handler's imports reach the voice stack.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
      playSound: vi.fn(() => Promise.resolve(null)),
    }),
  },
}));

/** A socket the real handler talks to; the test plays the server through `deliver`. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWebSocket.all.push(this); }
  send(): void {}
  close(): void { this.readyState = FakeWebSocket.CLOSED; }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  deliver(event: Record<string, unknown>): void { this.onmessage?.({ data: JSON.stringify(event) }); }
}

class InertWorker {
  onmessage: (() => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}

vi.stubGlobal('WebSocket', FakeWebSocket);
vi.stubGlobal('Worker', InertWorker);
vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:heartbeat', revokeObjectURL: () => {} }));

const { connectInstance, disconnectInstance } = await import('./useWebSocket');
const { useAuthStore } = await import('../stores/authStore');
const { useBlockStore } = await import('../stores/blockStore');
const { useEmojiStore } = await import('../stores/emojiStore');

const REMOTE = 'https://nova.example';
const opened: string[] = [];

function socketFor(origin: string): FakeWebSocket {
  connectInstance(origin, `token-${origin || 'home'}`);
  opened.push(origin);
  const ws = FakeWebSocket.all.at(-1)!;
  ws.open();
  return ws;
}

function readyFor(id: string): Record<string, unknown> {
  const readyUser = {
    id, username: id, displayName: null, avatar: null, banner: null, accentColor: null, avatarColor: null,
    bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1,
    homeInstance: null, homeUserId: null, replicatedInstances: [],
  } as unknown as User;
  return { type: 'ready', user: readyUser, spaces: [], dmChannels: [], readStates: [], activeCalls: [] };
}

function emoji(id: string, name: string): CustomEmoji {
  return { id, name, animated: false, createdBy: null, createdAt: 1 };
}

const loadBlocks = vi.fn(async () => undefined);
const loadEmojis = vi.fn(async () => undefined);
let realLoadBlocks: () => Promise<void>;
let realLoadEmojis: () => Promise<void>;

beforeEach(() => {
  FakeWebSocket.all = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  realLoadBlocks = useBlockStore.getState().load;
  realLoadEmojis = useEmojiStore.getState().load;
  loadBlocks.mockClear();
  loadEmojis.mockClear();
  useBlockStore.setState({ load: loadBlocks });
  useEmojiStore.setState({ load: loadEmojis });
  useAuthStore.setState({ user: { id: 'me', status: 'online' } as User });
});

afterEach(() => {
  for (const origin of opened.splice(0)) disconnectInstance(origin);
  useBlockStore.setState({ load: realLoadBlocks });
  useEmojiStore.setState({ load: realLoadEmojis });
  useBlockStore.getState().reset();
  useEmojiStore.getState().reset();
  useAuthStore.setState({ user: null, myRowIds: new Map() });
  vi.restoreAllMocks();
});

describe('what the home socket brings in when it is ready', () => {
  it('reads the block list and the emoji library', () => {
    socketFor('').deliver(readyFor('me'));
    expect(loadBlocks).toHaveBeenCalledOnce();
    expect(loadEmojis).toHaveBeenCalledOnce();
  });

  it('does not read them for another instance: they are the home instance\'s', () => {
    socketFor(REMOTE).deliver(readyFor('me-there'));
    expect(loadBlocks).not.toHaveBeenCalled();
    expect(loadEmojis).not.toHaveBeenCalled();
  });
});

describe('custom emoji events', () => {
  it('adds and replaces an emoji from the home socket', () => {
    const home = socketFor('');
    home.deliver({ type: 'emoji_upserted', emoji: emoji('11111', 'wave') });
    expect(useEmojiStore.getState().byId.get('11111')?.name).toBe('wave');
    home.deliver({ type: 'emoji_upserted', emoji: emoji('11111', 'hello') });
    expect(useEmojiStore.getState().emojis.map((e) => e.name)).toEqual(['hello']);
  });

  it('removes an emoji', () => {
    const home = socketFor('');
    home.deliver({ type: 'emoji_upserted', emoji: emoji('11111', 'wave') });
    home.deliver({ type: 'emoji_removed', emojiId: '11111' });
    expect(useEmojiStore.getState().emojis).toEqual([]);
  });

  it('ignores them from another instance, whose ids name other pictures', () => {
    const remote = socketFor(REMOTE);
    remote.deliver({ type: 'emoji_upserted', emoji: emoji('11111', 'wave') });
    expect(useEmojiStore.getState().emojis).toEqual([]);
    useEmojiStore.getState().upsert(emoji('22222', 'mine'));
    remote.deliver({ type: 'emoji_removed', emojiId: '22222' });
    expect(useEmojiStore.getState().emojis).toHaveLength(1);
  });
});

describe('block events', () => {
  it('applies the whole block list the home socket sends', () => {
    socketFor('').deliver({ type: 'blocks_updated', blockedUserIds: ['a', 'b'] });
    expect([...useBlockStore.getState().blockedIds].sort()).toEqual(['a', 'b']);
  });

  it('ignores a list from another instance: its ids name other people', () => {
    socketFor(REMOTE).deliver({ type: 'blocks_updated', blockedUserIds: ['a'] });
    expect(useBlockStore.getState().blockedIds.size).toBe(0);
  });
});
