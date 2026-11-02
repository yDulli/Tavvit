import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DesktopReleaseFile } from '@backspace/shared';
import { osFromUserAgent } from '../../platform/clientSystem';

const release = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ api: { desktop: { release } } }));

import { DesktopDownload, pickInstaller } from './DesktopDownload';

function file(arch: 'x64' | 'arm64'): DesktopReleaseFile {
  const fileName = `Tavvit-1.12.0-win-${arch}.exe`;
  return { platform: 'windows', arch, fileName, url: `/downloads/desktop/${fileName}`, size: 95_000_000, sha512: 'x' };
}

beforeEach(() => {
  release.mockReset();
});

afterEach(() => {
  cleanup();
  delete window.backspace;
});

describe('osFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36', undefined, 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15', undefined, 'mac'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', undefined, 'linux'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36', undefined, 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', undefined, 'ios'],
    ['anything', 'Windows', 'windows'],
    ['anything', 'macOS', 'mac'],
  ])('reads %s (hint %s) as %s', (ua, hint, expected) => {
    expect(osFromUserAgent(ua, hint)).toBe(expected);
  });
});

describe('pickInstaller', () => {
  it('offers the visitor’s processor, and x64 when it is unknown', () => {
    const files = [file('x64'), file('arm64')];
    expect(pickInstaller(files, 'arm64')?.arch).toBe('arm64');
    expect(pickInstaller(files, null)?.arch).toBe('x64');
    expect(pickInstaller([file('x64')], 'arm64')?.arch).toBe('x64');
    expect(pickInstaller([], 'x64')).toBeNull();
  });
});

describe('DesktopDownload', () => {
  it('lists every installer on the page variant', async () => {
    release.mockResolvedValue({ release: { version: '1.12.0', releasedAt: '2026-10-23T09:30:00.000Z', files: [file('x64'), file('arm64')] } });
    render(<DesktopDownload variant="page" />);
    expect(await screen.findByRole('link', { name: 'Download for Windows' })).toHaveAttribute('download', 'Tavvit-1.12.0-win-x64.exe');
    fireEvent.click(screen.getByRole('button', { name: 'All installers' }));
    expect(screen.getByText('Windows on ARM (arm64)')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Download' })).toHaveLength(2);
  });

  it('offers a retry when the list cannot be loaded', async () => {
    release.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ release: null });
    render(<DesktopDownload variant="page" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No desktop release has been published/)).toBeInTheDocument();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('says nothing beside the sign-in when there is nothing to download', async () => {
    release.mockResolvedValue({ release: null });
    const { container } = render(<DesktopDownload variant="aside" />);
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing inside the desktop app', () => {
    release.mockResolvedValue({ release: null });
    window.backspace = {} as NonNullable<typeof window.backspace>;
    const { container } = render(<DesktopDownload variant="page" />);
    expect(container).toBeEmptyDOMElement();
  });
});
