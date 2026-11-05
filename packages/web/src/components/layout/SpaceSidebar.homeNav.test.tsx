import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via the stores.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { SpaceSidebar } from './SpaceSidebar';

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <SpaceSidebar />
    </MemoryRouter>,
  );
}

function railButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  useChatStore.setState({ currentChannelId: null });
  useSpaceStore.setState({ spaces: [], currentSpaceId: null, channels: [], dmChannels: [], folders: [], spaceLayout: [] });
  useUIStore.setState({ showDms: false });
});

describe('SpaceSidebar Home tile', () => {
  it('is active on /about, which is reached from the home sidebar', () => {
    renderAt('/about');
    expect(railButton('Home')).toHaveAttribute('aria-current', 'page');
    expect(railButton('Explore Spaces')).not.toHaveAttribute('aria-current');
  });

  it('is active on /friends', () => {
    renderAt('/friends');
    expect(railButton('Home')).toHaveAttribute('aria-current', 'page');
  });

  it('is not active on /explore, where the Explore action is', () => {
    renderAt('/explore');
    expect(railButton('Home')).not.toHaveAttribute('aria-current');
    expect(railButton('Explore Spaces')).toHaveAttribute('aria-current', 'page');
  });

  it('is active on the DM home', () => {
    useUIStore.setState({ showDms: true });
    renderAt('/channels/@me');
    expect(railButton('Home')).toHaveAttribute('aria-current', 'page');
  });
});
