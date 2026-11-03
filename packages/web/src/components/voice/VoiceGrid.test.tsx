import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceGrid } from './VoiceGrid';
import { useVoiceStore } from '../../stores/voiceStore';
import { useWatchStore } from '../../stores/watchStore';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: () => ({}) },
}));

vi.mock('../../hooks/useLiveKit', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getActiveRoom: () => null,
    setCameraSubscription: vi.fn(),
    setStreamSubscription: vi.fn(),
  };
});

function participant(identity: string, isLocal: boolean) {
  return {
    identity,
    userId: identity,
    username: identity,
    homeUserId: null,
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    isLocal,
    audioTrack: null,
    videoTrack: null,
    screenTrack: null,
    screenAudioTrack: null,
    lkVideoTrack: null,
    lkScreenTrack: null,
    cachedUser: null,
  } as any;
}

beforeEach(() => {
  useVoiceStore.setState({
    focusedParticipantId: 'ada',
    currentVoiceChannelId: 'voice-1',
    isDeafened: false,
    speakingParticipantIds: new Set(),
    spaceMutedUserIds: new Set(),
    spaceDeafenedUserIds: new Set(),
    permissionMutedUserIds: new Set(),
    unwatchedCameras: new Set(),
    participantMutes: new Map(),
  });
  useWatchStore.setState({ sessions: new Map(), presence: new Map(), reactions: [], slot: null, videoHiddenFor: null });
});

describe('VoiceGrid participant strip', () => {
  it('can show the participant strip again after hiding it', async () => {
    render(<VoiceGrid participants={[participant('ada', true), participant('bob', false)]} />);

    await userEvent.click(screen.getByText(/hide members/i));
    expect(screen.getByText(/show members/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/show members/i));
    expect(screen.getByText(/hide members/i)).toBeInTheDocument();
  });
});

describe('VoiceGrid while the call watches something together', () => {
  beforeEach(() => {
    useWatchStore.getState().applyState('voice-1', {
      channelId: 'voice-1',
      spaceId: 'space-1',
      current: { id: 'item-1', provider: 'youtube', ref: 'dQw4w9WgXcQ', startMs: 0, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Night sky' },
      queue: [],
      playing: true,
      positionMs: 0,
      stateAt: Date.now(),
      control: 'everyone',
      starterId: 'ada',
    }, Date.now());
  });

  it('gives the video the stage, with everyone in a strip under it', () => {
    const { container } = render(<VoiceGrid participants={[participant('ada', true), participant('bob', false)]} />);
    const stage = container.querySelector('[data-watch-slot]');
    expect(stage).not.toBeNull();
    expect(useWatchStore.getState().slot).toBe(stage);
    expect(screen.getAllByText(/ada|bob/).length).toBeGreaterThan(0);
  });

  it('gives the stage back to the call while the video is hidden, and a way to show it again', async () => {
    useWatchStore.setState({ videoHiddenFor: 'voice-1' });
    const { container } = render(<VoiceGrid participants={[participant('ada', true), participant('bob', false)]} />);
    expect(container.querySelector('[data-watch-slot]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /show the video/i }));
    expect(useWatchStore.getState().videoHiddenFor).toBeNull();
    expect(container.querySelector('[data-watch-slot]')).not.toBeNull();
  });
});
