import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ServerEvent, User } from '@backspace/shared';
import type { WatchSession } from '@backspace/shared/src/watch';

// Watching together on a client connected to several instances: only the instance a voice channel
// lives on speaks for its call, its reactions and its line in the channel list. Another instance
// can put no video into the call and change nothing of another instance's channels.

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

/** The heartbeat runs in a Worker (jsdom has none); an inert one keeps it quiet. */
class InertWorker {
  onmessage: (() => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}

vi.stubGlobal('WebSocket', FakeWebSocket);
vi.stubGlobal('Worker', InertWorker);
vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:heartbeat', revokeObjectURL: () => {} }));

const { connectInstance, disconnectInstance } = await import('./useWebSocket');
const { useSpaceStore } = await import('../stores/spaceStore');
const { useAuthStore } = await import('../stores/authStore');
const { useVoiceStore } = await import('../stores/voiceStore');
const { useWatchStore } = await import('../stores/watchStore');

const NOVA = 'https://nova.example';
const OTHER = 'https://other.example';
const SPACE = 'space-nova';
const CALL = 'voice-nova';
const opened: string[] = [];

function me(id: string): User {
  return {
    id,
    username: id,
    displayName: null,
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 1,
    homeInstance: null,
    homeUserId: null,
    replicatedInstances: [],
  } as User;
}

function voiceChannel(id: string): Channel {
  return { id, spaceId: SPACE, name: id, type: 'voice', topic: null, position: 0, categoryId: null, createdAt: 1, myPermissions: '1' };
}

function ready(spaces: unknown[], fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'ready',
    user: me('me-there'),
    spaces,
    dmChannels: [],
    folders: [],
    spaceLayout: null,
    layoutUpdatedAt: null,
    voiceStates: {},
    voiceChannelElapsedSeconds: {},
    voiceUserStates: {},
    spaceVoiceStates: {},
    readStates: [],
    activeCalls: [],
    userActivities: {},
    rejectedPeerOrigins: [],
    awaitingApprovalPeerOrigins: [],
    activePeerOrigins: [],
    pendingApprovalCount: 0,
    ...fields,
  } satisfies Partial<Record<keyof Extract<ServerEvent, { type: 'ready' }> | 'type', unknown>>;
}

const novaSpace = {
  id: SPACE,
  name: 'Nova space',
  icon: null,
  ownerId: 'owner',
  inviteCode: 'x',
  visibility: 'private',
  createdAt: 1,
  channels: [voiceChannel(CALL)],
  categories: [],
  members: [],
  myPermissions: '1',
};

function session(title: string): WatchSession {
  return {
    channelId: CALL,
    spaceId: SPACE,
    current: { id: 'item-1', provider: 'file', ref: 'https://media.example/a.mp4', startMs: 0, url: 'https://media.example/a.mp4', title },
    queue: [],
    playing: true,
    positionMs: 0,
    stateAt: Date.now(),
    control: 'everyone',
    starterId: 'lena',
  };
}

function socketFor(origin: string): FakeWebSocket {
  connectInstance(origin, `token-${origin}`);
  opened.push(origin);
  const ws = FakeWebSocket.all.at(-1)!;
  ws.open();
  return ws;
}

const presenceOfCall = () => useWatchStore.getState().presence.get(CALL)?.title;

