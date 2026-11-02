import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@backspace/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via the voice components and stores.
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
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { UserControls } from './UserControls';

function user(fields: Partial<User> & Pick<User, 'id' | 'username'>): User {
  return {
    displayName: null, avatar: null, banner: null, accentColor: null, avatarColor: null,
    bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1, homeInstance: null,
    homeUserId: null, replicatedInstances: [], ...fields,
  } as User;
}

/** The status dot on the avatar of the identity button at the right of the top bar. */
function ownDotClass(username: string): string {
  const handle = screen.getByText(`@${username}`);
  const area = handle.closest('.group');
  // The status mark is a shape per state (Avatar's STATUS_GLYPHS); it names its state.
  const dot = area?.querySelector('[data-avatar] > svg[data-status]');
  if (!dot) throw new Error('no status dot on the identity button');
  return dot.getAttribute('data-status') ?? '';
}

function renderControls() {
  return render(
    <MemoryRouter initialEntries={['/channels/@me']}>
      <UserControls />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.setState({ currentChannelId: null });
  useSpaceStore.setState({ spaces: [], currentSpaceId: null, channels: [], dmChannels: [] });
  useUIStore.setState({ showDms: true });
});

afterEach(() => {
  useAuthStore.setState({ user: null, trueHomeStatus: null });
});

describe('UserControls own status dot', () => {
  it("shows a replicated session's chosen status, not the page instance's projection", () => {
    // erin@nova signed in directly on this instance. The page instance's view
    // of her says online; her true home says Do Not Disturb.
    const erin = user({
      id: 'erin-here', username: 'erin@nova.example', status: 'online',
      homeInstance: 'nova.example', homeUserId: 'erin-nova',
    });
    useAuthStore.setState({ user: erin, trueHomeStatus: 'dnd' });

    renderControls();

    expect(ownDotClass('erin@nova.example')).toBe('dnd');
  });

  it("shows a native session's own status", () => {
    const jannis = user({ id: 'jannis', username: 'jannis', status: 'idle' });
    useAuthStore.setState({ user: jannis, trueHomeStatus: null });

    renderControls();

    expect(ownDotClass('jannis')).toBe('idle');
  });
});
