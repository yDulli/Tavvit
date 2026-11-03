import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchSession } from '@backspace/shared/src/watch';

// The client's part of watching together: the call's session, what the channel list shows, and
// reactions that land after their flight.

const calls = vi.hoisted(() => ({ add: vi.fn(), change: vi.fn(), end: vi.fn(), react: vi.fn() }));

// The voice store, which the watch store asks which call this client is in, reaches the audio stack.
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

vi.mock('./spaceStore', () => ({
  getChannelOrigin: (channelId: string) => (channelId.startsWith('remote') ? 'https://remote.example' : ''),
  getApiForOrigin: () => ({ watch: calls }),
  useSpaceStore: { getState: () => ({ channelToSpaceMap: new Map([['voice-1', 'space-1'], ['voice-2', 'space-1'], ['voice-9', 'space-9']]) }) },
}));

const { REACTION_FLIGHT_MS, channelOfOrigin, channelOfSpace, useWatchStore } = await import('./watchStore');
const { useVoiceStore } = await import('./voiceStore');

function session(channelId: string, title = 'A film'): WatchSession {
  return {
    channelId,
    spaceId: 'space-1',
    current: { id: 'item-1', provider: 'youtube', ref: 'dQw4w9WgXcQ', startMs: 0, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title },
    queue: [],
    playing: true,
    positionMs: 0,
    stateAt: 1_000,
    control: 'everyone',
    starterId: 'ada',
  };
}

beforeEach(() => {
  useWatchStore.setState({ sessions: new Map(), presence: new Map(), reactions: [], slot: null, videoHiddenFor: null });
  useVoiceStore.setState({ currentVoiceChannelId: 'voice-1' });
  for (const call of Object.values(calls)) call.mockReset();
});

afterEach(() => vi.useRealTimers());

describe('the call\'s session', () => {
  it('holds a session with the offset of its stamp, and names what plays for the channel list', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    useWatchStore.getState().applyState('voice-1', session('voice-1'), 12_500);
    expect(useWatchStore.getState().sessions.get('voice-1')?.offsetMs).toBe(2_500);
    expect(useWatchStore.getState().presence.get('voice-1')).toEqual({ title: 'A film', provider: 'youtube' });
    useWatchStore.getState().applyState('voice-1', null, 13_000);
    expect(useWatchStore.getState().sessions.has('voice-1')).toBe(false);
    expect(useWatchStore.getState().presence.has('voice-1')).toBe(false);
    vi.restoreAllMocks();
  });

  it('takes the answer of a request at once, on the channel\'s own instance', async () => {
    useVoiceStore.setState({ currentVoiceChannelId: 'remote-voice' });
    calls.add.mockResolvedValue({ session: session('remote-voice'), serverNow: Date.now() });
    await useWatchStore.getState().add('remote-voice', 'https://youtu.be/dQw4w9WgXcQ');
    expect(calls.add).toHaveBeenCalledWith('remote-voice', 'https://youtu.be/dQw4w9WgXcQ');
    expect(useWatchStore.getState().sessions.get('remote-voice')?.session.current?.title).toBe('A film');
  });

  it('forgets a call it left, with the reactions over it', () => {
    useWatchStore.getState().applyState('voice-1', session('voice-1'), Date.now());
    useWatchStore.getState().addReaction('voice-1', '🔥');
    useWatchStore.getState().forgetCall('voice-1');
    expect(useWatchStore.getState().sessions.size).toBe(0);
    expect(useWatchStore.getState().reactions).toEqual([]);
  });
});

