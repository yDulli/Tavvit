import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageWithUser, ServerEvent, User } from '@backspace/shared';

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

/** The LiveKit room this tab holds, as `useLiveKit` reports it; none unless a test gives one. */
const liveKit = vi.hoisted(() => ({ room: null as { state: string; disconnect: () => void } | null }));
vi.mock('./useLiveKit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useLiveKit')>()),
  getActiveRoom: () => liveKit.room,
}));

/**
 * A socket the real handler talks to. `connectInstance` opens one per origin;
 * the test plays the server by feeding events through `onmessage` and reads
 * what the client sent from `sent`.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWebSocket.all.push(this); }
  send(data: string): void { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(): void { this.readyState = FakeWebSocket.CLOSED; }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  deliver(event: Record<string, unknown>): void { this.onmessage?.({ data: JSON.stringify(event) }); }
  statusSends(): unknown[] {
    return this.sent.filter((e) => e.type === 'presence_update').map((e) => e.status);
  }
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
const { useAuthStore } = await import('../stores/authStore');
const { useChatStore } = await import('../stores/chatStore');
const { useSpaceStore } = await import('../stores/spaceStore');
const { useVoiceStore } = await import('../stores/voiceStore');

function user(fields: Partial<User> & Pick<User, 'id'>): User {
  return {
    username: fields.id,
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
    ...fields,
  } as User;
}

function ready(readyUser: User, spaces: unknown[] = []): Record<string, unknown> {
  return {
    type: 'ready',
    user: readyUser,
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
  } satisfies Partial<Record<keyof Extract<ServerEvent, { type: 'ready' }> | 'type', unknown>>;
}

const jannis = user({ id: 'jannis' });
const DM = 'dm-1';
const cached = [{ id: '41', channelId: '', userId: 'u-bob', content: 'hello' }] as unknown as MessageWithUser[];
const loadMessages = vi.fn(() => Promise.resolve(true));

function homeSocket(): FakeWebSocket {
  connectInstance('', 'token-home');
  const ws = FakeWebSocket.all.at(-1)!;
  ws.open();
  return ws;
}

const REMOTE = 'https://orbit.example';
const REMOTE_SPACE = 'space-orbit';
const REMOTE_CHANNEL = 'chan-orbit';
const remoteCached = [{ id: '77', channelId: REMOTE_CHANNEL, userId: 'u-bob', content: 'hi' }] as unknown as MessageWithUser[];
const loadSpaceDetail = vi.fn(() => Promise.resolve());

/** The remote space the user has open, as its instance lists it in `ready`. */
const remoteSpace = {
  id: REMOTE_SPACE,
  name: 'Tavvit',
  icon: null,
  banner: null,
  ownerId: 'u-owner',
  inviteCode: 'abc',
  createdAt: 1,
  myPermissions: '0',
  channels: [{ id: REMOTE_CHANNEL, spaceId: REMOTE_SPACE, name: 'general', type: 'text', position: 0, categoryId: null, createdAt: 1 }],
  categories: [],
};

function remoteSocket(): FakeWebSocket {
  connectInstance(REMOTE, 'token-remote');
  const ws = FakeWebSocket.all.at(-1)!;
  ws.open();
  return ws;
}

function remoteCacheKept(): boolean {
  return useChatStore.getState().messages.get(REMOTE_CHANNEL) === remoteCached;
}

function openRemoteChannel(): void {
  useSpaceStore.setState({
    currentSpaceId: REMOTE_SPACE,
    channelOriginMap: new Map([[REMOTE_CHANNEL, REMOTE]]),
    loadSpaceDetail,
  });
  useChatStore.setState({
    currentChannelId: REMOTE_CHANNEL,
    messages: new Map([[REMOTE_CHANNEL, remoteCached]]),
    hasMore: new Map([[REMOTE_CHANNEL, false]]),
  });
}

function dmCacheKept(): boolean {
  return useChatStore.getState().messages.get(DM) === cached;
}

beforeEach(() => {
  FakeWebSocket.all = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useAuthStore.setState({ user: jannis, trueHomeStatus: null });
  loadMessages.mockClear();
  loadSpaceDetail.mockClear();
  useChatStore.setState({
    currentChannelId: DM,
    messages: new Map([[DM, cached]]),
    hasMore: new Map([[DM, false]]),
    loadMessages,
  });
});

afterEach(() => {
  disconnectInstance('');
  disconnectInstance(REMOTE);
  useAuthStore.setState({ user: null, trueHomeStatus: null });
  useChatStore.getState().clearAllMessages();
  vi.restoreAllMocks();
});

