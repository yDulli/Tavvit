import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { WatchSession } from '@backspace/shared/src/watch';
import { PermissionBits } from '@backspace/shared/src/permissions';
import type { ParticipantInfo } from '../../hooks/useLiveKit';

// The one player of watching together: it waits for the person's OK, is steered through the room
// only, and lies over the call's place for it or floats beside everything else.

const { made, api, me, permissions, playerAt } = vi.hoisted(() => ({
  made: [] as Array<{
    source: unknown;
    startMs: number;
    events: { onEnded: () => void; onBlocked: () => void; onPlaying: () => void };
    element: HTMLElement;
    play: ReturnType<typeof vi.fn>;
    seek: ReturnType<typeof vi.fn>;
    setVolume: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    setOutputDevice?: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  api: { change: vi.fn(), react: vi.fn(), end: vi.fn(), add: vi.fn(), get: vi.fn() },
  me: { id: 'ada' },
  permissions: { value: '0' },
  /** Where the fake player says it stands; null while it cannot say. */
  playerAt: { value: null as number | null },
}));

vi.mock('../../utils/watchPlayers', () => ({
  createWatchPlayer: (source: { provider: string }, startMs: number, events: { onEnded: () => void; onBlocked: () => void; onPlaying: () => void }) => {
    const player = {
      source,
      startMs,
      events,
      element: document.createElement('div'),
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      currentMs: () => playerAt.value,
      durationMs: () => 212_000,
      setVolume: vi.fn(),
      resume: vi.fn(),
      // Only a file's player can choose where it plays; a provider's frame cannot.
      ...(source.provider === 'file' ? { setOutputDevice: vi.fn() } : {}),
      destroy: vi.fn(),
    };
    made.push(player);
    return player;
  },
  watchPlayerAddress: () => 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
}));

vi.mock('../../stores/spaceStore', () => {
  const state = {
    channelPermissions: new Map<string, string>(),
    channelToSpaceMap: new Map([['voice-1', 'space-1']]),
  };
  const useSpaceStore = Object.assign(
    (selector: (s: typeof state) => unknown) => {
      state.channelPermissions = new Map([['voice-1', permissions.value]]);
      return selector(state);
    },
    { getState: () => state },
  );
  return { useSpaceStore, getChannelOrigin: () => '', getApiForOrigin: () => ({ watch: api }) };
});

vi.mock('../../stores/authStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/authStore')>()),
  getMyUserIdForOrigin: () => me.id,
}));

vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const { WatchPlayerHost, formatWatchTime } = await import('./WatchPlayerHost');
const { useWatchStore } = await import('../../stores/watchStore');
const { useVoiceStore } = await import('../../stores/voiceStore');
const { useExternalMediaStore } = await import('../../stores/externalMediaStore');
const { useUIStore } = await import('../../stores/uiStore');

