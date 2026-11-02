import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GamesPanel } from './GamesPanel';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/channels/@me']}>
      <GamesPanel />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function installDesktop(initial: { enabled: boolean; userGames: Array<{ name: string; process: string }>; current: unknown }) {
  let state = initial;
  let push: (activity: unknown) => void = () => undefined;
  const api = {
    getGameDetection: vi.fn(async () => state),
    setGameDetectionEnabled: vi.fn(async (enabled: boolean) => { state = { ...state, enabled, current: enabled ? state.current : null }; return state; }),
    removeDetectedGame: vi.fn(async (process: string) => { state = { ...state, userGames: state.userGames.filter((g) => g.process !== process) }; return state; }),
    onActivityDetected: vi.fn((cb: (activity: unknown) => void) => { push = cb; return () => undefined; }),
  };
  (window as unknown as { backspace: unknown }).backspace = api;
  return { api, push: (activity: unknown) => push(activity) };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'backspace');
});

const SWITCH = 'Detect what I play';

describe('GamesPanel', () => {
  it('in a browser offers the desktop app instead of a switch that could not work', () => {
    renderPanel();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/game detection works in the Tavvit desktop app/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Get the desktop app/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/download');
  });

  it('shows what is detected live while detection is on, as the desktop app starts it', async () => {
    const { push } = installDesktop({ enabled: true, userGames: [], current: { type: 'playing', name: 'Celeste' } });
    renderPanel();
    expect(await screen.findByText('Playing Celeste')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/^On until you turn it off\./)).toBeInTheDocument();
    push(null);
    expect(await screen.findByText('No game running that Tavvit knows.')).toBeInTheDocument();
  });

  it('stops showing what is detected once turned off', async () => {
    const { api } = installDesktop({ enabled: true, userGames: [], current: null });
    renderPanel();
    expect(await screen.findByText('Detected now')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
    await waitFor(() => expect(api.setGameDetectionEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.queryByText('Detected now')).toBeNull());
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('My games')).toBeNull();
  });

  it('turns detection back on when asked, then shows what is detected live', async () => {
    const { api, push } = installDesktop({ enabled: false, userGames: [], current: null });
    renderPanel();
    const toggle = await screen.findByRole('switch', { name: SWITCH });
    await waitFor(() => expect(api.getGameDetection).toHaveBeenCalled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Detected now')).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setGameDetectionEnabled).toHaveBeenCalledWith(true));
    expect(await screen.findByText('No game running that Tavvit knows.')).toBeInTheDocument();
    push({ type: 'playing', name: 'Hollow Knight' });
    expect(await screen.findByText('Playing Hollow Knight')).toBeInTheDocument();
  });

  it('offers nothing to pick from the programs on this computer', async () => {
    installDesktop({ enabled: true, userGames: [], current: null });
    renderPanel();
    expect(await screen.findByText('Detected now')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('My games')).toBeNull();
    expect(screen.getByText(/Steam, Epic Games or GOG/)).toBeInTheDocument();
  });

  it('keeps a game added in an earlier version until it is removed', async () => {
    const { api } = installDesktop({ enabled: true, userGames: [{ name: 'My Game', process: 'mygame.exe' }], current: null });
    renderPanel();
    expect(await screen.findByText('My games')).toBeInTheDocument();
    expect(screen.getByText('mygame.exe')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove My Game' }));
    await waitFor(() => expect(api.removeDetectedGame).toHaveBeenCalledWith('mygame.exe'));
    await waitFor(() => expect(screen.queryByText('My games')).toBeNull());
  });
});
