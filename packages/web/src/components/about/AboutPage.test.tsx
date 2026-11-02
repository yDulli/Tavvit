import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InstanceInfoResponse } from '@backspace/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via the member list toggle's store.
vi.mock('../legal/LegalLinks', () => ({ LegalLinks: () => null }));
vi.mock('../legal/LegalController', () => ({ NoticeBody: () => null }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const info = vi.hoisted(() => ({ value: null as InstanceInfoResponse | null }));
vi.mock('../../hooks/useHomeInstanceInfo', () => ({ useHomeInstanceInfo: () => info.value }));

const release = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ api: { desktop: { release } } }));

import { cleanup, render, screen } from '@testing-library/react';
import { AboutPage } from './AboutPage';
import { useSettingsStore } from '../../stores/settingsStore';

function instanceInfo(over: Partial<InstanceInfoResponse> = {}): InstanceInfoResponse {
  return {
    name: 'Friend Club',
    version: '1.4.0',
    registrationOpen: false,
    federatedRegistrationOpen: false,
    instanceId: 'i-1',
    sourceCodeUrl: 'https://git.example.org/friends/orbit',
    commit: 'abc1234',
    directoryConfigured: false,
    directoryAvailable: false,
    directoryEnabled: false,
    supportCardEnabled: false,
    sourceCodeConfigured: true,
    ...over,
  };
}

beforeEach(() => {
  info.value = instanceInfo();
  useSettingsStore.setState({ isAdmin: false });
  release.mockResolvedValue({ release: null });
});

afterEach(cleanup);

describe('AboutPage', () => {
  it('names the product and the server', () => {
    render(<AboutPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('About Tavvit');
    expect(screen.getByText('Friend Club')).toBeInTheDocument();
    expect(screen.getByText(window.location.host, { exact: false })).toBeInTheDocument();
  });

  it('says which version runs here, as a line of its own', () => {
    render(<AboutPage />);
    expect(screen.getByText(/1\.4\.0 \(abc1234\)/)).toBeInTheDocument();
  });

  it('carries no licence essay, upstream credit or repository link', () => {
    render(<AboutPage />);
    expect(screen.queryByText(/Affero|Backspace|Jannis Braun/)).toBeNull();
    // Its links are this instance's own pages, not any repository.
    expect(screen.queryAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/developers', '/help', '/changelog', '/status']);
  });

  it('leads to the developer docs beside the app, since leaving it would end a call', () => {
    render(<AboutPage />);
    const docs = screen.getByRole('link', { name: 'Read the docs' });
    expect(docs).toHaveAttribute('href', '/developers');
    expect(docs).toHaveAttribute('target', '_blank');
  });

  it('offers the desktop app once a release is published', async () => {
    release.mockResolvedValue({
      release: {
        version: '1.12.0',
        releasedAt: null,
        files: [{ platform: 'windows', arch: 'x64', fileName: 'Tavvit-1.12.0-win-x64.exe', url: '/downloads/desktop/Tavvit-1.12.0-win-x64.exe', size: 90_000_000, sha512: 'x' }],
      },
    });
    render(<AboutPage />);
    expect(await screen.findByRole('link', { name: 'Download for Windows' })).toHaveAttribute('href', '/downloads/desktop/Tavvit-1.12.0-win-x64.exe');
  });

  it('says so plainly when no desktop release exists', async () => {
    render(<AboutPage />);
    expect(await screen.findByText(/No desktop release has been published/)).toBeInTheDocument();
  });

  it('tells an administrator the source has not been published yet', () => {
    useSettingsStore.setState({ isAdmin: true });
    info.value = instanceInfo({ sourceCodeConfigured: false, sourceCodeUrl: 'https://github.com/TheZwiss/backspace' });
    render(<AboutPage />);
    expect(screen.getByText(/link is not configured for this server/)).toBeInTheDocument();
  });

  it('does not show the missing-source notice to anyone else', () => {
    useSettingsStore.setState({ isAdmin: false });
    info.value = instanceInfo({ sourceCodeConfigured: false, sourceCodeUrl: 'https://github.com/TheZwiss/backspace' });
    render(<AboutPage />);
    expect(screen.queryByText(/link is not configured for this server/)).toBeNull();
  });

  it('stays quiet about the source when it is published', () => {
    render(<AboutPage />);
    expect(screen.queryByText(/link is not configured for this server/)).toBeNull();
  });

  it('still renders while the instance info is loading', () => {
    info.value = null;
    render(<AboutPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('About Tavvit');
    expect(screen.queryByText('Friend Club')).toBeNull();
  });

  it('has no project-page cards: no donation, insights, community or report links', () => {
    render(<AboutPage />);
    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => /ko-fi|backspacechat|insights|issues\/new/.test(h))).toBe(false);
  });

  it('omits its own top bar when a screen header is supplied', () => {
    render(<AboutPage showTopBar={false} />);
    expect(screen.queryByRole('button', { name: /member list/i })).toBeNull();
  });
});