describe('ready on a socket (issue #374)', () => {
  it('refetches the message cache on the first ready of a connection, which may have missed messages', () => {
    const home = homeSocket();
    home.deliver(ready(jannis));

    expect(dmCacheKept()).toBe(false);
    expect(loadMessages).toHaveBeenCalledWith(DM, true);
  });

  it('keeps the message cache on a later ready of the same connection', () => {
    const home = homeSocket();
    home.deliver(ready(jannis));
    useChatStore.setState({ messages: new Map([[DM, cached]]), hasMore: new Map([[DM, false]]) });
    loadMessages.mockClear();

    // An instance still on 1.7.0 sends a full ready as a permission refresh.
    home.deliver(ready(jannis));

    expect(dmCacheKept()).toBe(true);
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it('refetches again after a reconnect', () => {
    const first = homeSocket();
    first.deliver(ready(jannis));
    disconnectInstance('');
    useChatStore.setState({ messages: new Map([[DM, cached]]), hasMore: new Map([[DM, false]]) });
    loadMessages.mockClear();

    const second = homeSocket();
    second.deliver(ready(jannis));

    expect(dmCacheKept()).toBe(false);
    expect(loadMessages).toHaveBeenCalledWith(DM, true);
  });
});

describe('ready on a remote instance socket', () => {
  it('reloads the open channel on the first ready of the connection', () => {
    openRemoteChannel();
    const remote = remoteSocket();
    remote.deliver(ready(jannis, [remoteSpace]));

    expect(loadSpaceDetail).toHaveBeenCalledWith(REMOTE_SPACE);
    expect(remoteCacheKept()).toBe(false);
    expect(loadMessages).toHaveBeenCalledWith(REMOTE_CHANNEL, true);
  });

  it('keeps the open channel and its cache on a later ready of the same connection', () => {
    openRemoteChannel();
    const remote = remoteSocket();
    remote.deliver(ready(jannis, [remoteSpace]));
    useChatStore.setState({
      messages: new Map([[REMOTE_CHANNEL, remoteCached]]),
      hasMore: new Map([[REMOTE_CHANNEL, false]]),
    });
    loadMessages.mockClear();
    loadSpaceDetail.mockClear();

    // A permission refresh from an instance still on 1.7.0.
    remote.deliver(ready(jannis, [remoteSpace]));

    expect(loadSpaceDetail).toHaveBeenCalledWith(REMOTE_SPACE);
    expect(remoteCacheKept()).toBe(true);
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it('reloads again after the remote connection is re-established', () => {
    openRemoteChannel();
    const first = remoteSocket();
    first.deliver(ready(jannis, [remoteSpace]));
    disconnectInstance(REMOTE);
    useChatStore.setState({
      messages: new Map([[REMOTE_CHANNEL, remoteCached]]),
      hasMore: new Map([[REMOTE_CHANNEL, false]]),
    });
    loadMessages.mockClear();

    const second = remoteSocket();
    second.deliver(ready(jannis, [remoteSpace]));

    expect(remoteCacheKept()).toBe(false);
    expect(loadMessages).toHaveBeenCalledWith(REMOTE_CHANNEL, true);
  });
});

// The voice session of a space belongs to one socket (docs/systems/voice.md, "Transient
// reconnects"): the server ends it a minute after that socket closes, unless a new one takes it
// over with voice_join, which it still lists us in meanwhile.
describe('a voice session on a new socket', () => {
  const VOICE = 'voice-lounge';
  const listed = (ids: string[]) => ({ ...ready(jannis), voiceStates: { [VOICE]: ids } });
  const joins = (ws: FakeWebSocket) => ws.sent.filter((e) => e.type === 'voice_join');

  beforeEach(() => {
    useVoiceStore.setState({ currentVoiceChannelId: VOICE, voiceConnectionStatus: 'connected' });
    liveKit.room = { state: 'connected', disconnect: vi.fn() };
  });

  afterEach(() => {
    useVoiceStore.setState({ currentVoiceChannelId: null, voiceConnectionStatus: 'disconnected' });
    liveKit.room = null;
  });

  it('is taken over by the new socket while the server still lists us, LiveKit having stayed up', () => {
    const home = homeSocket();
    home.deliver(listed(['jannis']));
    expect(joins(home)).toEqual([{ type: 'voice_join', channelId: VOICE }]);
    expect(home.sent.some((e) => e.type === 'voice_status')).toBe(true);
  });

  it('is claimed again when the server no longer lists us', () => {
    const home = homeSocket();
    home.deliver(listed([]));
    expect(joins(home)).toEqual([{ type: 'voice_join', channelId: VOICE }]);
  });

  it('stays with the socket that holds it when that socket refreshes', () => {
    const home = homeSocket();
    home.deliver(listed(['jannis']));
    home.sent = [];
    home.deliver(listed(['jannis']));
    expect(joins(home)).toEqual([]);
  });

  it('is left alone once LiveKit gave up, waiting for Retry with its channel kept', () => {
    useVoiceStore.setState({ voiceConnectionStatus: 'disconnected' });
    liveKit.room = null;
    const home = homeSocket();
    home.deliver(listed(['jannis']));
    expect(joins(home)).toEqual([]);
    expect(useVoiceStore.getState().currentVoiceChannelId).toBe(VOICE);
  });
});