beforeEach(() => {
  FakeWebSocket.all = [];
  useSpaceStore.getState().reset();
  useWatchStore.setState({ sessions: new Map(), presence: new Map(), reactions: [], slot: null, videoHiddenFor: null });
  useVoiceStore.setState({ currentVoiceChannelId: null });
  useAuthStore.setState({ user: me('me'), trueHomeStatus: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  for (const origin of opened.splice(0)) disconnectInstance(origin);
  useAuthStore.setState({ user: null, trueHomeStatus: null });
  useVoiceStore.setState({ currentVoiceChannelId: null });
  vi.restoreAllMocks();
});

describe('watching together across instances', () => {
  it('takes the channel list\'s line only from the instance the channel lives on', () => {
    const nova = socketFor(NOVA);
    nova.deliver(ready([novaSpace], { watching: { [CALL]: { title: 'Night sky', provider: 'youtube' } } }));
    expect(presenceOfCall()).toBe('Night sky');

    const other = socketFor(OTHER);
    other.deliver(ready([], { watching: { [CALL]: { title: 'Spoofed', provider: 'file' } } }));
    expect(presenceOfCall()).toBe('Night sky');

    other.deliver({ type: 'watch_presence', spaceId: SPACE, channelId: CALL, presence: null });
    other.deliver({
      type: 'space_voice_state', spaceId: SPACE,
      voiceStates: {}, voiceChannelElapsedSeconds: {}, voiceUserStates: {}, spaceVoiceStates: {}, watching: {},
    });
    expect(presenceOfCall()).toBe('Night sky');

    nova.deliver({ type: 'watch_presence', spaceId: SPACE, channelId: CALL, presence: { title: 'Morning', provider: 'vimeo' } });
    expect(presenceOfCall()).toBe('Morning');
  });

  it('follows the call\'s session and reactions only from the instance the call lives on', () => {
    const nova = socketFor(NOVA);
    nova.deliver(ready([novaSpace]));
    const other = socketFor(OTHER);
    other.deliver(ready([]));
    useVoiceStore.setState({ currentVoiceChannelId: CALL });

    other.deliver({ type: 'watch_state', channelId: CALL, session: session('Spoofed'), serverNow: Date.now() });
    other.deliver({ type: 'watch_reaction', channelId: CALL, reaction: '🔥' });
    other.deliver({ type: 'watch_position', channelId: CALL, position: { itemId: 'item-1', playing: false, positionMs: 1, stateAt: 1 }, serverNow: Date.now() });
    expect(useWatchStore.getState().sessions.has(CALL)).toBe(false);
    expect(useWatchStore.getState().reactions).toEqual([]);

    nova.deliver({ type: 'watch_state', channelId: CALL, session: session('Night sky'), serverNow: Date.now() });
    nova.deliver({ type: 'watch_reaction', channelId: CALL, reaction: '🔥' });
    expect(useWatchStore.getState().sessions.get(CALL)?.session.current?.title).toBe('Night sky');
    expect(useWatchStore.getState().reactions).toHaveLength(1);

    other.deliver({ type: 'watch_position', channelId: CALL, position: { itemId: 'item-1', playing: false, positionMs: 7_000, stateAt: 1 }, serverNow: Date.now() });
    expect(useWatchStore.getState().sessions.get(CALL)?.session.playing).toBe(true);
    nova.deliver({ type: 'watch_position', channelId: CALL, position: { itemId: 'item-1', playing: false, positionMs: 7_000, stateAt: 1 }, serverNow: Date.now() });
    expect(useWatchStore.getState().sessions.get(CALL)?.session).toMatchObject({ playing: false, positionMs: 7_000 });
  });
});

describe('what another instance says about channels', () => {
  it('cannot move a channel of one instance to another by naming its id', () => {
    const nova = socketFor(NOVA);
    nova.deliver(ready([novaSpace]));
    const other = socketFor(OTHER);
    other.deliver(ready([]));
    other.deliver({ type: 'channel_updated', spaceId: SPACE, channel: voiceChannel(CALL) });
    other.deliver({ type: 'channel_created', spaceId: SPACE, channel: voiceChannel(CALL) });
    expect(useSpaceStore.getState().channelOriginMap.get(CALL)).toBe(NOVA);
    other.deliver({ type: 'channel_deleted', channelId: CALL, spaceId: SPACE });
    expect(useSpaceStore.getState().channelOriginMap.get(CALL)).toBe(NOVA);
    // Its own instance may.
    nova.deliver({ type: 'channel_deleted', channelId: CALL, spaceId: SPACE });
    expect(useSpaceStore.getState().channelOriginMap.has(CALL)).toBe(false);
  });

  it('drops a session that is not one as a server sends them', () => {
    const nova = socketFor(NOVA);
    nova.deliver(ready([novaSpace]));
    useVoiceStore.setState({ currentVoiceChannelId: CALL });
    const odd = session('Odd');
    nova.deliver({ type: 'watch_state', channelId: CALL, session: { ...odd, current: { ...odd.current, provider: 'elsewhere' } }, serverNow: Date.now() });
    expect(useWatchStore.getState().sessions.has(CALL)).toBe(false);
  });
});
