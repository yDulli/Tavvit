import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { ChannelSidebar } from './ChannelSidebar';

const LABELS = { home: 'Home', friends: 'Friends', explore: 'Explore', about: 'About' } as const;

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <ChannelSidebar />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The button of a home item, found by its visible label. */
function homeItem(label: string): HTMLElement {
  return screen.getByRole('button', { name: label });
}

function selectedItems(): string[] {
  return Object.entries(LABELS)
    .filter(([, label]) => homeItem(label).getAttribute('aria-current') === 'page')
    .map(([key]) => key);
}

beforeEach(() => {
  useChatStore.setState({ currentChannelId: null });
  useSpaceStore.setState({ spaces: [], currentSpaceId: null, channels: [], dmChannels: [] });
  useUIStore.setState({ showDms: true });
});

describe('ChannelSidebar home items', () => {
  it('selects only Explore on /explore', () => {
    renderAt('/explore');
    expect(selectedItems()).toEqual(['explore']);
  });

  it('selects only About on /about', () => {
    renderAt('/about');
    expect(selectedItems()).toEqual(['about']);
  });

  it('selects only Friends on /friends', () => {
    renderAt('/friends');
    expect(selectedItems()).toEqual(['friends']);
  });

  it('selects only Home on the DM home', () => {
    renderAt('/channels/@me');
    expect(selectedItems()).toEqual(['home']);
  });

  it('selects none of them while a DM is open', () => {
    useChatStore.setState({ currentChannelId: 'dm-1' });
    renderAt('/channels/@me/dm-1');
    expect(selectedItems()).toEqual([]);
  });

  it.each([
    ['friends', '/friends'],
    ['explore', '/explore'],
    ['about', '/about'],
  ] as const)('navigates to %s when its item is clicked', (key, path) => {
    renderAt('/channels/@me');
    fireEvent.click(homeItem(LABELS[key]));
    expect(screen.getByTestId('location')).toHaveTextContent(path);
  });

  it('goes back to the dashboard when Home is clicked', () => {
    renderAt('/friends');
    fireEvent.click(homeItem(LABELS.home));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/@me');
  });

  it('no longer renders the upstream project entry or its update dot', () => {
    renderAt('/channels/@me');
    expect(screen.queryByText('Backspace')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Backspace was updated' })).toBeNull();
  });
});
