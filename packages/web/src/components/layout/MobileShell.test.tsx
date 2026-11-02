import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InstanceInfoResponse } from '@backspace/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via the voice screens and stores.
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
import { api } from '../../api/client';
import { __resetHomeInstanceInfoForTests } from '../../hooks/useHomeInstanceInfo';
import { mobileScreenMap } from './MobileShell';

beforeEach(() => {
  __resetHomeInstanceInfoForTests();
  vi.spyOn(api.instance, 'info').mockReturnValue(new Promise<InstanceInfoResponse>(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetHomeInstanceInfoForTests();
});

describe('MobileShell: about screen', () => {
  it('renders the About page under the mobile header, without the page top bar', () => {
    const renderScreen = mobileScreenMap['about'];
    expect(renderScreen).toBeDefined();

    render(<MemoryRouter>{renderScreen?.()}</MemoryRouter>);

    // The mobile header's title, then the page's own heading.
    const header = screen.getByRole('heading', { level: 1, name: 'About' });
    expect(header.closest('header')?.querySelector('button')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'About Tavvit' })).toBeInTheDocument();
    expect(screen.getByText('A place for your people.')).toBeInTheDocument();
    // The page's top bar is the only place the member-list toggle lives.
    expect(screen.queryByRole('button', { name: 'Toggle Member List' })).toBeNull();
  });

  it('gives the page only the height the header leaves', () => {
    render(<MemoryRouter>{mobileScreenMap['about']?.()}</MemoryRouter>);

    // jsdom does no layout, so this pins the structure: the page's root is
    // `h-full`, and only a `flex-1 min-h-0` parent keeps that from resolving
    // to the whole screen and pushing the page's end under the stack's clip.
    const pageHeading = screen.getByRole('heading', { level: 1, name: 'About Tavvit' });
    const pageRoot = pageHeading.closest('.bg-surface-chat');
    expect(pageRoot).not.toBeNull();
    expect(pageRoot?.parentElement).toHaveClass('flex-1', 'min-h-0', 'flex', 'flex-col');
  });

  it('no longer has a screen for the upstream project page', () => {
    expect(mobileScreenMap['backspace']).toBeUndefined();
  });
});