describe('the channel list', () => {
  it('a snapshot is the word for the channels it covers, and leaves the others alone', () => {
    useWatchStore.setState({ presence: new Map([
      ['voice-1', { title: 'Old', provider: 'youtube' }],
      ['voice-9', { title: 'Elsewhere', provider: 'vimeo' }],
    ]) });
    useWatchStore.getState().applyPresenceSnapshot(channelOfSpace('space-1', ''), {
      'voice-2': { title: 'New', provider: 'file' },
      // Not a channel of this space: not this snapshot's to state.
      'voice-9': { title: 'Spoofed', provider: 'file' },
    });
    expect(Object.fromEntries(useWatchStore.getState().presence)).toEqual({
      'voice-2': { title: 'New', provider: 'file' },
      'voice-9': { title: 'Elsewhere', provider: 'vimeo' },
    });
    // The same space id on another instance is another space.
    useWatchStore.getState().applyPresenceSnapshot(channelOfSpace('space-1', 'https://remote.example'), {});
    expect(useWatchStore.getState().presence.get('voice-2')).toEqual({ title: 'New', provider: 'file' });
    // A ready of the home origin covers the home's channels only.
    useWatchStore.getState().applyPresenceSnapshot(channelOfOrigin(''), undefined);
    expect([...useWatchStore.getState().presence.keys()]).toEqual([]);
  });
});

describe('reactions', () => {
  it('land after their flight, and only so many fly at once', () => {
    vi.useFakeTimers();
    useWatchStore.getState().addReaction('voice-1', '🔥');
    expect(useWatchStore.getState().reactions).toHaveLength(1);
    vi.advanceTimersByTime(REACTION_FLIGHT_MS);
    expect(useWatchStore.getState().reactions).toHaveLength(0);
    for (let i = 0; i < 40; i += 1) useWatchStore.getState().addReaction('voice-1', '🎉');
    expect(useWatchStore.getState().reactions.length).toBeLessThanOrEqual(24);
  });
});

describe('what the store will not take', () => {
  it('a late answer about a call this client left changes only the channel list', async () => {
    useVoiceStore.setState({ currentVoiceChannelId: 'voice-2' });
    calls.change.mockResolvedValue({ session: session('voice-1'), serverNow: Date.now() });
    await useWatchStore.getState().change('voice-1', { action: 'pause' });
    expect(useWatchStore.getState().sessions.has('voice-1')).toBe(false);
    expect(useWatchStore.getState().presence.get('voice-1')?.title).toBe('A film');
  });

  it('a session that is not one as the server sends them', () => {
    const odd = { ...session('voice-1'), current: { ...session('voice-1').current, provider: 'elsewhere' } };
    useWatchStore.getState().applyState('voice-1', odd, Date.now());
    useWatchStore.getState().applyState('voice-1', { channelId: 'voice-1' }, Date.now());
    useWatchStore.getState().applyState('voice-1', 'yes', Date.now());
    expect(useWatchStore.getState().sessions.size).toBe(0);
    expect(useWatchStore.getState().presence.size).toBe(0);
  });
});

describe('where the video stands', () => {
  it('moves with a position of the video that plays, and not with one of another', () => {
    useWatchStore.getState().applyState('voice-1', session('voice-1'), 5_000);
    useWatchStore.getState().applyPosition('voice-1', { itemId: 'item-9', playing: false, positionMs: 9_000, stateAt: 6_000 }, 6_000);
    expect(useWatchStore.getState().sessions.get('voice-1')?.session.playing).toBe(true);
    useWatchStore.getState().applyPosition('voice-1', { itemId: 'item-1', playing: false, positionMs: 9_000, stateAt: 6_000 }, 6_000);
    expect(useWatchStore.getState().sessions.get('voice-1')?.session).toMatchObject({ playing: false, positionMs: 9_000, stateAt: 6_000 });
  });
});

describe('the video put away', () => {
  it('stays away for that call alone', () => {
    useWatchStore.getState().setVideoHidden('voice-1', true);
    expect(useWatchStore.getState().videoHiddenFor).toBe('voice-1');
    useWatchStore.getState().setVideoHidden('voice-2', false);
    expect(useWatchStore.getState().videoHiddenFor).toBe('voice-1');
    useWatchStore.getState().setVideoHidden('voice-1', false);
    expect(useWatchStore.getState().videoHiddenFor).toBeNull();
  });
});
