import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@backspace/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via authStore -> voiceStore.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const federation = vi.hoisted(() => ({ enabled: true as boolean | null }));
vi.mock('../../hooks/useFederationEnabled', () => ({ useFederationEnabled: () => federation.enabled }));

import { fireEvent, render, screen } from '@testing-library/react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { MobileYouScreen } from './MobileYouScreen';

const self: User = {
  id: 'user-self',
  username: 'me',
  displayName: 'Me',
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

const pushMobileScreen = vi.fn();
const originalPush = useUIStore.getState().pushMobileScreen;

function row(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}`) });
}

beforeEach(() => {
  federation.enabled = true;
  pushMobileScreen.mockReset();
  useUIStore.setState({ pushMobileScreen });
  useAuthStore.setState({ user: self });
});

afterEach(() => {
  useUIStore.setState({ pushMobileScreen: originalPush });
  useAuthStore.setState({ user: null });
});

describe('MobileYouScreen: About row', () => {
  it('renders an About row that pushes the about screen', () => {
    render(<MobileYouScreen />);

    fireEvent.click(row('About'));

    expect(pushMobileScreen).toHaveBeenCalledTimes(1);
    expect(pushMobileScreen).toHaveBeenCalledWith('about');
  });

  it('has no row for the upstream project page', () => {
    render(<MobileYouScreen />);

    expect(screen.queryByRole('button', { name: /^Backspace/ })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Backspace was updated' })).toBeNull();
  });

  it('still lists the account rows', () => {
    render(<MobileYouScreen />);

    for (const label of ['Edit Profile', 'Friends', 'Connections', 'Voice']) {
      expect(row(label)).toBeInTheDocument();
    }
  });

  it.each([false, null])('leaves out Connections while federation is %s: nothing behind it would answer', (state) => {
    federation.enabled = state;
    render(<MobileYouScreen />);

    expect(screen.queryByRole('button', { name: /^Connections/ })).toBeNull();
    for (const label of ['Edit Profile', 'Friends', 'Voice', 'About']) {
      expect(row(label)).toBeInTheDocument();
    }
  });
});