function session(overrides: Partial<WatchSession> = {}): WatchSession {
  return {
    channelId: 'voice-1',
    spaceId: 'space-1',
    current: { id: 'item-1', provider: 'youtube', ref: 'dQw4w9WgXcQ', startMs: 0, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Night sky' },
    queue: [{ id: 'item-2', provider: 'vimeo', ref: '76979871', startMs: 0, url: 'https://vimeo.com/76979871', title: 'Morning' }],
    playing: true,
    positionMs: 0,
    stateAt: Date.now(),
    control: 'everyone',
    starterId: 'ada',
    ...overrides,
  };
}

function show(value: WatchSession) {
  useWatchStore.getState().applyState('voice-1', value, Date.now());
  return render(<MemoryRouter><WatchPlayerHost /></MemoryRouter>);
}

/** Opens the call's place for the video, and waits until the frame lies over it. */
async function openStage(container: HTMLElement) {
  const slot = Object.assign(document.createElement('div'), {
    getBoundingClientRect: () => ({ top: 10, left: 20, width: 640, height: 360, right: 660, bottom: 370, x: 20, y: 10, toJSON: () => ({}) }),
  });
  act(() => useWatchStore.getState().setSlot(slot));
  await waitFor(() => expect((container.querySelector('[data-watch-frame]') as HTMLElement).style.width).toBe('640px'));
}

beforeEach(() => {
  made.length = 0;
  playerAt.value = null;
  for (const call of Object.values(api)) call.mockReset();
  api.change.mockImplementation(async () => ({ session: session(), serverNow: Date.now() }));
  api.react.mockResolvedValue({ success: true });
  me.id = 'ada';
  permissions.value = (PermissionBits.STREAM).toString();
  useWatchStore.setState({ sessions: new Map(), presence: new Map(), reactions: [], slot: null, videoHiddenFor: null });
  useVoiceStore.setState({
    currentVoiceChannelId: 'voice-1',
    isDeafened: false,
    outputVolume: 100,
    participants: [],
    speakingParticipantIds: new Set(),
    spaceDeafenedUserIds: new Set(),
    pipEnabled: true,
    outputDeviceId: 'default',
  });
  useUIStore.setState({ isMobile: false, toasts: [] });
  useExternalMediaStore.setState({ alwaysAllow: false, allowedHosts: [] });
});

afterEach(() => vi.restoreAllMocks());

describe('the player of watching together', () => {
  it('waits for the person\'s OK before YouTube\'s player loads', async () => {
    show(session());
    expect(screen.getByText(/This comes from www\.youtube-nocookie\.com/)).toBeTruthy();
    expect(made).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(made).toHaveLength(1);
  });

  it('is steered through the room, and its reactions go to the room', async () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    const { container } = show(session());
    await openStage(container);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(api.change).toHaveBeenCalledWith('voice-1', { action: 'pause' });
    await userEvent.click(screen.getByRole('button', { name: 'React with 🔥' }));
    expect(api.react).toHaveBeenCalledWith('voice-1', '🔥');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.change).toHaveBeenCalledWith('voice-1', { action: 'next', itemId: 'item-1' });
  });

  it('leaves its controls to the starter while only the starter steers', async () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    me.id = 'bob';
    const { container } = show(session({ control: 'starter' }));
    await openStage(container);
    expect((screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the queue, and lets the starter hand the controls to themselves alone', async () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    const { container } = show(session());
    await openStage(container);
    await userEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(screen.getByText('Morning')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Only I steer' }));
    expect(api.change).toHaveBeenCalledWith('voice-1', { action: 'control', control: 'starter' });
  });

  it('floats in the place of the call\'s own window while the call\'s view is closed, and can be put away there', async () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    const { container } = show(session());
    const frame = container.querySelector('[data-watch-frame]') as HTMLElement;
    expect(frame.dataset.watchFrame).toBe('float');
    expect(frame.className).toContain('glass');
    expect(frame.style.width).toBe('320px');
    await userEvent.click(screen.getByRole('button', { name: 'Hide the video' }));
    expect(container.querySelector('[data-watch-frame]')).toBeNull();
    expect(useWatchStore.getState().videoHiddenFor).toBe('voice-1');
    expect(made[0]!.destroy).toHaveBeenCalled();
  });

  it('stays put away while the view around the same call is rebuilt, and shows for the next call', () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    useWatchStore.getState().setVideoHidden('voice-1', true);
    const first = show(session());
    expect(first.container.querySelector('[data-watch-frame]')).toBeNull();
    first.unmount();
    const again = show(session());
    expect(again.container.querySelector('[data-watch-frame]')).toBeNull();
    expect(made).toHaveLength(0);
    again.unmount();

    act(() => useVoiceStore.setState({ currentVoiceChannelId: 'voice-2' }));
    useWatchStore.getState().applyState('voice-2', { ...session(), channelId: 'voice-2' }, Date.now());
    const next = render(<MemoryRouter><WatchPlayerHost /></MemoryRouter>);
    expect(next.container.querySelector('[data-watch-frame]')).not.toBeNull();
  });

  it('names a video its provider gave no title for by its provider', async () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    const { container } = show(session({ current: { ...session().current!, title: '' } }));
    await openStage(container);
    expect(screen.getAllByText('A YouTube video').length).toBeGreaterThan(0);
  });

  it('plays on unseen where the call\'s own window would not show: on the phone, or with it turned off', () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    useUIStore.setState({ isMobile: true });
    const { container, unmount } = show(session());
    let frame = container.querySelector('[data-watch-frame]') as HTMLElement;
    expect(frame.dataset.watchFrame).toBe('unseen');
    expect(frame.className).toContain('invisible');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(made).toHaveLength(1);
    unmount();

    useUIStore.setState({ isMobile: false });
    useVoiceStore.setState({ pipEnabled: false });
    const again = show(session());
    frame = again.container.querySelector('[data-watch-frame]') as HTMLElement;
    expect(frame.dataset.watchFrame).toBe('unseen');
  });

  it('lies over the call\'s place for it while that is there', async () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    const { container } = show(session());
    await openStage(container);
    const frame = container.querySelector('[data-watch-frame]') as HTMLElement;
    expect(frame.dataset.watchFrame).toBe('stage');
    expect(frame.style.top).toBe('10px');
    expect(frame.style.left).toBe('20px');
    expect(frame.className).not.toContain('glass');
  });

  it('is put close to the room once it starts, and moved again only when it drifts far', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100_000);
      useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
      // A player that just loaded, a second behind a room at 10 s.
      playerAt.value = 9_000;
      show(session({ positionMs: 10_000, stateAt: 100_000 }));
      expect(made[0]!.seek).toHaveBeenLastCalledWith(10_000);

      // Close to the room now: it is settled.
      playerAt.value = 11_000;
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(made[0]!.seek).toHaveBeenCalledTimes(1);

      // A second and a half behind is within the drift it may have.
      playerAt.value = 10_500;
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(made[0]!.seek).toHaveBeenCalledTimes(1);

      // Two and a half is not.
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(made[0]!.seek).toHaveBeenLastCalledWith(13_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is quieter while someone else speaks, with the setting that softens a stream, and silent while deafened', () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    const lena: ParticipantInfo = {
      identity: 'lena', userId: 'lena', username: 'lena', homeUserId: null,
      isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: false, isLocal: false,
      audioTrack: null, videoTrack: null, screenTrack: null, screenAudioTrack: null,
      lkVideoTrack: null, lkScreenTrack: null, cachedUser: null,
    };
    useVoiceStore.setState({ participants: [lena], streamAttenuationEnabled: true, streamAttenuationStrength: 50 });
    show(session());
    // One's own 80 of the video at the call's full output.
    expect(made[0]!.setVolume).toHaveBeenLastCalledWith(80);
    act(() => useVoiceStore.setState({ speakingParticipantIds: new Set(['lena']) }));
    expect(made[0]!.setVolume).toHaveBeenLastCalledWith(40);
    act(() => useVoiceStore.setState({ isDeafened: true }));
    expect(made[0]!.setVolume).toHaveBeenLastCalledWith(0);
  });

  it('asks for a click when the browser would not play it with sound, and the click brings the sound', async () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    show(session());
    act(() => made[0]!.events.onBlocked());
    await userEvent.click(screen.getByRole('button', { name: 'Click to watch along' }));
    expect(made[0]!.resume).toHaveBeenCalledTimes(1);
    act(() => made[0]!.events.onPlaying());
    expect(screen.queryByRole('button', { name: 'Click to watch along' })).toBeNull();
  });

  it('plays a file on the call\'s output device, and says once that a provider\'s frame plays on the default', async () => {
    const DEFAULT_OUTPUT = 'YouTube and Vimeo play on your system\'s default output, not on the device chosen for calls in your settings.';
    const told = () => useUIStore.getState().toasts.filter((toast) => toast.message === DEFAULT_OUTPUT).length;
    const outputs = [
      { kind: 'audiooutput', deviceId: 'default', groupId: 'speakers' },
      { kind: 'audiooutput', deviceId: 'speakers-1', groupId: 'speakers' },
      { kind: 'audiooutput', deviceId: 'headset-1', groupId: 'headset' },
    ];
    Object.defineProperty(navigator, 'mediaDevices', { value: { enumerateDevices: vi.fn().mockResolvedValue(outputs) }, configurable: true });
    try {
      useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });

      // The default under its own name is the same device: nothing to say.
      useVoiceStore.setState({ outputDeviceId: 'speakers-1' });
      const first = show(session());
      await act(async () => { await Promise.resolve(); });
      expect(told()).toBe(0);
      first.unmount();

      // The call on a headset, the frame on the speakers: said once, not again for another device.
      useVoiceStore.setState({ outputDeviceId: 'headset-1' });
      const second = show(session());
      await waitFor(() => expect(told()).toBe(1));
      act(() => useVoiceStore.setState({ outputDeviceId: 'headset-2' }));
      await act(async () => { await Promise.resolve(); });
      expect(told()).toBe(1);
      second.unmount();

      // A file plays where the call does, with nothing to say.
      useVoiceStore.setState({ outputDeviceId: 'headset-1' });
      show(session({ current: { id: 'item-9', provider: 'file', ref: 'https://media.example/night.mp4', startMs: 0, url: 'https://media.example/night.mp4', title: 'Night' } }));
      const file = made.at(-1)!;
      expect(file.setOutputDevice).toHaveBeenLastCalledWith('headset-1');
      expect(told()).toBe(1);
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });

  it('is gone with the call', () => {
    useExternalMediaStore.setState({ allowedHosts: ['www.youtube-nocookie.com'] });
    const { container } = show(session());
    act(() => useVoiceStore.setState({ currentVoiceChannelId: null }));
    expect(container.querySelector('[data-watch-frame]')).toBeNull();
    expect(useWatchStore.getState().sessions.size).toBe(0);
  });
});

describe('the clock under the picture', () => {
  it('reads m:ss, and h:mm:ss for a long video', () => {
    expect(formatWatchTime(0)).toBe('0:00');
    expect(formatWatchTime(65_400)).toBe('1:05');
    expect(formatWatchTime(3_725_000)).toBe('1:02:05');
  });
});
