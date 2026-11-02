import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { InstanceStreamingLimits, User } from '@backspace/shared';
import type { SpaceReviewState } from '@backspace/shared/src/platform';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via spaceStore -> chatStore -> useWebSocket -> voiceStore.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { MemoryRouter } from 'react-router-dom';
import { SpaceSettingsModal } from './SpaceSettings';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../api/client';
import { PermissionBits, permissionsToString } from '../../utils/permissions';

const SWITCH = 'List in the global Tavvit directory';

const limits: InstanceStreamingLimits = {
  maxBitrateKbps: 20000,
  minBitrateKbps: 500,
  bitrateStepKbps: 500,
  allowedResolutions: [540, 720, 1080],
  allowedFramerates: [30, 45, 60],
  maxResolution: 1080,
  maxFramerate: 60,
  discoveryEnabled: true,
  directoryEnabled: true,
  directoryConfigured: true,
  bitrateMatrixOverrides: null,
  allowCustomBitrate: true,
};

const space: TaggedSpace = {
  id: 'space-1',
  name: 'Aether Drift',
  icon: null,
  banner: null,
  avatarColor: 'lavender',
  ownerId: 'user-1',
  inviteCode: null,
  visibility: 'public',
  directoryListed: false,
  description: '',
  createdAt: 1,
  _instanceOrigin: '',
};

function seed(permissions: bigint): void {
  useSpaceStore.setState({
    spaces: [space],
    currentSpaceId: space.id,
    spacePermissions: new Map([[space.id, permissionsToString(permissions)]]),
  });
  useSettingsStore.setState({ streamingLimits: limits, isAdmin: false });
}

beforeEach(() => {
  vi.spyOn(api.explore, 'getJoinRequests').mockResolvedValue([]);
  useUIStore.setState({ activeModal: null, modalData: {}, isMobile: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpaceSettingsModal opening tab', () => {
  it('opens on the tab the caller names', async () => {
    seed(PermissionBits.MANAGE_SPACE);
    render(<MemoryRouter><SpaceSettingsModal /></MemoryRouter>);
    act(() => { useUIStore.getState().openModal('spaceSettings', { tab: 'discovery' }); });
    await act(async () => {});
    expect(screen.getByRole('switch', { name: SWITCH })).toBeInTheDocument();
  });

  it('falls back to the overview when the named tab is not this user\'s to see', async () => {
    seed(0n);
    render(<MemoryRouter><SpaceSettingsModal /></MemoryRouter>);
    act(() => { useUIStore.getState().openModal('spaceSettings', { tab: 'discovery' }); });
    await act(async () => {});
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument();
  });

  it('opens on the overview when no tab is named', async () => {
    seed(PermissionBits.MANAGE_SPACE);
    render(<MemoryRouter><SpaceSettingsModal /></MemoryRouter>);
    act(() => { useUIStore.getState().openModal('spaceSettings'); });
    await act(async () => {});
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument();
  });
});

describe('SpaceSettingsModal verification tab', () => {
  /** The space's owner, signed in on the instance that hosts it. */
  const owner: User = {
    id: 'user-1',
    username: 'owner',
    displayName: null,
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 0,
    homeInstance: null,
    homeUserId: null,
    replicatedInstances: [],
  };

  /** A space that has never asked for either review. */
  const neverReviewed: SpaceReviewState = {
    spaceId: space.id,
    verification: { status: null, request: null, history: [] },
    discovery: { status: null, request: null, history: [] },
  };

  afterEach(() => {
    useAuthStore.setState({ user: null });
  });

  it("is the owner's: listed in the navigation and opened by a deep link", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(api.review, 'get').mockResolvedValue(neverReviewed);
    seed(0n);
    render(<MemoryRouter><SpaceSettingsModal /></MemoryRouter>);
    act(() => { useUIStore.getState().openModal('spaceSettings', { tab: 'verification' }); });

    expect(await screen.findByText('This space is not verified and no request is open.', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verification' })).toHaveAttribute('aria-current', 'page');
    expect(api.review.get).toHaveBeenCalledWith(space.id);
  });

  it('is not offered to anyone else, and a deep link to it opens the overview', async () => {
    seed(PermissionBits.MANAGE_SPACE);
    render(<MemoryRouter><SpaceSettingsModal /></MemoryRouter>);
    act(() => { useUIStore.getState().openModal('spaceSettings', { tab: 'verification' }); });
    await act(async () => {});

    expect(screen.queryByRole('button', { name: 'Verification' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
});
